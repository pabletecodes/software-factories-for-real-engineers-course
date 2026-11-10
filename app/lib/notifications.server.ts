import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  comments,
  courseRatings,
  courses,
  lessons,
  modules,
  users,
  UserRole,
} from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import { MAX_RATING, MIN_RATING } from "~/lib/ratings";

// ─── Notifications ───
// The actions that will trigger Notifications: posting a question or a reply,
// deleting a post, rating a course, and changing a course's status. See
// GLOSSARY.md for the language.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention), and returns a Failure
// instead of throwing for expected failures.

export type Db = BetterSQLite3Database<typeof schema>;

export type Failure = { ok: false; status: 400 | 403 | 404; error: string };

type Comment = typeof comments.$inferSelect;

function getCourseForLesson(db: Db, lessonId: number) {
  return db
    .select({ courseId: courses.id, instructorId: courses.instructorId })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

function getCourse(db: Db, courseId: number) {
  return db.select().from(courses).where(eq(courses.id, courseId)).get();
}

function isPlatformAdmin(db: Db, userId: number) {
  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return user?.role === UserRole.Admin;
}

function getComment(db: Db, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
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

  if (!getCourseForLesson(db, lessonId)) {
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

  const comment = db
    .insert(comments)
    .values({ userId: authorId, lessonId, parentId, body: trimmed })
    .returning()
    .get();

  return { ok: true, comment };
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

  const comment = db
    .update(comments)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  return { ok: true, comment };
}

// ─── Rating a course ───

type Rating = typeof courseRatings.$inferSelect;

export type RateCourseResult = { ok: true; rating: Rating } | Failure;

/**
 * Records someone's rating of a course, in whole stars. Each person has one
 * rating per course: rating again changes it.
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

  if (!getCourse(db, courseId)) {
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

  const rating = db
    .insert(courseRatings)
    .values({ userId: raterId, courseId, rating: stars })
    .returning()
    .get();
  return { ok: true, rating };
}
