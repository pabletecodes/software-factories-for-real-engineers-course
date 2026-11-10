// ─── Notification push ───
// Nudges open browsers when a Notification arrives, over Server-Sent Events.
// The hub maps each user to their open streams (one per tab) in memory, which
// works only because Cadence runs as one server process (ADR 0006, ADR 0013).
// The stored Notification is the source of truth: a nudge just tells the bell
// to refetch, and carries what it needs for a toast, so a dropped stream loses
// nothing.

/** What one stream is told when a Notification arrives for its user. */
export type Nudge = { title: string; courseTitle: string };

type Send = (nudge: Nudge) => void;

export type PushHub = {
  /** Opens a stream for a user. Returns a function that closes it. */
  subscribe(userId: number, send: Send): () => void;
  /** Sends a nudge to every open stream of each of the users. */
  publish(userIds: Iterable<number>, nudge: Nudge): void;
};

export function createPushHub(): PushHub {
  const streams = new Map<number, Set<Send>>();

  function unsubscribe(userId: number, send: Send) {
    const userStreams = streams.get(userId);
    if (!userStreams) return;
    userStreams.delete(send);
    if (userStreams.size === 0) streams.delete(userId);
  }

  return {
    subscribe(userId, send) {
      let userStreams = streams.get(userId);
      if (!userStreams) {
        userStreams = new Set();
        streams.set(userId, userStreams);
      }
      userStreams.add(send);
      return () => unsubscribe(userId, send);
    },

    publish(userIds, nudge) {
      for (const userId of new Set(userIds)) {
        for (const send of [...(streams.get(userId) ?? [])]) {
          try {
            send(nudge);
          } catch {
            // The stream has closed without unsubscribing.
            unsubscribe(userId, send);
          }
        }
      }
    },
  };
}

// The app's one hub. Kept on globalThis so that reloading this module in
// development does not strand the streams already open.
const globalForPush = globalThis as typeof globalThis & {
  notificationPushHub?: PushHub;
};

export const pushHub: PushHub =
  globalForPush.notificationPushHub ??
  (globalForPush.notificationPushHub = createPushHub());
