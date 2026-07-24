# Cloud SQL deploy speed v1 — make the post-watch-report publish minutes, not an hour

## Context

After a `process-watch-report` run, the procurement corpus is published to prod with:

```bash
npm run db:load:pg:cloud && npm run db:load:tenders:pg:cloud && npm run db:load:awarder-seats:pg:cloud
```

This takes **over an hour**. It runs after every ingest day, so it is the single
longest step in the daily publish loop and the main reason the loop is not
automated end-to-end.

An earlier round of work already took the contracts leg from 4077s → 722s by
converting `procurement_normalcy_cache` from a twice-built matview into a plain
table shipped from local (`buildOrShipNormalcy`, commit `baa47334d`), and did the
same for `tender_normalcy_cache` (`d39dbd860`, `51e55a3a6`). Since then the
tenders corpus roughly doubled (the pre-2020 РОП backfill: 126k → 232k rows) and
the total has crept back over an hour.

This plan finishes the job by generalising the pattern that already worked, and
by removing the structural sources of waste that survive it.

**Scope (operator directive 2026-07-24):** the whole Cloud SQL publish, not just
the three procurement commands — `db:load:tr:pg:cloud` (~18.6 min) and the other
30 `:cloud` scripts included. `lib/ship.ts`, `applyIfChanged` and `shipDelta` are
shared infrastructure from day one.

**Related:** [[reference_cloud_sql_deploy_perf]], [[reference_contracts_reload_lock]],
[[reference_pg_bulk_load_copy]], [[reference_pg_payload_determinism]],
`docs/plans/postgres-migration-v1.md`, `docs/plans/procurement-normalcy-v1.md`.

---

## Measured baseline (2026-07-24)

### The deploy ships ~2.3 GB to change 69 rows

From `ingest_batches` on prod (`127.0.0.1:5434`):

| id | source | rows shipped | rows new |
|---:|---|---:|---:|
| 142 | `tender` | 232,260 | **67** |
| 141 | `shards` (contracts) | 403,997 | **2** |

### Cloud table sizes

| table | rows | total size |
|---|---:|---:|
| `contracts` | 357,010 | **1732 MB** |
| `tenders` | 231,920 | **564 MB** |
| `procurement_normalcy_cache` | 403,203 | 376 MB |
| `tender_normalcy_cache` | 232,260 | 138 MB |
| `awarder_risk_grade_scoped` | 12,279 | 5.4 MB |
| `awarder_seats` | 3,845 | 736 kB |

### Every derived cache is tiny — and is computed on a 0.5-vCPU instance

| matview | rows | size |
|---|---:|---:|
| `procurement_overview_cache` | 1 | 56 kB |
| `procurement_by_settlement_cache` | 1 | 80 kB |
| `procurement_rankings_cache` | 1 | 160 kB |
| `procurement_risk_indexes_cache` | 1 | 344 kB |
| `awarder_totals` | 4,411 | 456 kB |
| `awarder_kindex_ranking` | 435 | 176 kB |
| `awarder_risk_grade_ranking` | 1,161 | 304 kB |
| `sector_contractor_stats` | 40,605 | 5.5 MB |

Total derived-cache output for the contracts path: **~7 MB**, recomputed from
1.7 GB of input on `db-g1-small` (shared-core ~0.5 vCPU, 1.7 GB RAM,
`shared_buffers` 128 MB).

---

## Root causes

### RC1 — Five caches are built twice per load, the first time against stale data

`025_procurement_overview.sql`, `030_procurement_by_settlement.sql`,
`031_procurement_rankings.sql` and `033_procurement_risk_indexes.sql` each contain:

```sql
DROP MATERIALIZED VIEW IF EXISTS procurement_overview_cache;   -- unconditional
...
CREATE MATERIALIZED VIEW IF NOT EXISTS procurement_overview_cache AS
  SELECT procurement_overview(NULL, NULL) AS r;                -- no WITH NO DATA
```

These run in the schema-apply block at [`load_pg.ts:276-287`](../../scripts/db/load_pg.ts) —
**before** `readShards()` and before the merge. So:

1. The `DROP` removes a populated cache.
2. The `CREATE` (no `WITH NO DATA`) immediately builds a full-corpus aggregate
   **against the previous corpus** — 100% throwaway work.
3. `REFRESH MATERIALIZED VIEW` at [`load_pg.ts:543-549`](../../scripts/db/load_pg.ts)
   builds the same aggregate again, correctly.

This is exactly the pattern that cost ~40 of the original 68 minutes on normalcy.
`077_dual_corpus_rankings.sql` already gets it right (`WITH NO DATA`) and is the
model to copy. The `IF NOT EXISTS` on the `CREATE` is dead code — the preceding
`DROP` is unconditional.

**The tenders side has the same defect** (found in audit, see G5):
`044_procurement_ai.sql:140,215` DROP+CREATEs `kzk_appeals_summary_cache` with no
`WITH NO DATA`, and [`load_tenders_pg.ts:243`](../../scripts/db/load_tenders_pg.ts)
REFRESHes it — built twice. `042_kzk_appeals.sql:142,152` DROP+CREATEs
`appealed_ocids` and `upheld_ocids` (built once, but see RC6).

Secondary cost: **~40 sequential DDL round-trips** over the Cloud SQL proxy per
contracts load, essentially all of them no-ops on an unchanged schema.

### RC2 — The full corpus is re-shipped every run regardless of churn

`load_pg.ts` COPYs all 403,997 rows into `contracts_stage` then MERGEs;
`load_tenders_pg.ts` TRUNCATEs and COPYs all 232,260 rows. Typical daily churn is
2 and 67 rows respectively. Over 99.98% of the transfer is redundant.

Shard mtimes are **not** a usable churn signal — the ingest rewrites untouched
shards (2013 month files were touched within the last 3 days with no content
change). Any delta scheme must be content-hash based.

### RC3 — Cloud recomputes what local already computed

Beyond the four caches in RC1: `awarder_totals`, `sector_contractor_stats`,
`dual_corpus_rankings_cache`, `awarder_kindex_ranking`,
`awarder_risk_grade_ranking`, `rebuildRiskGradeScoped` (~32 windows: 2011..2026
plus one per election plus `all`), `kzk_appeals_summary_cache`,
`rebuild_consortium()`, `resolve_contract_unp()`, `enrich_contract_lot_names()`.

Every one of these is a deterministic function of tables that `db:refresh` has
already loaded identically on local Docker (dedicated cores) minutes earlier. The
orchestrator's Step 2b runs the local refresh **before** emitting the cloud
loaders, so local is always current at cloud-load time — this precondition is
already relied upon by `buildOrShipNormalcy`.

### RC4 — `tenders` still holds AccessExclusive for its whole COPY

[`load_tenders_pg.ts:174-187`](../../scripts/db/load_tenders_pg.ts) does
`TRUNCATE tenders` + a 564 MB streamed COPY inside **one transaction**. TRUNCATE
takes `AccessExclusiveLock` held until COMMIT, so every read of `tenders` blocks
for the entire multi-minute COPY, hits the serving pool's 10s `statement_timeout`,
and the tender routes return `db error` (Postgres 57014).

This is the identical bug fixed for `contracts` in `46cecf77` (staging merge) and
documented in [[reference_contracts_reload_lock]] — `tenders` never got the fix,
and has since doubled in size. **This is a live serving bug, not just a speed
problem.**

### RC6 — Every tenders load drops the serving view behind `/procurement/contracts`

`042_kzk_appeals.sql:142` is `DROP MATERIALIZED VIEW IF EXISTS appealed_ocids
CASCADE`. Verified on prod: `contracts_list` (relkind `v` — the view the contracts
browser and `/api/db/table` read) depends on `appealed_ocids`, so the CASCADE
drops it. It is recreated ~30 lines later by `SELECT rebuild_contracts_list()`,
but there is a window on **every** tenders cloud load where the contracts browser
has no view to read.

A second, independent availability defect alongside RC4, on the same command.

### RC5 — The instance is the wrong size for the job, and nothing is overlapped

`db-g1-small` is ~0.5 shared vCPU. Every server-side CPU step runs 10-20× slower
than local Docker. The three loads also run strictly serially even though
`awarder-seats` is fully independent.

---

## Target architecture

> **Cloud SQL is a replica, not a compute engine.**

Local Docker Postgres computes the final state of every procurement table —
merge, consortium attribution, unp resolution, lot-name enrichment, and all
derived caches. The cloud step becomes a **content-hash delta sync of
final-state tables**: ship the rows that actually differ, ship the ~7 MB of
derived caches, run nothing expensive server-side.

This is not a new idea in this codebase; it is the `buildOrShipNormalcy` pattern
applied consistently instead of once per emergency.

Two invariants make it safe, both already true:

- **Local is current before the cloud load.** All ingest runs locally via
  `process-watch-report` (operator rule, confirmed against Step 8); the cloud
  loaders are emitted as Next-steps. Verified empirically: `contracts`, `tenders`,
  `awarder_seats`, `kzk_appeals` and `transport_project_link` are row-identical
  local↔cloud today. **But this must be asserted, not assumed** — see G16/G20 for
  the required pre-flight guards, and G17 for the six paths that still write to
  cloud directly.
- **The serving layer never writes.** `functions/db_routes.js` and
  `functions/index.js` contain no `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` against
  these tables (verified). Cloud has no independent state to preserve.

---

## Phases

Phases are ordered by (confidence × win) ÷ effort. Phase 0 gates the rest: the
per-phase win estimates below are **inferences from structure**, not measurements,
and Phase 0 exists to replace them with numbers before the expensive phases are
built.

---

### Phase 0 — Instrument the loaders (prerequisite, ~1h)

**Problem.** There is no per-phase timing anywhere. `load_pg.ts` logs one total at
exit; `load_tenders_pg.ts` the same. Every claim in this document about *where*
the hour goes is inference.

**Change.** Add `scripts/db/lib/step.ts`:

```ts
// Label + time one load phase. Logs "  [ 12.3s] refresh procurement_overview_cache"
// and accumulates a summary table printed at exit, so a cloud load produces a
// profile instead of a single wall-clock number.
export const step = async <T>(label: string, fn: () => Promise<T>): Promise<T>
export const stepSummary = (): string
```

Wrap every `exec(...)`, `REFRESH`, COPY, MERGE and helper call in `load_pg.ts`,
`load_tenders_pg.ts` and `load_awarder_seats_pg.ts`. Print `stepSummary()` sorted
descending by duration in the success path.

**Verification.** One local `db:refresh` (fast) confirms the labels are complete
and the total reconciles. Then **one instrumented cloud run** produces the
baseline profile. Everything after this is decided against that profile.

**Deliverable.** A phase profile committed to this document as "Measured
baseline, instrumented".

**Risk.** None — logging only.

---

### Phase 1 — Stop the double-build and the no-op DDL storm (free; do with Phase 0)

Two independent fixes, both zero-risk.

#### 1a. `WITH NO DATA` on the four caches

In `025`, `030`, `031`, `033`, append `WITH NO DATA` to the
`CREATE MATERIALIZED VIEW`, matching `077_dual_corpus_rankings.sql:109-111`. The
post-merge `REFRESH` in `load_pg.ts` is what populates them today anyway, so
correctness is unchanged and one full-corpus aggregate build per cache is removed.

**Tradeoff to be aware of:** with `WITH NO DATA`, a load that *fails between the
DROP and the REFRESH* leaves the cache unreadable rather than stale-but-populated,
so `/procurement` overview/rankings/settlement/risk tiles 500 until the next
successful load. Today's behaviour is a shorter gap (drop → create) but pays a
full build for it. Fix 1b removes the gap entirely in the common case, which is
why the two ship together.

#### 1b. `applyIfChanged` — skip DDL whose file hasn't changed

> **Prerequisite (audit G1): make the schema files pure DDL first.** Several files
> perform their data refresh *as a side effect of being applied* — `042` rebuilds
> `appealed_ocids`/`upheld_ocids` and calls `rebuild_contracts_list()`, `044`
> builds `kzk_appeals_summary_cache`, `005` backfills `changelog_days`. Hash-skipping
> those is a correctness regression. Hoist those side effects into the loaders
> **before** enabling the skip, and land `schema_pure_ddl.data.test.ts` in the same
> commit. This also fixes RC6: an unchanged `042` then never runs its
> `DROP … CASCADE`, so `contracts_list` stops disappearing mid-load.

Add to `scripts/db/lib/pg.ts` (or a new `lib/apply.ts`):

```ts
// Apply a schema file only when its content hash differs from the hash stamped in
// `meta` by the last successful apply against THIS database. Removes ~40 no-op DDL
// round-trips per cloud load — and, for the DROP+CREATE cache files, removes the
// drop/rebuild entirely on an unchanged schema (no serving gap, no wasted build).
//
// Stamped as meta['schema_hash:025_procurement_overview.sql'] = <md5>, written in
// the same transaction as the apply so a failed apply leaves no stamp.
export const applyIfChanged = async (file: string, opts?: { force?: boolean }) => …
```

Replace the ~40 `await exec(readFileSync(X, "utf8"))` calls in `load_pg.ts` (and
the equivalents in `load_tenders_pg.ts`) with `applyIfChanged(X)`.

Escape hatch: `--force-schema` (and `FORCE_SCHEMA=1`) re-applies everything,
for the case where cloud was mutated out-of-band and the stamp lies.

**Verification.**
- Local: `db:refresh` twice. Second run logs `schema: 0 applied, 41 unchanged`.
  `npm run test:data` stays green.
- Touch one byte in `025_procurement_overview.sql`; confirm only that file
  re-applies.
- Cloud: the Phase-0 profile shows the schema-apply block collapsing to near zero
  and the four double-builds gone.

**Expected win.** Removes 4 full-corpus aggregate builds + ~40 proxy DDL
round-trips per contracts load. On the evidence of the normalcy precedent (where
the same double-build pattern was ~40 of 68 minutes) this is plausibly the single
largest remaining item — but it is an inference, which Phase 0 will settle.

**Rollback.** Revert two commits; `--force-schema` restores the old behaviour
without a revert.

---

### Phase 2 — Ship the derived caches instead of computing them (medium effort)

**Change.** Generalise `buildOrShipNormalcy()` into one reusable helper rather
than adding a ninth hand-rolled copy:

```ts
// scripts/db/lib/ship.ts
//
// Compute-on-local, ship-to-cloud for a table that is a deterministic function of
// already-mirrored tables. LOCAL: run `build` in place. CLOUD (:5434): stream the
// local rows in by PG→PG COPY (copyTo → copyFrom) with a local-empty guard and a
// row-count parity check. Extracted from load_pg.ts buildOrShipNormalcy /
// load_tenders_pg.ts buildOrShipTenderNormalcy, which both become one-line callers.
export const buildOrShip = async (
  table: string,
  build: () => Promise<void>,
  opts?: { swap?: boolean },
) => …
```

Convert these from `MATERIALIZED VIEW` to plain tables + a build SQL file (the
`064` → `064`+`064b` split is the template), then route each through
`buildOrShip`:

| object | rows | build cost driver |
|---|---:|---|
| `procurement_overview_cache` | 1 | full-corpus aggregate |
| `procurement_rankings_cache` | 1 | full-corpus aggregate |
| `procurement_by_settlement_cache` | 1 | full-corpus aggregate + settlement join |
| `procurement_risk_indexes_cache` | 1 | full-corpus aggregate |
| `awarder_totals` | 4,411 | `GROUP BY awarder_eik` over 1.7 GB |
| `sector_contractor_stats` | 40,605 | CPV-division window functions |
| `dual_corpus_rankings_cache` | 1 | ЗОП × ИСУН EIK join |
| `awarder_kindex_ranking` | 435 | contracts × company_politicians |

**Appeal-derived — in v1 as of the 2026-07-24 directive (audit G2).**
`awarder_risk_grade_ranking`, `awarder_risk_grade_scoped` (~32 windowed rebuilds —
the biggest single CPU item in the load), `kzk_appeals_summary_cache`,
`appealed_ocids`, `upheld_ocids`. These read `kzk_appeals` / `buyer_appeal_stats`,
so shipping them requires **also** shipping those two base tables — which in turn
means building the missing `db:load:kzk:pg:cloud` (G17a), with union+COALESCE
reconciliation on first cut.

**`company_founded` must ship in the same commit as
`procurement_risk_indexes_cache` (audit G19).** It is 19,844 rows local vs **75 on
cloud** — a live divergence. Shipping the cache without the base table leaves the
cache asserting `newFirmWinner` flags that a live per-entity query on cloud cannot
reproduce: the exact `fn ≠ cache` confusion that cost hours on normalcy.

**`opts.swap`.** `buildOrShipNormalcy` currently does `TRUNCATE` + COPY in
autocommit, leaving a window where cloud reads an empty cache (noted as an
acceptable follow-up when it shipped). Since this plan multiplies the number of
shipped tables by ~10 — including the overview and rankings caches that front the
main dashboard — the helper should ship into `<table>_stage` and swap inside one
short transaction (`DELETE` + `INSERT … SELECT`, which takes RowExclusive, not
TRUNCATE's AccessExclusive). Do this once in the helper, not per caller.

**Determinism.** Established: [[reference_pg_payload_determinism]]. `percentile_cont`
and float sums differ cloud-vs-local at last-ULP because of parallel-aggregation
summation order, so any shipped payload must ROUND its float outputs and use
rounded sort keys with an `eik` tiebreak. Audit each converted build for
unrounded floats **before** shipping — this is the bug that made the normalcy
`fn ≠ cache` comparison confusing on cloud even though the shipped values were
correct.

**Ordering hazard.** `procurement_risk_indexes_cache` is also refreshed by
[`load_tr_pg.ts:447`](../../scripts/db/load_tr_pg.ts) and
`dual_corpus_rankings_cache` by [`load_funds_pg.ts:424`](../../scripts/db/load_funds_pg.ts).
Both must move to `buildOrShip` in the same commit, or a TR/funds load will
recompute on cloud what the contracts load just shipped.

**Duplicate-definition hazard.** Before converting any object, `grep` every
schema file for other definitions of the same name. `procurement_normalcy(text)`
was defined in **both** `063` and `064`; because `064` applied later, its stale
copy silently clobbered `063` on every load and the fix "wouldn't deploy" for
hours. Add a `test:data` guard (below) so this class of bug fails loudly.

**Verification.**
- Parity harness per object: `md5(string_agg(t::text, '|' ORDER BY <pk>))` +
  row count on local vs cloud after a ship. Must match exactly.
- New `scripts/db/tests/shipped_caches.data.test.ts`: for every shipped object,
  local build == shipped content, and every float field is rounded.
- New `scripts/db/tests/schema_no_dupe_defs.data.test.ts`: no function or matview
  name is defined in more than one `schema/pg/*.sql` file.

**Expected win.** Removes all remaining full-corpus aggregate CPU from the cloud
load; replaces it with ~7 MB of COPY.

**Rollback.** Each object is independent — revert one file to go back to
`REFRESH MATERIALIZED VIEW` for that object alone.

---

### Phase 3 — Delta-ship the corpus (medium-high effort, biggest transfer win)

Removes RC2: 2.3 GB → tens of MB.

#### The subtlety that shapes the design

A naive "hash live cloud rows vs incoming rows" delta is **wrong** here, for two
reasons:

1. `rebuild_consortium()` mutates `contracts` *after* the merge — it moves each
   joint award's full value onto one carrier row, **zeroes the member rows'
   `amount_eur`** (a `COLUMN_NAMES` column), and inserts synthetic `obed-…`
   carrier rows that exist in no shard. So the live table deliberately differs
   from the staged corpus for every consortium row.
2. Consequently `rebuild_consortium()` is only valid on a *freshly merged* corpus
   (`087_procurement_consortium.sql` says so explicitly). A delta that skips
   unchanged member rows would leave them zeroed and the rebuild would be invalid.

**Therefore the delta must mirror the FINAL state, not the shard state.** Local
runs the merge, `rebuild_consortium()`, `resolve_contract_unp()` and
`enrich_contract_lot_names()`; cloud receives the post-transform rows, including
`joint_kind` / `consortium_*` / `cais_id` / `lot_name`, and runs none of them.
This is what "cloud is a replica" means concretely, and it makes those four
post-load steps disappear from the cloud path for free.

#### Mechanism

Track what was shipped, so cloud never has to rescan 1.7 GB to compute its side
of the diff:

```sql
-- 094_shipped_digest.sql
CREATE TABLE IF NOT EXISTS shipped_digest (
  tbl text  NOT NULL,
  key text  NOT NULL,
  h   uuid  NOT NULL,          -- md5(row::text) of the row as shipped
  PRIMARY KEY (tbl, key)
);
```

~357k + 232k rows ≈ 25 MB on cloud. Written in the same transaction as the rows
it describes, so it can never claim a row was shipped that wasn't.

Load algorithm (`shipDelta(table, pk)` in `lib/ship.ts`):

1. **Local** computes a row hash over an **explicit column list** (`COLUMN_NAMES`
   plus the derived columns), floats `ROUND`ed and `extra_float_digits` pinned —
   **not** `md5(c::text)`, which depends on physical `attnum` order and float
   rendering and would silently degrade to a daily full re-ship (audit G3). Assert
   the local/cloud column signatures match before starting.
2. Stream those `(key, h)` pairs to cloud into an UNLOGGED `<tbl>_keys_stage`.
   357k × ~50 B ≈ **18 MB**, seconds over the proxy.
3. **Diff on cloud** (no scan of the big table — the digest table is the
   counterparty):
   - `needed` = keys in `_keys_stage` whose `h` is absent from or differs in
     `shipped_digest`
   - `removed` = keys in `shipped_digest` absent from `_keys_stage`
4. Ship `needed` back down: COPY the needed keys into a temp table on **local**,
   then `COPY (SELECT c.* FROM contracts c JOIN needed n USING (key)) TO STDOUT`
   → `copyFrom` into cloud `contracts_stage`.
5. In one transaction: upsert `contracts_stage` → `contracts` (existing
   `CONTRACTS_MERGE_UPSERT_SQL`), `DELETE` the `removed` keys, and update
   `shipped_digest` for both sets. RowExclusive only — readers never block.
6. Drop the stage tables.

Typical day: 18 MB of key hashes + 2 rows, instead of 754 MB.

**Transaction boundary (audit G14).** The row COPY into `contracts_stage` is
deliberately *outside* the merge transaction (so it never holds a lock); the merge
**and** the `shipped_digest` update are *inside* one transaction. A crash between
them must never leave the digest claiming rows that were not merged. First run
(empty digest) correctly degrades to a full ship.

**Excluded from the mirror (audit G4).** The changelog tables — `ingest_batches`,
`contract_first_seen`, `ingest_first_seen`, `changelog_days` — stay
**cloud-computed**. Their ids are per-database (cloud is at batch 142) and they
back served surfaces (`recent_updates`, "Последна активност"), so mirroring them
from local would clobber prod history. No new data is needed: `_keys_stage` from
step 2 already carries the full key set that `contract_first_seen`'s
`INSERT … ON CONFLICT DO NOTHING` consumes.

> **The 18 MB figure is contracts-only, and TR breaks it (audit G21).** With
> `db:load:tr:pg:cloud` in scope, `tr_companies` (1,019,272) + `tr_officers`
> (751,328) add ~1.77M keys ≈ **90 MB** of key hashes per run — on a table whose
> daily churn is a small delta. For TR the "optional" Merkle refinement below is
> **not optional**; size the design for TR, not for contracts.

#### Merkle refinement (optional for contracts, REQUIRED for TR — see G21)

Two-level Merkle: keep `shipped_digest_months(tbl, month, h)` alongside, ship the
few-hundred-row month digest first, and only ship keys for months whose digest
differs. Contracts and tenders are already month-sharded so the grouping is
natural. Cuts the steady-state transfer to a few hundred rows. **Not** in scope
for v1 — 18 MB is already ~40× better and the flat version is far simpler to
reason about.

#### Consistency guard

The digest table is a *trust* model: it records what we believe cloud holds. Add
`--verify` to do the full `md5(c::text)` rescan on both sides and reconcile
(expensive: a 1.7 GB seq scan on shared core, ~1-3 min). Run it weekly from the
orchestrator, on any load failure, and after any manual cloud intervention. A
mismatch triggers an automatic full re-ship of the affected table.

**Verification.**
- Byte-parity recipe from [[reference_pg_bulk_load_copy]]: capture
  `md5(string_agg(t::text,'|' ORDER BY key))` + count before and after; must be
  byte-identical to a full re-ship.
- Deliberate mutation tests: change one contract's amount locally → exactly one
  row ships; delete one → exactly one row deletes; add one → exactly one inserts.
- Idempotence: run the delta load twice; the second run ships **zero** rows.
- Consortium regression: a joint award's carrier/member split on cloud matches
  local exactly after a delta load (this is the case a naive delta breaks).
- `procurement_ingestion_regression.data.test.ts` and `goldens.data.test.ts`
  stay green.

**Rollback.** `shipDelta` keeps a `--full` mode that is the current
ship-everything path. One flag returns to today's behaviour.

---

### Phase 4 — Give `tenders` the staging-merge treatment (availability + speed)

Fixes RC4. Mirror what `contracts` already does in
[`load_pg.ts:306-344`](../../scripts/db/load_pg.ts):

1. COPY into an UNLOGGED `tenders_stage` on its own connection, **outside** the
   merge transaction.
2. `ALTER TABLE tenders_stage ADD PRIMARY KEY (unp)` (dedupe + merge-join speed).
3. `ANALYZE tenders_stage`.
4. In one transaction: upsert-on-conflict + anti-join delete + a live-vs-staged
   parity guard.

Add `TENDERS_MERGE_UPSERT_SQL` / `TENDERS_MERGE_DELETE_SQL` to
`lib/tenders_schema.ts`, derived from `COLUMN_NAMES` exactly as
`lib/procurement_schema.ts` does.

Ship this **before or with** Phase 3 — Phase 3 then plugs the delta into a merge
that already exists, and the availability bug is fixed independently of whether
Phase 3 lands.

**Verification.** Byte-parity before/after; 200+ concurrent tender reads during a
cloud load with zero blocked (the check used for the contracts fix); confirm no
`Lock/relation` waiters in `pg_stat_activity` behind a `COPY tenders` backend.

---

### Phase 5 — Orchestration (small, mostly free)

**5a. No-op guard.** Stamp the corpus aggregate hash in `meta` on success
(`contracts_corpus_hash`, `tenders_corpus_hash`). If the incoming hash matches,
skip the load entirely and log why. On a day with zero procurement churn — common
— the whole leg becomes one query. Composes naturally with Phase 3, which already
computes per-row hashes.

**5b. Parallelise.** `awarder-seats` (3,845 rows, ~3s) is fully independent — run
it concurrently. `contracts` and `tenders` interact only through
`resolve_contract_unp()` / `enrich_contract_lot_names()`, which both loaders
already re-run idempotently precisely so either order works — and under Phase 3
those move to local anyway. Worth little until Phases 1-3 land (on 0.5 vCPU,
overlap only helps the network-bound phases), so sequence it last.

**5c. Temporary instance scale-up.** Wrap the deploy:

```bash
gcloud sql instances patch electionsbg-pg --tier=db-custom-2-7680   # ~2 min restart
… loaders …
gcloud sql instances patch electionsbg-pg --tier=db-g1-small        # ~2 min restart
```

Cents per hour; documented as the biggest single lever and never actually tried.
It is a prod-DB mutation, so **the operator runs it** — the harness classifier
blocks it (same as the `--database-flags` patch). Keep it as a documented escape
hatch rather than a default: if Phases 1-3 land, the CPU it buys is CPU we no
longer spend.

> Note: a **permanent** RAM bump is a separate, already-justified question —
> `shared_buffers` is 128 MB against a ~5-6 GB hot working set, which is a
> *serving* latency problem (~480 ms cold heap reads), not a load problem. See
> [[reference_cloud_sql_deploy_perf]]. Do not conflate the two.

---

## Audit findings (2026-07-24) — required plan changes

The plan above was audited against the live databases before any implementation.
Four findings are **blocking**: the plan as originally written would have shipped
correctness bugs. They are folded into the phases above; this section is the
record of what was wrong and why.

### G1 (blocking) — `applyIfChanged` silently disables data refreshes hidden in DDL files

Several `schema/pg/*.sql` files are not pure DDL — their apply *is* the data
refresh. Hash-skipping them is a correctness regression, not an optimisation:

| file | hidden side effect | consequence of skipping |
|---|---|---|
| `042_kzk_appeals.sql` | DROP+CREATE `appealed_ocids`, `upheld_ocids` | **the only** refresh of these after a tenders load — `load_pg.ts:593-597` explicitly does *not* refresh them, and `kzk_appeals.ts:691-692` only runs on a КЗК ingest. Contracts-browser appeal badges and the CRI `procedureAppealUpheld` component go stale |
| `042_kzk_appeals.sql` | `SELECT rebuild_contracts_list()` | `contracts_list` not rebuilt after a `contracts` shape change |
| `044_procurement_ai.sql` | CREATE `kzk_appeals_summary_cache` with data | appeals tile stale |
| `005_ingest_tracking.sql` | `INSERT INTO changelog_days … SELECT … FROM ingest_batches` | changelog backfill skipped |
| `025`/`030`/`031`/`033` | CREATE cache with data | (harmless — the loader REFRESHes after) |

**Required change.** Do not add a `SIDE_EFFECT_FILES` allowlist — that preserves
the bug and adds a second place to forget. Instead **hoist the data side effects
out of the DDL files into the loaders**, where every other refresh already lives:
move the `appealed_ocids` / `upheld_ocids` refreshes and `rebuild_contracts_list()`
out of `042` into `load_tenders_pg.ts`, and the `changelog_days` backfill out of
`005`. Then every schema file is pure DDL and the hash-skip is sound by
construction. This also resolves RC6 for free (see G6).

Add `scripts/db/tests/schema_pure_ddl.data.test.ts`: fail if any `schema/pg/*.sql`
contains a top-level `INSERT`/`UPDATE`/`DELETE`/`REFRESH`/`SELECT <fn>()` or a
`CREATE MATERIALIZED VIEW` without `WITH NO DATA`. That is the guard that keeps
this class of bug from coming back.

### G2 (blocking) — Phase 2 silently changes who owns КЗК data

`kzk_appeals` is **not mirrored**. Per `update-kzk-appeals`, there is no
`db:load:kzk:pg:cloud` — "the crawl *is* the loader, which is why publishing means
re-crawling against the cloud URL". Local and cloud are populated by independent
crawls, and the 2,098 merits outcomes are interactively produced and explicitly
**unregenerable from committed code**, protected by `COALESCE(existing, EXCLUDED)`
upsert guards.

They agree right now (verified: 7,841 rows / 2,098 outcomes on both sides) but
nothing enforces it. Shipping from local would overwrite cloud's appeal-derived
state for `awarder_risk_grade_ranking`, `awarder_risk_grade_scoped` (via
`buyer_appeal_stats` — a *cloud-written* table), `kzk_appeals_summary_cache`,
`appealed_ocids`, `upheld_ocids` and `062_procurement_hub_counts`.

**Original required change (SUPERSEDED by the directive below — kept for the
record).** Split the Phase 2 ship list into "pure functions of mirrored tables"
(`procurement_overview_cache`, `procurement_rankings_cache`,
`procurement_by_settlement_cache`, `procurement_risk_indexes_cache` — verified to
contain no appeal reference — `awarder_totals`, `sector_contractor_stats`,
`dual_corpus_rankings_cache`, `awarder_kindex_ranking`) and "appeal-derived, do
not ship" (`awarder_risk_grade_ranking`, `awarder_risk_grade_scoped`,
`kzk_appeals_summary_cache`, `appealed_ocids`, `upheld_ocids`).

**Still required either way:** a pre-flight guard in `buildOrShip` — before
shipping anything appeal-derived, compare `(count(*), md5 of the outcome-bearing
rows)` on both sides and **abort** on divergence rather than overwrite.

> **RESOLVED 2026-07-24 by operator directive: all ingest happens locally via
> `process-watch-report`, so local IS authoritative.** The five deferred objects
> move back **into v1**, including `awarder_risk_grade_scoped` — the largest single
> CPU item in the load. Two consequences:
>
> 1. **`kzk_appeals` needs a ship path that does not exist yet.** Today there is no
>    `db:load:kzk:pg:cloud`; publishing means re-crawling against the cloud URL
>    (audit G17a). Building that wrapper — a `buildOrShip` of `kzk_appeals` +
>    `buyer_appeal_stats` from local — is now **in scope**, and it removes a live
>    network crawl from the prod publish path.
> 2. **The reconciliation must still be union+COALESCE on first cut, not a blind
>    overwrite.** The 2,098 merits outcomes are unregenerable, and cloud may hold
>    rows from a past cloud-only crawl that local never saw. Ship as
>    `INSERT … ON CONFLICT DO UPDATE` with the same `COALESCE(existing, EXCLUDED)`
>    guards the crawler uses on `outcome`/`suspension`/`status`/`unp`/`source_url`,
>    then verify counts match, then switch to a plain mirror in a follow-up once a
>    full cycle has confirmed parity. Counts agree today (7,841 / 2,098 both sides,
>    verified) so this should be a no-op — which is exactly the condition under
>    which it is safe to make the change.

### G3 (blocking) — the Phase 3 row hash is not portable, and fails silently

`md5(c::text)` renders columns in `attnum` order and floats via the
`extra_float_digits` GUC. `contracts` carries 4 `double precision` columns
(`amount`, `amount_eur`, `signing_amount_eur`, `consortium_full_eur`), and Cloud
SQL's flags are patched independently of local docker.

Column order matches today (verified: both sides hash to `ffcebd4f…`) but nothing
enforces it. If a future migration lands in a different order on the two DBs — or
a flag patch changes float rendering — **every row hashes differently, the delta
degrades to a full re-ship every day, and nothing errors.** A performance
optimisation that silently reverts is worse than not having it.

**Required change.** Hash an explicit, code-controlled column list derived from
`COLUMN_NAMES` plus the derived columns, with floats `ROUND`ed, and pin
`extra_float_digits` in the hashing session. At load start, assert that the local
and cloud *column-signature* hashes match and abort with an actionable message.

### G4 (blocking) — the changelog tables have no design, and the obvious answer destroys prod history

`contract_first_seen(key, batch_id)` FKs `ingest_batches(id)`, whose ids are
per-database (cloud is at id 142; local's sequence is independent). These feed
`recent_updates` and "Последна активност" — served surfaces
([[feedback_pg_changelog_required]], [[reference_two_changelogs]]).

Mirroring them would clobber cloud's changelog history with local's.

**Required change.** State explicitly that the changelog tables (`ingest_batches`,
`contract_first_seen`, `ingest_first_seen`, `changelog_days`) stay
**cloud-computed** and are excluded from the mirror. This is cheap and needs no
new data: Phase 3 step 2 already ships `_keys_stage` with the full key set, which
is exactly what `contract_first_seen`'s `INSERT … ON CONFLICT DO NOTHING` needs.
Add a test asserting cloud changelog rows are monotonic across a delta load.

### G5 — RC1 undercounted (folded in above)

Five double-builds, not four: `044`'s `kzk_appeals_summary_cache` is the fifth.

### G6 — RC6 was missing entirely (folded in above)

The `DROP … CASCADE` in `042` takes `contracts_list` with it on every tenders
load. Note the tension with G1: "always apply 042" would preserve the bug. The G1
fix (hoist refreshes into the loader, make `042` pure DDL) resolves both — an
unchanged schema then never drops anything.

### G7 — Phase 1a is deliberately throwaway; say so

The four caches getting `WITH NO DATA` become plain shipped tables in Phase 2.
Phase 1a is a ~1h stopgap that banks the win immediately. Flagged so nobody builds
on it.

### G8 — the local build budget is unmeasured

Phase 2 moves ~8 rebuilds onto local Docker, but `db:refresh` (local) is itself
part of the daily loop at orchestrator Step 2b. `awarder_risk_grade_scoped`'s ~32
windowed rebuilds may be minutes locally.

**Required change.** Phase 0 must instrument the **local** run too, and the
success criterion must be **total daily loop time**, not the cloud leg alone.
Otherwise the plan optimises a number by moving cost somewhere nobody measures.

### G9 — scope boundary (RESOLVED: everything is in scope)

**Operator directive 2026-07-24: `db:load:tr:pg:cloud` is in scope, as is
everything else.** The unit of work is the whole Cloud SQL publish, not the three
procurement commands.

That means all 30 `:cloud` npm scripts, and `lib/ship.ts` / `applyIfChanged` /
`shipDelta` are **shared infrastructure from day one**, not procurement-local
helpers retrofitted later.

`db:load:tr:pg:cloud` specifics (~18.6 min, [[reference_cloud_sql_deploy_perf]]):
COPYs are ~1.5 min each; the tail is index builds + the Awarder K-Index matview.
`tr_companies` (1,018,999 rows) and `tr_officers` (750,178) are prime delta-ship
candidates — TR churn is a daily-refresh delta, not a full rewrite. Its matviews
(`company_person_roles` 1.1M/272 MB, `owner_name_counts`, `officer_name_counts`)
are pure functions of those two tables and ship cleanly.

Ordering note: `load_tr_pg.ts:447` also refreshes `procurement_risk_indexes_cache`
and calls `rebuildRiskGradeScoped` — both now shipped objects, so TR must adopt
`buildOrShip` in the same commit as the contracts path or it will recompute on
cloud what contracts just shipped (G12).

### G10 — `--verify` cost is a guess with no failure path

"1-3 min" for a full `md5` rescan of 1.7 GB on 0.5 vCPU with 128 MB
`shared_buffers` is optimistic — near-zero cache retention plus ~900 MB of row
text to hash. Measure it in Phase 0 before promising a weekly cadence. The plan
also says a mismatch "triggers an automatic full re-ship" without saying who runs
`--verify`, where a failure surfaces, or what the operator sees. Wire it into the
orchestrator with an explicit alert path.

### G11 — no stated floor

Irreducible steady-state cost after all phases ≈ 18 MB of key hashes + ~7 MB of
caches + digest updates + the DDL round-trips. Estimate it so "<10 min" is
measured against something rather than being a wish.

### G12 — matview→table conversion needs a completeness sweep

Every `REFRESH MATERIALIZED VIEW <name>` in the repo errors once `<name>` is a
table. Known sites: `load_pg.ts` (7), `load_tenders_pg.ts:243`, `load_tr_pg.ts:447`,
`load_funds_pg.ts:424`, `kzk_appeals.ts:691,692,697,707`. Add a grep-based test
that no `REFRESH MATERIALIZED VIEW` names a converted object.

### G13 — `applyIfChanged` bootstrap ordering

The stamps live in `meta`, which `001_procurement.sql` creates. `000` and `001`
must always apply, or the helper must treat a missing `meta` as "apply
everything". Needs an explicit fresh-DB test.

### G14 — `shipped_digest` transaction boundary is under-specified

First run (empty digest → full ship) is correct but unstated. More importantly:
the stage COPY is deliberately *outside* the merge transaction while the digest
update must be *inside* it. Spell the boundary out, or a crash between them leaves
the digest claiming rows that were never merged.

### G15 — Phase 3 has an unmentioned cloud→local hop

Step 4 sends the `needed` key list cloud→local. Small, but real. Optional
follow-up: cache the digest locally with a generation counter so the 18 MB upload
is skipped when generations match — worth noting now rather than rediscovering it
mid-build.

---

## Ingest-locality audit (2026-07-24)

Prompted by the operator rule: **all ingest happens locally via
`process-watch-report`.** Audited to establish whether the "cloud is a replica"
premise actually holds today.

**The rule is the orchestrator's stated design.** Step 8 of `process-watch-report`:
"Each PG-backed skill reloads the LOCAL Postgres tables inside its own run …
Cloud SQL is a **production** target, so … do NOT auto-run it: instead emit the
matching `db:load:*:cloud` command(s)."

**Empirically local and cloud agree** on everything checkable (verified 2026-07-24):

| table | local | cloud |
|---|---:|---:|
| `contracts` | 406,640 | 406,640 |
| `tenders` | 232,260 | 232,260 |
| `awarder_seats` | 3,845 | 3,845 |
| `kzk_appeals` | 7,841 | 7,841 |
| `kzk_appeals` (outcome not null) | 2,098 | 2,098 |
| `transport_project_link` | 1,163 | 1,163 |
| **`company_founded`** | **19,844** | **75** |

So the premise holds — with one live exception (G19) and six process exceptions
(G17).

### G16 (blocking) — the plan breaks a documented orchestrator invariant

Step 8 states the cloud loaders are correct **independently** of local Postgres:

> "delegates to the base load — which reads the same fresh `data/` artifacts,
> `TRUNCATE`+reloads its table, AND rebuilds the dependent matviews /
> `awarder_risk_grade_scoped` **on cloud** … It reads the on-disk artifacts, not
> local Postgres, so it's **correct regardless of local PG state**."

This plan inverts that contract: after Phases 2-3 the cloud load is *only* correct
when local PG is current. The failure mode is silent — a cloud load run against a
stale local DB ships stale data with no error.

Note the invariant is **already broken**: `buildOrShipNormalcy` reads local `:5433`
and throws if the local cache is empty. The doc is stale today.

**Required change.** Update `process-watch-report` Step 8 in the same commit as
Phase 2, restating the contract as "the cloud load ships from local PG; local
`db:refresh` is a hard prerequisite". Add a **pre-flight assertion** to every
shipping loader: local's corpus stamp (`meta.generated_at` / corpus hash) must be
at least as new as cloud's, else abort with an actionable message. This is not
optional — it is the guardrail that makes the inverted contract safe.

### G17 — six paths still write to cloud directly, violating the local-ingest rule

| # | path | what it does | required action |
|---|---|---|---|
| a | `update-kzk-appeals` | **re-crawls the КЗК register against the cloud URL** — "the crawl *is* the loader" | build `db:load:kzk:pg:cloud` as a `buildOrShip` of `kzk_appeals` + `buyer_appeal_stats`. **Now in scope** — G2 depends on it |
| b | `update-agri` (`agri:ingest`) | re-runs the writer against the proxy | give it a ship wrapper, or document as a deliberate exception |
| c | `db:resolve:persons:cloud` | re-runs the **person resolver on cloud** (`--no-stamp`), reading cloud upstreams | resolver is expensive; ship `person_*` from local instead |
| d | `build:project-members:cloud` | rebuilds dossier members on cloud | ship from local |
| e | `prices:ingest:cloud` | full prices pipeline (re-cluster ~118k catalogue + payloads) on cloud | out of scope for this plan; already has its own daily cloud path ([[project_prices_pg_migration]]) — flag, don't touch |
| f | `fetch_company_founded.ts` | ~39h backfill written directly against the target DB | see G19 |

Each is a place the mirror model does not yet apply. (a) is the one this plan must
fix; (b)-(d) are follow-ups; (e) is explicitly left alone.

### G18 — three more cloud loads ride the procurement publish, uncounted

Step 8 emits, alongside the user's three commands:

```
npm run db:load:transport-project-map:pg:cloud
npm run db:load:water-operator-map:pg:cloud
npm run db:load:mvr-directorate-map:pg:cloud
```

…because they are contract-derived crosswalks that go stale on cloud whenever
contracts change (this is why `transport_project_link` drifted). They belong in the
Phase 0 profile and in the ship list. Note the Step-8 rationale — "their row counts
are legitimately NOT equal local↔cloud … cloud's corpus is fuller" — is **stale**:
`transport_project_link` is 1,163 on both sides and the corpora are identical. Once
they are shipped rather than recomputed, that caveat should be deleted from the
skill doc.

### G19 — `company_founded` is a live divergence, and shipping it changes prod behaviour

19,844 rows local (15,138 with a date) vs **75 rows (74 dated) on cloud**. Exactly
as Step 8 warns: "cloud currently holds only a stub, so the `newFirmWinner` flag is
dormant on prod."

`company_founded` feeds `procurement_risk_indexes_cache`
(`033_procurement_risk_indexes.sql:238-244`) — one of the caches certified "safe to
ship" under G2. Two consequences:

1. Shipping the cache **without** the base table leaves cloud asserting
   `newFirmWinner` flags a live per-entity query on cloud cannot reproduce. Ship
   `company_founded` in the same commit.
2. Doing so **lights up a risk flag that is currently dormant on prod**, for 15,138
   firms. That is a defensible fix — the stub is an accident, not a decision — but
   it is a **user-visible behaviour change arriving inside a performance plan**.
   Call it out explicitly at release; do not let it land silently.

### G20 — the mirror's anti-join DELETE is destructive if local ever falls behind

Phase 3 deletes cloud keys absent from local. If local is behind (a failed local
ingest, a fresh clone, a restored-from-older-dump local DB), that silently deletes
live prod rows.

**Required change.** Before any delta ship, abort unless local's row count is
within a configured tolerance of cloud's and local's corpus stamp is not older.
A shrinking corpus must require an explicit `--allow-shrink`. The counts agree
today, which is the right moment to install the guard — not after the first
incident.

---

## Final audit pass (2026-07-24) — G21-G25

Third pass, after the scope expansion. Verified: `tr_companies` (1,019,272) and
`tr_officers` (751,328) are **row-identical** local↔cloud, as are contracts,
tenders, awarder_seats, kzk_appeals and transport_project_link. Every object in
the Phase 2 ship list is populated locally. The mirror premise is empirically
sound across the expanded scope — `company_founded` (G19) remains the sole
divergence.

### G21 (blocking for TR) — the flat key-digest does not scale to TR

The 18 MB key-hash upload was sized on contracts (357k keys). TR adds ~1.77M keys
≈ 90 MB **per run**, to move a daily delta. That is a worse trade than the problem
it solves for the corpus's least-churning big table.

**Required change.** Promote the Merkle refinement from "optional v2" to part of
the Phase 3 design, and pick the grouping key per table: month for
contracts/tenders (already month-sharded), EIK prefix or first-letter bucket for
`tr_companies`/`tr_officers`. Ship the group digest first (hundreds of rows),
descend only into groups that differ. Size the design for TR.

### G22 (blocking for Phase 5b) — parallel loads collide on global stage-table names

`contracts_stage` and `price_stage` are unqualified, database-global names, and
Phase 3 adds `<tbl>_keys_stage` plus a single shared `shipped_digest`. Phase 5b
proposes running loads concurrently. Two loads in flight would corrupt each
other's staging silently.

**Required change.** Either (a) name stage tables per-run (`contracts_stage_<pid>`)
or use `CREATE TEMP TABLE` where the session lifetime allows, and (b) take a
`pg_advisory_lock` keyed on the table name for the duration of each ship, so a
second concurrent load blocks rather than interleaves. Do this **before** Phase 5b,
not as part of it.

### G23 — `db:refresh` does not load TR, so "local is current" is per-dataset

`db:refresh` covers contracts, tenders, funds, awarder-seats, schools,
admin-services, court-load, excise-warehouses, magistrates, the three crosswalk
maps, declarations, persons and person-elections. It does **not** run
`db:load:tr:pg` — TR arrives via `tr:daily-refresh`, and NZOK / NGO-funding / КЗК
have their own skills.

So the Phase 2/3 precondition is not "local `db:refresh` ran" but "**the local
loader for this specific dataset** ran". The G16 pre-flight assertion must
therefore be **per-table** (compare that table's local stamp against cloud's), not
one global corpus check. A single global gate would either block valid loads or
wave through stale ones.

### G24 — cross-DB tests cannot live in `test:data`

`docs/testing-standards.md`: unit tests never touch the network, and the
`scripts/db/tests/*.data.test.ts` exception queries **local** Postgres, auto-skipping
when unreachable. Only one existing test (`procurement_dossiers.data.test.ts`)
references the cloud proxy.

The tests proposed in this plan — `hash_portability`, `changelog_monotonic`, and
the local-vs-cloud parity harness — need **both** databases, and the cloud proxy
is normally down outside a publish window.

**Required change.** Add a separate gate (`npm run db:verify:cloud`, gated on an
env flag, auto-skipping when `:5434` is unreachable) rather than pushing these into
`test:data`. Keep `test:data` hermetic and local — it is a pre-commit gate and must
not depend on prod being reachable.

### G25 — the recovery path is unnamed

The plan says a `--verify` mismatch "triggers an automatic full re-ship" without
naming the mechanism. It already exists: `npm run db:sync:cloud -- --yes`
(pg_dump local → pg_restore cloud, destructive `--clean`) is precisely the
whole-DB reconcile the mirror model wants as its repair tool — and under this plan
its precondition ("local must be the source of truth first") becomes *permanently*
true rather than a caveat.

**Required change.** Write the escalation ladder down explicitly: per-table
`--full` re-ship → `db:sync:cloud -- --yes` → restore from `db:dump:cloud`
snapshot. And take a `db:dump:cloud` restore point **before** the first production
run of Phases 2 and 3, since both change how prod data is written.

### Housekeeping

- **Migration numbering.** 093 is the highest today. This plan needs at least: 094
  `shipped_digest`, 095 cache matview→table conversions, 096 `kzk_appeals` ship
  support. Allocate the block up front so parallel work does not collide.
- **`awarder_seats` stays as-is.** 3,845 rows, ~3s, multi-row INSERT. Under the
  mirror model it is trivially shippable but there is no win; leave it.

---

## Explicitly rejected

- **`db:sync:cloud` (pg_dump/pg_restore --clean) as the daily path.** Destructive,
  ships the entire ~8.75 GB database, drops and recreates every object, and resets
  session GUCs. It is the right tool for a full parity reset, not a daily delta.
- **CSV → GCS → `gcloud sql import csv`.** Genuinely bypasses the proxy and reads
  server-side at bucket speed, and would be the answer if the transfer had to stay
  full-corpus. Phase 3 makes the transfer small enough that the extra moving parts
  (bucket lifecycle, import job polling, CSV's NULL-vs-empty-string ambiguity —
  see [[reference_pg_bulk_load_copy]] on why these loaders use COPY *text*) are not
  worth it.
- **Converting `load_awarder_seats_pg.ts` to `copyRows`.** 3,845 rows, ~3s. The
  1000-row multi-row INSERT is fine. Not worth the parity re-verification.
- **Logical replication local → cloud.** Would subsume Phase 3 elegantly, but
  requires a permanent replication slot against prod, wal_level changes, and
  couples the prod schema to the local one on every migration. Too much standing
  infrastructure for a once-daily batch.

---

## Test plan

Added to `scripts/db/tests/` (all auto-skip when Postgres is down, per the
existing `*.data.test.ts` convention):

| test | asserts |
|---|---|
| `shipped_caches.data.test.ts` | every shipped cache: local build == shipped content; all float fields rounded |
| `schema_no_dupe_defs.data.test.ts` | no function/matview name defined in >1 `schema/pg/*.sql` (the `063`/`064` class of bug) |
| `schema_pure_ddl.data.test.ts` | **(G1)** no `schema/pg/*.sql` has a top-level `INSERT`/`UPDATE`/`DELETE`/`REFRESH`/`SELECT <fn>()`, and no `CREATE MATERIALIZED VIEW` lacks `WITH NO DATA` |
| `no_refresh_of_tables.data.test.ts` | **(G12)** no `REFRESH MATERIALIZED VIEW` anywhere in the repo names an object converted to a table |
| `hash_portability.data.test.ts` | **(G3)** local and cloud column signatures match; the row hash is stable across `extra_float_digits` settings |
| `changelog_monotonic.data.test.ts` | **(G4)** cloud `ingest_batches`/`changelog_days` only grow across a delta load |
| `apply_if_changed_bootstrap.data.test.ts` | **(G13)** a fresh DB with no `meta` applies every file; a second run applies none |
| `delta_ship.data.test.ts` | change/insert/delete one row → exactly one row ships; second run ships zero; consortium carrier/member split preserved |
| `tenders_merge.data.test.ts` | tenders merge is byte-identical to a full reload; parity guard fires on an injected mismatch |
| extend `manifest.data.test.ts` | `meta` carries a `schema_hash:*` stamp for every applied file |

Existing gates that must stay green throughout:
`npm run test:data` (`procurement_ingestion_regression`, `goldens`, `invariants_pg`,
`pg_roundtrip`, `copy`, `sector_stats`, `tender_normalcy`), `npm run functions:test`,
`npm run lint`, `npx tsc -b` (**not** `tsc --noEmit` — the root tsconfig is a
references stub and checks nothing).

Per-phase byte-parity recipe, non-negotiable before any loader change ships
([[reference_pg_bulk_load_copy]]):

```sql
SELECT count(*), md5(string_agg(t::text, '|' ORDER BY key)) FROM contracts t;
```

Capture before, reload, compare after — on **both** local and cloud.

---

## Sequencing and decision gates

| # | Phase | Effort | Gate |
|---|---|---|---|
| 1 | **Phase 0** instrumentation (local **and** cloud, per G8) | ~1h | produces the baseline profile |
| 2 | **G1 prerequisite** — hoist data side effects out of `schema/pg/*.sql` into the loaders + `schema_pure_ddl` test | ~2-3h | must precede Phase 1b; also fixes RC6 |
| 3 | **Phase 1** `WITH NO DATA` + `applyIfChanged` | ~2h | after step 2 |
| 4 | **re-measure** one cloud load | 1 run | **decision gate** — the profile decides whether Phase 2 or Phase 3 dominates |
| 5 | **Phase 4** tenders staging-merge | ~2-3h | ship regardless of profile: it is an availability bug |
| 6 | **Phase 2** ship derived caches (full list — G2 resolved) | ~1-2d | if profile shows server-side CPU dominates |
| 7 | **Phase 3** delta-ship corpus | ~2-3d | if profile shows transfer dominates |
| 8 | **Phase 5** no-op guard, parallelism | ~2-3h | cleanup |

Both prior open questions are now **resolved by operator directive (2026-07-24)**:
local is authoritative (G2) and everything including TR is in scope (G9). That
adds three work items to the critical path:

| # | added work | why |
|---|---|---|
| 2b | **pre-flight guards**: local-not-stale assertion (G16) + no-shrink guard (G20) | the inverted contract is unsafe without them; install before any shipping code |
| 6b | **`db:load:kzk:pg:cloud`** — ship `kzk_appeals` + `buyer_appeal_stats` from local, union+COALESCE | unblocks the five appeal-derived caches incl. `awarder_risk_grade_scoped` |
| 6c | **ship `company_founded`** with `procurement_risk_indexes_cache` (G19) | prevents cache≠fn on cloud; announce the `newFirmWinner` behaviour change |
| 7b | **TR delta-ship** — `tr_companies` (1.02M) + `tr_officers` (751k) + their three matviews, **Merkle-grouped** (G21) | ~18.6 min load, now in scope |
| 7c | **stage-table isolation + advisory locks** (G22) | must precede Phase 5b parallelism |

Also: update `process-watch-report` Step 8 alongside Phase 2 (G16, G18); make the
pre-flight staleness assertion **per-table**, not global (G23); add the
`db:verify:cloud` gate rather than extending `test:data` (G24); take a
`db:dump:cloud` restore point before the first prod run of Phases 2 and 3 (G25).

Phases 2 and 3 are independent and can land in either order — the profile from
gate 2 says which one to build first. Phase 5c is available at any point as a
blunt instrument if a specific night's deploy needs to be short.

**Success criterion.** The **full Cloud SQL publish** — the three procurement
commands, the three crosswalk maps (G18), and `db:load:tr:pg:cloud` (G9) —
completes in **under 15 minutes** on an unchanged `db-g1-small`, with zero
`/procurement` 500s during the window —
and (per G8) the **local** `db:refresh` leg does not grow by more than the cloud
leg shrinks. The measured target is total daily loop time, not the cloud leg
alone. The irreducible floor (G11) must be estimated from the Phase 0 profile
before this number is treated as achievable.

---

## Operational notes

- Long cloud loads must be launched with `run_in_background: true` — a foreground
  poll wrapper's SIGTERM kills the child mid-run ([[reference_cloud_sql_deploy_perf]]).
- To watch phases live: `pg_stat_activity` with `now() - query_start` and
  `left(query, 80)`. Do **not** `SELECT count(*)` on the loading table — it blocks
  behind the swap lock.
- The repo-local `.pgpass` must be passed as an **absolute** path
  (`PGPASSFILE=/Users/atanasster/data-bg/.pgpass`) when invoking `psql` by hand;
  `lib/pg.ts` resolves it automatically for the loaders.
- `.pgpass` is cloud-only — `db:dump` local does not need it.
