# PRD: Macro indicators expansion (quarterly + debt + new series)

Augment `data/macro.json` and the GovernmentTimeline chart on
`/governments` with quarterly resolution where available, add national
debt, and broaden the indicator set with politically-loud series like
budget balance, consumer confidence, and inflation breakdowns.

## Context

- **What exists.**
  - `scripts/macro/fetch_eurostat.ts` ingests 13 indicators (4 Eurostat
    annual, 3 World Bank WGI, 6 curated) → `data/macro.json`.
  - All series are annual (`{ year: number, value: number }[]`).
  - Rendered on `/governments` overlaid on the cabinet timeline
    (Станишев, Борисов, Орешарски, ... Желязков).
- **What's missing.**
  - Quarterly resolution. Annual smooths out the cycles that politics
    actually responds to (mid-cycle inflation spikes, election-year
    spending bumps).
  - **National debt** as a series. Politically loud — every cabinet
    inherits a debt level and either grows or shrinks it.
  - Several other indicators that are well-established political
    signals: budget balance, consumer confidence, real wages, etc.

## Goals

1. **Switch existing series to quarterly** where Eurostat publishes
   quarterly data. Keep annual fallback for indicators that don't.
2. **Add national debt and budget balance.** Both quarterly. Both
   directly relevant to fiscal-policy debate.
3. **Add 4-6 new economic indicators** that move with elections.
4. **Update the GovernmentTimeline chart** to render mixed-cadence
   data correctly (quarterly lines + annual scatter).

## Non-goals (this PRD)

- BNB monetary indicators beyond what Eurostat already publishes.
  Could add later for monetary-policy nerds.
- Real-time / monthly indicators in the GovernmentTimeline chart.
  Charting monthly data for 20 years is too dense; aggregate to
  quarterly.
- Forecasts / projections. Historical only.

## Data model changes

Current shape:
```ts
{
  series: { [key]: { year: number; value: number }[] },
  indicators: { [key]: { titleEn, titleBg, unitLabelEn, unitLabelBg } }
}
```

Proposed shape (additive — annual still works):
```ts
{
  series: { [key]: SeriesPoint[] },
  indicators: { [key]: IndicatorMeta }
}

type SeriesPoint = {
  year: number;        // 2026
  quarter?: number;    // 1..4 — present iff cadence is quarterly
  period?: string;     // "2026-Q1" | "2026" — denormalised for sorting/display
  value: number;
};

type IndicatorMeta = {
  titleEn: string;
  titleBg: string;
  unitLabelEn: string;
  unitLabelBg: string;
  cadence: "annual" | "quarterly";   // NEW
  source: "eurostat" | "worldbank" | "curated";
  sourceUrl?: string;                // NEW — link in the UI's "Източник" pill
  datasetCode?: string;              // NEW — e.g. "nama_10_gdp"
};
```

Existing consumers handle this transparently — the `quarter` field
is optional and ignored by code that only reads `year`. New chart
rendering branches on `cadence`.

## Indicators to add

### Tier 1 — quarterly upgrades + debt (must-have)

| Key | Title | Eurostat dataset | Cadence | Notes |
|---|---|---|---|---|
| `gdpGrowth` (upgrade) | Real GDP growth | `namq_10_gdp` | quarterly | Replaces annual `nama_10_gdp` |
| `inflation` (upgrade) | HICP inflation | `prc_hicp_manr` | monthly→quarterly avg | Roll up monthly to quarterly mean |
| `unemployment` (upgrade) | Unemployment rate | `une_rt_q` | quarterly | Direct quarterly series |
| `govDebt` (NEW) | General government gross debt | `gov_10q_ggdebt` | quarterly | % of GDP |
| `budgetBalance` (NEW) | General government net lending/borrowing | `gov_10q_ggnfa` | quarterly | % of GDP, negative = deficit |
| `currentAccount` (NEW) | Current account balance | `bop_q_gdp` | quarterly | % of GDP |

### Tier 2 — sentiment + activity (strong election signal)

| Key | Title | Dataset | Cadence | Notes |
|---|---|---|---|---|
| `consumerConfidence` | Consumer confidence indicator | `ei_bsco_m` | monthly→quarterly | Composite of forward-looking household expectations |
| `economicSentiment` | Economic sentiment indicator (ESI) | `ei_bssi_m_r2` | monthly→quarterly | Composite of business + consumer sentiment |
| `retailVolume` | Retail trade volume index | `sts_trtu_m` | monthly→quarterly | Proxy for consumption |
| `industrialProd` | Industrial production index | `sts_inpr_q` | quarterly | Direct series |
| `realWages` | Real labour cost index | `lc_lci_q` | quarterly | Wage growth net of inflation |

### Tier 3 — household / inequality (broader social signal)

| Key | Title | Dataset | Cadence |
|---|---|---|---|
| `housePrices` | House price index | `prc_hpi_q` | quarterly |
| `youthUnemployment` | Unemployment, ages 15-24 | `une_rt_q` (filter) | quarterly |
| `energyImportDep` | Energy import dependence | `nrg_ind_id` | annual |
| `gini` | Gini coefficient (income inequality) | `ilc_di12` | annual |
| `atRiskPoverty` | At-risk-of-poverty rate | `ilc_li02` | annual |

Recommend shipping Tier 1 in phase 1, Tier 2 in phase 2, Tier 3 as
a follow-up only if there's user demand.

### Tier 4 — politically loud HICP breakdown (optional)

The headline HICP rate hides the politically charged details — food
prices and energy prices move differently from the headline and drive
public sentiment more. Worth surfacing as a stacked area chart on
`/governments`:

| Key | Sub-component | Dataset filter |
|---|---|---|
| `inflationFood` | Food + non-alcoholic beverages | `prc_hicp_manr` `coicop=CP01` |
| `inflationEnergy` | Energy | `prc_hicp_manr` `coicop=NRG` |
| `inflationServices` | Services | `prc_hicp_manr` `coicop=SERV` |
| `inflationCore` | Headline excl. food + energy | `prc_hicp_manr` `coicop=TOT_X_NRG_FOOD` |

Stacked area showing how 2022-2023 inflation was 80% energy + food.
Powerful narrative.

## Pipeline changes

### `scripts/macro/fetch_eurostat.ts`

- Add `cadence: "annual" | "quarterly"` to `EurostatIndicator` type.
- Update fetch URL builder to handle `freq=Q` + the response shape
  (Eurostat returns time-keyed object; quarterly keys are
  `"2026-Q1"` etc.).
- Helper `monthlyToQuarterly(monthlyPoints)` for indicators only
  available monthly (HICP components, retail trade, sentiment).
- Each indicator declaration also carries `sourceUrl` (the Eurostat
  data-browser link) and `datasetCode` for the UI.

### Watcher

`scripts/watch/sources/eurostat.ts` already exists per the watch
pipeline. Extend it to fingerprint each indicator dataset's
`updated` timestamp from Eurostat's metadata API
(`/metadata/<dataset>`). Quarterly datasets refresh more often than
annual, so watcher cadence stays daily but most days will be no-ops
for the annual indicators.

### `/update-macro` skill (NEW)

Wraps `scripts/macro/fetch_eurostat.ts`. Triggered when watcher
flags a Eurostat dataset change. Same pattern as `/update-rollcall`.

## SPA changes

### Chart rendering

Current chart in `src/screens/components/governments/GovernmentTimeline.tsx`
plots annual points connected by lines on a year-resolution x-axis.

New behavior:
- X-axis becomes quarter-resolution (`2005-Q1` ... `2026-Q4`).
- Quarterly series: line connecting each quarter point.
- Annual series (Tier 3 / TI CPI / WGI): scatter points at
  `year-Q3` (mid-year proxy) — visually distinguishable from the
  quarterly lines via shape/style.
- Cabinet bands continue to span their actual date range; quarter
  resolution makes the start/end alignment more accurate.

### Indicator picker

Currently three pills (БВП, Инфлация, Безработица) toggle series.
With ~12 indicators, pills don't scale.

Two options:
1. **Grouped pills** in expandable categories (Икономика,
   Бюджет, Настроения, Социални).
2. **Multi-select dropdown** with category headers.

Recommend grouped pills — keeps the visual rhythm of the existing
chart, just stacked into 2-3 rows.

### Y-axis handling

Different indicators have wildly different scales (GDP growth -5
to 15%, debt 20-50% of GDP, consumer confidence -30 to +20 index).
Two approaches:

1. **Dual y-axis** when 2 series with different scales are selected
   (chart already supports left+right axes via recharts).
2. **Normalised view** — index each series to its 2005 value = 100.
   Loses absolute meaning but enables apples-to-apples cross-series
   comparison.

Recommend dual-axis as default, with a "normalise" toggle for
power users.

### Source attribution

Existing chart shows "Източници: Eurostat nama_10_gdp ..." with
links. With more datasets, the source list grows. Render as a
collapsible "Източници и методология" section beneath the chart.

## Implementation phases

**Phase 1 — Tier 1 indicators + chart support for quarterly (~1 week)**
- Update `fetch_eurostat.ts` for quarterly fetch.
- Add `gdpGrowth`/`inflation`/`unemployment` quarterly series
  (replace annual).
- Add `govDebt`, `budgetBalance`, `currentAccount`.
- Update `GovernmentTimeline.tsx` for quarter x-axis + dual y-axis.
- Update SourceUrl pills.
- Ship.

**Phase 2 — Tier 2 indicators + grouped pills (~5 days)**
- Add 5 Tier 2 indicators.
- Group pills by category (Икономика, Настроения, Бюджет).
- Add normalise toggle.

**Phase 3 — HICP breakdown (Tier 4) (~3 days)**
- Add 4 HICP component series.
- Add a stacked-area variant of the chart specifically for inflation
  components.
- Worth its own subsection on `/governments` because the visual
  story is so different.

**Phase 4 — Tier 3 (~3 days, optional)**
- Add youth unemployment, house prices, energy dependence, Gini,
  poverty.
- These are annual (mostly) — mix carefully with quarterly Tier 1.

## Migration of existing data

`data/macro.json` schema change is additive — new optional fields
(`quarter`, `period`, `cadence`, `sourceUrl`, `datasetCode`).
Existing SPA code keeps working with annual-only series until the
chart code is updated.

The `--prod` minified writer in `scripts/main.ts` and the
specifically-tuned `JSON.stringify(payload)` writer in
`fetch_eurostat.ts` (Track 2 from the GCS migration) handle the
larger output without changes.

Run `npm run bucket:sync` post-update to push the new
`data/macro.json` to the bucket.

## Success criteria

- `/governments` chart shows quarterly data for GDP/inflation/
  unemployment with visibly more detail through 2008/2014/2020/2022
  (the four major BG cycles).
- National debt line is overlaid on the cabinet timeline; reader
  can answer "did debt grow under Borisov 3?" in one glance.
- Adding a new Eurostat indicator takes < 30 minutes (one entry
  in `EUROSTAT_INDICATORS` array, no other code changes).

## Open questions

1. **Mixed cadence rendering.** Plotting quarterly + annual on the
   same chart works but the visual hierarchy needs care. Annual as
   distinct shapes (squares/triangles), quarterly as connected
   lines? Confirm with a sketch before phase 1 ships.
2. **Period sorting.** With "2026-Q1" strings + bare years, sort
   logic gets fiddly. Normalise everything to a `Date` (period start)
   internally; display the canonical label.
3. **Inflation: monthly aggregation method.** Mean vs. end-of-period
   vs. last-month-of-quarter. Eurostat publishes both an annual rate
   per month (already inflation-adjusted) and a quarterly mean.
   Recommend the quarterly mean for chart simplicity; document the
   choice.
4. **HICP breakdown — how many components?** Could go very granular
   (alcohol, transport, communication, etc.). Stick with 4-5 high-
   level groups (food, energy, services, core) for the chart;
   power users can dig into Eurostat directly.
5. **Real-time data lag.** Eurostat publishes Q1 data in late June.
   The chart's "latest" point can be 2-3 months stale. Add a
   "Последна публикация: ..." note so readers know.

## Reference

- `scripts/macro/fetch_eurostat.ts` — the file to extend.
- `data/macro.json` — current data shape (annual).
- `src/data/macro/useMacro.tsx` — SPA hook.
- `src/screens/components/governments/GovernmentTimeline.tsx` —
  the chart to update.
- `src/screens/GovernmentsScreen.tsx` — host page.
- Eurostat data browser:
  https://ec.europa.eu/eurostat/databrowser/explore/all/economy
- Eurostat REST API docs:
  https://wikis.ec.europa.eu/display/EUROSTATHELP/API+Statistics+-+data+query
