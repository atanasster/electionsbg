# `db:load:tr:pg` silently deleted three matviews — v1

**Status:** fixed 2026-08-10. Local `db:load:tr:pg` re-run verified end to end; prod checked and
found intact.

## The defect

`scripts/db/schema/pg/003_tr_search.sql` opened each of its four tables with

```sql
DROP TABLE IF EXISTS tr_companies CASCADE;
DROP TABLE IF EXISTS tr_officers  CASCADE;
DROP TABLE IF EXISTS tr_person_roles CASCADE;
DROP TABLE IF EXISTS ngo_details CASCADE;
```

and `load_tr_pg.ts` applies that file on **every** run. Three matviews owned by *other*
migrations read those tables, so every `npm run db:load:tr:pg` deleted them and exited 0:

| matview | migration | what it backs |
|---|---|---|
| `person_browse_table` | 120 | the ENTIRE `/persons` browser |
| `declaration_stake_company` | 096 | the declared-stake → public-contract conflict surface |
| `company_officer_counts` | 071 | `magistrate_politician_links()`'s hub filter; also read by 099 |

Reproduced on local docker Postgres: relation count 177 → 174, and the next loader in the chain
died on `relation "person_browse_table" does not exist` (42P01).

Five other matviews read the same tables and were *also* dropped, but the loader re-applies
their migrations, so they came back on the same path: `officer_name_counts` (008),
`owner_name_counts` (019), `company_person_roles` (022), `ngo_signals` + `ngos_list` (080).
That is precisely what the three above lacked.

### Why it went unnoticed

Same family as the 077/145 `2BP01` defect fixed earlier the same day (a loader-applied
migration destroying an object another migration owns), with the failure mode **inverted**:

- **no CASCADE → 2BP01.** Loud. The loader aborts.
- **CASCADE → success.** Silent. Nothing in the loader output reports it, and no row count
  moves, because the counts that would move belong to a relation that no longer exists.

And `db:refresh` happens to sequence `db:load:persons-browse:pg` after `db:load:tr:pg`, so a
full local refresh self-healed and hid it.

### Exposure

The damage path is the **standalone** `npm run db:load:tr:pg:cloud` — CLAUDE.md documents it as
the routine TR publish, tells you to run it after a contracts/agri/funds reload, and both the
`update-persons` and `update-procurement` watch skills invoke it. Nothing on the cloud side
would have recreated `person_browse_table`; `/persons` would have served empty (and
`person_search`'s public arm degraded) until someone happened to run
`db:load:persons-browse:pg:cloud`. Locally, `npm run tr:daily-refresh` ran the same CASCADE.

**Prod was checked on 2026-08-10 and is intact** — all three matviews present and populated,
and each one's `pg_class.oid` sits *above* `tr_companies`', i.e. every one was (re)created after
the last cloud TR load (`meta.tr_generated_at` = 2026-08-09T16:53Z). So the last TR publish was
followed by the person chain and nothing is orphaned. Whether there was a transient window in
which `/persons` served empty on prod is not recoverable from the database.

## The fix

Option 1 of the three considered — **003 no longer DROPs anything.** Option 3 (probe and refuse)
turns a silent defect into a hard blocker on every TR load; option 2 (the loader recreates what
it destroys) inverts the layering, making the TR loader depend on the person and declaration
chains.

1. **`003_tr_search.sql`** — `CREATE TABLE IF NOT EXISTS` throughout, no DROPs.
2. **A shape-reconcile block** at the foot of 003: one `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
   per column. Without it the fix would trade a loud data loss for a quiet schema drift, since
   `CREATE TABLE IF NOT EXISTS` is a no-op on a warm database and a new column would reach a
   fresh clone and nothing else. The reconcile lines carry the type and any `GENERATED` clause
   but no `NOT NULL` / `PRIMARY KEY` — a new column on a populated 1M-row table cannot take
   one, and `exec()` sends a migration as one implicit transaction, so the ALTER would roll the
   whole file back.
3. **`load_tr_pg.ts`** — `replaceTable()` replaces each table's CONTENTS: `TRUNCATE` inside the
   COPY's own transaction, so a failed load leaves the old rows rather than an empty table.
   It does **not** leave readers on the previous vintage — see *Lock profile* below, which
   measures what it does instead; an earlier draft of this line claimed otherwise.
   `ngo_details` is now written unconditionally, because the TRUNCATE lives inside
   `replaceTable` and the old `if (ngoDetails.length)` guard would have preserved a stale
   vintage. The TRUNCATE statements are spelled out per table rather than interpolated, so
   `person_reload_locks.data.test.ts` — which reads the serving surface out of the SQL — can
   see them; `tr_companies` is on that surface and carries a `"debt"` entry there.
4. **`LOAD_INDEXES`** — the eleven secondary indexes are dropped and rebuilt by the loader,
   which is what `DROP TABLE` used to provide for free. Each table's drops run **inside that
   table's own `replaceTable` transaction**, so an aborted load rolls them back rather than
   committing them and leaving the table populated-but-unindexed (see the hazard section
   below). Name and table are parsed from each `CREATE INDEX` string rather than restated, so
   the drop and the create cannot disagree. The primary keys stay: they were maintained during
   the COPY under the old scheme too.
5. **`company_officer_counts` is now refreshed by this loader** (guarded on existence). 071
   delegates its refresh to the magistrate loader "because tr_officers is loaded before it in
   db:refresh" — but `db:load:tr:pg` is a documented `db:refresh` EXCLUSION, so on the routine
   TR path nothing was refreshing it. That was invisible while the CASCADE deleted the matview
   outright.

`person_browse_table` is deliberately **not** refreshed here: it folds six upstream datasets and
is a ~minute rebuild, so owning it from the TR loader would invert the same layering. It is now
stale-in-one-column rather than missing, which `/persons` serves correctly, and
`db:load:tr:pg[:cloud]` has been added to the trigger list for `db:load:persons-browse:pg[:cloud]`
in CLAUDE.md.

### Lock profile — a REGRESSION, measured

> **Corrected 2026-08-10.** This section first claimed the profile was
> "unchanged-to-better", on the reasoning that the old `DROP TABLE` + `CREATE TABLE` held an
> `AccessExclusiveLock` for the whole load too and additionally left the relations missing.
> **Both halves were wrong**, and `cloud-deploy-speed-v1.md`'s own F10 is what disproves them.
> The claim was written from inference; what follows is measured.

`exec()` sends 003 as ONE string, and the simple query protocol wraps a multi-statement string
in a **single implicit transaction** (`lib/pg.ts` says so; 003 carried no explicit
`BEGIN`/`COMMIT`). So the old `DROP … CASCADE` and the `CREATE TABLE` beneath it committed
atomically — under MVCC no reader could ever observe a table absent, exactly as F10 established
for `042_kzk_appeals.sql`. The AccessExclusive window was the DDL apply alone, sub-second. The
four COPYs then ran in their own later transactions holding only `RowExclusiveLock`, which does
**not** conflict with `AccessShare`.

So under the old scheme readers were **never blocked** during the ~100 s COPY phase. They read
an empty, then progressively filling, table: a **200 with zero rows** — search answering "no
such company" with confidence for the length of the load.

The new scheme puts `TRUNCATE` inside the COPY's transaction, so the lock is held for the whole
COPY. Measured on a live local `db:load:tr:pg`, a second connection probing all three tables at
`lock_timeout = 2000ms`:

```
tr_companies     21 / 60 rejected 55P03     tr_officers      16 / 60 rejected
tr_person_roles  13 / 60 rejected 55P03     (50 / 180 total, 28%)
blocked probes each burned the full timeout: 2125-2359 ms
```

That is the same shape, SQLSTATE and remedy as RC4/F9's `tenders` defect. It is a regression and
it is still the right way round — an error a route can degrade on (`55P03` is already in the
documented degrade set) beats a silently-empty search result — but it must not be described as
neutral, and on cloud it is much larger: F11 measured `db:load:tr:pg:cloud` at 34.9 min against
112 s locally, and the blocking window scales with the COPY.

Removing the choice needs a stage merge (`lib/stage_merge.ts`), which does **not** drop in:
`tr_companies` and `ngo_details` are `uic`-keyed and fine, `tr_officers` would need a unique
index on `(uic, name)` declared (the loader's `GROUP BY` already guarantees it), and
`tr_person_roles` has no natural key at all — the same person can hold the same role at the same
company across separate date ranges. **Open work**, scoped as Phase 4b in
[cloud-deploy-speed-v1](cloud-deploy-speed-v1.md) (F21) rather than folded in here.

### Interrupted-load hazard (new, and it looks healthy)

The loader drops all 11 secondary indexes up front so each is built once over the finished
table. An interrupted run therefore leaves the tables **populated but unindexed** — which every
row-count check reports as fine.

Observed while taking the measurement above, when the harness killed the loader mid-run:
concurrent person queries joining `tr_officers.name_fold` (`money_eik`, the resolver's Tier-V
money basis) went from sub-second to **>10 minutes**, and the next load's `TRUNCATE` queued
behind them — at which point every reader of all three tables queued behind the `TRUNCATE`,
since a pending `AccessExclusive` blocks later `AccessShare`. One killed loader took the whole
TR surface down until the orphaned backend was cancelled.

Recovery needs **no reload** — each table commits on its own, so the data is complete and
correct. Recreate the 11 indexes from `LOAD_INDEXES` in `load_tr_pg.ts` and `ANALYZE`. Verified.

## Recovery, if a database has already lost them

Verified working locally, in this order:

```bash
npm run db:load:magistrates:pg                  # company_officer_counts
npm run db:load:declarations:pg -- --resolve    # declaration_stake_company (+ applies 120)
npm run db:load:persons-browse:pg               # person_browse_table
npm run db:load:graph:pg                        # reads person_browse_table facets
npm run db:load:tr-company-place:pg             # denormalizes company_public_money + company_politicians
```

Append `:cloud` to each for Cloud SQL.

## Gates

- **`scripts/db/tests/tr_search_shape.test.ts`** (pure text, no database) — 003 contains no
  `DROP`; the CREATE and reconcile column lists agree, name for name and in order; a column
  declared `GENERATED` in one is `GENERATED` in the other; no reconcile line carries a
  constraint the ALTER cannot apply. Mutation-checked against all three.
- **`scripts/db/tests/migration_drop_dependents.data.test.ts`** — the generic form of the rule,
  which is what the class needed: a gate naming today's offenders passes on tomorrow's. It reads
  every `DROP TABLE|VIEW|MATERIALIZED VIEW` in `scripts/db/schema/pg/*.sql`, resolves each
  surviving target's stored-query dependents through BOTH the `pg_rewrite` and `pg_proc` arms
  (a `LANGUAGE sql … BEGIN ATOMIC` body records its edge only in the latter and blocks a DROP
  just as hard), and fails on any dependent owned by a different file. It also re-applies the
  real 003 text in a rolled-back transaction and asserts the three matviews survive, and proves
  the CASCADE class is genuinely silent so the gate cannot go vacuous.

A schema-wide sweep for this defect returned only six relations, of which three pairs are
sanctioned in that gate **with their reasons**:

| dropped | by | why it is fine |
|---|---|---|
| `person_wealth_year` | 090 | `load_declarations_pg.ts` — the only applier of 090 — re-applies all four victims (097/100/105/120) after it on the same path, each with a comment saying so |
| `appealed_ocids` | 042 | 042 calls `rebuild_contracts_list()` in the same file |
| `upheld_ocids` | 042 | as above, plus `risk_upheld_ocid`, which `rebuild_contract_risk_cache()` (112) recreates at rebuild time precisely because of this CASCADE |

`dual_corpus_dependents.data.test.ts` keeps the 077/145 case and its plpgsql-wrapper
specifics; the new file is the general rule.
