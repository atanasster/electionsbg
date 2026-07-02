# Code Review Report

**Date**: 2026-07-03
**Reviewed by**: AI Code Review Skill
**Project**: electionsbg (Наясно)
**Scope**: commit `92df5fb23` — "feat(db): every procurement page is DB-backed — JSON readers retired (phase 6)"

## Executive Summary

Overall code health: ✅ Good

This is a large (50-file, ~1800/2200 line) migration of every procurement page from static-JSON reads to a shared Postgres-backed `/api/db` route table, consumed identically by the Firebase Cloud Function and the Vite dev plugin. It is unusually well-executed for a refactor of this size:

- **No SQL injection.** Every query in `functions/db_routes.js` and the four new SQL schema files (`031`–`034`) uses parameterized placeholders; the only string-interpolated fragments splice in a hard-coded two-branch ternary (`"awarder"`/`"contractor"`), never client text.
- **Input validation is consistent** — `clampInt` (NaN-safe, range-clamped) and `s()` (trim + required) gate every route parameter.
- **Dev/prod parity is real, not aspirational** — both dispatchers import the same `DB_ROUTES` table and match routes identically; verified no divergent logic paths.
- **The deletion of dead JSON hooks/screens is clean** — grepped the full `src` tree for every deleted export (`useAwarder`, `useContractor`, `useContractorContracts`, `AwarderContractsScreen` and its tiles); zero stale references, so the build is not broken.

The main things worth fixing are two unbounded list queries that break the commit's own "LIMITs on unbounded lists" hardening claim, an inconsistent error-response policy on one non-DB route, a genuine (if minor) UI regression where the watchlist silently drops the "+ other currency" remainder display, and a stale/unsafe type cast on one hook whose return type no longer matches its data source (currently harmless because the one consumer doesn't touch the mismatched fields, but a latent trap for the next person who adds a field read).

**Quick Stats**:
- Files reviewed: 50 (full commit diff) + cross-referenced ~15 additional files for dead-reference and consumer checks
- Critical issues: 0
- Warnings: 8
- Suggestions: 7

---

## 🟡 Warnings

### [FINDING-001] `company-politicians` route has no LIMIT

- **File(s)**: `functions/db_routes.js` (lines ~505–511)
- **Category**: Performance / Consistency
- **Problem**: `SELECT politician, ref, kind, role, total_eur FROM company_politicians WHERE eik = $1 ORDER BY total_eur DESC NULLS LAST` returns the full row set for the EIK with no `LIMIT`. Every sibling list route in this file (`awarder-contracts`, `search`, `recent`, `person_associates`, `company_officers`, the ranking functions in the new SQL files) carries an explicit cap. The near-identical query embedded in the `company` route (line 111) *does* cap at `LIMIT 200`.
- **Failure scenario**: a data-quality anomaly or future bulk-linking bug inflates `company_politicians` rows for one EIK; `/api/db/company-politicians?eik=...` returns an unbounded, unpaginated payload directly to the client.
- **Suggestion**: add `LIMIT 200` (matching the `company` route's cap) unless there's a specific reason this one needs to be exhaustive.

### [FINDING-002] `company-counterparties` route is unbounded by design, contradicting the commit's stated hardening

- **File(s)**: `functions/db_routes.js` (lines ~378–410)
- **Category**: Performance
- **Problem**: The aggregate query groups all distinct counterparties for an EIK with no `LIMIT` — a code comment says "Complete (not top-50)," so this is intentional, but it does two full aggregate scans over `contracts` per request and contradicts the commit message's "LIMITs on unbounded lists" line.
- **Failure scenario**: a high-fan-out awarder (e.g. АПИ, with thousands of distinct contractors) queried repeatedly causes real latency/DoS-adjacent load, especially since this route gets the same 1h CDN cache as everything else (so the first hit after cache expiry pays the full cost).
- **Suggestion**: either document this exception explicitly in the commit/route comment as an intentional exclusion (it already has a partial comment — make it explicit that it's a known deviation from the LIMIT policy), or cap at a high-but-bounded number (e.g. 2000) with a "showing top N of M" affordance if the UI can support it.

### [FINDING-003] Inconsistent error-response policy — `scenarios` route leaks internal error text

- **File(s)**: `functions/index.js` (line ~362, `scenarios` POST `/submit`)
- **Category**: Security / Consistency
- **Problem**: Returns `{ error: "storage error", detail: String(e) }` to the client on any Firestore failure. Contrast with the `db` route's catch block (line ~492), which correctly logs server-side only and returns a generic `{ error: "db error" }`.
- **Failure scenario**: an unexpected Firestore error (auth failure, malformed doc, internal driver exception) surfaces raw error text — potentially internal identifiers or stack fragments — to any client hitting `/submit`.
- **Suggestion**: log `e` server-side and return the same generic shape the `db` route uses; drop `detail` from the client response.

### [FINDING-004] Watchlist silently drops the "+ other currency" display for company/awarder/place items

- **File(s)**: `src/data/procurement/useWatchlistActivity.ts` (Signature type + the company/awarder/place branch), `src/screens/ProcurementWatchlistScreen.tsx` (lines ~242–246)
- **Category**: Bug (regression) / Quality
- **Problem**: Before this commit, watch-item signatures were built from the same rollup payload the entity detail pages use (`ProcurementContractorRollup`/`ProcurementAwarderRollup`/`ProcurementBySettlementFile`), all of which carry `totalOther` (rare USD/GBP/CHF remainder amounts — see `src/lib/currency.ts`). The new `/api/db/watch-signature` response type (`Signature` in `useWatchlistActivity.ts`) has no `totalOther` field at all, so `WatchActivity.totalOther` is now always `undefined` for company/awarder/place watch items.
- **Failure scenario**: `WatchCard` in `ProcurementWatchlistScreen.tsx:242-246` branches on `a.totalOther` to decide whether to call `formatEurWithOther(...)` vs plain `formatEur(...)`. For any followed company/awarder/place that has a non-EUR remainder, the watchlist card now silently shows only the EUR total and drops the "+ X other currency" note that the entity's own detail page still shows — a quiet data-display inconsistency between the watchlist and the underlying entity page, not a crash.
- **Suggestion**: either add `totalOther` to the `watch-signature` SQL/route response, or intentionally document in the hook's header comment that the watchlist trades off currency-remainder fidelity for a lighter per-item payload (if that's an accepted tradeoff, it should be a deliberate decision, not a silent side effect of the migration).

### [FINDING-005] `usePepConnectedBySlug` casts a different payload shape into a stale return type

- **File(s)**: `src/data/procurement/usePepConnectedBySlug.ts` (line 41–42)
- **Category**: Type Safety
- **Problem**: `query.data.entries` comes from `useRefProcurement`, typed as `ProcurementMpConnectedContractor[]` (fields: `mpId`, `mpName`, `contractorEik`, `contractorName`, `relations`, `totalEur`, `totalOther`, `contractCount`, `awardCount`, `byYear`, `topAwarders`). It's force-cast via `as unknown as ProcurementPepConnectedEntry[]`, whose declared shape (`slug`, `name`, `tier`, `role`, `contractorEik`, `contractorName`, ...) doesn't match — `slug`/`tier`/`role`/`name` don't exist on the actual runtime objects.
- **Currently harmless**: verified the one consumer, `OfficialProcurementSection.tsx`, re-maps each entry through its own explicit field list (`contractorEik`, `contractorName`, `totalEur`, `totalOther`, `contractCount`, `awardCount`, `byYear`, `topAwarders`) — all fields that *do* exist on the real payload — so no `undefined` currently leaks into the UI.
- **Failure scenario (latent)**: the next person who adds a `.slug`, `.tier`, or `.role` read anywhere against `usePepConnectedBySlug`'s return value (the hook's public type promises those fields exist) will get silent `undefined` at runtime with no compiler warning, because the cast suppresses the mismatch.
- **Suggestion**: change the hook's declared return type to `ProcurementMpConnectedContractor[]` (matching what it actually returns) and drop the unsafe cast, the same way the sibling hooks `useMpConnectedByEik`/`usePepConnectedByEik` explicitly map fields instead of casting.

### [FINDING-006] `/api/db` cache-control assumes CDN keys on full query string, unstated in code

- **File(s)**: `functions/index.js` (lines ~485–489)
- **Category**: Consistency / Documentation
- **Problem**: The 1h `s-maxage` + `stale-while-revalidate` header is applied unconditionally to every `status === 200` response, including query-param-keyed routes (`person`, `company`, `contract`, `tender`, etc.). This is safe only if the CDN cache key includes the full query string — true today for Firebase Hosting/Cloud CDN rewrites, but nothing in the code asserts or documents this dependency.
- **Failure scenario**: if hosting config or a future rewrite rule ever normalizes/drops query strings from the cache key, different `eik`/`name`/`key` values would collide and serve each other's (public, non-PII) data. Low severity since no per-user/session data is served here, but worth a one-line comment so a future infra change doesn't reintroduce this silently.
- **Suggestion**: add a comment near the header-setting code noting the CDN-cache-key assumption explicitly.

### [FINDING-011] Empty-result state conflated with not-found state on two rewired screens

- **File(s)**: `src/screens/AwarderContractorsScreen.tsx` (line 87), `src/screens/CompanyAwardersScreen.tsx` (line 80)
- **Category**: Bug / Quality
- **Problem**: Both screens branch `if (!data || data.entries.length === 0) { /* render NotFound */ }`, treating "the API returned a valid payload with zero counterparties" the same as "the entity doesn't exist."
- **Failure scenario**: a newly-registered or newly-debarred company/awarder with a valid EIK but no contracts yet — `/api/db/company-counterparties` legitimately returns `{eik, name, entries: []}` — renders as a 404-style "not found" page instead of a valid entity page with an empty contracts table.
- **Suggestion**: split the conditions — `!data` (or an explicit `found: false`/404 from the API) → NotFound; `data.entries.length === 0` → render the entity header with an empty-state table/message.

### [FINDING-012] `useProcurementRankings` throws on failure while every sibling hook returns `null`, and the two consumer screens have no error UI

- **File(s)**: `src/data/procurement/useProcurementRankings.ts` (line 33), `src/screens/TopAwardersScreen.tsx` (line 20), `src/screens/TopMpsScreen.tsx`
- **Category**: Bug / Consistency
- **Problem**: `fetchRankings` does `if (!r.ok) throw new Error(...)`, unlike every other new hook in this commit (`useRiskIndexes`, `useCounterparties`, `useRefProcurement`), which resolve to `null` on a non-OK response. `TopAwardersScreen`/`TopMpsScreen` destructure only `{ data, isLoading }` from the hook — no `isError` handling.
- **Failure scenario**: a rate-limited or 500 response from `/api/db/procurement-rankings` throws inside the query function; with no `isError` branch in the consumer, the screen is stuck rendering its loading/empty state indefinitely instead of showing a retry/error affordance.
- **Suggestion**: either align this hook with its siblings (return `null` on failure) and have the screens handle the empty case, or keep the throw but add `isError` handling to both consumer screens.

---

## 🟢 Suggestions

### [FINDING-013] Dead types left behind in `dataTypes.ts` after the hook/screen deletions

- **File(s)**: `src/data/dataTypes.ts` (`ProcurementAwarderContractsFile` ~line 1511, `ProcurementContractorContractsFile` ~line 1500, `ProcurementIndexFile` ~line 1803)
- **Category**: Unused Code
- **Problem**: These types backed `useAwarderContracts`/`useContractorContracts`/`useProcurementIndex`, all deleted or rewritten in this commit. They're now unreferenced except by each other's JSDoc.
- **Suggestion**: delete alongside the next pass through this area; not urgent since they cost nothing at runtime.

### [FINDING-014] `useMpConnectedContracts`'s underlying fetch conflates "no ties" with "fetch failed"

- **File(s)**: `src/data/parliament/useMpConnectedContracts.tsx` (line ~34, `fetchRefProcurement`)
- **Category**: Quality
- **Problem**: Returns `null` on any non-OK HTTP response, identical to the legitimate "MP has no connected contractors" case.
- **Suggestion**: low-impact since this backs a secondary chip rather than a primary data view, but worth distinguishing a transient 5xx from a genuine empty result if this proves noisy in practice.

### [FINDING-015] `useProcurementRankings` and the top-contractors hook can't share a cache entry despite calling the same endpoint

- **File(s)**: `src/data/procurement/useProcurementIndex.tsx`, `src/data/procurement/useProcurementRankings.ts`
- **Category**: Performance
- **Problem**: Both fetch `/api/db/procurement-rankings` but use differently-shaped query keys (`["db","procurement-rankings",null,null,"top"]` vs `["db","procurement-rankings",from,to]`), so React Query can't dedupe them even when scoped identically.
- **Suggestion**: not currently co-located on one screen, so this is latent rather than active — worth unifying the key shape if a future screen needs both the top-N list and full rankings together.

### [FINDING-007] `retry` config inconsistency between the two new consolidated-payload hooks

- **File(s)**: `src/data/procurement/useRiskIndexes.ts`, `src/data/procurement/useProcurementRankings.ts`
- **Category**: Consistency
- **Problem**: `useRiskIndexes` sets `retry: false`; `useProcurementRankings`, introduced in the same commit for the same "big consolidated payload" pattern, omits it (defaults to React Query's retry-3). All the per-EIK manifest-style hooks in this diff consistently use `retry: false`.
- **Suggestion**: add `retry: false` to `useProcurementRankings` for consistency, unless retrying transient network failures on this particular endpoint is intentional.

### [FINDING-008] `TopAwardersScreen`/`TopMpsScreen` date-range chip guard changed from "data loaded" to "data.start truthy"

- **File(s)**: `src/screens/TopAwardersScreen.tsx` (~line 76), `src/screens/TopMpsScreen.tsx` (~line 116)
- **Category**: Quality
- **Problem**: The chip rendering `· {data.start}…{data.end}` now gates on `data?.start` rather than `data` existing. `useProcurementRankings`'s payload type allows `start: null` (e.g. for an "all years" window), so a legitimately-loaded payload with `start: null` would make the chip silently disappear instead of rendering something like "…{end}".
- **Currently low risk**: no `all`/`showAllYears` UI is wired to `useProcurementRankings`'s returned `all` field yet, so `start` is effectively never null in practice today.
- **Suggestion**: if the all-years toggle ships later, revisit this guard (e.g. gate on `data != null` and handle `start: null` explicitly in the label).

### [FINDING-009] `watch-signature` fetches remain one-request-per-followed-item

- **File(s)**: `src/data/procurement/useWatchlistActivity.ts` (`useQueries` over `entityItems`)
- **Category**: Performance
- **Problem**: This pattern predates the commit (it fired one static-JSON fetch per item before, now one DB round-trip per item) — not a regression introduced here, but the commit explicitly introduces batched/consolidated endpoints elsewhere (`procurement-risk-indexes`, `procurement-rankings`) for the same "avoid N+1" reason. `staleTime: Infinity` limits the cost to once per session, but a user following 20+ entities still triggers 20+ DB queries on first watchlist view.
- **Suggestion**: not urgent, but a `watch-signatures?items=[...]` batched route would match the design intent already established for the other new consolidated endpoints, if this ever becomes a hot path.

### [FINDING-010] `company-counterparties`/`watch-signature` string-interpolated column-name fragments deserve a guard comment

- **File(s)**: `functions/db_routes.js` (~lines 377, 427–429)
- **Category**: Documentation
- **Problem**: The only non-parameterized SQL in the file interpolates `${me}_eik`/`${other}_eik` built from a `side === "awarder" ? ... : ...` ternary. It's safe today (never touches client-supplied text), and the existing comment at line 377 does explain it — but it's the single spot in an otherwise fully-parameterized 543-line file where a future edit could accidentally widen the ternary to accept a client value.
- **Suggestion**: no code change needed; consider a one-line `// SECURITY:` prefix on the comment so it's harder to miss in a future diff review.

---

## 🏆 Top 3 Priority Fixes

1. **[FINDING-004]** — Watchlist drops the "+ other currency" display for company/awarder/place items. Low effort (add `totalOther` to the `watch-signature` payload, or explicitly document the tradeoff) but it's a real user-visible regression between this migration and the pre-migration behavior.
2. **[FINDING-001]** — Add a `LIMIT` to the `company-politicians` route to match every sibling list route and the commit's own stated hardening goal. Low effort, one-line fix.
3. **[FINDING-005]** — Fix the stale/unsafe type cast in `usePepConnectedBySlug`. Low effort (swap the return type + drop the cast), removes a latent trap for future edits even though it's harmless today.

---

## Summary Table

| Priority | Finding | File(s) | Category | Effort |
|----------|---------|---------|----------|--------|
| 🟡 P1 | [FINDING-001] `company-politicians` route has no LIMIT | `functions/db_routes.js` | Performance | Low |
| 🟡 P1 | [FINDING-002] `company-counterparties` unbounded by design | `functions/db_routes.js` | Performance | Low–Med |
| 🟡 P1 | [FINDING-003] `scenarios` route leaks internal error text | `functions/index.js` | Security | Low |
| 🟡 P1 | [FINDING-004] Watchlist drops "+ other currency" display | `useWatchlistActivity.ts`, `ProcurementWatchlistScreen.tsx` | Bug | Low |
| 🟡 P1 | [FINDING-005] Stale/unsafe type cast in `usePepConnectedBySlug` | `usePepConnectedBySlug.ts` | Type Safety | Low |
| 🟡 P1 | [FINDING-006] Cache-Control assumes CDN keys on full query string | `functions/index.js` | Documentation | Low |
| 🟡 P1 | [FINDING-011] Empty-result conflated with not-found | `AwarderContractorsScreen.tsx`, `CompanyAwardersScreen.tsx` | Bug | Low |
| 🟡 P1 | [FINDING-012] `useProcurementRankings` throws with no error UI in consumers | `useProcurementRankings.ts`, `TopAwardersScreen.tsx`, `TopMpsScreen.tsx` | Bug | Low |
| 🟢 P2 | [FINDING-007] `retry` config inconsistency | `useRiskIndexes.ts`, `useProcurementRankings.ts` | Consistency | Low |
| 🟢 P2 | [FINDING-008] Date-range chip guard change | `TopAwardersScreen.tsx`, `TopMpsScreen.tsx` | Quality | Low |
| 🟢 P2 | [FINDING-009] `watch-signature` remains N+1 | `useWatchlistActivity.ts` | Performance | Med |
| 🟢 P2 | [FINDING-010] Interpolated SQL fragment deserves a security comment | `functions/db_routes.js` | Documentation | Low |
| 🟢 P2 | [FINDING-013] Dead types left in `dataTypes.ts` | `dataTypes.ts` | Unused Code | Low |
| 🟢 P2 | [FINDING-014] Ambiguous null-on-error in `useMpConnectedContracts` | `useMpConnectedContracts.tsx` | Quality | Low |
| 🟢 P2 | [FINDING-015] Non-shareable cache keys for the same endpoint | `useProcurementIndex.tsx`, `useProcurementRankings.ts` | Performance | Low |
