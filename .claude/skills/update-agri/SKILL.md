---
name: update-agri
description: Refresh the ДФ „Земеделие" (State Fund Agriculture) farm-subsidy data behind /subsidies — the agri_subsidies + agri_payloads Postgres tables. Two sources — the data.egov.bg org-56 open-data CSVs (financial years 2015–2023, EIK-keyed) and the СЕУ interactive register (seu.dfz.bg) for the current rolling years 2024/2025 (no EIK column; recovered by name-match). Use when the daily watch report flags `dfz_subsidies` as changed (ДФЗ published/re-uploaded an egov year), when the user asks to refresh farm subsidies / земеделски субсидии / ДФЗ / CAP subsidies, to pull the latest СЕУ year, or after a fresh clone if the agri_subsidies table is empty.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update ДФ „Земеделие" farm subsidies skill

Refreshes the data behind the **farm-subsidy pack** on `/subsidies` (dashboard, `/subsidies/browse`, `/farm/:eik`, and the "Земеделски субсидии" tile on `/company/:eik`). The pack is **Postgres-only** — the ingest writes the `agri_subsidies` (per-payment detail) + `agri_payloads` (precomputed per-scope overview + per-recipient jsonb) tables **directly**, no static JSON on disk (so there is NO `bucket:sync` step). Memory: `[[project_agri_subsidies_pack]]`.

## Two sources

- **egov (FY2015–2023):** `data.egov.bg` organisation 56, the "Данни за изплатени субсидии" CSVs, via the working POST JSON API (`scripts/budget/lib/egov_api.ts`). **EIK-keyed** for legal entities. This is the deep backbone. 2014/2018/2019 are absent; 2020 serves 0 rows; 2013 is an incompatible legacy dataset. Cached to `raw_data/agri/<year>.json` (gitignored).
- **СЕУ (FY2024/2025):** the interactive register `seu.dfz.bg` (Oracle APEX). egov hasn't published these years yet, so `scripts/agri/seu_fetch.ts` drives a headless Playwright session: select year → Покажи → **Actions ▸ Download ▸ CSV** exports the whole year in one request (windows-1251, `";"`-delimited). Cached to `raw_data/agri/seu_<year>.csv` (gitignored). **The register has NO EIK column** — the ingest recovers EIK by exact normalised-name match against the egov entities, so recurring recipients relink to `/company`, procurement and EU-funds; genuinely new entrants stay name-only (like individuals).

## When to run

| Trigger | Action |
|---|---|
| Watcher flags `dfz_subsidies` (egov published / re-uploaded a year) | `npm run agri:seu && npm run agri:ingest`, then re-run the ingest against the Cloud SQL proxy to publish (Step 3) |
| User asks "refresh farm subsidies" / "pull the latest ДФЗ year" | same |
| Fresh clone, `agri_subsidies` table empty | `npm run db:pg:up` first, then the same |
| Monthly freshness pass for the rolling СЕУ years (no watcher fires — see note) | same |

## Procedure

1. **Fetch the СЕУ rolling years** (headless Playwright, ~1 min/year). The СЕУ window updates continuously, so always re-pull:
   ```bash
   npm run agri:seu       # → raw_data/agri/seu_2024.csv, seu_2025.csv
   ```
   (If Playwright can't reach the register — network / a register redesign — the ingest still runs on whatever СЕУ CSVs are cached, plus the full egov backbone.)
2. **Ingest → Postgres** (needs `npm run db:pg:up`):
   ```bash
   npm run agri:ingest
   ```
   Reads the egov org-56 CSVs (cached, else re-fetched from the API) + the СЕУ CSVs, normalises + converts BGN→EUR, name-matches СЕУ→egov for EIK, and `TRUNCATE`-reloads `agri_subsidies` + rebuilds `agri_payloads` in one transaction. It applies migration `046_agri_subsidies.sql` idempotently. Prints per-year row counts + `€` totals + the СЕУ EIK-match rate.
3. **Publish to Cloud SQL** so the live tiles update (the pack is DB-served, so this — not a bucket sync — is what ships it).

   **There is no `db:load:agri:pg:cloud` wrapper, and `db:dump:cloud` does NOT publish** — `scripts/db/dump.ts` is a snapshotter that `pg_dump`s whatever `DATABASE_URL` points at and uploads the dump to GCS for `db:restore`; aimed at the proxy it dumps Cloud SQL **outward** and leaves `/subsidies` on the old data. Because `agri:ingest` writes Postgres directly (it applies `046_agri_subsidies.sql` itself, then `TRUNCATE`-reloads `agri_subsidies` + rebuilds `agri_payloads`), publishing means **re-running the ingest against the proxy**:

   ```bash
   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npm run agri:ingest
   ```

   Needs the Cloud SQL proxy on `127.0.0.1:5434` with the `.pgpass` line present — the password-less URL is correct here, and must never leak into a later *local* command (it would fail `28P01`; `unset DATABASE_URL` after).

   This re-uploads ~2M rows over the proxy, so it is slow. For a whole-DB reconcile when several PG-backed skills ran, `npm run db:sync:cloud -- --yes` (pg_dump local → pg_restore cloud) is faster, but destructive (`--clean`) and requires local to be source of truth — including the unregenerable КЗК tier-2 outcome rows.

   Optionally follow with `npm run db:dump:cloud` to refresh the GCS restore point. Only redeploy functions (`firebase deploy --only functions:db`) if the serving migration/route changed — `046` + the `agri-payload` route already shipped once.
4. **Sanity-check** the console: FY2023 ≈ €1.14bn; FY2024/2025 ≈ €1.6bn each; all-years ≈ €11bn; СЕУ match rate ~25% of groups (the recurring entities). A big drop in a year's total or match rate means a source/parse regression.
5. **Stamp** `state/ingest/update-agri.json` with `lastSuccessfulIngest` (current UTC ISO) + a one-line `summary`, so `process-watch-report` won't re-trigger.

## Notes

- **New egov year supersedes СЕУ:** when ДФЗ eventually publishes FY2024 to egov (it landed FY2023 in Feb 2026, so ~late 2026), that year gains a real EIK column — `dfz_subsidies` flips, this skill re-runs, and the egov FY2024 (fully EIK-keyed) replaces the name-matched СЕУ version. To promote a year from СЕУ to egov, add its resource uri to `AGRI_YEAR_RESOURCES` in `scripts/agri/source.ts` and drop it from `AGRI_SEU_YEARS` in `scripts/agri/seu_fetch.ts`; then update `AGRI_FINANCIAL_YEARS` (frontend) stays as-is.
- **СЕУ freshness isn't daily-watched.** The `dfz_subsidies` watcher only fingerprints the egov org-56 datasets (cheap plain-HTTP). The СЕУ register updates continuously as payments are made, but fingerprinting it needs a full Playwright download — too heavy for the daily watcher. So the rolling years refresh whenever this skill runs; schedule a monthly `update-agri` if the current-year figures need to stay live between egov publications.
- **Playwright:** `scripts/agri/seu_fetch.ts` uses the repo's bundled `playwright` (headless Chromium). The СЕУ export is decoded with `TextDecoder("windows-1251")`; fields split on the `";"` boundary (intervention names contain bare `;`).
- **Raw caches** live under `raw_data/agri/` (gitignored) — safe to delete; they re-download on the next run.
- **No JSON, no bucket:** unlike funds/nzok, this pack serves entirely from Postgres, so there is nothing to `bucket:sync`. The deploy is **re-running `agri:ingest` against the Cloud SQL proxy** (Step 3), *not* `db:dump:cloud` — that command only snapshots cloud outward to GCS. Agri and КЗК are the two PG-backed datasets with no `db:load:*:cloud` wrapper, because in both the ingest itself is the loader.
