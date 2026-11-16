import { BookOpen, GraduationCap, Layers, PlayCircle } from "lucide-react";
import type { LandingStats } from "~/modules/landing/index.server";

export function LandingStatsStrip({ stats }: { stats: LandingStats }) {
  const items = [
    { icon: BookOpen, value: stats.courses, label: "Published courses" },
    { icon: PlayCircle, value: stats.lessons, label: "Lessons" },
    { icon: GraduationCap, value: stats.instructors, label: "Instructors" },
    { icon: Layers, value: stats.categories, label: "Categories" },
  ];

  return (
    <section className="border-y border-border bg-muted/50">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 sm:grid-cols-4">
        {items.map(({ icon: Icon, value, label }) => (
          <div key={label} className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="size-6 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-sm text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
