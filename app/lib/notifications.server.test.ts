import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { postComment } from "./notifications.server";

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
