# electionsbg.com

A platform for visualizing and analyzing Bulgarian parliamentary elections, parliament composition, MP business interests, polling accuracy, and campaign financing — covering elections from 2005 to today. Live at [electionsbg.com](https://electionsbg.com).

## What's in here

The app started as election results visualization and has grown to cover the broader political picture. The current feature surface:

- **Elections** — results and turnout from settlement up to national level for every parliamentary election since 2005, plus drill-down to the ~13,000 polling sections and side-by-side comparison across cycles.
- **Anomaly reports** — concentration, turnout outliers, top gainers/losers, invalid ballots, recount-flagged sections, voting-machine flash-memory corrections (SUEMG), risk neighborhoods.
- **Election integrity & risk analysis** (`/risk-analysis`) — a composite Election Risk Index per cycle; a per-section 0–100 risk-screening score from seven independent signals (recount delta, flash-memory mismatch, invalid ballots, day-of additions, vote concentration, peer-section outlier, and cross-election swing vs. the same section last cycle); per-party Benford 2BL tests; and a geographic risk-cluster map that groups physically adjacent same-party elevated-risk sections — the spatial fingerprint of a controlled / corporate vote.
- **Parties** — per-party regional/municipal/settlement performance, candidate preferences, vote-flow timelines, head-to-head comparisons, AI-generated campaign retrospects.
- **Candidates** — profile pages with regional results, preference votes, donations, declared assets, and business connections.
- **Parliament** — current and past MPs with bios, photos, declared assets, vehicles, and a graph of their business connections (companies they own or manage, plus shared officers and addresses). Each MP profile opens with a four-metric scorecard (party loyalty, attendance, declared net worth, contracts to connected firms) carrying a parliament-wide rank or median for context.
- **Public officials** — non-MP property and interest declarations for the executive branch (cabinet members, deputy ministers, state and executive agency heads, regional governors). Sourced from the same Court of Audit register that covers MPs (`register.cacbg.bg`). Sortable ranking at `/officials/assets` with filter chips per role, and a per-official profile page with assets summary, year-over-year delta, and the full declarations timeline. Mayors and judiciary live in the same upstream but are out of scope.
- **Governments** — coalition compositions and ministerial line-ups by parliamentary term.
- **Polls** — pre-election polls scraped from Wikipedia, accuracy metrics per agency, and editorial narratives.
- **Demographics** — Census 2021 overlays (age, education, ethnicity) at country/region/municipality level, plus annual sub-national indicators per municipality (registered unemployment, state-matura DZI scores, NSI year-over-year population change) with year-over-year deltas and a country-wide choropleth.
- **Campaign financing** — donors, income, expenses, donor leaderboards, parsed from the Court of Audit's Smetna Palata register.
- **Public procurement** — fortnightly OCDS contract bundles from the АОП (Агенция за обществени поръчки) feed on data.egov.bg, aggregated per contractor / awarding body / month, with an MP cross-reference layer that surfaces awards going to companies owned or managed by sitting MPs. Each contract row carries a 0–100 risk score combining four signals: contractor is on the АОП "Стопански субекти с нарушения" debarred-suppliers register, contractor is MP-tied, awarder concentration on this contractor ≥30% of its lifetime spending, and post-award amendment. Sortable column + chip tooltips per signal.
- **State budget** — consolidated execution time series from the data.egov.bg КФП feed, per-ministry appropriations parsed from the State Budget Law (Държавен вестник HTML), and per-ministry "Отчет за изпълнението на програмния бюджет" reports reconciled at admin + program grain (law → amended → executed). Cross-linked to procurement so each spending unit's awards show on its ministry page.
- **Macro & governance indicators** — `/indicators` cabinet-aligned timeline of GDP, HICP, fiscal balances (both as % of GDP and in nominal EUR — debt level, quarterly issuance Δ, deficit, current account, FDI, government revenue/expenditure), the **fiscal reserve** (фискален резерв — end-of-quarter stock with the statutory floor drawn as a reference line), EU funds, Eurobarometer trust, Worldwide Governance Indicators, Transparency CPI, and household-level series (poverty, Gini, youth unemployment, house-price YoY). Also: a sortable table of every Bulgarian sovereign debt emission — international Eurobonds (curated, since 2002) and domestic ДЦК auctioned by the BNB (scraped, 2019+) with ISIN, coupon %, settlement yield, term and maturity.
- **Vote flows** — transition matrices estimating where each party's votes moved between consecutive elections.
- **Articles** — long-form editorials and methodology notes (plain markdown, BG + EN).

A simulator at `/simulator` lets you redistribute votes and see the resulting seat allocation under Bulgaria's electoral formula.

## Tech stack

- **React 19** + **TypeScript** (strict), **Vite 6** with SWC
- **React Router v7** with every screen lazy-loaded
- **TanStack React Query v5** for all data fetching (`staleTime: Infinity`, no refetch on focus)
- **Tailwind CSS** + CSS Modules; **Radix UI** primitives with shadcn-style wrappers in `src/components/ui/`
- **Recharts** for charts, **D3** for Sankey/vote-flow diagrams, **Leaflet** for maps (CSS dynamically loaded so it stays off the landing critical path)
- **TanStack Table** for the data grids
- **react-markdown** for the long-form articles (plain `.md` with YAML frontmatter, not MDX)
- **i18next** with English and Bulgarian, preference stored in `localStorage`
- **Self-hosted Inter + Fraunces** under `/public/fonts/` (refreshed via `node scripts/fonts/fetch-fonts.mjs`)
- **Playwright** for E2E, SEO, performance, and responsive smoke tests
- **Firebase Hosting** for the SPA shell (rewrites in `firebase.json`)
- **Google Cloud Storage** (`gs://data-electionsbg-com`) for the data layer — fetched at runtime via the `dataUrl()` helper so data updates don't require a Firebase deploy
- **GitHub Actions** for the daily upstream watcher + ingest jobs (see `.github/workflows/`)

## Project layout

```
src/
  routes.tsx              All route definitions
  data/                   React Query hooks per domain (regions, municipalities,
                            settlements, sections, parties, candidates, parliament,
                            polls, governments, census, articles, voteFlows, ...)
  data/dataUrl.ts         Resolves data paths to local (dev) or GCS bucket (prod)
  data/ElectionContext    Selected election date — every data hook reads from here
  screens/                Page-level components matching the route structure
  screens/components/     Reusable cross-screen components
  components/ui/          Low-level UI primitives
  components/article/     Shared ArticleLayout + ArticleProse for long-form pages
  ux/                     Data tables, tooltips, touch handling, media queries
  locales/                i18n strings (also public/locales/ at runtime)

scripts/                  Offline data pipeline + watcher + bucket helpers
                            (see "Data pipeline" below)
public/                   App-bundle assets that ship through Firebase Hosting:
                            favicons, fonts, OG cards, sitemaps, llms.txt,
                            robots.txt, articles markdown + images
data/                     Election + parliament + polls + census JSON consumed
                            by the SPA at runtime. Served from GCS bucket in
                            production; Vite middleware mounts it at root in dev
state/                    Watcher fingerprints (`state/watch/`) and per-skill
                            ingest markers (`state/ingest/`) — committed so
                            the orchestrator survives multi-day gaps
raw_data/                 CIK CSV/ZIP exports and other inputs to the pipeline
data/_cache/              Cached upstream artifacts that the pipeline re-fetches
                            on demand (PDFs, XLSX). Gitignored except for
                            user-facing READMEs that explain manual workflows
                            (e.g. `minfin_fr_xlsx/README.md` for dropping
                            fiscal-reserve XLSX files past the Wayback cutoff)
docs/plans/               PRDs for in-flight and planned work
```

`@/*` is a tsconfig path alias for `src/*`.

## Local development

The generated election data under `data/2*/`, `data/sections/`, `data/settlements/`, `data/municipalities/`, and `data/regions/` is **not committed to git** — it is reproduced from `raw_data/` by the pipeline. After cloning:

```bash
npm install
npm run prod      # regenerate data/ from raw_data/ (a few minutes)
npm run dev       # start the Vite dev server
```

The Vite dev server includes a `serveDataDir` plugin (see `vite.config.ts`) that mounts `/data/` at the root of the dev server, so `fetch("/2026_04_19/national_summary.json")` resolves to `data/2026_04_19/national_summary.json` locally without needing the bucket.

In production the same fetch resolves to `https://storage.googleapis.com/data-electionsbg-com/2026_04_19/national_summary.json` because `VITE_DATA_BASE_URL` is set in `.env.production`. The `dataUrl()` helper in `src/data/` is the single seam — every data fetch goes through it.

### Other scripts

```bash
npm run build              # tsc -b && vite build, then OG images, prerender, llms.txt, image opt
npm run lint               # ESLint
npm run format             # ESLint --fix
npm run preview            # serve the production build locally
npm test                   # Playwright (also: test:ui, test:seo, test:perf, test:desktop, test:mobile)
npm run sitemap            # regenerate sitemap_*.xml (also auto-runs in postbuild)
npm run llms               # rebuild llms.txt and llms-full.txt
npm run census             # rebuild Census 2021 JSON from raw_data/census_2021/
npm run polls              # scrape + analyze polls + regenerate analysis narratives
npm run watch              # Tier-1 watcher: diff fingerprints across upstream sources
                           #   (also writes data-reports/<date>.md for the orchestrator)
npm run rollcall:scrape    # ingest new parliament.bg roll-call vote sessions
npm run derived:rebuild    # recompute MP loyalty / similarity / party cohesion
npm run bucket:sync        # incremental rsync of data/ to GCS bucket
npm run bucket:sync:dry    # same, but -n (preview only)
# Helpers invoked by Claude Code skills (no top-level wrapper):
#   npx tsx scripts/financing/scrape_index.ts          # Сметна палата annual-reports index
#   npx tsx scripts/parliament/scrape_mps.ts --all     # parliament.bg MP roster
#   npx tsx scripts/macro/fetch_eurostat.ts            # Eurostat + WGI + curated tables
#   npx tsx scripts/macro/fetch_cofog.ts               # Eurostat COFOG (gov_10a_exp) general-gov spend by function → data/cofog.json
#   npx tsx scripts/macro/fetch_eu_peers.ts            # Eurostat gov_10a_main (BG + EU + CEE peers, % of GDP) → data/macro_peers.json
#   npx tsx scripts/macro/fetch_bnb_auctions.ts        # BNB domestic ДЦК auctions → debt-emissions-domestic.json
#   npx tsx scripts/macro/fetch_fiscal_reserve.ts      # minfin.bg fiscal-reserve mreport/BULETIN/FRA XLSX → data/_cache/fiscal-reserve.json
#   npx tsx scripts/regional/fetch_eurostat.ts         # Eurostat NUTS 3 (per oblast) indicators
#   npx tsx scripts/indicators/fetch.ts                # AZ unemployment + МОН DZI per municipality
#   npx tsx scripts/stamp-ingest.ts <skill>            # mark a skill ingest as successful
npm run procurement:ingest        # АОП fortnight OCDS bundles → data/procurement/
npm run procurement:ingest-legacy # АОП annual CSVs (pre-2026) → data/procurement/
npm run budget:ingest             # data.egov.bg КФП feed + State Budget Law (DV HTML)
                                  #   + per-ministry execution reports → data/budget/
npm run deploy             # Firebase deploy (production)
npm run deploy:fast        # Firebase deploy without re-running the data pipeline (SKIP_PREDEPLOY=1)
npm run staging            # Firebase deploy (staging)
npm run staging:fast       # same with SKIP_PREDEPLOY=1
npm run stats              # bundle size visualizer
```

## Data flow

1. Raw inputs live in `raw_data/` — CIK CSV/ZIP exports per election, NSI Census XLSX, scraped Wikipedia/Smetna-Palata/parliament.bg/Court-of-Audit data.
2. The pipeline in `scripts/` transforms those into static JSON under `data/YYYY_MM_DD/` (per election) and a handful of cross-cutting directories (`data/parliament/`, `data/polls/`, `data/census/`, `data/governments.json`, etc.).
3. The SPA fetches those JSON files via the `dataUrl()` helper, which prefixes the bucket origin in production. There is no backend server, no database, and no runtime API.

### Architecture: Firebase shell + GCS data layer

The site is split across two origins to decouple data updates from app deploys:

- **Firebase Hosting** (`electionsbg.com`) serves the SPA shell: prerendered HTML, JS bundle, fonts, OG cards, sitemaps, articles markdown, favicons. Anything in `/public/` ships here. SPA rewrites and per-route prerendering live in `firebase.json`.
- **GCS bucket** (`gs://data-electionsbg-com`) serves the data layer: per-election JSON, parliament/, polls/, census/, declarations/. Anything in `/data/` syncs here via `npm run bucket:sync`.

A scraper writing fresh polls or roll-call data only needs `npm run bucket:sync` — no Firebase deploy. App code changes still need a deploy because the prerendered HTML (~445k files) ships through Firebase. Both bucket and Firebase are gzipped; the bucket has CORS open to all SPA origins.

### Data layout

Files and directories the SPA fetches at runtime — all under `/data/` locally and `gs://data-electionsbg-com/` in production:

| Path | Contents |
|---|---|
| `YYYY_MM_DD/` | Per-election results, reports, party assessments, candidate data, financing |
| `parliament/` | MP index, profiles, declarations, business-connections graph, companies index, cached MP photos (.webp), roll-call sessions + derived metrics |
| `officials/` | Non-MP property/interest declarations from the same Court-of-Audit register: per-slug declarations under `declarations/<slug>.json`, plus `index.json` (role + institution) and `assets-rankings.json` (net worth + YoY delta, with `byCategory` slices for cabinet / agency heads / regional governors) |
| `polls/` | Polls, agencies, accuracy metrics, narrative analyses |
| `census/` | Per-region and per-municipality Census 2021 slices |
| `regions/` `municipalities/` `settlements/` `sections/` | Geography-keyed per-location detail (gitignored — regenerated by `npm run prod`) |
| `transitions/` | Vote-flow transition matrices between consecutive elections |
| `maps/` | Per-region/municipality GeoJSON slices |
| `canonical_parties.json` | Master party register (name variants, history, colors) |
| `governments.json` | Government coalitions and ministers by parliamentary term |
| `parliament_groups.json` | Parliamentary group (faction) memberships |
| `macro.json` | Macroeconomic + governance indicators for the cabinet timeline (Eurostat GDP/HICP/unemployment, fiscal triple as % of GDP + nominal EUR, FDI inward, government revenue/expenditure, World Bank WGI, Transparency International CPI, Eurobarometer trust, EU funds, plus the **fiscal-reserve** end-of-quarter stock series derived from minfin.bg monthly bulletins) |
| `cofog.json` | General-government expenditure by COFOG-99 function from Eurostat `gov_10a_exp` (S13, annual, MIO_NAC converted at the 1.95583 BGN/EUR parity). Top-level functions GF01..GF10 + TOTAL, plus a per-function 27-member EU peer band (BG rank + EU27 average). Drives the **functional-classification** tile, the **"what did your taxes buy"** calculator, and the per-function peer chips on `/budget` |
| `macro_peers.json` | Eurostat `gov_10a_main` (S13, annual, % of GDP). Carries two cuts: a 5-country series (BG, EU27, RO, HU, PL) for the multi-year sparklines on the `/governance` peer-comparison tile, and a 27-member EU peer band (BG rank + EU27 average) per naItem for the `/budget` headline-card peer chips |
| `debt-emissions.json` + `debt-emissions-domestic.json` | Sovereign debt emissions list. International Eurobonds since 2002 are hand-curated (`debt-emissions.json`); domestic ДЦК auctions 2019+ are scraped from BNB Fiscal Agent pages (`debt-emissions-domestic.json`). Merged client-side on `/indicators` into one sortable table |
| `regional.json` | Per-oblast Eurostat NUTS 3 indicators (GDP per capita, population, net migration) — drives the drilldown tile and the `/demographics` choropleth |
| `indicators.json` | Per-municipality annual indicators (registered unemployment from Агенция по заетостта, DZI matura scores from МОН via data.egov.bg) — drives the municipality drilldown tile and the muni-granularity `/demographics` choropleth, with Sofia city aggregate fallback for the 24 districts |
| `procurement/` | Public-procurement contracts from АОП via data.egov.bg: per-month `Contract[]` shards under `contracts/<YYYY>/<YYYY-MM>.json`, per-contractor and per-awarder rollups, an MP cross-reference (`derived/mp_connected.json`, `derived/top_contractors.json`, `derived/flow.json`, `derived/awarder_concentration.json`), the АОП debarred-suppliers register snapshot (`debarred.json`, merge-on-write so historical entries persist after the upstream purges them), plus `index.json` + `bundles.json` |
| `budget/` | State-budget data: `kfp.json` (consolidated execution time series + monthly snapshots from data.egov.bg КФП), `facts/` (per-ministry BudgetFacts at law/amendment/execution stage, admin + program grain), `classification/` (administrative + program registries), `reconciliation/` (law → amended → executed roll-up), `ministries/` (per-spending-unit slices the ministry screen reads one file from), `derived/` (admin-flow Sankey, plan-vs-actual variance), `documents.json` (law + amendment + execution document index), `crosswalk-overrides.json`, `index.json` |
| `census_2021.json`, `census_2021_settlements.json` | Census aggregates |
| `problem_sections_stats.json` | Risk-neighborhood summary stats |

Files that stay on Firebase Hosting (under `/public/`):

| Path | Contents |
|---|---|
| `articles/` | Long-form `.md` content + image attachments (rendered by react-markdown) |
| `og/` | Pre-generated Open Graph share images |
| `fonts/` | Self-hosted Inter + Fraunces .woff2 |
| `sitemap_*.xml`, `robots.txt`, `llms.txt`, `llms-full.txt` | Crawler artifacts (must be at site origin) |
| favicons, app icons, `site.webmanifest` | PWA + browser chrome |

## Data pipeline (`scripts/`)

The CLI entry point is `scripts/main.ts` (cmd-ts). Flags select which stages to run:

| Flag | Stage |
|---|---|
| `--all` / `-a` | Run every stage below |
| `--prod` / `-p` | Minify output JSON (otherwise pretty-printed for diffability) |
| `--date` / `-d` | Restrict to a single election date `YYYY_MM_DD` |
| `--election` / `-e` | Restrict to a single named election |
| `--reports` / `-r` | Anomaly reports (concentration, turnout, top-gainers/losers, invalid, recount, problem sections) |
| `--stats` / `-s` | National aggregates |
| `--search` / `-c` | Full-text search indices |
| `--financing` / `-f` | Smetna Palata campaign financing |
| `--parties` | Per-party regional/municipal/settlement aggregations + vote swings |
| `--machines` / `-m` | SUEMG voting-machine flash-memory corrections |
| `--candidates` / `-n` | Candidate preferences |
| `--declarations` | MP financial declarations + Commerce Registry → connections graph |
| `--flows` / `-w` | Vote-transition matrices between consecutive elections |
| `--coords` / `-g` | Backfill polling-section GPS coordinates |
| `--summary` / `-u` | Summary-only report regeneration |

`npm run prod` runs `tsx scripts/main.ts --all --prod`.

Pipeline subdirectories of note:

- `parsers/` — CIK results, party canonicalization, candidate dedup
- `parliament/` — scraper for MP photos (re-encoded to .webp via sharp), bios, term history from parliament.bg
- `parliament/rollcall/` + `scrape_rollcall.ts` — roll-call vote ingest (per-session CSVs from stenogram attachments → `data/parliament/votes/sessions/<date>.json`)
- `parliament/derived/` — MP loyalty, MP-MP cosine similarity, per-party cohesion (recomputed weekly from session JSONs)
- `declarations/` — Court-of-Audit property/interest filings + Commerce Registry → MP↔company graph, rankings, per-MP 1-hop subgraphs
- `smetna_palata/` — campaign financing parsing
- `polls/` — Wikipedia scrape + accuracy analysis + narrative generation
- `parties/` — per-party data bundling and AI-generated campaign retrospects
- `census/` — NSI Census 2021 ingestion
- `voteFlows/` — transition matrices between consecutive elections
- `machines_memory/` — SUEMG flash-memory corrections
- `macro/` — Eurostat + World Bank + curated economic / governance indicators (with absolute-floor + 10% regression check per indicator); also `fetch_bnb_auctions.ts`, which scrapes the BNB Fiscal Agent auction archive (`https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/`) into `data/debt-emissions-domestic.json` — one row per auction event, handles both EUR and BGN, flags bids-rejected auctions, no parser failures across 2019-present; and `fetch_fiscal_reserve.ts`, the multi-source fiscal-reserve ingest. The Bulgarian Ministry of Finance publishes the фискален резерв figure in three parallel filename series on `minfin.bg/upload/` — `mreport_<Month><YYYY>_bg.pdf` (Институт за анализи и прогнози monthly economic review with a КФП summary table carrying ~12 months of rolling values), `BULETIN_<MonthName>_<YYYY>.pdf` (Информационен бюлетин: Изпълнение на държавния бюджет, narrative press-bulletin with the single end-of-month figure inline), and `FRA-MM-YYYY-BG.xlsx` (authoritative single-month spreadsheet from the dedicated `/bg/statistics/4` page). Live minfin.bg is Cloudflare-WAF blocked, so the script reads everything indirectly via Wayback Machine `id_` URLs; XLSX months past the Wayback cutoff (~Apr 2025) drop manually into `data/_cache/minfin_fr_xlsx/` (see the README there). All three sources flow into a per-month MEDIAN-of-votes step so a single misaligned PDF reading can't poison the series. The XLSX parser detects unit (`(млн. лв.)` vs `(млн. евро)`) and normalises across the 2026-01-01 euro adoption boundary using the fixed currency-board rate; the round-trip is exact and the chart is continuous across the transition.
- `regional/` — Eurostat NUTS 3 (oblast-level) indicators for the `/municipality/<code>` drilldown tile and the `/demographics` regional choropleth (per-oblast floor + 10% regression check)
- `indicators/` — Annual sub-national indicators pulled from multiple BG sources (AZ годишен обзор for registered unemployment, МОН via data.egov.bg for DZI scores). Source-pluggable: `sources/<source>.ts` files normalise to a common shape, `_name_aliases.json` carries the manual code/name overrides, `build.ts` merges to `data/indicators.json`. Floor + match-rate safety checks per source.
- `procurement/` — АОП public-procurement ingest. `ingest.ts` walks the data.egov.bg dataset listing for the АОП org, downloads each fortnight bundle (cached gzipped under `raw_data/procurement/`), normalizes the OCDS releases into flat `Contract` rows via `normalize.ts`, writes month-shards under `data/procurement/contracts/`, then rebuilds per-EIK rollups (`rollups.ts`), MP cross-reference (`cross_reference.ts`, EIK-keyed against `companies-index.json`), and the journalism payload (`derived.ts` — top contractors + sankey-shaped flow). `ingest_legacy.ts` handles pre-OCDS annual CSV dumps (2011-2023). Canary fixture + diff-cap + amount sanity checks in `validate.ts`.
- `budget/` — Bulgarian state-budget ingest. `ingest.ts` is the CLI entry point; three pillars share it. `kfp.ts` parses the data.egov.bg КФП feed (monthly consolidated execution snapshots → `kfp.json`). `law_html.ts` parses each year's State Budget Law from Държавен вестник HTML into per-spending-unit appropriations (admin + program grain at `stage: "law"`) plus the Чл. 1 framework totals (planned revenue tree, Section II/III/IV headlines → `derived/law_framework.json`). `execution_pdf.ts` / `execution_borderless_pdf.ts` / `execution_xlsx.ts` parse each ministry's "Отчет за изпълнението на програмния бюджет" (PDF or XLSX-in-ZIP) — hand-curated in `EXECUTION_REPORTS` per fiscal year — and emit `stage: "amendment"` (уточнен план) + `stage: "execution"` (отчет) facts. `reconcile.ts` joins law + amendment + execution at admin and program grain; `facts.ts` builds economic-grain plan-vs-actual variance from the КФП feed; `cross_reference.ts` joins spending units to procurement awarders; `derived_admin_flow.ts` builds the Sankey payload (per-ministry planned + framework planned revenue/transfers/EU/balance so the admin view tells a coherent planned-vs-planned story); `ministries.ts` slices per-ministry rollups so the ministry screen loads one small file. Six pinned canaries in `validate.ts` (КФП resource, law year, four execution-report formats, economic facts).
- `financing/` — Сметна палата annual-reports index scraper (writes `data/financing/index.json`)
- `watch/` — Tier-1 daily watcher (8 upstream sources fingerprint-diffed → daily markdown report under `data-reports/` + per-source state under `state/watch/`, see "Continuous data refresh" below)
- `lib/upload.ts` — shared GCS upload helpers (gzipped text via `gsutil cp -Z`, binaries as-is)
- `lib/ingest-state.ts` — per-skill ingest-marker helpers consumed by `scripts/stamp-ingest.ts` and the `/process-watch-report` orchestrator
- `fonts/fetch-fonts.mjs` — one-shot fetcher for self-hosted Inter + Fraunces
- `reports/`, `party_stats/`, `preferences/`, `search/`, `stats/`, `recount/` — analytical and aggregation stages
- `og/`, `prerender/`, `sitemap/`, `images/`, `llms/` — build-time output (run from `postbuild`)

Some narrative content is generated with LLMs:

- `polls:gen-analysis` calls Anthropic Claude (requires `ANTHROPIC_API_KEY`)
- `party:gen-retrospect` calls Google Gemini (requires `GEMINI_API_KEY`)

Both are written to JSON consumed by the SPA — there are no LLM calls at runtime.

## Maintenance skills (Claude Code)

For contributors using [Claude Code](https://claude.com/claude-code), the repo includes project-specific skills under `.claude/skills/` for the recurring data-refresh workflows:

| Skill | What it does |
|---|---|
| `process-watch-report` | Orchestrator. Compares `state/watch/*.json` against `state/ingest/*.json` and runs every tier-2 skill whose mapped sources have changed since its last successful ingest. Survives multi-day gaps. |
| `update-connections` | Refresh MP declarations + Commerce Registry, rebuild the connections graph, flag suspicious declared values. |
| `update-officials` | Refresh non-MP declarations (cabinet, state-agency heads, regional governors) from the same Court-of-Audit register; reuses the MP declarations parser, writes per-slug files + `index.json` + `assets-rankings.json` under `data/officials/`. |
| `update-polls` | Scrape new polls from Wikipedia, recompute accuracy, write the per-election narrative. |
| `update-rollcall` | Ingest new parliament.bg roll-call vote sessions. Validates against a canary fixture; tracks unresolved MP ids without dropping them. |
| `update-financing` | Refresh the Сметна палата annual-reports year index (`data/financing/index.json`). |
| `update-macro` | Refresh `data/macro.json` from Eurostat + World Bank + curated tables. |
| `update-regional` | Refresh `data/regional.json` from Eurostat NUTS 3 (per-oblast GDP/capita, population, net migration). |
| `update-indicators` | Refresh `data/indicators.json` — annual per-municipality registered unemployment from Агенция по заетостта and DZI matura scores from МОН via data.egov.bg. Source-pluggable; new annual sub-national indicators slot in with one source file. |
| `update-procurement` | Ingest АОП fortnight OCDS bundles from data.egov.bg into `data/procurement/`. Normalizes releases into per-month `Contract` shards, rebuilds per-contractor / per-awarder rollups, runs the MP cross-reference (EIK-joined against `companies-index.json`) to surface contracts going to companies tied to sitting MPs, derives the awarder→contractor concentration index for the risk-score, and (Step 5) refreshes the АОП debarred-suppliers snapshot via `scripts/procurement/debarred.ts`. Canary-pinned with a diff-cap; pre-OCDS years (2011-2023) are backfilled via the sibling `procurement:ingest-legacy` script. |
| `update-budget` | Ingest state-budget data into `data/budget/`. Two ingest paths share one CLI: the data.egov.bg КФП feed (consolidated execution time series + monthly snapshots) and per-ministry "Отчет за изпълнението на програмния бюджет" reports (admin + program grain reconciled against the State Budget Law). Six pinned canaries; admin-grain sanity checks per ministry. |
| `parliament-scrape` | Scrape MP photos/bios/seat data from parliament.bg (run after a new parliament is seated). |
| `party-retrospect` | Generate per-party campaign retrospects. |

Every tier-2 ingest skill has a "Data-integrity contract" section in its `SKILL.md` enumerating fail-loud surfaces (HTTP errors, schema drift, canary mismatch, count-floor / regression breaches) and intentional non-fatal skips. The orchestrator halts on first downstream failure and refuses to stamp `state/ingest/<skill>.json` until a clean run.

These can also be run by hand via the npm scripts and the `scripts/` CLI flags listed above.

## Continuous data refresh

Two-tier model.

**Tier 1 — daily watcher.** `npm run watch` (`scripts/watch/index.ts`) fingerprint-diffs 21 upstream sources (parliament.bg MPs + votes, BG Wikipedia polls, register.cacbg.bg declarations — MP slice, register.cacbg.bg declarations — executive officials slice, Сметна палата party financing, data.egov.bg Commerce Registry, data.egov.bg АОП procurement, АОП debarred-suppliers register, data.egov.bg КФП state-budget execution, per-ministry "Отчет за изпълнението на програмния бюджет", Eurostat macro (15 datasets including FDI flows), Eurostat regional NUTS 3, EC "EU spending and revenue" per-Member-State XLSX, BNB domestic ДЦК auctions, **minfin.bg КФП monthly bulletins via Wayback** (mreport + BULETIN PDFs + FRA-MM-YYYY-(BG\|EN).xlsx — feeds the fiscal-reserve series), Агенция по заетостта годишен обзор, МОН ДЗИ via data.egov.bg, НСИ population timeseries, Transparency International CPI, World Bank WGI) and writes:
- `data-reports/<YYYY-MM-DD>.md` + `data-reports/latest.md` — human-readable daily snapshot
- `state/watch/<source>.json` — per-source `lastChanged` + `lastChecked`

Each source declares a `cadence` (`daily` / `weekly` / `monthly`); the runner honours it by skipping a source whose `lastChecked` is younger than the cadence window. The watcher itself still runs daily, but a "monthly" source like Transparency International CPI is only actually fingerprinted once every ~29 days — handy for annual-release upstreams that don't move often.

Scheduled via a local Claude Desktop routine — runs from the contributor's machine so source-blocking on cloud-runner IPs (data.egov.bg in particular) doesn't apply. CIK is omitted in v1; its endpoint sits behind Cloudflare and needs a Playwright-based fetch.

**Tier 2 — on-demand ingest.** Tell Claude Code `process-watch-report` (or "sync data based on the watcher"). The orchestrator compares `state/watch/*.json` against `state/ingest/<skill>.json` and runs only the skills whose mapped sources have advanced since their last successful ingest. Multi-day gaps are handled correctly — the decision is state-driven, not based on the latest report file alone.

`.github/workflows/` keeps two workflow_dispatch-only jobs for heavier ingest paths that need the bucket service account:

| Workflow | Trigger | What it does |
|---|---|---|
| `ingest-rollcall.yml` | `workflow_dispatch` + `repository_dispatch` | Runs `scrape_rollcall.ts` end-to-end (validates against the canary fixture, uploads to the bucket). Same skill as `/update-rollcall` but from CI. |
| `rebuild-derived.yml` | weekly Sunday 23:00 UTC | Recomputes loyalty / similarity / cohesion from the accumulated session JSONs. |
| `test.yml` | on PRs | Lint + Playwright. |

See `docs/plans/data-watch-ingest-pipeline.md` for the full spec.

## Environment variables

`.env.local` (gitignored — secrets):

```
ANTHROPIC_API_KEY=...   # only for npm run polls:gen-analysis
GEMINI_API_KEY=...      # only for npm run party:gen-retrospect
```

Both keys are optional unless you're regenerating the AI-written narratives. (`vite.config.ts` historically injected `GEMINI_API_KEY` into the frontend bundle as `process.env.API_KEY`, but no `src/` code currently consumes it.)

`.env.production` (committed — public bucket URL):

```
VITE_DATA_BASE_URL=https://storage.googleapis.com/data-electionsbg-com
```

Empty in dev so the Vite middleware serves data from local `/data/`. The `dataUrl()` helper handles both cases transparently.

## Deployment

The SPA shell deploys to Firebase Hosting; the data layer syncs to the GCS bucket.

**Firebase Hosting (SPA shell):**

- `npm run deploy` → production (`elections-bg`)
- `npm run staging` → staging (`electionsbg-staging`)
- `npm run deploy:fast` / `npm run staging:fast` → skip the predeploy data pipeline (`SKIP_PREDEPLOY=1`)

Both run the full data pipeline as `predeploy` unless skipped. SPA rewrites and per-route prerendering are configured in `firebase.json`; prerendered HTML (~445k files: per-candidate, per-section, per-settlement) is generated by `scripts/prerender/` during `postbuild` so crawlers see populated `<meta>` tags.

**GCS bucket (data layer):**

- `npm run bucket:sync` → incremental rsync of `data/` (text gzipped via `-j json,svg,xml,txt,html,css,md`, binaries as-is)
- `npm run bucket:sync:dry` → preview without uploading

After most data updates (new polls, scraped roll-calls, refreshed declarations) only the bucket needs to update — no Firebase deploy. Deploy time for SPA changes alone is ~20 min; data-only updates are seconds.

Bucket conventions:
- Cache-Control: `public, max-age=3600, stale-while-revalidate=604800`
- Content-Encoding: `gzip` for text via `gsutil cp -Z` / `rsync -j`
- CORS: open `GET, HEAD` from all SPA origins (see `scripts/gcs-cors.json`)

## Data sources

### GeoJSON

- [Regions, municipalities, and settlements](https://github.com/yurukov/Bulgaria-geocoding/tree/master) — modified to split Sofia city into its 3 electoral regions and to carve out the Plovdiv city region.
- [Sofia city districts](https://sofiaplan.bg/api/) — optimized and merged into the region maps.
- [World countries](https://github.com/johan/world.geo.json) — grouped by continent.
- [Continents](https://github.com/rapomon/geojson-places/tree/master) — grouped into a world map and simplified with [Mapshaper](https://mapshaper.org) and [geojson.io](https://geojson.io).

### Settlement names and locations

- [EKATTE catalog](https://www.nsi.bg/nrnm/ekatte/regions) — settlement names in English and Bulgarian.
- [Settlement locations](https://github.com/yurukov/Bulgaria-geocoding/blob/master/settlements_loc.csv).
- [World capitals](https://gist.github.com/ofou/df09a6834a8421b4f376c875194915c9).

### Election results (CIK)

- [19.04.2026](https://results.cik.bg/pe202604/opendata/index.html)
- [27.10.2024](https://results.cik.bg/pe202410/opendata/index.html)
- [09.06.2024](https://results.cik.bg/europe2024/opendata/index.html)
- [02.04.2023](https://results.cik.bg/ns2023/csv.html)
- [02.10.2022](https://results.cik.bg/ns2022/csv.html)
- [14.11.2021](https://results.cik.bg/pvrns2021/tur1/csv.html)
- [11.07.2021](https://results.cik.bg/pi2021_07/csv.html)
- [04.04.2021](https://results.cik.bg/pi2021/csv.html)
- [26.03.2017](https://results.cik.bg/pi2017/csv.html)
- [05.10.2014](https://results.cik.bg/pi2014/csv.html)
- [12.05.2013](https://results.cik.bg/pi2013/csv.html)
- [05.07.2009](https://pi2009.cik.bg/results/proportional/index.html)
- [25.06.2005](https://pi2005.cik.bg/results/)

### Campaign financing (Smetna Palata, Court of Audit)

- [27.10.2024](https://erik.bulnao.government.bg/Reports/Index/83)
- [09.06.2024](https://erik.bulnao.government.bg/Reports/Index/80)

### Other government and public sources

- [parliament.bg API](https://www.parliament.bg/) — MP profiles, photos, term history.
- [register.cacbg.bg](https://register.cacbg.bg/) — Court of Audit MP property and interest declarations.
- [data.egov.bg Commerce Registry dataset](https://data.egov.bg/) — daily Trade Register filings (companies, officers, status).
- [data.egov.bg АОП open-data feed](https://data.egov.bg/organisation/about/aop) — Агенция за обществени поръчки (АОП) fortnightly OCDS-standard public-procurement bundles (since 2026-01-01) and annual CSV dumps for prior years (2011-2023).
- [data.egov.bg КФП feed](https://data.egov.bg/) — Министерство на финансите Консолидирана фискална програма: monthly consolidated state-budget execution snapshots (revenue + expenditure by economic + functional grain).
- [Държавен вестник — State Budget Law](https://dv.parliament.bg/) — annual Закон за държавния бюджет (HTML) parsed for per-spending-unit appropriations at admin + program grain.
- Per-ministry "Отчет за изпълнението на програмния бюджет" — each first-level spending unit publishes its annual execution report (PDF or XLSX-in-ZIP) on its own site (minfin.bg WAF-blocked, so the report URL is hand-curated per ministry). Drives the law → amended → executed reconciliation.
- [Министерство на финансите — Фискален резерв](https://www.minfin.bg/bg/statistics/4) — authoritative monthly `FRA-MM-YYYY-BG.xlsx` end-of-month stocks. Read indirectly via Wayback Machine; months past the Wayback cutoff (~Apr 2025) drop manually into `data/_cache/minfin_fr_xlsx/`. The XLSX unit switched from `(млн. лв.)` to `(млн. евро)` on the 2026-01-01 euro adoption — the parser handles both.
- [Министерство на финансите — Месечен бюлетин (mreport)](https://www.minfin.bg/bg/statistics/5) — Институт за анализи и прогнози monthly economic review (PDF). КФП summary table carries the фискален резерв row across ~12 rolling months; used as a secondary source for cross-validating the FRA XLSX values through the median voter.
- [Министерство на финансите — Информационен бюлетин (BULETIN)](https://www.minfin.bg/bg/statistics/4) — narrative press-release bulletin with the single end-of-month fiscal-reserve figure stated inline (e.g. "Размерът на фискалния резерв към 28.02.2025 г. е 10,5 млрд. лв."). Third source for the same median voter.
- [European Commission — EU spending and revenue](https://commission.europa.eu/strategy-and-policy/eu-budget/long-term-eu-budget/2021-2027/spending-and-revenue_en) — annual per-Member-State XLSX (BG totals of EU expenditure and national contribution); feeds the `euFunds` / `euContribution` series on `/indicators`.
- [NSI Census 2021](https://census2021.bg/) — population, ethnocultural, economic characteristics.
- [Bulgarian Wikipedia](https://bg.wikipedia.org/) — pre-election polling tables (per parliamentary election).
- [Eurostat](https://ec.europa.eu/eurostat/) — quarterly/annual macro indicators (GDP, HICP, unemployment, fiscal balances both as % of GDP and in nominal EUR, government revenue/expenditure, FDI inward flows BPM6) and NUTS 3 oblast-level series (GDP per capita, population, net migration).
- [BNB Fiscal Agent auction archive](https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm) — domestic government securities (ДЦК) auctions 2019+; one HTML page per auction with emission number, term, coupon, weighted-average yield, amount sold. Scraped weekly into `data/debt-emissions-domestic.json`.
- [Luxembourg Stock Exchange](https://www.luxse.com/issuer/Bulgaria) + Ministry of Finance press releases — Bulgarian Eurobond issuances since 2002, hand-curated into `data/debt-emissions.json` (~20 issuances, ISIN/coupon/maturity/principal/lead arrangers per emission).
- [Агенция по заетостта — годишен обзор](https://www.az.government.bg/stats/4/) — registered unemployment per municipality (annual XLSX, 2016+).
- [МОН via data.egov.bg](https://data.egov.bg/data/view/066b4b04-d81d-444e-a61c-8ca0516079e4) — state-matura (DZI) results per school, aggregated to municipality level (annual CSV, 2022+).
- [НСИ Pop_6.1.1 timeseries](https://www.nsi.bg/bg/content/2975/) — annual population per municipality 2010+, used to derive year-over-year change rate.

### Election integrity

- [Anti-Corruption Fund (ACF)](https://acf.bg/) — risk-section analysis. Together with Bulgarian media reporting (Sega, Svobodna Evropa) and the [OSCE/ODIHR election-observation reports](https://www.osce.org/odihr/elections/bulgaria), it informs the curated list of risk neighborhoods (Roma-majority areas with the highest reported incidence of controlled / corporate voting) tracked by the risk-screening reports. The per-section risk score, the cross-election swing signal, and the risk-cluster map are all *derived* — computed from the CIK results above, not fetched from an external source.

## Contributing

Issues and PRs welcome.

- For SPA changes: `npm run lint && npm run build` then `npm test` (Playwright). The lint check is part of `predeploy`.
- For data-pipeline changes: run `npm run prod` locally and diff the resulting JSON against `git`. The roll-call ingest has a canary regression fixture at `tests/fixtures/parliament/votes/canary.json` — `npm run rollcall:scrape` validates against it and fails loud if the parser drifts.
- For new upstream sources: add a module under `scripts/watch/sources/` following the existing pattern, then a sibling `/update-<source>` skill under `.claude/skills/` for the ingest. See `docs/plans/data-watch-ingest-pipeline.md` for the full spec.
- Open PRDs and roadmap items live under `docs/plans/`.
