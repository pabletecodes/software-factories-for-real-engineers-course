// PROTOTYPE: three throwaway Notification UX variants, switchable via ?variant=
// on every page in the app layout. Data is fake and in memory; arrivals are
// simulated from the switcher bar. Never ship. See the "Prototype the
// notification UX" wayfinder ticket.
//
//   A  Bell + dropdown   bell in the sidebar header, latest 20 in a popover,
//                        "View all" opens the full inbox page, quiet toast
//   B  Inbox drawer      sidebar nav item, right-hand sheet with Unread/All
//   C  Toasts + page     rich toast on arrival, bell opens a full inbox page
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Dialog, Popover } from "radix-ui";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Bell,
  CheckCheck,
  HelpCircle,
  Inbox,
  MessageSquare,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserRole } from "~/db/schema";

type Kind =
  | "reply"
  | "post_deleted"
  | "new_question"
  | "new_rating"
  | "course_status";

interface FakeNotification {
  id: number;
  kind: Kind;
  title: string;
  excerpt?: string;
  course: string;
  // null: nowhere sensible to go (e.g. the post is gone)
  href: string | null;
  minutesAgo: number;
  read: boolean;
}

const kindMeta: Record<Kind, { icon: typeof Bell; label: string; tint: string }> = {
  reply: { icon: MessageSquare, label: "Replies", tint: "text-blue-500" },
  post_deleted: { icon: Trash2, label: "Removed posts", tint: "text-red-500" },
  new_question: { icon: HelpCircle, label: "Questions", tint: "text-amber-500" },
  new_rating: { icon: Star, label: "Ratings", tint: "text-yellow-500" },
  course_status: { icon: ArrowRightLeft, label: "Course status", tint: "text-violet-500" },
};

const studentSeed: Omit<FakeNotification, "id">[] = [
  {
    kind: "reply",
    title: "Sarah Chen replied to your question",
    excerpt: "Good catch: `unknown` is safer than `any` there, because the compiler makes you narrow it first…",
    course: "Introduction to TypeScript",
    href: "/courses/introduction-to-typescript",
    minutesAgo: 4,
    read: false,
  },
  {
    kind: "reply",
    title: "James Park replied in a thread you posted in",
    excerpt: "Same problem here, the fix was to await the stream before closing the response.",
    course: "Building REST APIs with Node.js",
    href: "/courses/building-rest-apis-with-nodejs",
    minutesAgo: 38,
    read: false,
  },
  {
    kind: "post_deleted",
    title: "Your reply was removed by the course's Instructor",
    excerpt: "\"Here's my whole solution to the module 3 exercise, just copy it…\"",
    course: "Building REST APIs with Node.js",
    href: null,
    minutesAgo: 60 * 5,
    read: false,
  },
  {
    kind: "reply",
    title: "Marcus Johnson replied to your question",
    excerpt: "Colour scales should be perceptually uniform; try viridis.",
    course: "Practical Data Visualisation",
    href: "/courses/practical-data-visualisation",
    minutesAgo: 60 * 30,
    read: true,
  },
];

const instructorSeed: Omit<FakeNotification, "id">[] = [
  {
    kind: "new_question",
    title: "Emma Wilson asked a question",
    excerpt: "Why does narrowing stop working inside a callback?",
    course: "Introduction to TypeScript",
    href: "/instructor/questions",
    minutesAgo: 2,
    read: false,
  },
  {
    kind: "new_rating",
    title: "Olivia Martinez rated your course ★★★★☆",
    course: "Design Systems with Tailwind",
    href: "/instructor/3",
    minutesAgo: 25,
    read: false,
  },
  {
    kind: "reply",
    title: "Liam Thompson replied in a thread you posted in",
    excerpt: "Thanks! That cleared it up. Does the same apply to generics?",
    course: "Introduction to TypeScript",
    href: "/instructor/questions",
    minutesAgo: 90,
    read: false,
  },
  {
    kind: "course_status",
    title: "Alex Rivera moved your course from Published to Archived",
    course: "Design Systems with Tailwind",
    href: "/instructor/3",
    minutesAgo: 60 * 26,
    read: true,
  },
  {
    kind: "new_question",
    title: "James Park asked a question",
    excerpt: "Is there a way to share a type between client and server?",
    course: "Introduction to TypeScript",
    href: "/instructor/questions",
    minutesAgo: 60 * 50,
    read: true,
  },
];

const studentArrivals: Omit<FakeNotification, "id" | "minutesAgo" | "read">[] = [
  {
    kind: "reply",
    title: "Sarah Chen replied in a thread you posted in",
    excerpt: "Yes, `satisfies` keeps the literal types; `as` throws them away.",
    course: "Introduction to TypeScript",
    href: "/courses/introduction-to-typescript",
  },
  {
    kind: "post_deleted",
    title: "Your question was removed by a Platform Admin",
    excerpt: "\"Anyone want to split a Team Licence? DM me\"",
    course: "Design Systems with Tailwind",
    href: null,
  },
  {
    kind: "reply",
    title: "Olivia Martinez replied in a thread you posted in",
    excerpt: "I had the same error, check your Dockerfile WORKDIR.",
    course: "Building REST APIs with Node.js",
    href: "/courses/building-rest-apis-with-nodejs",
  },
];

const instructorArrivals: typeof studentArrivals = [
  {
    kind: "new_question",
    title: "Liam Thompson asked a question",
    excerpt: "How do I type an event emitter properly?",
    course: "Introduction to TypeScript",
    href: "/instructor/questions",
  },
  {
    kind: "new_rating",
    title: "Emma Wilson rated your course ★★★★★",
    course: "Introduction to TypeScript",
    href: "/instructor/1",
  },
  {
    kind: "course_status",
    title: "Alex Rivera moved your course from Archived to Published",
    course: "Design Systems with Tailwind",
    href: "/instructor/3",
  },
];

// Volume test: a realistic long history, mostly questions and ratings for an
// Instructor, mostly replies for a Student. Deterministic so reloads match.
const names = ["Emma Wilson", "James Park", "Olivia Martinez", "Liam Thompson", "Noah Kim", "Ava Patel", "Mia Rossi", "Lucas Silva", "Zoe Adams", "Ethan Brooks"];
const questions = [
  "Why does narrowing stop working inside a callback?",
  "Is there a way to share a type between client and server?",
  "How do I type an event emitter properly?",
  "What's the difference between `type` and `interface` here?",
  "The exercise in module 2 won't compile, what am I missing?",
  "Can you explain conditional types with a simpler example?",
  "How should I organise tokens for dark mode?",
  "Why is my `@apply` ignored in this component?",
];
const replies = [
  "Same here, it worked after restarting the TS server.",
  "I think the lesson covers that in the next module.",
  "Thanks! That cleared it up.",
  "Try `satisfies` instead of `as`, it keeps the literal types.",
  "Could you share your tsconfig?",
];
const instructorCourses = [
  { title: "Introduction to TypeScript", id: 1 },
  { title: "Design Systems with Tailwind", id: 3 },
];
const studentCourses = [
  { title: "Introduction to TypeScript", slug: "introduction-to-typescript" },
  { title: "Building REST APIs with Node.js", slug: "building-rest-apis-with-nodejs" },
  { title: "Practical Data Visualisation", slug: "practical-data-visualisation" },
];

function generateHistory(isInstructor: boolean, count: number): FakeNotification[] {
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const out: FakeNotification[] = [];
  // spread over ~90 days, newest first
  let minutesAgo = 3;
  for (let i = 0; i < count; i++) {
    minutesAgo += Math.floor(rand() * 260);
    const name = pick(names);
    const r = rand();
    let n: Omit<FakeNotification, "id" | "minutesAgo" | "read">;
    if (isInstructor) {
      const c = pick(instructorCourses);
      if (r < 0.5) {
        n = { kind: "new_question", title: `${name} asked a question`, excerpt: pick(questions), course: c.title, href: "/instructor/questions" };
      } else if (r < 0.85) {
        const stars = 3 + Math.floor(rand() * 3);
        n = { kind: "new_rating", title: `${name} rated your course ${"★".repeat(stars)}${"☆".repeat(5 - stars)}`, course: c.title, href: `/instructor/${c.id}` };
      } else {
        n = { kind: "reply", title: `${name} replied in a thread you posted in`, excerpt: pick(replies), course: c.title, href: "/instructor/questions" };
      }
    } else {
      const c = pick(studentCourses);
      if (r < 0.95) {
        n = { kind: "reply", title: `${name} replied in a thread you posted in`, excerpt: pick(replies), course: c.title, href: `/courses/${c.slug}` };
      } else {
        n = { kind: "post_deleted", title: "Your reply was removed by the course's Instructor", excerpt: `"${pick(replies)}"`, course: c.title, href: null };
      }
    }
    // the newest ~300 are mostly unread, older ones mostly read
    const read = i < 300 ? rand() < 0.15 : rand() < 0.97;
    out.push({ ...n, id: 100000 + i, minutesAgo, read });
  }
  return out;
}

function timeAgo(minutes: number) {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (60 * 24))}d ago`;
}

export function useFakeNotifications(role: UserRole | null) {
  const isInstructor = role === UserRole.Instructor;
  const [items, setItems] = useState<FakeNotification[]>([]);
  const [nextArrival, setNextArrival] = useState(0);
  const [lastArrivedId, setLastArrivedId] = useState<number | null>(null);

  useEffect(() => {
    const seed = isInstructor ? instructorSeed : studentSeed;
    setItems(seed.map((n, i) => ({ ...n, id: i + 1 })));
    setNextArrival(0);
  }, [isInstructor]);

  // Admins and signed-out visitors get no Notifications
  const enabled = role === UserRole.Student || role === UserRole.Instructor;

  function simulateArrival() {
    const pool = isInstructor ? instructorArrivals : studentArrivals;
    const n: FakeNotification = {
      ...pool[nextArrival % pool.length],
      id: Date.now(),
      minutesAgo: 0,
      read: false,
    };
    setNextArrival((i) => i + 1);
    setItems((prev) => [n, ...prev]);
    setLastArrivedId(n.id);
    return n;
  }

  return {
    enabled,
    items,
    unread: items.filter((n) => !n.read).length,
    lastArrivedId,
    markRead: (id: number) =>
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n))),
    markUnread: (id: number) =>
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n))),
    markAllRead: () => setItems((prev) => prev.map((n) => ({ ...n, read: true }))),
    remove: (id: number) => setItems((prev) => prev.filter((n) => n.id !== id)),
    simulateArrival,
    loadMany: (count: number) => setItems(generateHistory(isInstructor, count)),
  };
}

type Store = ReturnType<typeof useFakeNotifications>;

function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  const { icon: Icon, tint } = kindMeta[kind];
  return <Icon className={cn("size-4 shrink-0", tint, className)} />;
}

function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

// ─── Variant A: bell + dropdown ─────────────────────────────────────────────

const DROPDOWN_LIMIT = 20;

function inboxHref(searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams);
  params.set("inbox", "1");
  return `?${params}`;
}

function VariantAHeader({ store }: { store: Store }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(false);

  function openItem(n: FakeNotification) {
    store.markRead(n.id);
    setOpen(false);
    if (n.href) navigate(n.href);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="relative ml-auto rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          title="Notifications"
        >
          <Bell className="size-4" />
          <CountBadge count={store.unread} className="absolute -right-1 -top-1" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          className="z-50 w-96 rounded-lg border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              onClick={store.markAllRead}
              disabled={store.unread === 0}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          </div>
          <ul className="max-h-[28rem] overflow-y-auto">
            {store.items.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                You're all caught up.
              </li>
            )}
            {store.items.slice(0, DROPDOWN_LIMIT).map((n) => (
              <li
                key={n.id}
                className={cn(
                  "group relative flex cursor-pointer gap-3 border-b px-4 py-3 last:border-0 hover:bg-muted/60",
                  !n.read && "bg-blue-50/60 dark:bg-blue-950/20"
                )}
                onClick={() => openItem(n)}
              >
                <KindIcon kind={n.kind} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</div>
                  {n.excerpt && (
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.excerpt}</div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {n.course} · {timeAgo(n.minutesAgo)}
                  </div>
                </div>
                {/* one slot: the unread dot, swapped for delete × on hover */}
                <div className="flex w-5 shrink-0 justify-center">
                  {!n.read && (
                    <span className="mt-1.5 size-2 rounded-full bg-blue-500 group-hover:hidden" />
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      store.remove(n.id);
                    }}
                    title="Delete"
                    className="hidden h-fit rounded p-0.5 text-muted-foreground hover:bg-muted group-hover:block"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <Link
            to={inboxHref(searchParams)}
            onClick={() => setOpen(false)}
            className="block border-t px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-muted/60"
          >
            View all Notifications
            {store.items.length > DROPDOWN_LIMIT && ` (${store.items.length.toLocaleString()})`}
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Variant B: sidebar inbox drawer ────────────────────────────────────────

function VariantBNav({ store }: { store: Store }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const [limit, setLimit] = useState(30);
  const matching = tab === "unread" ? store.items.filter((n) => !n.read) : store.items;
  const shown = matching.slice(0, limit);
  const today = shown.filter((n) => n.minutesAgo < 60 * 24);
  const earlier = shown.filter((n) => n.minutesAgo >= 60 * 24);

  function Row({ n }: { n: FakeNotification }) {
    const fresh = n.id === store.lastArrivedId && !n.read;
    return (
      <div
        className={cn(
          "rounded-lg border p-3 transition-colors",
          fresh && "animate-pulse border-blue-400",
          !n.read ? "bg-card" : "bg-transparent opacity-70"
        )}
      >
        <div className="flex gap-3">
          <KindIcon kind={n.kind} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{n.title}</div>
            <div className="text-xs text-muted-foreground">
              {n.course} · {timeAgo(n.minutesAgo)}
            </div>
            {n.excerpt && (
              <blockquote className="mt-2 border-l-2 pl-2 text-xs text-muted-foreground">
                {n.excerpt}
              </blockquote>
            )}
          </div>
        </div>
        <div className="mt-2 flex gap-2 pl-7 text-xs">
          {n.href ? (
            <button
              className="rounded bg-primary px-2 py-1 text-primary-foreground"
              onClick={() => {
                store.markRead(n.id);
                setOpen(false);
                navigate(n.href!);
              }}
            >
              Open
            </button>
          ) : (
            <span className="rounded border border-dashed px-2 py-1 text-muted-foreground">
              Post no longer exists
            </span>
          )}
          <button
            className="rounded border px-2 py-1 hover:bg-muted"
            onClick={() => (n.read ? store.markUnread(n.id) : store.markRead(n.id))}
          >
            {n.read ? "Mark unread" : "Mark read"}
          </button>
          <button
            className="rounded border px-2 py-1 hover:bg-muted"
            onClick={() => store.remove(n.id)}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <Inbox className="size-4" />
          Notifications
          <CountBadge count={store.unread} className="ml-auto h-5 min-w-5 text-xs" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[28rem] flex-col border-l bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <Dialog.Title className="text-base font-semibold">Notifications</Dialog.Title>
            <Dialog.Close className="rounded p-1 hover:bg-muted">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="flex items-center gap-1 border-b px-5 py-2 text-sm">
            {(["unread", "all"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setLimit(30);
                }}
                className={cn(
                  "rounded-md px-3 py-1 capitalize",
                  tab === t ? "bg-muted font-medium" : "text-muted-foreground"
                )}
              >
                {t} {t === "unread" && `(${store.unread.toLocaleString()})`}
              </button>
            ))}
            <button
              onClick={store.markAllRead}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {shown.length === 0 && (
              <p className="py-16 text-center text-sm text-muted-foreground">Nothing here.</p>
            )}
            {today.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today</h3>
                {today.map((n) => <Row key={n.id} n={n} />)}
              </section>
            )}
            {earlier.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Earlier</h3>
                {earlier.map((n) => <Row key={n.id} n={n} />)}
              </section>
            )}
            {matching.length > shown.length && (
              <button
                onClick={() => setLimit((l) => l + 30)}
                className="w-full rounded-md border py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                Load more ({(matching.length - shown.length).toLocaleString()} left)
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Variant C: toasts + full inbox page ───────────────────────────────────

function VariantCHeader({ store }: { store: Store }) {
  const [searchParams] = useSearchParams();
  return (
    <Link
      to={inboxHref(searchParams)}
      className="relative ml-auto rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      title="Notifications"
    >
      <Bell className="size-4" />
      {store.unread > 0 && (
        <span className="absolute right-1 top-1 size-2 rounded-full bg-red-500" />
      )}
    </Link>
  );
}

const PAGE_SIZE = 50;

// The full Notifications page, used by variants A ("View all") and C
export function InboxPage({ store }: { store: Store }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const kinds = Array.from(new Set(store.items.map((n) => n.kind)));
  const countOf = (k: Kind | "all") =>
    store.items.filter((n) => (k === "all" || n.kind === k) && (!unreadOnly || !n.read)).length;
  const matching = store.items.filter(
    (n) => (filter === "all" || n.kind === filter) && (!unreadOnly || !n.read)
  );
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const shown = matching.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const allOnPageSelected = shown.length > 0 && shown.every((n) => selected.has(n.id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {store.unread.toLocaleString()} unread of {store.items.length.toLocaleString()}
          </p>
        </div>
        <button
          onClick={store.markAllRead}
          disabled={store.unread === 0}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
        >
          Mark all read
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setUnreadOnly((u) => !u);
            setPage(0);
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
            unreadOnly ? "border-blue-500 bg-blue-500 text-white" : "hover:bg-muted"
          )}
        >
          <span className={cn("size-2 rounded-full", unreadOnly ? "bg-white" : "bg-blue-500")} />
          Unread
          <span className="opacity-60">
            {store.items.filter((n) => !n.read && (filter === "all" || n.kind === filter)).length.toLocaleString()}
          </span>
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        {(["all", ...kinds] as const).map((k) => (
          <button
            key={k}
            onClick={() => {
              setFilter(k);
              setPage(0);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
              filter === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
            )}
          >
            {k !== "all" && <KindIcon kind={k} className={filter === k ? "text-current" : ""} />}
            {k === "all" ? "All" : kindMeta[k].label}
            <span className="opacity-60">{countOf(k).toLocaleString()}</span>
          </button>
        ))}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2">
              <input
                type="checkbox"
                title="Select this page"
                checked={allOnPageSelected}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    shown.forEach((n) => (allOnPageSelected ? next.delete(n.id) : next.add(n.id)));
                    return next;
                  })
                }
              />
            </th>
            <th colSpan={5} className="h-10 font-normal">
              {selected.size > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      selected.forEach(store.markRead);
                      setSelected(new Set());
                    }}
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-foreground hover:bg-muted"
                  >
                    <CheckCheck className="size-3.5" /> Mark as read
                  </button>
                  <button
                    onClick={() => {
                      selected.forEach(store.remove);
                      setSelected(new Set());
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-red-300 px-2.5 py-1 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </button>
                  <span className="ml-1">{selected.size.toLocaleString()}</span>
                </div>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((n) => (
            <tr key={n.id} className={cn("border-b", !n.read && "font-medium")}>
              <td className="w-8 py-3">
                <input
                  type="checkbox"
                  checked={selected.has(n.id)}
                  onChange={() => toggle(n.id)}
                />
              </td>
              <td className="w-6">
                {!n.read && <span className="block size-2 rounded-full bg-blue-500" />}
              </td>
              <td className="w-8">
                <KindIcon kind={n.kind} />
              </td>
              <td className="py-3 pr-4">
                <button
                  className={cn("text-left", n.href ? "hover:underline" : "cursor-default")}
                  onClick={() => {
                    store.markRead(n.id);
                    if (n.href) navigate(n.href);
                  }}
                >
                  {n.title}
                </button>
                {n.excerpt && (
                  <div className="truncate text-xs font-normal text-muted-foreground">
                    {n.excerpt}
                  </div>
                )}
              </td>
              <td className="w-56 truncate text-xs font-normal text-muted-foreground">{n.course}</td>
              <td className="w-20 text-right text-xs font-normal text-muted-foreground">
                {timeAgo(n.minutesAgo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && (
        <p className="py-16 text-center text-sm text-muted-foreground">No Notifications.</p>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {(page * PAGE_SIZE + 1).toLocaleString()}–
            {Math.min((page + 1) * PAGE_SIZE, matching.length).toLocaleString()} of{" "}
            {matching.length.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-40"
            >
              Newer
            </button>
            <span className="px-2 py-1.5 text-muted-foreground">
              Page {page + 1} of {pages}
            </span>
            <button
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-40"
            >
              Older
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Wiring ────────────────────────────────────────────────────────────────

export const notificationVariants = [
  { key: "A", name: "Bell + dropdown" },
  { key: "B", name: "Inbox drawer" },
  { key: "C", name: "Toasts + inbox page" },
];

export function notificationSlots(variant: string, store: Store) {
  if (!store.enabled) return {};
  if (variant === "B") return { nav: <VariantBNav store={store} /> };
  if (variant === "C") return { header: <VariantCHeader store={store} /> };
  return { header: <VariantAHeader store={store} /> };
}

// How a Notification announces itself when it arrives over SSE
export function announceArrival(variant: string, n: FakeNotification, navigate: (to: string) => void) {
  if (variant === "A") {
    toast(n.title, { description: n.course, duration: 3000 });
  }
  // B: no toast; the badge bumps and the new row pulses in the drawer
  if (variant === "C") {
    toast(n.title, {
      description: n.excerpt ?? n.course,
      duration: 8000,
      icon: <KindIcon kind={n.kind} />,
      action: n.href ? { label: "View", onClick: () => navigate(n.href!) } : undefined,
    });
  }
}
