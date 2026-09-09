# Accounts, dashboard and memberships — implementation plan

Date: 2026-09-09. Status: ready to implement in ordered milestones; no application changes made by this planning task.

This is the execution plan for [the architecture and product specification](auth-membership-dashboard-v1.md) and [the code audit](../../CODE_REVIEW_REPORT.md). That specification defines the migration inventory, data model, access control, billing-state policy and account lifecycle. This document adds bounded work packages, dependencies, component reuse and acceptance gates. Checkboxes are evidence-based; the two completed external Auth setup items cite their source below.

## Scope and delivery order

Deliver Firebase Google/email accounts, private Firestore persistence, a dashboard for alerts/lists, an editable profile/preferences page, and Stripe subscriptions with visible cancellation. Existing personal features require registration; public browsing stays available. The first useful release is a free account with cloud-backed basket/following and safe browser import. Paid access follows only after monitoring works reliably.

Dependency chain: **M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7**. M6 can begin after M3 using the stable account contract, but completion of all inventoried origins is required before calling the overall migration complete. Each milestone is a separately reviewable change. Do not bundle public-data refreshes or unrelated working-tree changes with this work.

Current Firebase-console state supplied on 2026-09-09: Google and email/password sign-in methods are enabled in `elections-bg`; the screenshot confirms `naiasno.bg` and `www.naiasno.bg` are Authorized domains. Treat provider enablement and the two Authorized-domain entries as completed external setup. They do not complete branded Google redirect setup: the SDK auth domain, OAuth client redirect URI, OAuth brand and canonical Hosting behavior have separate gates below.

## Mandatory visual and component contract

Use the existing design system. Do not introduce an account-specific palette, theme provider, component library or parallel typography scale.

Source of truth:

- `src/App.css`: light/dark HSL tokens, `app-page-title`, `app-section-title`, `app-eyebrow`.
- `src/index.css`, `tailwind.config.js`, `public/fonts/fonts.css`: Inter body text, Fraunces headings, existing self-hosted font assets and spacing/radius utilities.
- `src/theme/ThemeContext.tsx`: existing theme preference and OS fallback. New account pages consume this provider; they do not write a competing `.dark` or `data-theme` state.
- `src/layout/Layout.tsx`, `src/layout/header/Header.tsx`, `src/layout/siteChrome.ts`, `src/layout/shellPadding.ts`: shared global shell, header surfaces, active navigation and page padding.
- `src/components/ui/*`: production pages import these primitives directly. The inline concept illustrates their appearance; it is not a replacement implementation of the React/Radix components.

### Palette rules

| Role | Required treatment |
| --- | --- |
| Light appearance | Existing warm cream surfaces and coral accents. `--background: 39 33% 92%`, `--card: 36 30% 86%`, `--foreground: 30 10% 12%`. |
| Dark appearance | Existing deep navy surfaces and mint accents. `--background: 224 47% 8%`, `--card: 223 38% 13%`, `--foreground: 210 25% 96%`. |
| Primary actions | `Button` default variant: primary/primary-foreground. Do not invent a coral Button variant; the default is warm near-black in light and mint in dark. |
| Section navigation | `PillLink tone="accent"` for personal section links; selected state uses accent-strong/accent-strong-foreground. |
| Dense inbox filters | `Pill tone="neutral"` inside `PillGroup`; selected state uses primary/primary-foreground. |
| Accent body text | `text-popover-foreground`. `accent-strong` is a filled-control token, not a small-text color on cream cards; App.css explicitly documents that distinction. |
| Errors and status | Existing destructive/negative/positive tokens plus explicit text/icons. Unread is an inbox state, not a positive/negative financial result. |
| Borders, focus and hover | Existing border/input/ring tokens and primitive hover/focus behavior. No literal white focus offset or custom blue outline. |

Exact token values are recorded here to verify the concept against today's source, not to copy into production components. Production consumes semantic Tailwind utilities so later palette changes propagate automatically.

### Component map

| New surface | Reuse |
| --- | --- |
| Auth form shell | `Card`, `CardHeader`, `CardContent`, `Label`, `Input`, `Button`, `Separator`; existing `Dialog` for contextual sign-in. One form implementation shared between page and dialog. |
| Account entry/menu | Existing `Header` and `Logo`; `Avatar` with fallback, `DropdownMenu`, `Button` and existing Lucide icon imports. |
| Personal navigation | `PillLink` + `PillGroup nav`; React Router route state supplies `aria-current`. No home-grown tab/navigation semantics. |
| Dashboard sections | `Card` family with existing background/foreground utilities, `app-page-title` and `app-section-title`; specialized feature rows within cards. |
| Alert filters/actions | `Pill tone="neutral"`, `Select`, outline/ghost `Button`, `Badge`, `DropdownMenu`; explicit read/unread text. |
| List chooser/editor | `Dialog`, `Input`, `Label`, `Command` where searchable entity selection is needed, `Checkbox`, `Button`. |
| Profile/preferences | `Input`, `Label`, `Select`, `Switch`/`Checkbox`, `Avatar`, `Card`, `Button`. Tabs only for local panels; account subpages remain routes. |
| Billing/cancellation | Existing `Card`, `Badge`, `Button`; visible outline cancellation action leading to Stripe Portal. Use existing `Dialog` only for application-owned account deletion/review. |
| Loading/errors | `Skeleton` and semantic inline error/retry content using existing tokens; do not add a new styled alert library. |

Use page composition for layout differences, not a duplicated Button/Input/Card implementation. New shared domain components such as `AlertRow`, `ListItemRow`, `AccountSection` and `AuthForm` compose these primitives. A missing primitive capability must be addressed in the shared component with a narrowly justified change and existing consumer verification.

Design acceptance for every UI milestone: BG/EN, light/dark, 320/360/736/1024px, keyboard/focus, long translated labels, error/empty/loading/disabled states, and contrast against the actual surface. Keep mobile touch targets usable using the project's existing responsive utilities. Validate the real primitives in browser screenshots; a concept screenshot alone does not pass this gate.

## M0 — Contracts, environment and visual baseline

- [x] Enable Google and email/password sign-in methods in production project `elections-bg` (user-confirmed console change, 2026-09-09).
- [x] Add `naiasno.bg` and `www.naiasno.bg` to Firebase Authentication Authorized domains (confirmed by supplied console screenshot, 2026-09-09).
- [ ] Confirm shared production Auth authority (`elections-bg` proposed), separate staging authority, actual Firestore location, IAM and each app's action-link domains. Do not infer OAuth redirect readiness from Firebase Authorized domains.
- [ ] Make `naiasno.bg` the canonical app domain on the same Firebase Hosting/Auth project. Preserve Firebase's reserved `/__/auth/**` routes. Provision `www.naiasno.bg` DNS and redirect it to the apex, or keep it out of auth entry points.
- [ ] Configure the Google OAuth client/brand: exact authorized redirect URI `https://naiasno.bg/__/auth/handler`; display name `Наясно`; approved logo, support email, homepage, privacy and terms on the verified `naiasno.bg` domain. Represent reviewable provider settings in Firebase Auth config where supported; commit no secret.
- [ ] Add proposed `account-functions/` TypeScript codebase and explicit Firebase/emulator/deploy configuration. Keep existing main/news deny-all browser Firestore rules. Do not couple Stripe secrets to every existing function export.
- [ ] Add shared account API schemas/client contracts at an agreed shared root, consumable by main/news/AI; define typed canonical entity references, UIDs, revisions, errors, capabilities and migration receipts. Choose the exact shared-root packaging after checking all three tsconfigs/build entry graphs.
- [ ] Define environment variables, server secret bindings, test/live Stripe catalog separation and demo/emulator safeguards. No production writes from local tests.
- [ ] Assemble a review-only screen fixture with existing primitives for login/register, dashboard, list detail, profile/preferences and billing states. Record component imports and screenshots in the change. Match the visual contract above before feature wiring.

**Gate:** environment isolation and contract fixtures pass; shared components/palette confirmed; no relaxed Firestore rules, new palette literals or auth secrets in browser bundles. On production, `naiasno.bg/` serves the app, `naiasno.bg/__/auth/handler` serves the Firebase handler without a cross-brand redirect, and the public Firebase config no longer reports `elections-bg.firebaseapp.com` as the production `authDomain`. Price amounts are not needed yet.

## M1 — Firebase authentication and public-page entry points

- [ ] Add browser Firebase SDK and `src/auth/{firebase,AuthProvider,RequireAccount,authIntent}` modules; preserve route-level code splitting.
- [ ] Set production `authDomain: "naiasno.bg"` while leaving the other Firebase project fields unchanged. Use explicit per-environment configuration; staging uses its own Hosting/Auth domain and never the production handler.
- [ ] Implement login, registration, password-reset, verification/action links, Google popup/redirect fallback and credential linking in `src/screens/auth/*`. Use shared form composition and localized messages.
- [ ] Wire routes and `/en` mirrors in `src/routes.tsx`, provider placement in `src/main.tsx`, and header sign-in/avatar menu. Rename or clearly replace the misleading public `AuthRoutes` name.
- [ ] Add initializing/signed-out/signed-in/error states; safe relative return paths and short-lived idempotent save intent. Require verification for checkout/email delivery and recent auth for sensitive changes.
- [ ] Test account A → logout → B with delayed responses; purge UID-private state and prevent pending A operations from running for B.

**Gate:** Google/email registration/login/logout/reset/verify/link work in staging and emulator-appropriate tests; one pending save resumes once; no private content flashes during auth restoration. Production Google UI says “Continue to naiasno.bg” and displays “Наясно” where the OAuth app name appears; captured network evidence shows `redirect_uri=https://naiasno.bg/__/auth/handler`. Popup and redirect pass in current Safari, Firefox, Chrome and mobile; BG/EN and keyboard form checks pass.

## M2 — Private storage API and user profile

- [ ] Implement verified-token middleware, active-account/ownership checks and owner-scoped list/item/dossier/query CRUD in `account-functions/src/*`. Never accept a client UID as authorization.
- [ ] Add private/no-store account Hosting rewrites and explicit news/AI origin allowlist; test direct function URLs too. Do not use public `/api/db/**`, SQL tables or GCS exports for personal records.
- [ ] Implement quotas transactionally, immutable IDs, expected revisions, explicit add/remove operations and idempotent writes. Add UID-keyed finite-cache hooks under `src/data/account/*`.
- [ ] Implement `/account`, `/account/preferences`, `/account/security` under `src/screens/account/*`: display name, email verification/change, locale/timezone/default area, dashboard preferences, linked providers and export/delete entry points. Wire safe lifecycle jobs before exposing destructive actions.
- [ ] Add explicit Save changes per editable section; retain input on failures/conflicts. Firebase owns identity email/providers; private profile owns preferences. Keep URL locale/area precedence and device theme behavior.

**Gate:** A cannot read/write/export B's nested resources; direct client Firestore remains denied; concurrency cannot bypass quotas; private responses cannot enter shared caches; profile changes survive reload and another session. Billing fields cannot be edited through profile endpoints.

## M3 — Main-site migration with truthful persistence

- [ ] Write strict migration parsers for every main-origin key in the architecture inventory. Validate individual items, finite timestamps and sizes; preserve rejected and unresolved items for review/export.
- [ ] Add import review by account/category, manifest/fingerprints, stable item mappings, server receipts, resumable batches and read-back verification. Preserve over-limit data and conflicts; never truncate or clear failed imports.
- [ ] Replace `useBasket.ts`, procurement `useWatchlist.ts` and declaration `src/lib/watchlist.ts` with account hooks; reconcile numeric MP references and serving person slugs through verified mappings.
- [ ] Replace dossier persistence in `projectStore.ts`/consumers with immutable cloud IDs/revisions and explicit committed-save results. Preserve public curated dossiers and explicit public `?q=` exploration.
- [ ] Extract saved SQL/history from `SqlBrowserScreen.tsx`; store text privately without automatically executing imported SQL. Keep public query execution's current independent access boundary.
- [ ] Gate Save/Follow/Add-to-basket for visitors across all callers, preserve pending intent and old route entry points, update active browser-only/privacy copy. Keep legacy read/export available until verified completion.

**Gate:** basket, both follow systems, dossiers and saved queries work across two browser contexts; invalid/partial/duplicate/conflicting imports preserve recoverable content. Storage/network failure never shows false success. Replay cannot resurrect a deleted item or silently assign browser data to another UID.

## M4 — Personal dashboard, lists and durable in-app alerts

- [ ] Implement `/me`, `/me/alerts`, `/me/lists`, `/me/lists/:id`, `/me/dossiers`, `/me/history` with shared shell and section navigation. Profile is reachable from both navigation and avatar.
- [ ] Build overview with unread preview, pinned lists, specialized basket shortcut and recent dossiers; list detail supports rename/pin/reorder/move/copy/remove and separate monitoring controls.
- [ ] Add canonical source event adapters and subscription index/matcher jobs. Track stable event/revision IDs, source date basis, published-serving checkpoint and backfill policy.
- [ ] Implement deduplicated UID inbox receipts with match reasons, paginated reads, read/unread/archive/mute and cursor-bounded mark-all. Replace follow-count/cached-activity header badges with authoritative unread count.
- [ ] Match declarations before pagination; distinguish stale/error/empty. Do not equate procurement aggregate increases with a complete event feed. Keep unsupported price/saved-search event types unavailable.
- [ ] Add bounded polling, fan-out metrics and count reconciliation; dashboard/header must not request one rollup per followed entity.

**Gate:** alerts arrive without opening old watchlist screens; one source event matching two lists appears once; read state syncs; concurrent mark-all preserves newly arriving events. Dashboard/list/profile visuals pass the shared-component gate. Measure performance at proposed Free/Plus capacities before final quotas.

## M5 — Stripe subscriptions, profile cancellation and email delivery

- [ ] Finalize Free/Plus amounts, capacity/retention, annual option, billing grace and seller configuration from measured cost and product decisions. Retain saved content and export on downgrade.
- [ ] Implement authenticated Checkout/Portal session endpoints with server Price allowlist, UID customer mapping, persistent operation IDs and per-account concurrency control.
- [ ] Verify webhook signatures on raw body; durably enqueue, deduplicate and reconcile current Stripe subscription state. Add retry/dead-letter visibility and periodic reconciliation. Never grant membership from a return URL.
- [ ] Complete `/account/billing`: plan, usage, renewal/end date, invoices, payment method, upgrade/change and visible Cancel subscription. Portal confirms cancellation; app shows pending/confirmed/error using refreshed server state. Offer keeping the subscription where supported before expiry.
- [ ] Enforce capabilities on server writes, monitor creation and paid delivery; show affected paused rules after downgrade without deleting lists/dossiers.
- [ ] Select/configure digest provider, verified opt-in, cadence/timezone, unsubscribe/suppression, durable delivery outbox and uncertain-send recovery. Email settings reuse profile preferences controls.

**Gate:** Stripe test mode covers duplicated/reordered webhooks, checkout concurrency, renewal/failure, cancellation/restart and delayed activation. Cancellation is discoverable from profile and preserves data; no unverified/opted-out delivery. Paid launch waits for configured operational recovery and actual prices.

## M6 — News and AI account migration

- [ ] Initialize both apps against the same production Auth authority while retaining explicit per-origin sessions in v1; reuse account contracts and central API.
- [ ] Add origin-local import for saved news, briefing preferences/progress, AI conversations/history and news evaluation drafts. Old anonymous nonces/markers do not prove submission ownership.
- [ ] Offer separate consent for historical chat/evaluation drafts, bounded imports and private exports; preserve exact article/revision and conversation identity.
- [ ] Apply shared account/profile entry points, palette/primitives and logout isolation to both builds. Document that a shared UID does not automatically provide cross-origin SSO.

**Gate:** same account retrieves correct saved content across apps; each origin imports only what it can read; signing out/switching cannot expose previous account state. Relevant tests/typechecks/builds pass independently.

## M7 — Lifecycle, rollout and retirement

- [ ] Complete and rehearse resumable export/deletion: recent auth, block writes, stop delivery, cancel billing according to policy, recursively remove private descendants/indexes, finalize Auth deletion; late webhooks cannot recreate accounts.
- [ ] Roll out with separate auth, migration, dashboard, paid and email flags. Deploy compatible private endpoints/no-store headers before clients; stage → small pilot → wider registration → paid/email release.
- [ ] Retain read/export and migration receipts during rollback. Remove obsolete local writers only after each category/origin has a completed import path and support runbook.
- [ ] Document explicit account-codebase deploy commands, backups/restore, billing reconciliation, import repair, source/delivery lag, queue failures and personal-data-safe logging. Follow existing CLAUDE.md deployment order whenever touching the public db shell.

**Gate:** every inventory row is accounted for; rollback does not revert to unscoped browser writes; deletion/recovery and billing reconciliation have been rehearsed in staging. No live card/charge used for automated tests.

## Review and verification contract

For each milestone, update its checkboxes and evidence only after the exit gate passes. Record changed paths, validation results and remaining limitations in the review. Use relevant Vitest tests (`npm run test:unit -- <paths>`), new account backend/emulator tests and targeted browser checks. Existing functions use `npm run functions:test`; the new codebase needs its own explicit test command at M0. Run typecheck/build for affected app entry points, relevant lint/i18n/entry-budget gates, and full release builds at rollout. Do not claim existing local-storage unit tests validate the new account boundary.

The design gate is executable: inspect imports for shared primitives, inspect new styles for palette literals/duplicate themes, verify computed token values and selected/focus states, and review screenshots for real pages in both appearances. Check the inherited shared-component behavior before adding visual overrides. Auth, profile, billing and alerts must look like the rest of Наясно.

## Decisions still required at their milestone

M0: identity project/location/IAM, shared package root, final support email/logo/legal URLs, and the `naiasno.bg` canonical-domain cutover. M4: measured quotas, supported event semantics and retention. M5: prices, grace/cancellation policies, seller/tax configuration and digest provider. These are explicitly bounded inputs; only the domain/brand inputs block releasing Google redirect authentication, not creating the forms, storage contract or shared-component screen fixtures.

Deferred: Team workspaces, custom avatar uploads, drag-and-drop widget canvas, seamless cross-origin SSO, new price thresholds and unlimited hosted AI. These require separate product/data/cost contracts.
