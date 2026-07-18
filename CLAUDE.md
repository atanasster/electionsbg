# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**electionsbg.com** — A single-page application for visualizing and analyzing Bulgarian parliamentary elections since 2005. Live at [electionsbg.com](https://electionsbg.com).

The app is a JAMstack SPA: data is pre-processed offline into static JSON files in `/public`, then fetched client-side with React Query. There is no backend server.

## Commands

```bash
npm run dev          # Start Vite dev server
npm run build        # TypeScript check + production Vite build
npm run lint         # ESLint + Prettier check
npm run preview      # Preview the production build locally

# Tests
npm run test:unit    # Vitest — unit + component tests (src/** jsdom, scripts/** node)
npm test             # Playwright — E2E / SEO / perf / UI smoke (needs a built dist/)
npm run test:coverage # Vitest v8 coverage report

# Data pipeline (offline processing)
npm run data         # Process election data (tsx ./scripts/main.ts)
npm run prod         # Full pipeline with --all --prod flags
npm run sitemap      # Generate sitemap

# Deployment
npm run deploy       # Deploy to Firebase (elections-bg project)
npm run staging      # Deploy to Firebase staging (electionsbg-staging)
```

The data pipeline CLI (`scripts/main.ts`) accepts flags: `--all`, `--prod`, `--date`, `--election`, `--reports`, `--stats`, `--search`, `--financing`, `--parties`, `--machines`, `--candidates`.

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
- `?q=<term>` — on `/procurement/contracts` and `/procurement/tenders`, seeds the DbDataTable free-text search (used by the combined-search "see all" deep links).

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
