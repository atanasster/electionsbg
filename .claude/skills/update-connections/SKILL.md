---
name: update-connections
description: Refresh the MP business-connections data — pulls property/interest declarations from register.cacbg.bg (Court of Audit) and Commerce Registry filings from data.egov.bg, then rebuilds the per-MP declaration files under data/parliament/ plus the officials↔company bridge, the assets rankings, car makes and provenance (which the person-identity layer resolves into the LIVE Postgres connections graph behind /connections). Also flags unrealistic-looking declared values (cars/apartments/assets) and walks the operator through adding a typo override. Use when the user asks to refresh declarations, update business connections, add a new declaration year (e.g. 2026 filings appear in spring), rebuild the Commerce Registry SQLite, or investigate a suspicious-looking declared value flagged by the typo checker. Also use after a fresh git clone if `data/parliament/declarations/` is empty. NOTE: two families this skill used to build are RETIRED — the static person↔person connections graph (connections*.json / mp-connections/) and companies-index.json. A missing companies-index.json is now the CORRECT state; see the banner below.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# MP business-connections data pipeline

> **⚠️ RETIREMENT NOTICE (connections-engine-v1 §P4.3).** The static person↔person MP-connections
> graph — `build_connections_graph.ts` (declarations phase 6) + `build_officials_connections.ts` and
> their outputs `connections*.json` / `mp-connections/` / `official-connections/` — is **RETIRED**.
> `/connections` and the `/person` "Свързани лица" tile now read the **live Postgres graph engine**
> (`graph_payloads` / `person_connections`, migrations 127-129 + 084 + loader `scripts/db/load_graph_pg.ts`),
> derived from `person_role` (co-ownership) ∪ `company_politicians` (procurement). The dashboard
> `MpConnectionsTile` was retired too. **Run `update-persons` (or its cloud chain, which re-derives
> the graph via `db:load:graph:pg`) after this skill to publish the refreshed connections.**
> Everything below that references `connections.json` / `connections-rankings.json` /
> `buildConnectionsGraph` / `mp-connections` is **historical** — those files are no longer built or served.

> **⚠️ SECOND RETIREMENT (2026-08-20 — `docs/plans/company-page-consolidation-v1.md`, Tier 5).**
> `data/parliament/companies-index.json` is **DELETED**, and with it phases 2, 2.5, 5 and 5a plus the
> `mpRoles` augment. **A missing companies-index.json is now the CORRECT state — do not run anything
> to "restore" it.** It was a 4.16 MB name-keyed company page whose registry arm attached a company
> UIC to an MP on a name-uniqueness check alone; migration 096 (`declaration_stake_company`) declines
> **1,751 of its 2,120 UICs** rather than grading them, and `/company/:eik` serves every one of those
> UICs from the registry identity instead. Deleted with it: `build_company_index.ts`,
> `augment_mp_roles.ts` (and its `MP_ROLES_SQL`), `tr/integrate.ts`, `useCompanyIndex.tsx`,
> `MpCompanyRedirect.tsx`, the `MpOwnershipStake.companySlug` field, and the `/mp/company/:slug`
> route (`firebase.json` 301s `/mp/company`, `/mp/company/**` and both `/en` mirrors to
> `/governance/companies`). **What this skill STILL does:** fetch + parse the declarations into the
> per-MP files, then rebuild the officials↔company bridge, the assets rankings, car makes and
> provenance — which the person-identity layer resolves. Everything below that references
> `companies-index.json` / `buildCompanyIndex` / `mpRoles` / `companySlug` / `/mp/company` is
> **historical**.

Builds the per-MP declaration files and their downstream rollups from two Bulgarian government
sources (the person layer turns them into the live `/connections` graph):

- **register.cacbg.bg** — annual property/interest declarations (Сметна палата). Provides MP-declared ownership stakes.
- **data.egov.bg** dataset `2df0c2af-e769-4397-be33-fcbe269806f3` — daily Commerce Registry (TR / Търговски регистър) filings. Provides company officers, owners, status, seat, and historical role changes.

Sitting MPs cannot legally hold management roles (ЗПК Art. 35), so the two sources are complementary: declarations give you the *ownership* side, TR gives you the *management* side plus all co-officer/co-owner relationships needed to build a real graph.

## When to use which command

The pipeline is a declarations fetch/parse (phase 1), a separate and much heavier TR-snapshot
path (phases 3-4), and a set of downstream builders. Pick the entry point based on what changed
upstream:

| Intent | Command | Time | Network |
|---|---|---|---|
| **Refresh declarations only** (new filing year, e.g. 2026 filings appear) | `npm run data -- --declarations` | ~3-15 min | per-MP XML, ~1 req/150 ms |
| **Refresh one filing year** (the usual incremental case) | `DECL_YEARS=2026 npm run data -- --declarations` | ~3-5 min | that folder only |
| **Refresh TR snapshot** (do this every few months — TR changes daily) | see "TR refresh playbook" below | ~30-60 min | one ~540 MB zip + replay |
| **Rebuild every artifact from disk** (after editing a build script — no upstream fetch) | `npx tsx scripts/declarations/rebuild_all_from_cache.ts` | ~2-4 min | none |
| **First-time bring-up** (fresh clone, no data) | TR bulk + reconstruct, then `--declarations` | ~1-2 h | full set |

**`npm run data -- --declarations` is the safe default.** It fetches register.cacbg.bg incrementally (XML files cached in `raw_data/declarations/{year}/`), then re-runs every downstream builder — the officials↔company bridge, assets rankings, car makes, provenance — on each run. If the TR SQLite is missing, the officials bridge falls back to declared links only and logs a warning; `npm run prod` still succeeds.

**`--prod` makes no difference to anything this skill writes, and that is deliberate.** Every
other builder in `scripts/` takes its JSON formatter from `main.ts`'s single `stringify`, which
pretty-prints unless `--prod` is passed. These artifacts are COMMITTED, so their format is part
of the file's identity in git — `scripts/declarations/formats.ts` fixes one per family
(compact for the parliament tree, pretty/2-space for the officials `company_links.json`) and no
caller passes a formatter in. Until 2026-08-15 the global one WAS threaded through, and because
the two families need different formats it could not be right for both at once: plain
`--declarations` pretty-printed the parliament tree (1,438 files, ~892k insertions of pure
whitespace) while `--declarations --prod` flipped `company_links.json` to compact (~928k
deletions, also pure whitespace). There was no invocation that produced a clean diff. Both forms
now produce byte-identical output; a refresh that changes nothing substantive touches only the
`generatedAt` stamps. `scripts/declarations/formats.test.ts` is the gate — do NOT re-add a
`stringify` parameter to a builder, and do NOT mass-reformat either family to unify them (each
would be a ~million-line no-op diff and a full re-upload of the trees that ship).

To rebuild the derived files without re-fetching declarations, use the runner rather than a
hand-rolled one-liner — it sequences the builders and writes through the fixed formatters:
```bash
npx tsx scripts/declarations/rebuild_all_from_cache.ts --skip-reparse
```
`--skip-reparse` drops the whole-corpus XML re-parse — use it when the edit is to a downstream
builder (`build_officials_company_links.ts`, `build_assets_rankings.ts`, `build_car_makes.ts`,
`build_data_provenance.ts`) rather than to the declaration parser. Drop the flag after editing
`parse_declaration.ts`. Either way the per-MP `declarations/{mpId}.json` files (the slow-to-fetch
part) are never re-fetched. To rebuild ONLY the officials cross-reference:
`npx tsx scripts/run-officials-links-only.ts`.

**[2026-08-20] The runner's old ordering constraint is gone with the phases it protected.** It
used to insist on running `buildCompanyIndex` FIRST because the `mpRoles` augment *appended* to
`companies-index.json` and would duplicate roles against an already-augmented file. Both are
deleted, and the re-parse no longer carries `companySlug` across from the previous vintage — the
parser's stake array now stands as written. The runner still prints phase numbers 1, 4a, 6, 7, 8
— the gaps are real and labelled in its source, and they do NOT line up with `index.ts`'s.

## Inputs

- `public/parliament/index.json` — produced by the **parliament-scrape** skill. Required input. If missing, run that skill first; the declarations script will warn and exit otherwise.
- `register.cacbg.bg/{year}/list.xml` — directory of all declarants for that filing year. Walked under the "Народни представители" category only.
- `register.cacbg.bg/{year}/{xmlFile}` — per-MP declaration XML. Cached under `raw_data/declarations/{year}/`.
- `raw_data/tr/state.sqlite` (~120 MB) — reconstructed Commerce Registry. **Optional**: phases 5 + 6 degrade gracefully without it. See "TR refresh playbook".
- `data/postcode_ekatte.json` — BG Post postcode → EKATTE settlement map. Joined against the free-text `registeredOffice` field to assign each company a `ekatteHQ[]`, so the "Companies HQ'd here" tile (`/sofia` + every settlement page) can list MP-linked firms by HQ address. Regenerate from upstream with `npx tsx scripts/parliament/build_postcode_ekatte.ts` — triggered automatically by the watcher when `bgpost_postcodes` flips. Missing/empty file degrades to name-only matching: ~16 village ambiguities (Лозен, Лясково, …) get picked arbitrarily.

## Outputs

All under `public/parliament/`:

| Path | Size (raw / gzip / brotli) | Lifecycle |
|---|---|---|
| `declarations/{mpId}.json` × ~600 | ~3.6 MB total | One file per MP. Carries the **full** stake schema for `MpFinancialDeclarations`. |
| `companies-index.json` *(NO LONGER WRITTEN)* | — | Retired 2026-08-20 by company-page-consolidation-v1 Tier 5. A 4.16 MB company page keyed on a slug of the DECLARED NAME, whose registry arm attached a UIC on a name-uniqueness check alone; `/company/:eik` serves all 2,120 of those UICs from the registry identity, and the declared stakes come from `declaration_stake_company` (096), which REFUSES 1,751 of them. Its three builders (`build_company_index.ts`, `augment_mp_roles.ts`, `tr/integrate.ts`) are deleted |
| `mp-management/{mpId}.json` *(NO LONGER WRITTEN)* | Retired by mp-tr-edges-pg-v1 — `/api/db/mp-management` (migration 150) serves an MP's registry roles from the gated person layer instead, refusing names the Commerce Registry records for more than one person. `integrate.ts` phase 2, which wrote these, is deleted |
| `connections.json` | 2.5 MB / 218 KB / 136 KB | Cross-MP/company/person graph for `/connections`. Lazily fetched on that route only. |
| `mp-connections/{mpId}.json` × ~600 | ~4.2 MB total (median ~1.8 KB / max ~190 KB raw) | Per-MP 1-hop + co-officer-2-hop subgraph. Loaded on each candidate page (`MpConnectionsMini`). MPs with no neighbourhood get no file (fetch 404 → component renders nothing). |
| `connections-rankings.json` | 791 KB / 74 KB / 55 KB | Top-MPs / top-companies for the dashboard tile + `/connections` rankings card. **Loaded on every dashboard view** — keep it lean. |
| `companies-by-{ekatte,obshtina}/…` *(NO LONGER WRITTEN)* | Retired by mp-tr-edges-pg-v1 — `/api/db/place-mp-companies` (migration 151) serves these from the gated person layer, covering 1,332 settlements against the shards' 176. Both builders are deleted |
| `company-connections/{eik}.json` *(NO LONGER WRITTEN)* | Retired 2026-08-16 — `/api/db/company-connections` (migration 158 `company_political_links`) serves this from the gated `person_role` tr/ngo set. The builder is deleted. Its reader was never `/company/:eik` as this row long claimed, but the AI chat's `companyConnections` tool. NOT a port: the shards name-matched TR officers against a power roster and graded the result `medium`/`low`; 158 lets the registry's own people-count per name fold (`tr_name_fold_people`, 148) decide and refuses an unmeasured fold. Corpus-wide that is wider — 9,982 companies with a direct link vs 3,843, 26,047 answerable vs 19,232. ⚠️ The 19,232 gitignored local files are NOT deleted and nothing rewrites them; the `bucket_sync_paths.ts` exclusions must stay so they cannot re-upload |

The per-MP declaration files are append-only (one file per MP id; rewriting one file does not affect others). The aggregates the downstream builders still write — `assets-rankings.json`, `mp-assets/*`, `car-makes.json`, `mp-cars.json`, `data-provenance.json` and `data/officials/derived/company_links.json` — are **regenerated end-to-end on every run**.

`raw_data/tr/` is gitignored (~12 GB extracted). `raw_data/declarations/{year}/` is **not** gitignored but intentionally not committed — the per-MP XML cache exists on whoever ran the fetcher; CI / fresh clones just re-fetch them.

## Pipeline phases (what each step actually does)

```
register.cacbg.bg                    data.egov.bg dataset 2df0c2af-…
       │                                          │
       ▼                                          ▼
[Phase 1]  declarations/                  [Phase 3] all-resources.json.zip
parseFinancialDeclarations              fetchBulkZip / fetchDaily
       │                                          │
       ▼                                          ▼
data/parliament/declarations/           [Phase 4] state.sqlite
{mpId}.json                             reconstructState
       │                                          │
       ├─[Phase 4a] buildOfficialsCompanyLinks ◄──┘
       │       ▼
       │   data/officials/derived/company_links.json
       │
       ├─ buildAssetsRankings   → assets-rankings.json, mp-assets/*
       ├─ buildCarMakes         → car-makes.json, mp-cars.json
       └─ buildDataProvenance   → data-provenance.json

              (buildCompanyIndex, integrateTr and the mpRoles augment —
               companies-index.json + mp-management/ — were REMOVED
               2026-08-20; see the second retirement banner.
               buildConnectionsGraph went earlier, with connections-engine-v1,
               and buildCompanyConnections → company-connections/{eik}.json
               went 2026-08-16 — served from Postgres, migration 158.)
```

Phase 1 and the downstream builders chain inside `parseFinancialDeclarations` (`scripts/declarations/index.ts`). Phases 3, 4 are kept out of `npm run prod` because they take 30-60 min and produce a 12 GB intermediate.

⚠️ **Do not trust a phase NUMBER on the last three builders.** The retirements left gaps, and the two runners number what is left differently — `index.ts` calls the assets rollup "Phase 7" while `rebuild_all_from_cache.ts` calls it "phase 6". The builder names are the stable reference; the numbers are scar tissue.

## TR refresh playbook

The Commerce Registry changes every business day. Refresh schedule:

- **First time** or **after >6 months**: `--bulk` (full snapshot).
- **Catching up <6 months**: `--index --incremental` (daily filings only).

Both finish with `--reconstruct` to rebuild the SQLite.

> **Per-resource download outage (June 2026).** data.egov.bg's per-resource
> endpoint (`/resource/download/{uuid}/json`, the `--incremental` path) broke
> server-side: it 302-redirects to the portal HTML shell with a "Грешка при
> вземане на метаданни за ресурс" flash for **every** file resource. This is a
> backend metadata-fetch failure, not a CSRF/session issue a client can satisfy
> (a bad token still gives 419; a correct token still gives the redirect).
> `--incremental` now detects this, refuses to write the HTML shell as a filing
> (the old code wrote ~1100 stubs that made `--reconstruct` skip every day), and
> **auto-falls-back to the bulk zip** — so `cli.ts --incremental --reconstruct`
> recovers in one go. The dataset-level bulk-zip endpoint (the `--bulk` path) is
> separate and still works. Until egov restores per-resource downloads, prefer
> `--bulk` + `--reconstruct` directly.

```bash
# ~540 MB zip download to raw_data/tr/all-resources.json.zip — resumable (HTTP Range)
npx tsx scripts/declarations/tr/cli.ts --bulk

# OR for incremental:
# walks the data.egov.bg dataset listing → dataset-index.json
npx tsx scripts/declarations/tr/cli.ts --index
# fetches only daily filings not yet on disk
npx tsx scripts/declarations/tr/cli.ts --incremental

# Replay every daily filing through the TR parser → raw_data/tr/state.sqlite (~120 MB)
# Auto-detects zip mode vs raw_data/tr/daily/*.json
npx tsx scripts/declarations/tr/cli.ts --reconstruct

# Then rebuild every declarations aggregate from disk (NO upstream fetch):
# re-parse cached XML → officials bridge → rankings/car-makes/provenance.
# Use this whenever a builder's logic changed but cacbg/data.egov is
# unreachable.
npx tsx scripts/declarations/rebuild_all_from_cache.ts
```

> Formats are not the runner's problem — each builder owns its own
> (`scripts/declarations/formats.ts`), so no caller can churn a file by
> passing the wrong `stringify`. Note the data root is `./data`, not
> `./public`.
>
> (This replaced `scripts/run-connections-rebuild.ts`, which was deleted
> without updating this doc. The per-EIK `company-connections/` and the
> retired `companies-by-ekatte`/`-obshtina` shard builders are NOT in this
> runner, and both are now gone outright — `/company` political links are
> served by migration 158 and `/settlement/:id/companies` by migration 151.
> Neither is `buildCompanyIndex`, deleted 2026-08-20 with the file it wrote.)

Use `--limit N` on `--reconstruct` for a smoke test (replays N days only).

## Step-by-step: adding a new declaration year

When a new filing season opens (typically May for prior fiscal year):

1. **Verify the year is published** — register.cacbg.bg only exposes the listing once submissions open:
   ```bash
   curl -sk -A "Mozilla/5.0" "https://register.cacbg.bg/2026/list.xml" | head -c 400
   ```
   You should see `<?xml version="1.0"...><Categories>...`. A 404 means the year isn't open yet.

2. **Run the fetch** with the new year:
   ```bash
   DECL_YEARS=2026 npm run data -- --declarations
   ```
   Defaults to 2025 only. Set `DECL_YEARS=2024,2025,2026` to (re-)fetch multiple years; existing per-MP files are overwritten with the union.

3. **Watch the warnings** — every `[declarations] no MP match for "..."` is a declarant we couldn't link to an MP id. Common causes are listed under "Common pitfalls". A handful per year is normal; dozens means the parliament index is stale (re-run **parliament-scrape** first).

4. **Run the typo flagger** (mandatory). After the rebuild, scan the new
   declarations for unrealistic-looking BGN values that survived parsing:
   ```bash
   npx tsx scripts/declarations/check_suspicious_values.ts
   ```
   Flagged rows fall into three categories — see "Typo and unrealistic-value
   detection" below for the decision flow. Already-overridden typos do not
   re-flag (the parser corrects them before the value lands in the JSON);
   anything new that prints a "FLAG" line needs operator action.

5. **Spot-check the dashboard** at `/?_=` (cache-bust) — the "Бизнес връзки на депутатите" tile should show the new year reflected in any MP whose declarations grew. The tile filters by current parliament's NS folder; switch elections to verify older NSes still populate.

6. **Regenerate the declarations-hub blob** (mandatory whenever the declarations moved):
   ```bash
   npm run db:gen-declarations-hub-stats
   ```
   `data/governance/declarations_hub_stats.json` backs the whole `/governance/declarations`
   tile grid. Nothing else regenerates it outside a full `db:refresh`, so a rebuild that stops
   at step 5 leaves the tiles quoting the previous vintage. Caught that way 2026-08-11, when
   the 2015-2020 MP backfill moved the companies figure 2,761 → 3,269 and the tile stayed at
   2,761 — the mechanism is unchanged even though the relation it read is not.

   ⚠️ **[2026-08-20] EVERY figure in it now comes from Postgres, the companies tile
   included — which changes when you run this.** It used to read `companies` / `companyMps`
   straight out of `companies-index.json`, because that WAS what `/mp/companies` rendered and
   the rule is that a tile quotes its DESTINATION's own relation. The destination is now
   `/governance/companies` over `official_companies` (178), so the generator reads that
   instead. So run this **after** `/update-persons`, never before: with the person layer
   unreloaded the generator publishes the previous vintage of every figure rather than of
   four. An absent `official_companies` (178 unapplied) makes the tile ship with NO figure
   rather than a „0 организации" claim.

   The gate is `scripts/db/tests/declarations_hub_stats.data.test.ts`. It **needs Postgres and
   skips when the database is unreachable**, so a green run on a checkout with no database
   proves nothing here. Every assertion in it is written against something the generator does
   NOT use — the destination screen's own filter, the partition structure — because its first
   version re-ran the generator's own SQL and pinned two bugs.

7. **Commit**:
   ```bash
   git add data/parliament/declarations \
           data/parliament/assets-rankings.json data/parliament/mp-assets \
           data/parliament/car-makes.json data/parliament/mp-cars.json \
           data/parliament/data-provenance.json \
           data/officials/derived/company_links.json \
           data/governance/declarations_hub_stats.json
   git commit -m "Refresh declarations for 2026 filing year"
   ```
   (The tree is `data/parliament/`, not `public/parliament/` — that path holds only `votes`,
   so the older form of this block failed on its first argument.)

   Two paths are deliberately NOT in that list, and both would break the command rather than
   be no-ops. `data/parliament/mp-management` is gitignored since mp-tr-edges-pg-v1, so
   `git add` exits 1 on it ("paths are ignored") — and the failure mode matters: the other
   pathspecs still stage, so the commit succeeds and only the non-zero exit says anything went
   wrong. `/api/db/mp-management` serves that data now (migration 150). And
   `data/parliament/companies-index.json` is DELETED as of 2026-08-20, so naming it fails with
   "did not match any files"; nothing writes it any more.

## Data-integrity contract

This pipeline has two upstream stages — register.cacbg.bg (declarations XML) and data.egov.bg (Commerce Registry bulk JSON) — each with its own fail-loud surfaces. The shared rule: **never overwrite a committed aggregate (`assets-rankings.json`, `car-makes.json`, `data-provenance.json`, `data/officials/derived/company_links.json`) with a partial result when an upstream stage failed mid-run**.

Fail-loud surfaces (a run throws and the affected output is not written):

| Stage | Surface | Trigger |
|---|---|---|
| Declarations fetch | HTTP non-2xx on register.cacbg.bg | `GET <url> → <status>` |
| TR dataset-index fetch | HTTP non-2xx | `GET <url> → <status>` |
| TR bulk-zip prepare | HTTP non-2xx OR returned an HTML error stub | `prepare GET ... → <status>` / `prepare returned non-JSON body` |
| TR bulk-zip download | HTTP non-2xx OR empty body | `download GET → <status>` / `download returned empty body` |
| TR state reconstruction | Required SQLite schema missing | Thrown by `reconstruct_state.ts` |

Intentional non-fatal skips (logged with `[stage]` prefix, ingest continues):

| Surface | Behaviour | Why |
|---|---|---|
| `raw_data/declarations/<dir>` missing | Builder for that step warns `not found — skipping` | Allows partial pipeline runs (e.g. assets rebuild without re-fetching declarations) |
| Per-MP declaration parse returns null on a field | The field is omitted from that MP's record | Cell-level parser resilience — one bad row shouldn't reject a whole filing |
| TR SQLite not present when the officials bridge runs | `build_officials_company_links.ts` warns `no TR SQLite … — declared links only` and emits the declared-stake arm alone | Optional enrichment; `npm run prod` should still succeed without it |
| Unmatched MP name (married, hyphen variant) | Counted in the "unmatched" tally at the end | Documented below — irreducible 1-2 per parliament |
| Slug collision across companies | First-wins with a warning | Documented below |

The per-stage summaries printed at the end of each `npm run data -- --connections` / `--declarations` / `--companies` run tell you the actual counts — if any of them suddenly drop by >10% vs. the previous run's commit, treat as a regression and investigate before committing.

## Common pitfalls

### register.cacbg.bg cert is not in Node's CA bundle
The Bulgarian government's root CA isn't trusted by default. The fetcher applies a one-off `Agent({ connect: { rejectUnauthorized: false } })` **only to register.cacbg.bg URLs** (`scripts/declarations/index.ts:34`). Don't disable globally and don't try to pin a cert — the chain rotates.

### Hyphenated surnames have spacing variants
register.cacbg.bg writes `"Бъчварова - Пиралкова"` (spaces around the hyphen); parliament.bg writes `"БЪЧВАРОВА-ПИРАЛКОВА"`. The declaration normaliser collapses `\s*-\s*` → `-` before lookup. If you see `no MP match` warnings on a hyphenated name, check the normalizer is still doing this.

### Married names cannot be matched
Same constraint as the parliament-scrape skill — `НЕБИЕ ИСМЕТ КАБАК` (CIK + register listing) and `НЕБИЕ ИСМЕТ ЦЪРЕНСКА` (parliament.bg, after marriage) won't link. Logged as `no MP match`. There is no fix in the data layer; manual override would need a name-alias table that doesn't exist yet.

### Empty `oldnsList` for some former MPs
parliament.bg's profile API returns `oldnsList: []` for some ex-MPs (e.g. Ивелин Михайлов, leader of Величие, served in NS 51). The connections rankings file backfills `nsFolders` for these MPs by parsing their declaration `institution` strings (`"51-во Народно събрание"` → `"51"`) — see `nsFoldersForMp` in `build_connections_graph.ts`. The frontend dashboard tile then filters on `row.nsFolders.includes(folder)` from the rankings JSON, **not** from `useMps()`. If you find an ex-MP missing from a per-election dashboard despite having declarations, check that their declarations file references the right NS in `institution`.

### The parliament index `nsFolders` field is NOT auto-updated by this pipeline
The backfill above lives in the rankings file only. `index.json` still reflects whatever parliament.bg's `oldnsList` returned. Don't add a "fix the index" step here — it would couple the connections pipeline to the parliament-scrape outputs and create a circular dependency. Leave the index as the canonical parliament view; treat the rankings nsFolders as the connections-aware view.

### Company names are grouped by a NAME FOLD, not by a slug
**[2026-08-20]** Slug collision used to be the hazard here: two companies differing only in
casing or quote style slugged to one string, `build_company_index.ts` disambiguated with
`-2` / `-3`, and `MpCompanyScreen` looked the slug up by exact match. All three are deleted
with `companies-index.json`, along with `MpOwnershipStake.companySlug`. Client-side stake
grouping now folds the raw declared name through `src/lib/companyNameFold.ts`
(`src/data/parliament/consolidateStakes.ts`), so there is no slug to collide and no index to
check against — but the underlying fact has not moved: **a declared company NAME is not an
identity.** `/company/:eik` is keyed on the registry EIK, and 096 refuses a UIC it cannot
confirm rather than guessing one.

### `"-"` placeholder values in declarations
register.cacbg.bg uses `"-"` as a "no value" sentinel in `itemType`, `companyName`, `holderName`, etc. Don't treat them as real strings (don't display one as a company name, don't let one become a group key). A name fold of `"-"` is empty, and an empty fold must not become a company — the deleted `build_company_index.ts` dropped exactly that case so the graph would not grow a placeholder company node, and any future consumer of the declared name owes the same guard.

### Decimal/thousand separator typos in declared values
A non-trivial fraction of declared BGN values are off by 100×–1000× because the declarant typed thousand-separators where the form expected decimals (or vice versa). Without intervention these dominate the assets ranking and the per-MP wealth pages. The pipeline handles them via narrow per-row overrides plus an automated flagger — see "Typo and unrealistic-value detection" below for the override tables, the heuristic thresholds, and the decision flow.

### TR SQLite is optional
If `raw_data/tr/state.sqlite` is missing (e.g. fresh clone before TR bulk runs), `build_officials_company_links.ts` logs `no TR SQLite at … — declared links only` and emits `data/officials/derived/company_links.json` from the declared-stake arm alone — no TR officer/owner links, so `namesakeCount`/`trNamesakeCount` never gate anything.

The build still succeeds; downstream, `pep_connected` (in `/update-procurement`) and the funds political-economy join both get a thinner high-confidence set. Run the TR refresh playbook to fill these in. **[2026-08-20]** The other two consumers this section used to name are gone: `integrateTr` and `companies-index.json`'s `tr` field, and the `mp-management/` shards — `/api/db/mp-management` (migration 150) serves an MP's registry roles from the gated person layer instead.

### TR confidence model
TR-only matches are name-based. The integrator emits three tiers, of which only two ship:
- **high** = full normalized name match AND (TR seat city contains the MP's region OR another MP from the same party already declared a stake in this UIC)
- **medium** = full normalized name match only
- **low / surname-only** = suppressed entirely (Bulgarian common names like Иван Иванов explode into hundreds of false positives)

The `/connections` page has a "high confidence only" filter; the dashboard tile already counts `highConfDegree` only. When investigating an MP's ties seriously, prefer the high-only view.

**TR-namesake guard (name-collision fix).** Every officer→power-person name match needs a gate: a name spread across multiple TR companies is almost always several distinct people (common Bulgarian names recur thousands of times), so attributing all those companies to one MP/official is a false positive. **The old company-count proxy survives in exactly ONE place now, and the two successors both count PEOPLE instead:**

- `build_officials_company_links.ts` — the last holder of the proxy. A TR link is `high` only when unique among officials AND `trNamesakeCount === 1` (see `/update-officials`).
- ~~`tr/build_company_connections.ts`~~ — **deleted 2026-08-16.** Its successor, `company_political_links` (migration 158), reads `tr_name_fold_people` (148) — the registry's own count of how many PEOPLE a name fold covers — and refuses any fold it has not measured.
- ~~`build_connections_graph.ts` phase-3~~ — deleted with the static graph (see the first banner).
- ~~`buildTrNamesakeCounts` / `buildNamesakeFilteredLinkageMap` in the two cross-reference builders~~ — **deleted 2026-08-20.** `scripts/procurement/cross_reference.ts` and `scripts/funds/cross_reference.ts` now read the gated MP↔company link set through `scripts/lib/mp_linkage.ts`, which is gated on the same `tr_name_fold_people` fold.

A company count was only ever a proxy, and it erred in both directions: it dropped a rare-name official's whole set behind one busy registered agent, and passed a name held by two people with several companies each. Either way, the point is what it keeps out — a Горна Малина councillor off Софарма Трейдинг's billions, a Чирпан deputy-mayor off „Автомагистрали".

### One stake schema — `MpOwnershipStake`
**[2026-08-20]** There used to be two. The full `MpOwnershipStake` lives in
`data/parliament/declarations/{mpId}.json` — `MpFinancialDeclarations.tsx` renders all of
`itemType`, `companyName`, `registeredOffice`, `holderName`, `transfereeName` — and
`companies-index.json` shipped a slim `CompanyIndexStake` projection beside it. The index, the
projection and the `companySlug` field the two joined on are all deleted; the 556 committed
per-MP shards were rewritten without it. The rule that produced the split still binds any
future aggregate: **weigh a field's cost against how often the file is loaded**, and do not add
one back without checking it is actually rendered.

⚠️ **The Postgres column `declaration_stake.company_slug` is deliberately KEPT and no longer
written** — see its comment in `scripts/db/schema/pg/089_declarations.sql`. It is dropped from
the declarations loader's column list, so a fresh load leaves it NULL. Do not read it, and do
not "finish the job" by dropping it.

### Per-MP files vs aggregates
Per-MP files (`declarations/{mpId}.json`, `mp-assets/{…}.json`) are **lazy** — the candidate page fetches one. Aggregates (`assets-rankings.json`, `car-makes.json`) are **eager** in the routes that use them. When trimming output, weigh field cost against load frequency.

## Typo and unrealistic-value detection

Declarants occasionally enter the wrong number of zeros — a 33,000 BGN
apartment becomes 33,000,000, a 1999 VW Golf becomes 800,000 BGN. Left
alone these typos dominate every chart on the site (highest declared car,
top assets ranking, single-mp net worth) and silently corrupt the totals.

The pipeline handles them in two layers:

### Layer 1 — narrow overrides applied at parse time

Two tables in `scripts/declarations/parse_declaration.ts`:

- `REAL_ESTATE_VALUE_OVERRIDES` — Table 1 rows. Match key:
  `sourceUrlContains` + `location` + `areaSqm` + raw value.
- `VEHICLE_VALUE_OVERRIDES` — Table 3 rows. Match key:
  `sourceUrlContains` + `acquiredYear` + raw value, plus optional
  `detailContains` (case-insensitive substring) to disambiguate when an MP
  has multiple cars in the same filing.

Each entry corrects exactly one declared value; the parser swaps in the
`correctedValue` and the rest of the pipeline never sees the original. Both
match keys are intentionally narrow — heuristic clamps ("anything over 100k
BGN/m² must be wrong") would silently rewrite legitimate luxury holdings.

**The per-m² anchor is the BUILDING (column 6), not the plot (column 5).**
`perSqmAnchor` in `parse_declaration.ts` is the one definition, shared with Layer 2.
The filing instructions are explicit — „в колона 5 се посочва площта на парцела, а в
колона 6 - на сградата" — and anchoring on the plot was wrong in both directions: a
36m² вила on a 980m² Sofia plot reads 423,558/m² of building but only 15,559/m² of
plot, so it published at €15.2m and ranked #1 on `/officials/assets`; and an apartment
declares its plot as „0", so 662 valued building rows had no usable anchor at all.
It picks the first USABLE area, not the first present one — a column-6 cell sometimes
holds an ideal part („1/2") rather than an area (75 are fraction-shaped corpus-wide, 2 in
a table-1 built-area position), and committing to those would suppress the plot fallback.
`builtAreaFromCell` refuses the fraction shape at source.

⚠️ **A `/100` auto-correction is a rewrite of a published number, and Layer 2 cannot
see it** — the flagger reads the parsed shards, where the raw value is gone. Worse, the
two layers interact: a `/1000` typo that used to fail the per-m² test and get caught by
the `> 5M` absolute arm now fires, lands under 5M, and goes unflagged while still 10×
too high. Every entry point that runs the parser therefore prints an
`AUTO-CORRECTED (verify)` section (`reportAutoCorrections`). **Read it.** Where `/100`
is the wrong divisor, add a `REAL_ESTATE_VALUE_OVERRIDES` entry — Касчиев's villa is the
worked case, where the honest value is `/1000`.

**Persistent vs per-filing source URLs**: register.cacbg.bg URLs share a
UUID prefix that's the declarant's persistent identifier, with a 6-digit
trailing suffix per filing year. If the same MP files the same erroneous
row across multiple years, match by the **persistent prefix only** so one
override covers every year. Concrete example —
`D6FB7B43-A7B9-496A-BEA5-05040F3EB514` (Hakkı's prefix) covers his 2022,
2023, and 2024 filings of the same VW Golf row.

### Ideal-part weighting — why MP net worth dropped ~13%

Since 2026-08-15 every wealth total counts a co-owned holding at the declarant's
**идеална част**. The register records the WHOLE property's acquisition price on each
co-owner's row („БЕЗ ДА СЕ ДЕЛИ МЕЖДУ СЪСОБСТВЕНИЦИТЕ", table 1 col 11) and requires each
co-owner on a separate row (col 8), so summing raw counted a jointly-held home twice.

**A one-time drop against a pre-2026-08-15 baseline is the FIX, not a regression** —
measured: MPs −13.3%, executive −16.1%, municipal −19.9%. `/mp-cars` moved too
(€8,241,472 → €7,109,059): vehicles are weighted on the same rule.

The rule lives twice — `assetShareMultiplier()` in `src/lib/declarations.ts` and
`asset_share_multiplier()` in `090_person_wealth.sql` — because a route cannot import TS.
`scripts/db/tests/asset_share_multiplier.data.test.ts` runs both over every
`(share, category)` literal in the corpus. Two things it deliberately does NOT do:
`security` is never weighted (that cell is a COUNT of дялове, not a fraction), and
anything not an unambiguous proper fraction returns 1 — „СИО", „по 1/2" and „1/2-1/2"
each already state the household's whole holding on one row.

### Layer 2 — automated flagging of unhandled rows

```bash
npx tsx scripts/declarations/check_suspicious_values.ts
```

Walks every row in `public/parliament/declarations/{mpId}.json` and prints
"FLAG" lines for any whose declared BGN value passes a category-specific
heuristic threshold. Already-overridden rows don't re-flag because Layer 1
corrects them before they land in the per-MP JSON. Run after every
`npm run data -- --declarations` (also wired into the new-year refresh
playbook above).

Current thresholds (`THRESHOLDS` constant in the script — keep narrow):

| Category | Threshold |
|---|---|
| Real estate | > 5M BGN absolute, OR > 100k BGN/m² on the `perSqmAnchor` area (building first, plot as fallback — shared with Layer 1) |
| Vehicle | > 500k BGN absolute, OR > 150k BGN for cars > 15 years old |
| Bank / cash | > 50M BGN per row |
| Receivable | > 100M BGN per row (Peevski's 19M legitimate row sits well below) |
| Investment / security | > 50M BGN per row |

For each flagged row the operator decides:

1. **Real typo** — add an entry to the matching override table in
   `parse_declaration.ts` keyed by sourceUrl (use the persistent prefix
   when the same row appears across years), then re-run
   `scripts/declarations/rebuild_all_from_cache.ts`. The flagger should
   stop reporting the row on the next run.
2. **Legitimate large holding** — leave it alone. It will keep flagging
   on every check; that's intentional. Don't widen the threshold to make
   one row pass — that risks silencing the next typo at the same
   magnitude.
3. **Wrong field, not wrong value** (e.g. a 3000 m² plot entered as
   "3 m²" with the price intact) — neither override nor accept fixes
   this. Flagging is correct; we don't currently support area overrides.
   Note it on the spreadsheet of "known data-entry errors we live with"
   and move on. The article §6 already calls this case out for the
   Pavlov 2021 typo.

### Adding a new typo override — worked example

Operator sees this on the flagger:

```
▸ Стратсимир Илков Павлов — real_estate
  33,383,100 BGN — real-estate value > 5,000,000 BGN
  апартамент | гр.Варна | 71.14 m² | acquired 1999
  declaration 2021: https://register.cacbg.bg/2021_nc/BA28CE20-4161-418F-A6A7-F02741296A4B125934.xml
```

The companion office (41 m², same year) on the same declaration is 27,169
BGN — the magnitude gap is the tell. Add to `REAL_ESTATE_VALUE_OVERRIDES`:

```ts
{
  sourceUrlContains: "BA28CE20-4161-418F-A6A7-F02741296A4B125934",
  location: "Варна",
  areaSqm: 71.14,
  rawValue: 33383100,
  correctedValue: 33383,
  note: "Corrected: declarant misplaced separator (source value 33,383,100 BGN for 71m² Varna apartment).",
}
```

Re-run `npx tsx scripts/declarations/rebuild_all_from_cache.ts`. The
flagger no longer reports the row, and the assets ranking / candidate
page now show the corrected value.

## Debug knobs

Three env vars on the declarations script for debugging without re-fetching everything:

```bash
DECL_YEARS=2025 npm run data -- --declarations           # default
DECL_LIMIT=20 npm run data -- --declarations             # first 20 declarations only
DECL_MP_NAME=ИВЕЛИН npm run data -- --declarations       # only MPs whose normalized name contains "ИВЕЛИН"
```

`DECL_MP_NAME` does substring matching after normalization, so `ИВЕЛИН` matches `ИВЕЛИН ЛЮДМИЛОВ МИХАЙЛОВ`. Useful for debugging a single MP's data without burning 10 minutes on the full set.

For the TR side, `--limit N` on `--reconstruct` replays only the first N days (smoke test — verifies the parser without rebuilding the full state).

## What this skill does NOT do

- **Does not refresh `public/parliament/index.json`.** That's the parliament-scrape skill's job. This pipeline reads the index but never writes it. If you see lots of `no MP match` warnings, run parliament-scrape first.
- **Does not reconcile married names** to maiden names. There is no name-alias table. Affected MPs simply won't have declarations linked.
- **Does not pull historical TR snapshots.** The TR dataset is a stream of daily filings; `--reconstruct` replays them to a single "current state" SQLite. There is no "TR as of 2022-12-31" mode.
- **Does not run during `npm run prod`'s default flow.** Only `parseElections` runs by default. You must pass `--declarations` (and optionally refresh TR beforehand). This is intentional — the chain takes minutes and depends on external services.

## File map

| Path | Purpose |
|---|---|
| `scripts/declarations/index.ts` | Phase 1 entry. Walks register.cacbg.bg, writes per-MP JSON, then chains into the officials bridge + phases 6/7/8. |
| `scripts/declarations/parse_declaration.ts` | XML → `MpDeclaration` (stakes + income tables). Also owns `REAL_ESTATE_VALUE_OVERRIDES` and `VEHICLE_VALUE_OVERRIDES` — narrow per-row corrections for declarant typos. |
| `scripts/declarations/check_suspicious_values.ts` | Flagger that prints any per-row BGN value above the heuristic thresholds. Run after every declarations refresh; informational exit code only. |
| `scripts/declarations/rebuild_all_from_cache.ts` | Re-parse every cached declaration XML and re-run every downstream builder, no network. Use after editing `parse_declaration.ts` (e.g. adding an override) so existing per-MP JSON files pick up the change. |
| `scripts/declarations/tr/cli.ts` | Phase 3 + 4 entry. Bulk + incremental + reconstruct subcommands. |
| `scripts/declarations/build_officials_company_links.ts` | Phase 4a. Officials ↔ company bridge (declared stakes + TR officer/owner name match, `trNamesakeCount`-gated) → `data/officials/derived/company_links.json`. |
| `scripts/declarations/build_assets_rankings.ts` | Per-MP wealth rollups + the cross-MP rankings file. |
| `scripts/declarations/build_car_makes.ts` | `car-makes.json` + `mp-cars.json`. |
| `scripts/declarations/build_data_provenance.ts` | Per-NS declaration-year window + filing rate. |
| `src/lib/companyNameFold.ts` | The declared-company-name fold that `src/data/parliament/consolidateStakes.ts` groups on — it replaced the `companySlug` key (2026-08-20). |
| `src/data/parliament/useConnectionsGraph.tsx` | RQ hook for connections.json. |
| `src/data/parliament/useConnectionsRankings.tsx` | RQ hook for rankings (dashboard tile). |
| `src/data/parliament/useMpConnections.tsx` | RQ hook for one MP's neighbourhood. |
| `src/data/parliament/useMpManagement.tsx` | RQ hook for one MP's management roles. |
| `src/screens/ConnectionsScreen.tsx` | Full graph + rankings + path-finding. |
| `src/screens/dashboard/MpConnectionsTile.tsx` | Top-MPs / top-companies tile filtered by selected election. |
| `src/screens/components/candidates/MpConnectionsMini.tsx` | Per-MP graph on the candidate page. |
| `src/screens/components/candidates/MpFinancialDeclarations.tsx` | Per-MP declaration listing. Reads `declarations/{mpId}.json`. |
| `src/screens/components/candidates/MpManagementRoles.tsx` | Per-MP management roles. Reads `mp-management/{mpId}.json`. |
| `src/screens/components/candidates/MpAvatar.tsx` | Reusable MP avatar with party-coloured ring (used everywhere connections list MPs). |

## Frontend integration cheat-sheet

If you change a script's output schema, update these in lockstep:

- `MpOwnershipStake`, `MpDeclaration`, `MpIncomeRecord` in `src/data/dataTypes.ts` — per-MP file shape. **[2026-08-20] `MpOwnershipStake.companySlug` is gone**, from the type, from the 556 committed shards and from the declarations loader's column list; a stake is grouped client-side by folding its raw declared name through `src/lib/companyNameFold.ts`.
- `ConnectionsNode`, `ConnectionsEdge`, `ConnectionsTopMp`, `ConnectionsTopCompany`, `ConnectionsRankings`, `ConnectionsGraph` in `src/data/dataTypes.ts` — graph + rankings shape.
- `TrCompanyOfficer`, `TrCompanyEnrichment`, `MpManagementRole`, `MpManagementFile` in `src/data/dataTypes.ts` — TR-derived shapes.

The match key everywhere in this pipeline is the parliament-scrape normalizer with the extra hyphen-spacing collapse: `name.toUpperCase().replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim()`. Don't introduce a second normalizer — it'll silently drift.
