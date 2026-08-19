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
npm run db:pg:bootstrap  # Create the app_readonly role (step 2 of db:refresh)
                     # LOCAL ONLY, and it refuses everything else: the serving
                     # database, any host:port that is not the docker-compose one
                     # (--yes-non-local to override), and a URL whose database name
                     # disagrees with the GRANT CONNECT in roles_readonly.sql.
                     # There is deliberately NO :cloud twin — creating a LOGIN role
                     # on Cloud SQL stays the hand-run, password-set-out-of-band
                     # step roles_readonly.sql's header describes. What covers the
                     # cloud side (and db:load:tr:pg, a REFRESH_EXCLUSIONS member
                     # this chain never reaches) is a WARNING on the DDL path:
                     # exec()/execEach() print once per process when the SQL grants
                     # to app_readonly and the role is absent. That matters because
                     # the guards INVERTED the failure — a bare GRANT used to 42704
                     # and roll its file back, loudly; a guard just skips, the load
                     # SUCCEEDS, and the objects carry no ACL until /api/db 42501s
                     # against a corpus that looks fully loaded.
                     # Why it exists: roles are CLUSTER-wide, so a virgin pgdata
                     # volume has no app_readonly, and 34 migrations GRANT to it
                     # bare. exec() sends a migration as ONE transaction, so the
                     # first of those 42704s and rolls its whole file back —
                     # measured, db:refresh died at db:load:pg applying 017.
                     # Invisible on any machine that ever ran the file by hand.
                     # See docs/plans/grant-role-guard-sweep-v1.md (Tier 0).
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
`hreflang` redirects — the older test asserted only that the canonical _string_ was right, which is
why this survived unnoticed.

**The prerender resolves `VITE_DATA_BASE_URL` a SECOND time, and it must agree with the
bundle's copy.** A route may declare `preloadData` (`scripts/prerender/routes.ts`) — the data
files it fetches on first render — and `scripts/prerender/index.ts` emits each as
`<link rel="preload" as="fetch" crossorigin fetchpriority="low">`. The href is built by
re-resolving the data origin through Vite's `loadEnv`, so prerender correctness now depends on
the **gitignored** `.env.production` being present and on the env MODE matching the one
`vite build` used. It is pinned to the literal `"production"` for that reason: `vite build`
takes no `--mode` anywhere in `package.json`, and Vite sets `NODE_ENV` _from_ the mode, so
reading `NODE_ENV` back would be an independent input that can silently disagree.

A mismatch is **not** a build failure. It yields an empty base, every hint becomes a
same-origin `/macro.json`, and `data/**` is not deployed to hosting — so the catch-all answers
with the SPA shell at **200**. Per page, in both languages, that is four wasted shell downloads
and four dead hints, with the real fetches still going to the bucket afterwards. Same failure
signature as the `/court/**` build-time dependency below: exit 0, quietly worse pages.

Two gates cover it. `scripts/prerender/index.ts` refuses to write when the resolved base is
absent from the built entry chunk, and `tests/perf.spec.ts` compares each emitted href's origin
against that chunk. `fetchpriority="low"` is load-bearing rather than cosmetic — `as="fetch"`
defaults to HIGH, which puts the data in bandwidth competition with the render-blocking JS the
page needs in order to paint at all; measured, HIGH is a net LCP loss at both 1.6 Mbps and
10 Mbps. Note the whole hint set is still a small net loss at 1.6 Mbps, so re-measure before
adding a fifth path to a route.

**`npm run deploy` ships hosting only.** When a change spans hosting and the `db` function
— a new `/api/db` route, a new hosting rewrite pointing at it — deploy in this order:

1. the Cloud SQL migration (`npm run db:*:cloud`),
2. `npm run deploy:db`,
3. `npm run deploy`.

Hosting first means the rewrite is live against a function that cannot serve it yet.

**`/funds/contract/**`and`/company/**` are page URLs served by that function**
(`functions/spa_page.js`), not static files. They exist because both families were serving
the SPA shell — i.e. the HOMEPAGE's `<title>`, description and canonical — so to a crawler
all 81,910 contract URLs were duplicates of the homepage. Prerendering them is not an
option: `dist/` already holds ~248k files and Firebase's ceiling is on file COUNT
(a 453k-file dist has failed to deploy), while these two families are ~256k more.

Deploying the hosting rewrite BEFORE the function is the one ordering that breaks a page
that works today: the rewrite would route every contract and company URL to a function
with no handler for it. `deploy:db` first, then `deploy`.

**`/council/resolution/**`is a fifth member, and the only one that is function-served for a
CONTENT reason rather than a file-count one.** 4,676 resolutions (9,352 with the EN mirror)
would fit under the Firebase ceiling comfortably — but each body is one title and a vote
table, the shape that earns a thin-content penalty rather than traffic. So they get a real
head from the function and deliberately **no sitemap`<loc>`and no prerender**: discoverable
by a crawler already on the council page, never submitted en masse. The only inbound link is
the resolution title in`CouncilScreen`; without it the whole family is unreachable, which is
also what makes a routing bug here invisible to manual testing. Same ordering rule,
`deploy:db`before`deploy`.

Two things about it are easy to get backwards, and both shipped once:

- **The id charset must admit Sofia.** Fifteen of the sixteen council keys are `AAA99`;
  Sofia's synthetic key is a bare `SOF`, so a `[A-Z]{3}\d{2}` id regex excluded all 413 Sofia
  resolutions. `isSpaPagePath` still routed them to the function, `matchSpaPage` returned
  null, and the fallthrough served the HOMEPAGE's head plus a `noindex` — on the largest
  council in the corpus, cached an hour at the edge. `spa_page.council.test.js` derives its
  cases from the committed shard tree for exactly this reason: every hand-picked example is
  one of the fifteen that worked.
- **A link must use the FRONTEND code, never `obshtina_code`.** `/council/:code` resolves
  through `council_muni_code` only, and eight of the sixteen council keys are not frontend
  codes — three (BGS01, PDV01, VAR01) are OTHER municipalities' codes. Linking the internal
  key put "we do not track this council" one click from that council's own decision, for
  1,768 of 4,727 resolutions. `council_resolution_detail()` therefore returns
  `councilFrontendCode` beside `councilCode`, and a NULL there means render plain text.

**`/person/*` is a sixth member of that family, and the one easiest to get wrong.** The
`/person/*` + `/en/person/*` rewrites (`functions/person_redirect.js`) serve the 301 from
`person_slug_retired` — 23,916 slugs a re-resolve retired, which before 2026-08-08 returned
200 with the homepage's title and canonical and then noindexed themselves client-side. Same
ordering rule, `deploy:db` first. Three ways it differs from the three above:

- **It is only PARTLY function-served.** 25,167 person pages are prerendered and Firebase
  ranks exact-match static content above rewrites, so the function only ever sees the other
  ~101k. A missing rewrite therefore DEGRADES rather than breaks — which makes it easier to
  miss, not safer.
- **The rewrite must stay single-segment (`*`, never `**`)**, and the `/person/\*\*`HEADER
entry must carry no browser`max-age`: that value is read by the 25,167 static pages, and a
browser-cached one pointing at a deleted `/assets/index-<hash>.js`is a white screen`main.tsx`'s stale-chunk recovery cannot reach (it only fires on dynamic-import failures).
`scripts/deploy/firebase_person_rewrite.test.ts` holds both.
- **The handler owns every `/person` URL the rewrite reaches**, so anything it does not
  redirect it serves as the SPA shell — never a 404, or the ~101k non-prerendered people go
  with it. Those still serve the homepage's head; giving them their own via a `loadPerson`
  arm on `spa_page.js` is open work.

The function fetches the SPA shell from `https://electionsbg.com/` and swaps the
prerender's `<!-- SEO -->` / `<!-- BODY -->` marker blocks, caching it per instance for
`SPA_SHELL_TTL_MS` (10 min). Two consequences worth knowing: a cold instance makes one
extra outbound request, and if that fetch fails the page still serves correct head tags
without the SPA bundle (`FALLBACK_SHELL`) — complete for a crawler, degraded for a human,
which is the right way round for a failure nobody is watching.

⚠️ **This does NOT make the function deploy-order-free, and this paragraph claimed it did
until 2026-08-16 ("nothing needs re-deploying when the bundle hash changes"). Ship hosting
BEFORE the function whenever the bundle hash moves.** A WARM instance holds the PRE-deploy
shell for up to ten minutes, so a `deploy` that replaces `dist/` — deleting the previous
`/assets/index-<hash>.js` — leaves every function-served page advertising a script that is
gone. Firebase's catch-all answers that path with the SPA shell at **200 `text/html`**,
which fails strict MIME checking for a module script, so NO JS runs at all: a white screen
`main.tsx`'s stale-chunk recovery cannot reach, because it only listens for dynamic-import
failures and this is the ENTRY bundle. Measured on the 2026-08-16 declared-crypto deploy,
which is how this note came to exist.

**The edge is what turns a 10-minute window into an hour-long one.** `/person/**` carries
`s-maxage=3600` (and `spa_page.js` sets the same on its own responses), so the stale HTML
the warm function served AFTER hosting purged the CDN gets written back into it and pinned
— `x-cache: HIT`. The function's TTL then self-heals while the edge does not.

**THREE steps, always, and the third is not optional — an earlier draft of this note said
two and was wrong twice over.** No two-step order can avoid the window, because the
function can only fetch the new shell AFTER hosting is live, and only a HOSTING RELEASE
purges the edge. So whichever of the first two comes first, warm instances repopulate the
CDN with stale HTML in between, and it stays pinned for `s-maxage`:

```bash
npm run deploy                          # 1. hosting live with the new bundle
npm run deploy:db                       # 2. fresh instances fetch the CURRENT shell
SKIP_PREDEPLOY=1 npm run deploy         # 3. purge the edge entries step 2 could not
```

Step 3 takes `SKIP_PREDEPLOY=1` deliberately: `dist/` is already the tree step 1 built and
validated, and the goal is a new RELEASE (which purges) rather than a rebuild — without it
the predeploy re-runs lint, both test suites and a ~10-minute build for nothing. When a NEW
`/api/db` route is involved the function must lead, so the order becomes
`deploy:db` → `deploy` → `deploy:db` → `SKIP_PREDEPLOY=1 deploy`.

Measured twice on 2026-08-16, once per deploy: after step 1 the homepage served
`index-pCBzDm2m.js` while `/person/mp-3643` still served the deleted `index-Zcb7Mede.js`,
and after step 2 the function was correct on a cache-busted request while the plain URL
stayed stale until step 3. `/company/**` and `/funds/contract/**` recovered at step 2 both
times and `/person/**` did not — do not read one family as evidence for the others. Verify
with

```bash
curl -s https://electionsbg.com/person/mp-3643 | grep -oE '/assets/index-[^"]+\.js'
curl -s https://electionsbg.com/ | grep -oE '/assets/index-[^"]+\.js'
```

— the two hashes must match. The 25,167 PRERENDERED person pages are never affected (they
carry the build's own hash), which is exactly what makes this easy to miss: spot-checking a
person page picks a prerendered one and looks fine.

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
  `roles_readonly.sql` may not have run on the target — unguarded, it raises 42704 on a cold
  bootstrap and rolls the whole file back, leaving no function at all. (`npm run db:pg:bootstrap`
  now runs that file automatically for the LOCAL docker Postgres, as step 2 of `db:refresh`; it
  refuses every other target, so on Cloud SQL it remains the one-time manual step it always was
  and the guard stays load-bearing there.)
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

**The resolver's SECOND gold key is recoverable only from a filename shape**, and a
re-resolve that moves the key count by tens is this rather than a data change. The Сметна
палата stamps most filings `<PERSON-GUID><filing-seq>.xml`, and that GUID is what stitches an
MP to their ministerial declarations and one official to their several postings — but in the
2019-2023 folders it also emitted a BARE guid with **no** sequence suffix, which is
per-DOCUMENT. Read as an identity it makes one declarant look like one stranger per extra
filing, and since `registerIdByRef()` guards with `HAVING count(DISTINCT guid) = 1` the cost
is not a wrong merge but **no key at all, with nothing logged**. Measured 2026-08-11: 70 refs
were being skipped as "two register persons" and 2 actually were. The rule lives once, in
`PERSON_GUID_SQL_PATTERN` (`scripts/officials/slug_identity.ts`), and
`person_register_guid.data.test.ts` runs the SQL and JS forms over the whole corpus. Do not
restate the pattern anywhere — the officials ingest had already learned this (66 document ids
once sat in `_slug_collisions.json`, splitting real people into orphan profiles) and the
resolver's own copy had not.

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

**Phase 1 must also precede `db:resolve:persons` for a second reason since 2026-08**: the
resolver dates every officials posting from that tier's встъпителна / при напускане filings
(`date_basis = 'filing'`, 4,625 roles / 4,417 people), joining `declaration.subject_ref` to
the officials slug — and phase 1 is what writes `subject_ref`. Run out of order those roles
publish undated, and since the profile renders nothing without a basis the office periods
just vanish with nothing failing. `refresh_coverage.test.ts`'s `ORDER_PAIRS` holds the local
chain; on the cloud side the order is `db:load:declarations:pg:cloud` →
`db:resolve:persons:cloud` → `db:load:declarations:pg:cloud -- --resolve`.

⚠️ **`db:load:declarations:pg` PHASE 1 USED TO DESTROY BOTH COLUMNS, and the documented
cloud procedure ran it.** They are not in the shards — the shard writers never persisted
them — so they live only in Postgres, and phase 1 is a `TRUNCATE declaration … CASCADE` +
COPY of columns that do not include them. Every value came back NULL, the load reported
success, every row count reconciled, and the only symptom was `declared_label()` quietly
falling back to the register's LISTING label — a GROUP bucket that describes nobody. The
recovery costs another ~5-hour crawl or a `ship_filed_position.ts` run from a database that
still has them. Since 2026-08-18 the loader snapshots them by `source_url` inside its own
transaction and writes them back after the COPY, reporting `carried … for N/N filing(s)`;
a filing the register has withdrawn is named rather than silently dropped. Measured on the
reload that found this: 61,740 values lost locally, recovered from Cloud SQL — which still
had them only because nobody had yet followed the „roster re-slug needs BOTH phases, phase
1 first" instruction above against it.

**`declaration.filed_position` / `filed_institution` are SHIPPED, never re-crawled.** They
hold the declarant's own job and institution from each filing's `<Personal><Work>` /
`<Personal><Position>` — distinct from `institution` / `position_title`, which come from the
register's LISTING page and are GROUP labels: `position_title = 'Служебен министър-председател
и министър'` covers two people and describes neither (both were DEPUTY PM plus a minister).
Rendering a listing label as a person's job publishes a false claim about a named individual,
which reached a card on 2026-08-16. 089's column comments carry the rule.

The local corpus was filled by `scripts/declarations/backfill_filed_position.ts` — a ~5-hour
crawl of a rate-limited public register (54,071 fetches; 61,740 of 61,743 filled, the three
exceptions being filings whose `<Position>` the register itself leaves empty). **Do not point
that script at Cloud SQL.** A filing is immutable once published, so the derived values are
identical whichever database computes them; re-crawling spends five hours recomputing bytes
we already hold. Ship them instead:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 089_declarations.sql
npx tsx scripts/db/ship_filed_position.ts --to postgres://postgres@127.0.0.1:5434/electionsbg --apply
```

The shipper keys on **`source_url`**, not `declaration_id`: the id is a `bigserial` handed out
in insertion order by the loader, so it is a property of how a database was loaded rather than
of the filing. The two happen to agree today (verified 2026-08-17, the md5 of the whole ordered
mapping matches), but a partial or re-ordered load would silently write every value onto the
wrong filing. It refuses below a 95% match rate — a low rate means the two corpora are not the
same vintage — and updates only rows whose values actually differ, so re-running it is free.

### `is_declared_holding()` — the ONE definition of what counts as the declarant's own

**Two of the form's tables are not holdings, and until 2026-08-18 every wealth figure on
the site counted them.** Tables **1.2** („Чуждо недвижимо имущество") and **3.4** („Чужди
моторни сухопътни, водни и въздухоплавателни превозни средства") record property and
vehicles owned by SOMEBODY ELSE that the declarant rents or is provided with. The
register's own column headers are what settle it — and they differ from tables 1/3 in
three places, not one:

|                     | table 1 / 3 (own)                     | table 1.2 / 3.4 (чуждо)               |
| ------------------- | ------------------------------------- | ------------------------------------- |
| the money column    | „Цена на **придобиване**"             | „Цена **по договор**"                 |
| the basis column    | „Правно основание за **придобиване**" | „Правно основание за **ползване**"    |
| the year (3 vs 3.4) | „Година на придобиване"               | „Година на **сключване на договора**" |

So the number is not a mis-attributed asset value — it is **what the use costs**. Пеевски's
2025 annual files tables 1 and 3 as `Declared="False"`, declares eight rented houses and
five provided cars, and was published at **€10,070,563** against a real **€9,760,147**.

`is_declared_holding(table_num)` (089, beside `declared_label`) is the rule, with a TS twin
`isDeclaredHolding()` in `src/lib/declarations.ts` because a route cannot import TS.
`declaration_asset.table_num` stores the **canonical 2018-form** number — same convention as
`declaration_stake.table_num`, since the printed number is version-dependent (the pre-2018
form's „4" is boats, the current one's is cash).

Four things about it are easy to get backwards:

- **NULL RETURNS TRUE, and the function is deliberately NOT STRICT.** The provenance exists
  only in the source XML, so every row on a database that has not re-parsed is NULL —
  reading that as "not a holding" deletes every real estate from every published figure at
  once. STRICT would return NULL, which `WHERE is_declared_holding(…)` filters out, i.e.
  exactly that. **The whole change is therefore INERT until the corpus is stamped**, which
  is the correct order: `npx tsx scripts/declarations/backfill_asset_table_num.ts --apply`,
  then `db:load:declarations:pg` (phase 1 — `--resolve` alone does NOT rewrite asset rows),
  then the matview refresh. Applying 089/090 to Cloud SQL without shipping the re-parsed
  shards changes nothing there while local is correct, with every row count reconciling.
- **`category` and `legal_basis` cannot stand in, and the second is the trap.** A rented
  flat is still `real_estate`. And Пеевски's чужди cars carry `legal_basis = 'договор'` —
  which is also what Румен Радев's OWN car carries. A probe on `legal_basis ILIKE '%наем%'`
  finds 948 real-estate rows in the 2026 annuals and misses the vehicle side entirely.
- **The top of the leaderboard does not move, which is why this survived.** Of 19,188 people
  with a published net worth the top 100 is unchanged — the largest fortunes are real. The
  damage is per-profile: **882** people affected in their latest year, **217** ≥50% чуждо,
  **106** ≥90%, one at **100%** (Стефан Добрев Стайков, €445,386 → €0), **552** falling 50+
  ranks, and eight going from a published positive net worth to declared net liabilities.
  No aggregate check can see this shape.
- **Excluding is not hiding.** The rows stay in `declaration_asset` and render on `/person`
  under „Ползва, но не притежава" with the contract-price caveat — „declares no property of
  his own and rents eight houses" is the finding, and dropping the rows would lose it.
  `person_declaration_detail` carries `usedAssetRows` / `usedContractEur` beside the totals,
  and every asset row carries `tableNum`, `legalBasis` and a server-derived `isHolding`.

⚠️ **THE LEASE ASYMMETRY — know this before quoting a negative net worth.** Table 3.4's
dominant use is a LEASED vehicle: **1,014 of the 1,826 filings carrying a 3.4 row also carry
a лизинг debt**. Under a lease the lessor owns the car, so 3.4 is the right table — but the
lease liability sits in table 7 and stays counted, so excluding the asset while keeping the
debt is asymmetric. **103 people move from a published positive net worth to a negative one,
70 of them on exactly this pairing.** **Decided 2026-08-18: strict, with the caveat** — they do not own the car
and they do owe the money, which is what the form says. The „ползва" block prints each row's
„правно основание" and, when a filing pairs a чуждо vehicle with a лизинг debt, says in words
why the net figure can go below zero. Do not "fix" this by dropping the matched debts without
measuring first: the table-7 description is free text and the same match would drop lease
debts against property the declarant DOES own. Pairing them and dropping both is NOT reliably implementable — the table-7
description is free text, and matching „лизинг" would also drop lease debts against property
the declarant DOES own. See `docs/plans/declaration-foreign-assets-v1.md` §4d.

**Measured locally 2026-08-18** (the pre-`table_num` estimates in that plan's §2 over-matched
and are superseded): 7,278 чуждо rows / €73.6m raw; **€55,565,683** left `person_wealth_year`
across 1,980 person-years and 1,120 people; corpus assets €4,213,997,747 → €4,158,432,064;
795 latest-year profiles affected, 77 of them reduced to €0; 562 fall 50+ ranks and the top
100 does not move. `/mp-cars` went 721 → 643 rows, €7,109,059 → €5,483,110, and **41 MPs left
the register entirely** because every car they declared was leased or provided.

Nine surfaces read the rule: 090 (the matview join + `person_declaration_detail`), 092, 100,
105 ×3, plus the TS builders `scripts/officials/rankings.ts`,
`scripts/declarations/build_assets_rankings.ts`, `build_car_makes.ts` (612 чужди cars were
counted as MPs' own, €11.5m) and `scripts/person/compare_declarations.ts`.

**The gate is `scripts/db/tests/declaration_foreign_assets.data.test.ts`.** Its last test is
an EXHAUSTIVENESS sweep in the `declared_label` style — every function/view/matview whose
definition reads `declaration_asset` and SUMs a value must route through the predicate or be
listed in `HOLDING_FILTER_EXCEPTIONS` with a reason, so a new wealth surface fails until
someone decides, and a stale exception fails too. It also carries a mutation check
(the filtered recompute is compared against the UNfiltered one, so an assertion satisfied by
two implementations that both forgot the filter cannot pass) and skips with a DISTINCT
reason when `table_num` is entirely NULL — "the corpus has no provenance yet" must never
read as "the rule is enforced".

⚠️ **Deferred, and it is a live parse-time ambiguity:** table 1.2's area column is headed
„Площ /**декара**/" while table 1's is „Площ кв.м.", and the parser feeds both into
`area_sqm`. Measured: all 1,787 declared 1.2 tables carry the декара header, but 5,375 of
5,830 rows are bare numbers, 451 say кв.м. and 4 say декара — the declarants largely ignore
it and the unit is unrecoverable per row. That matters because `perSqmAnchor` drives
`correctRealEstateSeparatorTypo`, which **mutates the stored value**.
`check_suspicious_values.ts` now marks a чуждо flag as such so a reviewer does not
"correct" a contract price as if it were a purchase price, but nothing else is fixed. See
`docs/plans/declaration-foreign-assets-v1.md` §6.

### `value_basis` — whether a declared euro figure is the declarant's or OURS

**A foreign-currency asset row used to vanish from every wealth total, silently.** Each money
table (4 налични, 5 банкови сметки, 8 вложения) carries a „Равностойност в лв./в евро." cell
that the DECLARANT fills in, and `pickEurValue` prefers it. Where it was left blank, a
USD/GBP/CHF row was stored with `amount` + `currency` and a NULL `value_eur` — and dropped out
of `person_wealth_year`, `/persons`, `/officials/assets`, `/mp-assets` and the officials
rankings with nothing flagging it. Measured 2026-08-18: **462 rows over 163 people**, 356 of
them on filings `person_wealth_year` publishes (155 people, 280 person-years).

It was never a rounding caveat. Лъчезар Богомилов Иванов's 2021 was published at €254,294
against a true €3,652,248 — **7% of the truth**; Пеевски's 2017 at €2,503,406 against
€5,064,422 (a single 4,481,442 USD balance); and Владимир Славев Табутов's 2023 at
**−€121,331**, i.e. declared net liabilities, against a true **+€504,142** — the _sign_ was
wrong. Twelve of the rows are `debt`, which OVERSTATES net worth, the one direction 090's
header says this must never fail in.

The rule is `scripts/declarations/fx.ts` and the column is `declaration_asset.value_basis`:

```
'equiv'   the declarant's own Равностойност cell        'fx_ecb'  OURS — see below
'peg'     BGN/EUR at the locked 1.95583, or EUR         'legacy'  valued by an older parser
NULL      no euro figure — COUNTED in excluded_asset_rows
```

`fx_ecb` is the ECB reference rate at the last quoted day of the period the filing covers
(`COALESCE(fiscal_year, declaration_year)`), from the **committed** `data/declarations/
fx_year_end.json`. Plan: `docs/plans/declaration-fx-conversion-v1.md`.

Six things about it are easy to get backwards:

- **`pickEurValue` RUNS FIRST AND WINS.** We fill a blank, never override a filing — that is
  what makes `fx_ecb` mean „the declarant stated no equivalent". A row they valued keeps their
  number even when it implies an absurd rate (the corpus holds 10× and 0.1× errors).
- **YEAR-END, not an annual average**, because tables 4/5/8 declare a STOCK — a balance as of
  31 December — and an average is the wrong statistic for a point-in-time quantity. And **not
  a reverse-engineered „declarant convention" either**: the 4,347 declarant-valued rows imply
  a median that matches the ECB year-end to four decimals for 2018/2019/2021/2025 and matches
  nothing in particular for 2016/2020/2022. There is no convention to reproduce.
- **THREE currency lists, and merging any two is the defect.** `EUR_RATE`
  (`src/lib/currency.ts`) = folds at a FIXED rate; `FX_CURRENCIES` (`fx.ts`) = converts at a
  DATED one; `is_crypto_asset`'s fiat list (090) = „is this money at all". „ДОЛАРА" is fiat and
  not fixed-rate; „ЕВРО" is fiat and IS fixed-rate. Putting USD in `EUR_RATE` is a fixed rate
  for a floating currency — wrong in every year but one.
- **Keying the rates on SPELLINGS rather than a canonical code renders „евро" as „лв".**
  `formatNative` asks „is this in EUR_RATE and not the string 'EUR'?" to choose between € and
  лв, so a euro spelling sitting in the rate table is a lev to every formatter. Spellings fold
  through `canonicalCurrency()` first, and `normCurrency` is deliberately identical to 090's
  `asset_unit_norm` so the two sides cannot sort the same cell differently.
- **`excluded_asset_rows` HAS TWO ARMS, and the second must NOT carry the first's
  `category NOT IN ('debt','credit_limit')` filter.** The ceiling arm excludes debts because
  dropping a debt from the ASSET side is not a hole; an unvalued debt is one. Copying the
  filter is the trap. `person_wealth_year` also exposes `imputed_asset_rows` / `imputed_eur`,
  so any surface can say how much of a total we computed — converting silently would only
  replace a silent omission with a silent invention.
- **An inverted rate is invisible to a tolerance band near parity.** Inverting USD 2016 moves
  it from +10.4% off the declarant median to +22.7%; both fit any band loose enough to admit
  the real corpus. `declaration_fx_conversion.data.test.ts` therefore holds hand-verified ECB
  ANCHORS, and its calibration arm filters `value_basis = 'equiv'` — comparing against our own
  converted rows would calibrate the table against itself and pass by construction.

**Re-parse, then reload — the same order as `is_declared_holding`, and for the same reason:**
no SQL can backfill this, because whether a figure came from the declarant's cell or the peg is
only recoverable from the source XML.

```bash
npx tsx scripts/declarations/backfill_asset_fx.ts --apply   # offline, reads raw_data/
npm run db:load:declarations:pg                             # phase 1 — --resolve does NOT rewrite asset rows
npx tsx scripts/declarations/rebuild_post.ts                # mp-assets/*, car-makes, rankings
```

Cloud side, and nothing runs it automatically — `db:load:declarations:pg:cloud` (phase 1) then
`-- --resolve`. Applying 089/090 to Cloud SQL **without shipping the re-parsed shards changes
nothing there while local is correct**, with every row count reconciling.

**The rate table is operator-run and moves once a year**, when a year closes:
`npx tsx scripts/declarations/fetch_fx_rates.ts --apply`. It REFUSES when a settled historical
rate has moved (the ECB revises nothing, so that means the parse changed) and exempts only the
still-open current year, whose entry is the last day quoted so far and legitimately moves until
the year closes.

⚠️ **The residue is the design, not a gap.** 8 rows stay unvalued — filings whose committed
shard row set disagrees with a fresh parse, so the backfill refuses to touch them (an older
parser had missed their `amount` column entirely). They are COUNTED rather than guessed, and
the gate asserts both that they are counted and that the residue has not grown.

### `held_scope` — whether declared money sits in Bulgaria or abroad

**Tables 5 („Банкови влогове") and 8 („Вложения в … фондове") carry a „В страната" /
„В чужбина" cell pair that we ingested none of until 2026-08-19.** The register publishes
it per account — Иво Христов Петков's 228,100 EUR account is marked „Белгия" while his
other five say „да" — and our rows for the two were byte-identical in every stored column.
`declaration_asset.held_scope` / `held_country` / `held_raw_in_country` / `held_raw_abroad`
close it. Rule: `classifyHeldPlace` in `scripts/declarations/held_abroad.ts`. Plan:
`docs/plans/declaration-held-abroad-v1.md`.

Measured over 76,953 money rows: **95.46% domestic, 4.15% abroad (€168.5m, 765 people),
0.38% unknown**.

Five things about it are easy to get backwards:

- ⚠️ **TABLE 4 („Налични парични средства") HAS NEITHER COLUMN, and its `Cell Num="7"` is
  „Произход на средствата".** The obvious specification of this work said tables 4/5/8;
  reading the pair off table 4 does not yield a blank, it yields the funds origin, so all
  25,717 cash rows would publish as held in a country called „заплата". The **pre-2018**
  form carries the pair on table 7 at cells **6/7**, not 7/8 — no special case was needed
  only because the pair goes through `columnResolver` like every other cell.
- ⚠️ **NULL IS NOT `'unknown'`, AND NEITHER IS `'domestic'`.** NULL means the row's table
  has no such question (every real-estate, vehicle and cash row, and everything parsed
  before the column existed); `'unknown'` means the filing answered unintelligibly. The
  answer is TRI-STATE because a boolean would have to invent one: the cells are free text
  the register does not validate — 5,691 distinct spellings on the „В страната" side — and
  346 rows leave both blank, ~130 tick both, and ~93 SPLIT one amount across the two
  columns (151,744 + 967 against an amount cell of 152,711).
- ⚠️ **`held_country IS NULL` IS NOT EVIDENCE OF BEING DOMESTIC.** „да" in the „В чужбина"
  column says abroad and names nowhere: a country is named on only **521 of 3,288** abroad
  rows, **11.6% of the money**. „How much is abroad" is answerable over `held_scope`;
  „where" is answerable only over the named subset, and a surface reporting it must say so.
- **Content overrides the column it sits in, and a named place beats a bare tick.** 47 rows
  answer domestically inside „В чужбина"; and „РБългария" beside a bare „х" is a declarant
  naming their country and STRIKING OUT the column that does not apply — „х" is a tick to
  some filers and a strike-through to others. A lone denial asserts the OTHER column (the
  pair is exhaustive), which is the only statement 81 rows make.
- **Re-parse, then reload — the same order as `is_declared_holding` and `value_basis`, and
  `--resolve` alone does NOT rewrite asset rows.** No SQL can backfill this; the cells exist
  only in the source XML, so the whole change is INERT until the shards are stamped.

```bash
npx tsx scripts/declarations/backfill_asset_held_abroad.ts --apply   # offline, reads raw_data/
npm run db:load:declarations:pg                                     # phase 1
npm run db:load:declarations:pg -- --resolve                        # phase 2 — refills person_id
```

Phase 2 is not optional even though nothing here reads `person_id`: phase 1 TRUNCATEs
`declaration`, so skipping it leaves every filing unresolved.

⚠️ **On Cloud SQL, SHIP these columns — do NOT reload for them.** The `:cloud` twin of those
two commands works and costs a measured **~8 minutes of 500s** on `/persons`,
`/officials/assets`, `/mp-assets` and `/declarations/crypto` (phase 1 NULLs every
`person_id`; phase 2 runs 090's `DROP MATERIALIZED VIEW … CASCADE`, and a DbDataTable
resource has no `missingMigration` degrade). The values are derived from immutable filings,
so they are identical whichever database computes them — the `ship_filed_position.ts`
argument — and `scripts/db/ship_held_abroad.ts` writes them into the rows already there:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 089_declarations.sql
npx tsx scripts/db/ship_held_abroad.ts --to postgres://postgres@127.0.0.1:5434/electionsbg          # dry run
npx tsx scripts/db/ship_held_abroad.ts --to postgres://postgres@127.0.0.1:5434/electionsbg --apply
```

Measured 2026-08-19: **76,953 rows in 31 s at 13:15 on a Wednesday**, RowExclusiveLock only,
`person_id` / `filed_position` untouched, all five matviews still populated, all four pages
200 throughout. The key is `(source_url, seq)` — `declaration_id` is a `bigserial` handed out
in insertion order — and the payload carries `category` so that **any** row-identity
disagreement refuses the whole ship rather than publishing „Белгия" against somebody else's
account. Reload instead only when the SHARDS have moved for some other reason; the shipper
carries these four columns and nothing else. Applying 089 alone changes nothing while local
is correct, with every row count reconciling.

**The gate is `scripts/db/tests/declaration_held_abroad.data.test.ts`** (8 tests), plus 17
unit tests on the rule. It carries a mutation check — every stored value is re-derived from
the stored RAW cells, which is what those two columns are for — and skips with a DISTINCT
reason when `held_scope` is entirely NULL, so „the corpus has no provenance yet" cannot read
as „the rule is enforced".

### `declared_label()` — the ONE definition of which office label a reader sees

**Nine serving surfaces now read these columns, and all of them go through
`declared_label(p_filed, p_listed)` in `089_declarations.sql`** —
`COALESCE(nullif(btrim(p_filed), ''), p_listed)`, IMMUTABLE, PARALLEL SAFE and deliberately
**not** STRICT (STRICT would short-circuit the whole fallback). Shipped and deployed to Cloud
SQL 2026-08-17; plan: `docs/plans/declaration-filed-position-serving-v1.md`.

**Never restate that COALESCE at a call site.** Twelve hand-copied copies is the shape that
produced the six-way `magistrate_current` duplication where "someone missed one" fired twice
in one day. The precedent is `kzk_effective_suspension(suspension, status)` in 042.

**⚠️ Which surfaces take the filed value is decided by what the COLUMN is for, NOT by the
tier it spans.** Getting this backwards is the live defect this section exists to prevent:

| the column's job                                       | surfaces                              | source                         |
| ------------------------------------------------------ | ------------------------------------- | ------------------------------ |
| a rendered label / substring search (`filter: "text"`) | 090 ×3, 093 ×2, 098, 100, 105, 159    | **filed**, listing as fallback |
| an exact-match FACET KEY (`filter: "in"`)              | 120 `person_browse_table.institution` | **listing**                    |
| renamed into a different contract                      | 102 `municipality`, `role_raw`        | **listing**                    |

The two exclusions are deliberate and their own files' headers say so — do NOT "finish the
job":

- **120** — `db_table.js` exposes `institution` as `filter: "in"` and the picker facets that
  same column, so the distinct values ARE the picker. The listing is a 1,013-value controlled
  vocabulary; the filed value is free text and takes the column **991 → 12,626**, which does
  not make the picker noisier so much as stop it being a picker. The fragmentation is driven
  by the EXEC tier, so narrowing to one tier does not rescue it. The accepted cost: exec group
  buckets survive there as facet VALUES, which is coherent — „the heads of foreign missions"
  is a usable bucket and only false as a claim about one named person.
- **102** — `ld.institution` is renamed `AS municipality` and holds the município NAME
  („Ямбол") where the filing holds the EMPLOYER („Община Ямбол"; 25 Видин rows say „Общински
  съвет - Видин", a council), 6,576 of 6,613 rows differing. `ld.position_title` is renamed
  `AS role_raw`: five clean roles against **563** free-text spellings, one of which names the
  body instead of the role („Общински съветник" → „Общински съвет").

**A disagreement COUNT cannot tell correction from noise.** On exec the listing invents group
buckets describing nobody and the filed value is a fix; on muni the listing is a clean
controlled vocabulary and the filed value is unnormalised free text. Both read as "20-42% of
rows disagree". Only reading the VALUES separates them — this plan got 102 wrong twice by
trusting the rate.

**Apply order — `148` must be in the command and precede `120`.** 090 opens with
`DROP MATERIALIZED VIEW person_wealth_year CASCADE`, which takes FIVE dependents, so every one
must be recreated in the same run; and 120's matview selects `person_company_bridge_a`, which
only 148 creates. Omit 148 and 120 raises 42P01 **after** the CASCADE has already deleted
`person_browse_table` — `/persons` down with nothing left to rebuild it. A local run can pass
without it purely because the view is already there.

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5433/electionsbg npx tsx scripts/db/apply_functions.ts \
  089_declarations.sql 090_person_wealth.sql 093_declaration_events.sql 097_cohort_benchmark.sql \
  098_new_filings.sql 100_officials_rankings.sql 102_municipal_officials.sql 104_mp_roster.sql \
  105_mp_serving.sql 148_person_company_basis.sql 120_person_browse.sql 159_person_crypto.sql
```

Measured: 21.8 s local, **8m02s on Cloud SQL**, during which `/persons`, `/officials/assets`
and `/declarations/crypto` answer **500** — DbDataTable resources have no `missingMigration`
degrade. Off-peak only. Prefer `db:load:declarations:pg:cloud -- --resolve` (which applies the
same files in its own order) unless the CASCADE dependents have been resolved against the
TARGET database, which is what makes the short command safe.

**⚠️ After SHIPPING VALUES, refresh — do NOT re-apply.** Only two matviews read
`declared_label` (`officials_rankings_table`, `person_crypto_table`) and both carry a UNIQUE
index, so `REFRESH MATERIALIZED VIEW CONCURRENTLY` on the pair is **14 s with no reader
blocking**, against the ~8-minute outage a re-apply costs. Re-apply only when a DEFINITION
changed:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY officials_rankings_table;
REFRESH MATERIALIZED VIEW CONCURRENTLY person_crypto_table;
```

**The gate is `scripts/db/tests/declaration_filed_position.data.test.ts`** (18 tests). Its last
one is an EXHAUSTIVENESS sweep: it enumerates every function, view and matview whose definition
reads `declaration` and mentions these columns, and fails unless each is either routed through
`declared_label` or listed in `LISTING_LABEL_EXCEPTIONS` with a reason — so a NEW surface fails
until someone decides, and a stale exception fails too. It also carries a shipped mutation
check, because an assertion comparing a payload to `declared_label` is otherwise satisfiable by
an inverted implementation both sides agree on. Note the sweep alone cannot catch **swapped
arguments** (`declared_label(d.institution, d.filed_institution)` passes it), which is why the
per-surface arms exist.

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

**`db:load:magistrates:pg:cloud` is itself a PREREQUISITE of the resolve, not merely a
trigger for the loader above**, and it is the newest member of this section:

```bash
npm run db:load:magistrates:pg:cloud   # BEFORE db:load:judicial-bodies:pg:cloud → db:resolve:persons:cloud
```

`magistrate_holdings.json` used to be a latest-year snapshot, so the ИВСС register's yearly
turnover deleted every magistrate who stopped filing — and since `resolve_persons.ts` builds
its magistrate mentions from `SELECT name, court FROM magistrate`, that deleted their person
row and 404'd every `/person` URL they had been served under. The roster now ACCUMULATES
(each magistrate's most recent annual filing), which is only useful if the serving database
has it: run the resolve against a cloud `magistrate` table that predates the change and prod
drops the same 462 people at a 200, with every row count reconciling. `magistrate` is loaded
ONLY by this command on the cloud side. `magistrate_roster_retention.data.test.ts` catches it
locally; nothing checks the cloud.

**The current bench is `magistrate_current` (a view in 070), and 070 must reach a database
BEFORE 116 does.** Because the roster retains departed magistrates, every count captioned in
the present tense has to exclude them — and that predicate used to be copied six times across
070, 116 and `scripts/db/lib/seo_courts.ts`. "Someone missed one" then fired twice in one day
(5325a6ef37 scoped 116's two counts, fabf683666 the prerender's, hours apart), so the rule is
named once and the copies read it. The consequence for deploys: 116's two functions now
select a view that only 070 creates, and 116 sets `check_function_bodies = false`, so applying
it alone to a warm database SUCCEEDS and then raises 42P01 on the first `/court` call. Ship
them together, 070 first:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts \
  070_magistrates.sql 116_judicial_body.sql
```

`db:load:magistrates:pg[:cloud]` applies 070, so a roster reload carries the view; a
function-body fix in 116 on its own does not wait for one. Two properties of 070 protect the
dependency and must not be undone: the view is `CREATE OR REPLACE`, never `DROP` (a DROP in
this loader-applied file is the 2BP01 that stalled `db:load:pg` for a day — 077/145 — and
`DROP … CASCADE` is the silent variant of 003), and 116's references stay in `LANGUAGE sql`
STRING bodies, which record no `pg_depend` edge; converting them to PG14+ `BEGIN ATOMIC` would
make a future DROP in 070 fail 116 outright.

Related, from the same consolidation: `magistrate.decl_year` is now `NOT NULL`, because
`decl_year = max(...)` is NULL-false and one year-less row would vanish from every
current-bench count at once. Warm databases get it from a GUARDED reconcile at the foot of
070 — guarded because the loader applies the schema BEFORE it truncates and reloads, so an
unconditional `SET NOT NULL` against a legacy NULL row would abort the ingest in the apply
phase and leave the corpus on its previous vintage.

**One-off, and Cloud SQL needs it by hand.** The retention's first cut keyed the roster on the
register's RAW name, so a magistrate the ИВСС re-spelled between years (hyphen spacing —
„… Средкова - Петрова" in 2025, „… Средкова-Петрова" in 2026) survived as two rows and minted
TWO person rows for one human. The writer now drops a retained record whose `normName` is
already on the current bench, which deletes the duplicate profile — and orphans the slug it
was served under. Unlike the 462, the redirect target here genuinely exists and is the same
person, so these two get one:

```sql
INSERT INTO person_slug_retired (slug, target_slug) VALUES
  ('maya-sredkova-petrova-9sqndm',   'maya-sredkova-petrova-j1j9ru'),
  ('milena-kirova-stoyanova-1lk9uj', 'milena-kirova-stoyanova-1aa2jp')
ON CONFLICT (slug) DO UPDATE SET target_slug = EXCLUDED.target_slug;
```

Only needed on a database that ran the roster's first cut (2026-08-11). It cannot recur: the
dedupe runs before emission, so a re-spelling is never published again.

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

`nzok_activity_proc_periods` (migration 053, `db:load:nzok-activities:pg`) is the MONTHLY
activity panel — (period × entity × procedure), i.e. the annual matrix before it is folded
across months. It exists so the activity corpus can be joined to `nzok_hospital_payments`
period-exactly; the annual matrix cannot, and a facility with four months of payment rows
against a full year of cases reads as absurdly cheap.

Four things about this family are easy to get backwards:

- **`nzok_activities` is ANNUAL and must stay that way.** Ten call sites across five
  migrations (053 ×5, 059 ×2, 054, 065, 075) read `max(period) FROM nzok_activities`
  meaning "the latest ANNUAL matrix". Re-graining that table to months silently redefines
  every one of them as a single month — the case-mix ratio would compare one month of cases
  against a full year of payments, wrong by ~12x, at a 200, with every row count
  reconciling. That is why the monthly panel is a separate relation.
- **The loader is a PER-YEAR MERGE, not a TRUNCATE.** `activities.json` is single-year by
  construction, so a TRUNCATE made every run REPLACE the corpus: loading 2024 swapped 2025
  out. The write is now `DELETE … WHERE EXTRACT(YEAR FROM period) = $1` + insert, and the
  writer emits a per-year `activities-<year>.json` (gitignored) beside the latest-year
  `activities.json`. Backfill with `npx tsx scripts/db/load_nzok_activities_pg.ts --year 2024`.
- **A backfill run must not touch the LATEST-year artifacts.** `activities_overview.json` is
  COMMITTED, and the writer used to rewrite it on every run — so building 2024 replaced the
  2025 overview with 2024 and would have shipped it, with nothing red. The writer now only
  writes `activities.json` + the overview when the year being built is the newest on disk.
- **The panel records NO changelog of its own, on purpose.** It is the same corpus change
  the `nzok_activities` batch already reports — same loader, same transaction, same source
  file — so a second batch reports one event twice. Measured: recording it put 291,414 rows
  into `ingest_first_seen` on a two-year load (94% of everything the one-day window holds)
  and failed `recent_updates_plan.data.test.ts` at 308,980 rows scanned for a one-day
  window. Summary mode does not help — it stops the day being itemised, but the branch
  still scans.
- **Backfilling on the CLOUD needs an env var, not a flag.** `db:load:nzok-activities:pg:cloud`
  is a nested npm script and the inner `npm run` swallows `--year 2024` (argv arrives as
  `["2024"]`), so the loader would silently reload the LATEST year instead. Use
  `NZOK_ACTIVITY_YEAR=2024 npm run db:load:nzok-activities:pg:cloud`.

The panel must sum to the annual matrix EXACTLY, per year — they are the same rows either
side of the fold, so drift means one aggregation lost or double-counted a period. The
loader asserts it in-transaction and `nzok_activity_proc_periods.data.test.ts` holds it
plus the annual-grain and entity-key invariants. Corpus floor: activity data begins
**Jan 2024**; nhif.bg serves nothing earlier.

`procurement_award_criteria()` (migration 164) is the ЗОП чл. 70 award-criterion lens behind
`/api/db/procurement-award-criteria` and the `AwardCriteriaTile` on `/procurement`. It rides the
TENDERS loader — `db:load:tenders:pg[:cloud]` applies 164 — because it reads only `tenders` and,
being a serving FUNCTION, carries no data that any other path would ship. Without an applier the
route degrades to `null` for ever on the serving side (the tile simply never appears) while
`db:refresh` FAILS at its final `test:data` step rather than skipping, since the gate's skip
predicate covers an empty corpus, not a missing function.

Four things about it are easy to get backwards:

- **Its no-call predicate is NOT 037's, and the two must not be "consolidated".**
  `procurement_benchmarks` (037) reads `contracts.procurement_method`; this reads
  `tenders.procedure_type`. The vocabularies intersect on 17 values but diverge (contracts also
  carries the OCDS codes `open`/`limited`/`selective` and 45% NULL), and 037's list **includes**
  „Покана до определени лица", which is 0.0% blank across 2,229 tenders — excluding it would drop
  criterion-bearing rows from the denominator — while **omitting** three types that genuinely carry
  none. `award_criteria.data.test.ts` asserts the divergence in both directions so a future
  refactor cannot quietly adopt the contracts-side list.
- **`award_method` starts in 2020**, so `byYear` is floored at that year IN THE FUNCTION rather
  than by each consumer: a 2018-2026 series renders a data-availability cliff as a policy change.
  The rows dropped by the floor come back as `preCriterionTenders` so the omission stays visible.
- **`unknown` (not stated) and `other` (an unrecognised non-null value) are separate buckets.**
  Seven `award_method` values exist today; an eighth arriving in a future ingest must surface as
  `other` rather than merging into "not stated". The bucket set has ONE home —
  `AWARD_CRITERION_BUCKETS` in `src/data/procurement/useAwardCriteria.ts` — which the tile draws
  from and the data test asserts the SQL emits, so a seventh bucket cannot be counted in `total`
  and silently never drawn.
- **It is deliberately NOT in the 124 precompute.** Measured: the first cut ran 188,591 buffers
  with a temp spill (658 ms) because four scalar subqueries re-evaluated the CTE chain; referencing
  each CTE once and adding `idx_tenders_award_criteria` (a covering index on `publication_date`
  INCLUDE the three read columns) took it to **3,542 buffers / 233 ms** full-corpus and **845
  buffers / 23 ms** on the default parliament window. That is inside the per-view budget, so the
  precompute would be machinery for nothing — but re-measure before adding a column to the
  function, since the index is what keeps the pass Index Only.

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
other still lets `bucket:sync:paths -- parliament` re-upload all 613 files — **and** the
`-x` regex in both `bucket:sync` and `bucket:sync:dry` in `package.json`, which is a third
place `bucket_sync_paths.test.ts` holds in lockstep.

⚠️ **The last step is NOT a scoped `--delete`, and an earlier version of this paragraph said
it was.** `gsutil rsync -x` excludes a match from DELETION as well as from upload ("not copied
or deleted", per gsutil's own help), and `syncPaths` passes `-x` together with `-d` — so once
the exclusions are in place, no sync will ever remove those objects, and scoping a sync to the
subtree is refused by `isExcluded` by design. The exclusion FREEZES the bucket copy. Removing
it is an explicit `gsutil -m rm -r gs://<bucket>/parliament/votes/sessions`.

**[2026-08-16] Under `parliament/`, EIGHT families are in that frozen state** — the eight
site-hygiene-v1 T6b excluded: `mp-connections/`, `official-connections/`, `by-id/` and five
`connections-*.json` singletons, **12,533 objects and 52.5 MB**. None has a reader. The three
retired MP↔company shard trees are NOT among them: `gsutil ls` returns "matched no objects" for
each, so their objects are gone (WHAT removed them is not recoverable — no lifecycle rule,
versioning Suspended).

⚠️ **`company-connections/` WAS the ninth and is now retired — this entry used to say the
decision was open.** It had a LIVE READER (the AI chat's `companyConnections` tool fetched it per
EIK) while being excluded from sync, so it was not merely frozen but answering from a
2026-07-29 snapshot at a 200 for weeks, and an `rm` would have 404'd a shipped feature. Closed
2026-08-16 by moving the reader to Postgres — migration 158 `company_political_links` behind
`/api/db/company-connections` — and then removing the 16,609 objects.

Three things about that move are worth carrying, because the next retirement will look like it:

- **The reader was invisible to the usual grep.** `src/ scripts/ functions/` reported zero
  readers of the tree and was wrong: `ai/` is none of those. Any "is this readerless?" sweep
  must include it.
- **It was NOT a like-for-like port, and the shard builder is not its specification.** The
  shards matched a TR officer to a power roster BY NAME, kept the match only if the name
  appeared in exactly one company, and graded it `medium`/`low` on whether the name had three
  parts. 158 reads the gated `person_role` tr/ngo set — the Commerce Registry's own people
  count per name fold (`tr_name_fold_people`, 148) decides, an unmeasured fold is REFUSED, and
  there is no confidence grade. Per EIK that is sometimes fewer links; corpus-wide it is wider
  on both arms (9,982 companies with a direct link vs 3,843; 26,047 answerable vs 19,232).
- **`scripts/declarations/tr/build_company_connections.ts` is DELETED (2026-08-16), and its
  output is not.** The builder was retained for a day on the theory that it was the only path
  able to reconstruct the removed objects. That was wrong twice over: it was a **git-tracked
  source file** (so `git show <sha>:<path>` restores it — the versioning-Suspended argument
  applies to bucket objects, which have no history, never to code in git), and its 19,232-file
  output was still sitting on disk. Both call sites are gone (`scripts/declarations/index.ts`
  phase 7, `scripts/declarations/tr/daily_refresh.ts`) along with the
  `tr:build-company-connections` npm script, so a TR refresh no longer writes 83 MB nothing
  reads.

  ⚠️ **Deleting the producer did NOT delete the tree, and the sync guards therefore STAY.**
  `data/parliament/company-connections/` is gitignored, so its 19,232 files persist on every
  machine that ever ran a `tr:daily-refresh` or `--declarations`, with nothing left to refresh
  or remove them. Both halves in `scripts/bucket_sync_paths.ts` — the `isExcluded` branch and
  the `CHILD_EXCLUDES` twin — plus the `-x` arms in `bucket:sync` / `bucket:sync:dry` are what
  stop the next `bucket:sync:paths -- parliament` from re-creating the retired tree in the
  bucket. Retiring a builder makes those guards MORE load-bearing, not less: while it ran, a
  stray re-upload was merely pointless; now it would republish a permanently frozen snapshot.
  "Nothing writes this any more, so the exclusion is dead config" is the one inference to
  refuse here.

(Scoped to `parliament/` deliberately: `funds/` and `procurement/` are excluded too and far
larger — `funds/` alone is 182,075 objects and 560 MB — but those are PG-served by design, not
retired artifacts.)

The files stay on disk either way: they are the loader's input AND the prerender's fact
source (`scripts/prerender/votesFacts.ts`).

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

`tender_dossier` + six sibling tables (migration 146, `db:load:tender-dossier:pg`) are
the ЦАИС ЕОП per-procedure capture — the attachment manifest, the parsed обявления, the
award-stage trail, contract items, buyer profiles and extracted document TEXT (never
document bytes; the 3.65 TB blob tier was dropped, so `/api/db/tender-document` mints a
signed redirect out to app.eop.bg instead). **`db:load:tender-dossier:pg` is 146's ONLY
applier** — the tenders loader below carries 147 but NOT 146 — so a database that never
ran this loader has the search index and none of the corpus.

Its input is `raw_data/procurement/eop_dossier.sqlite`, **gitignored**, written by
`npx tsx scripts/procurement/ingest_eop_dossier.ts` — a rate-limited ~26 h crawl of a
shared public register, so it is an operator action rather than a pipeline step
(`--probe` first to gauge the block state; `--to-year` for a stratified sample).
`scripts/procurement/ingest_eop_spec_text.ts` is the tier-B pass over the same store:
sign → fetch → extract text → **discard the bytes**. There is no `npm run` alias for
either, on purpose — neither belongs in a chain.

`tender_search_text` (migration 147, applied by `db:load:tender-dossier:pg` **and** by
`db:load:tenders:pg`) is that corpus's SEARCH index — the long „Кратко описание", every rendered
обявление and every extracted specification, folded per procedure so the words a
reader actually searches for are findable. `tenders.subject` is a 138-char headline,
so before this a procurement for nine kinds of coffee was searchable only as
„Доставка на хранителни продукти".

```bash
npm run db:load:tender-dossier:pg:cloud
```

**Three things about it invert the usual rules of this file, and the first is a
live-breaking deploy hazard rather than the customary staleness:**

- **The tenders search reads it UNCONDITIONALLY — there is no degrade.** `db_table.js`
  emits `… FROM tender_search_text …` on every global search of the `tenders`
  resource, and `db_routes.js`'s `badRequest()` rethrows a non-`DbRequestError`, so a
  `42P01` is a **500** on every `/procurement/tenders` search box keystroke and every
  `?q=` deep link. That is why **`load_tenders_pg.ts` applies 147**, not just the
  dossier loader: `db:load:tender-dossier:pg` is a `REFRESH_EXCLUSIONS` member whose
  input is a gitignored ~26 h crawl, so on most machines it has nothing to do. The
  table now exists wherever `tenders` does, EMPTY if never filled — which is exactly
  the pre-B3 behaviour, since the arm then adds no hits.
- **Its loader applies DDL BEFORE checking for the capture.** The order matters: with
  the capture guard first, `db:load:tender-dossier:pg:cloud` on a machine without the
  crawl printed „Nothing to load", applied no DDL and exited **0** — a deploy that
  looks successful and creates nothing. 147 also carries the `app_readonly` GRANTs for
  146's seven tables, which shipped with none — so applying it is also what would repair
  a 146 that had already reached a serving database. (As of 2026-08-12 none has: the
  whole dossier family is local-only. The hazard is real but latent, and it is
  invisible locally because every loader and data test connects as the owner; it would
  surface only as `/api/db` 42501 on Cloud SQL against a corpus whose row counts all
  reconcile.)
- **COVERAGE IS THE POINT, and it is small.** 1,861 of 237,321 procedures (0.78%) at
  the time of writing. The arm may therefore only ever **ADD** hits — it is one OR arm
  beside buyer and subject, so a missing row can fail to add a hit and never suppress
  one. It must never become a filter, a facet or a count: absence there would read as
  „no such procedure" for the 99.2% not yet crawled. `/api/db/tender-search-coverage`
  returns the two live numbers any UI must cite before claiming it searched documents.

Two performance rules are load-bearing and both were measured, not reasoned:

- **The arm is `unp = ANY(ARRAY(SELECT …))`, never a correlated `EXISTS`.** An EXISTS
  cannot participate in a BitmapOr, so it drags the WHOLE tender search onto a Seq
  Scan — 37 ms (the pre-existing arms) → **6,617 ms**, a 178x regression on every
  search, not only ones the dossier can answer. As an uncorrelated InitPlan array the
  side lookup runs once and the key equality joins the BitmapOr: 21.5 ms. The inner
  key is named `t_unp` so the correlated form cannot be written by accident — with two
  columns called `unp`, `WHERE unp = unp` binds both sides to the inner scope, a
  tautology matching every tender that raises nothing.
- **FTS only — deliberately NO gin_trgm index**, unlike every other fold here. The
  `%>` word-similarity arm that 009 pairs with FTS on `subject_fold` recomputes
  trigram sets over the whole body per row, and these bodies are documents: **0.073 ms
  vs 13,490 ms** on 1,861 rows. At corpus scale that arm is minutes, i.e. past the
  10 s `statement_timeout`. The cost is real — no mid-word or near-spelling matching on
  document text.

**Three routes read this family, and one of them has a cache rule that is easy to
undo.** `/api/db/tender-dossier` (the per-procedure page), `/api/db/tender-document`
(the signed-URL redirect) and `/api/db/tender-search-coverage` all ship with
`npm run deploy:db`.

**A loader that applies 147 MUST reach the serving database BEFORE the `deploy:db` that
ships these routes** — either `db:load:tenders:pg:cloud` or
`db:load:tender-dossier:pg:cloud`, both apply it. Deploying first is a **500** on every
`/procurement/tenders` search keystroke and every `?q=` deep link, not a narrower
answer, because `db_table.js` reads the table unconditionally and `badRequest()`
rethrows anything that is not a `DbRequestError`. The other two routes impose no
ordering of their own: `tender-dossier` catches 42P01 → `null` and
`tender-search-coverage` degrades to nulls.

`/api/db/tender-document` carries **`"Cache-Control": "no-store"` in `firebase.json`**,
and its entry must sit **AFTER** the `/api/db/**` rule — Firebase applies the **LAST**
matching header, so placed before it the `no-store` is dead config and the route
silently inherits `max-age=300, s-maxage=3600`. (That is not hypothetical: it shipped
that way and was caught by review. The global `**` rule sitting at index 0 with
`no-cache` is the independent proof of the direction — first-match-wins would make
every asset on the site uncacheable.) The register's blob URLs are S3v4-presigned with
a **30-minute expiry**, so a cached redirect is a link that works when it is written
and 403s later — the failure arrives long after the deploy that caused it. The
function cannot fix this itself: a hosting `headers` rule overrides a function-set
`Cache-Control`, which is why the header lives in `firebase.json` rather than beside
the route. `firebase_person_rewrite.test.ts` holds the order.

Related, from the same step and applying to **every** DbDataTable: the free-text arms
now escape `%` and `_`. They are LIKE wildcards, so before this any user typing one
turned the search into a scan of everything — measured, `50%_x` on tenders was
**11,672 ms** end to end, past the `statement_timeout`, of which 8,256 ms was
`buyer_fold ILIKE '%50%_x%'` — a pattern the trigram index can extract nothing usable
from, so it returns all 237,321 rows as candidates and the heap recheck then discards
236,496. Now 188 ms. The `searchFold`
arms escape in SQL rather than in JS, because their text is produced server-side by
`translit_bg_latin` and a JS-side escape would be undone by the transliteration.

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

**It gained a THIRD denormalized column, `person_link_n`, and a THIRD trigger with it.**
That column counts DISTINCT public figures holding a gated registry role at each company —
`person_role(tr,ngo)` ⨝ `person(active, is_public_figure)` — and it is what
`place_mp_companies()` (151) filters on. So this loader must now also run **after
`db:resolve:persons`**, which is what rebuilds `person_role`; `refresh_coverage.test.ts`
carries the pair, and the local chain already ordered it that way.

⚠️ **`person_link_n` is NOT `political_n` widened, despite reading like it.** `political_n`
comes from `company_politicians` (008), which is built from `mp_connected`/`pep_connected` and
therefore MONEY-restricted: **113 companies at 43 places**. `person_link_n` is the whole gated
identity layer: **10,202 companies at 1,332 settlements / 260 municipalities**. Gating anything
on the first while the page filters on the second is a live defect that already happened once —
the tile's link to `/settlement/:id/companies` was hidden on 218 of 260 municipalities and
1,290 of 1,332 settlements that HAVE a page, and one place (ekatte 80217) had a political link
with an empty page. `place_companies()` therefore returns BOTH counts and the tile reads
`personLinkCount`.

### The two MP↔company serving functions, and the shard families they retired

`mp_tr_roles(mp_id)` (migration 150, `/api/db/mp-management`) and
`place_mp_companies(ekatte, obshtina, page, pageSize)` (migration 151,
`/api/db/place-mp-companies`) replaced three bucket-served shard families —
`parliament/mp-management/` (896 files), `companies-by-ekatte/` (376) and
`companies-by-obshtina/` (270). Plan: `docs/plans/mp-tr-edges-pg-v1.md`, revised by
`data-hub-lateral-edges-v1.md` §11.10.

**Neither is a table and neither has a loader** — they are "applied, never loaded", and their
appliers are chosen so a corpus reload carries them: **150 rides `db:resolve:persons`**
(SCHEMA_FILES, after 148) and **151 rides `db:load:tr-company-place:pg`** (after 133, which
owns the column it reads). Both were written without an applier first, which is the migration-144
defect: `db:refresh` then fails at its final `test:data` step on any database not hand-patched,
and no cloud path ships them at all. Ship a body change on its own with the usual hatch:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts \
  148_person_company_basis.sql 150_mp_tr_roles.sql 151_place_mp_companies.sql
```

**148 must be in that command and first**: 150's body joins `person_company_bridge_a`, and a
`LANGUAGE sql` body is validated at CREATE time, so applying 150 to a database without the view
fails the whole file with 42P01 — the 081→082 trap again.

Cloud side, in order — nothing here is automatic:

```bash
npm run db:resolve:persons:cloud            # applies 150
npm run db:load:graph:pg:cloud              # company_public_money → money_eur, 151's sort key
npm run db:load:tr-company-place:pg:cloud   # applies 133 + 151, fills person_link_n
npm run deploy:db                           # the two routes
npm run deploy                              # ⚠️ NOT optional — see below
```

⚠️ **`npm run deploy` is the step that actually retires the shards, and leaving it out inverts
the point of the whole change.** The hooks were repointed in the bundle; until hosting ships
that bundle, production keeps fetching the bucket copies and keeps publishing the 410
attributions the person layer refuses. `deploy:db` alone changes nothing a reader sees.
**[2026-08-16] This has since been deployed AND the three trees removed from the bucket**
(`gsutil ls` → "matched no objects"), so the hazard is historical — kept because the ordering
rule it teaches is not.

**Ordering `deploy:db` before the loaders is cosmetic but not free.** Both routes degrade a
missing migration — and they use the NON-logging `missingMigration` variant, unlike the
`psp:`/`pp:` routes, so a premature deploy reads as „this MP holds no registry roles" and „no
companies here" indefinitely, with nothing in the logs and nothing red.

**Both refuse a shared name rather than grading it, and that is the whole point.** Neither
function re-implements a guard: both read `person_role` at source tr/ngo, the set
`resolve_persons` mints through Bridge A/B and gates on `tr_name_fold_people` (148). So a name
the Commerce Registry records for more than one person is refused — the shards published 410
such (MP, company) attributions, of 2,014, while `/persons` and the `/person` profile had
already stopped. `MpManagementRoles` and `PersonCompanies` are the two
surfaces that list one person's companies — mutually exclusive branches of `CandidateScreen`
rather than literally one page, but a reader reaching the same person by either route must not
be told two different things. That is why 150 derives from `person_role` rather than minting its
own set, and why both render the basis from the same `person_company_bridge_a` view.

⚠️ **`COMMON_NAME_TR_ROWS = 11` was DELETED, not ported.** It counted officer ROWS as a proxy
for "is this name one person", and it is wrong in both directions — it dropped a rare-name MP's
whole medium set behind one busy registered agent, and passed a name held by two people with six
companies each. Do not reintroduce a row-count heuristic beside a people count.

⚠️ **[2026-08-16] Those bucket objects are GONE — this paragraph used to say they were not.**
`gsutil ls` returns "matched no objects" for all three trees, so the `rm` the exclusion site
described as pending has been run. The mechanism it documents is still true and still the reason
an exclusion is never a retirement: `gsutil rsync -x` excludes a match from DELETION as well as
upload, and `syncPaths` passes `-x` with `-d`, so an exclusion FREEZES a tree and removing it is
always a separate operator action. What is frozen NOW is listed at the exclusion site in
`scripts/bucket_sync_paths.ts`.

The state-budget corpus (migrations 152 + 153, `db:load:budget:pg`) is the КФП execution feed,
its per-fiscal-year roll-up, the admin/programme reconciliation, personnel, COFOG and the
budget-document index. Plan: `docs/plans/budget-hub-v1.md` T1.

```bash
npm run db:load:budget:pg:cloud
```

**It is a `REFRESH_EXCLUSIONS` member, and the axis is the INPUT, not the cost.** The admin and
programme grain lives in `data/budget/reconciliation/` and `data/budget/ministries/`, both
gitignored (bulky regenerable shards, bucket-shipped only) — measured, `git ls-files` returns 0
for each against 24 and 55 files on a machine that has run the pipeline. The load itself is
~2 MB and seconds. Run it from the `update-budget` path, by hand.

Four things about it are easy to get backwards:

- **It is NOT the only applier of 152/153.** `db:load:budget-muni:pg` is in the chain and
  applies `152 → 153 → 154 → 157 → 155` in that order (155's `LANGUAGE sql` bodies are
  validated at CREATE, so anything else 42P01s and rolls the file back). A fresh clone
  therefore HAS the budget tables, EMPTY — this excluded loader is what fills them, both the
  gitignored admin/programme grain and the committed КФП half. `budget_pg_roundtrip.data.test.ts`
  skips on that empty state; its `pg_class` probe covers the narrower case of a hand-built or
  partial database with no tables at all. `refresh_coverage.test.ts` holds the in-chain applier
  and its order. (This bullet claimed the opposite until 2026-08-15, having been written before
  T2/T3 shipped the second applier.)
- **The merges REFUSE a >5% shrink** (`--allow-shrink` overrides). `mergeFromStage`'s delete is
  an unscoped anti-join and its parity guard compares counts AFTER that delete, so an empty
  stage wipes the corpus and passes 0 == 0. Measured: an empty admin stage removes 55 nodes,
  873 facts (via `ON DELETE CASCADE`, so they are not even in the DELETE's count) and 727
  programme rows, with the loader exiting 0.
- **`budget_program_fact.node_id` is the OWNING SPENDING UNIT, and `program_code` is the
  programme.** `by-program.json` keys its rows on a `prog-…` slug and names no owner — 0 of 86
  join `budget_admin_node` — so the owner is recovered from `data/budget/ministries/`
  (727/727 rows, 124 programmes, 0 ambiguous). NULL means that gitignored tree was absent, not
  that the programme has no owner.
- **`budget_cofog` is a DIFFERENT CORPUS from the rest** — Eurostat `gov_10a_exp`, sector S13
  general government, which includes municipalities and the social funds. It is NOT a
  decomposition of the КФП state-budget expenditure it will be rendered beside.

`council_muni` / `council_muni_code` / `council_resolution` / `council_vote` (migration 160,
`db:load:council:pg`) are the municipal-council corpus behind the My-Area council tile, the
My-Area alerts feed and the AI chat's `councilResolutions` tool. In `db:refresh` after
`db:load:official-candidate-links:pg`; on the cloud side:

```bash
npm run db:load:council:pg:cloud
```

**Its input is the DURABLE per-resolution shard tree** (`data/council/<code>/<YYYY>/<id>.json`,
4,676 files, COMMITTED) — deliberately not `index.json` (capped at 200 rows per município, and six
of sixteen exceed it) nor `votes/*.json` (rebuilt from that capped, `perCouncillor`-stripped index
until 2026-08-16, which left 530 resolutions and 10,754 named-vote rows on disk and unserved). The
tree being committed is why this loader is in the chain proper rather than `REFRESH_EXCLUSIONS`.

Four things about it are easy to get backwards:

- **It is UPSERT-ONLY and must stay that way.** A council resolution is a permanent public record,
  so a scrape that misses a protocol — or a parser regression on one município — must not erase
  history; `last_seen_at` records the absence instead. `mergeFromStage` is therefore NOT used (it
  couples an unscoped anti-join DELETE to the upsert). The one deletion the loader performs is a
  targeted purge of `norm_key ~ VOTE_LABEL_SOURCE`, a provable invariant violation — 840 PER32 rows
  where the parser absorbed the vote label into the councillor's name.
- **`roster_code` is NOT `obshtina_code`, and conflating them attaches votes to the WRONG council.**
  This corpus's `BGS01` is Бургас, but `official_roster` holds a DIFFERENT município under `BGS01`
  (28 councillors, disjoint names) — Burgas city is roster `BGS04`. Sofia is council `SOF` → roster
  `SFO_CITY`. The loader derives it via `rosterShardForObshtina()` and **refuses** rather than
  guessing when a council resolves to more than one roster.
- **The name fold has ONE definition, `councilNameKey()` in `scripts/council/lib/tally.ts`**, and
  both sides must use it. It was briefly written twice — TS on the vote side, `lower(split_part(…))`
  in SQL on the roster side — and the two diverged on `й`→`и` (NFD) and on hyphens, costing 4,899 of
  28,214 votes their attribution AND evaluating the "refuse a shared name" guard over a different
  equivalence class than the join used, which can attach a vote to the wrong person. Attribution is
  **94.1%**; a run reporting ~77% means the folds have drifted apart again.
- **`db:resolve:persons` nulls `council_vote.person_id` table-wide** (ON DELETE SET NULL, because
  `person_id` is a positional ordinal and the resolver does DELETE + re-COPY), so this loader must
  run AFTER it and is what re-attaches attribution — the declarations `--resolve` trap, one table
  over. The loader carries a 90% attribution floor that refuses rather than republishing a corpus
  with its attributions wiped (`--allow-attribution-drop` overrides); its roster input,
  `official_roster`, has exactly one writer, `db:load:ngo-board-links`, which degrades to NULL
  `obshtina` on a clone with no municipal shards.

`municipal_fiscal` (migration 149, `db:load:municipal-fiscal:pg`) is the per-município
quarterly financial-indicators corpus (ЗПФ чл. 130г ал. 2) — 265 общини × quarter, carrying
the three liability stocks Bulgarian public finance distinguishes and the site previously
collapsed into one. In `db:refresh` right after `db:load:place-dim:pg`; on the cloud side:

```bash
npm run db:load:municipal-fiscal:pg:cloud
```

**`db:load:place-dim:pg:cloud` is a hard PREREQUISITE, not merely a trigger.** Two of 149's
three serving functions JOIN `place_dim`, and a `LANGUAGE sql` body is validated at CREATE
time —
so applying the migration to a database without it raises `42P01`, and because `exec()`
sends the file as ONE transaction the target gets **no `municipal_fiscal` table at all**,
not merely unlabelled rows. `refresh_coverage.test.ts` carries the pair for the local chain;
nothing covers the cloud side.

Five things about it are easy to get backwards:

- **It also owns `obshtina_population`**, the NSI Census 2021 per-município
  denominator behind the per-resident default sort on
  `/governance/municipal-finance` and the rank on every governance dashboard.
  Built from the committed `data/census_2021.json`, so it needs no fetch — but
  it resolves Sofia's census code `SOF46` through **`place_dim.price_code`**,
  which makes `db:load:place-dim:pg:cloud` a prerequisite for its CONTENT and
  not merely for the JOIN to compile. The loader REFUSES rather than degrades on
  an incomplete match: an unresolved município would sort last on the page that
  exists to surface it. Related, and the reason 149 declares that table at the
  TOP of the file: a `LANGUAGE sql` body is validated at CREATE time, so a
  function created above the table it reads raises 42703/42P01 and — exec()
  sending the file as one transaction — rolls the whole migration back on every
  database that does not already have it, i.e. everywhere except the machine
  that wrote it.
- **The corpus has TWO consumers, and the loader is only one of them.** It also feeds three
  NATIONAL series in `data/macro.json` — `municipalCommitments` /
  `municipalExpenseObligations` / `municipalArrears`, behind the `/indicators/fiscal`
  commitments tile — built by `scripts/macro/municipal_stocks.ts`. `fetch_eurostat.ts` is
  the durable writer (it pushes them onto `CURATED_INDICATORS`, so a macro refresh carries
  them), and `npm run macro:municipal-stocks` folds them into an existing `macro.json` when
  the corpus moved and nothing else did. A new quarter that reaches only the PG loader
  leaves `/indicators/fiscal` a quarter behind at a 200 — `macro.json` is bucket-served from
  the committed file, so nothing about the database refreshes it. Note the assembler's
  10%-shrink regression gate exempts these three by RATIO (`MAY_SHRINK`) but not at zero:
  losing a quarter is designed behaviour here — МФ freezes a column and the ingest withholds
  it rather than carrying it forward — while dropping to no points at all still aborts.
- **The corpus is the LOADER'S input, and the fetch half is manual.**
  `data/budget/municipal_fiscal/*.json` is committed and the loader is pure-load (works on a
  fresh clone, no network). What produces it is
  `scripts/budget/municipal_fiscal/ingest.ts`, which reads the **gitignored**
  `data/_cache/minfin_municipal_fiscal/` workbooks — minfin.bg serves an interactive
  Cloudflare Turnstile, so downloading them is an operator action. See that directory's
  README for the exact filenames.
- **It is NOT bucket-synced, and that took FOUR exclusions, not one.** There are three
  independent upload paths into `data/budget/`, and an exclusion on any one of them leaves
  the other two shipping the corpus:
  1. `bucket:sync` / `bucket:sync:dry` — a `gsutil rsync -x` regex; needs its own
     `^budget/municipal_fiscal/.*` arm beside the `funds/` and `opencalls/` ones.
  2. `bucket:sync:paths -- budget` — `isExcluded` guards only the top-level ARGUMENT, so the
     scoped push walks into the subtree; that needs the `CHILD_EXCLUDES` twin.
  3. `npm run budget:ingest -- --upload` — the `update-budget` step, which `gsutil cp -r`s
     the whole tree. `gsutil cp` has no `-x`, so `uploadTextTree` now expands the top level
     itself and filters through the SAME `isExcluded`.

  All four live in `scripts/bucket_sync_paths.ts` + `scripts/lib/upload.ts` and read one
  definition. Removing any of them puts a second copy of a PG load source on a bucket
  nothing reads — the shape that once pushed ~16.8k company-connection shards.

- **`meets_threshold` is NULL on almost every row WITHOUT an official verdict, and that is
  correct.** The statute has **SEVEN** criteria, not six — МФ's year-end-anchored releases
  enumerate them 1..7 and `scripts/budget/municipal_fiscal/criteria.ts` reads them, so on the
  year-ends those releases cover (2018, 2020, 2021, 2023, 2024 today) the verdict is the
  ministry's and is decisive in BOTH directions. Elsewhere only three of the seven are
  computable from this source — т. 1 needs debt SERVICE
  (the workbook publishes only the debt STOCK), т. 5 three consecutive years, т. 6 the
  national collection mean. `criteria_evaluable` records which were checkable, so „2 met"
  cannot be read as „2 of 6". A verdict is TRUE only when three are actually met (decisive
  by monotonicity, whatever the unchecked ones say) and FALSE only when all six were
  evaluable. Measured 2026-08-12: 5 municipalities decisive TRUE, and all 5 are
  independently on the official чл. 130д recovery list.

`interreg_programmes` / `interreg_operations` / `interreg_partners` (migration 137,
`db:load:interreg:pg`) are the Interreg cross-border corpus — 1,958 operations, 12,015
partnerships, 1,494 Bulgarian partner rows, €401.77m — from keep.eu (INTERACT), which is
where Interreg lives because it runs on **Jems** and not on ИСУН. That is why
`fund_projects` holds zero Interreg rows: the gap is a system boundary, not a filter.
In `db:refresh`; on the cloud side:

```bash
npm run db:load:interreg:pg:cloud
```

**Its re-run triggers are wider than its own source**, and two of the three are the
non-obvious ones. Place resolution happens IN THE LOADER (Tier L1 reads `awarder_seats`,
L2 reads `tr_company_place`), so 199 of the 1,469 placed rows depend on the _content_ of
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

**`/funds/interreg/**`is a page URL served by the`db` function** (`functions/spa_page.js`),
like `/funds/contract/**`and`/company/**` — so the same ordering rule applies and it is the
one that breaks a working page: **`npm run deploy:db`BEFORE`npm run deploy`**. Hosting
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
- **Only the ИСУН arm is a matview.** `funds_fit_interreg()` is a plain function — 1,958 operations
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
not one**: the quote occurs in the extracted text (a plain normalised substring), _and_ the quote
states the value. A field failing either is dropped and reported. Nothing about that guarantee
comes from trusting the model.

The second check is the one that looks redundant and is not. Checking the citation is not
checking the claim: with only the substring test, a fabricated `budget_eur: 999 000 000` attached
to a real unrelated sentence from the document passed with no rejection, and so did a 100×
magnitude error (`aid_rate_pct: 0.6` cited from „…60 %…"). Both are the shape a model produces
when it answers from memory and then hunts for a sentence to cite. Neither check can judge
whether the quoted sentence is the _right_ one — a sub-component's „максимален размер" cited
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
JSON is missing), so it sits in `db:refresh` — but only this manual flow ever _fills_ the
table.

`nzok_casemix_expected_vs_actual()` (migration 059) is the per-hospital case-mix signal behind
`/api/db/nzok-casemix-by-eik` and the case-mix line on `NzokReportCardTile`. It divides what
НЗОК actually paid a hospital by what the НРД list price says its OWN case mix should have
cost.

**It is a FUNCTION, so no `db:load:*` ships a body change** — the tariff loader applies 059,
but a guard fix must not wait for a tariff reload. Ship it with the usual hatch, then
`deploy:db` (the route) and `deploy` (the tile copy):

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 059_nzok_pathway_tariffs.sql
```

Two guards suppress the RATIO (never the whole payload) and name the reason, so a surface can
say WHY instead of dropping the row. Both conditions LOOK like a cheap hospital:

- **`partial-payment-year`** — the numerator is summed over the payment months the corpus
  holds. The floor is the YEAR'S OWN full complement, **never a constant**: the payment
  corpus holds 9 months for 2023, 12 for 2024, 11 for 2025 and 6 so far for 2026, and since
  the activity corpus went multi-year the year this reads is not fixed. A hard 11 would
  suppress every hospital in 2023 or 2026. `fullYearMonths` rides in the payload so copy says
  „4 of 11" rather than implying twelve.
- **`low-tariff-coverage`** — `expected` only counts cases whose procedure has a tariff, so
  below 80% it compares against too little of the hospital's work.

Measured on 2025: 236 published, 6 `no-payments`, 3 partial-year (including the
€1.1-per-case facility — 4 months of payments against 1,646 cases), 3 low-coverage.
`nzok_casemix_guards.data.test.ts` holds the invariant (`ratio` NULL iff `suppressed`), the
derived floor, non-vacuity, and a ceiling on how much the guards may swallow. **No ranking is
published** — the ratio appears on one hospital's own card, never as a league table.

`agri_subsidies` + `agri_payloads` (migration 046, `db:load:agri:pg`) are the ДФ „Земеделие"
farm-subsidy corpus behind `/subsidies` and `/farm/:eik`. The loader is the pure-LOAD half of
the fetch/load split: it reads only the **gitignored** `raw_data/agri/` cache (egov year sheets

- СЕУ CSVs) — on a fresh clone it skips-and-warns; on a PARTIAL cache it throws rather than
  publish a corpus missing a financial year. Publishing to prod:

```bash
npm run db:load:agri:pg:cloud
npm run db:load:agri-hub-stats:pg:cloud   # the /subsidies hub cache — see below
```

**`db:load:agri-hub-stats:pg` is a SECOND, much cheaper loader for the same corpus, and it
has its own trigger list.** It applies migration 162 and rebuilds `agri_hub_stats_cache`, the
scope-keyed matview behind `/api/db/agri-hub-stats` and every figure on the `/subsidies` hub —
**5.9 s**, against the 5m44s the full agri ingest takes. `db:load:agri:pg` also applies and
refreshes 162, so a corpus reload carries it; this exists because the cache has FIVE inputs and
the agri ingest owns one:

| input                              | filled by                |
| ---------------------------------- | ------------------------ |
| `agri_subsidies` / `agri_payloads` | `db:load:agri:pg`        |
| `person_role`, `person`            | `db:resolve:persons`     |
| `fund_projects`                    | `db:load:funds:pg`       |
| `contracts`                        | `db:load:pg`             |
| `budget_muni_transfer`             | `db:load:budget-muni:pg` |

Re-run it after **any** of those. `db:refresh` runs it at step 56, after the person chain, for a
reason worth knowing: the agri ingest is step 14 and `db:resolve:persons` is step 45, so the
cache the ingest builds is always one vintage behind on the political arm — and on a FIRST run,
against a person layer `081` has just created empty, that arm is not stale but **zero**, which
is a claim („0 фирми") rather than an absence. The loader warns when it sees that state.

⚠️ **The agri ingest is now a second applier of `081_person_identity.sql` and
`154_budget_municipal.sql`.** `CREATE MATERIALIZED VIEW` resolves its query at creation, so 162
cannot compile against a database where `person_role` or `budget_muni_transfer` is absent — and
on a cold `db:refresh` both are created after step 14. Applying their DDL first (the pattern
`load_graph_pg.ts` uses for 137) is what keeps a fresh clone's chain alive; both files are
`CREATE TABLE IF NOT EXISTS` throughout, so it is idempotent and free on a warm database.
`contracts` and `fund_projects` are guaranteed by chain ORDER instead, and preflighted — a
missing one skips the migration with a warning rather than aborting the load.

Run the base loader after any `raw_data/agri/` refresh (a new egov financial year, or a fresh
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
_before_ (`db:refresh` orders `db:load:tenders:pg` ahead of `kzk:rejoin`; `load_tenders_pg`
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
~90-minute full contracts reload. Without this, prod keeps two orphan matviews for ever:

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
  away from `/procurement/contracts` with nothing failing;
- **after a `db:load:tr:pg[:cloud]`** — the matview reads `tr_officers` for its company
  counts. Until 2026-08-10 this was invisible for the worst possible reason: 003's
  `DROP TABLE … CASCADE` _deleted_ the matview on every TR load rather than staling it (see
  the CASCADE note in "SQL functions and indexes" below). 003 no longer drops, so what is
  left to close is ordinary staleness — and this is the loader that closes it.

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

**`db:load:magistrates:pg[:cloud]` is a fourth trigger, and it is the one the list above reads as
somebody else's problem.** The other three name a table this loader reads DIRECTLY; a magistrate
roster reload reaches it only transitively — magistrates → `db:resolve:persons` → persons-browse →
here — so nothing in the chain looks like a person_search dependency. It is: since 070's
`magistrate_search()` was retired, `person_search` is the ONLY surface that makes a magistrate
findable by name, and the whole point of the roster retention (6af09bd0c6) is that a magistrate who
leaves the ИВСС register stays findable. Measured 2026-08-11, mid-change: **393 of the 460 retained
magistrates were missing from `person_search` while all 460 were already in `person_browse_table`** —
the retention's own purpose defeated, at a 200, with every row count reconciling. Re-run this loader
after any magistrate reload, on both sides.

`person_crypto_table` (migration 159) is the declared-CRYPTO register behind
`/declarations/crypto` and the `crypto_holdings` DbDataTable resource. It has **no loader of
its own** — it is a fifth victim of 090's `DROP MATERIALIZED VIEW person_wealth_year CASCADE`,
so `load_declarations_pg.ts` applies it in phase 2 right after 120, and its `CREATE … AS`
populates it. On the cloud side it therefore rides:

```bash
npm run db:load:declarations:pg:cloud -- --resolve
```

**First deploy is ORDERED, and getting it wrong is a 500 rather than a narrower answer.**
The registry engine reads the base relation unconditionally (same shape as `cpv_catalog` /
`contractor_rank` — there is no `missingMigration` degrade on a DbDataTable resource), so a
`deploy:db` that ships `crypto_holdings` before the loader has reached the target 500s every
request to `/declarations/crypto`. Loader first, then `deploy:db`, then `deploy`.

Three things about it are easy to get backwards:

- **It joins through `person_wealth_year`, and that is a CORRECTNESS property, not a
  convenience.** A holding is re-declared on every filing that covers it — Борис Михайлов's
  500,000 BUSD sits on both his 2023 годишна and his 2023 при-напускане — so summing the raw
  `declaration_asset` rows reads **€1,960,489 against a true €1,649,180**, a 19% overstatement
  on a page whose entire content is a number beside a person's name. 090 already picks ONE
  declaration per (person, period_year); joining through it is what stops this register
  becoming a fifth opinion about which filing counts.
- **The `scope` fan-out needs its `defaultScope`** (`latest`), exactly as `mp_cars` does. An
  unscoped query is otherwise the UNION of the `latest` and `all` buckets, which serves that
  double-count with the `count` and `sum` aggregates inflated to match and nothing erroring.
- **The classifier is `is_crypto_asset()` in 090, beside `asset_share_multiplier`, and it has
  NO TypeScript twin — do not add one.** Every consumer is server-side. It classifies by RULE
  ("the declared unit is not money") rather than by a ticker allowlist, so a new coin
  classifies itself; the price is that a new FIAT spelling would publish a bank balance as
  crypto, which `declared_crypto.data.test.ts` closes by requiring every distinct non-fiat unit
  in the corpus to be classified deliberately. The register is full of Cyrillic homoglyph
  typos (`ЕUR`, `ВGN`, `УСД`) and hand-typed units (`шв. фр.`, `ФЖХ` — a BGN mistype, provable
  because its €/unit is exactly the peg), so that gate is load-bearing. Note the precious-metal
  carve-out matches on EXACT equality: `PAX Gold` is a gold-backed TOKEN and must stay crypto,
  while `XAU` / `инвестиционно злато` must not.

Plan: `docs/plans/declared-crypto-v1.md`.

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

Skipping it after a _place_ loader blanks the same way `/person` does — the loader itself
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

**The `/en` person titles carry a BUILD-TIME dependency on two committed data files**, the
same shape as the `/court/**` one above and quieter still. `scripts/prerender/placeNameEn.ts`
resolves every English place name from `data/municipalities.json` + `data/settlements.json` at
build time; a missing or unparseable file degrades to transliteration, which is valid Latin
and therefore passes the "no Cyrillic" gate — 455 places (436 settlements + 19 municipalities
whose curated `name_en` differs from the transliterated form) silently change spelling in
indexed titles with nothing red. It warns on stderr; that warning is the only signal.

That module is also a **second producer of a label `place_dim` already owns**, against the
explicit "keep it that way" in `scripts/person/places.ts`. It has to be — the prerender is a
Node build step with no database, while the runtime reads `place_dim.name_en` through
`082_person_api.sql` — so the SAME page resolves the English place name twice, once per side
of hydration. `placeNameEn.test.ts` fails if the two dictionaries disagree on any shared code.
The single-producer fix is `pd.name_en` on the prerender card (the locals query in
`emit_prerender_slugs.ts` already `LEFT JOIN place_dim`), and it takes effect only at the next
`person:slugs:cloud` mint — the manifest is committed, so a card field changes nothing until
the file is re-minted from the serving database.

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
does NOT carry it — that ships function _code_ in `functions/`, which is a different thing
from a Postgres function.

**Both appliers of a DROP…CASCADE chain now carry a collateral-drop guard, and the loader's
fires on ABORT.** `scripts/db/lib/collateral_drop.ts` snapshots public relations either side
of an apply and reports any that vanished while some schema file still CREATEs them (so a
tombstoned retirement is silent). `apply_functions.ts` runs it as a post-condition and exits
1; `load_declarations_pg.ts --resolve` runs it in a **`finally`** around its 090 → … → 159
chain, then rethrows.

The `finally` is the load-bearing part. 090's CASCADE takes five relations that are
recreated later IN THE SAME RUN, so an INTERRUPTED run is the failure mode — and `exec()`
sends each file as its own transaction, so the CASCADE has already committed and there is
nothing to roll back. Measured on Cloud SQL 2026-08-19: a resolve got through 090 and 097
and died before 100, leaving `/persons`, `/officials/assets`, `/mp-assets` and
`/declarations/crypto` at 500 with nothing logged. **The survivor set is what dates it** —
`person_cohort_wealth` present and everything from 100 onward gone means the run stopped
between them; reproduced exactly by injecting a failure into 100.

A post-condition that only fires on SUCCESS is blind to precisely that case, which is why
this one does not.

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

**CASCADE is the same rule with the failure mode inverted, and it is the more dangerous
half.** A DROP without CASCADE REFUSES — 2BP01, loud, the loader aborts. A DROP _with_ CASCADE
SUCCEEDS: it deletes the dependent and the loader exits 0, with nothing in its output and no
row count reporting the loss, because the counts that would move belong to a relation that no
longer exists. `003_tr_search.sql` did exactly that from the start — `DROP TABLE IF EXISTS
tr_companies CASCADE` (and the same for `tr_officers` / `tr_person_roles`), applied by
`load_tr_pg.ts` on **every** run — so every `db:load:tr:pg` deleted three matviews owned by
other migrations:

- **`person_browse_table` (120)** — the ENTIRE `/persons` browser
- **`declaration_stake_company` (096)** — the conflict-of-interest surface
- **`company_officer_counts` (071)** — read by `magistrate_politician_links()` and by 099

Same self-healing accident as 077: `db:refresh` sequences `db:load:persons-browse:pg` after
`db:load:tr:pg`, so a full local refresh hid it. The exposure is the **standalone
`db:load:tr:pg:cloud`** — the documented routine TR publish, which the sections above tell you
to run after a contracts/agri/funds reload and which `update-persons` / `update-procurement`
both invoke — which would drop `person_browse_table` on Cloud SQL with nothing there to
recreate it, serving `/persons` empty until someone happened to run
`db:load:persons-browse:pg:cloud`. (Checked 2026-08-10: prod holds all three, populated, and
their OIDs sit above the last TR load's, so nothing is currently orphaned there.) The same
CASCADE also ran on every local `npm run tr:daily-refresh`.

The fix is the one 077 took, adapted: **003 no longer DROPs anything.** `load_tr_pg.ts`
replaces the four tables' CONTENTS instead (`replaceTable` — TRUNCATE inside the COPY's own
transaction) and drops/rebuilds the eleven secondary indexes itself, which is what the DROP
TABLE used to give it for free. Three consequences worth knowing:

- **That TRUNCATE is a MEASURED lock regression, not a neutral swap** — 50 of 180 concurrent
  probes rejected with `55P03` across a live load. Do not read it as "readers keep the
  previous vintage": they are rejected for the duration. The old scheme did NOT block readers
  (`exec()` wraps a migration in one implicit transaction, so the DROP+CREATE committed
  atomically and the COPYs then took only `RowExclusiveLock`) — what it served instead was an
  EMPTY table at a 200 for the length of the load, i.e. search confidently answering "no such
  company". An error a route can degrade on beats that, which is why the trade was made, but a
  cloud TR publish is **not** reader-safe: it is 34.9 min. Paid off by Phase 4b in
  `docs/plans/cloud-deploy-speed-v1.md` (F21), which also records that an INTERRUPTED load
  used to leave the tables populated but unindexed — the index drops now live inside each
  table's own transaction, so an abort rolls them back.

- **Every column in 003 is written twice, on purpose.** `CREATE TABLE IF NOT EXISTS` is a
  no-op on a warm database, so on its own it would trade the loud data loss for a quiet schema
  drift — a new column reaching a fresh clone and nothing else. The reconcile block at the
  foot of 003 (`ADD COLUMN IF NOT EXISTS`) is what actually reaches a warm database, and
  `tr_search_shape.test.ts` fails when the two lists disagree. A TYPE or GENERATED-expression
  change still needs a hand-written ALTER there (142 has a worked example).
- **The dependents now go STALE rather than missing**, which is the point. The loader refreshes
  `declaration_stake_company` and `company_officer_counts` itself (both guarded on existence);
  `person_browse_table` is deliberately left to its own loader — so **`db:load:tr:pg[:cloud]`
  joins the trigger list for `db:load:persons-browse:pg[:cloud]`** below.

`migration_drop_dependents.data.test.ts` is the generic gate for the whole class: it reads
every `DROP` in `scripts/db/schema/pg/*.sql`, resolves each surviving target's stored-query
dependents through BOTH the `pg_rewrite` and `pg_proc` arms, and fails on any dependent owned
by a different file. Three pairs are sanctioned there **with their reasons** — `person_wealth_year`
(090, whose four victims are all re-applied by `load_declarations_pg.ts` on the same path),
and `appealed_ocids` / `upheld_ocids` (042, whose `contracts_list` is rebuilt by 042 itself and
whose `risk_upheld_ocid` is recreated inside `rebuild_contract_risk_cache()`). Anything else is
a defect. It also asserts the CASCADE is genuinely silent, so the gate cannot go vacuous.

**The reason nothing caught it is worth generalising: `db:refresh`'s only verification is its
LAST step.** `test:data` — which includes `pg_roundtrip.data.test.ts`, whose row-count assert
compares Postgres against the shards and would have failed on exactly this drift — sits at the
end of a 57-link `&&` chain whose fifth link was the one aborting. An early loader failure
therefore leaves the whole suite unrun, so the corpus that a loader failed to update is never
checked. When a loader aborts, run `npm run test:data` before assuming only that loader's
table is affected.

**`asset_share_multiplier()` (090) is another, and it is the one whose absence is
INVISIBLE.** A declared property's price is the WHOLE property — Сметна палата filing
instructions, table 1 col 11: „Посочва се цената на придобиване на имота/правото В ЦЯЛОСТ
… БЕЗ ДА СЕ ДЕЛИ МЕЖДУ СЪСОБСТВЕНИЦИТЕ" — and col 8 requires each co-owner on a SEPARATE
row repeating that same price, with only household members getting one. So a bare
`SUM(value_eur)` counts a jointly-held home once per co-owner. The rule lives twice
because a route cannot import TS: `assetShareMultiplier()` in `src/lib/declarations.ts`
(the JSON rollups behind `/officials/assets`, `/mp-cars` and the MP pages) and
`asset_share_multiplier()` in `090_person_wealth.sql` (`person_wealth_year` and the four
matviews over it). `asset_share_multiplier.data.test.ts` runs both over EVERY
`(share, category)` literal in the corpus rather than a hand-picked list — the column is
free text with ~3,200 spellings.

Three things about it are easy to get backwards:

- **A one-time 13–20% drop is the FIX, not a regression.** Measured 2026-08-15: executive
  −16.1%, municipal −19.9%, MPs −13.3%, `/mp-cars` €8,241,472 → €7,109,059. Both skills'
  troubleshooting tables name it, because `update-officials` previously told an operator
  that a >20% drop meant a category-filter regression.
- **`security` is NEVER weighted.** On the table-9/10 forms that cell is a COUNT of дялове
  („369 476"), not a fraction; weighting it would multiply a shareholding by its own share
  count. Nor are `debt` rows — the multiplier is a constant 1 there and is deliberately
  written out rather than applied for symmetry.
- **Anything not an unambiguous proper fraction returns 1**, which is the safe direction.
  „СИО", „по 1/2", „1/2-1/2" and „1/2+1/2" each already state the household's WHOLE
  holding on one row; a bare „50" is unreadable as either a percentage or an ideal part;
  „0" would zero a real asset. ~19% of declarants divide the price among co-owners anyway,
  against the instruction, and are therefore UNDER-stated — kept deliberately, since it is
  undetectable on a single-row holding.

Related, and the same shape one layer down: **`perSqmAnchor()`
(`scripts/declarations/parse_declaration.ts`) is the one definition of what a
price-per-m² is measured against** — column 6 (сградата) first, column 5 (парцела) as the
fallback — shared by the parse-time separator-typo detector and
`check_suspicious_values.ts`. Two anchors is exactly how a 36m² villa on a 980m² plot hid:
423,558/m² of building, 15,559/m² of plot. It returns the first USABLE area, not the first
present one, because a column-6 cell sometimes holds an ideal part rather than an area
(75 are fraction-shaped corpus-wide, 2 of them in a table-1 built-area position) — and
committing to one would suppress the plot fallback instead of using it.

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

**`date_basis` (081) and the roles payload (082) ship TOGETHER, 081 first, in one command.**
This is the counter-example to the rule above — it looks function-only and is not. 082's
`person_by_slug` selects `r.date_basis`, and a `LANGUAGE sql` body is validated at CREATE
time, so applying 082 to a database without the column fails the whole file with `42703`:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts \
  081_person_identity.sql 082_person_api.sql
```

Applying 081 on the cloud also runs its backfill (`source='mp'` → `'term'`, 1,522 rows),
which is what makes the office dates appear on prod without a multi-hour re-resolve.

The column has **two** writers and needs both: 081's backfill carries a warm database across
the gap, and `resolve_persons.ts` sets it in the `copyRows` list that rebuilds `person_role`
from scratch. Dropping it from that list is the silent failure — the resolve DELETEs the
table, every basis comes back NULL, and the renderer shows _nothing_ rather than something
wrong, so no page errors and no count moves. `person_role_date_basis.data.test.ts` fails on
a dated role with no basis, on the mp count collapsing, and on `person_by_slug` returning an
MP's terms in a tie order (the profile keeps the first row of a deduped seat, so an
unordered `jsonb_agg` would let the term shown change between two resolves of the same data).

### The visibility map a TRUNCATE-reload throws away — and the one cloud repair it needs

A loader that rebuilds a table with `TRUNCATE` + `INSERT`/`COPY` inside ONE transaction leaves
`relallvisible = 0` **permanently**, so Postgres cannot plan an index-only scan on it ever
again. TRUNCATE mints a new relfilenode with an empty map; every page is then written by a
transaction that has not committed, so nothing can be marked all-visible; and the
insert-threshold autovacuum that fires afterwards runs mid-`db:refresh` where a concurrent step
holds back the xmin horizon — it marks nothing, resets `n_ins_since_vacuum` to 0, and with
`n_dead_tup` also 0 never revisits the table. The fix is `vacuumAfterReload()`
(`scripts/db/lib/pg.ts`), called after the load's COMMIT — never inside `withTx`, since VACUUM
cannot run in a transaction block. The wired tables are listed in
`reload_visibility_map.data.test.ts` — which reads the loaders' own call sites and fails if any
vacuumed table is missing from that list, so the two cannot drift. `shipTable()` vacuums its
destination itself, so a new `TRUNCATE_SQL` entry is covered without touching its caller.

**That gate checks ONE direction, and the other one is the hole this keeps falling through.**
It asserts "every table a loader vacuums is listed here", so a loader that vacuums NOTHING
contributes no names and is invisible to it — which is exactly how `db:load:interreg:pg` went
unnoticed. Its file list is now derived from a glob over `scripts/db/load_*.ts` rather than
hand-maintained (that alone surfaced two more unlisted call sites, `budget_peer_band` and
`tr_name_fold_people`), but deriving it does not close the converse: asserting that needs an
independent source of "this table is bulk-reloaded", and a whole-database sweep for short maps
reports 22 tables today, mostly a few pages each where no index-only scan is worth planning. So
when adding a loader, check the call by hand — nothing will fail if you forget it.

**This is the rare defect that is invisible from every angle a reviewer normally checks**: row
counts reconcile, the corpus is correct, the migration is untouched, and the plan is still
_named_ an Index Only Scan — it just reports `Heap Fetches: <every row>`. Both instances found
so far were found by accident, and the first was initially read as a function-body regression in
a file nobody had edited. `contracts` is the counter-example that locates the cause: it is
stage-MERGEd rather than truncated, and its map survives a reload intact.

⚠️ **Do NOT read that counter-example as "stage-merged tables are safe" — they are not, and
`interreg_partners` is the proof.** All three Interreg tables are stage-merged, and the map
still ends up short: the merge's anti-join DELETE and its UPDATEs leave dead tuples, and
neither autovacuum threshold reaches them — the dead-tuple one is a 20% fraction a few hundred
rows out of twelve thousand never crosses, and the insert-threshold one fires mid-`db:refresh`
under a held-back xmin horizon, marks nothing, resets `n_ins_since_vacuum` and never returns.
Measured 2026-08-15 after an ordinary `db:load:interreg:pg`: `interreg_partners` at **130 of
474 pages (27%)**, 651 dead tuples, `last_vacuum` and `last_autovacuum` both NULL, while
`interreg_operations` happened to get autovacuumed and so looked fine. That broke a committed
gate rather than merely costing time — `funds_fit.data.test.ts`'s "the resolver stays cheap
enough to serve live" failed at **6,251 buffers against its 6,000 ceiling** — and the corpus had
SHRUNK across that reload (12,141 → 12,015 partnerships), so the extra buffers were bloat and a
stale map rather than data growth, which is why no row count reported it. What `contracts`
actually shows is that a big, continuously-autovacuumed table survives; size and traffic are
doing that work, not the merge shape. Wire the call regardless of shape.

**A bare `ANALYZE` is not half the fix — it is the disguise.** `db:load:graph:pg` ran
`ANALYZE graph_edge, graph_company_node, graph_person_node` after its merge, which stamps
`last_analyze` and never touches the visibility map, so `graph_company_node` sat at **20 of
1,174 pages (1.7%)** with 6,087 dead tuples and `last_autovacuum` NULL while looking freshly
maintained. Its two siblings were healthy (3,770/3,770 and 3,592/3,665) only because autovacuum
had happened to reach them — so the one table that needed it was the one that looked least
suspicious. Measured on the top-N by money the loader itself issues (`GLOBAL_COMPANY_CAP`, 150
rows): `Index Only Scan … Heap Fetches: 208`, 170 buffers, 7.8 ms → `Heap Fetches: 0`, 5
buffers, 0.18 ms. Use `vacuumAfterReload()`, never a bare ANALYZE, after a bulk rewrite.

**Cloud SQL carries the same exposure, and `tenders` is the one that costs something.** Migration
113 exists to make the `/procurement/tenders` browser's count+sum and its two facet GROUP BYs
Index-Only Scans over `idx_tenders_order`, and `db_table.js` routes them at the base table rather
than the `tenders_list` view as the other half of that fix. With an empty map the whole
optimisation is given back silently — measured locally 2026-08-11 on the default scope, **5,047
buffers with `Heap Fetches: 6088`, against 87 and `Heap Fetches: 0` after**. Prod is a
db-g1-small reading cold over the proxy under a 10 s `statement_timeout`, so it is worse there.
Every `:cloud` loader run now vacuums — including the ones that publish by `shipTable()`, whose
`company_founded` was the one destination no caller covered and which no LOCAL gate can ever see,
because the local copy of that table is upserted rather than truncated. But a database loaded
before this shipped stays in the bad state until its next reload, and that reload is ~90 min for
contracts, ~20 for tenders. Repair it directly instead (safe any time, and the tenders one is
~2.5 s per 42k pages):

```bash
psql "$DATABASE_URL" -c "VACUUM (ANALYZE, PARALLEL 0) tenders, tender_normalcy_cache, procurement_normalcy_cache, procurement_annexes, nzok_activities, nzok_activity_facility_periods, nzok_activity_proc_periods, nzok_activity_monthly, fund_projects, fund_beneficiaries, company_founded, budget_admin_procurement, interreg_operations, interreg_partners, interreg_programmes, budget_peer_band, tr_name_fold_people, graph_edge, graph_company_node, graph_person_node, graph_payloads, agri_subsidies, agri_payloads, agri_beneficiary, agri_beneficiary_year, agri_scheme_year, agri_hub_stats_cache, agri_political_link, agri_cross_programme;"
```

`budget_admin_procurement` (157) is the odd one in that list: it is written by THREE
loaders — `db:load:budget:pg` (its own dimension), `db:load:pg` (the contracts corpus)
and `db:load:tr:pg` (`company_politicians`) — and its DELETE+INSERT rebuild runs inside
one transaction, so each of them has to vacuum it. All three do.

Two things about the repair are easy to get backwards:

- **`PARALLEL 0` is required on the local docker Postgres, not optional.** Parallel vacuum
  allocates one DSM segment up front and the container's `/dev/shm` default is 64 MB, so
  `VACUUM (ANALYZE) tenders` (14 indexes) dies with `could not resize shared memory segment …
to 67145792 bytes`. `vacuumAfterReload` passes it for that reason. Nothing is lost: VACUUM
  parallelises the index-vacuum phase only, and a freshly reloaded table has `n_dead_tup = 0`,
  so that phase has no work to do.
- **A VACUUM run while any long transaction is open marks NOTHING and still reports success.**
  It is the same held-back-horizon mechanism that defeats autovacuum. Measured on a standalone
  `db:load:nzok-activities:pg` with a concurrent `db:resolve:persons` 15 minutes into one
  snapshot: `last_vacuum` stamped, `relallvisible` still 0, loader exit 0. `vacuumAfterReload`
  therefore reads the map back and WARNS with the blocking pid rather than throwing — the load
  has already committed and the data is fine, so the shortfall is worth reporting, not worth
  aborting a `db:refresh` chain over. On Cloud SQL, which serves traffic continuously, expect
  this to fire occasionally; re-run the VACUUM above when it does.

## Testing

Two layers: **Vitest** for unit + component tests (`npm run test:unit`), **Playwright** for E2E/SEO/perf smoke (`npm test`). Co-locate tests as `*.test.ts(x)` next to the module. Unit tests never touch the network (an unstubbed `fetch` throws in jsdom) or a live DB; the `scripts/db/tests/*.data.test.ts` Postgres gates are the exception and auto-skip when Postgres is down. The `functions/` package keeps its own `node --test` gate (`npm run functions:test`). Full convention — what to unit- vs component-test, fixtures, determinism, coverage, CI placement — is in [docs/testing-standards.md](docs/testing-standards.md).

**Two of those Vitest files are static-analysis gates over the SOURCES rather than
tests of a module, and both exist because the failure they catch is invisible in
review and expensive to catch any other way.** Each is seconds; the alternative is
a ~10-minute `vite build` that reports only that a number moved.

- **`src/entryGraph.test.ts`** — walks the static import graph from `main.tsx` and
  fails if it reaches a sector registry, or anything a registry names. The rule it
  encodes: **take a constant from an import-free module, never from a registry.**
  `routes.tsx` imported one path string from `sectorPacks` and thereby put ~20
  reference-data modules (~265 KB of source) into the entry chunk that every page
  downloads. The byte budget in `tests/perf.spec.ts` caught the 587 B that pushed it
  over; it could not say which edge did it. The forbidden set is DERIVED from the
  registries' own closure, so a new pack is covered the day it is added.
- **`scripts/i18n/key_usage.test.ts`** + `npm run i18n:prune` — fails when the
  corpora accumulate keys no call site can ask for. A key counts as reachable if it
  appears as a literal, matches a built template (`` `pp_reg_seat_${seat}` ``),
  matches a family prefix, or is a plural of a used base — and the scan covers
  `scripts/` and `data/*.json`, because a key can reach the UI through a DATA
  ARTIFACT rather than a call site. The prune deletes translated copy, so it is
  dry-run by default and deliberately in no chain.

Both share `scripts/lib/strip_comments.ts`: prose that MENTIONS a pattern is not an
occurrence of it, and each gate has already been burned by a naive strip — in
opposite directions. Read that file's header before touching either.

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
- `src/locales/{bg,en}/translation.json` — the ONLY i18n corpora, one chunk per
  language via `import()` in `src/i18n.ts`. There is no `public/locales/`; this line
  named one until 2026-08-18, which would send anyone auditing or pruning the
  corpus to a tree that does not exist — or make them conclude a served copy had
  been missed.

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
