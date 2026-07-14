---
name: update-administration
description: Refresh the Държавна администрация data behind /sector/administration — the e-government adoption vs the EU (data/administration/egov.json, Eurostat isoc_ciegi_ac), the административно обслужване service-quality metrics (data/administration/service_quality.json, parsed from the annual Доклад за състоянието на администрацията), the ИИСДА administrative-services register (data/administration/services_catalog.json + the admin_services Postgres table + the services_overview.json aggregate), and the precomputed page-context blob (data/administration/context.json, baked from personnel.json + macro.json + cofog.json). Use when the daily watch report flags `iisda_services`, `eurostat_egov`, or `iisda_doklad` as changed, when the user asks to refresh administration / държавна администрация / електронно управление / административни услуги data, or after a fresh git clone if data/administration/ is missing or the admin_services table is empty.
---

# update-administration

Refreshes the data served at `/sector/administration` (the bespoke
institution-first dashboard) + `/sector/administration/services` (the DbDataTable
services browser), and read by the `administrationOverview` AI chat tool. See
`docs/plans/administration-view-v1.md`.

## Sources

| Artifact | Source | Cadence | Watcher |
|---|---|---|---|
| `egov.json` | Eurostat `isoc_ciegi_ac` (I_IUGOV1 — interaction with public authorities) | annual | `eurostat_egov` |
| `services_catalog.json` + `admin_services` (PG) + `services_overview.json` | Административен регистър (`iisda.government.bg/adm_services/services`) | weekly-ish | `iisda_services` |
| `service_quality.json` | Annual Доклад за състоянието на администрацията (parsed from the cached `raw_data/budget/doklad-*.txt`) | annual | `iisda_doklad` (shared with /update-budget) |
| `context.json` (derived) | `data/budget/personnel.json` + `data/macro.json` + `data/cofog.json` | on any of those | — (rebuild after /update-budget or /update-macro) |

The e-gov procurement group (МЕУ + ИА ИЕУ + ДАЕУ, rolled up server-side by
`awarder_group_model`) rides the **procurement** corpus and needs no ingest here —
it refreshes with /update-procurement.

## Run

```bash
npx tsx scripts/administration/fetch_egov.ts              # egov.json (Eurostat)
npx tsx scripts/administration/fetch_services.ts          # services_overview.json + services_catalog.json (ИИСДА scrape)
npx tsx scripts/administration/parse_service_quality.ts   # service_quality.json (from cached doklad-*.txt)
npm run admin:build-context                               # context.json (from personnel + macro + cofog)
DATABASE_URL=… npm run db:load:admin-services:pg          # load admin_services into LOCAL Postgres
```

Notes:
- `parse_service_quality.ts` reads the `raw_data/budget/doklad-<year>.txt` files that
  **/update-budget** downloads; run /update-budget first when `iisda_doklad` flips so
  the newest year's text is cached. The parser is deliberately narrow (signals volume,
  proposals, satisfaction-measurement compliance) — таен клиент / one-stop-shop are
  prose-only in the report and are NOT extracted.
- `build_context.ts` must be re-run after **/update-budget** (personnel) or
  **/update-macro** (macro + cofog) too — it bakes their slices so the page fetches
  ~8 KB instead of ~324 KB. This is why `iisda_doklad` maps here as well.
- `fetch_services.ts` replays the register's xajax GET endpoint (no headless browser).
  Per-service fee / deadline / e-availability are NOT captured (each detail page is a
  separate xajax fetch — deferred).

## Publish

- **Static artifacts** (egov / service_quality / services_overview / context + the
  services_catalog ingest source): the ordinary `npm run bucket:sync` ships
  `data/administration/` to GCS (it is not excluded from the sync).
- **admin_services (Postgres)**: apply migration `068_admin_services.sql` to Cloud SQL
  and load it, then it serves via `/api/db/table?resource=admin_services`:
  ```bash
  npm run db:load:admin-services:pg:cloud
  ```
  (`admin_services` is small; keep it in the standard cloud refresh alongside
  `db:load:schools:pg:cloud`.)

## Finish

Stamp the ingest marker so the orchestrator won't re-run it:

```bash
git add data/administration/ state/ingest/update-administration.json
```
(Write `state/ingest/update-administration.json` with `{"lastSuccessfulIngest":"<ISO>"}`.)
