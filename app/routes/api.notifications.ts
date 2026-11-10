import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notifications";
import { db } from "~/db";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { resolveNotificationClick } from "~/lib/notifications.server";

// Changes to the signed-in user's own Notifications, called from the bell.
// One intent per action; add more alongside "open".

const notificationActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("open"),
    notificationId: z.coerce.number().int().positive(),
  }),
]);

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
        userId
      );
      if (!result.ok) {
        throw data(result.error, { status: result.status });
      }
      return { target: result.target };
    }
  }
}
