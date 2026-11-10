import { useEffect } from "react";
import { Outlet, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/layout.app";
import { Sidebar } from "~/components/sidebar";
import { DevUI } from "~/components/dev-ui";
import { Toaster } from "sonner";
import { PrototypeSwitcher } from "~/components/prototype-switcher";
import {
  useFakeNotifications,
  notificationSlots,
  notificationVariants,
  announceArrival,
  InboxPage,
} from "~/components/notifications-prototype";
import { getCurrentUserId, getDevCountry } from "~/lib/session";
import { getCountryTierInfo, COUNTRIES } from "~/lib/ppp";
import { eq, and, or, sql, desc } from "drizzle-orm";
import { db } from "~/db";
import {
  users,
  courses,
  modules,
  lessons,
  lessonProgress,
  teams,
  teamMembers,
  TeamMemberRole,
  LessonProgressStatus,
} from "~/db/schema";

function getAllUsers() {
  return db.select().from(users).all();
}

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

function getTeamForAdmin(userId: number) {
  const membership = db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();

  if (!membership) return undefined;

  return db.select().from(teams).where(eq(teams.id, membership.teamId)).get();
}

function isTeamAdmin(userId: number) {
  return !!getTeamForAdmin(userId);
}

function getCourseLessonIds(courseId: number): number[] {
  const courseModules = db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .all();

  if (courseModules.length === 0) return [];

  const courseLessons = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(or(...courseModules.map((m) => eq(lessons.moduleId, m.id)))!)
    .all();

  return courseLessons.map((l) => l.id);
}

function calculateProgress(
  userId: number,
  courseId: number,
  weightByDuration: boolean
) {
  const lessonIds = getCourseLessonIds(courseId);

  if (lessonIds.length === 0) return 0;

  if (weightByDuration) {
    const courseLessons = db
      .select({
        id: lessons.id,
        durationMinutes: lessons.durationMinutes,
      })
      .from(lessons)
      .where(or(...lessonIds.map((id) => eq(lessons.id, id)))!)
      .all();

    const totalDuration = courseLessons.reduce(
      (sum, l) => sum + (l.durationMinutes ?? 1),
      0
    );

    if (totalDuration === 0) return 0;

    const completed = db
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
        )
      )
      .all();

    const completedIds = new Set(completed.map((p) => p.lessonId));

    const completedDuration = courseLessons
      .filter((l) => completedIds.has(l.id))
      .reduce((sum, l) => sum + (l.durationMinutes ?? 1), 0);

    return Math.round((completedDuration / totalDuration) * 100);
  }

  const completedCount = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
      )
    )
    .get();

  return Math.round(((completedCount?.count ?? 0) / lessonIds.length) * 100);
}

function getCompletedLessonCount(userId: number, courseId: number) {
  const lessonIds = getCourseLessonIds(courseId);
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
      )
    )
    .get();

  return result?.count ?? 0;
}

function getTotalLessonCount(courseId: number) {
  return getCourseLessonIds(courseId).length;
}

function getRecentlyProgressedCourses(userId: number, limit: number = 3) {
  return db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      coverImageUrl: courses.coverImageUrl,
      lastActivityId: sql<number>`max(${lessonProgress.id})`,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessonProgress.userId, userId))
    .groupBy(courses.id)
    .orderBy(desc(sql`max(${lessonProgress.id})`))
    .limit(limit)
    .all();
}

export async function loader({ request }: Route.LoaderArgs) {
  const users = getAllUsers();
  const currentUserId = await getCurrentUserId(request);
  const currentUser = currentUserId ? getUserById(currentUserId) : null;
  const devCountry = await getDevCountry(request);
  const countryTierInfo = getCountryTierInfo(devCountry);

  const recentCourses = currentUserId
    ? getRecentlyProgressedCourses(currentUserId).map((course) => {
        const completedLessons = getCompletedLessonCount(
          currentUserId,
          course.courseId
        );
        const totalLessons = getTotalLessonCount(course.courseId);
        const progress = calculateProgress(currentUserId, course.courseId, false);
        return {
          courseId: course.courseId,
          title: course.courseTitle,
          slug: course.courseSlug,
          coverImageUrl: course.coverImageUrl,
          completedLessons,
          totalLessons,
          progress,
        };
      })
    : [];

  return {
    users: users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    currentUser: currentUser
      ? {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role,
          avatarUrl: currentUser.avatarUrl ?? null,
        }
      : null,
    recentCourses,
    devCountry,
    countryTierInfo,
    countries: COUNTRIES,
    isTeamAdmin: currentUserId ? isTeamAdmin(currentUserId) : false,
  };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const {
    users,
    currentUser,
    recentCourses,
    devCountry,
    countryTierInfo,
    countries,
    isTeamAdmin: userIsTeamAdmin,
  } = loaderData;

  // PROTOTYPE: notification UX variants. Variant sticks across navigation via
  // sessionStorage so following a Notification's link keeps the variant.
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const variant = searchParams.get("variant") ?? "A";
  const inboxOpen = variant !== "B" && searchParams.get("inbox") === "1";
  const notifications = useFakeNotifications(currentUser?.role ?? null);
  const slots = notificationSlots(variant, notifications);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("notif-proto-variant");
      if (!searchParams.get("variant") && stored && stored !== "A") {
        const params = new URLSearchParams(searchParams);
        params.set("variant", stored);
        setSearchParams(params, { replace: true });
      } else if (searchParams.get("variant")) {
        sessionStorage.setItem("notif-proto-variant", variant);
      }
    } catch {}
  }, [searchParams]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        currentUser={currentUser}
        recentCourses={recentCourses}
        isTeamAdmin={userIsTeamAdmin}
        headerSlot={slots.header}
        navSlot={slots.nav}
      />
      <main className="flex-1 overflow-y-auto">
        {inboxOpen ? <InboxPage store={notifications} /> : <Outlet />}
      </main>
      <DevUI
        users={users}
        currentUser={currentUser}
        devCountry={devCountry}
        countryTierInfo={countryTierInfo}
        countries={countries}
      />
      <Toaster position="bottom-right" richColors closeButton />
      <PrototypeSwitcher variants={notificationVariants} current={variant}>
        {notifications.enabled && (
          <button
            onClick={() =>
              announceArrival(variant, notifications.simulateArrival(), navigate)
            }
            className="ml-1 rounded-full bg-fuchsia-500 px-3 py-0.5 text-xs font-semibold hover:bg-fuchsia-400"
          >
            Simulate arrival
          </button>
        )}
        {notifications.enabled && (
          <button
            onClick={() => notifications.loadMany(1000)}
            className="rounded-full bg-amber-500 px-3 py-0.5 text-xs font-semibold text-zinc-900 hover:bg-amber-400"
          >
            Load 1,000
          </button>
        )}
      </PrototypeSwitcher>
    </div>
  );
}
