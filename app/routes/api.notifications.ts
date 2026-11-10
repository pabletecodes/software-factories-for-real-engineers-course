import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notifications";
import { db } from "~/db";
import { resolveCountry } from "~/lib/country.server";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { resolveNotificationClick } from "~/lib/notifications.server";
import {
  deleteNotification,
  markAllNotificationsRead,
} from "~/lib/notifications.server";
import {
  deleteNotifications,
  markNotificationsRead,
} from "~/lib/notifications.server";

// Changes to the signed-in user's own Notifications, called from the bell.
// One intent per action; add more alongside "open".

const notificationActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("open"),
    notificationId: z.coerce.number().int().positive(),
  }),
  z.object({
    intent: z.literal("delete"),
    notificationId: z.coerce.number().int().positive(),
  }),
  z.object({ intent: z.literal("mark-all-read") }),
  z.object({
    intent: z.literal("mark-read"),
    notificationIds: notificationIdList(),
  }),
  z.object({
    intent: z.literal("delete-many"),
    notificationIds: notificationIdList(),
  }),
]);

/** Several Notification ids sent as one comma-separated field, e.g. "4,7,9". */
function notificationIdList() {
  return z
    .string()
    .transform((ids) => ids.split(",").map(Number))
    .pipe(z.array(z.number().int().positive()).min(1));
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const parsed = parseFormData(
    await request.formData(),
    notificationActionSchema
  );
  if (!parsed.success) {
    throw data("Invalid request", { status: 400 });
  }

  switch (parsed.data.intent) {
    case "open": {
      const result = resolveNotificationClick(
        db,
        parsed.data.notificationId,
        userId,
        new Date(),
        await resolveCountry(request)
      );
      if (!result.ok) {
        throw data(result.error, { status: result.status });
      }
      return { target: result.target };
    }
    case "delete": {
      const result = deleteNotification(db, parsed.data.notificationId, userId);
      if (!result.ok) {
        throw data(result.error, { status: result.status });
      }
      return { ok: true };
    }
    case "mark-all-read": {
      markAllNotificationsRead(db, userId);
      return { ok: true };
    }
    case "mark-read": {
      return markNotificationsRead(db, parsed.data.notificationIds, userId);
    }
    case "delete-many": {
      return deleteNotifications(db, parsed.data.notificationIds, userId);
    }
  }
}
