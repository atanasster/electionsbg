# db:refresh loader gaps — v1

**Status:** IMPLEMENTED — all tiers T0–T5 done 2026-08-04 (local; cloud publication is the operator runbook in CLAUDE.md) · **Date:** 2026-08-03 · **Context:** `docs/plans/data-hub-lateral-edges-v1.md` §6.4a

`npm run db:refresh` is documented in CLAUDE.md as *"Full reload: schema + every loader + resolve +
test:data"*. It calls **26 of the 38** local `db:load:*` / `db:resolve:*` scripts in `package.json`.
That silent omission, plus four adjacent gaps found in the same audit, is what this plan closes.

---

## 0. Correction to the premise — the "26 empty relations" number is an artifact

§6.4a's classification table rests on row counts read from `pg_stat_user_tables.n_live_tup`. §6.4a
itself flags that column as stale ("after loading 258 rows into `nzok_hospital_geo`, `n_live_tup`
still read 0 while `count(*)` read 258") and then classifies the other relations by that same
number anyway.

Re-measured with `count(*)` against local Postgres, 2026-08-03 (the "populated locally" claim
covers the relations §6.4a attributed to a *missing load*; its four empty-by-design staging
tables remain empty, as designed):

| relation | `count(*)` local | `n_live_tup` local | prod |
|---|---:|---:|---:|
| `agri_subsidies` | **2,481,857** | 0 | 2,481,857 |
| `agri_payloads` | **16,711** | 0 | 16,711 |
| `ngo_funding` | **3,179** | 0 | 3,179 |
| `nzok_activities` | **18,211** | 0 | — |
| `nzok_activity_facility_periods` | **4,585** | 0 | — |
| `nzok_activity_monthly` | **12** | 0 | — |
| `nzok_drug_overpay` / `_by_hospital` / `_by_inn` | **100 / 43 / 30** | 0 | — |
| `nzok_drug_pack_stats` | **3,333** | 0 | — |
| `nzok_drug_quarterly` | **7,140** | 0 | — |
| `nzok_eeof_nzok_parity` | **8,369** | 0 | — |
| `nzok_hospital_financials` | **3,675** | 0 | — |
| `nzok_hospital_geo` | **258** | 0 | — |
| `nzok_hospital_payments` | 17,391 | 17,391 | — |
| `transport_facility_geo` | **11** | 0 | **0** |
| `nzok_pathway_tariffs` | **0** | 0 | **0** |

**Every relation §6.4a called empty is populated locally except `nzok_pathway_tariffs`.** Local and
prod agree exactly on `agri_subsidies`, `agri_payloads` and `ngo_funding`. `transport_facility_geo`
is the one relation where local (11) is *ahead of* prod (0), the reverse of what §6.4a says.

This changes the *severity* of the findings, not their existence. Every defect below is proven from
`package.json` and repo greps — code facts, not row counts:

- `db:refresh` really does omit 12 loaders (read from `package.json`, verified).
- agri really has no `db:load:agri:pg` / `:cloud` (verified).
- `nzok_pathway_tariffs` really is 0 on both sides (verified by `count(*)` and by prod `/api/sql`).
- `data/ngo/foreign_grants.json` really is absent, and its `'ned'` source has **never** produced a
  row on prod either (prod `ngo_funding` is `eu_fts` 2,071 / `abf` 1,105 / `budget_subsidy` 3, zero
  `ned`) — verified.
- `transport_facility_geo` really has zero code references (verified).

So this is not "26 datasets are missing locally". It is: **the refresh command does not do what it
says, so local↔prod parity is maintained by hand and nothing detects when it lapses.** The right fix
is unchanged; the urgency is lower and the framing must be corrected in §6.4a.

**T0.1 — correct §6.4a.** Rewrite the classification table with `count(*)` figures, and add the rule
that follows from it: *a relation's population is `count(*)`; `n_live_tup` is an estimate that reads
0 until autovacuum analyzes, and no audit may classify on it.* This is the same trap §6.4a's own
point 2 names, applied to §6.4a.

---

## 1. Item 1 — the 12 omitted loaders

Verdict per loader. Nine are added to `db:refresh`; three are documented exclusions. A silent
omission is the bug, so both halves are deliverables.

### 1a. The sorting criterion is COMMITTED INPUTS, not cost

**Audit correction (2026-08-03).** The first draft of this plan split the 12 by cost — "the nzok
ones are cheap, `db:load:tr:pg` is a multi-hour load" — reusing §6.4a's framing and the brief's
statement that *"every input file the nzok loaders read is present EXCEPT pathway_tariffs.json"*.
That statement is true **on this machine** and false on a fresh clone. Three of the nzok inputs are
gitignored:

```
data/budget/nzok/activities.json          IGNORED  ← db:load:nzok-activities:pg
data/budget/nzok/drug_unit_prices.json    IGNORED  ← db:load:nzok-drug-prices:pg
data/budget/nzok/hospital_financials.json IGNORED  ← db:load:nzok-financials:pg
raw_data/ngo_funding/fts/*.xlsx           IGNORED  ← db:load:ngo-funding:pg
raw_data/agri/                            IGNORED  ← db:load:agri:pg (§2)
```

(`data/budget/nzok` holds 18 files, 15 tracked. The other 14 nzok inputs are committed.)

**All three nzok loaders `throw` on a missing input** — `load_nzok_activities_pg.ts:192`,
`load_nzok_drug_prices_pg.ts:233`, `load_nzok_financials_pg.ts:168` — and `db:refresh` is one
`&&`-chain. So adding them naively makes a cold-clone `db:refresh` **abort partway**, never reaching
`db:resolve:persons`, `person:slugs` or `test:data`. That is strictly worse than today's silent
omission.

The correct axis is the one 1c already uses for `cr-founding` / `company-founded`: **is every input
committed?** Restated partition — 13 loaders (the 12 omitted, plus agri from §2):

### 1b. ADD unconditionally — all inputs committed (5)

| # | loader | position | why there |
|---|---|---|---|
| 1 | `db:load:nzok-hospital:pg` | first of the nzok block | **corrected at T1 review**: it does NOT read `hospital_payments.json` — it re-derives the corpus from the nhif.bg listing pages every run (only the PDF cache is local), so it is the one chain step with a hard network dependency. Wired with `-- --tolerate-offline`: an nhif.bg outage skips the load **before any write** (table keeps its vintage) instead of aborting the chain; standalone runs still throw. Reads tracked `hospital_eik` + `hospital_ownership`; writes `nzok_hospital_payments`, which 2 and §1c's financials loader read |
| 2 | `db:load:nzok-hospital-map:pg` | after 1 | reads **no JSON at all** — derives geo from `nzok_hospital_payments`. T1 also fixed a latent universe bug here: unscoped `max(period)` across streams collapsed the map to 45 drug-stream hospitals when drugs published for a month БМП hadn't (live skew 2026-06 vs 2026-05); the universe is now pinned to `stream='bmp'`. **Prod note:** if the cloud map loader ever ran under that skew, `nzok_hospital_geo` on prod serves 45 rows at a 200 — re-run `db:load:nzok-hospital-map:pg:cloud` after the cloud payments corpus is current |
| 3 | `db:load:nzok-drug-quarterly:pg` | anywhere in the block | `drug_quarterly.json` tracked |
| 4 | `db:load:nzok-tariffs:pg` | anywhere in the block | already absent-tolerant **by design**: applies 059 and exits cleanly when the JSON is missing (`load_nzok_tariffs_pg.ts:35`). This is the pattern §1c should copy |
| 5 | `db:load:ngo-board-links` | **after `db:load:magistrates:pg`, before `db:load:declarations:pg`** | `officials/index.json` + `parliament/index.json` both tracked; it is the ONLY writer of `official_roster` (verified: one `TRUNCATE`, `load_ngo_board_links_pg.ts:244`), which `db:resolve:persons` reads |

Two ordering facts worth stating because they look like conflicts and are not:

- **5 TRUNCATEs `mp_roster`** (`load_ngo_board_links_pg.ts:276,281`). That is the 2-column
  `(name, mp_id)` table from migration 080, **not** the `mp_profile` / `mp_car` /
  `mp_profile_detail` / `mp_roster_meta` set that `db:load:mp-roster:pg` writes. No conflict, and 5
  may sit either side of `db:load:mp-roster:pg`.
- **5 degrades in the right direction on a cold clone.** Its `ngo_board_links` rebuild is guarded on
  `magistrate` + `officer_name_counts` and warns-and-skips when the TR load hasn't run — but it
  writes `official_roster` *before* that guard. So the part `db:resolve:persons` depends on lands
  even on a database with no TR corpus.

### 1c. ADD only after making them absent-input-tolerant (4, + agri)

| loader | gitignored input | today | required change |
|---|---|---|---|
| `db:load:nzok-activities:pg` | `activities.json` | throws (`:192`) | skip-and-warn on **absent**; keep throwing on malformed/short |
| `db:load:nzok-drug-prices:pg` | `drug_unit_prices.json` | throws (`:233`) | same |
| `db:load:nzok-financials:pg` | `hospital_financials.json` | throws (`:168`) | same; position after 1 (resolves name→EIK from `nzok_hospital_payments`, `:191`) |
| `db:load:ngo-funding:pg` | `raw_data/ngo_funding/fts/*.xlsx` | silently loads a 35% corpus | see §4 — and T1.1 below |
| `db:load:agri:pg` | `raw_data/agri/` (739 MB) | n/a (new) | see §2 |

**T1.0 — the absent-vs-malformed distinction is the whole design.** Absent input on a fresh clone is
normal and must skip; a *present but wrong-shaped* input is a real defect and must still throw. This
is exactly what `load_nzok_tariffs_pg.ts` already does, and what the existing `existsSync` checks in
these three loaders were reaching for before they were wired to `throw`. Each skip must print one
line naming the file, so "this refresh did not load activities" is visible rather than inferred.

**T1.1 — `db:load:ngo-funding:pg` on a TR-less database is a CERTAINTY, not a risk.** Confirmed:
`tr_companies`' DDL lives in `003_tr_search.sql`, which is applied by **`load_tr_pg.ts` only** — and
TR is a documented exclusion (§1d). So on a cold clone `tr_companies` does not exist and
`load_ngo_funding_pg.ts:248`'s unguarded `CREATE INDEX … ON tr_companies` raises `42P01`, aborting
the refresh. Wrap the index and all matching legs in the same `to_regclass('public.tr_companies')`
guard the loader already uses for `ngo_signals` / `procurement_ngo_foreign_link`, and log which legs
were skipped. This is a precondition of adding it, not a thing to go reproduce.

**T1.2 — measure the added cost.** `db:load:nzok-hospital:pg` completed in seconds during the audit.
Time the rest and record the total in CLAUDE.md, so the refresh's cost is a known number.

### 1d. DOCUMENT as excluded (3)

| loader | why excluded | what runs it instead |
|---|---|---|
| `db:load:tr:pg` | multi-hour load of ~1.02M companies; the TR corpus is not committed | the `update-connections` / TR ingest path, by hand |
| `db:load:cr-founding:pg` | reads the **gitignored** `raw_data/tr/cr_deeds.sqlite` crawl cache | `npm run tr:daily-refresh` (CLAUDE.md, CR Deeds section) |
| `db:load:company-founded:pg` | same cache; also writes the `http_status`/`attempts` columns gated on migration 033 | the founding-date ingest, by hand |

Note `db:load:tr:pg` is excluded on **both** axes — cost *and* uncommitted input — so its exclusion
survives even if the cost axis is ever relaxed.

**T1.3 — give the exclusion list one machine-readable home.** `package.json` cannot hold comments,
and a comment in CLAUDE.md cannot be asserted on. Create
`scripts/db/refresh_coverage.ts` exporting:

```ts
/** Local db:load:* / db:resolve:* scripts deliberately NOT in db:refresh, and why. */
export const REFRESH_EXCLUSIONS: Record<string, string> = {
  "db:load:tr:pg": "multi-hour ~1M-company load; run by the TR ingest path",
  ...
};
```

CLAUDE.md and the gate (§6) both point at this file. Adding a loader without deciding its side then
becomes a test failure rather than a silent omission — which is the whole point of item 1.

---

## 2. Item 2 — agri has no loader, only a combined fetch+load ingest

`npm run agri:ingest` → `scripts/agri/ingest.ts` fetches *and* loads. Consequences: no
`db:load:agri:pg`, no `:cloud`, no entry in CLAUDE.md's runbook, and prod was populated by pointing
`DATABASE_URL` at the Cloud SQL proxy by hand.

The fetch/load seam already half-exists: `loadYearSheet` (`source.ts:51`) is cache-first and only
hits data.egov.bg on a cache miss, and `parseSeuYear` (`seu_fetch.ts:69`) reads
`raw_data/agri/seu_<year>.csv`. `raw_data/agri/` holds 739 MB — every declared year plus both СЕУ
CSVs — so a pure load needs no network at all.

**T2.1 — split load from fetch.** Refactor `ingest.ts`'s `main()` into an exported
`runAgriIngest({ offline }: { offline: boolean })`. In `offline` mode:
- `loadYearSheet` **throws** on a cache miss instead of fetching (add an `offline` parameter to
  `source.ts`);
- `parseSeuYear` returning `[]` for a missing CSV **throws** instead of degrading silently — a load
  that quietly drops FY2024/2025 is exactly the "green locally, stale on prod" failure this repo
  keeps hitting.

Add `scripts/db/load_agri_pg.ts` as the thin entry point calling it with `offline: true`, matching
the shape of its siblings in `scripts/db/load_*_pg.ts`.

**T2.2 — `package.json`:**
```
"db:load:agri:pg": "NODE_OPTIONS=--max-old-space-size=6144 tsx scripts/db/load_agri_pg.ts",
"db:load:agri:pg:cloud": "DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npm run db:load:agri:pg"
```
`agri:ingest` stays as the fetch+load path the `update-agri` skill calls; it delegates to
`runAgriIngest({ offline: false })` so there is one code path, not two.

**T2.3 — replace both TRUNCATEs; they are the documented 55P03 failure mode.**
`ingest.ts:321` does `TRUNCATE agri_subsidies` and then streams 2.48M rows in **the same
transaction** — an AccessExclusiveLock held for the whole load, against a table the `/subsidies`
DbDataTable browse (`functions/db_table.js:619`), `/farm/:eik` and the company-page tile all read.
`ingest.ts:620` does the same to `agri_payloads`, which `functions/db_routes.js:577,2074` serve.
That is precisely `reference_contracts_reload_lock` / `reference_stage_merge_reload`.

> **CORRECTED during T2 implementation (2026-08-04): the rename swap specified below is ILLEGAL
> for `agri_subsidies` — the first real run proved it.** `person_browse_table` (migration 120)
> and `company_public_money` (127) are **materialized views over `agri_subsidies`**, and a
> matview tracks its base table by OID, following it through a rename: after the swap both
> matviews pointed at `agri_subsidies_old` and the drop refused with 2BP01 (and CASCADE would
> have destroyed them; leaving the old table would have frozen them on a stale corpus with
> nothing red). This is precisely the "the live table keeps its identity" condition
> `stage_merge.ts`'s header names for `price_product_days` — the plan checked FKs and grants but
> not `pg_depend`/`pg_rewrite`. The shipped shape is an UNLOGGED stage build + **one-transaction
> `DELETE FROM agri_subsidies; INSERT … SELECT FROM stage`**: both take only RowExclusiveLock,
> MVCC keeps readers on the pre-delete snapshot (never blocked, never a half-table), and the
> live indexes absorb the 2.5M inserts as incremental maintenance — not the parallel index
> BUILD 046's `/dev/shm` warning is about. Cost: one full-table churn of dead tuples per reload
> (a few reloads/year; autovacuum absorbs it). T2.3a's index-rename mechanics are therefore
> moot; the shrink guard and the parity check both stand.

The two tables need **different** shapes, and the reason is the one `scripts/db/lib/stage_merge.ts`
states in its own docstring:

- **`agri_payloads` → stage merge.** Natural PK `(kind, key)`, 16,711 rows. Straight
  `createStageTable` + `addStagePrimaryKey` + `mergeFromStage` on `keys: ["kind","key"]`.
- **`agri_subsidies` → rename swap, not stage merge.** Its PK is a synthetic `bigserial`
  (`046_agri_subsidies.sql:17`) regenerated on every rebuild, so there is no key to merge on; a
  natural key over `(year, name, oblast, scheme)` is not provably unique for the individuals rows
  that carry no EIK. Swap is available here for the exact reason it was *not* available for
  `price_product_days`: `agri_subsidies` has **no foreign keys and no dependent grants**, so the
  live table does not need to keep its identity. Build `agri_subsidies_stage` UNLOGGED
  `(LIKE agri_subsidies INCLUDING ALL)`, COPY into it, `ANALYZE`, then in one short transaction
  rename live→old, stage→live, and `DROP TABLE … old` after commit. AccessExclusive is held for
  milliseconds instead of the whole load.

Guard the swap on a non-empty, sane stage (row count within a tolerance of the live table, same
shape as `sync_cloud.ts`'s shrink guard) so a half-parsed source cannot publish a truncated corpus.

**T2.3a — two swap mechanics the first draft missed.**

- **Index names must be renamed with the table.** `CREATE TABLE agri_subsidies_stage (LIKE
  agri_subsidies INCLUDING ALL)` names the copied indexes after the *stage* table. After the swap
  they persist as `agri_subsidies_stage_*`, so the next `db:load:agri:pg` re-applies `046`, whose
  `CREATE INDEX IF NOT EXISTS idx_agri_eik …` finds nothing by that name and builds a **duplicate**
  index — eight of them, growing every run. `ALTER INDEX … RENAME` each one back inside the swap
  transaction, and assert post-swap that `pg_indexes` for `agri_subsidies` matches 046's eight names
  exactly.
- **Index build order vs `/dev/shm`.** `046_agri_subsidies.sql:44-49` carries an explicit warning
  that an index rebuild on a populated agri table "would parallel-build the index and can exhaust
  the container's `/dev/shm`" — which is why that migration is `IF NOT EXISTS`-only with no
  DROP+CREATE. A stage twin created `INCLUDING ALL` then COPY'd into hits the *other* half of that
  problem (eight indexes maintained incrementally across 2.48M inserts). Prefer: create the stage
  **without** indexes, COPY, then build the eight, then `ANALYZE`, then swap — and measure peak
  `/dev/shm` on the local container before trusting it on Cloud SQL. If the build proves fragile,
  falling back to today's TRUNCATE is **not** acceptable; the fallback is a maintenance-window load.

**T2.4 — changelog.** `agri:ingest` already calls `recordIngestBatch` (`ingest.ts:426`); confirm it
still fires from the refactored path and that `recent_updates` carries the agri row after a load.
Per `feedback_pg_changelog_required`, `agri_subsidies` is a source dataset and keeps its
`recent_updates` wiring; `agri_payloads` is a derived serving blob and takes none.

**T2.5 — CLAUDE.md runbook entry**, alongside the other `:cloud` loaders: `db:load:agri:pg:cloud`,
run after any `raw_data/agri/` refresh (a new egov financial year, or a fresh `npm run agri:seu`
pull), nothing else runs it on the cloud side.

**T2.5a — `.claude/skills/update-agri/SKILL.md` must change in the same commit.** Per
`reference_migrated_family_watch_reload`, the skill that regenerates a family must name the cloud
loader, or live goes stale. Today that skill documents the *absence* at length and will become
actively wrong:

> line 43: "**There is no `db:load:agri:pg:cloud` wrapper**… publishing means **re-running the ingest
> against the proxy**" · line 63: "Agri and КЗК are the two PG-backed datasets with no
> `db:load:*:cloud` wrapper, because in both the ingest itself is the loader."

Replace Step 3's `DATABASE_URL=… npm run agri:ingest` with `npm run db:load:agri:pg:cloud`, and
correct line 63 to name КЗК alone. (`update-nzok` already names every nzok `:cloud` loader — no
change needed there.)

**T2.5b — decide whether `agri_subsidies` joins `CRITICAL_TABLES`.** `sync_cloud.ts:36-50` lists
`kzk_decisions` despite its size, on the stated grounds that it "has NO committed generator and its
source file is gitignored, so losing it in a restore is unrecoverable and would look like a green
sync". `raw_data/agri/` is gitignored, 739 MB, and `seu_2024/2025.csv` come from a scraped APEX
register — so `agri_subsidies` (2.48M rows) meets **both** axes and is currently absent from the
list. Either add it or record why it does not qualify.

**T2.6 — `db:refresh` wiring is BLOCKED on the gitignored cache.** The first draft said "add it, and
if the cost dominates, reconsider". Cost is not the blocker: **`raw_data/agri/` is gitignored**, so
on a fresh clone the offline loader T2.1 deliberately makes throw would abort the whole `&&`-chain.
agri is §1c, not §1b — it may only join `db:refresh` once it skips-and-warns on an absent cache
(same absent-vs-malformed rule as T1.0). If that tolerance is judged to weaken the loader too much,
the fallback is §1d, alongside `cr-founding`/`company-founded` whose exclusion rests on exactly the
same gitignored-cache criterion. Cost (T1.2) is then a second, independent input to the same call.

---

## 3. Item 3 — `nzok_pathway_tariffs`: build the writer's missing half, do not drop

**Recommendation: keep the table, view, functions and loader. Retarget the existing writer. Do not
drop, and do not write a new parser.**

The brief frames this as "an ingest that was never built". It is closer to the opposite — everything
is built except the source location:

- `scripts/nzok/write_pathway_tariffs.ts` **exists and is complete**: page discovery, PDF extraction
  via `pdftotext -layout`, `--dump`/`--from-dump` offline iteration, `--bgn` conversion, a ~550-row
  expectation check.
- `scripts/db/load_nzok_tariffs_pg.ts` exists, is idempotent per NRD year, and no-op-safe.
- Migration 059 defines the table, `nzok_pathway_tariff_latest`, and two functions.
- **Both functions are on live serving routes** — `functions/db_routes.js:2572`
  (`nzok_activity_by_procedure_spend`) and `:2584` (`nzok_casemix_expected_vs_actual`). They LEFT
  JOIN the tariff and return `priceEur`/`spendEur`/`totalSpendEur` as NULL, so the pathway tree
  serves volume-only and the case-mix signal is dormant. Dropping the table would break two shipped
  routes to save nothing.

**Why it never produced a file.** Two measurements, today:
- `https://nhif.bg/` → **200** from this host. The script's header comment ("nhif.bg is IP-gated to
  Bulgarian egress — this 403s elsewhere") is wrong, or no longer true. Matches
  `reference_nzok_pathway_tariffs`.
- `https://nhif.bg/bg/nrd/2025/medical` → **404**. The URL in the script's own usage examples is
  stale.

And the structural reason: per `reference_nzok_pathway_tariffs`, the per-pathway prices are in the
**НРД PDF body at чл. 368/369/370**, *not* in a separate price annex. `write_pathway_tariffs.ts`'s
`findPriceAnnex()` looks for a price-annex link on the medical page — so even against a live URL it
would find nothing. That is the defect, and it is a ~50-line retarget of `parseTariffs`, not a new
ingest.

**T3.1** Locate the current НРД document on nhif.bg (the 2025 and 2026 НРД за медицинските
дейности). Record the working URL; fix the stale `--page` example and the incorrect IP-gating
comment in the header.

**T3.2** Run `--dump` to snapshot the raw text into `raw_data/nzok/pathway_tariffs_raw/`, then
iterate `parseTariffs` offline via `--from-dump` against the чл. 368/369/370 article body rather
than an annex table. The `anthropic-skills:pdf` skill is available if `pdftotext -layout` mangles the
article layout. Expect ~550 codes across КП/АПр/КПр; the script already warns below that.

**T3.3** Money basis: pre-2026 НРД is BGN (`--bgn`, 1.95583), 2026+ is EUR-native. Load the year that
matches `max(period)` in `nzok_activities` so the case-mix join is same-vintage.

**T3.4 — resolve the scope caveat BEFORE the case-mix ratio is presented as live.** Migration 059
carries an explicit note (`059_nzok_pathway_tariffs.sql`, above `nzok_casemix_expected_vs_actual`):
EXPECTED spans КП **and** АПр **and** КПр, while ACTUAL is the total `'bmp'` payment stream. If
АПр/КПр are reimbursed outside the parsed БМП figure, every ratio is biased downward by that
hospital's АПр/КПр share (~40% of cases nationally). Validate once tariffs exist; if they land
outside `'bmp'`, either restrict EXPECTED to КП-only or widen ACTUAL. The feature is NULL-dormant
today, so this is a precondition of shipping, not a live defect.

**T3.5** `db:load:nzok-tariffs:pg` is already in §1b's add-list, and `db:load:nzok-tariffs:pg:cloud`
already exists (and is named in `.claude/skills/update-nzok/SKILL.md:219`). Add the cloud command to
CLAUDE.md's runbook once T3.2 produces a file.

**T3.6 — changelog + data map.** `nzok_pathway_tariffs` is a **source** dataset, so per
`feedback_pg_changelog_required` it wires into `recent_updates` — the loader already calls
`recordIngestBatch` (`:71`), which has simply never fired. `data/data_map.json` already carries
`nzok_activities` / `nzok_drug_unit_prices` / `nzok_hospital_bmp` but **no tariffs entry**; add one,
and give the `/data/updates` feed its per-skill stamp via `update-nzok`. A newly-live dataset that
appears in no changelog is the failure `reference_two_changelogs` describes.

**If T3.1/T3.2 fail** — the document is unreachable or the prices are genuinely not machine-readable
— the correct outcome is still *not* a drop. It is a one-line comment in `load_nzok_tariffs_pg.ts`
recording what was tried and when, because the degradation path is already correct and costs
nothing.

---

## 4. Item 4 — `ngo_funding`'s missing input is a file that was never written

`load_ngo_funding_pg.ts` reads **four** inputs, not three (`:190-198`):

| input | present | contributes |
|---|---|---|
| `raw_data/ngo_funding/fts/*.xlsx` (EU FTS) | via `abf_fetch`/manual download | `eu_fts` — 2,071 rows on prod |
| `data/ngo/budget_subsidies.json` | yes (4 KB) | `budget_subsidy` — 3 rows |
| `data/ngo/abf/projects.json` + `abf_aliases.json` | yes | `abf` — 1,105 rows |
| `data/ngo/foreign_grants.json` | **absent** | `ned` — **0 rows, on prod too** |

**Finding: there is no generator to restore.** Prod's `ngo_funding` breaks down as `eu_fts` 2,071 /
`abf` 1,105 / `budget_subsidy` 3 and contains **zero** `ned` rows. The `'ned'` default source has
never produced a row anywhere. `foreign_grants.json` is a *curated* file (the loader's own comment:
"curated ABF/NED grantee rows"), like `budget_subsidies.json` — hand-authored, not watcher-produced.
It was scoped in `docs/plans/ngo-final-implementation-plan.md` Phase 6 and never written. No
watcher in `scripts/watch/sources/` and no skill emits it; this is confirmed by the source
breakdown, not just by absence.

So there is nothing to restore, and the honest fix is the second option in the brief.

**T4.1 — make the loader state its inputs.** Print a one-line manifest before loading — each of the
four inputs, found/absent, and the row count it contributed. Today `parseCurated` returns `[]` for a
missing path with no output at all, so a silently-halved corpus is indistinguishable from a healthy
one. This is the same class as the `--resolve` "N/total still NULL" line CLAUDE.md documents.

**T4.2 — distinguish absent-by-design from absent-by-accident — but NOT with a hard failure.**
The first draft specified "make a missing/empty FTS directory a hard failure" while also adding
`db:load:ngo-funding:pg` to `db:refresh`. Those cannot both hold: **`raw_data/ngo_funding/fts` is
gitignored**, so a hard failure would abort a cold-clone refresh. Same contradiction as T2.6, same
resolution — the §1c absent-vs-malformed rule:

| input | absent | present but wrong |
|---|---|---|
| `raw_data/ngo_funding/fts/*.xlsx` | skip the `eu_fts` leg, **warn loudly** (it is 65% of the corpus) | throw |
| `data/ngo/budget_subsidies.json`, `abf/projects.json` (tracked) | throw — a tracked file cannot legitimately vanish | throw |
| `data/ngo/foreign_grants.json` (curated, never written) | logged skip, no warning | throw |

Three tiers, not two: a tracked input going missing is a genuine defect and should still fail; a
gitignored one is normal on a clone. The distinction is *whether git carries the file*, which is
also exactly the §1a criterion — so it is one rule applied twice, not two rules.

**T4.3 — document the curated file.** One line in the loader header and in
`docs/plans/ngo-final-implementation-plan.md`: `foreign_grants.json` is hand-authored, is optional,
has never been written, and its schema is `{name, source?, funder?, year?, amountEur?, programme?,
eik?}[]`.

T1.1's `tr_companies` guard is the other half of this item.

---

## 5. Item 5 — `transport_facility_geo`: needs your decision

**Evidence.**

Zero references anywhere in the repo — no DDL under `scripts/db/schema/pg/`, no writer, no reader in
`scripts/`, `functions/` or `src/`. `git log -S"transport_facility_geo" --all` matches exactly one
commit, `e27eb2496d`, and only inside `docs/plans/transport-view-v1.md`. `git log --all --
scripts/db/load_transport_facility_map_pg.ts` returns **nothing** — that file was never committed.

The plan document describes it as finished work:

> **Marker map SHIPPED (facility map, 2026-07-16)** … Pattern mirrors `074_mvr_directorate_map`:
> static crosswalk `transport_facility_geo` (schema **076**, loaded by
> `load_transport_facility_map_pg.ts`) + serving fn `transport_facility_map(eiks[], from, to)`;
> route `/api/db/transport-facility-map`; hook `useTransportFacilityMap`. … Verified live: 11
> entities, 2 markers, badges 3379 (Sofia) + 579 (Varna), 0 console errors. **NOT deployed.**

Migration slot 076 was subsequently taken by `076_transport_project_map.sql`, a different table
(`transport_project_link`, 1,171 rows, loader in `db:refresh`).

And local Postgres holds **11 rows** — the exact 11-entity МТС group the plan names:

```
000695388 Министерство на транспорта и съобщенията          София
130822878 Холдинг „Български държавни железници" (БДЖ)      София
175405647 „БДЖ — Пътнически превози" ЕООД                    София
175403856 „БДЖ — Товарни превози" ЕООД                       София
130823243 ДП „НК Железопътна инфраструктура" (НКЖИ)          София
121805755 ГД „Гражданска въздухоплавателна администрация"    София
121410441 ИА „Автомобилна администрация"                     София
130663221 ИА „Железопътна администрация"                     София
177344399 ДА „Безопасност на движението по пътищата"         София
130316140 ДП „Пристанищна инфраструктура"                    Варна
121797867 ИА „Морска администрация"                          Варна
```

Prod has the table with **0** rows.

**Conclusion:** this is not "the unshipped third member of a family". It is residue of work that was
written, run against local Postgres (creating the table and its 11 rows), documented as SHIPPED, and
then **discarded from the working tree without ever being committed**. The empty table on prod
arrived through a schema-carrying dump/restore, not a deliberate deploy. Its column set is identical
to `mvr_directorate_geo` (including `universe`, which `water_operator_geo` lacks) because it was
copied from it.

**DECIDED 2026-08-03: rebuild it.** (The alternative considered and rejected was a tombstone `DROP`
migration; the recommendation had been the tombstone, on the grounds that 9 of 11 entities are
Sofia-registered so the map renders as one paginating Sofia cluster plus two Варна pins, with
networks unrepresentable as points. That weakness is real and stands as a design constraint on the
build below — see T5.6 — but the operator wants the map.)

Scope it as a **transport-view feature**, not as part of the cleanup: it is the only item here that
adds a user-visible surface, so it lands last (T5 in §7) and can slip without blocking T1–T4.

Copy `074_mvr_directorate_map` exactly, as the plan doc intended. `mvr_directorate_geo` is the right
model rather than `water_operator_geo` because it is the one that carries the `universe` column —
which is why the orphan table has it.

- **T5.2 — migration.** New file at the next free number (**not** 076; that slot is now
  `076_transport_project_map.sql`, a different table). Carries
  `CREATE TABLE IF NOT EXISTS transport_facility_geo` matching the 9 columns already present on both
  databases — so on local it adopts the existing 11 rows rather than recreating them — plus the
  `transport_facility_map(eiks[], from, to)` serving fn folding the windowed contracts corpus per
  entity, modelled on 074's.
- **T5.3 — loader.** `scripts/db/load_transport_facility_map_pg.ts`, curated 11-row crosswalk over
  the МТС group, with the **physical-facility override pinning the two maritime bodies (ИА „Морска
  администрация", ДП „Пристанищна инфраструктура") to Варна** — registered seat is София for all 11,
  so without the override the map is a single pin. Reuse `TRANSPORT_SECTOR_EIKS` as the EIK set
  rather than re-listing them, so the map cannot drift from the sector definition
  (`audit-sectors` treats the four EIK-set copies as needing lockstep).
- **T5.4 — wiring.** `db:load:transport-facility-map:pg` + `:pg:cloud` in `package.json`, an entry in
  `db:refresh`, and the `:cloud` command in CLAUDE.md's runbook (§6.2). It is a static crosswalk with
  no upstream loader dependency, so it may sit anywhere in the sequence.
- **T5.5 — serving + UI.** `/api/db/transport-facility-map` route (`missingMigrationEmpty`, matching
  074's), `useTransportFacilityMap` hook, and a `SectorPointMap` band at the top of `TransportPack`
  (band `transport-map`). Markers coloured by ЗОП spend / single-bid share, badged with contract
  count, each linking to `/awarder/:eik`.
- **T5.6 — state the map's limits in the caption, not just in this plan.** The two-marker outcome is
  a property of the data, so the surface must say so: all 11 entities are Sofia-**registered**, the
  two Варна pins are physical-facility overrides, networks (rail, roads) have no single point, and
  АПИ roads are a separate sector. Without that caption the map reads as "transport happens in two
  places", which is false.
- **T5.7 — perf.** The plan doc measured `~81 ms` worst case (all-time, full group) on a bitmap index
  scan over `idx_contracts_awarder`, no new index. Re-verify with `EXPLAIN ANALYZE` on the worst-case
  entity per `feedback_db_query_perf`; do not carry the old number forward unchecked — the contracts
  corpus has grown since 2026-07-16.
- **T5.8 — changelog.** A static curated crosswalk, same shape as `water_operator_geo` /
  `mvr_directorate_geo`. Follow whichever of those wires into `recent_updates` and match it.
- **T5.9 — regression gate.** A `*.data.test.ts` asserting the crosswalk covers exactly the
  `TRANSPORT_SECTOR_EIKS` set (no missing member, no stale EIK) and that every row carries
  coordinates — the two ways a curated geo table goes quietly wrong.

**T5.1 — correct `transport-view-v1.md` regardless.** Its "Marker map SHIPPED (facility map,
2026-07-16)" section describes code that was never committed. Amend it to say the work was written,
run locally and discarded, and point at this plan as where it was actually built.

---

## 6. Cross-cutting — the gate that stops item 1 recurring

**T6.1 — `scripts/db/refresh_coverage.test.ts`.** Asserts that every local `db:load:*` /
`db:resolve:*` script in `package.json` is **either** referenced by the `db:refresh` script **or**
present in `REFRESH_EXCLUSIONS` (T1.3) — and, symmetrically, that no `REFRESH_EXCLUSIONS` key is
stale (names a script that no longer exists, or one that *is* in `db:refresh`).

Two implementation details from the audit:

- **Tokenize, don't substring-match.** Extract the `npm run <name>` occurrences from the `db:refresh`
  string and compare names exactly. Checked: no local loader name is currently a substring of
  another, so a naive `includes()` passes today — but it is one name away from a silent false
  positive (adding `db:load:agri:pg-full` would make `db:load:agri:pg` look covered). The gate whose
  whole purpose is catching silent omissions must not have one.
- **Record the reason, not just the fact.** `REFRESH_EXCLUSIONS` values should carry the *axis*
  (`uncommitted-input` / `cost` / both), because §1a showed the axis is what got mis-sorted — five
  loaders were classified by cost when the operative constraint was a gitignored input. A free-text
  string that happens to mention it is weaker than a field the gate can read.

**T6.1a — a second gate: uncommitted inputs.** The partition in §1a is only correct as long as the
input files stay committed. A test asserting that every input path read by a loader **in
`db:refresh`** is either tracked by git or handled by an absent-tolerant branch would have caught
this class directly. Scope it narrowly (the declared input constants in the loaders this plan
touches) rather than attempting general static analysis.

**T6.2a — measure the `test:data` blast radius before wiring anything.** `db:refresh` ends with
`npm run test:data`, and ~20 `*.data.test.ts` gates auto-skip on an empty table. Populating those
relations flips skips into runs — `agri_scope_years`, `nzok_activity_entity`, `ngo_foreign_link` and
`cr_deeds_founding` are the direct ones. The plan's §7 gate says "green after"; without a baseline
that is an assertion nobody has checked. The skip/pass capture is done (below); what remains is the
post-wiring comparison — treat any newly-run test that fails as in-scope work for this plan, not a
surprise at the end of it.

> **BASELINE, captured 2026-08-04 before any wiring:** `npm run test:data` →
> **84 test files passed / 8 skipped / 1 failed** (541 / 19 / 1 tests, 97.9s). The one failure is
> **pre-existing and out of this plan's scope**: `person_connections.data.test.ts` › "costs nothing
> for a subject with no companies" — its discriminator leg (restore the pre-fix function body in a
> rolled-back tx and assert it exceeds the 200-buffer ceiling) now reads only 78 buffers, so the
> test asserts it "has stopped measuring anything". Data drift, not a regression from this plan;
> every later "green" gate in §7 means *no NEW failures relative to this baseline*.
>
> **RESOLVED 2026-08-04, and it was NOT data drift.** The buffer parser only counted
> `shared hit=`: EXPLAIN prints the group once (`Buffers: shared hit=3684 read=7545`), so a bare
> `read=` was dropped and the score measured *how much was already cached* rather than how many
> buffers were touched. The control body reads 11,229 buffers either way — scored 3,684 on a warm
> cache (passes) and 11 once the other 87 files have churned `shared_buffers` (fails), which is
> exactly why it failed only in a full run. Both ceilings held: the current body is **81** (ceiling
> 200) and the private path **464** (ceiling 2000). Fixed in `sumExecutionBuffers`, plus a pure
> non-skipping test on the parser itself. The 200 ceiling is now cache-state-independent — and so
> is the forward assertion, which the same bug had made *too lenient*: a genuine regression reading
> thousands of buffers off disk would have scored double digits and passed.
>
> **What is left is flakiness under parallel load, and it is not this plan's either.** Five full
> runs after the fix gave 1, 2, 2, 3 and **0** failures — a different cast each time
> (`search.data.test.ts` › recent_updates, `person_slug_retired.data.test.ts`,
> `officials_redirect.data.test.ts` › retired-slug redirect), every one of them green in isolation,
> and one run clean at 88/88. Mostly 120 s timeouts on tests that already burn 87–117 s alone, so
> parallel contention tips them over. `person_connections` was green in all five. Treat a single
> red run as unproven until the file is re-run alone; the honest fix is a cheaper query (or a
> raised timeout) on those three, which nothing here touches.

**Deliberate deviation from the brief:** this goes in `test:unit` as a plain `.test.ts`, **not** in
`scripts/db/tests/*.data.test.ts` with the Postgres auto-skip. The assertion is pure JSON over
`package.json` and touches no database, so an auto-skip would only make the gate weaker — it would
go green on any machine with Postgres down, which is exactly the CI shape that let this ship.
Precedent exists: `scripts/bucket_sync_paths.test.ts` already reads `package.json` this way.

**T6.2 — CLAUDE.md.** Add `db:load:agri:pg:cloud` to the cloud runbook (T2.5); add
`db:load:nzok-tariffs:pg:cloud` once §3 produces a file; state that `db:refresh` now covers the nzok
family and both ngo legs; and name the three documented exclusions with what runs each instead,
pointing at `scripts/db/refresh_coverage.ts` as the source of truth.

**T6.3 — changelog contract.** Every loader added here already calls `recordIngestBatch`; confirm
per loader that a `recent_updates` row lands. Per `feedback_pg_changelog_required` and
`reference_two_changelogs`, source datasets wire in; derived serving layers (`agri_payloads`,
`nzok_hospital_geo`, payload blobs) do not.

---

## 7. Sequencing

| Tier | Contents | Gate |
|---|---|---|
| **T0** | §0 §6.4a correction; T5.1 `transport-view-v1.md` correction; **T6.2a `test:data` baseline** | docs + a recorded skip/pass baseline |
| **T1** | T1.3 exclusion const → T6.1 + T6.1a gates → §1b wiring (5 loaders, no code change) | gate red before, green after; `npm run db:refresh` clean **on a scratch clone**, not just here |
| **T1b** | T1.0 absent-tolerance + T1.1 `tr_companies` guard → §1c wiring (4 loaders) | cold-clone refresh skips-and-warns instead of aborting |
| **T2** | T2.1–T2.6 agri split, swap/merge, `:cloud`, CLAUDE.md, **T2.5a skill**, T2.5b | prod-parity row counts; no 55P03 under a concurrent `/subsidies` read; no duplicate indexes after two consecutive loads |
| **T3** | T4.1–T4.3 ngo_funding three-tier input handling | loader names all four inputs; row count unchanged at 3,179 |
| **T4** | T3.1–T3.6 НРД tariffs (independent; may run in parallel) | ~550 codes; `nzok_activity_by_procedure_spend` returns non-NULL `priceEur` |
| **T5** | T5.1–T5.9 rebuild the transport facility map | 11 rows local **and** cloud; 2 markers with the Варна override; `EXPLAIN ANALYZE` re-measured |

T1 must land before T1b and T2, so the gate exists before any loader is added to `db:refresh`. T1
and T1b are split because T1 is pure wiring of loaders that already work, while T1b changes loader
behaviour — keeping them in one tier would mean no green state between "the gate exists" and "five
loaders changed how they fail". T5 is the only tier that ships a user-visible surface and the only
one with no dependency on the others; it lands last and can slip without blocking T1–T4.

**Every tier's gate must be run against a scratch clone, not this machine.** The audit's central
finding is that this working copy holds gitignored inputs a fresh clone does not, so "it works here"
is precisely the evidence that misled the first draft.

## 8. Verification

Per the brief: row count against prod, not "the loader exited 0".

```bash
curl -s -X POST https://electionsbg.com/api/sql/query -H 'Content-Type: application/json' \
  -d '{"sql":"select count(*) from agri_subsidies","limit":1}'
```

Local side uses `count(*)`, never `n_live_tup` (§0). Tables to reconcile: `agri_subsidies`,
`agri_payloads`, `ngo_funding` (by `source`), and each nzok relation in §0's table. No heavy cloud
load runs without asking; every step is local first.

---

## 9. Audit log — 2026-08-03, gaps found in the first draft

Recorded because the same two mistakes are what produced the original defect.

| # | Gap | Severity | Where fixed |
|---|---|---|---|
| G1 | ADD/EXCLUDE partition sorted by **cost** when the operative axis is **committed inputs**. 3 nzok inputs + the FTS dir are gitignored and all three loaders `throw`; `db:refresh` is an `&&`-chain, so a cold clone would abort before `db:resolve:persons` / `test:data` — worse than the omission being fixed | **critical** | §1a–1d rewritten; T1.0 |
| G2 | T2.6 wired agri into `db:refresh` while T2.1 made it throw on a cache miss — and `raw_data/agri/` is gitignored. Self-contradiction guaranteeing a cold-clone abort | **critical** | T2.6 |
| G3 | T4.2 specified a hard failure on a missing FTS dir *and* adding the loader to `db:refresh`. Same contradiction | **critical** | T4.2, now three tiers |
| G4 | T1.1 was written as "reproduce and see". `tr_companies` DDL is in `003_tr_search.sql`, applied by `load_tr_pg.ts` alone, which is excluded — so the `42P01` is certain, not possible | high | T1.1 |
| G5 | Plan never touched the watch skills. `update-agri/SKILL.md` documents the *absence* of `db:load:agri:pg:cloud` in two places and becomes wrong on T2.2 (`reference_migrated_family_watch_reload`) | high | T2.5a |
| G6 | `agri_subsidies` meets both `CRITICAL_TABLES` axes (gitignored source, no committed generator) and is absent from the list | medium | T2.5b |
| G7 | Rename swap under-specified: `LIKE … INCLUDING ALL` leaves indexes named `agri_subsidies_stage_*`, so the next load's `CREATE INDEX IF NOT EXISTS` builds 8 duplicates; and `046` warns that index rebuilds on a populated agri table can exhaust `/dev/shm` | medium | T2.3a |
| G8 | §7 asserted "green after" without a `test:data` baseline; ~20 gates auto-skip on empty tables and flip to running | medium | T6.2a |
| G9 | Item 3 had no changelog / data-map step for a newly-live dataset | low | T3.6 |
| G10 | Gate used naive `includes()`; safe today, one loader-name away from a false positive | low | T6.1 |

**The two root causes**, both worth carrying forward:

1. **Measuring on a working copy and generalizing to a clone.** This machine holds four gitignored
   input sets a fresh clone does not. Every "the inputs are present" claim — including the brief's —
   was true here and false there. Hence T7's scratch-clone rule.
2. **Inheriting a framing instead of deriving one.** The cost axis came from §6.4a via the brief and
   was never tested against the loaders themselves; it happened to sort `db:load:tr:pg` correctly,
   which made it look right. Same shape as §0's `n_live_tup` finding — a plausible proxy, reused
   without checking what it actually measures.
