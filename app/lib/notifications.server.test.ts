import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus, UserRole } from "~/db/schema";
import {
  changeCourseStatus,
  deletePost,
  postComment,
  rateCourse,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  [lessonId, otherLessonId] = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addUser(name: string, role = UserRole.Student) {
  return db
    .insert(schema.users)
    .values({ name, email: `${name.toLowerCase()}@example.com`, role })
    .returning()
    .get();
}

describe("postComment", () => {
  it("posts a question on a lesson, trimmed", () => {
    const result = postComment(db, base.user.id, lessonId, null, "  How?  ");

    expect(result).toMatchObject({
      ok: true,
      comment: { userId: base.user.id, lessonId, parentId: null, body: "How?" },
    });
  });

  it("refuses an empty body", () => {
    expect(postComment(db, base.user.id, lessonId, null, "   ")).toEqual({
      ok: false,
      status: 400,
      error: "Comment cannot be empty",
    });
  });

  it("accepts 5000 characters but refuses 5001", () => {
    expect(
      postComment(db, base.user.id, lessonId, null, "a".repeat(5000)).ok
    ).toBe(true);
    expect(postComment(db, base.user.id, lessonId, null, "a".repeat(5001))).toEqual({
      ok: false,
      status: 400,
      error: "Comment must be 5000 characters or fewer",
    });
  });

  it("refuses a lesson that does not exist", () => {
    expect(postComment(db, base.user.id, 9999, null, "Hi")).toEqual({
      ok: false,
      status: 404,
      error: "Lesson not found",
    });
  });

  describe("replies", () => {
    function askQuestion(onLessonId = lessonId) {
      const result = postComment(db, base.user.id, onLessonId, null, "How?");
      if (!result.ok) throw new Error(result.error);
      return result.comment;
    }

    it("posts a reply to a question", () => {
      const question = askQuestion();

      const result = postComment(
        db,
        base.instructor.id,
        lessonId,
        question.id,
        "Like this."
      );

      expect(result).toMatchObject({
        ok: true,
        comment: { parentId: question.id, userId: base.instructor.id },
      });
    });

    it("refuses a parent that does not exist", () => {
      expect(postComment(db, base.user.id, lessonId, 9999, "Hi")).toEqual({
        ok: false,
        status: 404,
        error: "Parent comment not found",
      });
    });

    it("refuses a parent on a different lesson", () => {
      const question = askQuestion(otherLessonId);

      expect(postComment(db, base.user.id, lessonId, question.id, "Hi")).toEqual({
        ok: false,
        status: 400,
        error: "Parent comment belongs to a different lesson",
      });
    });

    it("refuses a reply to a reply", () => {
      const question = askQuestion();
      const reply = postComment(db, base.user.id, lessonId, question.id, "Me too");
      if (!reply.ok) throw new Error(reply.error);

      expect(
        postComment(db, base.user.id, lessonId, reply.comment.id, "Deeper")
      ).toEqual({
        ok: false,
        status: 400,
        error: "Replies can only be one level deep",
      });
    });
  });
});

describe("deletePost", () => {
  function post(authorId: number) {
    const result = postComment(db, authorId, lessonId, null, "A post");
    if (!result.ok) throw new Error(result.error);
    return result.comment;
  }

  it("lets the author delete their own post", () => {
    const question = post(base.user.id);

    expect(deletePost(db, question.id, base.user.id)).toMatchObject({
      ok: true,
      comment: { id: question.id, deletedAt: expect.any(String) },
    });
  });

  it("lets the course's Instructor delete someone else's post", () => {
    const question = post(base.user.id);

    expect(deletePost(db, question.id, base.instructor.id)).toMatchObject({
      ok: true,
      comment: { deletedAt: expect.any(String) },
    });
  });

  it("lets a Platform Admin delete someone else's post", () => {
    const question = post(base.user.id);
    const admin = addUser("Pat", UserRole.Admin);

    expect(deletePost(db, question.id, admin.id)).toMatchObject({
      ok: true,
      comment: { deletedAt: expect.any(String) },
    });
  });

  it("refuses another Student, and another course's Instructor", () => {
    const question = post(base.user.id);
    const student = addUser("Sam");
    const otherInstructor = addUser("Ivy", UserRole.Instructor);

    for (const userId of [student.id, otherInstructor.id]) {
      expect(deletePost(db, question.id, userId)).toEqual({
        ok: false,
        status: 403,
        error: "You can only delete your own comments",
      });
    }
  });

  it("refuses a post that does not exist", () => {
    expect(deletePost(db, 9999, base.user.id)).toEqual({
      ok: false,
      status: 404,
      error: "Comment not found",
    });
  });

  it("does nothing to a post that is already deleted", () => {
    const question = post(base.user.id);
    const first = deletePost(db, question.id, base.user.id);
    if (!first.ok) throw new Error(first.error);

    const second = deletePost(db, question.id, base.instructor.id);

    expect(second).toMatchObject({
      ok: true,
      comment: { deletedAt: first.comment.deletedAt },
    });
  });
});

describe("rateCourse", () => {
  it("records a first rating", () => {
    expect(rateCourse(db, base.user.id, base.course.id, 4)).toMatchObject({
      ok: true,
      rating: { userId: base.user.id, courseId: base.course.id, rating: 4 },
    });
  });

  it("changes a rating already given, keeping one per person", () => {
    const first = rateCourse(db, base.user.id, base.course.id, 4);
    const second = rateCourse(db, base.user.id, base.course.id, 2);

    if (!first.ok || !second.ok) throw new Error("rating failed");
    expect(second.rating.id).toBe(first.rating.id);
    expect(second.rating.rating).toBe(2);
  });

  it.each([0, 6, 2.5])("refuses a rating of %s", (rating) => {
    expect(rateCourse(db, base.user.id, base.course.id, rating)).toEqual({
      ok: false,
      status: 400,
      error: "Rating must be a whole number between 1 and 5",
    });
  });

  it("refuses a course that does not exist", () => {
    expect(rateCourse(db, base.user.id, 9999, 3)).toEqual({
      ok: false,
      status: 404,
      error: "Course not found",
    });
  });
});

describe("changeCourseStatus", () => {
  it("lets a Platform Admin change a course's status", () => {
    const admin = addUser("Pat", UserRole.Admin);

    expect(
      changeCourseStatus(db, base.course.id, admin.id, CourseStatus.Archived)
    ).toMatchObject({ ok: true, course: { status: CourseStatus.Archived } });
  });

  it("lets the course's Instructor change its status", () => {
    expect(
      changeCourseStatus(
        db,
        base.course.id,
        base.instructor.id,
        CourseStatus.Draft
      )
    ).toMatchObject({ ok: true, course: { status: CourseStatus.Draft } });
  });

  it("refuses anyone else", () => {
    const otherInstructor = addUser("Ivy", UserRole.Instructor);

    for (const userId of [base.user.id, otherInstructor.id]) {
      expect(
        changeCourseStatus(db, base.course.id, userId, CourseStatus.Draft)
      ).toEqual({
        ok: false,
        status: 403,
        error: "You can only edit your own courses.",
      });
    }
  });

  it("refuses a course that does not exist", () => {
    expect(
      changeCourseStatus(db, 9999, base.instructor.id, CourseStatus.Draft)
    ).toEqual({ ok: false, status: 404, error: "Course not found." });
  });
});
