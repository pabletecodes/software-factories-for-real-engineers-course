import { useEffect, useState } from "react";
import {
  Link,
  data,
  isRouteErrorResponse,
  useFetcher,
  useLocation,
} from "react-router";
import { AlertTriangle, CheckCheck, Trash2 } from "lucide-react";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Route } from "./+types/notifications";
import { db } from "~/db";
import { NotificationKind, users } from "~/db/schema";
import { requireUserId } from "~/lib/access.server";
import {
  countNotifications,
  listNotificationsPage,
  receivableNotificationKinds,
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationFilter,
  type NotificationView,
} from "~/lib/notifications.server";
import {
  NotificationKindIcon,
  notificationKindMeta,
  useOpenNotification,
} from "~/components/notification-bell";
import { Button } from "~/components/ui/button";
import { cn, formatRelativeTime } from "~/lib/utils";

// The full Notifications page (Variant A on the prototype/notification-ux
// branch): a recipient's whole history, filtered by the URL's `unread` and
// `kind`, paged by `page`, with bulk Mark as read and Delete.

export function meta() {
  return [
    { title: "Notifications — Cadence" },
    { name: "description", content: "All your Notifications" },
  ];
}

const NOTIFICATIONS_ACTION = "/api/notifications";

/**
 * The page's search params. Anything unrecognised falls back to the default:
 * no kind filter, all Notifications, page 1.
 */
const notificationsSearchSchema = z.object({
  kind: z.nativeEnum(NotificationKind).nullable().catch(null),
  unread: z
    .literal("1")
    .optional()
    .catch(undefined)
    .transform((unread) => unread === "1"),
  page: z.coerce.number().int().positive().catch(1),
});

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  const kinds = user ? receivableNotificationKinds(user.role) : [];
  if (kinds.length === 0) {
    throw data("Notifications are for Students and Instructors.", {
      status: 403,
    });
  }

  const search = notificationsSearchSchema.parse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  const filter: NotificationFilter = {
    unreadOnly: search.unread,
    kind: search.kind && kinds.includes(search.kind) ? search.kind : null,
  };
  const page = search.page;

  return {
    kinds,
    filter,
    counts: countNotifications(db, userId),
    page: listNotificationsPage(db, userId, filter, page),
    pageSize: NOTIFICATIONS_PAGE_SIZE,
  };
}

/** The URL of this page with a filter and page, leaving defaults out. */
function pageUrl(filter: NotificationFilter, page = 1) {
  const params = new URLSearchParams();
  if (filter.unreadOnly) params.set("unread", "1");
  if (filter.kind) params.set("kind", filter.kind);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/notifications?${query}` : "/notifications";
}

function Chip({
  to,
  active,
  activeClassName,
  children,
}: {
  to: string;
  active: boolean;
  activeClassName: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      preventScrollReset
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
        active ? activeClassName : "hover:bg-muted"
      )}
    >
      {children}
    </Link>
  );
}

function ChipCount({ count }: { count: number }) {
  return <span className="opacity-60">{count.toLocaleString()}</span>;
}

export default function NotificationsPage({
  loaderData,
}: Route.ComponentProps) {
  const { kinds, filter, counts, page, pageSize } = loaderData;
  const location = useLocation();
  const openNotification = useOpenNotification();
  const markAll = useFetcher();
  const bulk = useFetcher();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // A new filter or page starts with nothing selected.
  useEffect(() => setSelected(new Set()), [location.search]);

  const shown = page.notifications;
  const allOnPageSelected =
    shown.length > 0 && shown.every((n) => selected.has(n.id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected(
      allOnPageSelected ? new Set() : new Set(shown.map((n) => n.id))
    );
  }

  function submitBulk(intent: "mark-read" | "delete-many") {
    bulk.submit(
      { intent, notificationIds: [...selected].join(",") },
      { method: "post", action: NOTIFICATIONS_ACTION }
    );
    setSelected(new Set());
  }

  const unreadChipCount = filter.kind
    ? counts.unreadByKind[filter.kind]
    : counts.unread;
  const kindCount = (kind: NotificationKind | null) =>
    kind === null
      ? filter.unreadOnly
        ? counts.unread
        : counts.total
      : filter.unreadOnly
        ? counts.unreadByKind[kind]
        : counts.byKind[kind];

  const first = (page.page - 1) * pageSize + 1;
  const last = first + shown.length - 1;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {counts.unread.toLocaleString()} unread of{" "}
            {counts.total.toLocaleString()}
          </p>
        </div>
        <Button
          size="sm"
          disabled={counts.unread === 0 || markAll.state !== "idle"}
          onClick={() =>
            markAll.submit(
              { intent: "mark-all-read" },
              { method: "post", action: NOTIFICATIONS_ACTION }
            )
          }
        >
          <CheckCheck />
          Mark all read
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Chip
          to={pageUrl({ ...filter, unreadOnly: !filter.unreadOnly })}
          active={filter.unreadOnly}
          activeClassName="border-blue-500 bg-blue-500 text-white"
        >
          <span
            className={cn(
              "size-2 rounded-full",
              filter.unreadOnly ? "bg-white" : "bg-blue-500"
            )}
          />
          Unread
          <ChipCount count={unreadChipCount} />
        </Chip>
        <span className="mx-1 h-5 w-px bg-border" />
        <Chip
          to={pageUrl({ ...filter, kind: null })}
          active={filter.kind === null}
          activeClassName="border-primary bg-primary text-primary-foreground"
        >
          All
          <ChipCount count={kindCount(null)} />
        </Chip>
        {kinds.map((kind) => (
          <Chip
            key={kind}
            to={pageUrl({ ...filter, kind })}
            active={filter.kind === kind}
            activeClassName="border-primary bg-primary text-primary-foreground"
          >
            <NotificationKindIcon
              kind={kind}
              className={cn("size-3.5", filter.kind === kind && "text-current")}
            />
            {notificationKindMeta[kind].label}
            <ChipCount count={kindCount(kind)} />
          </Chip>
        ))}
      </div>

      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="w-8 py-2">
              <input
                type="checkbox"
                aria-label="Select this page"
                title="Select this page"
                className="size-4 align-middle accent-primary"
                checked={allOnPageSelected}
                disabled={shown.length === 0}
                onChange={toggleAllOnPage}
              />
            </th>
            <th colSpan={5} className="h-10 font-normal">
              {selected.size > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => submitBulk("mark-read")}
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-foreground hover:bg-muted"
                  >
                    <CheckCheck className="size-3.5" /> Mark as read
                  </button>
                  <button
                    type="button"
                    onClick={() => submitBulk("delete-many")}
                    className="flex items-center gap-1.5 rounded-md border border-red-300 px-2.5 py-1 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </button>
                  <span className="ml-1">
                    {selected.size.toLocaleString()} selected
                  </span>
                </div>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((notification) => (
            <NotificationTableRow
              key={notification.id}
              notification={notification}
              checked={selected.has(notification.id)}
              onToggle={() => toggle(notification.id)}
              onOpen={() => openNotification(notification.id)}
            />
          ))}
        </tbody>
      </table>
      {shown.length === 0 && (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No Notifications.
        </p>
      )}

      {page.total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {first.toLocaleString()}–{last.toLocaleString()} of{" "}
            {page.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <PageLink
              to={pageUrl(filter, page.page - 1)}
              disabled={page.page <= 1}
            >
              Newer
            </PageLink>
            <span className="px-2 text-muted-foreground">
              Page {page.page} of {page.pageCount}
            </span>
            <PageLink
              to={pageUrl(filter, page.page + 1)}
              disabled={page.page >= page.pageCount}
            >
              Older
            </PageLink>
          </div>
        </div>
      )}
    </div>
  );
}

function PageLink({
  to,
  disabled,
  children,
}: {
  to: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={to}>{children}</Link>
    </Button>
  );
}

function NotificationTableRow({
  notification,
  checked,
  onToggle,
  onOpen,
}: {
  notification: NotificationView;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const unread = !notification.read;
  return (
    <tr
      className={cn(
        "border-b",
        unread && "bg-blue-50/60 font-medium dark:bg-blue-950/20"
      )}
    >
      <td className="py-3 align-top">
        <input
          type="checkbox"
          aria-label={`Select: ${notification.title}`}
          className="mt-0.5 size-4 accent-primary"
          checked={checked}
          onChange={onToggle}
        />
      </td>
      <td className="w-5 align-top">
        {unread && (
          <span
            className="mt-2 block size-2 rounded-full bg-blue-500"
            aria-label="Unread"
          />
        )}
      </td>
      <td className="w-7 py-3 align-top">
        <NotificationKindIcon kind={notification.kind} className="mt-0.5" />
      </td>
      <td className="py-3 pr-4">
        <button
          type="button"
          onClick={onOpen}
          className="text-left hover:underline"
        >
          {notification.title}
        </button>
        {notification.excerpt && (
          <div className="truncate text-xs font-normal text-muted-foreground">
            {notification.excerpt}
          </div>
        )}
      </td>
      <td className="w-56 truncate py-3 pr-4 text-xs font-normal text-muted-foreground">
        {notification.courseTitle}
      </td>
      <td className="w-20 py-3 text-right text-xs font-normal text-muted-foreground">
        {formatRelativeTime(notification.createdAt)}
      </td>
    </tr>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message =
    "An unexpected error occurred while loading your Notifications.";

  if (isRouteErrorResponse(error)) {
    title =
      error.status === 401
        ? "Sign in required"
        : error.status === 403
          ? "Not allowed"
          : `Error ${error.status}`;
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
