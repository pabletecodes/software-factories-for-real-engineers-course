import { and, desc, eq, isNotNull, notExists } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  RefundStatus,
  UserRole,
  coupons,
  courses,
  enrollments,
  purchases,
  refunds,
  users,
} from "~/db/schema";
import { checkPppAccess } from "~/lib/ppp";

export type Db = BetterSQLite3Database<typeof schema>;

/** Whoever is acting: signed in or not, from wherever they are right now. */
export type Actor = { userId: number | null; country: string | null };

/** A discounted Purchase made in `boughtIn`, opened from `here`. */
export type PppBlock = { here: string; boughtIn: string };

export type CourseAccess = {
  userId: number | null;
  readContent: boolean;
  speakForCourse: boolean;
  /** An Enrollment that isn't PPP-blocked: the Student is taking the course. */
  takingCourse: boolean;
  pppBlock: PppBlock | null;
};

export type DenyReason =
  | "signed-out"
  | "not-enrolled"
  | "ppp-blocked"
  | "not-course-staff"
  | "not-instructor"
  | "not-platform-admin";

export class AccessDenied extends Error {
  constructor(readonly reason: DenyReason) {
    super(`Access denied: ${reason}`);
    this.name = "AccessDenied";
  }
}

type Person = typeof users.$inferSelect;
type Course = typeof courses.$inferSelect;

const NO_ACCESS: CourseAccess = {
  userId: null,
  readContent: false,
  speakForCourse: false,
  takingCourse: false,
  pppBlock: null,
};

function findPerson(db: Db, actor: Actor): Person | undefined {
  if (actor.userId === null) return undefined;
  return db.select().from(users).where(eq(users.id, actor.userId)).get();
}

function findCourse(db: Db, courseId: number): Course | undefined {
  return db.select().from(courses).where(eq(courses.id, courseId)).get();
}

function isPlatformAdmin(person: Person) {
  return person.role === UserRole.Admin;
}

function isCourseStaff(person: Person, course: Course | undefined) {
  if (!course) return false;
  return isPlatformAdmin(person) || course.instructorId === person.id;
}

function isEnrolled(db: Db, personId: number, courseId: number) {
  return !!db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, personId), eq(enrollments.courseId, courseId))
    )
    .get();
}

function holdsClaimedSeat(db: Db, personId: number, courseId: number) {
  return !!db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(
        eq(coupons.redeemedByUserId, personId),
        eq(coupons.courseId, courseId),
        isNotNull(coupons.redeemedAt)
      )
    )
    .get();
}

// A Team Licence is the Purchase that granted Seats; an Individual Purchase
// granted none. See docs/adr/0013.
function findLatestLiveIndividualPurchase(
  db: Db,
  personId: number,
  courseId: number
) {
  return db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, personId),
        eq(purchases.courseId, courseId),
        notExists(
          db
            .select({ id: coupons.id })
            .from(coupons)
            .where(eq(coupons.purchaseId, purchases.id))
        ),
        notExists(
          db
            .select({ id: refunds.id })
            .from(refunds)
            .where(
              and(
                eq(refunds.purchaseId, purchases.id),
                eq(refunds.status, RefundStatus.Approved)
              )
            )
        )
      )
    )
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .get();
}

function findPppBlock(
  db: Db,
  person: Person,
  course: Course,
  here: string | null
): PppBlock | null {
  if (holdsClaimedSeat(db, person.id, course.id)) return null;

  const purchase = findLatestLiveIndividualPurchase(db, person.id, course.id);
  const check = checkPppAccess(
    course.price,
    course.pppEnabled,
    purchase?.country ?? null,
    here
  );
  if (!check.blocked || !check.blockedCountry || !check.purchaseCountry) {
    return null;
  }
  return { here: check.blockedCountry, boughtIn: check.purchaseCountry };
}

export function can(db: Db, actor: Actor, courseId: number): CourseAccess {
  const person = findPerson(db, actor);
  if (!person) return NO_ACCESS;

  const course = findCourse(db, courseId);
  const speakForCourse = isCourseStaff(person, course);
  const enrolled = !!course && isEnrolled(db, person.id, courseId);

  // Course Staff are exempt from the country check (docs/adr/0009).
  const pppBlock =
    course && enrolled && !speakForCourse
      ? findPppBlock(db, person, course, actor.country)
      : null;
  const takingCourse = enrolled && !pppBlock;

  return {
    userId: person.id,
    readContent: speakForCourse || takingCourse,
    speakForCourse,
    takingCourse,
    pppBlock,
  };
}

function mustBeSignedIn(db: Db, actor: Actor): Person {
  const person = findPerson(db, actor);
  if (!person) throw new AccessDenied("signed-out");
  return person;
}

export function mustSignIn(db: Db, actor: Actor) {
  return { userId: mustBeSignedIn(db, actor).id };
}

export function mustReadContent(db: Db, actor: Actor, courseId: number) {
  const access = can(db, actor, courseId);
  if (access.userId === null) throw new AccessDenied("signed-out");
  if (!access.readContent) {
    throw new AccessDenied(access.pppBlock ? "ppp-blocked" : "not-enrolled");
  }
  return { userId: access.userId, speakForCourse: access.speakForCourse };
}

export function mustSpeakForCourse(db: Db, actor: Actor, courseId: number) {
  const person = mustBeSignedIn(db, actor);
  if (!isCourseStaff(person, findCourse(db, courseId))) {
    throw new AccessDenied("not-course-staff");
  }
  return { userId: person.id, isPlatformAdmin: isPlatformAdmin(person) };
}

export function mustTeach(db: Db, actor: Actor) {
  const person = mustBeSignedIn(db, actor);
  if (person.role !== UserRole.Instructor && !isPlatformAdmin(person)) {
    throw new AccessDenied("not-instructor");
  }
  return { userId: person.id, isPlatformAdmin: isPlatformAdmin(person) };
}

export function mustRunPlatform(db: Db, actor: Actor) {
  const person = mustBeSignedIn(db, actor);
  if (!isPlatformAdmin(person)) throw new AccessDenied("not-platform-admin");
  return { userId: person.id };
}
