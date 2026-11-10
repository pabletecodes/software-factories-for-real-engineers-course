import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { courses, enrollments, purchases, users, UserRole } from "~/db/schema";
import { checkPppAccess } from "~/lib/ppp";

// ─── Course access rules ───
// The one answer to "what may this user do with this course?". `getAccess`
// (access.server.ts) wraps it for a request; the Notifications module calls it
// directly when a click is resolved.
//
// Takes the database first, so tests can hand in an in-memory one. Uses
// positional parameters (project convention).

type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

type User = typeof users.$inferSelect;

export type CourseAccess = {
  user: User;
  isAdmin: boolean;
  /** The instructor who owns this specific course. */
  isOwningInstructor: boolean;
  /** Owning instructor or admin — the people who speak for the course. */
  isStaff: boolean;
  enrolled: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  /**
   * May they read the course's content (lesson bodies, comments)?
   * Staff always can. Students need an enrollment that isn't PPP-blocked.
   */
  canViewContent: boolean;
};

/**
 * What a user may do with a course. `country` is where they are now, as
 * `resolveCountry` gives it, for the PPP check. Returns undefined when the
 * user does not exist.
 */
export function resolveCourseAccess(
  db: Queryable,
  userId: number,
  courseId: number,
  country: string | null
): CourseAccess | undefined {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return undefined;

  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  const isAdmin = user.role === UserRole.Admin;
  const isOwningInstructor = course?.instructorId === userId;
  const isStaff = isAdmin || isOwningInstructor;
  const enrolled =
    db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
      )
      .get() !== undefined;

  // PPP only restricts students who bought at a discount — staff are exempt.
  let ppp = {
    blocked: false,
    blockedCountry: null as string | null,
    purchaseCountry: null as string | null,
  };

  if (enrolled && !isStaff && course) {
    const purchase = db
      .select({ country: purchases.country })
      .from(purchases)
      .where(
        and(eq(purchases.userId, userId), eq(purchases.courseId, courseId))
      )
      .get();
    ppp = checkPppAccess(
      course.price,
      course.pppEnabled,
      purchase?.country ?? null,
      country
    );
  }

  return {
    user,
    isAdmin,
    isOwningInstructor,
    isStaff,
    enrolled,
    pppBlocked: ppp.blocked,
    pppBlockedCountry: ppp.blockedCountry,
    pppPurchaseCountry: ppp.purchaseCountry,
    canViewContent: isStaff || (enrolled && !ppp.blocked),
  };
}
