import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  comments,
  courseRatings,
  courses,
  lessons,
  modules,
  notifications,
  users,
  CourseStatus,
  NotificationKind,
  UserRole,
} from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import { MAX_RATING, MIN_RATING } from "~/lib/ratings";
import { pushHub } from "~/lib/notification-push.server";
import { resolveCourseAccess } from "~/lib/course-access.server";

// ─── Notifications ───
// The actions that trigger Notifications (posting a question or a reply,
// deleting a post, rating a course, and changing a course's status), each
// creating its Notifications in the same transaction as the write it reports.
// Plus reading and changing a recipient's own Notifications. See GLOSSARY.md
// for the language and ADR 0013 for the in-house design.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention), and returns a Failure
// instead of throwing for expected failures.

export type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

export type Failure = { ok: false; status: 400 | 403 | 404; error: string };

type Comment = typeof comments.$inferSelect;

/** The course a lesson belongs to, or undefined if the lesson is gone. */
export function getCourseForLesson(db: Queryable, lessonId: number) {
  return db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

function getCourse(db: Queryable, courseId: number) {
  return db.select().from(courses).where(eq(courses.id, courseId)).get();
}

function isPlatformAdmin(db: Queryable, userId: number) {
  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return user?.role === UserRole.Admin;
}

function getComment(db: Queryable, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

// ─── Creating Notifications ───

/** What one event records, apart from who receives it. */
type NotificationEvent = Omit<
  typeof notifications.$inferInsert,
  "id" | "recipientId" | "readAt"
>;

/**
 * Creates one Notification per recipient for an event, inside the caller's
 * transaction. Nobody is notified about their own action, nobody twice, and
 * never a Platform Admin. Returns the ids of the Notifications created, for
 * the caller to nudge once its transaction has committed.
 */
function notify(
  tx: Queryable,
  recipientIds: number[],
  event: NotificationEvent
): number[] {
  const candidates = [...new Set(recipientIds)].filter(
    (id) => id !== event.actorId
  );
  if (candidates.length === 0) return [];

  const recipients = tx
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, candidates), ne(users.role, UserRole.Admin)))
    .all()
    .map(({ id }) => id);
  if (recipients.length === 0) return [];

  return tx
    .insert(notifications)
    .values(recipients.map((recipientId) => ({ ...event, recipientId })))
    .returning({ id: notifications.id })
    .all()
    .map(({ id }) => id);
}

// ─── Nudging recipients ───

/**
 * Nudges the recipients of newly created Notifications (ADR 0013). Writers
 * call it after `db.transaction(...)` has returned, so only committed
 * Notifications are nudged: a write that rolls back never gets here.
 */
function nudge(db: Db, notificationIds: number[]) {
  if (notificationIds.length === 0) return;
  try {
    const rows = selectNotifications(db)
      .where(inArray(notifications.id, notificationIds))
      .all();
    for (const row of rows) {
      const view = toView(row);
      pushHub.publish([row.notification.recipientId], {
        title: view.title,
        courseTitle: view.courseTitle,
      });
    }
  } catch (error) {
    // A nudge is only a hint to refetch; the Notification is stored.
    console.error("Could not nudge Notification recipients", error);
  }
}

/**
 * Runs a write in its own transaction, collecting the Notifications it
 * creates, and nudges their recipients once the transaction has committed.
 * Writers must not be called inside another transaction.
 */
function writeAndNudge<T>(db: Db, write: (tx: Tx, notified: number[]) => T): T {
  const notified: number[] = [];
  const result = db.transaction((tx) => write(tx, notified));
  nudge(db, notified);
  return result;
}

// ─── Posting a question or a reply ───

export type PostCommentResult = { ok: true; comment: Comment } | Failure;

/**
 * Posts a question on a lesson (no parent) or a reply to a question. Replies
 * are one level deep only, and must be on the same lesson as their question.
 */
export function postComment(
  db: Db,
  authorId: number,
  lessonId: number,
  parentId: number | null,
  body: string
): PostCommentResult {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    return { ok: false, status: 400, error: "Comment cannot be empty" };
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
    };
  }

  const course = getCourseForLesson(db, lessonId);
  if (!course) {
    return { ok: false, status: 404, error: "Lesson not found" };
  }

  if (parentId !== null) {
    const parent = getComment(db, parentId);
    if (!parent) {
      return { ok: false, status: 404, error: "Parent comment not found" };
    }
    if (parent.lessonId !== lessonId) {
      return {
        ok: false,
        status: 400,
        error: "Parent comment belongs to a different lesson",
      };
    }
    if (parent.parentId !== null) {
      return {
        ok: false,
        status: 400,
        error: "Replies can only be one level deep",
      };
    }
  }

  return writeAndNudge(db, (tx, notified): PostCommentResult => {
    const comment = tx
      .insert(comments)
      .values({ userId: authorId, lessonId, parentId, body: trimmed })
      .returning()
      .get();

    if (parentId === null) {
      notified.push(
        ...notify(tx, [course.instructorId], {
          kind: NotificationKind.NewQuestion,
          actorId: authorId,
          courseId: course.courseId,
          lessonId,
          commentId: comment.id,
        })
      );
    } else {
      notified.push(
        ...notify(tx, threadParticipantIds(tx, parentId), {
          kind: NotificationKind.Reply,
          actorId: authorId,
          courseId: course.courseId,
          lessonId,
          commentId: comment.id,
        })
      );
    }

    return { ok: true, comment };
  });
}

/**
 * Everyone who has posted in a question's thread: whoever asked it and every
 * author of a reply to it, deleted posts included.
 */
function threadParticipantIds(db: Queryable, questionId: number): number[] {
  return db
    .select({ userId: comments.userId })
    .from(comments)
    .where(or(eq(comments.id, questionId), eq(comments.parentId, questionId)))
    .all()
    .map((row) => row.userId);
}

// ─── Deleting a post ───

export type DeletePostResult = { ok: true; comment: Comment } | Failure;

/**
 * Soft-deletes a question or reply. Its author may delete it, and so may staff:
 * the course's Instructor or a Platform Admin. Deleting a post that is already
 * deleted changes nothing.
 */
export function deletePost(
  db: Db,
  commentId: number,
  deleterId: number
): DeletePostResult {
  const existing = getComment(db, commentId);
  if (!existing) {
    return { ok: false, status: 404, error: "Comment not found" };
  }

  const course = getCourseForLesson(db, existing.lessonId);
  const isStaff =
    course?.instructorId === deleterId || isPlatformAdmin(db, deleterId);

  if (existing.userId !== deleterId && !isStaff) {
    return {
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    };
  }

  if (existing.deletedAt !== null) {
    return { ok: true, comment: existing };
  }

  return writeAndNudge(db, (tx, notified): DeletePostResult => {
    const comment = tx
      .update(comments)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(comments.id, commentId))
      .returning()
      .get();

    if (course) {
      notified.push(...notifyPostDeleted(tx, comment, course, deleterId));
    }

    return { ok: true, comment };
  });
}

/** How much of a deleted post its Notification keeps. */
export const DELETED_POST_EXCERPT_LENGTH = 200;

function excerptOf(body: string) {
  return body.length > DELETED_POST_EXCERPT_LENGTH
    ? `${body.slice(0, DELETED_POST_EXCERPT_LENGTH - 1)}…`
    : body;
}

/**
 * Tells a post's author that someone else deleted it. The lesson title and an
 * excerpt are kept on the Notification, as the post and lesson may not last.
 */
function notifyPostDeleted(
  tx: Queryable,
  comment: Comment,
  course: { courseId: number; instructorId: number },
  deleterId: number
): number[] {
  const lesson = tx
    .select({ title: lessons.title })
    .from(lessons)
    .where(eq(lessons.id, comment.lessonId))
    .get();

  return notify(tx, [comment.userId], {
    kind: NotificationKind.PostDeleted,
    actorId: deleterId,
    courseId: course.courseId,
    lessonId: comment.lessonId,
    commentId: comment.id,
    lessonTitle: lesson?.title ?? null,
    excerpt: excerptOf(comment.body),
  });
}

// ─── Rating a course ───

type Rating = typeof courseRatings.$inferSelect;

export type RateCourseResult = { ok: true; rating: Rating } | Failure;

/**
 * Records someone's rating of a course, in whole stars. Each person has one
 * rating per course: rating again changes it. A first rating notifies the
 * course's Instructor; a changed rating notifies nobody.
 */
export function rateCourse(
  db: Db,
  raterId: number,
  courseId: number,
  stars: number
): RateCourseResult {
  if (!Number.isInteger(stars) || stars < MIN_RATING || stars > MAX_RATING) {
    return {
      ok: false,
      status: 400,
      error: `Rating must be a whole number between ${MIN_RATING} and ${MAX_RATING}`,
    };
  }

  const course = getCourse(db, courseId);
  if (!course) {
    return { ok: false, status: 404, error: "Course not found" };
  }

  const existing = db
    .select()
    .from(courseRatings)
    .where(
      and(
        eq(courseRatings.userId, raterId),
        eq(courseRatings.courseId, courseId)
      )
    )
    .get();

  if (existing) {
    const rating = db
      .update(courseRatings)
      .set({ rating: stars, updatedAt: new Date().toISOString() })
      .where(eq(courseRatings.id, existing.id))
      .returning()
      .get();
    return { ok: true, rating };
  }

  return writeAndNudge(db, (tx, notified): RateCourseResult => {
    const rating = tx
      .insert(courseRatings)
      .values({ userId: raterId, courseId, rating: stars })
      .returning()
      .get();

    notified.push(
      ...notify(tx, [course.instructorId], {
        kind: NotificationKind.NewRating,
        actorId: raterId,
        courseId,
        ratingId: rating.id,
      })
    );

    return { ok: true, rating };
  });
}

// ─── Changing a course's status ───

type Course = typeof courses.$inferSelect;

export type ChangeCourseStatusResult = { ok: true; course: Course } | Failure;

/**
 * Moves a course between Draft, Published and Archived. Only its Instructor or
 * a Platform Admin may. A move to a different status notifies the Instructor,
 * keeping the old and new status, unless they made it themselves.
 */
export function changeCourseStatus(
  db: Db,
  courseId: number,
  changerId: number,
  status: CourseStatus
): ChangeCourseStatusResult {
  const existing = getCourse(db, courseId);
  if (!existing) {
    return { ok: false, status: 404, error: "Course not found." };
  }

  if (existing.instructorId !== changerId && !isPlatformAdmin(db, changerId)) {
    return {
      ok: false,
      status: 403,
      error: "You can only edit your own courses.",
    };
  }

  return writeAndNudge(db, (tx, notified): ChangeCourseStatusResult => {
    const course = tx
      .update(courses)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(courses.id, courseId))
      .returning()
      .get();

    if (existing.status !== status) {
      notified.push(
        ...notify(tx, [existing.instructorId], {
          kind: NotificationKind.CourseStatusChanged,
          actorId: changerId,
          courseId,
          fromStatus: existing.status,
          toStatus: status,
        })
      );
    }

    return { ok: true, course };
  });
}

// ─── Reading Notifications ───

/** A Notification as its recipient sees it, with names and titles current. */
export type NotificationView = {
  id: number;
  kind: NotificationKind;
  read: boolean;
  createdAt: string;
  title: string;
  excerpt: string | null;
  courseTitle: string;
};

export const LATEST_NOTIFICATIONS_LIMIT = 20;

const actors = alias(users, "actors");
const questions = alias(comments, "questions");

/**
 * Selects Notifications with everything needed to describe them, and to work
 * out where a click leads, joined in.
 */
function selectNotifications(db: Queryable) {
  return db
    .select({
      notification: notifications,
      actorName: actors.name,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      lessonExists: lessons.id,
      commentBody: comments.body,
      commentDeletedAt: comments.deletedAt,
      questionAuthorId: questions.userId,
      ratingStars: courseRatings.rating,
    })
    .from(notifications)
    .innerJoin(actors, eq(notifications.actorId, actors.id))
    .innerJoin(courses, eq(notifications.courseId, courses.id))
    .leftJoin(lessons, eq(notifications.lessonId, lessons.id))
    .leftJoin(comments, eq(notifications.commentId, comments.id))
    .leftJoin(questions, eq(comments.parentId, questions.id))
    .leftJoin(courseRatings, eq(notifications.ratingId, courseRatings.id));
}

type NotificationRow = ReturnType<
  ReturnType<typeof selectNotifications>["all"]
>[number];

/** The title and excerpt of each kind of Notification. */
function describeNotification(
  row: NotificationRow
): Pick<NotificationView, "title" | "excerpt"> {
  const { notification, actorName } = row;
  switch (notification.kind) {
    case NotificationKind.NewQuestion:
      return {
        title: `${actorName} asked a question`,
        excerpt: row.commentBody,
      };
    case NotificationKind.NewRating:
      return {
        title: `${actorName} rated your course ${stars(row.ratingStars)}`,
        excerpt: null,
      };
    case NotificationKind.CourseStatusChanged:
      return {
        title: `${actorName} moved your course from ${statusLabel(notification.fromStatus)} to ${statusLabel(notification.toStatus)}`,
        excerpt: null,
      };
    case NotificationKind.PostDeleted:
      return {
        title: `${actorName} deleted your post on "${notification.lessonTitle}"`,
        excerpt: notification.excerpt,
      };
    case NotificationKind.Reply:
      return {
        title:
          row.questionAuthorId === notification.recipientId
            ? `${actorName} replied to your question`
            : `${actorName} replied in a thread you posted in`,
        excerpt: row.commentBody,
      };
    default:
      return { title: "Notification", excerpt: notification.excerpt };
  }
}

/** A rating as filled and empty stars, e.g. ★★★★☆ for 4. */
function stars(rating: number | null) {
  if (rating === null) return "";
  return "★".repeat(rating) + "☆".repeat(MAX_RATING - rating);
}

/** A course status as shown to people, e.g. "Published". */
function statusLabel(status: CourseStatus | null) {
  if (status === null) return "an unknown status";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function toView(row: NotificationRow): NotificationView {
  const { notification } = row;
  return {
    id: notification.id,
    kind: notification.kind,
    read: notification.readAt !== null,
    createdAt: notification.createdAt,
    courseTitle: row.courseTitle,
    ...describeNotification(row),
  };
}

/** A recipient's latest Notifications, newest first (the bell's dropdown). */
export function listLatestNotifications(
  db: Queryable,
  recipientId: number,
  limit = LATEST_NOTIFICATIONS_LIMIT
): NotificationView[] {
  return selectNotifications(db)
    .where(eq(notifications.recipientId, recipientId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit)
    .all()
    .map(toView);
}

// ─── Clicking a Notification ───

/**
 * Where a click leads: a URL to go to, "stay" where there is nothing to go to
 * (as for a deleted post), or "unavailable" when the target has gone, so the
 * UI stays put and says it is no longer available.
 */
export type ClickTarget =
  { type: "url"; url: string } | { type: "stay" } | { type: "unavailable" };

export type ResolveClickResult = { ok: true; target: ClickTarget } | Failure;

function lessonUrl(courseSlug: string, lessonId: number) {
  return `/courses/${courseSlug}/lessons/${lessonId}`;
}

/**
 * Where a Notification about a comment leads: the comment on its lesson, the
 * lesson with no anchor once the comment was deleted, or "unavailable" once
 * the lesson was deleted.
 */
function commentTarget(row: NotificationRow): ClickTarget {
  const { lessonId, commentId } = row.notification;
  if (lessonId === null || row.lessonExists === null) {
    return { type: "unavailable" };
  }
  const url = lessonUrl(row.courseSlug, lessonId);
  const commentGone =
    commentId === null ||
    row.commentBody === null ||
    row.commentDeletedAt !== null;
  return {
    type: "url",
    url: commentGone ? url : `${url}#comment-${commentId}`,
  };
}

/** Where each kind of Notification leads, checked at click time. */
function clickTarget(row: NotificationRow): ClickTarget {
  const { notification } = row;
  switch (notification.kind) {
    case NotificationKind.NewQuestion:
    case NotificationKind.Reply:
      return commentTarget(row);
    case NotificationKind.PostDeleted:
      // The post is gone, so there is nothing to show.
      return { type: "stay" };
    case NotificationKind.NewRating:
      return {
        type: "url",
        url: `/instructor/analytics?tab=course&course=${notification.courseId}`,
      };
    case NotificationKind.CourseStatusChanged:
      return { type: "url", url: `/instructor/${notification.courseId}` };
    default:
      return { type: "stay" };
  }
}

/**
 * Marks one of a recipient's Notifications read and works out where clicking
 * it leads, checked at that moment: a link into a course they can no longer
 * see is "unavailable". `country` is where they are now (for PPP), as
 * `resolveCountry` gives it. Another user's Notification is "not found".
 */
export function resolveNotificationClick(
  db: Db,
  notificationId: number,
  recipientId: number,
  now: Date = new Date(),
  country: string | null = null
): ResolveClickResult {
  const ownedBy = and(
    eq(notifications.id, notificationId),
    eq(notifications.recipientId, recipientId)
  );

  const row = selectNotifications(db).where(ownedBy).get();
  if (!row) {
    return { ok: false, status: 404, error: "Notification not found" };
  }

  if (row.notification.readAt === null) {
    db.update(notifications)
      .set({ readAt: now.toISOString() })
      .where(ownedBy)
      .run();
  }

  const target = clickTarget(row);
  if (
    target.type === "url" &&
    !resolveCourseAccess(db, recipientId, row.notification.courseId, country)
      ?.canViewContent
  ) {
    return { ok: true, target: { type: "unavailable" } };
  }
  return { ok: true, target };
}

// ─── Counting Notifications ───

/** How many of a recipient's Notifications are unread. */
export function countUnreadNotifications(
  db: Queryable,
  recipientId: number
): number {
  return (
    db
      .select({ n: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          isNull(notifications.readAt)
        )
      )
      .get()?.n ?? 0
  );
}

// ─── Managing Notifications ───

export type ManageNotificationsResult = { ok: true } | Failure;

/**
 * Deletes one of a recipient's Notifications for good. Another user's
 * Notification is "not found".
 */
export function deleteNotification(
  db: Db,
  notificationId: number,
  recipientId: number
): ManageNotificationsResult {
  const deleted = db
    .delete(notifications)
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientId, recipientId)
      )
    )
    .returning({ id: notifications.id })
    .all();
  if (deleted.length === 0) {
    return { ok: false, status: 404, error: "Notification not found" };
  }
  return { ok: true };
}

/** Marks every one of a recipient's unread Notifications read. */
export function markAllNotificationsRead(
  db: Db,
  recipientId: number,
  now: Date = new Date()
): ManageNotificationsResult {
  db.update(notifications)
    .set({ readAt: now.toISOString() })
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt)
      )
    )
    .run();
  return { ok: true };
}

// ─── The full Notifications page ───

export const NOTIFICATIONS_PAGE_SIZE = 50;

/** Narrows a recipient's Notifications: to unread ones, to one kind, or both. */
export type NotificationFilter = {
  unreadOnly: boolean;
  kind: NotificationKind | null;
};

export type NotificationsPage = {
  notifications: NotificationView[];
  /** How many Notifications match the filter, on every page. */
  total: number;
  /** The page shown, from 1; a page past the end shows the last one. */
  page: number;
  pageCount: number;
};

function matchingFilter(recipientId: number, filter: NotificationFilter) {
  return and(
    eq(notifications.recipientId, recipientId),
    filter.unreadOnly ? isNull(notifications.readAt) : undefined,
    filter.kind ? eq(notifications.kind, filter.kind) : undefined
  );
}

/**
 * One page of a recipient's Notifications that match a filter, newest first,
 * NOTIFICATIONS_PAGE_SIZE to a page.
 */
export function listNotificationsPage(
  db: Queryable,
  recipientId: number,
  filter: NotificationFilter,
  page: number
): NotificationsPage {
  const where = matchingFilter(recipientId, filter);
  const total =
    db.select({ n: count() }).from(notifications).where(where).get()?.n ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));
  const shown = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);

  const rows = selectNotifications(db)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATIONS_PAGE_SIZE)
    .offset((shown - 1) * NOTIFICATIONS_PAGE_SIZE)
    .all();

  return { notifications: rows.map(toView), total, page: shown, pageCount };
}

/** How many Notifications a recipient has, in all and of each kind. */
export type NotificationCounts = {
  total: number;
  unread: number;
  byKind: Record<NotificationKind, number>;
  unreadByKind: Record<NotificationKind, number>;
};

function zeroPerKind(): Record<NotificationKind, number> {
  return Object.fromEntries(
    Object.values(NotificationKind).map((kind) => [kind, 0])
  ) as Record<NotificationKind, number>;
}

/** Counts a recipient's Notifications: in all, unread, and per kind. */
export function countNotifications(
  db: Queryable,
  recipientId: number
): NotificationCounts {
  const rows = db
    .select({
      kind: notifications.kind,
      total: count(),
      unread: sql<number>`sum(case when ${notifications.readAt} is null then 1 else 0 end)`,
    })
    .from(notifications)
    .where(eq(notifications.recipientId, recipientId))
    .groupBy(notifications.kind)
    .all();

  const counts: NotificationCounts = {
    total: 0,
    unread: 0,
    byKind: zeroPerKind(),
    unreadByKind: zeroPerKind(),
  };
  for (const row of rows) {
    counts.total += row.total;
    counts.unread += row.unread;
    counts.byKind[row.kind] = row.total;
    counts.unreadByKind[row.kind] = row.unread;
  }
  return counts;
}

/**
 * The kinds of Notification someone in this role can receive, in the order
 * the page shows them. Platform Admins receive none.
 */
export function receivableNotificationKinds(
  role: UserRole
): NotificationKind[] {
  switch (role) {
    case UserRole.Student:
      return [NotificationKind.Reply, NotificationKind.PostDeleted];
    case UserRole.Instructor:
      // A Platform Admin may delete an Instructor's post, as any author's.
      return [
        NotificationKind.Reply,
        NotificationKind.PostDeleted,
        NotificationKind.NewQuestion,
        NotificationKind.NewRating,
        NotificationKind.CourseStatusChanged,
      ];
    default:
      return [];
  }
}

/** What a bulk action changed: how many of the chosen Notifications. */
export type BulkNotificationsResult = { ok: true; count: number };

function ownedAmong(notificationIds: number[], recipientId: number) {
  return and(
    inArray(notifications.id, notificationIds),
    eq(notifications.recipientId, recipientId)
  );
}

/**
 * Marks the chosen Notifications read. Only the recipient's own are touched:
 * another user's ids are skipped.
 */
export function markNotificationsRead(
  db: Db,
  notificationIds: number[],
  recipientId: number,
  now: Date = new Date()
): BulkNotificationsResult {
  if (notificationIds.length === 0) return { ok: true, count: 0 };
  const marked = db
    .update(notifications)
    .set({ readAt: now.toISOString() })
    .where(
      and(
        ownedAmong(notificationIds, recipientId),
        isNull(notifications.readAt)
      )
    )
    .returning({ id: notifications.id })
    .all();
  return { ok: true, count: marked.length };
}

/**
 * Deletes the chosen Notifications for good. Only the recipient's own are
 * touched: another user's ids are skipped.
 */
export function deleteNotifications(
  db: Db,
  notificationIds: number[],
  recipientId: number
): BulkNotificationsResult {
  if (notificationIds.length === 0) return { ok: true, count: 0 };
  const deleted = db
    .delete(notifications)
    .where(ownedAmong(notificationIds, recipientId))
    .returning({ id: notifications.id })
    .all();
  return { ok: true, count: deleted.length };
}
