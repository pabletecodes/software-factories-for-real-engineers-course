import { and, count, countDistinct, desc, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { courses, CourseStatus, lessons, modules, users } from "~/db/schema";

export type Db = BetterSQLite3Database<typeof schema>;

export type FeaturedCourse = {
  id: number;
  title: string;
  slug: string;
  description: string;
  coverImageUrl: string | null;
  instructorName: string;
  lessonCount: number;
};

export type LandingStats = {
  courses: number;
  lessons: number;
  instructors: number;
  categories: number;
};

export type LandingPage = {
  featuredCourses: FeaturedCourse[];
  stats: LandingStats;
};

const FEATURED_COURSE_COUNT = 3;

const isPublished = eq(courses.status, CourseStatus.Published);

function getFeaturedCourses(db: Db) {
  const newest = db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      description: courses.description,
      coverImageUrl: courses.coverImageUrl,
      instructorName: users.name,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .where(isPublished)
    .orderBy(desc(courses.createdAt), desc(courses.id))
    .limit(FEATURED_COURSE_COUNT)
    .all();

  const lessonCounts = getLessonCounts(
    db,
    newest.map((course) => course.id)
  );
  return newest.map((course) => ({
    ...course,
    lessonCount: lessonCounts.get(course.id) ?? 0,
  }));
}

function getLessonCounts(db: Db, courseIds: number[]) {
  const rows = db
    .select({ courseId: modules.courseId, lessonCount: count(lessons.id) })
    .from(modules)
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(inArray(modules.courseId, courseIds))
    .groupBy(modules.courseId)
    .all();
  return new Map(rows.map((row) => [row.courseId, row.lessonCount]));
}

function getStats(db: Db): LandingStats {
  const courseStats = db
    .select({
      courses: count(courses.id),
      instructors: countDistinct(courses.instructorId),
      categories: countDistinct(courses.categoryId),
    })
    .from(courses)
    .where(isPublished)
    .get();

  const lessonStats = db
    .select({ lessons: count(lessons.id) })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, and(eq(modules.courseId, courses.id), isPublished))
    .get();

  return {
    courses: courseStats?.courses ?? 0,
    instructors: courseStats?.instructors ?? 0,
    categories: courseStats?.categories ?? 0,
    lessons: lessonStats?.lessons ?? 0,
  };
}

export function getLandingPage(db: Db): LandingPage {
  return {
    featuredCourses: getFeaturedCourses(db),
    stats: getStats(db),
  };
}
