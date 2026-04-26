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

# Data pipeline (offline processing)
npm run data         # Process election data (tsx ./scripts/main.ts)
npm run prod         # Full pipeline with --all --prod flags
npm run sitemap      # Generate sitemap

# Deployment
npm run deploy       # Deploy to Firebase (elections-bg project)
npm run staging      # Deploy to Firebase staging (electionsbg-staging)
```

The data pipeline CLI (`scripts/main.ts`) accepts flags: `--all`, `--prod`, `--date`, `--election`, `--reports`, `--stats`, `--search`, `--financing`, `--parties`, `--machines`, `--candidates`.

There are no tests configured.

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
- `src/data/` subdirectories (`regions/`, `municipalities/`, `settlements/`, `sections/`, `parties/`, etc.) — React Query hooks per domain; each exports typed `useXxx()` hooks
- `src/screens/` — Page-level components matching the route structure
- `src/screens/components/` — Reusable components shared across screens
- `src/components/ui/` — Low-level UI primitives (22 components)
- `src/ux/` — UX utilities: data tables, tooltips, touch handling, media queries
- `src/locales/` — i18n strings; `public/locales/` — runtime-loaded translations

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
- `scripts/reports/` — Generate analytical reports (turnout, concentration, top gainers/losers, invalid ballots, recount metrics, machine flash memory)
- `scripts/stats/` — Aggregate statistics
- `scripts/search/` — Full-text search index generation
- `scripts/smetna_palata/` — Campaign financing parsing

### Path Aliases

`@/*` maps to `./src/*` (configured in `tsconfig.json` and `vite.config.ts`).

### Environment Variables

`.env.local` with `GEMINI_API_KEY` — injected into the frontend build via `vite.config.ts` as `process.env.API_KEY`.
