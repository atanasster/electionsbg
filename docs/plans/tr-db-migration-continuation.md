# Continuation plan — TR DB migration + EIK/person lookup

**Status:** PAUSED, blocked on external data. Resume when the empty TR data
window is filled.

This is the resume doc for the **Stage 4** work in
[`arbitrary-person-search.md`](./arbitrary-person-search.md) (Turso +
Firebase Function + arbitrary lookup). Stages 1–3 (the static-JSON
company → people-in-power feature) are **shipped**. This file captures exactly
where we stopped and the gated next steps, so a future session can pick up
cold.

---

## The gate: what "empty TR data window is filled" means

`raw_data/tr/state.sqlite` is reconstructed by replaying daily filing events
from data.egov.bg. The feed is a rolling window and the per-resource download
endpoint is **partially broken**:

- **Working:** days on/after ~**2026-04-22** download fine (200).
- **Broken:** ~**1,087 historical days, 2022-09-03 → 2026-04-14**, return
  **HTTP 500** (a ~26,557-byte error body). Confirmed broken across many
  re-checks over multiple days.
- **Never had:** there is no clean pre-2022-09 source either; data.egov.bg
  prunes old resources, and the bulk ZIP only carries a stale 2021–2022
  bundle. The `daily/` folder's 2021–2022 files are the only surviving copy of
  that era.

So the current `state.sqlite` covers **2021–2022 + ~2026-04-22→present**, with
a ~3.5-year hole in the middle. Current scale (2026-06-04):
**~582k companies, ~338k officer rows** — vs. the ~0.6–1M+ the full window
would yield.

**The gate is met when** the daily-refresh job's probe flips to "RECOVERED"
and backfills the gap — i.e. when `scripts/declarations/tr/daily_refresh.ts`
logs `historical window RECOVERED — backfilling N day(s)` and `state.sqlite`
jumps to ~0.6–1M+ person rows with 2023–2025 `added_at` rows present.

### How the backfill fires automatically

`npm run tr:daily-refresh` (committed, `d89deac9b`) runs daily after the
watcher-driven TR refresh. Each run it probes 3 historical days; while they
500 it fetches nothing. **The first morning they return 200, it backfills all
~1,087 days in that run**, reconstructs `state.sqlite`, and rebuilds the
per-EIK files. No manual action needed to detect recovery — just watch for the
"RECOVERED" log line / a jump in `company-connections-stats.json` counts.

If you ever want to force a check: `npm run tr:daily-refresh`.

---

## What is already shipped (Stage 2 — static JSON)

The company → officers → people-in-power feature is **complete and committed**,
served as precomputed static JSON (no DB). Do not rebuild this; Stage 4 only
swaps its delivery and adds new surfaces.

**Data builder** — `scripts/declarations/tr/build_company_connections.ts`
(`npm run tr:build-company-connections`):
- Reads `state.sqlite` + `connections-search.json` +
  `officials/index.json` + `officials/municipal/index.json`.
- Power people: MPs + executive + municipal officials (~7,200), one shared
  hyphen-aware name normalizer.
- Per-company: **direct** links (officer who personally holds office) +
  **one-hop bridge** links (officer → other company → politician there), with a
  namesake cap (25) and bridge cap (200).
- Writes `data/parliament/company-connections/{eik}.json` (gitignored,
  GCS-only) + committed `company-connections-stats.json`.
- Chained as **phase 7** of `parseFinancialDeclarations`
  (`scripts/declarations/index.ts`), so any `--declarations` run regenerates
  it. Skips gracefully if `state.sqlite` is absent.

**Frontend** — `src/data/parliament/useCompanyConnections.ts` +
`src/screens/components/connections/CompanyConnectionsSection.tsx`, mounted on
`CompanyByEikScreen.tsx`. EN/BG i18n keys `company_conn_*`. Renders direct
links (with `MpAvatar`), bridged paths, officer roster, confidence chips, and a
"name match — identity not verified" disclaimer. Verified in the browser.

**Skill wiring** — `.claude/skills/update-connections/SKILL.md` documents
phase 7. `egov_commerce` watcher → `process-watch-report` → `update-connections`
keeps it fresh on change; `tr:daily-refresh` covers the daily/backfill path.

**Key commits:** `5871b79c0` (reconstruct merge), `d49367e98` (feature),
`daa0cb442`+`6e368f81d` (SoleCapitalOwner fix), `a096efa82` (phase-7 chain),
`d89deac9b` (daily-refresh). PRD: `3a9379621`.

**Current counts (2026-06-04):** 7,034 connected companies (2,591 direct-only,
4,443 with bridges), 4,365 direct + 12,360 bridged links.

**Not yet done:** `bucket:sync` + deploy. The feature works on current
(partial) data; we deferred shipping to prod until the window fills, but it
*can* ship now on partial data if desired (it's not gated — Stage 2 is
prod-bound static JSON; see PRD "Staging gating").

---

## Resume checklist — Stage 4 (Turso + Firebase Function + lookup)

Do these **after** the gate is met (or now, accepting partial coverage). Full
spec in `arbitrary-person-search.md`; this is the ordered runbook.

### Pre-flight
1. Confirm the window filled: `state.sqlite` ~0.6–1M+ person rows, 2023–2025
   `added_at` rows exist. If still gated, stop here.
2. Re-run `npm run tr:build-company-connections` to refresh the static files on
   full data; commit stats; `npm run bucket:sync`; deploy. This ships Stage 2
   on complete data — a good standalone milestone before any DB work.

### Stage 4A — build the Turso DB
3. New `scripts/declarations/tr/build_search_db.ts` → `raw_data/tr/registry.sqlite`
   with the **4-table schema** from the PRD (`companies`, `company_persons`,
   `person_names`, `power_people`) + FTS5 `trigram` virtual tables for fuzzy
   name/company search. Reuse the **same shared normalizer** as the builder
   (load-bearing — see PRD "Gate B"). Add `npm run tr:build-search-db`;
   gitignore the artifact.
4. Provision Turso (free tier): `turso db create electionsbg-registry
   --from-file raw_data/tr/registry.sqlite --location fra`; create a
   **read-only** token. Add a `tr:publish` rebuild+import script (monthly
   cadence; later wire into `process-watch-report`).

### Stage 4B — backend (staging-gated)
5. New `functions/` dir (own `package.json`/`tsconfig`), deps
   `firebase-functions` v2 + `@libsql/client`. `onRequest` handler, region
   `europe-west1`:
   - `GET /api/company/:eik/connections` — the 2 flat depth-2 queries from the
     PRD (direct + one-hop bridge), dedup, JSON. Unknown EIK → empty, never 500.
   - `GET /api/search?q=` — FTS5 fuzzy person/company name → candidates →
     1–2-hop ties to power people. (This is the new "arbitrary lookup" surface
     the DB chiefly exists for.)
   - libSQL client at module scope; secrets via `defineSecret`
     (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`); response `Cache-Control:
     public, max-age=86400, stale-while-revalidate=604800`.
6. `firebase.json`: add `functions` block + `/api/**` rewrite **before** the
   `**` SPA catch-all. **Gate to staging:** `npm run deploy` (prod) becomes
   `firebase deploy -P default --only hosting` so the Function lands on the
   **staging project only**. Add `src/lib/featureFlags.ts` →
   `registryDbEnabled()` true for `*staging*`/`localhost`, false for prod.

### Stage 4C — frontend
7. `useCompanyConnections` becomes **dual-path**: `registryDbEnabled()` →
   `/api/company/:eik/connections`; prod → the Stage-2 static JSON. Same
   component renders both.
8. New person-search surface (search box → `/api/search` → results linking into
   the curated graph + the company pages). Reuse connections rendering.
9. Verify on `electionsbg-staging.web.app`. Promote to prod later as a separate
   change (widen `registryDbEnabled()`, add functions back to prod deploy).

### Later (post-launch)
- Entity-resolution layer (canonical person/mention, co-occurrence,
  merge/split override file) — PRD phase 6.
- Recursive-CTE `/connections` explorer at arbitrary depth — PRD phase 7.
- Donors as connection entities — still blocked on 2-part-name data quality.

---

## Cost & decisions (locked)

- **$0/month** target: Turso free tier (500M row-reads/mo, 5GB), Firebase
  Functions free quota. Supabase was dropped (500MB cap + idle-pause + $25).
- Blaze plan: active (required for Function egress to Turso).
- `power_people`: **all officials** (MPs + executive + full municipal tier).
- Entity resolution: v1 identity = `name_norm`; confidence always surfaced; a
  name-only match is never `high` (matches OpenCorporates' deliberate
  non-merge stance).
- Rollout: Stage 2 static = prod; Stage 4 DB = staging-gated until promoted.

---

## Key file map (for the future session)

| Path | Role |
|---|---|
| `docs/plans/arbitrary-person-search.md` | Full PRD (schema, queries, competitive research, gates) |
| `scripts/declarations/tr/daily_refresh.ts` | Daily historical-probe + backfill + rebuild (the recovery detector) |
| `scripts/declarations/tr/build_company_connections.ts` | Stage-2 per-EIK builder (phase 7) |
| `scripts/declarations/tr/reconstruct_state.ts` | Replays daily/+bulk → state.sqlite (merge mode) |
| `scripts/declarations/tr/cli.ts` | `--index --incremental --bulk --reconstruct` |
| `src/screens/components/connections/CompanyConnectionsSection.tsx` | Stage-2 UI on /company/:eik |
| `src/data/parliament/useCompanyConnections.ts` | Hook (becomes dual-path in Stage 4) |
| `data/parliament/company-connections-stats.json` | Committed run summary — watch its counts for the backfill jump |
| *(to create)* `scripts/declarations/tr/build_search_db.ts` | Stage-4 Turso DB builder |
| *(to create)* `functions/` | Stage-4 Firebase Function (EIK + search APIs) |
| *(to create)* `src/lib/featureFlags.ts` | `registryDbEnabled()` staging gate |
