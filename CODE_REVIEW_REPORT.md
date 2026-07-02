# Code Review Report

**Date**: 2026-07-03
**Reviewed by**: AI Code Review Skill
**Project**: electionsbg.com (naiasno.bg)
**Scope**: last 2 unpushed commits — `92df5fb23` (feat: every procurement page is DB-backed — phase 6) and `ca900d9ef` (fix: apply phase-6 review findings). 53 files, +2135 / −2304.

## Executive Summary

Overall code health: ✅ **Good**

This is a large, well-executed migration retiring the static-JSON procurement readers in favor of a shared `/api/db` route table backed by new Postgres functions. The standout architectural win is `functions/db_routes.js` — one route table consumed by both the production Cloud Function and the Vite dev plugin, so **dev == prod by construction**. The second commit already resolved an earlier internal review's findings (error-text leakage, unbounded lists, honest types, empty-vs-error states), and it shows: the code is consistent, guarded, and self-documenting.

Verification I ran independently:
- `tsc --noEmit` — **exit 0** (no dangling imports from the 7 deleted hooks/screens/tiles).
- `eslint` on all changed source files — **exit 0**.
- All deleted files/hooks are **zero-referenced** in `src/`.
- SQL injection surface: the only interpolated identifiers (`me`/`other` in `company-counterparties` and `watch-signature`) are locked behind fixed two-branch ternaries with SECURITY comments — never derived from client text. All values are bound parameters.
- New i18n keys present and translated in **both** locales.
- Hardening confirmed: `statement_timeout: 10000`, per-IP sliding-window rate limit (120/min), 1h CDN cache with stale-while-revalidate, `pg_stat_statements` preloaded (extension created in `000_search_fns.sql`, matching the docker-compose `shared_preload_libraries`).

No Critical issues. One Warning (a fidelity regression on MP-connection chips), the rest are consistency/verification suggestions.

**Quick Stats**:

- Files reviewed: 53
- Critical issues: 0
- Warnings: 1
- Suggestions: 5

---

## 🔴 Critical Findings

None.

---

## 🟡 Warnings

### [FINDING-001] MP-connection chips lose relation fidelity and can render a bare "— "

- **File(s)**: `src/data/procurement/useMpConnectedByEik.tsx:60-66`; route `functions/db_routes.js:527-537` (`company-politicians`); render site `src/screens/ContractDetailScreen.tsx:459`
- **Category**: Data fidelity / UX regression
- **Problem**: The migration added a full `relations` jsonb column to `company_politicians` (schema `008` + loader `load_tr_pg.ts`), and the ref-procurement path uses it — but the `company-politicians` route still `SELECT`s only `politician, ref, kind, role, total_eur`. The chip hook therefore rebuilds each relation as `{ kind: row.role as ProcurementRelation["kind"] }`, dropping `isCurrent`, `shareSize`, and `confidence`. Consequences:
  1. Chips can no longer show "(former)" or "declared stake 50%" — capabilities `summarizeRelations`/`relationLabel` still fully support and that the old JSON shards carried.
  2. When every row for an MP has a null `role`, no relation is pushed, so `relations` is `[]`, and `ContractDetailScreen.tsx:459` renders `— ` (em-dash then empty string).
  3. `row.role as ProcurementRelation["kind"]` is an unchecked cast; an out-of-vocabulary DB role ships as a raw untranslated token (safe, since `relationLabel` falls back to `rel.kind`, but not ideal).
- **Suggestion**: Return the jsonb from the route and map it through instead of the flat `role`:
  ```js
  // functions/db_routes.js — company-politicians
  `SELECT politician, ref, kind, role, relations, total_eur AS "totalEur"
   FROM company_politicians WHERE eik = $1
   ORDER BY total_eur DESC NULLS LAST LIMIT 200`
  ```
  Then in `useMpConnectedByEik.tsx` build `relations` from `row.relations` (preserving `isCurrent`/`shareSize`) and fall back to `{ kind: row.role }` only when the jsonb is empty. Separately, guard the empty case at the render site so an MP with no resolvable relation doesn't show a dangling em-dash:
  ```tsx
  {e.relations.length > 0 && (
    <span className="text-xs text-muted-foreground">
      — {summarizeRelations(t, e.relations)}
    </span>
  )}
  ```

---

## 🟢 Suggestions

### [FINDING-002] `retry: false` is applied inconsistently across the new/changed hooks

- **File(s)**: `src/data/procurement/useCounterparties.ts:40`, `useProcurementByNs.tsx`, `useTender.tsx`, `useRoads.tsx` (`useAwarderContracts`), `useWatchlistActivity.ts` (`fetchContract`)
- **Category**: Inconsistency
- **Problem**: The project convention for these null-on-failure DB hooks is `retry: false` — `useRiskIndexes`, `useProcurementRankings`, `useTopContractors`, `useRefProcurement`, and `useCompanyPoliticians` all set it. But `useCounterparties` and a few siblings omit it, so on a network throw React Query retries 3× before settling. `useCounterparties` is the clearest case: `fetchCounterparties` returns `null` on `!r.ok` (so HTTP errors won't retry), yet a transport error still triggers three retries.
- **Suggestion**: Add `retry: false` to the four hooks above to match the family.

### [FINDING-003] `useRoads` headline totals are now derived, and the awarder name can fall back to an ЕИК

- **File(s)**: `src/data/procurement/useRoads.tsx`; render `src/screens/procurement/RoadsScreen.tsx:191`
- **Category**: Correctness (latent) / cosmetic
- **Problem**: `rollup.totalEur` / `contractCount` are recomputed by summing `useCounterparties` entries rather than reading an authoritative awarder total. This equals the true total **only while the counterparties grouping stays uncapped** — the `company-counterparties` route is deliberately unbounded today, but if a LIMIT is ever added the АПИ headline silently under-reports (breaking the "matches the site" invariant). Also, `name` falls back to `` `ЕИК ${cp.eik}` `` when `cp.name` is null, a cosmetic regression vs the real awarder name.
- **Suggestion**: Either have the endpoint return an authoritative rollup total, or add an assertion/comment that the grouping is uncapped-by-design so a future LIMIT is a conscious break. Prefer the real name when resolvable.

### [FINDING-004] `procurement_risk_indexes()` full-corpus scan not benchmarked

- **File(s)**: `scripts/db/schema/pg/033_procurement_risk_indexes.sql:44-46`; route `functions/db_routes.js:343`; consumer `src/data/procurement/useRiskIndexes.ts`
- **Category**: Performance / verification
- **Problem**: The CPV-baseline CTE aggregates `number_of_tenderers` and `left(cpv,2)` across the whole `contracts` corpus (~300k rows) with no selective WHERE and no supporting index — an inherent full scan for a lifetime index (no partial index helps a `GROUP BY left(cpv,2)`). It is mitigated in practice: the consumer uses `staleTime: Infinity` + `retry: false` and the route carries a 1h CDN cache, so this is a cold-cache-only cost. But per the repo's own "EXPLAIN ANALYZE every new query on the worst case before shipping" convention, the cold-path latency should be measured.
- **Suggestion**: `EXPLAIN ANALYZE SELECT procurement_risk_indexes();` on the full corpus; if it exceeds ~200ms consider a materialized result refreshed at ingest. Otherwise add a one-line comment noting the cold cost was measured and accepted.

### [FINDING-005] Watchlist and `useContract` share a cache key but diverge on error handling

- **File(s)**: `src/data/procurement/useWatchlistActivity.ts:82` vs `src/data/procurement/useContract.tsx`
- **Category**: Inconsistency (latent trap)
- **Problem**: Both fetch a contract under the same query key, but `useWatchlistActivity.fetchContract` returns `null` on non-OK while `useContract.fetchContract` **throws**. Whichever query populates the cache first wins; the return shapes are identical (`ProcurementContract | null`) so there's no data bug, but the mismatched error semantics under a deliberately-shared key is a latent trap.
- **Suggestion**: Align them — both throw, or both return null.

### [FINDING-006] `CounterpartyEntry.mpTied` is documented as inline but only consumed on one side

- **File(s)**: `src/data/procurement/useCounterparties.ts:15`
- **Category**: Documentation nit
- **Problem**: The header says "MP-tie badge included inline," but `mpTied` is only read on the awarder side (`AwarderContractorsScreen`); the contractor side (`CompanyAwardersScreen`) ignores it. Harmless (unused field), but the comment could note the field is side-dependent.
- **Suggestion**: One-line comment clarifying `mpTied` is only meaningful for `side: "awarder"`.

---

## 🔁 Duplication Report

No new duplication introduced. The migration **removed** duplication: the `CONTRACT_SQL` projection, `clampInt`, and the entire route table previously lived in both `functions/index.js` and `vite/db-api.ts`; they now have a single home in `functions/db_routes.js`. This is a net consolidation.

---

## 🧪 Testing Gaps

The project has **no test framework configured** (per CLAUDE.md), so this is consistent with the codebase rather than a regression. If tests are ever added, the highest-value targets from this change are:

### [TEST-001] SQL identifier-splice guard (security invariant)
- **Source**: `functions/db_routes.js` — `company-counterparties`, `watch-signature`
- **Why**: These are the only routes that splice identifiers into SQL. A test asserting that an arbitrary `?side=` / `?kind=` value can never reach the `${me}`/`${other}` slots (always collapses to the fixed two-branch ternary) would lock the security invariant against future edits.

### [TEST-002] Currency-remainder rollup (`totalOther`)
- **Source**: `useMpConnectedContracts`, `usePepConnectedBySlug`, `useWatchlistActivity`
- **Why**: EUR-vs-native split is the site's core money invariant. A unit test over the client-side `totalOther` merge would guard against a future refactor silently folding USD/GBP/CHF into the EUR total.

---

## 📚 Documentation Gaps

Documentation on this change is unusually strong — the route table, SECURITY invariants, the deliberately-unbounded exceptions, and the CDN cache-key assumption are all inline-commented. Minor items only:

### [DOC-001] `me`/`other` splice invariant lives in two routes — keep the comment identical
- **File(s)**: `functions/db_routes.js:382`, `:434`
- **Type**: Inline comment consistency
- **Suggestion**: Both SECURITY comments are correct; if either is ever edited, keep them verbatim so a reader grepping the invariant finds one canonical wording.

---

## 🏆 Top 3 Priority Fixes

1. **[FINDING-001]** — Restore MP-chip relation fidelity by returning the `relations` jsonb from the `company-politicians` route and guarding the empty-relations render. This is a real regression vs the retired JSON shards and the only user-visible correctness item. Effort: **Low**.
2. **[FINDING-002]** — Add `retry: false` to the four inconsistent hooks. Trivial, aligns with the established convention. Effort: **Low**.
3. **[FINDING-004]** — `EXPLAIN ANALYZE` the `procurement_risk_indexes()` cold path per the repo's own perf playbook; materialize only if it exceeds the 200ms bar. Effort: **Low**.

---

## Summary Table

| Priority | Finding | File(s) | Category | Effort |
| -------- | ------- | ------- | -------- | ------ |
| 🟡 P1 | [FINDING-001] MP-chip relations fidelity + em-dash | useMpConnectedByEik.tsx, db_routes.js, ContractDetailScreen.tsx | Data fidelity / UX | Low |
| 🟢 P2 | [FINDING-002] `retry: false` inconsistency | useCounterparties.ts +3 | Inconsistency | Low |
| 🟢 P2 | [FINDING-003] Roads derived totals + ЕИК name fallback | useRoads.tsx, RoadsScreen.tsx | Correctness (latent) | Low |
| 🟢 P2 | [FINDING-004] risk-indexes corpus scan unbenchmarked | 033_procurement_risk_indexes.sql | Performance | Low |
| 🟢 P2 | [FINDING-005] shared-key divergent error handling | useWatchlistActivity.ts, useContract.tsx | Inconsistency | Low |
| 🟢 P2 | [FINDING-006] `mpTied` side-dependent doc | useCounterparties.ts | Docs | Low |
