# Build Notifications in-house, pushed over SSE from one process

Notifications are stored in our own SQLite file and pushed to open browsers through a Server-Sent Events resource route, not through a notification vendor. The scope is in-app only, for Students and Instructors, with no email or digests planned, so a vendor's orchestration features would go unused. Keeping Notifications in-house also keeps Student and Instructor data out of a third party. The push uses an in-memory map from user to open streams, which works only because Cadence runs as one server process (ADR 0006). The stored Notification is the source of truth, and the push only nudges the bell to refetch, so a dropped stream loses nothing.

## Considered Options

- **Novu Cloud.** Rejected: it was the cheapest vendor (~$54/mo at 5k MAU), styles with Tailwind, and has an EU region and an easy path to email. But it means syncing users to a third party, for channels we don't plan to use.
- **Knock, MagicBell, Courier.** Rejected: about $200–250/mo for the same unused orchestration.
- **Self-hosted Novu.** Rejected: MongoDB, Redis, S3 and four services, next to a single SQLite file.
- **Polling the unread count.** Rejected: it would work across many processes, but it costs a request every ~10s per tab and is less fresh than "within seconds".

## Consequences

If Cadence ever runs more than one process, the in-memory fan-out must be replaced with a shared channel (e.g. Redis pub/sub or Postgres LISTEN/NOTIFY). That move already comes with leaving SQLite. Adding email later means building our own sender off the Notification table.
