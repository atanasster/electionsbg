---
name: update-connections
description: Refresh the MP business-connections data — pulls property/interest declarations from register.cacbg.bg (Court of Audit) and Commerce Registry filings from data.egov.bg, then rebuilds the connections graph, rankings, and per-MP files under public/parliament/. Use when the user asks to refresh declarations, update business connections, add a new declaration year (e.g. 2026 filings appear in spring), regenerate the connections graph, rebuild the Commerce Registry SQLite, or fix missing companies / management roles on candidate pages. Also use after a fresh git clone if `public/parliament/connections.json` or `companies-index.json` is missing.
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
```

Phases 1, 2, 5, 6 chain inside `parseFinancialDeclarations` (`scripts/declarations/index.ts:244-255`). Phases 3, 4 are kept out of `npm run prod` because they take 30-60 min and produce a 12 GB intermediate.

## TR refresh playbook

The Commerce Registry changes every business day. Refresh schedule:

- **First time** or **after >6 months**: `--bulk` (full snapshot).
- **Catching up <6 months**: `--index --incremental` (daily filings only).

Both finish with `--reconstruct` to rebuild the SQLite.

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

# Then rebuild aggregates (no upstream fetch)
npx tsx -e 'import("./scripts/declarations/tr/integrate").then(m => m.integrateTr({ publicFolder: "./public", rawFolder: "./raw_data", stringify: o => JSON.stringify(o, null, 2) }))'
npx tsx -e 'import("./scripts/declarations/build_connections_graph").then(m => m.buildConnectionsGraph({ publicFolder: "./public", rawFolder: "./raw_data", stringify: o => JSON.stringify(o, null, 2) }))'
```

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

4. **Spot-check the dashboard** at `/?_=` (cache-bust) — the "Бизнес връзки на депутатите" tile should show the new year reflected in any MP whose declarations grew. The tile filters by current parliament's NS folder; switch elections to verify older NSes still populate.

5. **Commit**:
   ```bash
   git add public/parliament/declarations public/parliament/companies-index.json \
           public/parliament/mp-management public/parliament/connections.json \
           public/parliament/mp-connections public/parliament/connections-rankings.json
   git commit -m "Refresh declarations for 2026 filing year"
   ```

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
register.cacbg.bg uses `"-"` as a "no value" sentinel in `itemType`, `companyName`, `holderName`, etc. Don't treat them as real strings (e.g. don't slugify `"-"`, don't display as company name). The per-stake `companyName` on `companies-index.json` was specifically removed for this reason — the parent `displayName` is the canonical reference.

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

### Why two stake schemas
The full `MpOwnershipStake` lives in `public/parliament/declarations/{mpId}.json` — `MpFinancialDeclarations.tsx` renders all of `itemType`, `companyName`, `registeredOffice`, `holderName`, `transfereeName`. The aggregated `companies-index.json` ships only a slim `CompanyIndexStake = Pick<MpOwnershipStake, "table" | "shareSize" | "valueBgn" | "legalBasis" | "fundsOrigin">` — the dropped fields are redundant with the parent `displayName` / `registeredOffices` or unused on the company page. Don't put removed fields back into the companies-index without verifying they're actually rendered — it adds ~10 KB brotli to a file loaded on every `/mp/companies` visit. See `scripts/declarations/build_company_index.ts:121-130`.

### Per-MP files vs aggregates
Per-MP files (`declarations/{mpId}.json`, `mp-management/{mpId}.json`) are **lazy** — the candidate page fetches one. Aggregates (`companies-index.json`, `connections-rankings.json`) are **eager** in the routes that use them. When trimming output, weigh field cost against load frequency: trimming `connections.json` matters more than trimming `mp-management/{mpId}.json`.

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
| `scripts/declarations/parse_declaration.ts` | XML → `MpDeclaration` (stakes + income tables). |
| `scripts/declarations/build_company_index.ts` | Phase 2. Aggregates per-MP stakes by company name. Defines `CompanyIndexStake` projection. |
| `scripts/declarations/tr/cli.ts` | Phase 3 + 4 entry. Bulk + incremental + reconstruct subcommands. |
| `scripts/declarations/tr/integrate.ts` | Phase 5. Joins TR SQLite into companies-index + emits mp-management/. |
| `scripts/declarations/build_connections_graph.ts` | Phase 6. Builds graph + per-MP neighbourhoods + rankings. Defines `nsFoldersForMp` backfill. |
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
