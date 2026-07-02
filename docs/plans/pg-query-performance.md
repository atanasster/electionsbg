# Postgres query performance — audit + index/aggregate playbook

The live pages (person, company, awarder tiles, SQL console) query Postgres
directly. This is the standing reference for keeping those queries fast as more
datasets migrate: the measured baseline, the query-shape taxonomy, the per-table
index inventory, and the rule for when to precompute an aggregate.

## 1. Audit — measured 2026-07-02 (local, PG16)

Table sizes: tr_companies 1.02M, tr_person_roles 1.01M, tr_officers 627k,
contracts 301k, tenders 125k, contractor_search 34k, company_politicians 119.

Company page (`/db/company/:eik`, `/api/db/company`) — worst case Софарма
(103267194, 5,481 contract rows, biggest contractor):

| Query | Plan | Time |
|---|---|---|
| `company_procurement(eik)` (8 aggregations) | Bitmap Index Scan `idx_contracts_contractor` → HashAggregate | **35 ms** |
| `byAwarder` GROUP BY (isolated) | Bitmap Index Scan → HashAggregate (229 groups) | 12 ms |
| `company_officers(eik)` (967 rows) | Index Scan `idx_tr_person_roles_uic` | 3 ms |
| `company_politicians WHERE eik` | Seq Scan (119-row table) | 0.04 ms |
| `SELECT … FROM tr_companies WHERE uic` | PK | <1 ms |

All index-driven; nothing to add for the company page.

**Bug found + fixed — `contracts.ocid` was unindexed.** The tenders lineage
LATERAL joins (`tenders_by_buyer`, `tenders_buyer_summary`, `tender_awards`) match
`contracts.ocid = tenders.ocid`, but the only ocid coverage was the
`(date, ocid, key)` composite — unusable for an ocid seek (leading column is
`date`). So the awarder tender pipeline seq-scanned contracts **per tender**:
Столична (3,024 tenders) took **13,992 ms**. Added `idx_contracts_ocid` →
**12.4 ms** (1,100×). `tender_awards` → 0.05 ms.

Global leaderboard for contrast — "top contractors over all 301k"
(`GROUP BY contractor_eik ORDER BY sum LIMIT 25`): parallel seq scan +
HashAggregate, **134 ms**. Served today from static JSON
(`derived/top_contractors.json`), not live — so no live pressure yet. This is the
one shape that warrants precomputation if it ever renders live.

## 2. Query-shape taxonomy (the five shapes)

Every query the app runs (now or after full migration) is one of these. The
strategy is per-shape.

**S1 — Point lookup** (one entity by id): `WHERE uic/key/unp = $1`. PK/unique
index. Microseconds. Nothing to tune.

**S2 — Entity fan-out aggregation** (an entity's slice → sum/count/group/top-N):
the entity pages. `WHERE <fk> = $1` then aggregate the returned slice in memory.
Cost = slice size, not table size. **Needs: a btree on the FK.** 3–35 ms for
slices up to ~5–10k rows. This is the dominant shape and it's cheap **as long as
the FK is indexed**.

**S3 — Cross-entity join** (lineage + the unified graph): `a.k = b.k` across
tables — tenders↔contracts (`ocid`), and an EIK fanned across
contracts/tenders/funds/tr_*. **Needs: a btree on BOTH sides of every join key.**
The ocid bug lived here: one side (tenders.ocid) was indexed, the other
(contracts.ocid) wasn't, so a LATERAL seq-scanned per row. Audit both sides of
every new join.

**S4 — Global leaderboard / national aggregate** (whole-corpus group + sort):
top-N contractors/awarders nationwide, national totals. Whole-table scan →
100 ms–seconds; grows with the table. **Strategy: precompute** (static JSON, or a
materialized view / rollup table) when rendered live + hot. Live-ad-hoc (SQL
console) can eat the scan.

**S5 — Time-series** (filter by date-range + a dimension): the future prices /
votes shapes. `WHERE dimension = $1 AND date BETWEEN …`, plus rolling
aggregates. **Needs: a composite `(dimension, date)` btree**, and — as history
grows — range partitioning + a materialized rolling aggregate.

## 3. Per-table index inventory

Existing (✓ = adequate for its shapes):

- **contracts** — contractor_eik ✓, awarder_eik ✓, tag ✓, (date,ocid,key) ✓,
  **ocid ✓ (added 2026-07-02)**, key PK ✓. Covers S2 (both entity sides) + S3
  (ocid).
- **tenders** — buyer_eik ✓, ocid ✓, (publication_date,unp) ✓, is_cancelled ✓,
  buyer_fold/subject_fold GIN ✓, unp PK ✓. Covers S2/S3/search.
- **tr_companies** — uic PK ✓, name_fold GIN ✓, last_updated ✓ (recent_updates).
- **tr_officers** — uic ✓, name_fold GIN + eq btree ✓, changed_at ✓.
- **tr_person_roles** — uic ✓, name_fold ✓.
- **company_politicians** — eik ✓ (119 rows; index optional but present).
- **contractor_search** — eik ✓, name_fold GIN ✓.

Planned (add with each migration):

- **fund_projects** (funds) — `beneficiary_eik` btree (S2 company/person funds),
  `beneficiary_fold` GIN (search), `program_code` btree if per-programme pages.
- **price_obs** (prices) — `(ekatte, product_id, date)` + `(product_id, date)`
  composites (S5); consider `(chain_id, date)`. Partition by month as it grows.
- **votes** — `mp_id` btree (per-MP record), `session_id` btree (per-session);
  similarity is O(MP²) → precompute, don't index your way out.

## 4. When to precompute an aggregate (the decision rule)

Default is **live** (S1/S2/S3 are all fast with the right btree). Precompute only
when one of these holds:

1. **Global/whole-corpus AND live AND hot** (S4) — e.g. a national top-N rendered
   on a landing page. Mechanism: keep it static JSON (the current approach), or a
   `MATERIALIZED VIEW` refreshed by the loader.
2. **A per-entity aggregation measured > ~200 ms** — hasn't happened yet (worst is
   35 ms); would need an entity with tens of thousands of rows. If it appears, a
   rollup table keyed by the entity id, filled in the load transaction.
3. **Combinatorial** (O(n²) or worse) — vote similarity/cohesion across MPs.
   Precompute the matrix; never compute live.

Do **not** precompute speculatively — an unindexed live query that turns out slow
is a one-line `CREATE INDEX`; a premature materialized view is refresh logic,
staleness, and distribution weight forever. Measure (EXPLAIN ANALYZE on the
worst-case entity), then decide.

Mechanism when it's warranted: prefer a **rollup table filled by the loader**
(deterministic, ships in the pg_dump snapshot, no refresh race) over
`REFRESH MATERIALIZED VIEW` (needs a trigger/cron). Both beat recomputing live.

## 5. Cross-cutting: the unified entity-page budget

A company/person/awarder page is N shape-S2/S3 lookups in parallel
(`Promise.all`): contracts by contractor_eik, funds by beneficiary_eik, tr_* by
uic, politicians by eik, (awarder side) tenders by buyer_eik. Each 3–35 ms on an
indexed FK, run concurrently → page well under ~150 ms even after every dataset
lands. The invariant that keeps this true: **every entity foreign key that a page
fans out on has its own btree, and every join key is indexed on both sides.**
Audit that invariant with `EXPLAIN ANALYZE` on the worst-case entity whenever a
new table or live query is added — that one check would have caught the ocid bug
before it shipped.
