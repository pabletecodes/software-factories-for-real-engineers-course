import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationKind, UserRole } from "~/db/schema";
import {
  countNotifications,
  deleteNotifications,
  listNotificationsPage,
  markNotificationsRead,
  receivableNotificationKinds,
  postComment,
  rateCourse,
  resolveNotificationClick,
} from "./notifications.server";

// The full Notifications page: paging through a long history, filtering it,
// counting it, and acting on many Notifications at once.

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;
});

const ALL = { unreadOnly: false, kind: null };

/** Has the Student ask `n` questions, giving the Instructor `n` Notifications. */
function askQuestions(n: number) {
  for (let i = 1; i <= n; i++) {
    postComment(db, base.user.id, lessonId, null, `Question ${i}?`);
  }
}

/** Has `n` new Students each rate the course, giving the Instructor `n` Notifications. */
function rateByNewStudents(n: number) {
  for (let i = 1; i <= n; i++) {
    const student = db
      .insert(schema.users)
      .values({
        name: `Rater ${i}`,
        email: `rater${i}@example.com`,
        role: UserRole.Student,
      })
      .returning()
      .get();
    rateCourse(db, student.id, base.course.id, 5);
  }
}

/** Opens the given Notifications, as clicking them would, marking them read. */
function open(ids: number[]) {
  for (const id of ids) resolveNotificationClick(db, id, base.instructor.id);
}

describe("listNotificationsPage", () => {
  it("pages through the history 50 at a time, newest first", () => {
    askQuestions(120);

    const first = listNotificationsPage(db, base.instructor.id, ALL, 1);
    expect(first.total).toBe(120);
    expect(first.page).toBe(1);
    expect(first.pageCount).toBe(3);
    expect(first.notifications).toHaveLength(50);
    expect(first.notifications[0].excerpt).toBe("Question 120?");
    expect(first.notifications[49].excerpt).toBe("Question 71?");

    const last = listNotificationsPage(db, base.instructor.id, ALL, 3);
    expect(last.page).toBe(3);
    expect(last.notifications.map((n) => n.excerpt)).toEqual(
      Array.from({ length: 20 }, (_, i) => `Question ${20 - i}?`)
    );
  });

  it("shows the last page when asked for one past the end", () => {
    askQuestions(3);

    const page = listNotificationsPage(db, base.instructor.id, ALL, 9);
    expect(page.page).toBe(1);
    expect(page.pageCount).toBe(1);
    expect(page.notifications).toHaveLength(3);
  });

  it("shows only unread Notifications under the unread filter", () => {
    askQuestions(4);
    const [newest, , third] = listNotificationsPage(
      db,
      base.instructor.id,
      ALL,
      1
    ).notifications;
    open([newest.id, third.id]);

    const page = listNotificationsPage(
      db,
      base.instructor.id,
      { unreadOnly: true, kind: null },
      1
    );
    expect(page.total).toBe(2);
    expect(page.notifications.map((n) => n.excerpt)).toEqual([
      "Question 3?",
      "Question 1?",
    ]);
  });

  it("shows only one kind under the kind filter", () => {
    askQuestions(2);
    rateByNewStudents(3);

    const page = listNotificationsPage(
      db,
      base.instructor.id,
      { unreadOnly: false, kind: NotificationKind.NewQuestion },
      1
    );
    expect(page.total).toBe(2);
    expect(page.notifications.map((n) => n.kind)).toEqual([
      NotificationKind.NewQuestion,
      NotificationKind.NewQuestion,
    ]);
  });

  it("combines the unread and kind filters", () => {
    askQuestions(3);
    rateByNewStudents(2);
    const questions = listNotificationsPage(
      db,
      base.instructor.id,
      { unreadOnly: false, kind: NotificationKind.NewQuestion },
      1
    ).notifications;
    open([questions[0].id]);

    const page = listNotificationsPage(
      db,
      base.instructor.id,
      { unreadOnly: true, kind: NotificationKind.NewQuestion },
      1
    );
    expect(page.total).toBe(2);
    expect(page.notifications.map((n) => n.excerpt)).toEqual([
      "Question 2?",
      "Question 1?",
    ]);
  });

  it("shows only the recipient's own Notifications", () => {
    askQuestions(2);

    const page = listNotificationsPage(db, base.user.id, ALL, 1);
    expect(page.total).toBe(0);
    expect(page.notifications).toEqual([]);
  });
});

describe("countNotifications", () => {
  it("counts the recipient's Notifications in all, unread, and per kind", () => {
    askQuestions(3);
    rateByNewStudents(2);
    const [newestRating] = listNotificationsPage(
      db,
      base.instructor.id,
      ALL,
      1
    ).notifications;
    const [oldestQuestion] = listNotificationsPage(
      db,
      base.instructor.id,
      { unreadOnly: false, kind: NotificationKind.NewQuestion },
      1
    ).notifications.slice(-1);
    open([newestRating.id, oldestQuestion.id]);

    expect(countNotifications(db, base.instructor.id)).toEqual({
      total: 5,
      unread: 3,
      byKind: {
        [NotificationKind.Reply]: 0,
        [NotificationKind.PostDeleted]: 0,
        [NotificationKind.NewQuestion]: 3,
        [NotificationKind.NewRating]: 2,
        [NotificationKind.CourseStatusChanged]: 0,
      },
      unreadByKind: {
        [NotificationKind.Reply]: 0,
        [NotificationKind.PostDeleted]: 0,
        [NotificationKind.NewQuestion]: 2,
        [NotificationKind.NewRating]: 1,
        [NotificationKind.CourseStatusChanged]: 0,
      },
    });
  });

  it("counts nothing for someone with no Notifications", () => {
    askQuestions(2);

    const counts = countNotifications(db, base.user.id);
    expect(counts.total).toBe(0);
    expect(counts.unread).toBe(0);
    expect(counts.byKind[NotificationKind.NewQuestion]).toBe(0);
  });
});

describe("receivableNotificationKinds", () => {
  it("gives Students replies and removed posts", () => {
    expect(receivableNotificationKinds(UserRole.Student)).toEqual([
      NotificationKind.Reply,
      NotificationKind.PostDeleted,
    ]);
  });

  it("gives Instructors replies, questions, ratings and course status", () => {
    expect(receivableNotificationKinds(UserRole.Instructor)).toEqual([
      NotificationKind.Reply,
      NotificationKind.NewQuestion,
      NotificationKind.NewRating,
      NotificationKind.CourseStatusChanged,
    ]);
  });

  it("gives Platform Admins none", () => {
    expect(receivableNotificationKinds(UserRole.Admin)).toEqual([]);
  });
});
