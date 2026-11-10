import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus, UserRole } from "~/db/schema";
import {
  countUnreadNotifications,
  deleteNotification,
  listLatestNotifications,
  markAllNotificationsRead,
  postComment,
  resolveNotificationClick,
} from "./notifications.server";

// Managing your own Notifications from the bell's dropdown: deleting one and
// marking them all read.

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

function addInstructor(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Instructor,
    })
    .returning()
    .get();
}

describe("deleteNotification", () => {
  it("deletes the recipient's Notification for good, from every list and count", () => {
    postComment(db, base.user.id, lessonId, null, "First?");
    postComment(db, base.user.id, lessonId, null, "Second?");
    const [newest, oldest] = listLatestNotifications(db, base.instructor.id);

    expect(deleteNotification(db, newest.id, base.instructor.id)).toEqual({
      ok: true,
    });

    expect(
      listLatestNotifications(db, base.instructor.id).map((n) => n.id)
    ).toEqual([oldest.id]);
    expect(countUnreadNotifications(db, base.instructor.id)).toBe(1);
    expect(resolveNotificationClick(db, newest.id, base.instructor.id)).toEqual(
      { ok: false, status: 404, error: "Notification not found" }
    );
  });

  it("refuses another user's Notification and leaves it alone", () => {
    postComment(db, base.user.id, lessonId, null, "How?");
    const [notification] = listLatestNotifications(db, base.instructor.id);

    expect(deleteNotification(db, notification.id, base.user.id)).toEqual({
      ok: false,
      status: 404,
      error: "Notification not found",
    });
    expect(listLatestNotifications(db, base.instructor.id)).toHaveLength(1);
    expect(countUnreadNotifications(db, base.instructor.id)).toBe(1);
  });
});

describe("markAllNotificationsRead", () => {
  it("marks every one of the recipient's Notifications read, and only theirs", () => {
    const otherInstructor = addInstructor("Marcus");
    const otherCourse = db
      .insert(schema.courses)
      .values({
        title: "Other Course",
        slug: "other-course",
        description: "Another course",
        salesCopy: "Buy it.",
        status: CourseStatus.Published,
        instructorId: otherInstructor.id,
        categoryId: base.category.id,
      })
      .returning()
      .get();
    const otherModule = db
      .insert(schema.modules)
      .values({ courseId: otherCourse.id, title: "Intro", position: 1 })
      .returning()
      .get();
    const otherLesson = db
      .insert(schema.lessons)
      .values({ moduleId: otherModule.id, title: "Welcome", position: 1 })
      .returning()
      .get();

    postComment(db, base.user.id, lessonId, null, "First?");
    postComment(db, base.user.id, lessonId, null, "Second?");
    postComment(db, base.user.id, otherLesson.id, null, "Elsewhere?");

    expect(markAllNotificationsRead(db, base.instructor.id)).toEqual({
      ok: true,
    });

    expect(countUnreadNotifications(db, base.instructor.id)).toBe(0);
    expect(
      listLatestNotifications(db, base.instructor.id).map((n) => n.read)
    ).toEqual([true, true]);
    expect(countUnreadNotifications(db, otherInstructor.id)).toBe(1);
  });

  it("does nothing when there are no Notifications", () => {
    expect(markAllNotificationsRead(db, base.instructor.id)).toEqual({
      ok: true,
    });
    expect(listLatestNotifications(db, base.instructor.id)).toEqual([]);
  });
});
