---
name: update-administration
description: Refresh the Държавна администрация data behind /sector/administration — the e-government adoption vs the EU (data/administration/egov.json, Eurostat isoc_ciegi_ac), the citizen digital-skills band vs the EU (data/administration/digital_skills.json, Eurostat isoc_sk_dskl_i21, incl. the full-27 youth cross-section behind the reusable EU choropleth), the административно обслужване service-quality metrics (data/administration/service_quality.json, parsed from the annual Доклад за състоянието на администрацията), the ИИСДА administrative-services register (data/administration/services_catalog.json + the admin_services Postgres table + the services_overview.json aggregate), МЕУ's еФорми e-service request volumes (data/administration/eforms_requests.json + the admin_service_requests Postgres table), and the precomputed page-context blob (data/administration/context.json, baked from personnel.json + macro.json + cofog.json). Use when the daily watch report flags `iisda_services`, `eurostat_egov`, `eurostat_digital_skills`, or `iisda_doklad` as changed, when the user asks to refresh administration / държавна администрация / електронно управление / дигитални умения / административни услуги data, or after a fresh git clone if data/administration/ is missing or the admin_services table is empty.
---

# update-administration

Refreshes the data served at `/sector/administration` (the bespoke
institution-first dashboard) + `/sector/administration/services` (the DbDataTable
services browser), and read by the `administrationOverview` AI chat tool.

## Sources

| Artifact | Source | Cadence | Watcher |
|---|---|---|---|
| `egov.json` | Eurostat `isoc_ciegi_ac` (I_IUGOV1 — interaction with public authorities) | annual | `eurostat_egov` |
| `digital_skills.json` | Eurostat `isoc_sk_dskl_i21` (I_DSK2_* — citizen digital skills, DESI human-capital pillar; headline + 5 areas + composition + full-27 youth cut) | biennial (odd years) | `eurostat_digital_skills` |
| `services_catalog.json` + `admin_services` (PG) + `services_overview.json` | Административен регистър (`iisda.government.bg/adm_services/services`) | weekly-ish | `iisda_services` |
| `service_quality.json` | Annual Доклад за състоянието на администрацията (parsed from the cached `raw_data/budget/doklad-*.txt`) | annual | `iisda_doklad` (shared with /update-budget) |
| `eforms_requests.json` + `admin_service_requests` (PG, migration 201) | МЕУ's еФорми request volumes, data.egov.bg dataset 20218 (one resource per month) | monthly, on the 1st | — (no watcher yet; run with any administration refresh) |
| `context.json` (derived) | `data/budget/personnel.json` + `data/macro.json` + `data/cofog.json` | on any of those | — (rebuild after /update-budget or /update-macro) |

The e-gov procurement group (МЕУ + ИА ИЕУ + ДАЕУ, rolled up server-side by
`awarder_group_model`) rides the **procurement** corpus and needs no ingest here —
it refreshes with /update-procurement.

## Run

```bash
npx tsx scripts/administration/fetch_egov.ts              # egov.json (Eurostat)
npx tsx scripts/administration/fetch_digital_skills.ts    # digital_skills.json (Eurostat isoc_sk_dskl_i21)
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

### еФорми e-service request volumes

```bash
npm run admin:eforms                          # data.egov.bg 20218 → data/administration/eforms_requests.json
npm run db:load:admin-service-requests:pg     # → admin_service_requests + admin_service_requests_month
```

REQUESTS through the еФорми system only — not completions, and not every e-service (one a
body runs on its own portal is absent, not zero). МЕУ skips months (2025-01…04, 2025-07…08,
2026-02 as of 2026-10-21); `admin_service_requests_month` lists the months that WERE
published, so a missing month is never read as zero. The fetcher refuses when a month it
held before disappears (`--allow-shrink` if МЕУ withdrew it) and does not rewrite the file
when no month changed. The snapshot is a PG load source and is excluded from bucket sync.

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
- **admin_service_requests (Postgres, 201)**: nothing reads it yet, but load it with the
  rest so prod is not a vintage behind when a surface ships:
  ```bash
  npm run db:load:admin-service-requests:pg:cloud
  ```

## Finish

Stamp the ingest marker so the orchestrator won't re-run it:

```bash
git add data/administration/ state/ingest/update-administration.json
```
(Write `state/ingest/update-administration.json` with `{"lastSuccessfulIngest":"<ISO>"}`.)
