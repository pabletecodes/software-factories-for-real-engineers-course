import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { enrollStudent } from "~/lib/enrollments.server";
import {
  approveRefundRequest,
  raiseRefundRequest,
} from "~/lib/refunds.server";
import { claimSeat } from "~/lib/seat-claims.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import {
  AccessDenied,
  createCourseAccess,
  type Actor,
} from "../index.server";

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const DAY_MS = 86_400_000;
const MISSING_COURSE_ID = 9999;

let db: TestDb;
let access: ReturnType<typeof createCourseAccess>;
let student: typeof schema.users.$inferSelect;
let instructor: typeof schema.users.$inferSelect;
let otherInstructor: typeof schema.users.$inferSelect;
let platformAdmin: typeof schema.users.$inferSelect;
let course: typeof schema.courses.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  const base = seedBaseData(db);
  student = base.user;
  instructor = base.instructor;
  otherInstructor = addUser("Olive Other", UserRole.Instructor);
  platformAdmin = addUser("Pat Admin", UserRole.Admin);
  course = db
    .update(schema.courses)
    .set({ price: 10000, pppEnabled: true })
    .where(eq(schema.courses.id, base.course.id))
    .returning()
    .get();
  access = createCourseAccess(db);
});

// ─── Fixtures ───
// Purchases have no service that writes them, so those rows go in directly.
// Enrollments, Seats and Refund Requests go through their own services.

function addUser(name: string, role = UserRole.Student) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
      role,
    })
    .returning()
    .get();
}

function from(userId: number | null, country: string | null = "US"): Actor {
  return { userId, country };
}

function addPurchase(userId: number, country: string, daysAgo = 0) {
  return db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: course.id,
      amountPaid: 5000,
      country,
      createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(),
    })
    .returning()
    .get();
}

async function buyFor(userId: number, country: string, daysAgo = 0) {
  const purchase = addPurchase(userId, country, daysAgo);
  await enrollStudent(db, userId, course.id, NOW, fakeNotifications());
  return purchase;
}

function buyTeamLicence(teamAdminId: number, country: string) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = addPurchase(teamAdminId, country);
  return db
    .insert(schema.coupons)
    .values({
      teamId: team.id,
      courseId: course.id,
      code: `SEAT-${purchase.id}`,
      purchaseId: purchase.id,
    })
    .returning()
    .get();
}

async function refund(purchase: typeof schema.purchases.$inferSelect) {
  const raised = await raiseRefundRequest(
    db,
    purchase.id,
    purchase.userId,
    "Changed my mind",
    NOW,
    fakeNotifications()
  );
  if (!raised.ok) throw new Error(raised.error);
  const approved = await approveRefundRequest(
    db,
    raised.refundRequestId,
    platformAdmin.id,
    null,
    NOW,
    fakeNotifications()
  );
  if (!approved.ok) throw new Error(approved.error);
}

function denial(decide: () => unknown) {
  try {
    decide();
  } catch (error) {
    if (error instanceof AccessDenied) return error.reason;
    throw error;
  }
  return "allowed";
}

describe("can", () => {
  it("gives a signed-out Actor nothing", () => {
    expect(access.can(from(null), course.id)).toEqual({
      userId: null,
      readContent: false,
      speakForCourse: false,
      takingCourse: false,
      pppBlock: null,
    });
  });

  it("treats a user who no longer exists as signed out", () => {
    expect(access.can(from(12345), course.id).userId).toBeNull();
  });

  it("gives a Student without an Enrollment no Course Access", () => {
    expect(access.can(from(student.id), course.id)).toMatchObject({
      userId: student.id,
      readContent: false,
      takingCourse: false,
    });
  });

  it("lets an enrolled Student take the course", async () => {
    await buyFor(student.id, "US");

    expect(access.can(from(student.id), course.id)).toMatchObject({
      readContent: true,
      speakForCourse: false,
      takingCourse: true,
      pppBlock: null,
    });
  });

  it("gives Course Staff Course Access without an Enrollment", () => {
    for (const person of [instructor, platformAdmin]) {
      expect(access.can(from(person.id), course.id)).toMatchObject({
        readContent: true,
        speakForCourse: true,
        takingCourse: false,
      });
    }
  });

  it("does not let another Instructor speak for the course", () => {
    expect(access.can(from(otherInstructor.id), course.id)).toMatchObject({
      readContent: false,
      speakForCourse: false,
    });
  });

  it("gives no Course Access on a course that doesn't exist", () => {
    expect(access.can(from(platformAdmin.id), MISSING_COURSE_ID)).toMatchObject(
      { readContent: false, speakForCourse: false }
    );
  });

  describe("the PPP country check", () => {
    it("blocks a discounted Purchase opened from another country", async () => {
      await buyFor(student.id, "IN");

      expect(access.can(from(student.id, "GB"), course.id)).toMatchObject({
        readContent: false,
        takingCourse: false,
        pppBlock: { here: "GB", boughtIn: "IN" },
      });
    });

    it("lets a discounted Purchase play in the country it was bought in", async () => {
      await buyFor(student.id, "IN");

      expect(access.can(from(student.id, "IN"), course.id).takingCourse).toBe(
        true
      );
    });

    it("does not block when the country is unknown", async () => {
      await buyFor(student.id, "IN");

      expect(access.can(from(student.id, null), course.id).pppBlock).toBeNull();
    });

    it("does not block on a course with PPP turned off", async () => {
      db.update(schema.courses)
        .set({ pppEnabled: false })
        .where(eq(schema.courses.id, course.id))
        .run();
      await buyFor(student.id, "IN");

      expect(access.can(from(student.id, "GB"), course.id).pppBlock).toBeNull();
    });

    it("ignores a refunded discounted Purchase once the Student buys again", async () => {
      await refund(await buyFor(student.id, "IN", 1));
      await buyFor(student.id, "US");

      expect(access.can(from(student.id, "GB"), course.id)).toMatchObject({
        takingCourse: true,
        pppBlock: null,
      });
    });

    it("ignores a Team Licence the Student bought for others", async () => {
      await buyFor(student.id, "US", 1);
      buyTeamLicence(student.id, "IN");

      expect(access.can(from(student.id, "GB"), course.id).pppBlock).toBeNull();
    });

    it("exempts a Student who holds a Claimed Seat", async () => {
      const teamAdmin = addUser("Tess Admin");
      const seat = buyTeamLicence(teamAdmin.id, "US");
      await claimSeat(db, seat.code, student.id, "US", NOW, fakeNotifications());
      addPurchase(student.id, "IN");

      expect(access.can(from(student.id, "GB"), course.id)).toMatchObject({
        takingCourse: true,
        pppBlock: null,
      });
    });

    it("exempts Course Staff", async () => {
      await buyFor(platformAdmin.id, "IN");

      expect(access.can(from(platformAdmin.id, "GB"), course.id)).toMatchObject({
        readContent: true,
        takingCourse: true,
        pppBlock: null,
      });
    });
  });
});

describe("mustSignIn", () => {
  it("returns who is signed in", () => {
    expect(access.mustSignIn(from(student.id))).toEqual({ userId: student.id });
  });

  it("denies a signed-out Actor, or one whose user no longer exists", () => {
    expect(denial(() => access.mustSignIn(from(null)))).toBe("signed-out");
    expect(denial(() => access.mustSignIn(from(12345)))).toBe("signed-out");
  });
});

describe("mustReadContent", () => {
  it("returns who is reading and whether they speak for the course", async () => {
    await buyFor(student.id, "US");

    expect(access.mustReadContent(from(student.id), course.id)).toEqual({
      userId: student.id,
      speakForCourse: false,
    });
    expect(access.mustReadContent(from(instructor.id), course.id)).toEqual({
      userId: instructor.id,
      speakForCourse: true,
    });
  });

  it("says why it denies", async () => {
    expect(denial(() => access.mustReadContent(from(null), course.id))).toBe(
      "signed-out"
    );
    expect(
      denial(() => access.mustReadContent(from(student.id), course.id))
    ).toBe("not-enrolled");

    await buyFor(student.id, "IN");
    expect(
      denial(() => access.mustReadContent(from(student.id, "GB"), course.id))
    ).toBe("ppp-blocked");
  });
});

describe("mustSpeakForCourse", () => {
  it("lets in the course's own Instructor and any Platform Admin", () => {
    expect(access.mustSpeakForCourse(from(instructor.id), course.id)).toEqual({
      userId: instructor.id,
      isPlatformAdmin: false,
    });
    expect(
      access.mustSpeakForCourse(from(platformAdmin.id), course.id)
    ).toEqual({ userId: platformAdmin.id, isPlatformAdmin: true });
  });

  it("denies everyone else", async () => {
    await buyFor(student.id, "US");

    expect(denial(() => access.mustSpeakForCourse(from(null), course.id))).toBe(
      "signed-out"
    );
    expect(
      denial(() => access.mustSpeakForCourse(from(student.id), course.id))
    ).toBe("not-course-staff");
    expect(
      denial(() =>
        access.mustSpeakForCourse(from(otherInstructor.id), course.id)
      )
    ).toBe("not-course-staff");
    expect(
      denial(() =>
        access.mustSpeakForCourse(from(platformAdmin.id), MISSING_COURSE_ID)
      )
    ).toBe("not-course-staff");
  });
});

describe("mustTeach", () => {
  it("lets in Instructors and Platform Admins", () => {
    expect(access.mustTeach(from(otherInstructor.id))).toEqual({
      userId: otherInstructor.id,
      isPlatformAdmin: false,
    });
    expect(access.mustTeach(from(platformAdmin.id))).toEqual({
      userId: platformAdmin.id,
      isPlatformAdmin: true,
    });
  });

  it("denies Students", () => {
    expect(denial(() => access.mustTeach(from(student.id)))).toBe(
      "not-instructor"
    );
  });
});

describe("mustRunPlatform", () => {
  it("lets in only Platform Admins", () => {
    expect(access.mustRunPlatform(from(platformAdmin.id))).toEqual({
      userId: platformAdmin.id,
    });
    expect(denial(() => access.mustRunPlatform(from(instructor.id)))).toBe(
      "not-platform-admin"
    );
  });
});
