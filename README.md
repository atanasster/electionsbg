# electionsbg.com

[electionsbg.com](https://electionsbg.com) is an open-source platform for
exploring how Bulgaria votes and is governed. It began with parliamentary
election results from 2005 onward and now connects elections with Parliament,
public officials, declared interests and assets, public spending, economic and
regional indicators, and the everyday cost of living.

The interface is available in Bulgarian and English.

## What the platform covers

- **Elections** — parliamentary and local results from national level down to
  municipalities, settlements, and polling sections; turnout, candidate
  preferences, comparisons, vote flows, and election-risk screening.
- **Parliament and public life** — MPs, roll-call votes, governments, parties,
  campaign finance, public officials, declarations, companies, and a unified
  person layer linking public records without relying on name-only guesses.
- **Public money** — the state budget, public procurement, EU and Interreg
  funding, agricultural subsidies, municipal finance, healthcare spending, and
  other sector dashboards.
- **Indicators and daily life** — macroeconomic and regional indicators,
  demographics, education, air quality, land use, pensions, retail prices, and
  cost-of-living comparisons.
- **Methods and provenance** — source links, refresh history, coverage notes,
  reproducible transformations, and explicit caveats for derived indicators.

Risk flags are screening signals, not findings of wrongdoing. See
[METHODOLOGY.md](METHODOLOGY.md) and [LICENSE](LICENSE) for the methodology and
reuse disclaimer.

## Architecture

The application is a hybrid static and database-backed React app:

1. `scripts/` fetches, parses, validates, and joins upstream public data.
2. Static and precomputed artifacts are written under `data/`; selected trees
   are served from Google Cloud Storage and resolved in the browser through
   `src/data/dataUrl.ts`.
3. Large, relational, and search-oriented corpora are loaded into PostgreSQL.
   The Firebase `db` function serves them under `/api/db/**` and also provides
   server-rendered metadata for page families that are not statically
   prerendered.
4. Vite builds the React application. Firebase Hosting serves the bundle,
   prerendered HTML, sitemaps, fonts, images, and other public assets.

There is therefore both a static data layer and a runtime API. A change may
need a data publish, a PostgreSQL load or migration, a Cloud Function deploy,
a Hosting deploy, or a combination of them.

## Tech stack

- React 19, strict TypeScript, Vite 6 with SWC, and React Router 7
- TanStack Query and TanStack Table
- Tailwind CSS, CSS Modules, Radix UI, Recharts, D3, and Leaflet
- PostgreSQL 16 locally in Docker and in production on Cloud SQL
- Firebase Hosting and Functions, plus Google Cloud Storage
- Vitest for unit, component, and data-integrity tests; Playwright for browser,
  SEO, and performance checks

## Repository map

```text
src/             React application, routes, data hooks, UI, and translations
functions/       Firebase runtime API and server-rendered page handlers
scripts/         Data ingests, transforms, PostgreSQL loaders, build tools, tests
data/            Processed static data and committed pipeline outputs
raw_data/        Raw and cached source material; many large inputs are gitignored
public/          Hosting assets, generated sitemaps, articles, fonts, and images
state/           Source-watcher and successful-ingest state
.agents/skills/  Project data-update and audit runbooks
docs/plans/      Dated implementation plans and design records
```

[CLAUDE.md](CLAUDE.md) is the canonical repository and operations guide. Read
it before changing data loaders, identity logic, PostgreSQL migrations, or
deployment flows; it records correctness constraints and ordering requirements
that do not belong in this introductory README.

## Local development

Install dependencies and start Vite:

```bash
npm install
npm run dev
```

The development server mounts local `data/` files at the same paths used by the
application. Many generated artifacts are committed, while large source caches
and some derived inputs are intentionally gitignored.

To rebuild the static data pipeline:

```bash
npm run data     # election/data pipeline with explicit flags as needed
npm run prod     # full static pipeline: --all --prod
```

Database-backed pages need the local PostgreSQL instance. The full refresh is
large and skips with a warning where an optional gitignored input is absent:

```bash
npm run db:pg:up
npm run db:refresh
```

### Environment files

Both `.env.local` and `.env.production` are gitignored. Local development can
leave `VITE_DATA_BASE_URL` unset so `dataUrl()` uses same-origin paths. A
production build needs the public data origin, either in the environment or in
the local `.env.production` file:

```dotenv
VITE_DATA_BASE_URL=https://storage.googleapis.com/data-electionsbg-com
```

Some operator-only ingests also require API keys or manually downloaded source
files. Their script headers and the matching `.agents/skills/*/SKILL.md` runbooks
are authoritative for those prerequisites.

## Common commands

```bash
npm run dev             # Vite development server
npm run build           # typecheck, production build, prerender, SEO artifacts
npm run lint            # ESLint; Prettier is enforced through ESLint
npm run format          # ESLint autofix
npm run test:unit       # Vitest unit and component tests
npm run functions:test  # Node tests for the Firebase functions package
npm run test:data       # PostgreSQL data-integrity gates; skip when PG is absent
npm run test:build      # build, then Playwright browser/SEO/performance tests
npm run sitemap         # regenerate sitemap files
npm run watch           # check registered upstream sources for changes
npm run db:pg:up        # start local PostgreSQL on port 5433
npm run db:refresh      # rebuild the local database in dependency order
```

CI runs lint, unit tests, Function tests, a production build, and Playwright.

## Data refresh workflow

The refresh system has two parts:

- `npm run watch` fingerprints registered upstreams at their configured
  cadence and writes state under `state/watch/` plus a human-readable report
  under `data-reports/`.
- The `process-watch-report` skill compares watcher state with
  `state/ingest/`, runs only the affected update skills, verifies their
  integrity gates, and stamps a source as ingested only after a clean run.

Individual refresh procedures live in `.agents/skills/`. Several sources need
browser access, a local cache, or human review, so a full refresh is not assumed
to be a single unattended network command.

## Data sources

The project combines official and open sources including the Central Election
Commission, National Assembly, National Audit Office, `data.egov.bg`, the
National Statistical Institute, GRAO, Eurostat, the World Bank, the Consumer
Protection Commission, and other public registers.

The maintained source of truth is the
[interactive data map at electionsbg.com/data](https://electionsbg.com/data).
It traces sources to processed datasets and site features, and links onward to
the full source list, original publishers, downloads, refresh cadence, and
recent-update log. Republished public data retains the terms of its original
publisher.

## Deployment

The main commands target separate layers:

```bash
npm run deploy           # Firebase Hosting only
npm run deploy:db        # Firebase `db` Function only
npm run staging          # staging Hosting target
npm run bucket:sync:dry  # preview the selected static-data upload
npm run bucket:sync      # publish the selected static-data trees to GCS
```

PostgreSQL migrations and cloud loaders are separate again. Deployment order is
significant for routes that span Cloud SQL, Functions, and Hosting, and some
function-served pages require an additional Hosting cache purge after a bundle
change. Follow the relevant deployment section in [CLAUDE.md](CLAUDE.md); do not
infer that `npm run deploy` publishes the API or database.

## License

[LICENSE](LICENSE) is authoritative. In summary:

- First-party code, specifications, build configuration, and generated
  first-party output are MIT licensed.
- Republished public data under `data/`, `raw_data/`, and the storage bucket
  retains each source's terms.
- Third-party fonts and vendored packages retain their upstream licences.
- The project brand, logos, videos, and photographs of identifiable people are
  reserved as described in the licence.

The repository is marked `"private": true` in `package.json` only to prevent an
accidental `npm publish`; it does not change the reuse rights in [LICENSE](LICENSE).

## Contributing

Issues and pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the required checks, inbound licence
terms, and the additional rules for changes to the published risk methodology.
