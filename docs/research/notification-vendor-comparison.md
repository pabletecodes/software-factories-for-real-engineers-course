# Notification vendors vs building in-house

Research for [#3](https://github.com/pabletecodes/software-factories-for-real-engineers-course/issues/3), a child of the map [#1 Wayfinder: In-app Notifications](https://github.com/pabletecodes/software-factories-for-real-engineers-course/issues/1). All sources accessed **2026-11-10**. Pricing pages change often; re-check them before deciding.

## Question

What are the realistic options for near real-time (within seconds, no navigation) in-app Notifications for Students and Instructors in Cadence, with email possibly added later? Which one do we recommend?

Cadence context: React Router 8.3 framework mode with SSR, served by `react-router-serve` (Node, so HTTP streaming works). React 19, one SQLite file via Drizzle + better-sqlite3, Tailwind 4 + shadcn/radix, `sonner` toasts. There is no realtime infrastructure today (`package.json`).

## Options compared

1. **Knock**: hosted.
2. **MagicBell**: hosted.
3. **Novu Cloud**: hosted.
4. **Courier**: hosted.
5. **SuprSend**: hosted. Added because its pricing at small scale is strong.
6. **Novu self-hosted**: open-source core.
7. **Build in-house**: a `notifications` table in SQLite, an SSE (or polling) React Router resource route, and a shadcn bell/popover.

## Summary table

"~50k msgs/mo" is an assumed load of 5k MAU × about 10 in-app notifications each per month. Vendors bill per message or workflow run, not per MAU.

| | Realtime transport | React UI / headless | Auth model | Email later | Est. cost @ 5k MAU (~50k msgs/mo) | EU residency | Ops burden |
|---|---|---|---|---|---|---|---|
| **Knock** | WebSocket via Phoenix channels (`phoenix` dep of `@knocklabs/client`) | `@knocklabs/react`: `NotificationFeedPopover`, `NotificationIconButton` + hooks; CSS vars `--rnf-*` | RS256 JWT user token ("enhanced security mode") | Yes, workflows with email steps | Free tier is 10k msgs, so **Starter at $250/mo** | Not documented by Knock (a competitor says none) | Low |
| **MagicBell** | Realtime "socket" events (transport not documented) | `@magicbell/react` (`FloatingInbox`, `Inbox`) + `@magicbell/react-headless` hooks; CSS vars `--magicbell-*` | HS256 User JWT | Yes (SES, SendGrid, Mailgun, SMTP…) | Free tier is 1k deliveries, so **Startup at $249/mo** | Not documented | Low |
| **Novu Cloud** | WebSocket (socket.io / partysocket in `@novu/js`) | `@novu/react` `<Inbox/>` with composable Bell/Notifications; `appearance.elements` accepts **Tailwind class strings**; headless hooks | HMAC-SHA256 `subscriberHash` | Yes, workflows with email steps | **Pro from $30/mo** (30k runs) + $1.20/1k → **~$54/mo** (estimate) | **Yes**: EU region (`eu.api.novu.co`); Free lists US+EU | Low |
| **Courier** | WebSocket (`wss://realtime…courier.io`) | `@trycourier/courier-react` v9: `CourierInbox`, `CourierInboxPopupMenu`, `useCourier()`; theme object / custom renderers | JWT minted by backend with scopes | Yes, core product | Free 10k; Business is **$0.005/send ≈ $200–250/mo** | **Yes**: EU datacenter (Ireland), Business+ | Low |
| **SuprSend** | socket.io (react-inbox README) | `@suprsend/react` drop-in + headless | Signed JWT user tokens (moved from HMAC) | Yes | Free 10k; **Essentials $100/mo** (50k, then $2/1k) | Enterprise "custom region" only | Low |
| **Novu self-hosted** | Same as Novu Cloud (own `ws` service) | Same as Novu Cloud | Same | Yes | $0 license, but you pay for VMs + MongoDB + Redis + S3 | Wherever we host | **High**: API, Worker, WS, Dashboard, MongoDB, Redis, S3 |
| **Build in-house** | SSE from a React Router resource route (or polling a loader) | Our own shadcn `Popover` + `lucide` bell; `sonner` toast on arrival | Existing session cookie, nothing new | Later: add a mail provider + templating ourselves | $0 vendor cost | Inside our SQLite file | Low to medium: our code; single process only |

## Per-option findings

### Knock

- **UI:** `@knocklabs/react` ships `NotificationFeedPopover`, `NotificationFeed` and `NotificationIconButton`, plus "a complete set of React hooks" for a custom UI ([React overview](https://docs.knock.app/in-app-ui/react/overview)).
- **Styling:** you import `@knocklabs/react/dist/index.css` and override `--rnf-*` CSS variables or `rnf-*` classes. `renderItem` replaces a cell, and dark mode is a prop ([Feed docs](https://docs.knock.app/in-app-ui/react/feed)). This is workable with Tailwind, but it is not Tailwind-native.
- **Realtime:** the feed uses socket connections, with an option to auto-disconnect inactive tabs ([Feed docs](https://docs.knock.app/in-app-ui/react/feed)). `@knocklabs/client` depends on `phoenix@1.8.9`, so the transport is Phoenix-channel WebSockets ([package.json](https://github.com/knocklabs/javascript/blob/main/packages/client/package.json)).
- **Auth:** in enhanced security mode the backend signs an RS256 JWT with `sub` set to the user id and passes it as `userToken` to `KnockProvider`. Signing is local, with no network call. Optional `grants` scope the token ([Security & authentication](https://docs.knock.app/in-app-ui/security-and-authentication)).
- **Pricing:** Free is 10k messages/mo. Starter is $250/mo with 50k messages, then $0.005 each ([pricing](https://knock.app/pricing)).
- **Residency:** the pricing page lists GDPR but no region choice. A Courier blog post claims Knock has no EU datacenter ([courier.com blog](https://www.courier.com/blog/eu-data-residency-notifications)). That is a competitor source, so it is **unverified**.
- **SSR:** Knock's docs don't cover it. The components are client-side (hooks, sockets), so render them client-only or behind a mounted check.

### MagicBell

- **UI:** `@magicbell/react` provides `Inbox`, `FloatingInbox` (with a custom `ButtonComponent` for the bell), `ToastContainer` and `UserPreferences`. You import a stylesheet per component and override `--magicbell-*` vars and `.magicbell--*` classes ([React lib](https://www.magicbell.com/docs/libraries/react)). `@magicbell/react-headless` offers `useNotifications`, `useBell` (with a realtime `unreadCount`) and `useMagicBellEvent` ([React headless](https://magicbell.com/docs/libraries/react-headless)).
- **Auth:** the server generates a User JWT signed with HS256 using the project secret, with `user_external_id` and/or `user_email` ([User JWT](https://www.magicbell.com/docs/api/authentication/user)).
- **Email:** supported via SES, SendGrid, Mailgun, Ping Email or SMTP ([docs index](https://www.magicbell.com/docs)).
- **Pricing:** Builder is free with 1k deliveries/mo. Startup is $249/mo with 50k deliveries, then $0.0025 each ([pricing](https://www.magicbell.com/pricing)).
- **Gaps:** the docs don't state the realtime transport or data residency.

### Novu Cloud

- **UI:** `@novu/react` `<Inbox />` supports React 19. It has composable Bell / Notifications / InboxContent / Preferences, headless hooks, and `@novu/js` for framework-agnostic use ([Inbox overview](https://docs.novu.co/platform/inbox/overview)).
- **Styling:** the `appearance` prop takes `variables`, plus `elements` whose values can be **Tailwind class strings** or callbacks returning classes ([Styling](https://docs.novu.co/platform/inbox/configuration/styling)). This is the best fit with Tailwind/shadcn among the vendors.
- **Implementation detail:** `@novu/js` renders its UI with `solid-js` and depends on `socket.io-client@4.8.3` and `partysocket` ([package.json v3.19.2](https://github.com/novuhq/novu/blob/next/packages/js/package.json)). So the prebuilt Inbox is a Solid island inside React. That is fine, but expect a client-only render.
- **Auth:** the server computes `HMAC-SHA256(secretKey, subscriberId)` and passes it as `subscriberHash`. It is only enforced once "Security HMAC encryption" is turned on; without it, subscriber ids can be guessed ([Prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production)).
- **EU:** use `apiUrl: https://eu.api.novu.co` and `socketUrl: wss://eu.socket.novu.co` ([same page](https://docs.novu.co/platform/inbox/prepare-for-production)).
- **Pricing:** Free is 10k runs/mo with US/EU residency. Pro is from $30/mo for 30k+ runs, then $1.20 per 1k. Team is from $250 ([pricing](https://novu.co/pricing)).
- **Lock-in:** the lowest of the vendors, because the core is MIT and could later move to self-host ([GitHub](https://github.com/novuhq/novu)). Note that the pricing page lists *self-hosted* as an Enterprise option.

### Courier

- **UI:** `@trycourier/courier-react` (v9, React 18+) provides `<CourierInbox />`, `<CourierInboxPopupMenu />`, `<CourierToast />`, `<CourierPreferences />` and `useCourier()`. You must call `inbox.listenForUpdates()` to get realtime. The docs state the components are client-only (`'use client'`) ([React SDK](https://www.courier.com/docs/sdk-libraries/courier-react-web)). Theming is via `CourierInboxTheme` or custom views ([Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview)).
- **Auth:** the backend mints a JWT with the API key and scopes such as `inbox:read:messages` and `inbox:write:events` (same pages).
- **EU:** an Ireland datacenter on Business and Enterprise, with inbox realtime at `wss://realtime.eu.courier.io` ([EU datacenter](https://www.courier.com/docs/platform/workspaces/eu-datacenter)).
- **Pricing:** Developer is free with 10k sends/mo. Business is $0.005 per send ([pricing](https://www.courier.com/pricing)).
- **Strength:** Courier's core is multi-channel routing, so it has the strongest email story.

### SuprSend

- **UI:** `@suprsend/react` offers a drop-in inbox or headless use. Auth moved from HMAC to signed JWT user tokens ([Inbox React](https://docs.suprsend.com/docs/inbox-react)). Realtime uses socket.io ([suprsend-react-inbox README](https://github.com/suprsend/suprsend-react-inbox)).
- **Pricing:** Free is 10k notifications/mo with SuprSend branding. Essentials is $100/mo for 50k, then $2/1k. Digest and preferences are only on Business at $250 ([pricing](https://www.suprsend.com/pricing)).
- **Residency and self-host:** a custom region and self-hosting are Enterprise-only (same page).

### Novu self-hosted

- **Licensing:** the core is MIT, and the `enterprise/` folder is under a commercial license ([GitHub README](https://github.com/novuhq/novu)).
- **Minimum footprint:** one VM with 4 vCPU and 8 GB running API + Worker + WS + Dashboard, plus MongoDB (2 GB RAM, 20 GB disk), Redis with AOF, and ≥10 GB of S3-compatible storage. "Some features exclusive to Novu's cloud-managed solution will not be available" ([Self-hosting overview](https://docs.novu.co/community/self-hosting-novu/overview)).
- **Fit:** this is far heavier than Cadence's single SQLite file. It is out of proportion for our scale.

### Build in-house (baseline)

- **Data:** a `notifications` table (recipient user id, type, payload/JSON, `read_at`, `created_at`) in the existing SQLite DB via Drizzle. Writes happen in the same transaction as the domain event that triggers them, such as a new question or a refund.
- **Realtime:** a React Router resource route streams SSE. `remix-utils` ships `eventStream` (`remix-utils/sse/server`) and `useEventSource` (`remix-utils/sse/react`). Its current major **requires React Router v8 and React ≥19.2.7**, which matches Cadence. It needs a host that supports HTTP streaming, and the hook shares one connection per URL ([remix-utils README](https://github.com/sergiodxa/remix-utils)). `react-router-serve` is a Node server, so streaming works.
  - **Fan-out:** an in-process `EventEmitter` per user id. This only works while Cadence runs as **one Node process**, which is already implied by a single SQLite file.
  - **Fallback:** poll a loader every N seconds with `useRevalidator`/`useFetcher`. This needs zero new infrastructure, but "within seconds" then means the poll interval.
- **UI:** shadcn `Popover` + `lucide-react` `Bell` + an unread badge. New arrivals show a `sonner` toast. Everything is SSR-friendly: the unread count can come from the layout loader, so there is no flash of empty bell.
- **Auth:** reuse the existing session. There are no tokens to mint and no third-party user sync.
- **Email later:** we would add a transactional provider (Resend, Postmark, SES) and our own templates and preferences. That is the main thing vendors give "for free".
- **Costs:** $0 vendor cost, no lock-in, data stays in our DB. We own the edge cases: reconnect, multi-tab, mark-all-read, retention.

## Criteria scorecard (1 = poor, 3 = good)

| Criterion | Knock | MagicBell | Novu Cloud | Courier | SuprSend | Novu self-host | In-house |
|---|---|---|---|---|---|---|---|
| Realtime | 3 | 3 | 3 | 3 | 3 | 3 | 3 (SSE) / 2 (poll) |
| Prebuilt React UI | 3 | 3 | 3 | 3 | 3 | 3 | 1 (build it, about a day with shadcn) |
| Tailwind/shadcn fit | 2 | 2 | 3 | 2 | 2 | 3 | 3 |
| SSR / RR8 fit | 2 (client-only) | 2 | 2 | 2 | 2 | 2 | 3 |
| Auth simplicity | 2 | 2 | 2 | 2 | 2 | 2 | 3 |
| Email later | 3 | 3 | 3 | 3 | 3 | 3 | 1 |
| Cost @ 5k MAU | 1 ($250) | 1 ($249) | 3 (~$54) | 1 (~$200–250) | 2 ($100) | 1 (infra) | 3 |
| Lock-in | 1 | 1 | 2 (MIT core) | 1 | 1 | 3 | 3 |
| EU residency | ? | ? | 3 | 2 (Business) | 1 | 3 | 3 |
| Ops burden | 3 | 3 | 3 | 3 | 3 | 1 | 2 |

## Recommendation (input for the grilling ticket, not a decision)

**Recommended: build in-house.** Use a SQLite `notifications` table, an SSE resource route via `remix-utils` `eventStream`/`useEventSource` (polling as a fallback), and a shadcn bell/popover with `sonner` toasts.

- **Scope is small:** in-app only, two roles, one app. The vendors' main value is multi-channel orchestration, digests and preference centres, which we don't need yet.
- **It fits the architecture:** we already have a single Node process with one SQLite file and a cookie session. There is no user sync to a third party, no token minting, and no client-only third-party island in an SSR app. The UI matches the shadcn design system natively.
- **No cost and no lock-in:** about $0 versus $100–250/mo at 5k MAU for most vendors, and notification data stays in our DB.
- **Accepted risk:** in-process fan-out ties us to one server process. That is already true because of SQLite. If we scale out, we would swap the emitter for Redis pub/sub or fall back to polling.

**Runner-up: Novu Cloud.**

- **Cheapest vendor:** about $54/mo at our assumed volume, with a free tier for development.
- **Best Tailwind fit:** `appearance.elements` takes Tailwind classes, and headless hooks are available.
- **Documented EU region, and the MIT core** gives an exit path to self-host.
- **Best email-later path:** the same workflow gains an email step.

Pick Novu if the grilling concludes that email, digests or user preferences are coming soon, so that building orchestration ourselves would be wasted work.

**Not recommended:**
- **Novu self-hosted:** MongoDB + Redis + S3 + 4 services is too much ops for Cadence.
- **Knock / MagicBell / Courier:** good products, but $200–250/mo at our scale for features we don't need yet.
- **SuprSend:** viable and cheap at $100/mo, but EU residency is Enterprise-only.

## Open questions for grilling

- Is email (or digests/preferences) on the roadmap within ~6 months? If so, this pushes towards Novu.
- Is there an EU data-residency requirement? If so, it rules out Knock, MagicBell and SuprSend at small tiers.
- Will Cadence ever run more than one Node process? This affects in-process SSE fan-out.
- Is polling every ~5–10 s acceptable as "within seconds"? If so, the in-house option needs no SSE at all.
