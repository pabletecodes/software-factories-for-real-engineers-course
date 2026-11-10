import { data } from "react-router";
import type { Route } from "./+types/api.notifications.stream";
import { getCurrentUserId } from "~/lib/session";
import { pushHub, type Nudge } from "~/lib/notification-push.server";

// The signed-in user's Notification nudges, as Server-Sent Events (ADR 0013).
// Each open tab holds one stream. A "notification" event carries the title and
// course for a toast; the bell refetches the stored Notifications itself.

/** Keeps idle connections from being closed by proxies along the way. */
const HEARTBEAT_MS = 25_000;

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const encoder = new TextEncoder();
  let close = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));

      const unsubscribe = pushHub.subscribe(userId, (nudge: Nudge) => {
        write(`event: notification\ndata: ${JSON.stringify(nudge)}\n\n`);
      });
      const heartbeat = setInterval(() => write(": heartbeat\n\n"), HEARTBEAT_MS);

      close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      if (request.signal.aborted) return close();
      request.signal.addEventListener("abort", close, { once: true });

      // Opens the stream at once, so the browser knows it is connected.
      write("retry: 3000\n\n");
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
