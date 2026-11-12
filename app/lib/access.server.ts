import { data } from "react-router";
import {
  AccessDenied,
  courseAccess,
  type Actor,
  type DenyReason,
} from "~/modules/course-access/index.server";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";

// The HTTP side of Course Access: reads the Request into an Actor, and turns
// an AccessDenied into a thrown 401/403. The rules live in the course-access
// module.

const DENIALS: Record<DenyReason, { status: 401 | 403; message: string }> = {
  "signed-out": { status: 401, message: "Select a user from the DevUI panel." },
  "not-enrolled": {
    status: 403,
    message: "You must be enrolled in this course.",
  },
  "ppp-blocked": {
    status: 403,
    message:
      "This course was bought at a discount for another country, so it can only be opened from there.",
  },
  "not-course-staff": {
    status: 403,
    message: "Only this course's instructor can do that.",
  },
  "not-instructor": {
    status: 403,
    message: "Only instructors can access this page.",
  },
  "not-platform-admin": {
    status: 403,
    message: "Only platform admins can access this page.",
  },
};

async function actorFrom(request: Request): Promise<Actor> {
  return {
    userId: await getCurrentUserId(request),
    country: await resolveCountry(request),
  };
}

async function asHttp<T>(
  request: Request,
  decide: (actor: Actor) => T
): Promise<T> {
  const actor = await actorFrom(request);
  try {
    return decide(actor);
  } catch (error) {
    if (!(error instanceof AccessDenied)) throw error;
    const { status, message } = DENIALS[error.reason];
    throw data(message, { status });
  }
}

/** The signed-in person's Course Access on a course. Never throws. */
export async function can(request: Request, courseId: number) {
  return courseAccess.can(await actorFrom(request), courseId);
}

export function mustSignIn(request: Request) {
  return asHttp(request, (actor) => courseAccess.mustSignIn(actor));
}

/** Use in actions too: loader guards don't protect actions. */
export function mustReadContent(request: Request, courseId: number) {
  return asHttp(request, (actor) =>
    courseAccess.mustReadContent(actor, courseId)
  );
}

export function mustSpeakForCourse(request: Request, courseId: number) {
  return asHttp(request, (actor) =>
    courseAccess.mustSpeakForCourse(actor, courseId)
  );
}

export function mustTeach(request: Request) {
  return asHttp(request, (actor) => courseAccess.mustTeach(actor));
}

export function mustRunPlatform(request: Request) {
  return asHttp(request, (actor) => courseAccess.mustRunPlatform(actor));
}
