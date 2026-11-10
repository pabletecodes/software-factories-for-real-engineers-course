import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate, useRevalidator } from "react-router";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Bell,
  HelpCircle,
  MessageSquare,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { NotificationKind } from "~/db/schema";
import type { ClickTarget, NotificationView } from "~/lib/notifications.server";
import type { Nudge } from "~/lib/notification-push.server";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn, formatRelativeTime } from "~/lib/utils";

// The bell in the sidebar header and its dropdown of the latest Notifications
// (Variant A on the prototype/notification-ux branch). Its data comes from the
// app layout's loader, so it refreshes whenever loaders revalidate.

export type NotificationBellData = {
  unreadCount: number;
  latest: NotificationView[];
};

/** The icon, its tint and the plural label of each kind of Notification. */
export const notificationKindMeta: Record<
  NotificationKind,
  { icon: LucideIcon; tint: string; label: string }
> = {
  [NotificationKind.Reply]: {
    icon: MessageSquare,
    tint: "text-blue-500",
    label: "Replies",
  },
  [NotificationKind.PostDeleted]: {
    icon: Trash2,
    tint: "text-red-500",
    label: "Removed posts",
  },
  [NotificationKind.NewQuestion]: {
    icon: HelpCircle,
    tint: "text-amber-500",
    label: "Questions",
  },
  [NotificationKind.NewRating]: {
    icon: Star,
    tint: "text-yellow-500",
    label: "Ratings",
  },
  [NotificationKind.CourseStatusChanged]: {
    icon: ArrowRightLeft,
    tint: "text-violet-500",
    label: "Course status",
  },
};

export function NotificationKindIcon({
  kind,
  className,
}: {
  kind: NotificationKind;
  className?: string;
}) {
  const { icon: Icon, tint } = notificationKindMeta[kind];
  return <Icon className={cn("size-4 shrink-0", tint, className)} />;
}

function UnreadBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

/**
 * Opens a Notification: marks it read on the server and follows where it
 * leads. Shared by every place a Notification can be clicked.
 */
export function useOpenNotification() {
  const fetcher = useFetcher<{ target: ClickTarget }>();
  const navigate = useNavigate();
  const handled = useRef<unknown>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    // Follow each response once, however often this re-renders.
    if (handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    const { target } = fetcher.data;
    if (target.type === "url") navigate(target.url);
    if (target.type === "unavailable") {
      toast("This is no longer available.");
    }
  }, [fetcher.state, fetcher.data, navigate]);

  return (notificationId: number) =>
    fetcher.submit(
      { intent: "open", notificationId },
      { method: "post", action: "/api/notifications" }
    );
}

/**
 * Listens for Notifications arriving while the page is open (ADR 0013). On a
 * nudge it refetches the bell's data and shows a quiet toast. When a dropped
 * connection comes back it refetches too: the stored Notifications are the
 * source of truth, so nothing sent meanwhile is lost.
 */
function useNotificationArrivals() {
  const revalidator = useRevalidator();
  const revalidate = useRef(revalidator.revalidate);
  revalidate.current = revalidator.revalidate;

  useEffect(() => {
    const source = new EventSource("/api/notifications/stream");
    let dropped = false;

    source.addEventListener("notification", (event) => {
      const nudge: Nudge = JSON.parse((event as MessageEvent<string>).data);
      revalidate.current();
      toast(nudge.title, { description: nudge.courseTitle, duration: 3000 });
    });
    source.addEventListener("error", () => {
      dropped = true;
    });
    source.addEventListener("open", () => {
      if (!dropped) return;
      dropped = false;
      revalidate.current();
    });

    return () => source.close();
  }, []);
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: NotificationView;
  onOpen: (id: number) => void;
}) {
  const unread = !notification.read;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(notification.id)}
        className={cn(
          "group flex w-full gap-3 border-b px-4 py-3 text-left hover:bg-muted/60",
          unread && "bg-blue-50/60 dark:bg-blue-950/20"
        )}
      >
        <NotificationKindIcon kind={notification.kind} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className={cn("text-sm", unread && "font-semibold")}>
            {notification.title}
          </div>
          {notification.excerpt && (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {notification.excerpt}
            </div>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            {notification.courseTitle} ·{" "}
            {formatRelativeTime(notification.createdAt)}
          </div>
        </div>
        <div className="flex w-5 shrink-0 justify-center">
          {unread && (
            <span
              className="mt-1.5 size-2 rounded-full bg-blue-500"
              aria-label="Unread"
            />
          )}
        </div>
      </button>
    </li>
  );
}

export function NotificationBell({ data }: { data: NotificationBellData }) {
  const [open, setOpen] = useState(false);
  const openNotification = useOpenNotification();
  useNotificationArrivals();

  function handleOpen(id: number) {
    setOpen(false);
    openNotification(id);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative ml-auto rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={`Notifications (${data.unreadCount} unread)`}
          title="Notifications"
        >
          <Bell className="size-4" />
          <UnreadBadge count={data.unreadCount} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-96 rounded-lg p-0 shadow-xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
        </div>
        <ul className="max-h-[28rem] overflow-y-auto [&>li:last-child>button]:border-0">
          {data.latest.length === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">
              You're all caught up.
            </li>
          ) : (
            data.latest.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onOpen={handleOpen}
              />
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
