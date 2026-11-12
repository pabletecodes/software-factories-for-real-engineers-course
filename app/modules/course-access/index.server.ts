import { db } from "~/db";
import {
  can,
  mustReadContent,
  mustRunPlatform,
  mustSignIn,
  mustSpeakForCourse,
  mustTeach,
  type Actor,
  type Db,
} from "./lib/course-access";

export {
  AccessDenied,
  type Actor,
  type CourseAccess,
  type DenyReason,
  type PppBlock,
} from "./lib/course-access";

/**
 * Course Access bound to a database. The app uses `courseAccess`, which reads
 * the app database; tests build their own against a test database.
 *
 * Every `must*` call throws `AccessDenied` with a reason, or returns who the
 * Actor is. A signed-in Actor whose user no longer exists counts as signed
 * out. A course that doesn't exist gives no Course Access: look it up first
 * if you need a 404.
 */
export function createCourseAccess(database: Db) {
  return {
    /** The Actor's Course Access on a course. Never throws. */
    can(actor: Actor, courseId: number) {
      return can(database, actor, courseId);
    },
    mustSignIn(actor: Actor) {
      return mustSignIn(database, actor);
    },
    /** Course Staff, or a Student taking the course from the right country. */
    mustReadContent(actor: Actor, courseId: number) {
      return mustReadContent(database, actor, courseId);
    },
    /** The course's own Instructor, or any Platform Admin. */
    mustSpeakForCourse(actor: Actor, courseId: number) {
      return mustSpeakForCourse(database, actor, courseId);
    },
    /** Any Instructor, or any Platform Admin. */
    mustTeach(actor: Actor) {
      return mustTeach(database, actor);
    },
    mustRunPlatform(actor: Actor) {
      return mustRunPlatform(database, actor);
    },
  };
}

// Pure so a route importing this only for its loader doesn't pull the
// database into the client bundle (see `~/db`).
export const courseAccess = /* @__PURE__ */ createCourseAccess(db);
