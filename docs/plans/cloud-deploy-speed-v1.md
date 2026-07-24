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
by removing the two structural sources of waste that survive it.

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

### RC1 — Four caches are built twice per load, the first time against stale data

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

- **Local is current before the cloud load.** `db:refresh` (local) runs in the
  orchestrator's Step 2b; the cloud loaders are Step 8.
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
| `awarder_risk_grade_ranking` | 1,161 | contracts × appeals × links |
| `awarder_risk_grade_scoped` | 12,279 | **~32 windowed rebuilds** |
| `kzk_appeals_summary_cache` | 1 | tenders × kzk_appeals |

`awarder_risk_grade_scoped` is already a plain table, so it needs no conversion —
only the local/cloud branch in `rebuildRiskGradeScoped`. It is the biggest single
item here: ~32 full windowed aggregates over the corpus on a shared core.

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

1. **Local** computes `SELECT key, md5(c::text)::uuid FROM contracts c` — full
   final-state row hash, including derived columns.
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

#### Optional refinement (defer unless Phase 0 says the 18 MB matters)

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
| 1 | **Phase 0** instrumentation + **Phase 1** double-build/DDL fix | ~2-3h | ship together; produces the baseline profile |
| 2 | **re-measure** one cloud load | 1 run | **decision gate** — the profile decides whether Phase 2 or Phase 3 dominates |
| 3 | **Phase 4** tenders staging-merge | ~2-3h | ship regardless of profile: it is an availability bug |
| 4 | **Phase 2** ship derived caches | ~1-2d | if profile shows server-side CPU dominates |
| 5 | **Phase 3** delta-ship corpus | ~2-3d | if profile shows transfer dominates |
| 6 | **Phase 5** no-op guard, parallelism | ~2-3h | cleanup |

Phases 2 and 3 are independent and can land in either order — the profile from
gate 2 says which one to build first. Phase 5c is available at any point as a
blunt instrument if a specific night's deploy needs to be short.

**Success criterion.** The three-command publish completes in **under 10 minutes**
on an unchanged `db-g1-small`, with zero `/procurement` 500s during the window.

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
