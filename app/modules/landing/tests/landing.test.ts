import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus, UserRole } from "~/db/schema";
import { markdown } from "~/lib/text";
import { createLanding } from "../index.server";

let db: TestDb;
let instructor: typeof schema.users.$inferSelect;
let categoryId: number;
let baseCourse: typeof schema.courses.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  const base = seedBaseData(db);
  instructor = base.instructor;
  categoryId = base.category.id;
  baseCourse = base.course;
});

// ─── Fixtures ───
// No module writes courses, modules or lessons yet, so rows go in directly.
// Kept in one place so a schema change touches only this block.

let slugCounter = 0;

function addInstructor(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
      role: UserRole.Instructor,
    })
    .returning()
    .get();
}

function addCategory(name: string) {
  return db
    .insert(schema.categories)
    .values({ name, slug: name.toLowerCase() })
    .returning()
    .get();
}

function addCourse(
  title: string,
  options: {
    status?: CourseStatus;
    createdAt?: string;
    instructorId?: number;
    categoryId?: number;
  } = {}
) {
  slugCounter += 1;
  return db
    .insert(schema.courses)
    .values({
      title,
      slug: `course-${slugCounter}`,
      description: `${title} description`,
      salesCopy: markdown(title),
      instructorId: options.instructorId ?? instructor.id,
      categoryId: options.categoryId ?? categoryId,
      status: options.status ?? CourseStatus.Published,
      createdAt: options.createdAt,
    })
    .returning()
    .get();
}

function addLessons(courseId: number, lessonCount: number) {
  const mod = db
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  for (let position = 1; position <= lessonCount; position++) {
    db.insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${position}`, position })
      .run();
  }
}

function getLanding() {
  return createLanding(db).get();
}

describe("landing.get featured courses", () => {
  it("shows the three newest published courses, newest first", () => {
    db.update(schema.courses)
      .set({ createdAt: "2026-01-01T00:00:00.000Z" })
      .run();
    addCourse("February", { createdAt: "2026-02-01T00:00:00.000Z" });
    addCourse("April", { createdAt: "2026-04-01T00:00:00.000Z" });
    addCourse("March", { createdAt: "2026-03-01T00:00:00.000Z" });

    const titles = getLanding().featuredCourses.map((course) => course.title);

    expect(titles).toEqual(["April", "March", "February"]);
  });

  it("leaves out courses that are not published", () => {
    addCourse("Draft", { status: CourseStatus.Draft });
    addCourse("Archived", { status: CourseStatus.Archived });

    const titles = getLanding().featuredCourses.map((course) => course.title);

    expect(titles).toEqual([baseCourse.title]);
  });

  it("names each course's instructor and category", () => {
    const [course] = getLanding().featuredCourses;

    expect(course).toMatchObject({
      slug: baseCourse.slug,
      description: baseCourse.description,
      coverImageUrl: null,
      instructorName: "Test Instructor",
      categoryName: "Programming",
    });
  });

  it("counts each course's lessons across all its modules", () => {
    addLessons(baseCourse.id, 2);
    addLessons(baseCourse.id, 3);

    expect(getLanding().featuredCourses[0].lessonCount).toBe(5);
  });

  it("gives a course with no lessons a lesson count of zero", () => {
    expect(getLanding().featuredCourses[0].lessonCount).toBe(0);
  });

  it("is empty when nothing is published", () => {
    db.update(schema.courses).set({ status: CourseStatus.Draft }).run();

    expect(getLanding().featuredCourses).toEqual([]);
  });
});

describe("landing.get stats", () => {
  it("counts only published courses, and every one of them", () => {
    for (let i = 0; i < 4; i++) addCourse(`Published ${i}`);
    addCourse("Draft", { status: CourseStatus.Draft });

    expect(getLanding().stats.courses).toBe(5);
  });

  it("counts lessons in published courses only", () => {
    addLessons(baseCourse.id, 4);
    addLessons(addCourse("Draft", { status: CourseStatus.Draft }).id, 7);

    expect(getLanding().stats.lessons).toBe(4);
  });

  it("counts each instructor and category with a published course once", () => {
    const other = addInstructor("Olive Other");
    const design = addCategory("Design");
    addCourse("Second by same instructor");
    addCourse("By other", { instructorId: other.id, categoryId: design.id });
    addCourse("Draft", {
      status: CourseStatus.Draft,
      instructorId: addInstructor("Dee Draft").id,
      categoryId: addCategory("Unused").id,
    });

    const { stats } = getLanding();

    expect(stats.instructors).toBe(2);
    expect(stats.categories).toBe(2);
  });

  it("is all zeros when nothing is published", () => {
    db.update(schema.courses).set({ status: CourseStatus.Draft }).run();

    expect(getLanding().stats).toEqual({
      courses: 0,
      lessons: 0,
      instructors: 0,
      categories: 0,
    });
  });
});
