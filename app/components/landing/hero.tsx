import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "~/components/ui/button";
import { CourseImage } from "~/components/course-image";
import type { FeaturedCourse } from "~/modules/landing/index.server";

export function LandingHero({
  courseCount,
  covers,
  isSignedIn,
}: {
  courseCount: number;
  covers: FeaturedCourse[];
  isSignedIn: boolean;
}) {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-16 px-6 py-20 lg:grid-cols-[1.1fr_1fr] lg:py-28">
      <div>
        {courseCount > 0 && (
          <p className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm text-muted-foreground">
            <span className="size-2 rounded-full bg-chart-1" />
            {courseCount} self-paced {courseCount === 1 ? "course" : "courses"},
            open now
          </p>
        )}
        <h1 className="mt-6 text-5xl font-bold tracking-tight sm:text-6xl">
          Learn to code,
          <br />
          <span className="text-muted-foreground">at your own pace</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Structured courses built by experienced instructors. Track your
          progress, take quizzes, and build real-world skills.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Button asChild size="lg">
            <Link to="/courses">
              Browse Courses
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            {isSignedIn ? (
              <Link to="/dashboard">Go to your dashboard</Link>
            ) : (
              <Link to="/signup">Create a free account</Link>
            )}
          </Button>
        </div>
      </div>
      {covers.length > 0 && <CoverStack covers={covers} />}
    </section>
  );
}

const STACK_POSITIONS = [
  "left-0 top-0 z-30 -rotate-3",
  "right-0 top-16 z-20 rotate-3",
  "bottom-0 left-12 z-10 -rotate-1",
];

function CoverStack({ covers }: { covers: FeaturedCourse[] }) {
  return (
    <div className="relative hidden h-96 lg:block" aria-hidden="true">
      {covers.slice(0, STACK_POSITIONS.length).map((course, index) => (
        <div
          key={course.id}
          className={`absolute w-72 overflow-hidden rounded-xl border border-border bg-card shadow-lg ${STACK_POSITIONS[index]}`}
        >
          <CourseImage
            src={course.coverImageUrl}
            alt=""
            className="aspect-video w-full object-cover"
          />
          <p className="truncate px-4 py-3 text-sm font-medium">
            {course.title}
          </p>
        </div>
      ))}
    </div>
  );
}
