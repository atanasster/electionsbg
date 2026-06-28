---
name: update-connections
description: Refresh the MP business-connections data — pulls property/interest declarations from register.cacbg.bg (Court of Audit) and Commerce Registry filings from data.egov.bg, then rebuilds the connections graph, rankings, and per-MP files under public/parliament/. Also flags unrealistic-looking declared values (cars/apartments/assets) and walks the operator through adding a typo override. Use when the user asks to refresh declarations, update business connections, add a new declaration year (e.g. 2026 filings appear in spring), regenerate the connections graph, rebuild the Commerce Registry SQLite, fix missing companies / management roles on candidate pages, or investigate a suspicious-looking declared value flagged by the typo checker. Also use after a fresh git clone if `public/parliament/connections.json` or `companies-index.json` is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# MP business-connections data pipeline

Builds the `/connections` graph and the dashboard tile from two Bulgarian government sources:

- **register.cacbg.bg** — annual property/interest declarations (Сметна палата). Provides MP-declared ownership stakes.
- **data.egov.bg** dataset `2df0c2af-e769-4397-be33-fcbe269806f3` — daily Commerce Registry (TR / Търговски регистър) filings. Provides company officers, owners, status, seat, and historical role changes.

Sitting MPs cannot legally hold management roles (ЗПК Art. 35), so the two sources are complementary: declarations give you the *ownership* side, TR gives you the *management* side plus all co-officer/co-owner relationships needed to build a real graph.

## When to use which command

The pipeline has six phases. Pick the entry point based on what changed upstream:

| Intent | Command | Time | Network |
|---|---|---|---|
| **Refresh declarations only** (new filing year, e.g. 2026 filings appear) | `npm run data -- --declarations` | ~3-15 min | per-MP XML, ~1 req/150 ms |
| **Refresh declarations + rebuild graph** (default — declarations script chains into phases 2/5/6) | `npm run data -- --declarations` | same | same |
| **Refresh TR snapshot** (do this every few months — TR changes daily) | see "TR refresh playbook" below | ~30-60 min | one ~540 MB zip + replay |
| **Rebuild graph only** (after editing build script — no upstream fetch) | inline tsx invocation, see below | <30 s | none |
| **First-time bring-up** (fresh clone, no data) | TR bulk + reconstruct, then `--declarations` | ~1-2 h | full set |

**`npm run data -- --declarations` is the safe default.** It fetches register.cacbg.bg incrementally (XML files cached in `raw_data/declarations/{year}/`), then re-runs phases 2 (companies-index), 5 (TR integrate), and 6 (graph + rankings) every time. If the TR SQLite is missing, phases 5/6 run with reduced output and log a warning — `npm run prod` still succeeds.

To rebuild only the derived files without re-fetching declarations:
```bash
npx tsx -e '
import { buildCompanyIndex } from "./scripts/declarations/build_company_index";
import { integrateTr } from "./scripts/declarations/tr/integrate";
import { buildConnectionsGraph } from "./scripts/declarations/build_connections_graph";
const stringify = (o) => JSON.stringify(o, null, 2);
buildCompanyIndex({ publicFolder: "./public", stringify });
integrateTr({ publicFolder: "./public", rawFolder: "./raw_data", stringify });
buildConnectionsGraph({ publicFolder: "./public", rawFolder: "./raw_data", stringify });
'
```
Use this after editing any of the three scripts — it keeps the per-MP `declarations/{mpId}.json` files (the slow-to-fetch part) untouched and just regenerates the aggregates.

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
| `companies-index.json` | 1.1 MB / 89 KB / 48 KB | Aggregate by company. Per-stake fields trimmed to `CompanyIndexStake` projection — see "Why two stake schemas". |
| `mp-management/{mpId}.json` × ~440 | ~2.0 MB total | TR-derived management roles per MP, with confidence. Empty without TR. |
| `connections.json` | 2.5 MB / 218 KB / 136 KB | Cross-MP/company/person graph for `/connections`. Lazily fetched on that route only. |
| `mp-connections/{mpId}.json` × ~600 | ~4.2 MB total (median ~1.8 KB / max ~190 KB raw) | Per-MP 1-hop + co-officer-2-hop subgraph. Loaded on each candidate page (`MpConnectionsMini`). MPs with no neighbourhood get no file (fetch 404 → component renders nothing). |
| `connections-rankings.json` | 791 KB / 74 KB / 55 KB | Top-MPs / top-companies for the dashboard tile + `/connections` rankings card. **Loaded on every dashboard view** — keep it lean. |
| `companies-by-ekatte/{ekatte}-summary.json` × ~97 + `{ekatte}-page-NNN.json` paginated (50 companies / page) + `index.json` | ~1 MB total | Per-settlement shards backing the "Companies HQ'd here (MP-linked)" tile on settlement and Sofia capital pages, and the paginated detail screen at `/settlement/:id/companies` (or `/sofia/companies`). Sofia (`68134`) is the only place that needs >1 page today (7). Built from `companies-index.json`'s `ekatteHQ[]` field by `scripts/parliament/build_companies_by_settlement.ts`, after the connections-graph pass populates `mpRoles`. |
| `company-connections/{eik}.json` × ~6,900 (gitignored — `data/parliament/`) + `company-connections-stats.json` | ~25 MB total / 350 B | Per-EIK Commerce-Registry connections to people in power — read by `/company/:eik`. Lists the company's officers who personally hold public office (direct) and politicians reached one company-hop away (bridged). Built by `scripts/declarations/tr/build_company_connections.ts` from `state.sqlite` + `connections-search.json` + the executive & municipal officials indexes. The per-EIK dir is a regenerable build artifact (uploaded via `bucket:sync`); the stats summary IS committed. |

The four aggregate files at the bottom are **regenerated end-to-end on every run** of phases 2/5/6. The per-MP declaration files are append-only (one file per MP id; rewriting one file does not affect others).

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
public/parliament/declarations/         [Phase 4] state.sqlite
{mpId}.json                             reconstructState
       │                                          │
       ├─[Phase 2] buildCompanyIndex              │
       │       ▼                                  │
       │   companies-index.json ◄─────────────────┤
       │       │                                  │
       │       └─[Phase 5] integrateTr ◄──────────┘
       │              ▼
       │          companies-index.json (enriched with `tr` field)
       │          mp-management/{mpId}.json
       │              │
       └─[Phase 6] buildConnectionsGraph
                  ▼
              connections.json
              mp-connections/{mpId}.json
              connections-rankings.json
              connections-search.json ──┐
                                        │
                  [Phase 7] buildCompanyConnections (+ state.sqlite
                            + officials + officials/municipal indexes)
                                        ▼
                                  company-connections/{eik}.json
                                  company-connections-stats.json
```

Phases 1, 2, 5, 6, 7 chain inside `parseFinancialDeclarations` (`scripts/declarations/index.ts`). Phase 7 skips with a warning when `raw_data/tr/state.sqlite` is absent — same graceful-degradation contract as phases 5 and 6. Phases 3, 4 are kept out of `npm run prod` because they take 30-60 min and produce a 12 GB intermediate.

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

# Then rebuild every connections aggregate from disk (NO upstream fetch):
# companies-index → integrateTr → connections graph → company-connections →
# companies-by-ekatte/obshtina → officials bridge. Use this whenever the link
# logic changed (e.g. the TR-namesake fix) but cacbg/data.egov is unreachable.
npx tsx scripts/run-connections-rebuild.ts
```

> The runner runs `buildCompanyIndex` FIRST on purpose: the graph builder
> *appends* `mpRoles`, so running it against an already-graphed
> `companies-index.json` duplicates roles. It also keeps the committed formats
> (compact for the parliament artifacts, pretty/2-space for the officials
> `connections.json` + `company_links.json`) — don't hand-roll a
> `buildConnectionsGraph(...)` one-liner with pretty stringify or `./public`
> (the data root is `./data`), or you churn the whole file.

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

6. **Commit**:
   ```bash
   git add public/parliament/declarations public/parliament/companies-index.json \
           public/parliament/mp-management public/parliament/connections.json \
           public/parliament/mp-connections public/parliament/connections-rankings.json \
           data/parliament/company-connections-stats.json
   git commit -m "Refresh declarations for 2026 filing year"
   ```

## Data-integrity contract

This pipeline has two upstream stages — register.cacbg.bg (declarations XML) and data.egov.bg (Commerce Registry bulk JSON) — each with its own fail-loud surfaces. The shared rule: **never overwrite `data/parliament/{connections,companies-index,…}.json` with a partial result when an upstream stage failed mid-run**.

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
| TR SQLite not present at integrate-time | Integration step warns and returns null; `connections.json` is built without company management metadata | Optional enrichment; `npm run prod` should still succeed without it |
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

### Slug collisions across companies
Two distinct companies whose names differ only in casing or quote style slug to the same string (e.g. `"Хранител"` vs `"хранител"`). `build_company_index.ts` disambiguates by appending `-2`, `-3`, …. `MpCompanyScreen` decodes the slug and looks up by exact match — never assume one slug = one company without checking the index.

### `"-"` placeholder values in declarations
register.cacbg.bg uses `"-"` as a "no value" sentinel in `itemType`, `companyName`, `holderName`, etc. Don't treat them as real strings (e.g. don't slugify `"-"`, don't display as company name). The per-stake `companyName` on `companies-index.json` was specifically removed for this reason — the parent `displayName` is the canonical reference. `build_company_index.ts` also drops any group whose canonical display name slugifies to empty (a `"-"` only entry) so the connections graph doesn't grow a placeholder company node.

### Decimal/thousand separator typos in declared values
A non-trivial fraction of declared BGN values are off by 100×–1000× because the declarant typed thousand-separators where the form expected decimals (or vice versa). Without intervention these dominate the assets ranking and the per-MP wealth pages. The pipeline handles them via narrow per-row overrides plus an automated flagger — see "Typo and unrealistic-value detection" below for the override tables, the heuristic thresholds, and the decision flow.

### TR SQLite is optional
If `raw_data/tr/state.sqlite` is missing (e.g. fresh clone before TR bulk runs), `integrateTr` and `buildConnectionsGraph` log `no TR SQLite — skipping` and produce **partial** outputs:
- `companies-index.json` has no `tr` field on entries
- `mp-management/` is empty
- `connections.json` only contains MP↔company edges from declarations (no co-officers, no non-MP person nodes)

The build still succeeds; the frontend renders an empty TR card on `/mp/company/{slug}` and the graph is sparser. Run the TR refresh playbook to fill these in.

### TR confidence model
TR-only matches are name-based. The integrator emits three tiers, of which only two ship:
- **high** = full normalized name match AND (TR seat city contains the MP's region OR another MP from the same party already declared a stake in this UIC)
- **medium** = full normalized name match only
- **low / surname-only** = suppressed entirely (Bulgarian common names like Иван Иванов explode into hundreds of false positives)

The `/connections` page has a "high confidence only" filter; the dashboard tile already counts `highConfDegree` only. When investigating an MP's ties seriously, prefer the high-only view.

**TR-namesake guard (name-collision fix).** On top of the tiers above, every officer→power-person name match is gated on the name being **unique to a single TR company**. A name spread across multiple companies is almost always several distinct people (common Bulgarian names recur thousands of times), so attributing all those companies to one MP/official is a false positive. Three code paths enforce this, all keyed off the same idea:
- `build_connections_graph.ts` phase-3 — attributes a TR officer row to an MP only when the name maps to one company; otherwise it becomes a plain (non-MP) person node.
- `build_officials_company_links.ts` — a TR link is `high` only when unique among officials AND `trNamesakeCount === 1` (see `/update-officials`).
- `tr/build_company_connections.ts` — drops direct/bridged matches whose name maps to >1 TR company (the per-EIK `company-connections/` files behind `/company/:eik`), rather than grading them low.

This is what keeps a Горна Малина councillor off Софарма Трейдинг's billions and a Чирпан deputy-mayor off "Автомагистрали". The procurement side mirrors it in `scripts/procurement/cross_reference.ts` (see `/update-procurement`).

### Why two stake schemas
The full `MpOwnershipStake` lives in `public/parliament/declarations/{mpId}.json` — `MpFinancialDeclarations.tsx` renders all of `itemType`, `companyName`, `registeredOffice`, `holderName`, `transfereeName`. The aggregated `companies-index.json` ships only a slim `CompanyIndexStake = Pick<MpOwnershipStake, "table" | "shareSize" | "valueBgn" | "legalBasis" | "fundsOrigin">` — the dropped fields are redundant with the parent `displayName` / `registeredOffices` or unused on the company page. Don't put removed fields back into the companies-index without verifying they're actually rendered — it adds ~10 KB brotli to a file loaded on every `/mp/companies` visit. See `scripts/declarations/build_company_index.ts:121-130`.

### Per-MP files vs aggregates
Per-MP files (`declarations/{mpId}.json`, `mp-management/{mpId}.json`) are **lazy** — the candidate page fetches one. Aggregates (`companies-index.json`, `connections-rankings.json`) are **eager** in the routes that use them. When trimming output, weigh field cost against load frequency: trimming `connections.json` matters more than trimming `mp-management/{mpId}.json`.

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

**Persistent vs per-filing source URLs**: register.cacbg.bg URLs share a
UUID prefix that's the declarant's persistent identifier, with a 6-digit
trailing suffix per filing year. If the same MP files the same erroneous
row across multiple years, match by the **persistent prefix only** so one
override covers every year. Concrete example —
`D6FB7B43-A7B9-496A-BEA5-05040F3EB514` (Hakkı's prefix) covers his 2022,
2023, and 2024 filings of the same VW Golf row.

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
| Real estate | > 5M BGN absolute, OR > 100k BGN/m² when area is present |
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
| `scripts/declarations/index.ts` | Phase 1 entry. Walks register.cacbg.bg, writes per-MP JSON, then chains into phases 2/5/6. |
| `scripts/declarations/parse_declaration.ts` | XML → `MpDeclaration` (stakes + income tables). Also owns `REAL_ESTATE_VALUE_OVERRIDES` and `VEHICLE_VALUE_OVERRIDES` — narrow per-row corrections for declarant typos. |
| `scripts/declarations/check_suspicious_values.ts` | Flagger that prints any per-row BGN value above the heuristic thresholds. Run after every declarations refresh; informational exit code only. |
| `scripts/declarations/rebuild_all_from_cache.ts` | Re-parse every cached declaration XML and re-run every downstream builder, no network. Use after editing `parse_declaration.ts` (e.g. adding an override) so existing per-MP JSON files pick up the change. |
| `scripts/declarations/build_company_index.ts` | Phase 2. Aggregates per-MP stakes by company name. Defines `CompanyIndexStake` projection. |
| `scripts/declarations/tr/cli.ts` | Phase 3 + 4 entry. Bulk + incremental + reconstruct subcommands. |
| `scripts/declarations/tr/integrate.ts` | Phase 5. Joins TR SQLite into companies-index + emits mp-management/. |
| `scripts/declarations/build_connections_graph.ts` | Phase 6. Builds graph + per-MP neighbourhoods + rankings. Defines `nsFoldersForMp` backfill. |
| `scripts/declarations/tr/build_company_connections.ts` | Phase 7. Per-EIK company → people-in-power connections (direct officers + one-hop bridges) consumed by `/company/:eik`. Standalone via `npm run tr:build-company-connections`; also chained from `parseFinancialDeclarations` after phase 6. |
| `src/data/parliament/useCompanyIndex.tsx` | React Query hook for companies-index. Defines `CompanyIndexStake` mirror. |
| `src/data/parliament/useConnectionsGraph.tsx` | RQ hook for connections.json. |
| `src/data/parliament/useConnectionsRankings.tsx` | RQ hook for rankings (dashboard tile). |
| `src/data/parliament/useMpConnections.tsx` | RQ hook for one MP's neighbourhood. |
| `src/data/parliament/useMpManagement.tsx` | RQ hook for one MP's management roles. |
| `src/screens/ConnectionsScreen.tsx` | Full graph + rankings + path-finding. |
| `src/screens/MpCompanyScreen.tsx` | Company detail page. |
| `src/screens/AllMpCompaniesScreen.tsx` | Sortable list of all declared companies. |
| `src/screens/dashboard/MpConnectionsTile.tsx` | Top-MPs / top-companies tile filtered by selected election. |
| `src/screens/components/candidates/MpConnectionsMini.tsx` | Per-MP graph on the candidate page. |
| `src/screens/components/candidates/MpFinancialDeclarations.tsx` | Per-MP declaration listing. Reads `declarations/{mpId}.json`. |
| `src/screens/components/candidates/MpManagementRoles.tsx` | Per-MP management roles. Reads `mp-management/{mpId}.json`. |
| `src/screens/components/candidates/MpAvatar.tsx` | Reusable MP avatar with party-coloured ring (used everywhere connections list MPs). |

## Frontend integration cheat-sheet

If you change a script's output schema, update these in lockstep:

- `MpOwnershipStake`, `MpDeclaration`, `MpIncomeRecord` in `src/data/dataTypes.ts` — per-MP file shape.
- `CompanyIndexStake`, `CompanyIndexEntry`, `CompaniesIndexFile` — split between `scripts/declarations/build_company_index.ts` and `src/data/parliament/useCompanyIndex.tsx`. **Keep both definitions in sync** (TypeScript won't flag the mismatch — they're nominally separate types pointing at the same JSON).
- `ConnectionsNode`, `ConnectionsEdge`, `ConnectionsTopMp`, `ConnectionsTopCompany`, `ConnectionsRankings`, `ConnectionsGraph` in `src/data/dataTypes.ts` — graph + rankings shape.
- `TrCompanyOfficer`, `TrCompanyEnrichment`, `MpManagementRole`, `MpManagementFile` in `src/data/dataTypes.ts` — TR-derived shapes.

The match key everywhere in this pipeline is the parliament-scrape normalizer with the extra hyphen-spacing collapse: `name.toUpperCase().replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim()`. Don't introduce a second normalizer — it'll silently drift.
