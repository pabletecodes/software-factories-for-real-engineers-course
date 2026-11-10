import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { comments, courses, lessons, modules } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";

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
