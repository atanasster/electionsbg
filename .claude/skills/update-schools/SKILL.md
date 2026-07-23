---
name: update-schools
description: Rebuild the per-school education data behind /education and /school/:id — the matura (ДЗИ) index with examinee counts + geocodes, the 7th-grade НВО prior-attainment baseline (for value-added), the per-obshtina socioeconomic context index, and the textbook-publisher concentration. Use when the daily watch report flags `МОН: ДЗИ резултати` / `indicators_mon_dzi` (matura), when a new НВО year lands, when the procurement corpus refreshes (textbook market), when the user asks to refresh schools / matura / НВО / училища / textbook concentration, or after a fresh git clone if data/schools/index.json lacks nvoByYear or data/education/*.json is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Schools skill

Rebuilds the education data layer. Four artifacts, one dependency chain:

1. **`raw_data/indicators/mon_nvo/{year}.csv`** — 7th-grade НВО per-school results
   (points 0–100), the prior-attainment baseline. Fetched from data.egov.bg
   dataset `b56288b6-…`.
2. **`data/schools/index.json`** — per-school ДЗИ (matura) averages + examinee
   counts (`countsByYear`, for small-N suppression), settlement-centroid
   geocodes (`loc`), and `nvoByYear` (the НВО folded in by НЕИСПУО id). ДЗИ CSVs
   come from `raw_data/indicators/mon/` (downloaded by the `update-indicators`
   `mon_dzi` step; run that first, or the ДЗИ years will be stale).
3. **`data/education/school_context.json`** — per-obshtina "Индекс на средата"
   (SES) from Census 2021 (`data/census/municipalities`).
4. **`data/education/textbook_market.json`** — textbook-publisher concentration
   from the procurement corpus (`data/procurement/contracts`, CPV 22112).

## Run

```bash
# 1. Fetch НВО (prior attainment). --force re-downloads even valid caches.
npx tsx scripts/schools/fetch_nvo.ts

# 2. Rebuild the schools index (ДЗИ + counts + geocodes + НВО).
#    Reads raw_data/indicators/mon/*.csv (ДЗИ) + raw_data/indicators/mon_nvo/*.csv.
npx tsx scripts/schools/build_index.ts

# 2b. Resolve school → ЕИК. Primary source: the МОН institution-register
#     crosswalk (data/procurement/derived/mon_ri_eik_crosswalk.json) joined on
#     the school's НЕИСПУО id — authoritative, ~989/994. For full coverage run
#     scripts/procurement/mon_ri_crawl.ts first (headed Playwright; see
#     [[reference_mon_ri_register]]); if the crosswalk is absent it falls back to
#     name-matching the procurement awarder corpus (needs local PG). Run AFTER
#     build_index (it edits the index in place).
npx tsx scripts/schools/match_eik.ts

# 3. Socioeconomic context index (deterministic; only re-run when census changes).
npx tsx scripts/education/gen_school_context.ts

# 4. Textbook-publisher concentration (re-run when the procurement corpus changes).
npx tsx scripts/education/gen_textbook_market.ts

# 5. Load the schools serving layer into LOCAL Postgres (schools/school_scores/
#    school_context + two precomputed school_payloads blobs: 'directory' — the
#    whole dataset /education and /school/:id fetch — and 'risk' — the slim
#    top-under-performers list the МОН pack's SchoolRiskTile fetches instead of
#    the ~600 KB directory). The SES + value-added regressions are computed HERE
#    now — keep scripts/db/load_schools_pg.ts behaviourally identical to
#    src/data/schools/useSchoolDirectory (same thresholds/banding).
npm run db:load:schools:pg
```

Sanity-check the build log: `build_index.ts` prints `НВО: 8 years, matched to
~540 schools` and `994 schools, 994 geocoded (100%)`; a `WARNING НВО <year>`
means a source format changed — inspect that CSV before shipping. The
`fetch_nvo.ts` HTML-guard throws if data.egov.bg returns its portal shell
instead of a file (the `/resource/download` outage — retry later).

## After a successful run

```bash
npx tsx scripts/stamp-ingest.ts update-schools --summary "matura through <year> + НВО + context + textbooks"
git add data/schools/index.json data/education/*.json state/ingest/update-schools.json
```

Then publish for prod. `/education` + `/school/:id` are **served from Postgres**
(the `school_payloads` directory blob via `/api/db/education-payload`), so — like
procurement/funds — they reach prod via a **Cloud SQL load, not `bucket:sync`**.
Emit these in the Next-steps output (do NOT auto-run them; Cloud SQL is prod):

> Three parts of the directory blob exist ONLY after this load runs, and each
> self-hides on an older payload rather than erroring, so a skipped load looks
> like a missing feature rather than a failure: `byOblastYear` (the per-oblast
> series behind the /education "По области" change column + dumbbell — without
> it the table falls back to latest-year-only), per-year `n` on every
> `schools[].series` point (the cohort bars and the sub-10 hollow dots on
> /school/:id — without them both switch off), and the `risk` blob. The
> reconciliation and coverage of all three are asserted by
> `scripts/db/tests/schools_pg.data.test.ts` (`npm run test:data`).

```bash
# Cloud SQL (proxy on :5434) — publishes the schools tables + the 'directory'
# AND 'risk' school_payloads blobs (same loader writes both). Until this runs,
# the МОН pack's SchoolRiskTile self-hides in prod (education-payload?kind=risk
# returns null).
npm run db:load:schools:pg:cloud
# functions redeploy only if the /api/db route set changed (education-payload):
#   firebase deploy --only functions:db -P default
```

The tiny My-Area schools tile still reads `data/schools/index.json` (GCS-served),
so `bucket:sync` of `data/schools/` + `data/education/` is still needed for that
+ the OG cards; the heavy /education view is PG. Re-capture OG cards if tiles
changed materially: `npx tsx scripts/og/capture-screens.ts awarder/mon education`.

## Notes

- **Triggers:** matura/НВО refresh → `indicators_mon_dzi`; textbook market →
  the procurement watcher (`data.egov.bg АОП`); context → census (rare). The
  process-watch orchestrator maps all three to this skill.
- **One-off backfill:** historical НВО years already download by default; there
  is no separate `--backfill` needed. The ДЗИ raw cache lives under
  `raw_data/indicators/mon/` and is refreshed by `update-indicators`.
- **OG cards:** if the tiles changed materially, re-capture the social cards with
  `npx tsx scripts/og/capture-screens.ts awarder/mon education` (needs the dev
  server + `/api/db` up).
