# electionsbg.com

A platform for visualizing and analyzing Bulgarian parliamentary elections, parliament composition, MP business interests, polling accuracy, and campaign financing — covering elections from 2005 to today. Live at [electionsbg.com](https://electionsbg.com).

## What's in here

The app started as election results visualization and has grown to cover the broader political picture. The current feature surface:

- **Elections** — results and turnout from settlement up to national level for every parliamentary election since 2005, plus drill-down to the ~13,000 polling sections and side-by-side comparison across cycles.
- **Anomaly reports** — concentration, turnout outliers, top gainers/losers, invalid ballots, recount-flagged sections, voting-machine flash-memory corrections (SUEMG), risk neighborhoods.
- **Parties** — per-party regional/municipal/settlement performance, candidate preferences, vote-flow timelines, head-to-head comparisons, AI-generated campaign retrospects.
- **Candidates** — profile pages with regional results, preference votes, donations, declared assets, and business connections.
- **Parliament** — current and past MPs with bios, photos, declared assets, vehicles, and a graph of their business connections (companies they own or manage, plus shared officers and addresses).
- **Governments** — coalition compositions and ministerial line-ups by parliamentary term.
- **Polls** — pre-election polls scraped from Wikipedia, accuracy metrics per agency, and editorial narratives.
- **Demographics** — Census 2021 overlays (age, education, ethnicity) at country/region/municipality level.
- **Campaign financing** — donors, income, expenses, donor leaderboards, parsed from the Court of Audit's Smetna Palata register.
- **Vote flows** — transition matrices estimating where each party's votes moved between consecutive elections.
- **Articles** — long-form editorials and methodology notes (MDX).

A simulator at `/simulator` lets you redistribute votes and see the resulting seat allocation under Bulgaria's electoral formula.

## Tech stack

- **React 19** + **TypeScript** (strict), **Vite 6** with SWC
- **React Router v7** for ~80 routes, all wrapped in a shared `<Layout>`
- **TanStack React Query v5** for all data fetching (`staleTime: Infinity`, no refetch on focus)
- **Tailwind CSS** + CSS Modules; **Radix UI** primitives with shadcn-style wrappers in `src/components/ui/`
- **Recharts** for charts, **D3** for Sankey/vote-flow diagrams, **Leaflet** for maps
- **TanStack Table** for the data grids
- **i18next** with English and Bulgarian, preference stored in `localStorage`
- **MDX** for articles
- **Playwright** for E2E, SEO, performance, and responsive smoke tests
- **Firebase Hosting** with SPA rewrites in `firebase.json`

## Project layout

```
src/
  routes.tsx              All route definitions
  data/                   React Query hooks per domain (regions, municipalities,
                            settlements, sections, parties, candidates, parliament,
                            polls, governments, census, articles, voteFlows, ...)
  data/ElectionContext    Selected election date — every data hook reads from here
  screens/                Page-level components matching the route structure
  screens/components/     Reusable cross-screen components
  components/ui/          Low-level UI primitives
  components/article/     Shared ArticleLayout + ArticleProse for long-form pages
  ux/                     Data tables, tooltips, touch handling, media queries
  locales/                i18n strings (also public/locales/ at runtime)

scripts/                  Offline data pipeline (see "Data pipeline" below)
public/                   Pre-built JSON consumed by the SPA — see "Public data" below
raw_data/                 CIK CSV/ZIP exports and other inputs to the pipeline
```

`@/*` is a tsconfig path alias for `src/*`.

## Local development

The generated election data under `public/2*/`, `public/sections/`, `public/settlements/`, `public/municipalities/`, and `public/regions/` is **not committed to git** — it is reproduced from `raw_data/` by the pipeline. After cloning:

```bash
npm install
npm run prod      # regenerate public/ data from raw_data/ (a few minutes)
npm run dev       # start the Vite dev server
```

`npm run build` and `npm run deploy` run the data pipeline as part of `prebuild`/`predeploy`, so `npm run prod` is only needed manually for local dev or after a `git pull` that touched pipeline code.

### Other scripts

```bash
npm run build         # tsc -b && vite build, then OG images, prerender, llms.txt, image opt
npm run lint          # ESLint
npm run format        # ESLint --fix
npm run preview       # serve the production build locally
npm test              # Playwright (also: test:ui, test:seo, test:perf, test:desktop, test:mobile)
npm run sitemap       # regenerate sitemap_*.xml
npm run llms          # rebuild llms.txt and llms-full.txt
npm run census        # rebuild Census 2021 JSON from raw_data/census_2021/
npm run polls         # scrape + analyze polls + regenerate analysis narratives
npm run deploy        # Firebase deploy (production)
npm run staging       # Firebase deploy (staging)
```

## Data flow

1. Raw inputs live in `raw_data/` — CIK CSV/ZIP exports per election, NSI Census XLSX, scraped Wikipedia/Smetna-Palata/parliament.bg/Court-of-Audit data.
2. The pipeline in `scripts/` transforms those into static JSON under `public/YYYY_MM_DD/` (per election) and a handful of cross-cutting directories (`public/parliament/`, `public/polls/`, `public/census/`, `public/governments.json`, etc.).
3. The SPA fetches those JSON files directly. There is no backend server, no database, and no runtime API — just static files behind Firebase's CDN.

### Public data layout

Top-level files and directories the SPA fetches at runtime:

| Path | Contents |
|---|---|
| `YYYY_MM_DD/` | Per-election results, reports, party assessments, candidate data, financing |
| `parliament/` | MP index, profiles, declarations, business-connections graph, companies index |
| `polls/` | Polls, agencies, accuracy metrics, narrative analyses |
| `census/` | Per-region and per-municipality Census 2021 slices |
| `articles/` | MDX article content |
| `og/` | Pre-generated Open Graph share images |
| `regions/` `municipalities/` `settlements/` `sections/` | Geography-keyed per-location detail |
| `canonical_parties.json` | Master party register (name variants, history, colors) |
| `governments.json` | Government coalitions and ministers by parliamentary term |
| `parliament_groups.json` | Parliamentary group (faction) memberships |
| `macro.json` | National aggregates (turnout, invalid %, paper vs machine, SUEMG flag counts) |
| `census_2021.json`, `census_2021_settlements.json` | Census aggregates |
| `problem_sections_stats.json` | Risk-neighborhood summary stats |
| `llms.txt`, `llms-full.txt` | LLM-readable corpus for AI tools |

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
- `parliament/` — scraper for MP photos, bios, term history from parliament.bg
- `declarations/` — Court-of-Audit property/interest filings + Commerce Registry → MP↔company graph, rankings, per-MP 1-hop subgraphs
- `smetna_palata/` — campaign financing parsing
- `polls/` — Wikipedia scrape + accuracy analysis + narrative generation
- `parties/` — per-party data bundling and AI-generated campaign retrospects
- `census/` — NSI Census 2021 ingestion
- `voteFlows/` — transition matrices between consecutive elections
- `machines_memory/` — SUEMG flash-memory corrections
- `reports/`, `party_stats/`, `preferences/`, `search/`, `stats/`, `recount/`, `macro/` — analytical and aggregation stages
- `og/`, `prerender/`, `sitemap/`, `images/`, `llms/` — build-time output (run from `postbuild`)

Some narrative content is generated with LLMs:

- `polls:gen-analysis` calls Anthropic Claude (requires `ANTHROPIC_API_KEY`)
- `party:gen-retrospect` calls Google Gemini (requires `GEMINI_API_KEY`)

Both are written to JSON consumed by the SPA — there are no LLM calls at runtime.

## Maintenance skills (Claude Code)

For contributors using [Claude Code](https://claude.com/claude-code), the repo includes project-specific skills under `.claude/skills/` for the recurring data-refresh workflows:

- `update-connections` — refresh MP declarations + Commerce Registry, rebuild the connections graph, flag suspicious declared values.
- `update-polls` — scrape new polls from Wikipedia, recompute accuracy, write the per-election narrative.
- `parliament-scrape` — scrape MP photos/bios/seat data from parliament.bg (run after a new parliament is seated).
- `party-retrospect` — generate per-party campaign retrospects.

These can also be run by hand via the npm scripts and the `scripts/` CLI flags listed above.

## Environment variables

`.env.local`:

```
ANTHROPIC_API_KEY=...   # only for npm run polls:gen-analysis
GEMINI_API_KEY=...      # only for npm run party:gen-retrospect
                        # also injected into the frontend bundle as process.env.API_KEY
                        # via vite.config.ts — used by the in-app AI helpers
```

Both keys are optional unless you're regenerating the AI-written narratives.

## Deployment

Firebase Hosting, two projects:

- `npm run deploy` → production (`elections-bg`)
- `npm run staging` → staging (`electionsbg-staging`)

Both run the full data pipeline as `predeploy`. `deploy:fast` skips it (`SKIP_PREDEPLOY=1`).

The SPA is fully static. SPA rewrites and per-route prerendering are configured in `firebase.json`; prerendered HTML is generated by `scripts/prerender/` during `postbuild` so crawlers see populated `<meta>` tags.

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
- [NSI Census 2021](https://census2021.bg/) — population, ethnocultural, economic characteristics.
- [Bulgarian Wikipedia](https://bg.wikipedia.org/) — pre-election polling tables (per parliamentary election).

## Contributing

Issues and PRs welcome. There is no test suite for the data pipeline itself — verify changes by running `npm run prod` locally and diffing the resulting JSON against `git`.
