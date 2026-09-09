# Code Review Report — authentication, personal storage and alerts

**Date:** 2026-09-09

**Project:** electionsbg / Наясно

**Reviewed using:** code-review skill

**Scope:** repository-wide discovery of browser persistence/auth/payment integration, followed by review of the relevant stores, consumers, alert feeds, routing, Firebase configuration and backend boundaries. This is a focused architecture audit for the requested implementation plan, not a full security certification or review of all data pipelines.

## Executive summary

The current public application provides useful local personal features with reusable UI and source-data APIs. It is not yet an account or subscription system. The main implementation work is a shared ownership boundary, durable alert events/read state, and a loss-safe migration—not just adding login forms.

**Overall: needs attention for the proposed account launch.** No existing private account data leak was established; no private account system currently exists. Public SQL/data endpoints are intentional and must remain isolated from future account records.

**Quick stats:** four current reliability findings; four architecture constraints; one consolidation opportunity. Eight targeted existing test files passed, 56 tests. Source/configuration review covered main, AI and news persistence paths; no live cloud configuration or billing account was inspected.

Implementation and dashboard proposal: [auth-membership-dashboard-v1.md](docs/plans/auth-membership-dashboard-v1.md).

## Critical findings

No P0 finding established within this scope. The authorization/cache constraints below are release gates for adding private records, not claims of an existing private-record incident.

## Warnings: current behavior

### F1 — [P1, Reliability] Saved dossiers can report success after persistence failed

**Files:** `src/data/procurement/projectStore.ts:93`, `src/screens/procurement/ProjectFileScreen.tsx:1996`.

**Problem:** `saveProject()` returns an ID even if storage is unavailable or `setItem` throws. Its caller immediately sets `saved=true`. A reader can see “Saved” while the dossier will disappear on reload. The shared URL can preserve a spec only if the user actually retains it.

**Suggestion:** return an explicit persistence result; the cloud adapter must await committed success before showing “Saved”. Preserve drafts and offer retry/export on failure. Do not carry this synchronous return contract into asynchronous storage.

### F2 — [P2, Reliability] Basket and procurement watchlist accept malformed array entries

**Files:** `src/data/prices/useBasket.ts:22`, `src/data/procurement/useWatchlist.ts:49`, `src/data/procurement/useWatchlist.ts:104`.

**Problem:** loaders check only that the outer JSON value is an array/object and cast the contents. For example, `[null]` is accepted as basket data; `inBasket()` later accesses `i.slug` and throws. Watchlist consumers similarly access `kind`/`id`. Snapshot maps accept arbitrary object shapes. Invalid but parseable data can break a personal feature and is unsafe as a migration input.

**Suggestion:** validate each entry from `unknown`, including IDs, strings, timestamp/number finiteness and size limits. Keep a recoverable rejected-item report during import. The person watchlist and saved-news parsers already demonstrate more careful validation; neither alone covers the new unified entity types.

### F3 — [P2, Completeness] Declaration following filters after a global 200-record cap

**Files:** `src/screens/person/useNewFilings.ts:29`, `src/screens/person/FollowingScreen.tsx:74`, `scripts/db/schema/pg/098_new_filings.sql:80`.

**Problem:** the browser loads at most 200 site-wide filings, then filters by the reader's followed slugs. A followed record outside that global window cannot appear, regardless of how small the personal list is. This bounds the existing recent-feed feature; it cannot provide a complete durable personal alert inbox.

**Suggestion:** match source events against subscriptions before paginating the personal inbox. Preserve the independent public new-filings feed. Give historical/backfill events an honest first-seen date and a distinct delivery policy.

### F4 — [P2, Error handling] New-filings failure is presented as no recent filings

**File:** `src/screens/person/useNewFilings.ts:34`.

**Problem:** the fetch does not check `response.ok`, non-array responses become `[]`, and rejected fetches also become `[]`. `FollowingScreen` then displays the same empty state as a successful response with no events. A failed source request is indistinguishable from “nothing new”.

**Suggestion:** expose loading/error/empty/success distinctly, retain the last successful data with a stale label, and offer retry. Private alert endpoints and their source adapters need the same distinction.

## Architecture constraints for implementation

### A1 — [P1 launch gate, Security] Private routes need a new ownership/cache boundary

**Files:** `functions/index.js:875`, `functions/sql_lib.js:97`, `firebase.json` (`/api/db/**` public cache header), `firestore.rules:1`.

**Problem:** existing SQL/data APIs are public. Origin restrictions and read-only SQL do not establish user identity or ownership. Personal state added to that corpus could become available through arbitrary SELECT or shared caches depending on grants/routes. Firebase Admin calls bypass client rules.

**Suggestion:** use a dedicated private account service that verifies Firebase ID tokens, derives UID, checks every nested resource, and sets private/no-store headers. Keep Firestore browser rules deny-all with the proposed API access model. Do not expose user records through public SQL, data export or bucket paths.

### A2 — [P1 launch gate, Identity] Main, AI and news are separate projects and origins

**Files:** `.firebaserc`, `firebase.json`, `functions/index.js:66`, `functions/index.js:214`.

**Problem:** projects have distinct Auth authorities by default, and localStorage/auth browser persistence are origin-scoped. Initializing each application against its Hosting project's default Firebase config would create separate account populations and possibly mismatched subscription ownership. Conditional secret discovery also makes an unscoped new billing export risky to deploy across existing projects.

**Suggestion:** choose a shared production Auth authority and explicit per-environment configuration. Separate billing/account codebase and deployment scope. Import from each origin, retain one UID, and document per-origin sign-in separately from future seamless SSO.

### A3 — [P1 launch gate, Isolation] Singleton stores/global infinite caches have no account lifecycle

**Files:** `src/data/prices/useBasket.ts:18`, `src/data/procurement/useWatchlist.ts:46`, `src/data/queryClient.ts:5`.

**Problem:** current state belongs to a browser, not a UID. Simply changing the backing persistence would leave a previous user's data in singleton memory and query caches unless all stores and requests are reset. Async responses may arrive after a switch.

**Suggestion:** owner-scoped hooks/cache keys, finite private caching, cancellation plus auth-generation checks, and explicit clearing on logout. One item per cloud document and revision-controlled mutations avoid whole-list replacement races across devices.

### A4 — [P2 design constraint, Alerts] Activity signatures and badges are not an event inbox

**Files:** `src/data/procurement/useWatchlistActivity.ts:256`, `src/data/procurement/useWatchlist.ts:167`, `src/layout/header/FollowingHeaderLink.tsx:18`, `src/data/myarea/useMyAreaAlerts.tsx`.

**Problem:** procurement marks positive net count/amount growth; decreases, equal-total changes and metadata modifications do not necessarily trigger it. Its badge is a browser cache recomputed on watchlist use. The header's declaration bell instead counts followed people, not unread events. Area feeds have another date/coverage contract. Combining those counts would give a misleading dashboard badge.

**Suggestion:** canonical source event identities, persistent per-user receipts/read state, one deduplicated unread count and source freshness/coverage indicators. Keep existing signatures only as legacy baseline metadata. Preserve `ALERT_KIND_META` date-basis semantics rather than deriving recency from an arbitrary date string.

## Duplication report

### D1 — Two following models and repeated browser-store mechanics

**Occurrences:** `src/lib/watchlist.ts`, `src/data/procurement/useWatchlist.ts`, `src/data/prices/useBasket.ts`, plus news saved-content functions.

**Problem:** identity, subscriptions, listeners, persistence and failure behavior are implemented differently. Declaration follows use person slugs while procurement person follows use MP IDs. Dossier IDs use truncated title slugs, intentionally overwriting by title in the existing local model; that is unsuitable as durable cloud identity.

**Suggestion:** common typed account list/item API with domain-specific views. Keep basket calculation and dossier resolution specialized. Separate saved membership from monitored event kinds, reconcile person references against the serving identity layer, and use immutable cloud dossier IDs with explicit revisions.

## Testing gaps

Existing tests validate local behavior, not an account boundary. Add these as implementation work:

1. Mutation failure with retained draft and truthful UI; corrupt-but-parseable storage entries; partial import with retries, conflicting titles, stale slugs, exceeded quotas and deleted-item replay.
2. Cross-user API access, nested ownership, plan-field injection, concurrent quota races, logout/account-switch with delayed requests and direct Hosting/function cache behavior.
3. Event matching before pagination, identical events from multiple lists, corrections/decreases, backfills, mark-all during new arrivals, read/archived counter reconciliation, and visible upstream errors.
4. Duplicate and out-of-order Stripe webhooks, concurrent checkout/customer creation, delayed payment confirmation, cancellation, downgrade, payment repair and account deletion with late billing events.
5. Auth forms, action links, provider linking, mobile redirect/browser-storage restrictions, keyboard/focus/BG/EN and cross-origin account behavior.

Meaningful integration tests require Auth/Firestore emulators and Stripe test mode. No live-account or payment tests were run for this planning task.

## Documentation gaps

- `src/routes.tsx:1830` is called `AuthRoutes` but does not authenticate. Rename or document it during auth integration to avoid confusing route composition with access control.
- `src/lib/watchlist.ts:1`, the following screen/hook and local-only UI copy encode an intentional privacy promise that this user request changes. Replace current product promises alongside the migration; preserve historical design records.
- `src/data/area/AreaAnchorProvider.tsx:1` already documents URL precedence. Saved default places must respect it; “My Area” is not an undiscovered browser database to migrate.
- Existing deployment scripts ship individual public functions/hosting; document new private function, webhook, worker, environment and recovery procedures explicitly.

## Top three priorities

1. **A1/A2/A3:** establish one identity and private account boundary, with tested logout and cross-user isolation. Effort: large.
2. **F1/F2/D1:** build truthful asynchronous saves and a validated, resumable migration preserving existing content. Effort: medium/large.
3. **F3/F4/A4:** implement a reliable inbox before advertising paid alerts. Effort: large.

## Validation performed

Command: `npx vitest run src/data/prices/useBasket.test.ts src/lib/watchlist.test.ts src/data/procurement/projectStore.test.ts src/screens/person/FollowingScreen.test.tsx src/layout/header/FollowingHeaderLink.test.tsx src/data/myarea/useMyAreaAlerts.test.tsx newsapp/app/components/savedNews.test.ts newsapp/app/briefing.test.ts`.

Result: **8 files, 56 tests passed**, reported test duration 1.84s. No application source was changed. A full production build/data reload was unnecessary for these planning documents and was not run. The workspace contained unrelated concurrent work; it was not modified by this audit.

## Summary table

| Priority | Finding | Category | Effort |
| --- | --- | --- | --- |
| P1 | F1: successful-save UI after failed persistence | Reliability | Small locally; medium with cloud migration |
| P2 | F2: malformed stored entries accepted | Validation | Medium |
| P2 | F3: personal feed filtered after global cap | Completeness | Medium/large |
| P2 | F4: failed feed becomes empty | Error handling | Small |
| P1 launch | A1: private API and cache boundary | Security | Large |
| P1 launch | A2: shared authority across projects/origins | Identity | Medium |
| P1 launch | A3: account-scoped state lifecycle | Isolation | Medium |
| P2 design | A4/D1: unified inbox/list semantics | Architecture | Large |
