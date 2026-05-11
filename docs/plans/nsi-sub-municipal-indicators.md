# PRD: NSI sub-municipal indicators

Augment the existing `/demographics` screen and per-municipality
drilldowns with non-census indicators from NSI: unemployment, average
wage, EU-funds absorption, school performance. Smallest scope of the
4 dataset PRDs — extends existing screens rather than introducing new
ones.

## Context

- **What exists.**
  - `data/census_2021.json` + `data/census_2021_settlements.json` —
    snapshot from the 2021 census (age, gender, ethnicity, religion,
    education, employment).
  - `/demographics` screen + `<CensusChoroplethMap>` overlay it on
    regional/municipal maps.
  - `data/macro.json` — Eurostat-sourced macro indicators (GDP,
    employment) but only at country level.
- **What's missing.** Year-over-year tracking of sub-national
  indicators between censuses. The 2021 census ages out as new
  cycles add data. Currently no way to ask "did unemployment in
  Видин drop between 2022 and 2026?"

## Goals

1. **Ingest 4-6 NSI sub-municipal indicator series.** Year-over-year
   per oblast (NUTS3) where available, per municipality (LAU2) where
   NSI publishes at that granularity.
2. **Extend `/demographics`** with per-indicator views and
   year-over-year toggles.
3. **Light up regional drilldowns** with indicator overlays — when
   you visit `/municipality/<oblast-code>` you see the latest
   unemployment + wage data alongside the existing voting analysis.
4. **Stay tidy.** Indicators are reference data; resist the temptation
   to make this a "national statistics dashboard." Stay focused on
   what informs the electoral analysis.

## Non-goals (this PRD)

- Real-time / monthly indicator updates. NSI publishes most series
  quarterly or annually; we match that cadence.
- Predictive modelling ("what will turnout be next election given
  current unemployment?"). Out of scope; we surface raw indicators.
- Cross-country comparison. Already partially covered by Eurostat
  macro; not needed at sub-national level.

## Indicators to ingest

Pick 4-6, in order of usefulness for electoral analysis:

| Indicator | NSI series | Granularity | Cadence |
|---|---|---|---|
| **Unemployment rate** | Регистрирана безработица per ОНС | per municipality | monthly (snap to quarterly) |
| **Average gross wage** | Средна работна заплата | per oblast | quarterly |
| **EU funds absorbed per capita** | Кохезионна политика — публикуван данни | per municipality | annual |
| **Population mobility (net migration)** | Вътрешна и външна миграция | per oblast | annual |
| **School performance (DZI scores)** | Държавни зрелостни изпити mean | per municipality | annual |
| **Healthcare access (GP per 1000)** | Лекари по обслужвано население | per oblast | annual |

The first three are highest-leverage. Schools / healthcare are
nice-to-have if scraping cost is low.

## Data model

```
data/nsi/
  index.json
    { indicators: [{ id, label_bg, label_en, granularity, cadence,
      sourceUrl, lastIngest, periodCovered }] }
  series/<indicatorId>/<entityCode>.json
    [{ period: "2026-Q1", value: 6.4, periodEnd: "2026-03-31" }]
  derived/
    latest.json          — most-recent value per (indicator, entity)
    by_municipality.json — flat keyed by municipality code: { [muniCode]: {indicator: latestValue, ...} }
    by_oblast.json       — same for oblast
```

```ts
type IndicatorSeries = {
  indicatorId: string;     // "unemployment_rate"
  entityType: "muni" | "oblast";
  entityCode: string;      // matches data/municipalities.json or oblast key
  unit: string;            // "%", "лв", "per_capita_eur"
  series: SeriesPoint[];
};

type SeriesPoint = {
  period: string;          // "2026-Q1" | "2026" | "2026-03"
  periodEnd: string;       // ISO date
  value: number;
};
```

Entity codes must align with the existing
`data/municipalities.json` and oblast keys in
`data/regions_map.json` so joins on the SPA side are trivial.

## Pipeline

```
scripts/nsi/
  scrape.ts             # Per-indicator fetch from NSI portal / API
  parse_xlsx.ts         # NSI publishes mostly XLSX; reuse existing xlsx infra
  normalize.ts          # Map NSI codes to our oblast/municipality codes
  derive.ts             # Latest values + flat lookups
```

Watcher: `scripts/watch/sources/nsi.ts` — fingerprint the NSI
release calendar / dataset metadata pages.

`/update-nsi` Claude Code skill orchestrates ingest. The xlsx
parsing infrastructure already exists (used for census 2021).

## SPA features

### Per-indicator view on `/demographics`
Add an "Indicators" tab next to the existing census tabs. Time-series
chart for the country, per-oblast small multiples, choropleth map of
the latest value.

### Indicator overlays on regional drilldowns
On `/municipality/<code>` (and Sofia variants), add a "Местни
индикатори" panel showing the most recent value of each ingested
indicator with year-over-year delta and a sparkline.

### Settlement-level (where data permits)
Most indicators are oblast/municipality only; settlements use the
parent municipality's value with a clear "обл. average" label.

### Cross-reference with elections
Optional follow-up: scatter plot — unemployment vs. ruling-party
vote share per municipality. Lives on a new `/correlations` page or
a section of `/articles/<slug>`.

## Implementation phases

**Phase 1 — Pipeline scaffold + 2 indicators (~1 week)**
- Scrape unemployment + average wage.
- Storage layout above.
- `/update-nsi` skill.
- `derive.ts` outputs.

**Phase 2 — Drilldown panel (~3 days)**
- "Местни индикатори" panel on `/municipality/<code>`.
- Hooks: `useNsiLatest(entityCode)`, `useNsiSeries(indicatorId, entityCode)`.

**Phase 3 — Demographics tab (~3 days)**
- New tab on `/demographics` with map + small multiples.

**Phase 4 — Remaining indicators (~3 days)**
- EU funds, migration, schools, healthcare. Each is incremental
  scrape + parse work.

**Phase 5 — Correlations (~5 days, optional)**
- Scatter plots + a launch article walking through the headline
  finding.

## Success criteria

- Watcher fires when NSI releases new data for any tracked series;
  ingest runs within a week; new values land in the SPA on next deploy.
- Every drilldown page shows current values + year-over-year delta
  for the 2-3 ingested indicators.
- Indicator labels are correct in both BG and EN.

## Open questions

1. **NSI portal vs. statistical-yearbook PDFs.** NSI's online portal
   has structured data; the printed yearbook has more breadth but
   requires PDF parsing. Recommend portal first, escalate per
   indicator.
2. **Eurostat overlap.** Some series (unemployment) are also
   available via Eurostat at NUTS3 granularity — sometimes more
   timely than NSI. For sub-municipal (LAU2) we have to go to NSI.
   Document the source choice per indicator.
3. **EU funds source.** "EU funds absorbed" data lives at
   eumis2020.government.bg + ISUN.bg. Pick one, ideally with an API.
4. **Backfill window.** How far back to ingest each series? Recommend
   covering at least the period spanned by our election archives
   (2005+) so cross-cycle correlation is possible.
5. **Sofia districts vs. oblast 23-25.** NSI publishes Sofia as a
   single oblast (SOF). Our app splits into 23/24/25 МИР. Either show
   the same value across all three Sofia routes, or skip Sofia at
   the indicator layer. Recommend show same value with a footnote.

## Reference

- `data/census_2021.json` — pattern for sub-municipal ingested data.
- `scripts/census/build_census.ts` — XLSX parsing pattern, oblast/
  municipality code mapping.
- `data/macro.json` + `scripts/macro/fetch_eurostat.ts` — pattern for
  series-style data with periods.
- `src/screens/components/demographics/CensusChoroplethMap.tsx` —
  map overlay pattern; reuse for indicator overlays.
- `src/data/macro/useMacro.tsx` — hook pattern for series data.
- `data/municipalities.json` + `data/regions_map.json` — entity code
  source-of-truth for joins.
