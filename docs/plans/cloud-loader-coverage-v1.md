# Cloud loader coverage v1 — the 19 `:cloud` scripts with no owning skill

Status: **analysis + plan. Nothing wired yet.** Written 2026-08-20 against
`scripts/db/cloud_loader_coverage.ts` at 19 `kind: "unreviewed"` entries.

## The failure class, and why the backlog matters

A `db:load:*:pg:cloud` script is the **only** way a corpus reaches production, and nothing
runs one automatically. The repo's convention is that each is reachable from a skill: a
watcher in `scripts/watch/sources/` fires, `.claude/skills/process-watch-report/SKILL.md`
maps that watcher's source id to an `update-*` skill, and the skill's instructions name the
`:cloud` command. When that chain is broken the failure is silent and specific — the watcher
fires, an operator re-ingests **locally**, commits, and production keeps the previous vintage
**at a 200 with every row count reconciling**. Nothing is red anywhere. The backlog matters
because of a measurement that makes the class concrete rather than theoretical: **14 of these
19 are steps of `db:refresh`** (the local chain re-runs them on every full refresh, so local
is always current) **and none of the 14 is named in any skill** — the purest possible form of
"green locally, stale on prod". Three more are `REFRESH_EXCLUSIONS` members whose cloud path
exists only in CLAUDE.md prose or nowhere, and two are not corpus loaders at all.

Two secondary findings shape the plan. First, **for 13 of the 19 the loader is the SOLE
APPLIER of its own migration** (measured — see the per-script evidence), so on a Cloud SQL
that never ran it the relation does not merely go stale, it does not exist; and for three
resources that is a **500**, not a degrade. Second, **the gate's literal string match cannot
see prose wiring**: four of the 19 are already named in a skill as ``npm run …:pg`` followed
by `# + :cloud` or `(+ `:cloud`)`. Those are wired for a human and invisible to the test, and
the fix is one line each rather than a design decision.

---

## Summary table

| Script | What it loads | Input committed? | Serving reader? | Class | Owning skill (wire-it) |
| --- | --- | --- | --- | --- | --- |
| `build:project-members:cloud` | `data/procurement/projects/members.json` (a FILE) | n/a — reads PG, writes a committed file | yes (bucket-served) | **operator-tool** | — |
| `db:load:agri-hub-stats:pg:cloud` | `agri_hub_stats_cache`, `agri_political_link`, `agri_cross_programme` (162+163) | n/a — pure PG derivation | yes — hub + **2 DbDataTable resources** | **wire-it** | `update-agri` (+ Step 8) |
| `db:load:annexes:pg:cloud` | `procurement_annexes` (114) | **gitignored** (`raw_data/procurement/anexi`, 2,423 files) | yes — `/api/db/contract-annexes` | **wire-it** | `update-procurement` |
| `db:load:budget-hub:pg:cloud` | `budget_peer_band` + `budget_hub_stats_cache` (156) | tracked (`data/macro_peers.json`) | yes — `/api/db/budget-hub-stats` | **wire-it** | `update-budget` (+ `update-macro`) |
| `db:load:budget-muni:pg:cloud` | `budget_muni_transfer/execution/capital_project/ipop_project` (154) | tracked (47+112+265+17 files) | yes — 5 `budget_muni_*` routes | **wire-it** | `update-budget` |
| `db:load:budget:pg:cloud` | 11 `budget_*` tables (152+153+157) | **partly gitignored** (`reconciliation/`, `ministries/`) | yes — the whole `/budget` module | **wire-it** | `update-budget` |
| `db:load:company-founded:pg:cloud` | `company_founded` (ships local→cloud) | **gitignored** (`raw_data/tr/cr_deeds.sqlite`) | yes — `/api/db` risk `foundedByEik` | **manual-trigger** | — (documented ✓) |
| `db:load:court-load:pg:cloud` | `court_load` (069) | tracked | yes — `/api/db/court-load` + AI tool | **wire-it** (prose-wired) | `update-judiciary` |
| `db:load:cr-nkid:pg:cloud` | `company_nkid` + 3 `nace_cpv_*` (140) | **gitignored** crawl cache | yes — `/api/db/company` `nace_div`, risk bit 12 | **manual-trigger** | — (documented ✓) |
| `db:load:employer-links:pg:cloud` | `declaration_employer_link` (165+168) | n/a — pure PG derivation | yes — `/api/db/awarder-officers`, **no degrade catch** | **wire-it** | `update-procurement` + `update-officials` |
| `db:load:funds-fit:pg:cloud` | `fund_fit`, `funds_hub_stats_cache` (143+144+145) | n/a — pure PG derivation | yes — `/funds` hub, resolver, wire | **wire-it** | `update-funds` |
| `db:load:grant-links:pg:cloud` | `grant_contract_link` (166) | n/a — pure PG derivation | **NO** — surfaces unbuilt (culture plan T1.6c) | **wire-it (deferred)** | `update-procurement` |
| `db:load:municipal-fiscal:pg:cloud` | `municipal_fiscal` + `obshtina_population` (149) | tracked | yes — 4 routes + every governance rank | **wire-it** | `update-budget` |
| `db:load:nzok-drug-prices:pg:cloud` | 4 `nzok_drug_*` tables (052+054+060+065) | **gitignored** | yes — `/molecule/:inn`, pack pages, savings | **wire-it** (prose-wired) | `update-nzok` |
| `db:load:nzok-financials:pg:cloud` | `nzok_hospital_financials`, `nzok_eeof_nzok_parity` (051+056+058) | **gitignored** | yes — report card, decile fan, AI tool | **wire-it** | `update-nzok` |
| `db:load:nzok-tariffs:pg:cloud` | `nzok_pathway_tariffs` (059) | **tracked** (loader header is stale) | yes — pathway spend + case-mix | **wire-it** (prose-wired) | `update-nzok` |
| `db:load:tr-name-fold-people:pg:cloud` | `tr_name_fold_people` (148) | tracked (456,398-line TSV) | yes — the Bridge-B **guard** for 5 migrations | **wire-it** | `update-persons` |
| `db:load:transport-facility-map:pg:cloud` | `transport_facility_geo` (132) | tracked | yes — `/api/db/transport-facility-map` | **wire-it** | `update-procurement` |
| `person:kmetstvo-flips:cloud` | rekeys/purges `person_slug_lock` | n/a | n/a (a repair) | **operator-tool** | — |

**Counts: wire-it 15 (one of them deferred) · manual-trigger 2 · operator-tool 2 ·
covered-elsewhere 0.**

**`covered-elsewhere` is empty on purpose, and the reason is the DDL-vs-data distinction.**
Four candidates looked like riders and none survived the check: `db:load:agri:pg:cloud`
refreshes 162 but never applies or refreshes **163**; `db:load:nzok-activities:pg` applies
059's DDL but loads no tariff row; and 148 is applied by three person-layer loaders
(`resolve_persons.ts`, `load_persons_browse_pg.ts`, `load_declarations_pg.ts`) none of which
puts a row in `tr_name_fold_people`. In each case the cloud database ends up with the
relation **present and empty**, which is the state this repo repeatedly documents as worse
than absent, because nothing errors.

---

## Per-script findings

Evidence paths are absolute-from-repo-root. Row counts are from local Postgres
(`postgres://postgres@127.0.0.1:5433/electionsbg`, `PGPASSFILE=./.pgpass`) on 2026-08-20 via
`count(*)` — **not** `pg_stat_user_tables.n_live_tup`, which reads 0 for almost every table
here because the local database is never `ANALYZE`d (`reference_local_pg_has_no_stats`).

### 1. `build:project-members:cloud` — **operator-tool**

- **Loads nothing into a database.** `package.json:230-231` shows the `:cloud` form is
  `DATABASE_URL=…:5434 npm run build:project-members`, i.e. it only redirects the READ.
  `scripts/procurement/build_project_members.ts:448` writes
  `data/procurement/projects/members.json` — a **tracked** file
  (`git ls-files data/procurement/projects` lists it) that is **bucket-served**:
  `src/data/procurement/useProjectFile.tsx:1063` fetches it via `dataUrl(…)`, and
  `scripts/bucket_sync_paths.ts:282` carves `procurement/projects/` out as the one
  bucket-allowed subtree of an otherwise PG-served family.
- So it cannot leave production on a stale vintage — a stale *artifact* would, but that
  travels by commit + `bucket:sync`, not by this script.
- **Prior decision exists and points the same way.** `docs/plans/cloud-deploy-speed-v1.md:1951`
  (G17 row d) lists it among "six paths still write to cloud directly", required action
  "ship from local". Read carefully that is an argument for *retiring the `:cloud` variant*,
  not for wiring it.
- **Exempt permanently.** Reason: not a corpus reload; the `:cloud` suffix selects a read
  source for an offline build. ⚠️ Separate, out of scope here: nothing in any skill runs
  `build:project-members` **at all** (grep over `.claude/skills/` returns zero), so the
  committed artifact has no owner either. Its trigger is a curated-dossier edit — visible in
  `git log data/procurement/projects/members.json` as three dossier-audit commits — which is
  the `audit-dossier` skill's territory.

### 2. `db:load:agri-hub-stats:pg:cloud` — **wire-it** (owner `update-agri`)

- **Loads** `agri_hub_stats_cache` (10 rows), `agri_political_link` (3,035),
  `agri_cross_programme` (27,814) — all matviews, refreshed in
  `scripts/db/load_agri_hub_stats_pg.ts:64-90`. It is the **sole applier of
  `163_agri_political.sql`** (`grep -rl 163_agri_political scripts/ --include=*.ts` returns
  only this file). 162 has a second applier, `scripts/agri/ingest.ts:256`.
- **Input**: none on disk — five PG inputs, listed in the loader header:
  `agri_subsidies`/`agri_payloads` ← `db:load:agri:pg`; `person_role`/`person` ←
  `db:resolve:persons`; `fund_projects` ← `db:load:funds:pg`; `contracts` ← `db:load:pg`;
  `budget_muni_transfer` ← `db:load:budget-muni:pg`.
- **Readers**: `/api/db/agri-hub-stats` (`functions/db_routes.js:3771`) degrades to `null`
  and logs `ahs:not-built`; **but** `agri_political_link` and `agri_cross_programme` are
  DbDataTable resources (`functions/db_table.js:896` `agri_political`, `:934`
  `agri_cross_programme`) behind `/subsidies/political` and `/subsidies/cross-programme`
  (`src/routes.tsx:2740,2750`; `src/screens/subsidies/SubsidiesPoliticalScreen.tsx`). A
  DbDataTable resource has **no `missingMigration` degrade** — those two pages 500.
- **Stale symptom**: `/subsidies` hub headline and the two register pages describe the
  previous vintage of the political arm. On a Cloud SQL that never ran this loader, the two
  register pages are 500, not empty.
- **Trigger**: primarily `dfz_subsidies` → `update-agri`. Secondarily any of the other four
  inputs (`update-persons`, `update-funds`, `update-procurement`, `update-budget`).
- **Not covered elsewhere**: `update-agri/SKILL.md:46` emits `db:load:agri:pg:cloud`, and
  `scripts/agri/ingest.ts:841-865` refreshes **only** `agri_hub_stats_cache`. 163 is untouched.

### 3. `db:load:annexes:pg:cloud` — **wire-it** (owner `update-procurement`)

- **Loads** `procurement_annexes` (24,380 rows locally), sole applier of
  `114_procurement_annexes.sql` (`scripts/db/load_annexes_pg.ts:29`).
- **Input**: the gitignored ЦАИС ЕОП annex cache —
  `git check-ignore -v raw_data/procurement/anexi` → `.gitignore:116:/raw_data/procurement/`;
  2,423 cached day files present locally. The `:cloud` form **recomputes from the local
  cache** and COPYs over the proxy (loader header, lines 10-13), so it is a ship-from-local.
- **Reader**: `/api/db/contract-annexes` (`functions/db_routes.js:1821`), degrades via
  `missingMigration({annexCount:0, rows:[]})`.
- **Stale symptom**: the per-annex breakdown and the чл.116 ал.2-vs-ал.3 labelling on
  `/contract/:key` describe the previous corpus. Worse — CLAUDE.md's cross-source reconcile
  section records that an eviction **orphans** annex rows (16 across 9 keys on the 2026-08-04
  run) and only this loader re-resolves them.
- **Partially wired already, on the local side only.** `.claude/skills/update-procurement/SKILL.md:193`
  says "**`db:load:annexes:pg` must follow the contracts reload**" — and the Step-8 cloud row
  for `update-procurement` (`process-watch-report/SKILL.md:684`) does **not** list it, even
  though it lists five other cloud follow-ups. CLAUDE.md names
  `db:load:annexes:pg:cloud` three times.
- **Trigger**: `egov_procurement` / `eop_procurement` → `update-procurement`; also any
  `ingest_anexi` refresh.

### 4. `db:load:budget-hub:pg:cloud` — **wire-it** (owner `update-budget`, second trigger `update-macro`)

- **Loads** `budget_peer_band` (3 rows) and refreshes `budget_hub_stats_cache` (6). Sole
  applier of `156_budget_hub_stats.sql` (`scripts/db/load_budget_hub_pg.ts:34`).
- **Input**: `data/macro_peers.json` — **tracked**; the loader throws on absence by design
  (its header: "absence is a defect rather than the fresh-clone state").
- **Reader**: `/api/db/budget-hub-stats` (`functions/db_routes.js:385`), degrades to `null`.
- **Two triggers, of very different weight, and the obvious one is the weaker.** The peer band
  is nearly static: `data/macro_peers.json` moved in 14 commits in the last 60 days, and the
  `distribution` block this loader reads (`{B9, TE, TR}`) did **not** change in any of them —
  it turns over once a year. The real trigger is the **matview**, which
  `scripts/db/schema/pg/156_budget_hub_stats.sql:71-104,152-172` builds from
  `budget_admin_fact`, `budget_program_fact`, `budget_document`, `budget_muni_transfer`,
  `budget_muni_ipop_project`, `budget_muni_capital_project`, `budget_kfp_observation`,
  `budget_fiscal_year` **and `municipal_fiscal`** — i.e. every table loaded by items 5, 6 and
  13 below.
- **Stale symptom**: the `/budget` hub tile grid serves the previous vintage's counts and
  totals. Never zeroes — 156 is written so an empty corpus yields NULL rather than
  EUR 0 (loader header, lines 13-17).

### 5. `db:load:budget-muni:pg:cloud` — **wire-it** (owner `update-budget`)

- **Loads** `budget_muni_transfer` (2,385), `budget_muni_execution` (452),
  `budget_muni_capital_project` (13,875), `budget_muni_ipop_project` (3,492) — the 154 family.
  It is also the **in-chain applier of 152 → 153 → 154 → 157 → 155** (loader header;
  `refresh_coverage.ts` holds the order).
- **Input**: fully **tracked** — verified `git check-ignore` clean for
  `data/budget/municipal_transfers`, `data/budget/capital_programs`, `data/budget/ipop`,
  `data/budget/municipal_execution`. The loader throws rather than skips on absence for
  exactly that reason.
- **Readers**: `155_budget_serving.sql` defines `budget_muni_list`, `budget_muni_detail`,
  `budget_muni_capital`, `budget_muni_ipop` — all four called from `functions/db_routes.js`.
- **Stale symptom**: every per-município budget page serves the previous vintage; a newly
  ingested capital programme or ИПОП year simply does not appear on prod.
- **Trigger**: `budget_law`, `capital_programs`, `ipop_mrrb`, `egov_municipal_execution`,
  `dv_investment_annex` → `update-budget`.
- ⚠️ **`.claude/skills/update-budget/SKILL.md` (459 lines) contains ZERO occurrences of
  `db:load` or `:cloud`.** `grep -n "db:load\|:cloud\|db:refresh"` returns nothing. The entire
  budget corpus — three loaders, ~24k rows, the whole `/budget` module — has no publish step
  anywhere in its owning skill.

### 6. `db:load:budget:pg:cloud` — **wire-it** (owner `update-budget`)

- **Loads** 11 tables: `budget_kfp_observation` (300), `budget_kfp_snapshot_line/section`,
  `budget_fiscal_year` (6), `budget_fiscal_year_figure`, `budget_admin_node` (54),
  `budget_admin_fact` (873), `budget_program_fact` (695), `budget_cofog` (165),
  `budget_document` (33), `budget_personnel` (23).
- **Input**: mixed. `data/budget/kfp.json` is **tracked**;
  `data/budget/reconciliation/` and `data/budget/ministries/` are **gitignored**
  (`.gitignore:302,303`) — which is why it is a `REFRESH_EXCLUSIONS` member
  (`scripts/db/refresh_coverage.ts:61-79`, axis `uncommitted-input`, explicitly **not** cost).
- **Readers**: the `/budget` module — 14 functions in `155_budget_serving.sql`, all called
  from `functions/db_routes.js`, plus 156's matview.
- **Stale symptom**: `/budget` explorer, per-ministry admin detail, programme grain, COFOG,
  personnel series and the documents index all serve the previous vintage.
- **The trap this one carries**: `db:load:budget-muni:pg` (item 5) creates the tables and
  fills **none** of them, so a database that has never run this loader has the whole budget
  schema present and EMPTY — "the 147_tender_search_text shape", named in the loader's own
  header. On prod that is indistinguishable from "the ministry published nothing".
- **Merge guard worth knowing before wiring**: `mergeFromStage`'s delete is an unscoped
  anti-join, so an empty stage would wipe the corpus; the loader refuses a >5% shrink
  (`--allow-shrink` overrides). Measured in the header: an empty admin stage removes 55
  nodes, 873 facts and 727 programme rows with exit 0.

### 7. `db:load:company-founded:pg:cloud` — **manual-trigger** (documented ✓)

- **Ships** `company_founded` (38,796 rows locally) from local Postgres to Cloud SQL via
  `shipTable` — `scripts/db/load_company_founded_pg.ts:21-22`; the local form is a read-only
  sanity check that prints counts and exits.
- **Input**: the gitignored `raw_data/tr/cr_deeds.sqlite` crawl cache
  (`.gitignore:95:/raw_data/tr/`), produced by the rate-limited `npm run tr:cr-deeds` operator
  crawl. `REFRESH_EXCLUSIONS` member, axis `uncommitted-input`
  (`scripts/db/refresh_coverage.ts:55`).
- **Reader**: yes — `functions/db_routes.js` reads `company_founded`, and
  `112_contract_risk_cache.sql` / `033_procurement_risk_indexes.sql` use it for the
  `newFirmWinner` flag.
- **Trigger**: a human crawl decision. No watcher can exist — the source is a rate-limited
  register behind a block state you probe with `--probe`.
- **Reload path documented?** ✓ CLAUDE.md's CR Deeds section names
  `npm run db:load:company-founded:pg:cloud` and the 033-first ordering, and the loader header
  restates the `apply_functions.ts 033_procurement_risk_indexes.sql` prerequisite.
- **Exempt** as `manual-trigger`.

### 8. `db:load:court-load:pg:cloud` — **wire-it, and it is a one-line fix**

- **Loads** `court_load` (1,432 rows), sole applier of `069_court_load.sql`
  (`scripts/db/load_court_load_pg.ts:23`).
- **Input**: `data/judiciary/court_load.json` — **tracked**.
- **Readers**: `/api/db/court-load` + `/api/db/court-load-years`
  (`functions/db_routes.js:4389,4396`, both `missingMigrationEmpty`); the AI tool
  `ai/tools/judiciary.ts`; and `116_judicial_body.sql`, which JOINs it through
  `judicial_body_source_name` for every `/court/:bodyCode` page's workload block.
- **THE GATE IS WRONG ABOUT THIS ONE, ALMOST.** `.claude/skills/update-judiciary/SKILL.md:175`
  reads:

  ```
  npm run db:load:court-load:pg          # + :cloud for Cloud SQL
  ```

  So it is wired for a human and invisible to `skills.includes("db:load:court-load:pg:cloud")`.
  This is a finding, not a failure: the work is to spell the literal out, not to decide
  ownership. (Lines 176-177 have the same shape for `db:load:magistrates:pg` and
  `db:load:judicial-bodies:pg`, whose `:cloud` forms ARE named literally elsewhere in the
  file — which is exactly how this one slipped.)
- **Trigger**: `vss_court_statistics` ("ВСС — съдебна статистика") → `update-judiciary`, a row
  that already exists at `process-watch-report/SKILL.md:94`.

### 9. `db:load:cr-nkid:pg:cloud` — **manual-trigger** (documented ✓)

- **Loads** `company_nkid` (7,678 rows) from the CR Deeds store, plus `nace_cpv_allow` (175),
  `nace_cpv_opinion`, `nace_cpv_universal` reseeded from the committed `src/lib/naceCpv.ts`.
  Sole applier of `140_nkid_cpv.sql`.
- **Input**: the same gitignored `raw_data/tr/cr_deeds.sqlite`. `REFRESH_EXCLUSIONS` member
  (`scripts/db/refresh_coverage.ts:49-54`), axis `uncommitted-input`.
- **Readers**: `functions/db_routes.js` (the `/api/db/company` `nace_div` field) and
  `112_contract_risk_cache.sql` (risk bit 12, `nkidMismatch`).
- **Reload path documented?** ✓ CLAUDE.md carries the full four-step cloud publish order
  (apply 033+112 → `db:load:cr-nkid:pg:cloud` → `SELECT rebuild_contract_risk_cache();` →
  `deploy:db`) and states "Nothing on the cloud side is automatic."
- **Exempt** as `manual-trigger`. ⚠️ One caveat to record rather than act on: the local
  loader rides `npm run tr:daily-refresh`, whose `egov_commerce` Step-8 row
  (`process-watch-report/SKILL.md:685`) lists four cloud commands and not this one. That is
  *correct today* — the daily TR flip does not move `cr_deeds.sqlite`, only a `tr:cr-deeds`
  crawl does — but it is the kind of correctness that decays if the crawl is ever folded into
  the daily path.

### 10. `db:load:employer-links:pg:cloud` — **wire-it** (owner `update-procurement` + `update-officials`)

- **Loads** `declaration_employer_link` (925 rows). **Sole applier of BOTH
  `165_declaration_employer.sql` and `168_awarder_officers.sql`**
  (`scripts/db/load_employer_links_pg.ts:50-58`).
- **Input**: none — a pure derivation over `declaration.filed_institution` and
  `contracts.awarder_name`.
- **Reader, and the sharpest failure of the 19**: `/api/db/awarder-officers`
  (`functions/db_routes.js:2433-2441`) calls `awarder_declared_officers($1)` with **no
  `.catch`**. On a Cloud SQL where 168 has never been applied the route raises 42883 and
  `badRequest()` rethrows a non-`DbRequestError` → **500**. The UI hides it —
  `src/data/culture/useAwarderOfficers.ts:36` returns `null` on `!r.ok` and
  `src/screens/culture/CultureDirectorsSection.tsx:31` renders nothing — so the symptom is a
  missing block on `/awarder/:eik` plus a 500 in the logs, with nothing on the page saying so.
- **Documented nowhere**: 0 occurrences of `db:load:employer-links:pg:cloud` in CLAUDE.md and
  0 in `.claude/skills/`.
- **Order requirement to carry into the wiring** (from `refresh_coverage.test.ts`'s
  `ORDER_PAIRS`, lines 100 and 110): it must follow declarations **phase 1** (the plain
  `db:load:declarations:pg`, since `--resolve` does not write `filed_institution`) **and**
  `db:load:pg`. Run before phase 1 and the table comes out empty and every surface reads
  "no employer matched" — "loaded, green, and wrong".
- **Trigger**: contracts (`egov_procurement`/`eop_procurement` → `update-procurement`) and
  declarations (`cacbg_officials`/`cacbg_local` → `update-officials`;
  `cacbg_declarations` → `update-connections`).

### 11. `db:load:funds-fit:pg:cloud` — **wire-it** (owner `update-funds`)

- **Loads/refreshes** `fund_fit` (2,206 rows) and `funds_hub_stats_cache` (1). **Sole applier
  of 143, 144 AND 145** (`scripts/db/load_funds_fit_pg.ts:37-52` — the header explains at
  length why 145 cannot live in `load_funds_pg.ts`: `canon_oblast` is defined in 143).
- **Input**: none — reads `fund_projects` + `fund_payloads(kind='procedure')` already in PG.
- **Readers**: `/api/db/funds-fit` (`functions/db_routes.js:1448`), `/api/db/funds-hub-stats`
  (`:1436`), the procedure base-rate card (`:1318`), plus `funds_wire()` / `funds_news()` on
  every `/funds` view.
- **Stale symptom**: the resolver keeps answering "340 подобни проекта, медиана €48k" from the
  previous vintage at a 200 — the loader header's own words — and the `/funds` hub tile grid
  with it.
- **Trigger**: `isun_eu_funds` / `isun_eu_funds_projects` → `update-funds`. CLAUDE.md states
  "Its only staleness trigger is a funds reload" and names the `:cloud` command twice.
- **The wiring gap is precise**: `update-funds/SKILL.md:228` and `:396` emit
  `db:load:funds:pg:cloud` and stop; the Step-8 row for `update-funds`
  (`process-watch-report/SKILL.md:688`) is the single command `npm run db:load:funds:pg:cloud`.

### 12. `db:load:grant-links:pg:cloud` — **wire-it (deferred)** (owner `update-procurement`)

- **Loads** `grant_contract_link` (2,615 rows), sole applier of `166_grant_contract_link.sql`.
- **Input**: none — a regex over `tenders.subject` and `contracts.title` joined to
  `fund_projects.contract_number`.
- **Reader: NONE today.** `grant_contract_link_coverage()` is the only function over it and
  **no route calls it** (it is absent from the `functions/*.js` grep that found every other
  migration's callers). The intended surfaces are `docs/plans/culture-investigative-v1.md:524`
  T1.6c — "a spine strip on `/funds/contract/:key`, on `/awarder/:eik`, and as the signature
  tile of the culture hub" — **unbuilt**.
- **So it cannot go stale in a user-visible way today**, which is a legitimate exemption
  ground. The recommendation is nevertheless to wire it, for one reason: it is the same
  shape, the same owner and the same command block as item 10, so the marginal cost is a
  clause; whereas leaving it exempt means it becomes user-visible the day T1.6c ships and
  nothing will fire. If it is left out, it must move from `unreviewed` to a **new** exemption
  kind (`no-reader`), not stay in the backlog.
- **Order requirement**: after both `db:load:tenders:pg` and `db:load:pg`
  (`refresh_coverage.test.ts` `ORDER_PAIRS`, lines 85-96).

### 13. `db:load:municipal-fiscal:pg:cloud` — **wire-it** (owner `update-budget`)

- **Loads** `municipal_fiscal` (10,335 rows) **and `obshtina_population` (265)**. Sole applier
  of `149_municipal_fiscal.sql`.
- **Input**: `data/budget/municipal_fiscal/*.json` — **tracked**. The *fetch* half
  (`scripts/budget/municipal_fiscal/ingest.ts`) reads the gitignored
  `data/_cache/minfin_municipal_fiscal/` workbooks and is an operator download; the loader
  itself is pure-load.
- **Readers**: four routes — `municipal-fiscal`, `-national`, `-years`, `-ranking`
  (`functions/db_routes.js:4496,4531,4572,4589`), all degrading with an explicit
  "Run `db:load:municipal-fiscal:pg:cloud` (place_dim first)" log line. Plus
  `obshtina_population`, which is the **per-resident denominator behind the default sort on
  `/governance/municipal-finance` and the rank on every governance dashboard**.
- **Stale symptom**: a newly ingested quarter never appears on prod; the governance tile and
  the national browse keep the previous quarter at a 200.
- **Hard prerequisite**: `db:load:place-dim:pg:cloud` — two of 149's three serving functions
  JOIN `place_dim`, and a `LANGUAGE sql` body is validated at CREATE, so applying 149 without
  it 42P01s and (exec() sending the file as one transaction) leaves **no table at all**.
- **Partially wired**: `process-watch-report/SKILL.md:196` names the LOCAL loader in the
  municipal-fiscal runbook and then says only "On the cloud side the loader is standalone and
  needs `db:load:place-dim:pg:cloud` first — see CLAUDE.md" (line 208). The reader is pointed
  at CLAUDE.md (line 208) rather than given the command. `update-budget/SKILL.md` names neither.
- **Trigger**: `municipal_fiscal_due` → `update-budget` (row at
  `process-watch-report/SKILL.md:61`).

### 14. `db:load:nzok-drug-prices:pg:cloud` — **wire-it, one-line fix** (owner `update-nzok`)

- **Loads** `nzok_drug_pack_stats` (3,333), `nzok_drug_overpay` (100),
  `nzok_drug_overpay_by_hospital`, `nzok_drug_overpay_by_inn`. Applies 052, 054, 060, 065.
- **Input**: `data/budget/nzok/drug_unit_prices.json` — **gitignored** (`.gitignore:315`),
  regenerable by `npm run data:nzok -- --drug-prices`.
- **Readers**: five functions in 052 + three in 054 + `nzok_drug_savings_overview` (060), all
  called from `functions/db_routes.js`; `/molecule/:inn`; `ai/tools/nzok.ts`.
- **Prose-wired.** `.claude/skills/update-nzok/SKILL.md:114` — "`npm run
  db:load:nzok-drug-prices:pg` (+ `:cloud` to publish)". Same at
  `process-watch-report/SKILL.md:546` — "THEN — critically — … + `:cloud`". The literal never
  appears; CLAUDE.md has 0 occurrences.
- **Trigger**: `nzok_drug_unit_prices` → `update-nzok`.

### 15. `db:load:nzok-financials:pg:cloud` — **wire-it** (owner `update-nzok`)

- **Loads** `nzok_hospital_financials` (3,675), `nzok_eeof_nzok_parity` (8,369). Sole applier
  of 051, 056, 058.
- **Input**: `data/budget/nzok/hospital_financials.json` — **gitignored** (`.gitignore:314`).
- **Readers**: `nzok_hospital_financials_by_eik` / `_latest` (051),
  `nzok_financials_measures_by_eik` / `_measure_fan` (056),
  `nzok_financials_coverage_by_eik` (058) — all called from `functions/db_routes.js`; plus
  `ai/tools/nzok.ts` and `054_nzok_risk.sql` / `065_nzok_ownership.sql`.
- **This is the weakest of the three nzok legs.** `update-nzok/SKILL.md:137` names the local
  loader with **no `:cloud` at all** (verified — `grep -n ":cloud"` on that file returns
  lines 58, 59, 66, 114, 120, 192, 220 and nothing in the 136-180 financials block). Only the
  `process-watch-report` `mh_eeof_quarterly` row (line 547) carries "+ `:cloud`".
- **Trigger**: `mh_eeof_quarterly` ("МЗ финансови показатели на болниците (ЕЕОФ, тримесечно)")
  → `update-nzok`.

### 16. `db:load:nzok-tariffs:pg:cloud` — **wire-it, one-line fix** (owner `update-nzok`)

- **Loads** `nzok_pathway_tariffs` (410 rows — the НРД 2025 set: 352 КП + 51 АПр + 7 КПр).
  Applies 059; `load_nzok_activities_pg.ts` also applies 059's DDL but loads no tariff row.
- **Input**: `data/budget/nzok/pathway_tariffs.json` — **TRACKED**, contrary to the loader's
  own header. `git log` shows commit `42d2e5c9aa` "nzok tariffs: commit pathway_tariffs.json —
  it is not regenerable like its neighbours". `scripts/db/refresh_coverage.ts:104-110` records
  the same correction and warns that re-adding it to `TOLERATED_GITIGNORED_INPUTS` now fails
  the gate. ⚠️ **`scripts/db/load_nzok_tariffs_pg.ts:7` still says "The JSON is gitignored" —
  a stale header worth fixing when this is wired** (a reader acting on it would conclude the
  file is regenerable by a routine fetch; it is not — rebuilding means re-parsing the НРД
  contract PDF).
- **Readers**: `nzok_activity_by_procedure_spend` and `nzok_casemix_expected_vs_actual` (059),
  both called from `functions/db_routes.js` — the pathway spend tree and the case-mix signal
  on `/awarder/121858220`.
- **Prose-wired**: `update-nzok/SKILL.md:220` — "`npm run db:load:nzok-tariffs:pg` # (+ :cloud)";
  `process-watch-report/SKILL.md:545` — "then `npm run db:load:nzok-tariffs:pg` + `:cloud`".
  CLAUDE.md names the `:cloud` literal once.
- **Trigger**: `nzok_nrd_tariffs` → `update-nzok`. The parse needs a human pass, so the flip
  is a prompt, not an automation.

### 17. `db:load:tr-name-fold-people:pg:cloud` — **wire-it** (owner `update-persons`)

- **Loads** `tr_name_fold_people` — **456,398 rows**, from the tracked
  `data/person/tr_name_fold_people.tsv` (456,398 lines; minted once, commit `928d4ae4fd`).
  Applies `148_person_company_basis.sql`.
- **Input committed, deliberately.** The loader header states the reason: `npm run
  tr:count-people` mints the TSV from the gitignored 15 GB TR feed on a machine that has one,
  "everyone else — a fresh clone, CI, Cloud SQL — loads the same file", because "a guard that
  is present on one database and absent on another publishes MORE on the machine without it".
- **This is a GUARD, not a display table, and that is what makes it dangerous.**
  `scripts/person/resolve_persons.ts:2130-2168,2462,2484` reads it to decide whether a public
  figure may be given the companies registered to their name; it is also read by
  `081_person_identity.sql`, `150_mp_tr_roles.sql`, `158_company_political_links.sql`,
  `163_agri_political.sql` and `165_declaration_employer.sql`.
- **Empty ≠ absent ≠ stale, and all three reach prod differently.** 148 has **four** appliers
  (`resolve_persons.ts`, `load_persons_browse_pg.ts`, `load_declarations_pg.ts` and this
  loader), so on Cloud SQL the table almost certainly EXISTS and is EMPTY unless someone ran
  this by hand. `resolve_persons.ts:2140` handles that explicitly — an empty table "does not
  degrade the bridge — it switches it off" — so the cloud symptom is Bridge B minting nothing,
  i.e. **prod publishing FEWER person↔company links than local**, silently, with no error.
- **Documented nowhere**: 0 occurrences in CLAUDE.md, 0 in `.claude/skills/`.
- **Where it belongs**: `update-persons/SKILL.md:191-206` already carries an ordered cloud
  block ("BEFORE the resolve — it reads all three"). This is a **fourth** before-the-resolve
  prerequisite and is missing from it, and from the identical block at
  `process-watch-report/SKILL.md` (Step 8, "Person layer: the whole cloud chain").
- **Trigger**: a re-mint of the TSV (a `tr:count-people` run against a fresh TR feed) — no
  watcher; and, as a cheap idempotent prerequisite, every `db:resolve:persons:cloud`. The
  Step-8 block's own rule for `place-dim`/`judicial-bodies` applies verbatim: "emit them
  unconditionally rather than trying to decide whether their inputs moved — deciding wrong is
  invisible, re-running is ~seconds."

### 18. `db:load:transport-facility-map:pg:cloud` — **wire-it** (owner `update-procurement`)

- **Loads** `transport_facility_geo` (15 rows: София 12 + Варна 2 + Русе 1). Sole applier of
  `132_transport_facility_map.sql`.
- **Input**: `TRANSPORT_ENTITIES` in `src/lib/transportReferenceData.ts` (source) +
  `data/settlements.json` (tracked) + **`awarder_seats`**, which is a database table, not a
  file — the loader header calls `db:load:awarder-seats:pg` "a hard prerequisite for its
  placement and not merely for the join" (ИАППД 000513106 resolves to Русе through it).
- **Reader**: `/api/db/transport-facility-map` (`functions/db_routes.js:4457`,
  `missingMigrationEmpty` → `{facilities: []}`), the `/sector/transport` marker map.
- **This is the FOURTH sibling of a set of three that is already wired.**
  `process-watch-report/SKILL.md:684` (the `update-procurement` Step-8 row) says: "**ALSO**
  re-publish the three contract-DERIVED crosswalk maps `db:refresh` rebuilds from the fresh
  corpus (they go stale on cloud whenever contracts change — this is why
  `transport_project_link` drifted): `db:load:transport-project-map:pg:cloud &&
  db:load:water-operator-map:pg:cloud && db:load:mvr-directorate-map:pg:cloud`." All three sit
  next to this one in `db:refresh` (steps 39-42) and all four read the same
  `awarder_seats`/contracts corpus. The omission is a miscount, not a decision —
  `docs/plans/cloud-deploy-speed-v1.md` G18 records the same three and misses the fourth too.
- **Stale symptom**: the map keeps the previous seat attribution. Low blast radius (15 rows),
  but it is the cheapest wire on the list.

### 19. `person:kmetstvo-flips:cloud` — **operator-tool**

- **Loads no corpus.** It reconciles `person_slug_lock` before a `db:resolve:persons` run —
  DELETE for a FLIP (same seat ref, different winner) and REKEY for a MOVE (same winner,
  different ref) — `scripts/person/kmetstvo_flips.ts:1-36`.
- **Trigger**: a local-elections **re-parse that changes who won a seat**. The header calls it
  "One-off"; the run that motivated it (`docs/plans/village-mayor-attribution-v1.md` §T0/§T1,
  267 seats) was **deployed 2026-08-04**, and the plan records it at line 560-563 inside a
  "Cloud sequence (nothing here is automatic)" block that also names `--prune-dead` as a
  post-resolve step.
- **Exempt permanently** as `operator-tool` — "one-off repair", the kind the exemption comment
  already enumerates. ⚠️ It is documented in a **plan**, not in CLAUDE.md. If the intent is
  that every non-`operator-tool` path has its reload written down, this one is fine as-is;
  if a future re-parse revives it, the plan's Cloud sequence is the thing to follow, and a
  pointer in `update-local-elections/SKILL.md` would be cheap insurance.

---

## Work plan

Sequenced by (drift risk × has a reader), with the concrete edit each requires. **Every tier
is edits to `.claude/skills/**` and `scripts/db/cloud_loader_coverage.ts` only — no loader,
migration or route changes.** Each move out of `unreviewed` must also lower the cap in
`cloud_loader_coverage.test.ts` (`expect(unreviewed.length).toBeLessThanOrEqual(19)`), so the
gate keeps ratcheting.

### Tier 0 — the four one-line spell-outs (no decision required)

These are already wired for a human and invisible to the gate's literal match. The edit is to
replace `# + :cloud` / `(+ `:cloud`)` with the actual command on its own line.

| Script | File · line | Current text |
| --- | --- | --- |
| `db:load:court-load:pg:cloud` | `update-judiciary/SKILL.md:175` | `npm run db:load:court-load:pg   # + :cloud for Cloud SQL` |
| `db:load:nzok-drug-prices:pg:cloud` | `update-nzok/SKILL.md:114` | ``(+ `:cloud` to publish)`` |
| `db:load:nzok-tariffs:pg:cloud` | `update-nzok/SKILL.md:220` | `# (+ :cloud) applies migration 059` |
| `db:load:nzok-financials:pg:cloud` | `update-nzok/SKILL.md:137` | **no `:cloud` at all** — add it, mirroring the drug-prices line |

While in `update-judiciary`, lines 176-177 have the same `# + :cloud` shorthand for
`db:load:magistrates:pg` and `db:load:judicial-bodies:pg`; spelling those out too costs
nothing and removes the pattern that produced this.

### Tier 1 — has a reader, drifts on a routine flip, currently unowned

**1a. `db:load:agri-hub-stats:pg:cloud` → `update-agri`.** Highest severity of the set: it is
the sole applier of 163, and `/subsidies/political` + `/subsidies/cross-programme` are
DbDataTable resources with no degrade, so on a cloud database that never ran it they are 500s
rather than empty pages. Requires: a line in `update-agri/SKILL.md` after
`db:load:agri:pg:cloud` (line 46) stating that the agri ingest refreshes 162 but **not** 163;
and a `dfz_subsidies` Step-8 entry. Also worth a sentence in the four other owning skills
(`update-persons`, `update-funds`, `update-procurement`, `update-budget`) naming it as a cheap
follow-up, since the political arm is one vintage behind by construction.

**1b. The `update-procurement` Step-8 row gains three commands.** One edit, three scripts —
`process-watch-report/SKILL.md:684`, which today lists five cloud follow-ups:

- `db:load:annexes:pg:cloud` — the skill already mandates the local form at
  `update-procurement/SKILL.md:193`; CLAUDE.md already mandates the cloud form and calls it
  "mandatory after the cross-source reconcile" because an eviction orphans annex rows.
- `db:load:transport-facility-map:pg:cloud` — append to the existing "three contract-DERIVED
  crosswalk maps" clause and change "three" to "four".
- `db:load:employer-links:pg:cloud` — with the order note (after declarations **phase 1** and
  after `db:load:pg`), and a cross-reference from `update-officials`/`update-connections`,
  since the declarations side is their trigger.

**1c. `db:load:funds-fit:pg:cloud` → `update-funds`.** Requires: a line after
`update-funds/SKILL.md:228`/`:396` and an addition to the one-command Step-8 row
(`process-watch-report/SKILL.md:688`). Note in the text that this loader is the sole applier
of 143, 144 **and** 145, so it is not optional even when `fund_fit` itself looks unchanged.

**1d. `db:load:tr-name-fold-people:pg:cloud` → `update-persons`.** Add as a **fourth**
before-the-resolve prerequisite in both ordered blocks (`update-persons/SKILL.md:199-206` and
the "Person layer: the whole cloud chain" block in `process-watch-report` Step 8), with the
symptom stated in the omission table that already exists there: *prod publishes FEWER
person↔company links than local, because an empty table switches Bridge B off rather than
degrading it.* Emit unconditionally, by the same argument that block already makes for
`place-dim` and `judicial-bodies`.

### Tier 2 — the budget family (one skill, three loaders, currently zero coverage)

`update-budget/SKILL.md` contains **no** `db:load` or `:cloud` string at all. It needs a
publish section, not three scattered lines. Required content:

```
npm run db:load:place-dim:pg:cloud        # prerequisite of 149 — see below
npm run db:load:municipal-fiscal:pg:cloud # 149 + obshtina_population
npm run db:load:budget:pg:cloud           # 152/153/157 — the KFP + admin + programme grain
npm run db:load:budget-muni:pg:cloud      # 154 — what the state SENDS
npm run db:load:budget-hub:pg:cloud       # 156 — LAST: its matview reads all of the above
```

Plus, in `process-watch-report`: a Step-8 row for `update-budget` (there is none today), and a
line in the existing municipal-fiscal runbook (`SKILL.md:196`) which currently names only the
local loader and defers the cloud half to CLAUDE.md. Three things to say explicitly:

- `db:load:place-dim:pg:cloud` is a **hard prerequisite** of 149 — without it the migration
  42P01s and the target ends with no `municipal_fiscal` table.
- `db:load:budget-hub:pg:cloud` must run **last**: 156's matview reads eight budget tables
  plus `municipal_fiscal`.
- `budget:pg` and `budget-muni:pg` are different corpora — what the state SENDS vs what
  municipalities OWE — and neither fills the other's tables.

Second trigger to record: `data/macro_peers.json` (an `update-macro` artifact) is
`budget_peer_band`'s input, but measured, its `distribution` block did not move across 14
commits in 60 days — so a `update-macro` mention is a footnote, not a Step-8 row.

### Tier 3 — decide, then either wire or reclassify

**`db:load:grant-links:pg:cloud`.** No serving reader exists today; the surfaces are
`docs/plans/culture-investigative-v1.md` T1.6c, unbuilt. Two honest outcomes:

1. wire it into the same `update-procurement` block as `employer-links` (recommended —
   marginal cost is a clause, and it will not need revisiting when T1.6c ships); or
2. move it to a **new** exemption kind `no-reader`, with the reason naming T1.6c as the event
   that invalidates the exemption. It must not stay `unreviewed`.

### Tier 4 — record the permanent exemptions

Change four entries in `scripts/db/cloud_loader_coverage.ts` from `unreviewed` to their real
kind, with the reasons established above:

- `build:project-members:cloud` → `operator-tool` ("builds a committed, bucket-served JSON;
  the `:cloud` suffix only redirects the READ. `cloud-deploy-speed-v1.md` G17(d) proposes
  retiring the variant entirely.")
- `person:kmetstvo-flips:cloud` → `operator-tool` ("one-off `person_slug_lock` repair for a
  local-elections re-parse; procedure in `docs/plans/village-mayor-attribution-v1.md` §Cloud
  sequence.")
- `db:load:company-founded:pg:cloud` → `manual-trigger` ("ships a rate-limited crawl's output
  local→cloud; path documented in CLAUDE.md's CR Deeds section.")
- `db:load:cr-nkid:pg:cloud` → `manual-trigger` ("reads the gitignored `cr_deeds.sqlite`
  operator crawl; the four-step cloud publish order is in CLAUDE.md.")

---

## What I could NOT determine

Stated rather than guessed. None of these blocks the plan; each changes how urgent a tier is.

1. **Whether any of these tables/migrations is actually present on Cloud SQL today.** The
   brief forbids connecting to `:5434`, so every "on a cloud database that never ran this
   loader" statement above is a conditional. The three that would be **500s** rather than
   degrades — `agri_political_link` / `agri_cross_programme` (163) and
   `awarder_declared_officers` (168) — are the ones worth probing first with a single
   `SELECT to_regclass(…)` before assuming the pages are healthy.
2. **Whether `tr_name_fold_people` on Cloud SQL is empty or populated.** The consequence
   differs sharply: empty means Bridge B has been switched off on prod for every resolve since
   148 shipped (prod publishing fewer links than local, invisibly); populated means somebody
   ran the loader by hand and the gap is only a future risk. `resolve_persons.ts:2140` prints a
   warning when it sees the empty state — a past `db:resolve:persons:cloud` log would settle it.
3. **Whether `db:sync:cloud` has ever back-filled any of these.** It is a destructive
   whole-database `pg_restore --clean` and would carry every table at once; if it has been run
   recently the practical drift is smaller than the wiring gap suggests. Not recoverable from
   the repo.
4. **The exact watcher source id for the `budget:pg` admin/programme grain.** Five candidates
   move it (`egov_budget_execution`, `ministry_execution_reports`, `minfin_program_otchet`,
   `mfa_program_otchet`, `budget_law`) and all five map to `update-budget`, so the skill-level
   answer is unambiguous; which of them individually requires a reload is not established.
5. **Whether `db:load:budget:pg:cloud` is safe to run from an arbitrary operator machine.**
   Its admin/programme input is gitignored, so a machine that has not run the pipeline holds
   only the committed КФП half — and the loader's >5% shrink guard is what stands between that
   and a partial publish. Whether the guard fires (rather than the load succeeding with a
   thinner corpus) on a clone-fresh machine is untested; measure before writing the Tier-2
   runbook as unconditional.
6. **`db:load:annexes:pg:cloud` cost on Cloud SQL.** It recomputes the index from ~2,423
   cached day files locally and COPYs 24,380 rows over the proxy. Local is seconds; the cloud
   figure is unmeasured, and the Step-8 row should carry it once known.
