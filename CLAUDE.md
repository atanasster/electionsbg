# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**electionsbg.com** — A single-page application for visualizing and analyzing Bulgarian parliamentary elections since 2005. Live at [electionsbg.com](https://electionsbg.com).

The app is a JAMstack SPA: data is pre-processed offline into static JSON files in `/public`, then fetched client-side with React Query. There is no backend server.

## Commands

```bash
npm run dev          # Start Vite dev server
npm run build        # TypeScript check + production Vite build
npm run lint         # ESLint (prettier runs as an eslint rule, not a separate step)
npm run preview      # Preview the production build locally

# Tests
npm run test:unit    # Vitest — unit + component tests (src/** jsdom, scripts/** node)
npm test             # Playwright — E2E / SEO / perf / UI smoke (needs a built dist/)
npm run test:coverage # Vitest v8 coverage report

# Data pipeline (offline processing)
npm run data         # Process election data (tsx ./scripts/main.ts)
npm run prod         # Full pipeline with --all --prod flags
npm run sitemap      # Generate sitemap

# Postgres (local Docker; db:refresh runs the whole load in order)
npm run db:pg:up     # Start local Postgres (port 5433)
npm run db:refresh   # Full reload: schema + every loader + resolve + generators
                     # + test:data
                     # "Every loader" is enforced: refresh_coverage.test.ts fails
                     # unless each local db:load:*/db:resolve:* script is in the
                     # chain or in REFRESH_EXCLUSIONS (scripts/db/refresh_coverage.ts
                     # — currently tr, cr-founding, company-founded, all keyed to
                     # gitignored caches). The nzok family + both ngo legs are IN
                     # the chain; the gitignored-input loaders skip-and-warn when
                     # their file is absent (fresh clone), and nzok-hospital runs
                     # with --tolerate-offline so an nhif.bg outage cannot abort
                     # the chain. A PRESENT-but-malformed input still throws.
                     # The same gate covers the two db:gen-* GENERATORS that write
                     # a committed artifact from PG (REFRESH_GENERATORS) — see
                     # "The two committed artifacts db:refresh regenerates" below.

# Deployment
npm run deploy       # Deploy to Firebase (elections-bg project) — HOSTING ONLY
npm run deploy:db    # Deploy the `db` Cloud Function (/api/db, the /officials 301,
                     # and the server-rendered /funds/contract + /company pages)
npm run staging      # Deploy to Firebase staging (electionsbg-staging)
```

**Every URL this repo emits is the NO-slash form.** Hosting runs `"trailingSlash": false`
(`firebase.json`, hosting.main), so `dist/<path>/index.html` serves at `/<path>` and `/<path>/`
301s back to it. Canonicals, `og:url`, `hreflang`, sitemap `<loc>`, the ~350 `href="${SITE_URL}/…"`
links in `scripts/prerender/`, `functions/spa_page.js` and `scripts/llms/buildIndex.ts` must all
follow that. **The two roots invert the rule**: the bare `/` keeps its slash (hosting never strips
it) while the EN root is `/en`, NOT `/en/` — that asymmetry is the one thing to get right in any
new URL builder, and emitting `/en/` gives the EN homepage a canonical that 301s. Until 2026-08-03
hosting used the default (slash-adding) behaviour while the code emitted no-slash, so every
canonical on ~248k pages named a redirecting URL; see `docs/plans/parliament-hub-v1.md` §2.8.
`tests/seo.spec.ts` gates both the redirect direction and that no declared canonical / `og:url` /
`hreflang` redirects — the older test asserted only that the canonical *string* was right, which is
why this survived unnoticed.

**`npm run deploy` ships hosting only.** When a change spans hosting and the `db` function
— a new `/api/db` route, a new hosting rewrite pointing at it — deploy in this order:

1. the Cloud SQL migration (`npm run db:*:cloud`),
2. `npm run deploy:db`,
3. `npm run deploy`.

Hosting first means the rewrite is live against a function that cannot serve it yet.

**`/funds/contract/**` and `/company/**` are page URLs served by that function**
(`functions/spa_page.js`), not static files. They exist because both families were serving
the SPA shell — i.e. the HOMEPAGE's `<title>`, description and canonical — so to a crawler
all 81,910 contract URLs were duplicates of the homepage. Prerendering them is not an
option: `dist/` already holds ~248k files and Firebase's ceiling is on file COUNT
(a 453k-file dist has failed to deploy), while these two families are ~256k more.

Deploying the hosting rewrite BEFORE the function is the one ordering that breaks a page
that works today: the rewrite would route every contract and company URL to a function
with no handler for it. `deploy:db` first, then `deploy`.

**`/person/*` is a fourth member of that family, and the one easiest to get wrong.** The
`/person/*` + `/en/person/*` rewrites (`functions/person_redirect.js`) serve the 301 from
`person_slug_retired` — 23,916 slugs a re-resolve retired, which before 2026-08-08 returned
200 with the homepage's title and canonical and then noindexed themselves client-side. Same
ordering rule, `deploy:db` first. Three ways it differs from the three above:

- **It is only PARTLY function-served.** 25,167 person pages are prerendered and Firebase
  ranks exact-match static content above rewrites, so the function only ever sees the other
  ~101k. A missing rewrite therefore DEGRADES rather than breaks — which makes it easier to
  miss, not safer.
- **The rewrite must stay single-segment (`*`, never `**`)**, and the `/person/**` HEADER
  entry must carry no browser `max-age`: that value is read by the 25,167 static pages, and a
  browser-cached one pointing at a deleted `/assets/index-<hash>.js` is a white screen
  `main.tsx`'s stale-chunk recovery cannot reach (it only fires on dynamic-import failures).
  `scripts/deploy/firebase_person_rewrite.test.ts` holds both.
- **The handler owns every `/person` URL the rewrite reaches**, so anything it does not
  redirect it serves as the SPA shell — never a 404, or the ~101k non-prerendered people go
  with it. Those still serve the homepage's head; giving them their own via a `loadPerson`
  arm on `spa_page.js` is open work.

The function fetches the SPA shell from `https://electionsbg.com/` once per instance and
swaps the prerender's `<!-- SEO -->` / `<!-- BODY -->` marker blocks, so the hashed asset
script tags always match what hosting is actually serving and nothing needs re-deploying
when the bundle hash changes. Two consequences worth knowing: a cold instance makes one
extra outbound request, and if that fetch fails the page still serves correct head tags
without the SPA bundle (`FALLBACK_SHELL`) — complete for a crawler, degraded for a human,
which is the right way round for a failure nobody is watching.

The same migration-before-writer rule applies to the hand-run ingests that have no
`db:load:*:cloud` wrapper. `company_founded` writes `http_status`/`attempts`, so
`033_procurement_risk_indexes.sql` must be applied to the target database first:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 033_procurement_risk_indexes.sql
```

The founding-date writer (`upsertFoundingDates`) preflights and throws with that command in
the message if the columns are missing.

**CR Deeds full-capture** (`docs/plans/cr-deeds-capture-v1.md`) supersedes the old
`fetch_company_founded` crawl. The rate-limited crawl is an operator action — `npm run
tr:cr-deeds` (tiers 0/1/2a/2b/3; `--probe` first to gauge the block state); it writes the
durable raw store `raw_data/tr/cr_deeds.sqlite` (gitignored, never uploaded). Two projections
read that cache offline, no re-fetch:
- **owners** → `tr:daily-refresh` runs the persons projection automatically (inside
  `daily_refresh.ts`, additive into `company_persons`), then `db:load:cr-founding:pg` folds
  the founding dates into local `company_founded`. To publish owners + founding to prod, run
  `npm run db:load:tr:pg:cloud` and `npm run db:load:company-founded:pg:cloud` (the latter
  ships local `company_founded` → Cloud SQL, 033 applied there first). Nothing on the cloud
  side is automatic.
- **declared activity (НКИД→CPV mismatch)** → `db:load:cr-nkid:pg` (in `tr:daily-refresh`,
  a `REFRESH_EXCLUSIONS` member) parses each capture's `CR_F_6a_L` into `company_nkid`
  (eik→КИД-2008 division) and reseeds the `nace_cpv_*` crosswalk from the committed
  `src/lib/naceCpv.ts`. It backs the `nkidMismatch` risk flag (bit 12 of
  `contract_risk_cache`) + the `/company` "% outside declared activity" chip. **The division
  is classified from the LABEL, not the code** (`src/lib/naceLabel.ts`) — the НКИД field mixes
  НКИД-2003 and КИД-2008 codes that reuse division numbers for different sectors, so a
  code-based parse fired ~20k flags, thousands false (see `docs/plans/nkid-cpv-mismatch-v1.md`).
  Cloud publish, in order: apply `033`+`112` (company_nkid shell + nkidByEik payload + bit-12
  mask + crosswalk shells) via `apply_functions.ts`; `npm run db:load:cr-nkid:pg:cloud`
  (fills company_nkid + crosswalk, refreshes `procurement_risk_indexes_cache`); then
  `SELECT rebuild_contract_risk_cache();` on Cloud SQL so bit 12 reaches the served masks;
  then `npm run deploy:db` for the `/api/db/company` `nace_div` field (additive — the page
  renders without it). Nothing on the cloud side is automatic. Skipping the rebuild leaves the
  contracts browser's risk column without the flag while local has it.

`procurement_annexes` (migration 114, `db:load:annexes:pg`) is the same shape: it resolves
against the `contracts` table and reads the raw ЦАИС ЕОП annex cache, so on the cloud side run
`npm run db:load:annexes:pg:cloud` **after** the contracts corpus is loaded and whenever
`ingest_anexi` refreshes the cache — otherwise the per-annex breakdown (and the чл.116 ал.2
vs ал.3 labeling on the contract page) goes stale on prod while local is current. `db:refresh`
runs the local equivalent automatically (after `db:load:pg`); nothing runs it on the cloud side.

**It is also mandatory after the cross-source reconcile, for a second reason** — evicting a
duplicate row orphans that row's `procurement_annexes` entries (16 across 9 contract keys on the
2026-08-04 run), and only this loader re-resolves them against the reloaded corpus.

### Cross-source reconciliation — the pass that must run between backfill and load

The contracts corpus is built from FOUR feeds distinguished by `release_id` prefix — `aop-legacy-`
(АОП annual CSV), `eop-` (ЦАИС ЕОП flat договори), `ocds-` (АОП OCDS export), `rop-` (РОП). Each
splits a contract's value across its OWN view of the supplier set, so when one contract arrives
from two feeds the rows **cannot be summed** and the corpus over-states.
`scripts/procurement/reconcile_cross_source.ts` removes those duplicates on the SHARDS (not in
SQL — `pg_roundtrip.data.test.ts` asserts Postgres is a lossless capture of them):

```
ingest → anexi_current_value --apply → backfill_unp --apply → reconcile_cross_source --apply
       → rebuild_from_cache → db:load:pg → db:load:annexes:pg
```

Both predecessors are mandatory and the pass enforces the second with a УНП-coverage preflight:
the identity it reconciles on needs the УНП, which **does not exist at parse time** (the OCDS
export carries none, and `backfill_unp` writes it onto the shards afterwards). Run out of order it
is a silent no-op.

**Cloud needs no separate command** — the pass rewrites shards, so `db:load:pg:cloud` carries it.
What the cloud DOES need is `db:load:annexes:pg:cloud` after it, per the note above.

The pass is idempotent and dry-run by default. It permanently refuses two shapes and prints both
in full — groups where a feed contributed more than one row (no 1:1 twin exists) and side-pairs
failing a supplier-set/completeness precondition. Those are expected output, not failures;
`single_source_per_contract.data.test.ts` allowlists exactly them, and
`scripts/procurement/measure_cross_source.ts` re-derives every figure read-only against either the
shards or a database. Plan: `docs/plans/procurement-cross-source-dedup-v2.md`.

**SAME-feed duplication is a separate class, and the pass above is blind to it by construction** —
every grouping it does requires `count(DISTINCT feed) > 1`. The harness measures it as **§6**, and
the one rule to remember is **always read that section split by `tag`**, because the two arms are
disjoint on it and only one is a defect (plan:
`docs/plans/procurement-same-feed-dedup-v1.md`):

- **`ocds` (238 groups / €591.1m) is 100% `contractAmendment` and is NOT duplication — never evict
  it.** Those rows are distinct amendment events, verified 1:1 against
  `procurement_annexes.notice_id` (an independent ЦАИС source); they render the `/contract/:key`
  amendment timeline; and they already carry **zero € weight**, since `rollups.ts` excludes
  amendments from every money rollup and every serving SUM filters `tag = 'contract'`. The trap is
  specific: a tag-BLIND fold on identity E's fields pairs a `contract` row with its own
  `contractAmendment` and deletes the base contract.
- **`aop` is 100% `contract` and IS real, but the printed €2.94m is a FLOOR** — identity E requires
  a УНП that 42.2% of `aop-legacy-` rows lack. On full content identity it is €11.77m, of which
  30 groups / €2,068,182.74 are provable stale-key orphans (rows minted before
  `disambiguateContractKeys` shipped, which the key-merge in `writeMonthShards` never evicted).
  That sweep is **open work, not done**; `dedup_contract_keys.ts` cannot find them because it
  groups by the STORED key, so a stale-keyed row is a singleton group and is skipped.

### The two committed artifacts `db:refresh` regenerates

`data/procurement/derived/hub_stats.json` (the nine `/procurement` hub stat-tile numbers) and
`sector_stats.json` (the `/governance/sectors` headline per sector) are **committed and
bucket-synced**, but derived from Postgres — so unlike the rest of the PG-served procurement
tree they go stale in the repo whenever the corpus reloads. From 2026-06 until 2026-08-04 nothing
regenerated them at all; a contracts/tenders/agri/ngo reload moved the corpus underneath two files
that kept serving the old numbers at a 200. They are now in `db:refresh`:

```
… → db:load:ngo-funding:pg → db:gen-hub-stats → db:gen-sector-stats → db:load:judiciary-payloads:pg → …
```

**That slot is load-bearing, not cosmetic.** Five of `hub_stats`' nine fields come from tables
loaded across the whole chain (`tenders`/`kzk_appeals` at the tenders step, `awarder_seats` after
agri, `ngo_funding` last), and `sector_stats`' ДФЗ payout reads `agri_payloads`. Moving them
earlier — next to `db:load:annexes:pg`, where they visually belong — regenerates those fields from
the PREVIOUS vintage and commits it, which is the drift the wiring exists to end. After
`db:load:ngo-funding:pg` is the earliest safe position. `refresh_coverage.test.ts` holds chain
membership, and — since 2026-08-05 — a declared subset of the ORDER via its `ORDER_PAIRS` table
(each entry is "this loader must follow the step that rebuilds its input"). `hub_stats` /
`sector_stats` are NOT in that table yet, so for those two still check the dependency list in each
file's header before moving either; add a pair there when you do.

That table exists because the gap shipped a defect: `db:load:tr-company-place:pg` sat at step 25,
twenty steps ahead of the `db:load:graph:pg` that applies and rebuilds `company_public_money` (127)
— the money basis it denormalizes — so every contracts reload published the previous vintage to the
governance "фирми, регистрирани тук" tile with every row count reconciling. It now runs after
`graph`. Membership alone could never have caught that.

Three things about them differ from every `db:load:*` in the chain:

- **`hub_stats.ts` is the only applier of `062_procurement_hub_counts.sql`.** No `db:load:*` ships
  it, and nothing did before 2026-08-04, so `procurement_hub_counts()` existed only on databases
  where it had been applied by hand. Its `GRANT` is role-guarded (117/130 shape) because
  `roles_readonly.sql` is a one-time manual step — unguarded, it raises 42704 on a cold bootstrap
  and rolls the whole file back, leaving no function at all.
- **Both skip-and-warn rather than degrade.** A missing relation, function, empty `contracts`, or
  absent `data/budget/ministries/` (gitignored — `sector_stats` reads eight ПРБ nodes from it)
  logs and exits **0** without writing. Returning before the write is the point: a partial artifact
  would overwrite a good served file with a worse one and reconcile against nothing.
- **`company_politicians` / `tr_companies` can be legitimately ABSENT**, not merely stale — their
  only loader is `db:load:tr:pg`, a `REFRESH_EXCLUSIONS` member. `procurement_risk_feed` reads
  both, which is why `hub_stats` probes relations instead of assuming the chain implies them.

**There is no `:cloud` half.** These are committed FILES, not tables — they ship via
`bucket:sync` (`scripts/bucket_sync_paths.ts`), so a cloud reload does not touch them and a local
`db:refresh` is what makes them current.

The other seven `gen_procurement/` entries (`db:gen-rollups`, `-lists`, `-shards`, `-derived`,
`-xref`, `-index`, `-byns`) are sql-migration-v1 **parity verifiers**: they re-derive the JSON
pipeline from Postgres and write nothing unless `--write` is passed. They are correctly outside
`db:refresh`. That `process.argv.includes("--write")` idiom is what `refresh_coverage.test.ts`
uses to tell the two kinds apart, so a NEW generator dropped into `gen_procurement/` must either
join `REFRESH_GENERATORS` (and the chain) or carry the gate — it cannot quietly land outside.

The data pipeline CLI (`scripts/main.ts`) accepts flags: `--all`, `--prod`, `--date`, `--election`, `--reports`, `--stats`, `--search`, `--financing`, `--parties`, `--machines`, `--candidates`.

### Person layer — the one step `db:refresh` cannot infer

Deploying the person layer to **Cloud SQL** needs one extra command after
`db:resolve:persons:cloud`:

```bash
npm run person:slug-redirects:cloud -- raw_data/person/officials_reslug_2026_07_24.json
npm run person:slug-redirects:cloud -- raw_data/person/officials_reslug_2026_07_29.json
```

They load the officials re-slug maps into `person_slug_retired`, so the ~20.8k `/person` URLs
minted under pre-2026-07-24 officials slugs 301 instead of 404. The loader upserts, so each
dated map composes; add a line here whenever a new one lands (2026-07-29 is the collision-fold
drop — see `raw_data/person/README.md`). `db:refresh` runs the local equivalent automatically;
nothing runs it on the cloud side. See `raw_data/person/README.md` and
`docs/plans/persons-pg-retirement-v1.md` (T1.0).

**"Composes" means rows accumulate — NOT that older targets stay valid.** When a later map
retires a slug an earlier map already pointed somebody at, that earlier row becomes a 301 into
a 404 (`…ivanov1-da0219 → …ivanov1-94805e → …ivanov-b85a89` is the one that got caught). Both
writers — the loader and `db:resolve:persons` — now call `collapseSlugRedirectChains()` after
their write, so flattening is automatic and `db:resolve:persons` carries "redirect chains are
flat" as a post-condition. That matters for the cloud flows above that re-run the resolver
**without** a following `person:slug-redirects:cloud` (the judicial-bodies rerun): they stay
correct only because the resolver does it itself. The collapse only ever re-points at an
`active` + public-figure person, so a chain with no servable end is left broken and reported
rather than quietly made to look healthy — `person_slug_retired.data.test.ts` fails on it.

**A re-slug also invalidates `declaration.subject_ref`, and `--resolve` alone CANNOT repair
it.** For the `exec` and `muni` tiers `subject_ref` IS the officials slug, read out of the
per-person shard JSON by declarations **phase 1** (the `mp` tier keys on `mpId` and
`magistrate` on `declarantName`, so neither is affected). Phase 2 (`--resolve`) only joins
`person_role.ref = subject_ref` and fills `person_id` — it never rewrites the ref. So on the
cloud side a roster re-slug needs BOTH phases, phase 1 first:

```bash
npm run db:load:declarations:pg:cloud            # phase 1 — rewrites subject_ref
npm run db:load:declarations:pg:cloud -- --resolve
```

`db:refresh` never shows this because it runs phase 1 before the resolver every time. Skipping
phase 1 on the cloud leaves the stale ref joining to nothing: the filing keeps a NULL
`person_id`, so that person's declaration drops off `/person` and out of the "с декларация"
facet while every row count still reconciles. `--resolve` does print an
`N/total still NULL` line, so it is not literally silent — but a single-digit N against
47,983 reads as ordinary residue, which is exactly how this one was missed. Caught 2026-07-31 — after the
2026-07-29 collision fold, exactly one of 47,983 filings (`ivan-georgiev-ivanov1-94805e`)
stayed unresolved on Cloud SQL until phase 1 was re-run. Re-run
`db:load:persons-browse:pg:cloud` afterwards, since `has_declaration` reads `person_id`.

Likewise, after `db:load:declarations:pg:cloud -- --resolve` (which creates the municipal
roster matview), run the candidateLink loader so the Cloud SQL municipal roster carries the
party colours / councillor avatars the /governance + My-Area tiles render:

```bash
npm run db:load:official-candidate-links:pg:cloud
```

It populates `official_candidate_link` and REFRESHes `municipal_officials_table`. `db:refresh`
runs the local equivalent automatically; the cloud side does not. See
`docs/plans/persons-pg-retirement-v1.md` (T1.5).

Same shape, and it must run **BEFORE** `db:resolve:persons:cloud` rather than after: the
judicial dimension (migration 116) is what gives every magistrate their court on `/person`.

```bash
npm run db:load:judicial-bodies:pg:cloud
```

It rebuilds `judicial_body` + `judicial_body_alias` from `magistrate.court` ∪
`court_load.name`, so re-run it whenever **either** of those is reloaded on the cloud side
(`db:load:magistrates:pg:cloud`, `db:load:court-load:pg:cloud`) — then re-run
`db:resolve:persons:cloud`, which reads the alias table. Skipping it does not fail: the
resolve simply finds an empty alias table and ~2,700 magistrate roles publish with no
court, green locally and blank on prod. See
`docs/plans/person-role-place-consolidation-v1.md` (T2).

**It is now ALSO what makes `/court/:bodyCode` truthful.** `judicial_body_source_name` is the
un-folded bridge `judicial_body_detail()` joins `court_load` through — the raw-name→body fold lives
in TypeScript, so SQL cannot do it. Applying 116 with `apply_functions.ts` (the normal way a
function change ships) CREATEs that table EMPTY, and an empty bridge returns `load: null` for every
body: shape-identical to a real prosecution office, so all 279 pages would assert at a 200 that the
ВСС publishes no workload for them — including Софийски районен съд. The payload therefore carries
`sourcesBuilt`, and the page says "not loaded yet" rather than "nothing published" when it is
false; the fix is to run this loader. `judicial_body_detail.data.test.ts` fails if the flag stops
discriminating.

**And it is now a BUILD-TIME dependency, which is the one requirement on this page that is
not a `:cloud` command at all.** `/court/**` is prerendered — 279 static pages plus 279 EN
mirrors, a `sitemap_judiciary.xml` shard and a table in `llms-full.txt` — and all four are
enumerated by `scripts/db/lib/seo_courts.ts`, a build-time reader over `judicial_body`. That
reader returns `[]` on any failure by design, so **the machine running `npm run build` needs
the dimension in its LOCAL Postgres**, not merely the deploy target:

```bash
npm run db:load:judicial-bodies:pg        # local — before `npm run build`
npm run db:load:judicial-bodies:pg:cloud  # the serving database, as above
```

Building without it does not fail — it emits zero court pages, no `<loc>`s for them and a
corpus missing that section, all at exit 0, which is the good failure but an invisible one.
Two gates make it visible instead: `scripts/sitemap/families.data.test.ts` asserts every
`/court` and `/pension-fund` `<loc>` has a `dist/<path>/index.html` (the sitemap is COMMITTED
while `dist/` is not, so a sitemap minted with Postgres survives a build without it — but the
gate only sees a `dist/` that exists, so run it AFTER `npm run build`), and `buildFull.ts`
refuses to rewrite `llms-full.txt` when the judiciary section would disappear from it. The
`tests/seo.spec.ts` court samples skip rather than fail on a database-less checkout.

`/pension-fund/**` is the same page-family shape with none of this exposure: its source
`data/budget/kfn/funds.json` is committed, so it builds anywhere.

**Sofia's courts had FIVE duplicate bodies until 2026-08-05, and the shape is worth
knowing because it can come back.** Sofia's institutions have adjectival names
(`Софийски районен съд`), so they get curated entries in `judicialBodies.ts`'s `NATIONAL`
list, which is checked BEFORE the generic seated rules — precisely so `Софийски районен
съд` cannot fall through and mint `rs-sofiya`. That defence only ever covered the
spelled-out spelling, while `court_load` — the ВСС's own workload series — writes the
abbreviated one (`РС-София`, `ОС - София`, `АдмС - София-град`). So the abbreviated form
sailed past the national rule into the seated one and minted exactly the five codes the
national rule exists to prevent, each splitting one court's magistrates onto one page and
its workload onto another: `/court/as-sofia-grad` stated the ВСС publishes no workload for
it while publishing eight years of it under `as-sofiya-grad`.

`foldJudicialName` now spells out a LEADING institution abbreviation (`РС` → `РАЙОНЕН СЪД`
…), so both spellings reach the national rule as one key. `АС` and `ВС` are deliberately
excluded — they collide across families and only `resolveJudicialBody`'s `tier` hint can
settle them. Two gates in `judicial_body_detail.data.test.ts` hold it: no two bodies share
a (kind, tier, seat) outside a named allowlist, and no court has its magistrates on one
row and its workload on another.

Same shape again, and also **BEFORE** `db:resolve:persons:cloud`: the canonical place
dimension (migration 117) is the code→name dictionary `082_person_api.sql` JOINs for the
`mir` / `obshtina` label on every `/person` role, and `/procurement/by-settlement` joins
for settlement names.

```bash
npm run db:load:place-dim:pg:cloud
```

It is built from `data/settlements.json` + `data/municipalities.json` (labels via
`scripts/person/places.ts`), so re-run it whenever either file changes. `db:refresh` runs
the local equivalent automatically; the cloud side does not.

Related, and the only loader whose trigger is a **calendar rollover** rather than a source
change — the pscope windows (migration 118) **and the per-scope precomputes they drive**
(migration 119, `procurement_settlement_rank` + `procurement_geo_payloads` behind
`/procurement/by-settlement`; migration 122, `contractor_rank` + `contractor_scope_kpis`
behind `/procurement/contractors`; migration 123, `procurement_settlement_payloads` behind
every `/procurement/settlement/:ekatte` page and My-Area procurement tile; migration 124,
`procurement_payloads` behind the six `/api/db/procurement-*` dashboard routes):

```bash
npm run db:load:procurement-scopes:pg:cloud
```

It writes the window rows, applies 119 + 122 + 123 + 124 and REFRESHes all six matviews
(**46 s** local, measured end to end; `contractor_rank` fans ~29.5k contractors × ~30 windows ×
CPV-division rollup ≈ 9 s, 123 fans 869 settlements × 30 windows ≈ 10 s, and 124 fans 6 kinds ×
30 windows ≈ 10 s) — so "the scopes changed" and "the precomputes match the scopes" can never
be two separate states.
`contractor_scope_kpis` reads `contractor_rank`, so it is refreshed after it. **Cloud SQL is
unmeasured and will be materially slower** — the whole reason 123 exists is that the same
per-settlement call is 401 ms locally and had not finished at the 10 s `statement_timeout`
that aborted it on a cold `db-g1-small` — so expect minutes, not seconds. Re-run it:

- whenever a new election lands in `src/data/json/elections.json` (a new `ns:` window);
- **every January** — the year windows are enumerated `SCOPE_FIRST_YEAR..currentYear`, so on
  1 January the `?pscope=y:<new year>` option appears in the UI while the table still stops
  at the old year, and that scope serves an empty page;
- after a standalone `db:load:place-dim:pg:cloud` **only when it reports that it skipped its
  own refresh** — it changes the English settlement names the ranking joins, and it now
  refreshes them itself whenever the dimension actually moved (see the side loaders
  below). Re-running this loader after it already did that is a needless multi-minute cloud
  rebuild.

The refresh list, its ORDER, **what each matview is built FROM** and the not-populated
fallback live in ONE place — `scripts/db/lib/scopedMatviews.ts`. A migration that adds a
per-scope matview must join `SCOPED_MATVIEWS` there or no loader will ever refresh it;
`procurement_settlement_payloads.data.test.ts` fails on any matview that reads
`procurement_scopes` and is missing from the list.

**The `inputs` array on each entry is as load-bearing as the name, and it fails differently.**
A missing NAME means nothing ever refreshes that matview; a wrong `inputs` means the loader for
the undeclared table skips it, so one page keeps the previous attribution while the rest of the
site has moved on. That is invisible to a row count and to the exhaustiveness gate above, which
only checks presence. `procurement_payloads.data.test.ts` closes it for 124: it reads that matview's six
function bodies out of `pg_get_functiondef` and fails if it reads a table it does not declare.
(For 124 only — no gate does this for the other entries yet.) It is not a hypothetical: 124's
first committed draft declared `["contracts", "awarder_seats"]` and missed `company_politicians`
and `tr_companies`, which four of its six aggregates read.

**Three loaders outside this one also refresh part of the list**, because they change what
those matviews are built FROM, and skipping them is invisible:

```bash
npm run db:load:awarder-seats:pg:cloud   # WHICH buyers are seated in a settlement (119+123+124)
npm run db:load:place-dim:pg:cloud       # the place hero 123 STORES in its payload (119+123)
npm run db:load:tr:pg:cloud              # company_politicians / tr_companies (122+124)
```

All three now do it themselves, and each gets only the matviews its input can actually move.
`place-dim` fingerprints the table either side of its rewrite and skips the refresh when the
rows are byte-identical, which is the usual case, so it stays cheap to run blind — it says
which it did. Without these, a standalone reload moves a buyer between settlements, blanks a
place hero, or leaves every MP-tied figure on the previous link set, everywhere on the site
**except the precomputed pages**, which keep serving the old attribution at a 200.

Two of those pairings are worth stating because they look wrong:

- **`awarder-seats` refreshes 124**, which has no settlement dimension — because one of its six
  aggregates, `procurement_concentration`, resolves each row's `oblast` from `awarder_seats`
  (86.6% of the `all` scope's 2,755 rows carry one).
- **`tr:pg` refreshes 122 and 124** but neither settlement matview. It TRUNCATEs and reloads
  `company_politicians`, the politician↔company link set every MP-tied figure derives from —
  so before this it was already leaving `/procurement/contractors`' MP-tied KPIs on the
  previous vintage, with nothing red anywhere.

`cpv_catalog` (migration 121) is the same shape but rides the TENDERS loader: `db:load:tenders:pg`
applies it and calls `rebuild_cpv_catalog()` right after the corpus commits, so on the cloud side
`npm run db:load:tenders:pg:cloud` keeps it in step with no extra command. The only ordering that
matters is the FIRST deploy — the loader must run **before** the `deploy:db` that ships the route
reading it, because that route no longer degrades a missing table to an empty array (an empty CPV
picker served with a 200 is exactly the failure it was created to end). `cpv_catalog.data.test.ts`
fails on an empty or stale table.

`vote_item` / `vote_cast` / `mp_seat` / `party_dim` (migration 134,
`db:load:rollcall:pg`) are the National Assembly roll-call corpus — 16,741 items and 4M
casts loaded from `data/parliament/votes/sessions/*.json`, the same tree the derived JSON
metrics read. In `db:refresh`; on the cloud side:

```bash
npm run db:load:rollcall:pg:cloud            # facts
npm run db:load:rollcall-derived:pg:cloud    # the four precomputes — ALWAYS after facts
```

Re-run it after **every** `update-rollcall` ingest that added a session; the skill's Step 5b
says so, and nothing runs it automatically. Stage-merge, so it is safe against a live
database.

**Two things about this table are easy to get backwards and both fail silently.**
`vote_item` holds ALL 16,741 raw items — the 1,645 re-votes `dedupeRevotes` collapses carry
`superseded_by`, so **every aggregate needs `WHERE superseded_by IS NULL`** or it
over-counts by 9.8% at a 200. And party affiliation lives on `vote_cast.party_id`, the
affiliation AT CAST TIME: 179 of 2,366 seats change party mid-term, so grouping on
`mp_seat.party_id` instead compares those members against a group they had already left.
`rollcall.data.test.ts` holds both, plus the 26 recycled `mp_id`s that make `(ns, mp_id)`
the only safe key.

**`/api/db/session?date=` + `/api/db/session-item?item=`** split the day file that
`/votes/<date>` currently downloads whole — 482 KB on an average day, 4.97 MB on
2025-06-19, because that file carries every MP's vote on every item. The day route is the
agenda and the tallies (14 buffers); the item route is one item's per-MP votes (~64 — the
PK scan is 7, and the joins onto `mp_seat` and `party_dim` for names and party labels are
the rest). Neither can be planned into the seq scan that costs 21,904 buffers, because the
item route is driven from an explicit `item_id` rather than a join on date.

Unlike every matview, the day route does **not** filter `superseded_by`: it is the day's
RECORD rather than a statistic over it, and a motion put to the floor twice is a fact about
the day.

**`SessionScreen` is not yet on these routes**, and `data/parliament/votes/sessions/` is
still bucket-served. Retiring it needs, in order: the screen moved onto the two routes
(it currently reads `mpNames`, `mpParty` and every item's `votes` from the file);
the routes verified on prod; then `bucket_sync_paths.ts` gaining BOTH an `isExcluded`
refusal and a `CHILD_EXCLUDES` entry for `parliament/votes/sessions` — one without the
other still lets `bucket:sync:paths -- parliament` re-upload all 613 files; then a scoped
`--delete`. The files stay on disk either way: they are the loader's input AND the
prerender's fact source (`scripts/prerender/votesFacts.ts`).

**`bill` (migration 136) rides the SAME loader** — `db:load:rollcall:pg` applies 136 and fills
it, so `db:load:rollcall:pg:cloud` carries it with no extra command. 504 rows, one per
(ns, title stem) that **reached a second reading** — NOT every bill the chamber saw, because
that is the set the /parliament tile counts and a table whose `count(*)` disagreed with the
number on the page is exactly the drift the hub plan exists to remove.

Two things about it are easy to get backwards. The stem split is **TypeScript**
(`secondReadingStem` in `scripts/parliament/derived/hub_stats.ts`), never a SQL regex — the
rule has a documented trap in it, since a title carrying „второ гласуване" in a PROCEDURAL
position is a FIRST reading, and matching the phrase instead of requiring the split to fire
counted 8 extra bills on the 52nd. And **`final_item` is always NULL**: it is where a
whole-bill adoption marker would live, and this corpus has none, so NULL means "not
derivable" rather than "not adopted". `bill_and_topics.data.test.ts` fails if either changes.

**`/api/db/vote-day-summary?ns=` + `/api/db/contested-votes?ns=`** retire the 8 MB
`topic_index.json` from the two consumers that fetched it whole — the `/votes` table (a topic
chip set and a four-segment outcome bar per day) and the contested-votes tile. 39 rows and
34 ms for the 52nd against an 8 MB download.

Both **filter `superseded_by`**, unlike the `session` route above, because both are
statistics over the day rather than the day's record — and the artifact they replace was
computed after `dedupeRevotes`. Both also keep `topic_index.json` as a **fallback**, so a
checkout without Postgres and a first cloud deploy before the loader runs still render;
the file therefore stays in `rebuildDerived`'s `--upload` list.

The outcome bucketing exists **twice** — in SQL in the route, and in `outcomeBucket()` /
`outcomeFor()` in TypeScript for the fallback — because a route cannot import TS.
`bill_and_topics.data.test.ts` re-derives every day's buckets from the session files and
fails on any disagreement; without it the two drift silently and the symptom is a bar of the
wrong colour. Measured coverage of that gate: the `abstain = cast` branch is the one clause
no item in the corpus reaches, so it rides on `outcomeFor()`'s definition alone.

**The derived half (migration 135, `db:load:rollcall-derived:pg`)** builds `mp_attendance`,
`party_cohesion`, `mp_dissent`, `mp_vote_norm` and `mp_similarity`, declared once in
`scripts/db/lib/rollcallMatviews.ts`. ~70 s locally, dominated by the quadratic
`mp_similarity` — **measured on Cloud SQL 2026-08-06: 801 s end to end, of which
`mp_similarity` alone is 744.5 s (12.4 min, 11x local)** on a db-g1-small at 4,017,519
casts. Budget a quarter of an hour and do not chain it behind anything urgent. The facts
half (`db:load:rollcall:pg:cloud`) is ~10 min, dominated by ~2,900 single-row round trips
through the proxy before the COPY starts. `/api/db/mp-dissents` and
`/api/db/mp-similarity` read them and DEGRADE to an empty array on `42P01 · 42883 · 55000 ·
55P03 · 42501` — `55000` is in that set because a matview created `WITH NO DATA` RAISES
rather than returning zero rows, which is every first deploy; `57014` is deliberately out,
because it is the pool's own timeout and degrading there turns a 10 s failure into a 20 s
one. `mp_similarity` stores `dot` + `overlap`, NOT an agreement rate: the score consumers
are calibrated for is a cosine (`score = dot / (norm_a * norm_b)` via `mp_vote_norm`), and
substituting a rate would relabel "voting twins" sitewide.

`transport_facility_geo` (migration 132, `db:load:transport-facility-map:pg`) is the static
crosswalk behind the `/sector/transport` facility map — the same 073/074 family as the water
and МВР maps, in `db:refresh`, curated from `TRANSPORT_ENTITIES` with a Варна physical-facility
override for the two maritime bodies. First cloud deploy needs
`npm run db:load:transport-facility-map:pg:cloud` (after `db:load:awarder-seats:pg:cloud`)
**before** the `deploy:db` that ships the `/api/db/transport-facility-map` route — the route
degrades a missing migration to an empty map, so ordering is cosmetic, not breaking. Re-run it
whenever `TRANSPORT_ENTITIES` changes; `transport_facility_map.data.test.ts` fails on drift.

`tr_company_place` (migration 133, `db:load:tr-company-place:pg`) is the company↔settlement
crosswalk behind the "фирми, регистрирани тук" tile on every governance dashboard and
`/api/db/place-companies`. It resolves the free-text `tr_companies.seat` to an EKATTE code
offline through the shared `EkatteResolver` (99.6% of seated companies; an ambiguous name
stays unresolved rather than guessing a village). In `db:refresh`; on the cloud side:

```bash
npm run db:load:tr-company-place:pg:cloud
```

**Its two ranking columns are DENORMALIZED, which makes its re-run trigger wider than its
input.** `money_eur` / `political_n` are copied from `company_public_money` (127) and
`company_politicians` (008) so the tile's top-N is an index scan — measured on Sofia's
110,474 companies, the live-join form of `place_companies()` ran **979 ms**, the stored form
**57 ms**, and prod is a db-g1-small. So re-run it after `db:load:tr:pg` (which rebuilds BOTH
tr_companies and company_politicians) **and after any contracts / agri / funds reload**.
Skipping it is the usual silent shape: the tile keeps ranking and counting the previous
vintage at a 200. `tr_company_place.data.test.ts` fails on an empty/stale table, on either
denormalized column drifting from its source, and on the Sofia call exceeding 400 ms.

The route degrades a missing migration to an empty place, so first-deploy ordering is
cosmetic. The tile self-suppresses on `count === 0`, so a cloud database that never ran the
loader simply shows no tile rather than an empty one.

`interreg_programmes` / `interreg_operations` / `interreg_partners` (migration 137,
`db:load:interreg:pg`) are the Interreg cross-border corpus — 1,954 operations, 12,141
partnerships, 1,493 Bulgarian partner rows, €396.39m — from keep.eu (INTERACT), which is
where Interreg lives because it runs on **Jems** and not on ИСУН. That is why
`fund_projects` holds zero Interreg rows: the gap is a system boundary, not a filter.
In `db:refresh`; on the cloud side:

```bash
npm run db:load:interreg:pg:cloud
```

**Its re-run triggers are wider than its own source**, and two of the three are the
non-obvious ones. Place resolution happens IN THE LOADER (Tier L1 reads `awarder_seats`,
L2 reads `tr_company_place`), so 199 of the 1,469 placed rows depend on the *content* of
those two tables and not merely on their existence. Re-run it after:

- a keep.eu re-import (`npm run funds:crawl-interreg -- --full` then `funds:ingest-interreg`);
- **`db:load:awarder-seats:pg:cloud`** — 158 placements;
- **`db:load:tr-company-place:pg:cloud`** — 41 placements.

**`place_dim` is a hard PREREQUISITE, not a trigger, and it is the one that bites on a
first cloud deploy.** The loader reads it for the obshtina/oblast label on every placed row,
including the `nuts3` column — so a database whose `place_dim` predates 117's `nuts3` fails
with `42703 column "nuts3" does not exist` AFTER applying 137/138/139 and before writing a
single row. Measured on the 2026-08-08 production deploy, which is exactly how this note
came to exist: prod's `place_dim` had the right ROW COUNT (5,720, matching local) and the
wrong columns, so a count-based preflight passed it.

```bash
npm run db:load:place-dim:pg:cloud   # BEFORE db:load:interreg:pg:cloud
```

Budget for it: the rows change, so its fingerprint check fires the refresh it guards and
rebuilds `procurement_settlement_rank`, `procurement_geo_payloads` and
`procurement_settlement_payloads` — 46 s locally, minutes on a db-g1-small, and a plain
`REFRESH` takes an AccessExclusiveLock, so `/procurement/by-settlement` and every settlement
page block for the duration.

Skipping it after either crosswalk moves is the usual silent shape: the corpus keeps the
previous placements at a 200. `refresh_coverage.test.ts` carries both as `ORDER_PAIRS`
entries, which covers the local chain; nothing covers the cloud side.

The loader **refuses rather than degrades** on an absent or empty crosswalk, and on a
placement share below 90%. That is not defensive padding: all three tables are
stage-merged, so the upsert SETs `ekatte`/`obshtina`/`oblast`/`place_basis` from the stage
like any other column — a run with a broken cascade writes NULL over good placements and
`mergeFromStage`'s parity guard **passes**, because it counts rows, not places. Measured:
empty crosswalks take placed rows 1,469 → 1,270 with the guard green.

**Never build the stage from one programme.** `ingest.ts`'s `--programme` is a debugging
filter that refuses to write, and the loader has no such flag at all, because
`stageDeleteSql` is an unscoped anti-join: a partial stage deletes every other programme's
operations, `ON DELETE CASCADE` takes their partners, and the parity guard passes again.

**The corpus is only half of a publish.** Loading `interreg_partners` moves nothing on the
money surfaces by itself, because `company_public_money` (127) — the ONE reusable per-EIK
broad-money basis — grew an Interreg arm, and the GRAPH loader is 127's only applier and
refresher. So the cloud order is:

```bash
npm run db:load:interreg:pg:cloud          # the corpus
npm run db:load:graph:pg:cloud             # 127's 4th arm reads it; nothing else applies 127
npm run db:load:tr-company-place:pg:cloud  # money_eur is denormalized from 127
```

Skipping the second leaves every Interreg euro out of `/connections`, out of the governance
"фирми, регистрирани тук" ranking and out of `/company/:eik`'s money, with the corpus itself
fully loaded and every row count reconciling.

**That arm closes a dependency CYCLE, and `db:refresh` therefore runs one vintage behind.**
The local chain is graph (47) → tr-company-place (49) → interreg (50), and the order is
forced from both ends: `tr_company_place` denormalizes 127, while the Interreg place cascade
reads `tr_company_place`'s EKATTE. Adding the arm made 127 read `interreg_partners`, so no
`ORDER_PAIRS` entry can express it — the three form a loop. Consequence, stated rather than
hidden: the Interreg arm is built from the PREVIOUS run's corpus, and a first-ever Interreg
load contributes no money until graph runs again. Re-run `db:load:graph:pg` after an Interreg
reload to close it in one pass. (`load_graph_pg.ts` applies 137's DDL before 127 so a
database that never loaded Interreg still builds the matview — see 127's header for why a
`to_regclass` branch was the wrong fix.)

**The serving layer is "applied, never loaded" and needs its own command.** 138
(`interreg_by_place` / `interreg_by_eik` / `interreg_overview` / `interreg_operation` /
`search_interreg_operations`) and 139 (`funds_muni_combined_v` + the per-capita ranking) are
FUNCTIONS and a VIEW — they carry no data, and `deploy:db` ships `functions/` code, which is
a different thing from a Postgres function. `db:load:interreg:pg[:cloud]` applies both, so a
corpus reload carries them; a function-body fix on its own does not wait for one:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts \
  138_interreg_serving.sql 139_funds_muni_combined.sql
```

**`/funds/interreg/**` is a page URL served by the `db` function** (`functions/spa_page.js`),
like `/funds/contract/**` and `/company/**` — so the same ordering rule applies and it is the
one that breaks a working page: **`npm run deploy:db` BEFORE `npm run deploy`**. Hosting
first points all ~1,954 operation URLs at a function with no handler for them. They are not
prerendered and carry no sitemap `<loc>`; without the function they serve the homepage's
`<title>` and canonical, which is the duplicate-content shape this handler exists to end.

`funds_fit_procedure(code)` (also 143) is the base-rate card on `/funds/procedure/:code` —
beneficiaries, the grant MEDIAN with its quartiles, org-kind mix, and the disbursed share. A PK
seek on `ux_fund_fit_code` (0.05 ms), which is the whole reason `fund_fit` is materialised. It
ships with the same loader.

**The reference price („5% от медианния грант тук = €X") is arithmetic, and the split is
deliberate.** The route returns the MEDIAN and nothing derived from it; the division happens
client-side, in the open, at three percentages so no single one reads as an endorsement. There is
no consultancy-fee corpus in Bulgaria, so „a fair fee is Y" is a verdict we cannot support and is
explicitly out (plan §8.4-4) — what we publish is the denominator, and the card says so. The
measured demand is Appendix A category D: „поискаха ми 4000 € и 5% от сумата — това реални цифри
ли са?".

**Nothing on that card is an approval rate.** `paid_project_count` is DISBURSEMENT — ИСУН
publishes no rejected applications, so the denominator for „одобрен ли е бил" does not exist.
`ProcedureBaseRates.test.tsx` fails if the word „одобрен" appears anywhere except inside the
disclaimer that rules it out.

`funds_hub_stats_cache` + `funds_hub_stats()` (migration 145) is the `/funds` HUB's one stat
call — the figures on its tile grid, behind `/api/db/funds-hub-stats`. **`db:load:funds-fit:pg`
applies and refreshes it**, and that placement is not where it looks like it belongs: its
primary input is the funds corpus, but `CREATE MATERIALIZED VIEW` resolves its query at
creation and 145 needs `canon_oblast` — which 143 defines, applied by that same loader one
`db:refresh` step after `db:load:funds:pg`. Applied from the funds loader it fails with
`function canon_oblast(text) does not exist` and rolls back a 57-step chain at step 10.

```bash
npm run db:load:funds-fit:pg:cloud
```

**It is materialised because the live aggregate cannot be served.** Measured: 18,855 buffers
with a spill to temp, against the ~2,000 the dashboard-hub skill allows for a call every view
makes. The seek is 40.

Three things about it are easy to get backwards:

- **Its Interreg arm closes a CYCLE, so it is refreshed from BOTH ends.** 145 reads
  `interreg_operations`/`interreg_partners` (step 52) while its primary input is at step 10/11,
  so `db:load:funds-fit:pg` refreshes it with the PREVIOUS Interreg vintage and
  `db:load:interreg:pg` refreshes it again. Consequence, stated rather than hidden: a
  first-ever run is populated by step 52, and after any complete `db:refresh` the numbers are
  current. Skipping the interreg-side refresh leaves the hub's Interreg tile a vintage behind
  at a 200 with every row count reconciling.
- **Every key names its BASIS, and that is load-bearing rather than verbose.**
  `absorptionPctOfGrant` (53.8%) and `absorptionPctOfContracted` (41.1%) are both true and 12.7
  points apart; `beneficiaryCount` (47,599, EIK-or-name) and `beneficiaryCountEikOnly` (46,174)
  differ by 1,425 organisations; `bgPartnerOrgCount` (983) and `bgPartnerRowCount` (1,493) by
  52%. A key called `absorptionPct` invites a consumer to pick a denominator by accident.
- **`placedMoneyPct` is a MONEY share, never a row share, and the two are 45 points apart.**
  Only 4.6% of rows carry no oblast — but they hold **50.05% of the money**, because the
  national-scope programmes have no single oblast to sit in. „4.6% от договорите нямат място"
  is true and misleading; a place surface declares the money coverage.

`funds_wire()` / `funds_news()` (migration 144) are the `/funds` band-0 wire and band-2 news
rail. **`db:load:funds-fit:pg` applies 144 as its last step**, so a corpus reload carries it —
`funds_news`'s third card reads `fund_fit`, which is why that loader is its home. Nothing else
applies it, and it needed an applier: `db:refresh` ends with `test:data`, so an unapplied 144 makes
a full reload fail at its final step. A body fix ships on its own with the usual escape hatch:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 144_funds_wire.sql
```

**144 must DROP `funds_wire` before recreating it**, and the line is load-bearing: `checked_on` is
`text` rather than `date`, so the signature changed and `CREATE OR REPLACE` cannot alter a
function's OUT-parameter row type. The type is `text` because node-postgres converts a PG `date`
using the SERVER PROCESS's timezone — under `TZ=Europe/Sofia`, `2026-08-09` leaves as
`2026-08-08T21:00:00Z` and the page renders the day BEFORE. Prod is correct only because Cloud Run
leaves `TZ` unset, which is luck rather than design.

**144 also creates `idx_ifs_source_seen (source, first_seen_at)`, and that index is the whole
reason the wire is servable.** `idx_ifs_seen` carries only `first_seen_at`, so a time-range
predicate over `ingest_first_seen` pulls every dataset's rows out of a 15M-row table: measured at
30,105 buffers and 1,046 ms for one figure, on a function that runs on **every** /funds view. With
it, 2.3 ms. Any future „what did source X first see in window W" query wants the same index.

**Three things the corpus cannot do, which shape every label on those surfaces:**

- **`fund_projects` has NO date columns** — no signing, start or end date; ИСУН's beneficiary
  export publishes none. So every figure is an INGEST window and the copy says „нови в ИСУН",
  never „нови договори". The plan's „event date, not ingest date" rule was written for the
  procurement corpus, which has `contracts.date`.
- **„Процедури, приключили наскоро" is therefore not buildable** — there is no completion date to
  order by, and using the ingest date would present the crawl order as the finishing order. The
  rail ships three cards, not the four the plan lists, and `funds_wire.data.test.ts` asserts
  exactly those three so the omission stays a decision.
- **The disbursement card is restricted to the CLOSED 2014-2020 period** (`program_code LIKE
  '2014%'`). Without that restriction a procedure at 0% is indistinguishable from one signed last
  month — measured, the top three were all 0% and all 2021-2027, i.e. recency rendered as
  underperformance.

**A backfill is not news, and the threshold is NOT re-derived here.** The `summarised` rule from
`007_query_builders.sql` (`rows_new > 500`, or any batch in summary mode) is applied in both
functions, so the wire and `/data/updates` cannot disagree about what counted. Backfill days are
reported SEPARATELY rather than dropped — on a freshly loaded corpus that is the difference
between „quiet" and „broken pipeline".

`fund_fit` (migration 143, `db:load:funds-fit:pg`) is the „финансирано ли е нещо като моето"
resolver behind the `/funds` tile and `/api/db/funds-fit` — a per-PROCEDURE rollup over the ИСУН
corpus (project count, grant quartiles, org-form mix, oblast breakdown) that answers the question
~68% of the measured audience actually asks, and which every other funds surface ignores. In
`db:refresh` right after `db:load:funds:pg`; on the cloud side:

```bash
npm run db:load:funds-fit:pg:cloud
```

**Its only staleness trigger is a funds reload** — `fund_projects` plus the procedure NAMES in
`fund_payloads(kind='procedure')`, both rebuilt by `db:load:funds:pg`. That pairing is in
`refresh_coverage.test.ts`'s `ORDER_PAIRS`. The Interreg arm needs nothing here (see below).

**Four things about it are easy to get backwards:**

- **BOTH corpora, served as SEPARATE arms.** ИСУН holds zero Interreg projects, and Interreg money
  is cross-border so it lands almost entirely on BORDER municipalities — an ИСУН-only resolver
  answers „нищо подобно не е финансирано наблизо" to exactly the readers whose neighbours hold
  grants. They are never summed: an ИСУН figure is a contract's own value, an Interreg figure one
  partner's published budget. `funds_fit_basis()` returns the declaration IN THE PAYLOAD so a
  consumer cannot render one arm as the whole corpus.
- **Only the ИСУН arm is a matview.** `funds_fit_interreg()` is a plain function — 1,954 operations
  against 82,011 contracts, which any index scan answers live. So an Interreg reload does NOT need
  a `funds-fit` refresh.
- **The Interreg arm is reached through a BG→EN query bridge** (`functions/interreg_topics.js`).
  keep.eu publishes 86% of these titles in English only (272 of 1,954 carry a Bulgarian one), so
  without it a Bulgarian query matches almost nothing there and the arm that exists to fix the
  border bias is invisible to the audience it is for. It bridges the QUERY only, never the ИСУН
  arm, and the route returns `interregQuery` so the page can say which English term it used.
- **`paid_project_count` is DISBURSEMENT, not approval.** ИСУН publishes no rejected applications,
  so an approval rate has no denominator and is not computable from this corpus. Any UI that
  relabels it („N% одобрени") is making a claim the data cannot support.

The route degrades a missing 143 to empty arms and logs `ff:not-built` once per process, so first-deploy
ordering is cosmetic — but a STALE matview still serves the previous vintage's answer at a 200.
`funds_fit.data.test.ts` fails on an unbuilt matview, on a rollup that disagrees with
`fund_projects`, on a place filter that has stopped ranking, on a truncated oblast breakdown, and
on an empty Interreg arm.

`open_calls` / `open_calls_crawl` (migration 142, `db:load:open-calls:pg`) is the open-calls
register behind the `/funds` band-1 tile and `/funds/calls` — what a reader can APPLY to, from
ИСУН's `/Active` + `/PublicDiscussion` and ДФЗ's indicative Strategic-Plan schedule. In
`db:refresh` (after `db:load:funds:pg`); on the cloud side:

```bash
npm run db:load:open-calls:pg:cloud
```

Re-run after every `npm run opencalls:isun` / `opencalls:sp2023` crawl. Nothing runs it on the
cloud side, and the failure is the usual one: prod keeps the previous vintage at a 200.

**Four things about this family invert the rules the rest of this file states, all for the same
reason — here a stale number is a MISSED DEADLINE rather than a wrong figure:**

- **Nothing stores a status.** `open_calls_table` derives it by comparing `closes_at` to `now()`,
  and every consumer reads that view. Stored-at-crawl-time would show expired calls as open all
  weekend after a Friday failure; query-time derivation makes the worst case UNDER-reporting.
- **The loader must NEVER anti-join delete.** The crawler reads `/Active`, so a call that closes
  is absent BY DESIGN — deleting absent rows would erase exactly the closed calls that make base
  rates possible. It is upsert-only, and records absence via `last_seen_at`.
- **Money needs a provenance** (`enrichment`: `none`/`source`/`auto`/`reviewed`). A CHECK bars the
  numeric columns unless it is `source` or `reviewed`, so an unreviewed LLM extraction cannot
  drive the page's sort or range filters; it rides in `enrichment_meta` with its verbatim quote.
  The loader's upsert deliberately does NOT downgrade a `reviewed` row back to `none`.
- **The money columns are `double precision`, not `numeric`**, and 142 carries a reconcile ALTER
  because `CREATE TABLE IF NOT EXISTS` cannot retype a warm table's column. node-postgres
  serializes `numeric` as a STRING, which blanks every money cell on the page while the number is
  present in the payload — invisible to every row count and to any assertion made through SQL.
  The ALTER has to DROP `open_calls_table` first (Postgres refuses to retype a column a view
  reads); the file recreates it further down.

`open_calls_list(status, kind, audience, q, limit)` is the one serving function, and **a NULL
limit means unbounded** — that exists for the `/api/db/open-calls` count path, since a `count(*)`
through the function would otherwise saturate at its own `LEAST(p_limit, 2000)` ceiling. Counting
through the function rather than with a second WHERE is what keeps the tile's heading count and
the rows beneath it on one predicate.

**`/funds/calls` covers ИСУН + ДФЗ + 2 of 6 Interreg programmes, and the page says so.**
Interreg runs on Jems rather than ИСУН, so an Interreg call can never appear in `/Active` — a
system boundary that falls on the border municipalities. `npm run opencalls:interreg`
(`interreg_parse.ts`, one parser per programme shape) covers Greece-Bulgaria and Black Sea Basin;
Romania-Bulgaria publishes no calls index, and BG-RS / BG-MK / BG-TR reset the connection on both
ports from two independent clients (measured 2026-08-09). Do not add a programme to `PROGRAMMES`
without reading it first: a listed-but-unreadable programme makes a crawler report „0 calls" for
a site it never fetched, which is a hole that looks like a finding.

Two rules in that parser are load-bearing:

- **The deadline comes from its LABEL, never from the latest date on the page.** Greece-Bulgaria's
  6th call prints `31.12.2029` — the programme period, in a state-aid paragraph — next to its real
  `22/06/2026` deadline. A max-date heuristic publishes closed calls as open for years. A page with
  no labelled deadline becomes an `indicative` row with a period label; it never gets a guessed date.
- **A down programme is not a change.** The crawler keeps the programmes it could read instead of
  aborting, and the `interreg_calls` watcher excludes an unreachable programme from its fingerprint
  — folding it in as „zero calls" would report every one of its calls as closed, then as new when
  the site returned. Measured: Black Sea Basin went down mid-crawl on the first real run.

Two more rules, both learned the hard way:

- **The deadline keeps its TIME OF DAY.** Both programmes print one; a bare date resolves to
  midnight, which marks a call closed for the whole of its final day and NULLs `days_left` a day
  early. `sofiaWallClockToUtc` is reused from `isun_parse` — both zones are EET/EEST, and a fixed
  +02:00 is an hour wrong for every summer deadline.
- **A page with no labelled deadline is REJECTED**, the way `isun_fetch` rejects a procedure with
  no Краен срок. The only bucket an undated row could reach is `indicative`, which the UI labels
  „Очаквани приеми" — expected intakes — and the pages that reach it are dead calls.

Zero open Interreg calls is a normal result (5 rows, 0 open on 2026-08-09) — the closed rows still
load, because `open_calls` accumulates and „the last one closed on 22 June" is the answer a border
municipality currently gets nowhere else. `open_calls.data.test.ts` asserts shape, never „at least
one is open".

**The coverage line says „част от", never a count.** It named „2 от 6" and „Черноморски басейн"
for one draft while the committed snapshot held zero Black Sea rows — that site answered once and
then refused every later attempt. A hard-coded fraction is a claim about data the component cannot
see and goes stale in both directions. `interreg_fetch.ts` carries a **completeness guard** that
refuses to write when a programme which HAD rows returns none; `writeSnapshot`'s shrink guard
cannot do this job, being a per-source ratio for which 9 → 7 is 22% and under its threshold.

**One-off, and Cloud SQL needs it by hand.** `open_calls` never deletes, so the two undated rows an
earlier parser wrote survived the rejection fix:
`DELETE FROM open_calls WHERE source = 'interreg' AND closes_at IS NULL;`

**Enrichment (money + eligibility) is a SEPARATE, human-gated skill** — `enrich-open-calls`,
never part of the daily refresh. `update-open-calls` gives a call its title, deadline and link;
ИСУН publishes the budget, aid rate, grant range and eligibility only inside each procedure's own
PDF/DOCX. That skill reads one document, extracts each field **paired with a verbatim quote**, and
puts both through `scripts/opencalls/enrich_gate.ts` before anything is stored — **two checks,
not one**: the quote occurs in the extracted text (a plain normalised substring), *and* the quote
states the value. A field failing either is dropped and reported. Nothing about that guarantee
comes from trusting the model.

The second check is the one that looks redundant and is not. Checking the citation is not
checking the claim: with only the substring test, a fabricated `budget_eur: 999 000 000` attached
to a real unrelated sentence from the document passed with no rejection, and so did a 100×
magnitude error (`aid_rate_pct: 0.6` cited from „…60 %…"). Both are the shape a model produces
when it answers from memory and then hunts for a sentence to cite. Neither check can judge
whether the quoted sentence is the *right* one — a sub-component's „максимален размер" cited
against the whole procedure's budget is a real number, correctly attributed and still wrong —
which is why `auto` may not reach a money column at all.

Two things about it are easy to get backwards:

- **`enrichment='auto'` publishes no number.** It may write the verbatim eligibility text and the
  provenance blob; 142's `open_calls_money_needs_provenance` CHECK bars it from all four money
  columns. Only `npm run opencalls:enrich-review -- --promote <key>`, one row at a time after a
  human reads the quotes, promotes to `'reviewed'` and lets a figure into sorting, range filters
  and the tile's total. There is deliberately no `--promote-all`.
- **The crawl must not own an enriched column.** `load_open_calls_pg.ts` splits its upsert into
  `SOURCE_OWNED` (bare assignment) and `FILL_NEVER_BLANK` (COALESCE), and `enrichment` never
  downgrades from any stored value to an incoming `'none'`. Measured 2026-08-09, before the
  split: one ordinary `db:load:open-calls:pg` took a promoted row from its eligibility text to
  NULL while leaving `enrichment='reviewed'` and the quotes in the meta — a row asserting a human
  signed off on text that was gone, at 66 → 66 rows with nothing red.
  `load_open_calls_pg.test.ts` derives the protected set from the writer's own `MONEY_FIELDS`, so
  a new money column cannot be added on one side only.

**Enrichment lives only in Postgres — it is NOT in `data/opencalls/*.json`.** So it does not
travel with `db:load:open-calls:pg:cloud`; enrich against the database you intend to serve.
Measured on today's corpus, the money yield is near zero and that is the gate working: 0 of 4
readable ИСУН documents stated a euro amount, 3 stated levs, and the currency rule correctly
refuses a lev figure offered as euro. The eligibility text is the real yield until the documents
are re-tabled in euro.

**When it happened on the wrong database anyway, `opencalls:sync-enrichment` carries it over.**
Dry-run by default; `--apply` writes:

```bash
npm run opencalls:sync-enrichment:cloud -- --apply
```

It copies the overlay — `enrichment`, `enrichment_meta`, `beneficiaries_raw` and the four money
columns, the payload derived from `enrich_apply.MONEY_FIELDS` so a new money column cannot be
added on one side only — for rows at `enrichment IN ('auto','reviewed')`. `source` rows are
excluded because the loader already reproduces them from the committed snapshot. Source defaults
to local, target to `DATABASE_URL` (`--from`/`--to` override); a same-database sync is refused
rather than reported as a no-op.

Three things about it are easy to get backwards:

- **It NEVER downgrades**, on the same total order the loader's upsert uses (`ENRICHMENT_RANK`,
  exported from `load_open_calls_pg.ts` and imported here rather than restated — it is now the one
  definition, rendered as SQL by `enrichmentRank()` and compared in TypeScript by `outranks()`).
  A row a human promoted **on the target** outranks a local `auto` and is kept, and the guard is
  in the UPDATE's WHERE as well as in the plan, so a promotion landing between the read and the
  write cannot be overwritten by a stale decision. A TIE is not a downgrade: the source wins it,
  which is what lets a re-gated `auto` refresh its own meta.
- **It never INSERTs.** The crawl owns row existence; a source row missing on the target is
  reported, and the fix is `db:load:open-calls:pg:cloud` first, then re-run. It also reports rows
  enriched on the TARGET only, so a divergence between the two databases is visible rather than
  inferred from a silence. **A missing or refused row exits non-zero** — including on a dry run,
  whose job is to report whether a full sync is possible — so a wrapper can tell a complete sync
  from a partial one without parsing stdout.
- **The overlay moves as a UNIT, NULLs included** — never a per-column COALESCE. `enrichment` is a
  claim about the whole set of figures, so merging two provenances under one flag is exactly the
  thing it exists to prevent.

`sync_enrichment.test.ts` mutation-checks the never-downgrade rule: it asserts a `reviewed` target
survives an `auto` source, then re-runs the same input with the rank predicate stubbed out and
asserts it flips to an update — otherwise the first assertion is satisfied by any plan that
happens not to write.

`/funds/calls` is PRERENDERED (`scripts/prerender/routes.ts`) and has a sitemap `<loc>`, but
**there are no per-call `<loc>`s and the prerendered body lists no calls** — a static snapshot of
live deadlines would serve expired calls as open. An individual procedure has no page here; every
row links out to ИСУН or ДФЗ, which is where you apply.

`nzok_pathway_tariffs` (migration 059, `db:load:nzok-tariffs:pg`) is the НРД price factor
behind the pathway-spend tree and the case-mix signal on `/awarder/121858220`. Its source is
the НРД **contract body** (чл. 368/369/370, re-tabled by each amendment), parsed by
`scripts/nzok/write_pathway_tariffs.ts` into the gitignored `pathway_tariffs.json`. Publish:

```bash
npm run db:load:nzok-tariffs:pg:cloud
```

Re-run writer + loader when the `nzok_nrd_tariffs` watcher flags a new НРД/amendment PDF
(the parse needs a human pass). The loader is absent-safe (applies 059 and exits when the
JSON is missing), so it sits in `db:refresh` — but only this manual flow ever *fills* the
table.

`agri_subsidies` + `agri_payloads` (migration 046, `db:load:agri:pg`) are the ДФ „Земеделие"
farm-subsidy corpus behind `/subsidies` and `/farm/:eik`. The loader is the pure-LOAD half of
the fetch/load split: it reads only the **gitignored** `raw_data/agri/` cache (egov year sheets
+ СЕУ CSVs) — on a fresh clone it skips-and-warns; on a PARTIAL cache it throws rather than
publish a corpus missing a financial year. Publishing to prod:

```bash
npm run db:load:agri:pg:cloud
```

Run it after any `raw_data/agri/` refresh (a new egov financial year, or a fresh
`npm run agri:seu` pull); the fetch+load path stays `npm run agri:ingest` (the update-agri
skill). Nothing on the cloud side is automatic. The subsidies table publishes via an UNLOGGED
stage + one-transaction DELETE+INSERT (RowExclusiveLock only — readers stay on the MVCC
snapshot, never blocked; <5%-shrink guard), `agri_payloads` via the shared stage merge — so the
~2.5M-row reload cannot 55P03 the served browse. **Not a rename swap**: `person_browse_table`
(120) and `company_public_money` (127) are matviews over `agri_subsidies` and follow its OID
through a rename, so the table must keep its identity. Those two are also why a cloud agri
reload does not end at the loader — `agri_subsidies` is part of 127's money basis and of the
`/persons` money column, so after `db:load:agri:pg:cloud` re-run
`db:load:persons-browse:pg:cloud`, `db:load:person-search:pg:cloud` and
`db:load:graph:pg:cloud` (their sections above name any contracts/agri/funds reload as their
trigger). `agri_subsidies` is in
`sync_cloud.ts`'s `CRITICAL_TABLES`: its source cache is gitignored host state, so a dropped
table is only re-derivable from a machine that still holds the cache.

`kzk_decisions` (migration 130, `db:load:kzk-decisions:pg`) is the КЗК merits-outcome corpus —
the tier-2 half of the appeals pack, and the loader whose absence let that arm freeze for five
weeks unnoticed. It has **no automatic cloud path**:

```bash
npm run db:load:kzk-decisions:pg:cloud
```

Re-run it after every `scripts/procurement/kzk_decisions.ts --apply` crawl, and on a first
deploy before anything reads the table. It applies 005 + 130 itself, so it works on a cold
database. `db:refresh` runs the local equivalent; nothing runs the cloud side.

Two things make this loader unlike the rest of the list, both because — until the crawler's
`--backfill` is proven to re-derive it — **this table plus the gitignored
`data/procurement/kzk_decisions.json` are the only copies of a corpus with no committed
generator**. It is in `sync_cloud.ts`'s `CRITICAL_TABLES` despite being small, and its merge
refuses to run when the build would shrink the table by >5% (`--allow-shrink` to override) or
when more than 15% of source rows fail validation — an anti-join DELETE is the correct shape
for a derived table and a data-loss bug on this one. Note the appeals arm is the OPPOSITE
shape: `kzk_appeals` has no loader at all, so publishing it means re-crawling against the
cloud URL. `kzk_decisions.data.test.ts` fails on an empty table or a malformed act.

Riding immediately behind it — **the rejoin** (`npm run kzk:rejoin -- --apply`), which applies
migration 131 and folds `kzk_decisions` into `kzk_appeals.outcome`. Nothing else applies 131,
so without this the cloud database has no `decision_act_no` column at all:

```bash
npm run kzk:rejoin:cloud -- --apply
```

Re-run it after **every** `db:load:kzk-decisions:pg[:cloud]` and after any change to
`scripts/procurement/kzk_match.ts` — a matcher fix ships no data by itself. `db:refresh` runs
the local equivalent; nothing runs the cloud side, and skipping it is the "green locally,
stale on prod" class: local serves 3,014 outcomes while prod keeps 2,098, with nothing failing.
It refreshes every dependent through `scripts/procurement/kzk_dependents.ts` — including
`upheld_ocids`, which feeds the contract Corruption Risk Index, so a skipped rejoin makes
recently-appealed procedures grade cleaner than they are.

`--dry-run` is read-only and reports what it would write, including the hand-seeded rows it
refuses to touch. Provenance (131) is what makes the rejoin safe to re-run: `decision_act_no
IS NOT NULL` marks a row as machine-derived and re-derivable, NULL marks it as one of the
~2,098 irreplaceable hand-made ones, which no writer may overwrite.

**Migration ordering, 042 → 131.** `kzk_appeals_list` (042) SELECTs `decision_act_no`, whose
home is 131 — and 131 is applied ONLY by `kzk:rejoin`, which every path that applies 042 runs
*before* (`db:refresh` orders `db:load:tenders:pg` ahead of `kzk:rejoin`; `load_tenders_pg`
and `apply_functions` never touch 131). 042 therefore carries an idempotent
`ADD COLUMN IF NOT EXISTS` for it. **Do not remove that line** thinking 131 owns the column:
`exec()` sends a migration as one implicit transaction, so a 42703 there rolls the whole file
back and aborts the tenders loader on any database that has not yet rejoined. It is invisible
on a machine that already has the column, which is exactly how it shipped once;
`kzk_decisions.data.test.ts` now asserts the ALTER is present and precedes the view.

**One-off, and Cloud SQL needs it by hand — `kzk_appeals.suspension`.** The column held a
stored `false` on 7,778 of 7,886 rows, which made 042's
`kzk_effective_suspension(suspension, status)` fallback unreachable: 1,501 appeals had
requested a temporary measure and at most 4 could ever display as suspended. **A re-crawl
cannot fix this** — the intake passes NULL into `COALESCE(existing, EXCLUDED)`, so the frozen
value is immovable — and there is no `db:load:kzk:pg:cloud` to carry a fix over. Prod stays
frozen until someone runs it there:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 042_kzk_appeals.sql 044_procurement_ai.sql
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/procurement/kzk_unfreeze_suspension.ts --apply
```

**Order matters and the script enforces it.** 042 must land FIRST: before it,
`kzk_appeals_list` selected the RAW column, so releasing the column takes
`/procurement/appeals` from 4 suspended chips to 0 while every other surface still shows 4.
The script refuses to run if `kzk_effective_suspension()` is absent. If the one-off has been
deleted (it is scheduled to die when the определения arm lands), the equivalent is
`UPDATE kzk_appeals SET suspension = NULL WHERE suspension IS NOT NULL;` — but only while no
row is suspended without a `спрян` status, which is exactly what
`kzk_suspension.data.test.ts` asserts.

`contractor_rank` (migration 122) is the same first-deploy shape as `cpv_catalog`: the
`contractor_rankings` DbDataTable resource + the `/api/db/contractor-scope-kpis` route read
it and do NOT degrade a missing matview to an empty result, so on the FIRST cloud deploy the
loader must run **before** the `deploy:db` that ships them. `contractor_rank.data.test.ts`
fails on an empty or stale matview.

`procurement_settlement_payloads` (migration 123) is the deliberate OPPOSITE of those two on
first deploy. `/api/db/procurement-settlement` maps the requested window to a scope and reads
the matview, but **falls back to the live `procurement_settlement_detail()` when the
precompute cannot answer** — no stored row, or a narrow set of SQLSTATEs meaning the
matview is absent, unreadable or locked (a pool error still throws). Degrading is correct here in a
way it is not for `cpv_catalog`: it yields the RIGHT answer slowly (today's behaviour) rather
than a wrong one, so the route ships in any order, to any database. The cost is that every
reason the fast path was skipped is otherwise silent, which is why the route logs a
`psp:not-built` / `psp:read-failed` warning once per process — **that log, not latency, is the
signal that the cloud loader never ran.** `procurement_settlement_payloads.data.test.ts` fails
on a stale, partial or place-blank matview.

`procurement_payloads` (migration 124) is the same degrade-don't-fail shape as 123, applied to
the six `/api/db/procurement-*` dashboard routes — `overview`, `flow`, `rankings`,
`concentration`, `sectors`, `benchmarks` — via one shared `scopedPayload()` helper in
`functions/db_routes.js`. It exists because TWO of them exceeded the 10 s `statement_timeout`
and returned 500 on prod — `procurement-overview` on a windowed scope at 10.010 s and
`procurement-flow` with no window at 10.006 s. The other FOUR were the same shape and had
simply not been unlucky; `procurement_concentration` touches more pages than either
(411,245 vs 393,851 on the full corpus) and had no cache at all. (The third 500 in that Cloud
Run window was `/api/db/person-profile`, a different defect entirely — a point lookup that
full-scanned `person` — fixed by rewriting `person_by_name` in 082, not by a precompute.) Same log contract, different prefix: `pp:not-built` / `pp:read-failed`,
once per process per (kind, scope) — so an unbuilt `flow/all` and an unbuilt `overview/all` are
two separate lines, and a second request for either is silent. `pp:no-scope` is EXEMPT — a caller may legitimately ask for a window
that is not one of the thirty, and serving that live is designed behaviour, not a defect.

**Two SQLSTATE details on that fallback are easy to get backwards, and 123 had both wrong
until 124 was built:**

- **`55000` must be in the degrade set.** Reading a matview created `WITH NO DATA` does not
  return zero rows — it raises `object_not_in_prerequisite_state`. That is exactly a database
  where the DDL was applied and the REFRESH never ran, i.e. the first cloud deploy, which is
  the case the orderless-deploy property is about. Without it that case is a 500.
- **`57014` must NOT be.** It looks like the "locked by a REFRESH" code; that is `55P03`.
  `57014` is the pool's own `statement_timeout`, so the probe has already burned the full 10 s
  budget and falling back to an aggregate touching 199k–411k buffers cannot finish either — it
  turns a 10 s failure into a ~20 s one holding a pooled connection, under exactly the
  saturation that caused the timeout. Degrading is only correct when it beats failing.

`procurement_payloads.data.test.ts` fails on a stale matview, on a `concentration` payload whose
stored `oblast` has drifted from `awarder_seats`, and — uniquely in this repo — on a
`SCOPED_MATVIEWS` entry whose declared `inputs` do not cover what the matview reads. It
deliberately does NOT skip when the matview is absent or unpopulated: those are the two states
it exists to catch, so they are assertions, not a green skip.

**124 RETIRED two older cache matviews**, `procurement_overview_cache` (025) and
`procurement_rankings_cache` (031). Each answered exactly ONE of the thirty windows — the full
corpus — which is why every parliament window fell through to the live aggregate and 500'd.
Their migrations now carry a tombstone `DROP` and no `CREATE`; `load_pg` no longer refreshes
them; the routes no longer read them.

**The tombstone only fires when the file is APPLIED, so the cloud side needs one command** —
`deploy:db` ships function code only, and the only other cloud path that applies 025/031 is a
~68-minute full contracts reload. Without this, prod keeps two orphan matviews for ever:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 025_procurement_overview.sql 031_procurement_rankings.sql
```

Safe to run at any time and idempotent: both files `CREATE OR REPLACE` their function (they do
NOT `DROP` it — 124 depends on it), and the `DROP … IF EXISTS` is a no-op once the matview is
gone. **Do not add `122_contractor_rank.sql` to that command** — 122 DROPs and recreates
`contractor_rank` WITH NO DATA, and `/procurement/contractors` reads it WITHOUT degrading, so
applying it would blank that page until a multi-minute refresh finished.

Of the full-corpus cache matviews on this pattern, `procurement_by_settlement_cache` (030) is
the only procurement one left — its route serves a different shape from 119/123, so it still
has a job. (`procurement_risk_indexes_cache` (033), `dual_corpus_rankings_cache` (077) and the
044 cache are unrelated and unaffected.)

`db:load:pg` also re-REFRESHes all six (guarded on existence, `contractor_rank` before
`contractor_scope_kpis`), so a contracts reload cannot leave `/procurement/by-settlement`,
`/procurement/contractors`, the settlement pages or the `/procurement` dashboard serving the
previous corpus. `db:refresh` runs the local equivalent automatically; the cloud side does not.

**Skipping it does not fail — it blanks.** `db:resolve:persons` applies 117 with
`CREATE TABLE IF NOT EXISTS`, so a cloud database that never ran this loader gets an EMPTY
dimension, `person_by_slug()` still compiles, and all ~76.5k `mir`/`obshtina` roles publish
`placeLabel: null` — green locally, blank on prod, and baked into the prerendered `/person`
HTML. The ~2.7k judicial roles keep their label (they resolve via `judicial_body`), so the
damage looks partial rather than total and is easy to miss.

Last in the person chain, and the only loader with **two** independent triggers — the
persons browser matview (migration 120) behind `/persons`:

```bash
npm run db:load:persons-browse:pg:cloud
```

It folds six upstream datasets, so it must run **after all of them**: `db:resolve:persons`,
`db:load:declarations:pg:cloud -- --resolve` (net worth **and** `declaration.person_id`),
`db:load:official-candidate-links:pg:cloud`
(the non-MP photos), `db:load:judicial-bodies:pg:cloud` + `db:load:place-dim:pg:cloud` (every
place label and the magistrates' oblast), and the contracts corpus. Re-run it:

- whenever any of those is reloaded on the cloud side — the person half is the obvious case;
- **after a contracts reload**, which is the non-obvious one: `public_money_eur` is computed
  from `contracts`, so a procurement refresh without this one lets the money column drift
  away from `/procurement/contracts` with nothing failing.

Riding just behind it — `person_search` (migration 126, `db:load:person-search:pg`), the one ranked
index behind the combined-search route. It is a derived search index like `contractor_search`, but
UNLIKE `contractor_search` (rebuilt inside `db:load:pg`) it is a **standalone** loader with nothing
running it on the cloud side, so run:

```bash
npm run db:load:person-search:pg:cloud
```

after **each** of `db:load:persons-browse:pg:cloud` (its public arm), `db:load:tr:pg:cloud`, and any
contracts/agri/funds reload (its money arm). `db:refresh` sequences the local equivalent right after
persons-browse; nothing runs it on the cloud side. The `/api/db/person-search` route **degrades a
MISSING table to empty tiers** (so it never 500s on a first deploy before this loader runs), but a
**STALE** table still serves the previous vintage at a 200 — so this is the same "green locally,
stale on prod" trap as the loaders above. `person_search.data.test.ts` fails on an absent/empty table.

Last of the person-layer standalone loaders — the connections graph (migrations 127 + 128 + 129,
`db:load:graph:pg`), the three `graph_*` tables (`graph_edge` / `graph_company_node` /
`graph_person_node`) + the down-sampled `graph_payloads` blob behind `/connections` and the re-pointed
`person_connections()` / `person_graph_ego()`. It APPLIES 127 (`company_public_money`, the broad
contracts∪subsidies∪funds money basis) + 128 + 129 and rebuilds the tables from `person_role`
(co-ownership) ∪ `company_politicians` (procurement) via a **stage merge** — all four are on a serving
path (084's `person_connections()` / `person_graph_ego()`, and `/api/db/connections-graph` for the
blob), so a `TRUNCATE`-and-rebuild would hold an AccessExclusiveLock for the whole load and 500 those
routes at the pool's `lock_timeout` (`person_reload_locks.data.test.ts` is the gate). Run:

```bash
npm run db:load:graph:pg:cloud
```

**AFTER `db:load:persons-browse:pg:cloud`** (it reads `person_browse_table` facets for the person
nodes) and after **each** of `db:resolve:persons:cloud`, `db:load:person-elections:pg:cloud` (the
`party`/`party_color` source for the party×party matrix, `person_election_stats`),
`db:load:tr:pg:cloud` (the `company_politicians` procurement arm), **`db:load:interreg:pg:cloud`**
(127 gained an Interreg arm and this loader is 127's only applier — see the Interreg section),
and **any contracts/agri/funds reload** (127's money basis).
`db:refresh` sequences the local equivalent right after `persons-browse`/`person-search`; nothing runs
it on the cloud side, so it is wired into the `update-persons` (last step) and `update-procurement`
(after `persons-browse`) watch skills so an orchestrated re-ingest re-derives the graph on prod. It
carries its own **per-arm bridge preflight** (mp / official) that throws — inside the rebuild tx, so a
broken `company_politicians.ref → person_id` join (a roster re-slug) rolls back rather than shipping a
half graph, and a **non-empty blob guard** that rolls back rather than publishing a blank `/connections`
overview. `graph.data.test.ts` / `graph_payloads.data.test.ts` fail on a stale/partial graph, a
money-basis drift from 127, a broken procurement arm, or a private-facet leak into the public blob.

Being a DERIVED serving layer (like `person_search` / `contractor_search`), it takes **no**
`recent_updates` row and no standalone `data/data-changes.json` entry — the `/data/updates` feed is
stamped per-skill by `process-watch-report`, and the source skills that trigger this reload already
stamp it.

**`--resolve` is not optional, and skipping it is invisible to a row count.** Phase 2 is what
fills `declaration.person_id`; without it that column is NULL on every row, the table is still
present and full, and `person_browse_table` publishes `has_declaration = false` for all 56,801
people — the "с декларация" filter matches nobody and its KPI reads 0%, while net worth keeps
rendering from `person_wealth_year`, so the page looks healthy. This shipped to prod once; the
loader's preflight now checks join-key population, not just row counts.

Skipping it after a *place* loader blanks the same way `/person` does — the loader itself
throws if any placed row lost its label, but only for the rows it can see at build time.
`db:refresh` runs the local equivalent automatically; nothing runs it on the cloud side.

**A COLUMN-TYPE change in 120 also needs this run on the cloud.** The file is DROP + CREATE,
so Cloud SQL keeps the previous column types until the loader executes there — and a type
change is the one edit whose staleness is invisible to a row count. `net_worth_eur` /
`public_money_eur` / `delta_pct` are `double precision` for a reason: node-postgres
serializes PG `numeric` as a STRING, so on a stale cloud matview the API response looks
perfectly correct while every money cell on `/persons` renders BLANK.

Last of all, and the only step here whose output is a COMMITTED FILE rather than a table —
the `/person` prerender + sitemap manifest (`data/person/prerender_slugs.json`):

```bash
npm run person:slugs:cloud
```

It must run **after** `db:resolve:persons:cloud`, after `db:load:declarations:pg:cloud --
--resolve` (which is what REFRESHes `officials_rankings_table` — the `prerender` set and
every `card` come from it), and after **`person:slug-redirects:cloud`**: the continuity half
of the selection calls `officials_person_slug()`, which falls through to `person_slug_retired`
(`106_officials_redirect.sql`), so with the redirect maps unloaded a re-slugged official
resolves to nothing and silently drops out of the prerender set. It is the one manifest that
MUST be minted from the SERVING database — not from local Postgres.
`person_slug_lock` accumulates per database and is never truncated, so two databases
re-resolved a different number of times hand the same people different slugs; measured
2026-07-31: 1,436 mention→slug locks disagreed and 640 person slugs existed only locally
(mostly `-2` collision suffixes). Every one of those 640 was in the committed manifest,
naming a person prod cannot serve.

**That is LATENT, not live** — worth stating so nobody re-derives a panic from it. Both
consumers (`buildPersonRoutes`, the sitemap's `enumeratePersons`) filter on `prerender`, and
that ~5,000-entry ex-officials set was identical between the local- and cloud-minted
manifests (0 churn); nothing reads `indexable` at runtime. It goes live the moment the
prerender set widens to the full G6 set, which `emit_prerender_slugs.ts` explicitly plans.

Do NOT read that as "the two manifests differ only in slug identity". The same measurement
found 185 entries that kept their slug and flipped `indexable` (161 false→true, 24 true→false)
— slug-lock drift cannot cause that, since the floor reads `declaration` and `person_role`,
so the two databases disagreed on content too. Whether that was purely temporal (the
committed manifest predated the cloud catch-up) is not established.

`emit_prerender_slugs.ts` now REFUSES to write when connected to the local docker Postgres
(`npm run person:slugs -- --local` overrides), so `db:refresh`'s `person:slugs` step and the
`person_prerender_set.data.test.ts` determinism gate — both of which used to mint the file
from the stale side — warn and skip instead. Nothing else regenerates it: this command is
the only way the manifest moves.

### SQL functions and indexes — applied, never loaded

A serving FUNCTION or an INDEX carries no data, so no `db:load:*` ships it. The person functions
(082/083/084/085/106 …) are the largest family, but the rule is general — 007's query builders and
081's indexes are in exactly the same position. The only cloud path that applies them is `db:resolve:persons:cloud`, which is a
multi-hour rebuild — far too heavy for a one-function fix, and it re-resolves the whole
identity layer as a side effect. Ship a function-body change on its own:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 084_person_connections.sql
```

Safe at any time and idempotent — every one of these files is `CREATE OR REPLACE`. **A
function-only change is invisible to every row count and every loader**: local is green, prod
keeps running the previous body indefinitely, and nothing reports a difference. `deploy:db`
does NOT carry it — that ships function *code* in `functions/`, which is a different thing
from a Postgres function.

**A migration a LOADER applies may not DROP an object another migration reads in a stored
query, and CASCADE is never the way out.** `db:load:pg` applies 077 on every contracts load;
077 used to open with an unconditional `DROP MATERIALIZED VIEW IF EXISTS
dual_corpus_rankings_cache` (present only so the `DROP FUNCTION` beneath it could run). When
migration 145's `funds_hub_stats_cache` started selecting that matview directly, every
`db:load:pg` began aborting with **2BP01 — in the APPLY phase, BEFORE the COPY**, so
`contracts` silently kept serving the previous vintage while the ingest that produced the new
shards reported success. It blocked every procurement publish from 2026-08-09 (900e50dd4b) to
2026-08-10, on prod as well as locally, with nothing red anywhere.

CASCADE would have been worse than the bug. `db:refresh` self-heals it (db:load:pg at step 5,
db:load:funds-fit:pg recreating the dependent at step 11) — but the documented procurement
publish path is a **standalone `db:load:pg:cloud`**, which would drop the dependent on prod
with nothing there to recreate it, blanking the `/funds` hub tiles indefinitely. The fix was
to drop the DROPs (neither was needed — the matview is a fixed one-column wrapper over the
function, and `CREATE OR REPLACE` rewrites the body in place) and to expose
`dual_corpus_company_count()`, a **plpgsql** wrapper whose body is never parsed for
dependencies, as the only supported way for another migration to read that cache **in a stored
query** — a view, a matview, or a function body Postgres parses at definition time. An ad-hoc
query records no dependency and needs no wrapper, which is why `/api/db/dual-corpus-rankings`
selects from the matview directly and is fine. plpgsql specifically: a `LANGUAGE sql` string
body records no edge today either, but the `BEGIN ATOMIC` form (PG14+) does, so modernising
such a wrapper would silently restore the 2BP01 — and note that a `BEGIN ATOMIC` dependency is
recorded through `pg_proc`, NOT `pg_rewrite`, so any "who depends on this?" probe must cover
both classes or it is blind to exactly that vector.
`dual_corpus_dependents.data.test.ts` gates both halves, for both matviews a loader-applied
migration DROPs (077's and 145's).

**The reason nothing caught it is worth generalising: `db:refresh`'s only verification is its
LAST step.** `test:data` — which includes `pg_roundtrip.data.test.ts`, whose row-count assert
compares Postgres against the shards and would have failed on exactly this drift — sits at the
end of a 57-link `&&` chain whose fifth link was the one aborting. An early loader failure
therefore leaves the whole suite unrun, so the corpus that a loader failed to update is never
checked. When a loader aborts, run `npm run test:data` before assuming only that loader's
table is affected.

**`shlyo_query_fold()` (141) is one of these, with one difference: it is GENERATED.** It is the
shliokavitsa half of search — the Latin-side spellings a Bulgarian actually types (`6umen`,
`4erven`, `sofiq`), which `translit_bg_latin()` alone cannot reach, so before it „Jelqzkov"
returned 0 rows from `person_search` while „Jelyazkov" returned 2. The `/api/db/*-search`
routes compose it with `translit_bg_latin()` on the QUERY side only; nothing stores its output.

Never hand-edit `141_shlyo_query_fold.sql`. It is emitted from `src/lib/shlyoRules.ts` — the
same table the browser's client-side filter uses — by `npm run gen:shlyo-sql`, and
`gen_sql/shlyo_query_fold.test.ts` fails when the two drift. That is the whole point: a rule
copied by hand into SQL means the browser finds „6umen" and the server does not, with both
looking like they work.

`db:load:person-search:pg` applies it, so `db:refresh` and
`npm run db:load:person-search:pg:cloud` carry it. But that loader is only the cheapest applier
in the chain, **not the only interested party** — `procurement-search` rides the same fold and
reads none of `person_search`'s tables, so a database where that loader has never run raises
42883 on it. Ship a rule change on its own with the usual escape hatch:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 141_shlyo_query_fold.sql
```

**Three more of these are outstanding as of 2026-08-04.** Two were found because data tests kept
timing out under load — the tests were the symptom, the serving path was the defect; the third is
the molecule-page widening below.

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
  npx tsx scripts/db/apply_functions.ts 007_query_builders.sql 081_person_identity.sql \
  066_nzok_drug_quarterly.sql 054_nzok_risk.sql
```

- **`nzok_drug_molecule_detail()` (054)** keyed entirely on `nzok_drug_overpay_by_inn`, which is a
  **top-30 leaderboard** — so `/molecule/:inn` returned NULL and rendered its not-found branch for
  **580 of the 610** reimbursed INNs. It now returns two tiers: `spend` (from
  `nzok_drug_quarterly`, present for all 610) and `overpay` (the above-median analysis, ~30). NULL
  is reserved for an INN in neither source. **066 MUST be in the same command and BEFORE it** — 054
  calls `nzok_drug_quarterly_by_inn()` from 066, and because 054 sets `check_function_bodies =
  false` the missing dependency does not fail the apply: it fails on the first CALL with 42883,
  which `missingMigrationEmpty` degrades to `[]` — a truthy value that skips the not-found branch
  and renders "no above-median prices, the normal case" on every molecule page at a 200.
  `sector_search_landing.data.test.ts` fails if any findable INN is unservable.

- **`recent_updates()` (007)** was **13.61 s at the route's default `(days=1, limit=200)`** — the
  route clamps `limit` to 1–1000, so the endpoint was over Cloud Run's 10 s `statement_timeout` at
  its most common shape, not merely under load. (The SQL function's own default is `lim=1000`;
  the route's is 200.) Its five UNION branches had no per-branch limit
  (1,688,150 rows materialised to top-N a few hundred) and one branch joined `changelog_days` on
  `first_seen_at::date`, an expression no index serves. Now 0.15 s. Note 007 also rides
  `db:load:tr:pg:cloud`, so a TR load carries it — but do not wait for one.
- **`idx_person_role_ref` (081)** — `person_role` had only `(source, ref)`, which cannot serve
  `WHERE ref = $1`, so `officials_person_slug()`'s anti-join scanned the whole index per probe:
  23,916 probes × 3.1 ms = **74 s**. With the index, 104 ms. Otherwise 081 is applied only by
  `db:resolve:persons:cloud` (a multi-hour rebuild) and `scripts/person/add_override.ts`.

`084_person_connections.sql` is the worked example: `/api/db/person-connections` reached
8.2–10.1 s on prod (one request over the 10 s `statement_timeout`) because
`person_connections` rebuilt a whole-corpus company→officer-count map on every request,
independent of the subject — 96.5% of its buffers, and paid in full even by a person with no
companies at all, which is the common case since the traffic is a crawler walking
`/person/{slug}`. Fixed by a query rewrite (per-eik lookups riding
`idx_person_role_source_ref`), no new object and no loader.
`person_connections.data.test.ts` holds the buffer ceiling and proves it still discriminates
by restoring the old body in a rolled-back transaction.

## Testing

Two layers: **Vitest** for unit + component tests (`npm run test:unit`), **Playwright** for E2E/SEO/perf smoke (`npm test`). Co-locate tests as `*.test.ts(x)` next to the module. Unit tests never touch the network (an unstubbed `fetch` throws in jsdom) or a live DB; the `scripts/db/tests/*.data.test.ts` Postgres gates are the exception and auto-skip when Postgres is down. The `functions/` package keeps its own `node --test` gate (`npm run functions:test`). Full convention — what to unit- vs component-test, fixtures, determinism, coverage, CI placement — is in [docs/testing-standards.md](docs/testing-standards.md).

## Architecture

### Tech Stack

- **React 19** + **TypeScript** (strict mode)
- **Vite 6** with SWC
- **React Router v7** — 58 routes, all wrapped in a `<Layout>` component
- **TanStack React Query v5** — all data fetching, `staleTime: Infinity`, no refetch on focus
- **Tailwind CSS** + CSS Modules — HSL color system via CSS variables
- **Radix UI** primitives with shadcn-style wrappers in `src/components/ui/`
- **Recharts**, **React D3 Library**, **Leaflet** — charts and maps
- **i18next** — English/Bulgarian, preference stored in localStorage
- **Firebase Hosting** — SPA rewrites configured in `firebase.json`

### Data Flow

1. **Raw data** lives in `/raw_data/` (CSVs, ZIPs from the electoral commission)
2. **Data pipeline** (`scripts/`) transforms raw data → static JSON files in `/public/YYYY_MM_DD/`
3. **Frontend** fetches JSON from `/public/YYYY_MM_DD/*.json` based on the election date selected in `ElectionContext`

### Key Source Areas

- `src/routes.tsx` — All route definitions
- `src/data/ElectionContext.tsx` — Central state: selected election date, aggregate stats. All data hooks read the selected date from this context.
- `src/data/macro/cabinetAnchorContext.tsx` — Global cabinet anchor mounted on the `/governments*` and `/indicators*` route group. URL-encoded via `?cabinet=<id>`; every quarterly/annual snapshot hook (`useElectionAsOf`, `useElectionYear`) consults the override and re-anchors to the cabinet's tenure end. Cleared via the header pill ×.
- `src/data/` subdirectories (`regions/`, `municipalities/`, `settlements/`, `sections/`, `parties/`, etc.) — React Query hooks per domain; each exports typed `useXxx()` hooks
- `src/screens/` — Page-level components matching the route structure
- `src/screens/components/` — Reusable components shared across screens
- `src/components/ui/` — Low-level UI primitives (22 components)
- `src/ux/` — UX utilities: data tables, tooltips, touch handling, media queries
- `src/locales/` — i18n strings; `public/locales/` — runtime-loaded translations

### URL contract (cross-page state)

- `?elections=YYYY_MM_DD` — selected election (read by `ElectionContext`)
- `?cabinet=<id>` — global cabinet anchor on `/governments*` and `/indicators*` (read by `cabinetAnchorContext`)
- `?peers=RO,GR,HU,HR` — peer-country selection on `/indicators/compare` (read by `usePeerSelection`)
- `?pscope=all` / `?pscope=y:2024` — the shared time-scope on `/procurement*`, the sector views (water/defense/culture/judiciary), the farm-subsidy pages `/subsidies*`, and the sectors hub (all read by `useScope` in `src/data/scope/`; the param name stays `pscope`); default `ns` (the selected parliament's contract window) is omitted from the URL, `all` pivots to the full corpus, `y:<year>` to one calendar year. On `/culture` `ns` means "all years" (relabeled) and `y:<year>` re-aggregates the film KPIs / discipline split / concentration / awards to that year client-side from `films.json` — the time-spine (a historical trend) stays full-history (`scopeCultureOverview`). The procurement nav pills + the subsidies dashboard's tile links carry the current search forward (`useScopedHref` / a local `browseTo`) so the scope survives sub-page navigation. On `/subsidies` (which has no per-parliament slice) `ns` resolves to the latest financial year via `agriScopeToKey`, and each scope is served as its own precomputed `agri_payloads` overview blob (kind='overview', key=`<year>`|`all`|`''`); the `?pscope` year picker there lists only the CAP financial years present (`AGRI_FINANCIAL_YEARS`).

  **A page narrower than the corpus MUST resolve the inbound scope.** `pscope` is in the `usePreserveParams` allowlist, so any in-app link carries a scope minted where it was valid onto a page that cannot serve it (`y:2026` on `/culture`, whose НФЦ register ends 2025; `y:2019` on `/subsidies`, a hole in the CAP corpus; anything past the last Доклад on `/sector/administration`). Pass the page's coverage to the hook — `useScope({ years, allowAll })` — and hand `<ScopeControl>` the SAME resolved value via `value`/`onChange`; then the pill and the numbers are one value. Two failure modes this closes, both of which look like real data: an unresolved year reaching the aggregation (`selYear` on `/administration` labelled the latest report's numbers "2026") and a Radix `<Select>` whose controlled value matches no `<SelectItem>`, which renders EMPTY — not the placeholder — leaving the whole widget reading as the page default. Falling back to `ns` is not the only honest option: `/subsidies` keeps the raw scope and NAMES the gap ("Няма данни за субсидии за 2019"), which is why `ScopeControl` displays an off-list year rather than inventing one. What no page may do is show one window and count another.
- `?q=<term>` — on `/procurement/contracts`, `/procurement/tenders` and `/persons`, seeds the DbDataTable free-text search (used by the combined-search "see all" deep links).
- `?facet` / `?pfacet` / `?role` / `?party` / `?oblast` / `?obshtina` / `?court` / `?decl` / `?held` — the `/persons` browser filters, all owned by `useUrlPersonFilters` (`src/data/persons/`); `?q` seeds its search box. Two distinctions are load-bearing and easy to get backwards. **`?facet` is MEMBERSHIP, `?pfacet` is the PRIMARY facet** — the first asks "is this person also a …" and filters a boolean flag, the second asks "what is this person mainly" and filters the single-valued `primary_facet` the mix bar partitions. And **the multi-valued dimensions filter a space-padded CODE SET, never the display scalar beside it**: `?party=gerb` means "ever affiliated" (keeping the 4,723 switchers), `?oblast=VAR` means "holds any role there" — matching the representative column instead would drop 1,851 people from an oblast they genuinely serve, which reads as "no such people" rather than as a narrowed view. `?obshtina` is the ONE exception: it filters the representative seat, because there is no obshtina code-set column. `?court` carries an institution NAME (the picker facets and filters the same `institution` column, so its counts are exact and no code→name dictionary is needed). Every value is validated on read.
- `?proc` / `?cpv` / `?single` / `?cancelled` / `?year` / `?grade` — the procurement browser filters, all owned by `useUrlProcurementFilters` (`src/data/procurement/`). `?proc` is a bucketed procedure, `?cpv` a division/prefix/comma-set, `?single|?cancelled` a boolean toggle (name differs per browser), `?year` the company/awarder page only. `?grade=D,E,F` is a validated A–F set filtering the **server-side** contract risk index (`risk_grade`, migration 112) — contracts browsers only, since tenders have no per-tender index. Every one is validated on read: unknown values are dropped rather than passed into a `DbColumnFilter`.
- `?cpv` / `?mp` — the `/procurement/contractors` ("Топ изпълнители") filters, owned by `useUrlContractorFilters` (a small local hook, NOT the shared one above, since the leaderboard has no `?proc/?year/?grade` analogue). Here `?cpv` is **single-valued and normalised to a 2-digit CPV division ON WRITE** — `contractor_rank` (122) is a `(scope_key × division)` rollup with an `'ALL'` sentinel, so picking a finer catalogue code stores `?cpv=45` and the division filter is ALWAYS sent (default `'ALL'`); a multi-value set would return N rows per contractor and double-count. `?mp=1` is the MP-tied toggle (`is_mp_tied`). `?q` seeds the search box and `?pscope` the scope, as elsewhere.

### Local-elections routes

Local cycles (`mi*`, `chmi*`) live alongside parliamentary but in their own data tree and URL space:

- `/local/:cycle` — cycle overview (council vote share, mayors-won, município list with SOF pinned)
- `/local/:cycle/:obshtinaCode` — per-município dashboard (section map + compact mayor-candidate & council-party tiles, council hemicycle, kmetstvo mayors, район mayors, top councillors, chmi history). The compact tiles' "see full results" links drill into the dedicated full-breakdown pages below.
- `/local/:cycle/:obshtinaCode/mayor` — full mayor candidate ranking (R1 + R2)
- `/local/:cycle/:obshtinaCode/council` — full council party-by-party breakdown (expandable elected-councillor lists) + hemicycle + top councillors
- `/local/chmi` — chronological feed of all extraordinary (partial + new) elections across cycles
- `/sverka` — national officials-vs-CIK reconciliation table

`<cycle>` is the raw-data folder name: `2023_10_29_mi`, `2019_10_27_mi`, `2024_06_23_chmi`, `2024_10_20_chmi_nov`, etc. The synthetic `SOF` obshtinaCode holds Sofia's city-wide bundle (Sofia districts are the 24 `S2***` shards). Partials never appear in the elections selector — they surface contextually via tile + `/local/chmi` only.

### Data Hook Pattern

```typescript
// All data hooks follow this pattern
const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string]>): Promise<T> => {
  const response = await fetch(`/${queryKey[1]}/resource.json`);
  return response.json();
};

export const useResourceData = () => {
  const { selected } = useElectionContext(); // selected = "YYYY_MM_DD"
  return useQuery({ queryKey: ["resource", selected], queryFn });
};
```

### Data Pipeline (`/scripts`)

- `scripts/main.ts` — CLI entry point (cmd-ts)
- `scripts/parsers/` — Parse raw CSV/ZIP election data
- `scripts/parsers_local/` — Parse local-elections data (mi2023, mi2019, chmi partials). HTML-only ingest from `results.cik.bg/mi{YYYY}/tur1/rezultati/{oikCode}.html` via headed Playwright (CF Turnstile bypass — see `cik_fetch.ts`). One município bundle per shard under `data/<cycle>/municipalities/<obshtinaCode>.json` + national rollups in `index.json` + officials-vs-CIK reconciliation in `officials_diff.json` + per-município sidecars `officials_diff/<obshtinaCode>.json`. Aggregated cross-cycle chmi history at `data/local_chmi_history.json`. CLI: `npm run data -- --local-ingest <slug>` (where slug is `mi2023`, `mi2019`, or `chmi2024-2026/<YYYY-MM-DD>_chastichen` / `_nov`); `--local --local-date <folder>` re-parses already-downloaded raw data.
- `scripts/reports/` — Generate analytical reports (turnout, concentration, top gainers/losers, invalid ballots, recount metrics, machine flash memory)
- `scripts/stats/` — Aggregate statistics
- `scripts/search/` — Full-text search index generation
- `scripts/smetna_palata/` — Campaign financing parsing

### Path Aliases

`@/*` maps to `./src/*` (configured in `tsconfig.json` and `vite.config.ts`).

### Environment Variables

`.env.local` with `GEMINI_API_KEY` — injected into the frontend build via `vite.config.ts` as `process.env.API_KEY`.
