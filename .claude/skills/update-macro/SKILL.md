---
name: update-macro
description: Refresh the macro indicators data (data/macro.json), the budget functional-classification artifact (data/cofog.json), and the EU peer-comparison artifact (data/macro_peers.json) — re-fetch Eurostat quarterly/annual series, World Bank WGI (incl. all six dimensions via source 3 for the /indicators/compare radar), COFOG (gov_10a_exp incl. per-peer composition), gov_10a_main peer series, SILC inequality (ilc_di12, ilc_di11, ilc_peps01n) + life expectancy (demo_mlexpec) + criminal-justice indicators (crim_off_cat intentional-homicide rate, crim_pris_age prisoners per 100K — both with EU27 computed from member-state means) for the EU compare dashboard, and curated tables. Use when the daily watch report flags new Eurostat releases ("Eurostat macro (BG): new release"), when the user asks to refresh macro data, when adding a new indicator, or after the curated CPI / Eurobarometer tables get a new year's value pasted in.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Macro skill

Refreshes `data/macro.json` — the per-Bulgarian-cabinet macro/governance backdrop rendered on `/governments`. Pulls quarterly Eurostat series (GDP growth, HICP inflation, unemployment, gov debt, budget balance, current account; same fiscal/external triple plus government revenue + expenditure in nominal EUR), the **authoritative annual ESA deficit ratio** (`esaBalanceAnnual`, from the EDP notification table `gov_10dd_edpt1` — the figure Eurostat headlines, e.g. BG 2025 = −3.5%), annual Eurostat GDP per capita, annual nominal GDP and net inward FDI, World Bank WGI, plus curated CPI / Eurobarometer trust / EU funds.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `Eurostat macro (BG): new release · namq_10_gdp <date>, ...` | Run `npx tsx scripts/macro/fetch_eurostat.ts` |
| Daily watcher reports `Eurostat macro (BG): new release · gov_10a_exp <date>` | Run `npx tsx scripts/macro/fetch_cofog.ts` to refresh `data/cofog.json` (general-government expenditure by COFOG function, consumed by the /budget functional-classification tile and the tax-bill calculator) |
| Daily watcher reports `Eurostat macro (BG): new release` of **any** dataset the peer fetch reads — `gov_10a_main`, `prc_hicp_minr`, `namq_10_gdp`, `une_rt_q`, `lfsi_emp_q` (employment + activity rate), `gov_10q_ggdebt`, `gov_10q_ggnfa`, `ei_bpm6ca_q`, `prc_hpi_q`, or any of the EU compare dashboard's annual sources (`ilc_di12`, `ilc_di11`, `ilc_peps01n`, `demo_mlexpec`, `crim_off_cat`, `crim_pris_age`, `lfsi_sla_a` labour-market slack) | Run `npx tsx scripts/macro/fetch_eu_peers.ts` to refresh `data/macro_peers.json`. The script writes four things into the same file: (a) the legacy gov_10a_main 6-country (BG, EU27, RO, GR, HU, HR) revenue/expenditure/balance series + 27-member distribution that powers the `/budget` headline-card peer chips; (b) per-indicator quarterly peer series for inflation (HICP), real GDP growth, unemployment, government debt %GDP, budget balance %GDP, current account %GDP, house-price index YoY, and youth unemployment — plus a 27-member EU rank snapshot for each direction-unambiguous indicator (powers the `/indicators` peer-overlay + the snapshot table on `/indicators/compare`); (c) annual per-peer series for SILC Gini, S80/S20 quintile share ratio, AROPE, life expectancy at birth, intentional-homicide rate per 100K (`crim_off_cat`, ICCS0101), and prisoners per 100K (`crim_pris_age`) — for the `/indicators/compare` inequality + society panels. The two `crim_*` series set `computeEu27FromMembers: true` because Eurostat doesn't publish EU27_2020 for those tables; the fetcher computes the aggregate as an unweighted mean across the 27 members (≥20-reporter threshold per year); (d) a `wgi` top-level block: World Bank Worldwide Governance Indicators (six dimensions VA/PV/GE/RQ/RL/CC, latest year snapshot per peer + computed EU27 mean) — for the `/indicators/compare` WGI radar tile. In practice: any Eurostat or World Bank WGI watcher flip should run `fetch_eu_peers.ts` after `fetch_eurostat.ts`. **Then run `npx tsx scripts/macro/fetch_food_pli.ts`** — it merges a `foodPli` block into the same `data/macro_peers.json` (official Eurostat food Price Level Indices, `prc_ppp_ind_1`, COICOP-2018 food categories, EU27=100; queries Greece as `EL`, stores `GR`; preserves the file's pretty-print) that powers the `/consumption/eu` BG-vs-EU food comparison and the `euFoodPriceLevels` AI chat tool. Self-contained targeted merge — does not re-fetch the peer set. |
| Daily watcher reports `Eurostat macro (BG): new release · gov_10a_exp <date>` (already covered above for fetch_cofog.ts) | The same fetch_cofog.ts run now also emits the `peerSeries` block (per-peer COFOG composition for 6 geos at latest year) — no extra step. Powers the COFOG small-multiples + delta annotations on `/indicators/compare`. |
| Daily watcher reports `World Bank WGI (Bulgaria, Rule of Law canary): new release` | WGI publishes all six dimensions simultaneously per WB convention; the Rule of Law canary signals the whole release. Run `npx tsx scripts/macro/fetch_eu_peers.ts` — the WGI pass pulls all six dimensions for the 27 EU members from World Bank source 3 (codes `GOV_WGI_VA.EST`/`PV.EST`/`GE.EST`/`RQ.EST`/`RL.EST`/`CC.EST` plus the `.SC` percentile counterparts) and computes the EU27 unweighted mean client-side. |
| Daily watcher reports `BNB domestic ДЦК auctions: N new auction(s)` | Run `npx tsx scripts/macro/fetch_bnb_auctions.ts` to re-scrape `data/debt-emissions-domestic.json` |
| Daily watcher reports `Minfin government-debt bulletins (Eurobond signal): N new debt bulletin(s) ... — check for a new Eurobond` | The **international** Eurobond list is hand-curated (there is no scraper). A new monthly MoF debt bulletin is the trigger to check for a syndicated placement the curated list is missing. Open the latest bulletin at <https://www.minfin.bg/bg/statistics/20> (or its Wayback capture — live minfin.bg is Cloudflare-walled) plus the LuxSE Bulgaria issuer page <https://www.luxse.com/issuer/Bulgaria/33947>, then hand-add any new `market: "international"` entry to `data/debt-emissions.json` (see the "New international Eurobond announced" row below). NOTE: Wayback lags real publication by weeks — this is the robust automated *flag*, not a same-day alert. |
| Daily watcher reports `BNB monthly FDI flows: new month <YYYY-MM>` (or `revised data`) | Run `npx tsx scripts/macro/fetch_bnb_fdi.ts` to refresh `data/macro_fdi.json` — monthly net FDI flow (BPM6) + equity/reinvested-earnings/debt components back to 2010 + the year-to-date current-vs-prior summary. Powers the "Преки чуждестранни инвестиции — месечни (БНБ)" tile on `/indicators/fiscal` (the figures the euro-adoption FDI coverage cites). Self-contained — no `fetch_eurostat.ts` re-run needed. |
| Daily watcher reports `Minfin КФП monthly bulletins: N new bulletin(s) cached` | Run `npx tsx scripts/macro/fetch_fiscal_reserve.ts` to re-scrape the fiscal-reserve series via Wayback (mreport PDFs + BULETIN PDFs + FRA XLSX). The script caches files under `data/_cache/minfin_mreports/` and writes `data/_cache/fiscal-reserve.json` (median across sources). Then re-run `npx tsx scripts/macro/fetch_eurostat.ts` so the new quarterly stock is baked into `data/macro.json` under `fiscalReserve`. |
| User asks to extend fiscal-reserve past the Wayback cutoff (~April 2025) | Open <https://www.minfin.bg/bg/statistics/4> in a browser and "Save link as" each `Фискален резерв по месеци към DD.MM.YYYY г.` link directly into `data/_cache/minfin_fr_xlsx/` (keep the upstream filename `FRA-MM-YYYY-BG.xlsx`). Then run the two scripts as above. See `data/_cache/minfin_fr_xlsx/README.md` for the full workflow. |
| Daily watcher reports `EC EU budget per-MS spreadsheet ... new EC edition · year range 2000-XXXX → 2000-YYYY` | Refresh `EU_FUNDS` / `EU_CONTRIBUTION` from the new XLSX (see [EU funds / contribution series](#eu-funds--contribution-series-ec-per-ms-xlsx) below), then run `npx tsx scripts/macro/fetch_eurostat.ts` |
| User asks to "refresh macro" or "update macro data" | Same |
| Adding a new Eurostat indicator to the chart | Add an entry to `EUROSTAT_INDICATORS` in `scripts/macro/fetch_eurostat.ts`, then run |
| Annual TI CPI / Eurobarometer figure published | Paste the new `{ year, value }` into the curated arrays at the top of `fetch_eurostat.ts`, then run |
| Refresh the BNB domestic debt-emissions table on `/indicators` | Run `npx tsx scripts/macro/fetch_bnb_auctions.ts` — re-scrapes `https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/...` and writes `data/debt-emissions-domestic.json`. Idempotent; run after the watcher flags a new BNB auction. |
| New international Eurobond announced (or flagged by the `minfin_eurobond` watcher above) | Hand-edit `data/debt-emissions.json` (curated international list) — add the entry with `market: "international"`, sort by `issueDate` desc, and bump `fetchedAt`. Source the figures (coupon, maturity, yield, ISIN, arrangers) from the MoF monthly debt bulletin and/or the LuxSE listing rather than a news article. |

## Step 1 — Fetch

```bash
npx tsx scripts/macro/fetch_eurostat.ts
```

Expected output on a normal day:

```
Loading gdpGrowth (eurostat)... 84 points (latest 2025 Q4)
Loading inflation (eurostat)... 85 points (latest 2026 Q1)
Loading unemployment (eurostat)... 68 points (latest 2025 Q4)
Loading gdpPerCapita (eurostat)... 21 points (latest 2025)
Loading govDebt (eurostat)... 84 points (latest 2025 Q4)
Loading budgetBalance (eurostat)... 84 points (latest 2025 Q4)
Loading currentAccount (eurostat)... 84 points (latest 2025 Q4)
Loading wgiRuleOfLaw (worldbank)... 20 points (latest 2024)
...
Wrote /Users/.../data/macro.json
```

The script auto-fails on a count regression — see "Data-integrity contract" below — so if you see "safety check: <key> dropped from N → M points (X% < -10%)", treat as a regression and investigate before re-running.

## Step 2 — Verify

Quick sanity check on the new file:

```bash
node -e "
const d = require('./data/macro.json');
for (const [k, s] of Object.entries(d.series)) {
  const last = s[s.length - 1];
  const tail = last.quarter ? last.year + ' Q' + last.quarter : last.year;
  console.log(k.padEnd(20), 'n=' + String(s.length).padStart(3), 'latest', tail, '=', last.value);
}
console.log('size:', require('fs').statSync('./data/macro.json').size, 'bytes');
"
```

Eyeball:
- `gdpGrowth`, `inflation`, `unemployment`, `govDebt`, `budgetBalance`, `currentAccount` should be quarterly (`latest YYYY Q[1-4]`).
- Latest quarter is at most 1-2 quarters behind current date — Eurostat publishes Q1 in late June, so May-June you see Q4 of prior year; Sep+ you see Q1 of current year.
- WGI / CPI / Eurobarometer are annual and lag by ~1 year — that's normal.
- File size should be ~40-50 KB. >100 KB is a regression.

## Step 3 — Upload to bucket

```bash
npm run bucket:sync
```

(Or `npm run bucket:sync:dry-run` first to preview.) This rsyncs `data/macro.json` (and any other changed data files) to `gs://data-electionsbg-com/`.

## Step 4 — Commit

```bash
git add data/macro.json
git commit -m "macro: refresh through <latest period>"
```

If you added a new indicator, also commit the script change:

```bash
git add scripts/macro/fetch_eurostat.ts data/macro.json
git commit -m "macro: add <indicatorKey> from Eurostat <dataset_code>"
```

## Adding a new indicator (advanced)

Add an entry to `EUROSTAT_INDICATORS` in `scripts/macro/fetch_eurostat.ts`:

```ts
{
  source: "eurostat",
  key: "newKey",                    // also add to MacroIndicatorKey in src/data/macro/useMacro.tsx
  dataset: "dataset_code",          // Eurostat code, e.g. "namq_10_gdp"
  query: { geo: "BG", /* ... */ }, // narrowing dim filters
  cadence: "quarterly",             // or "annual"
  // If the upstream dataset is monthly but the chart should show quarterly:
  // aggregate: "monthlyAvgToQuarter",
  sourceUrl: "https://ec.europa.eu/eurostat/databrowser/view/<dataset>/default/table",
  unitLabelEn: "...", unitLabelBg: "...",
  titleEn: "...",    titleBg: "...",
},
```

Then:
1. Add the key to `MacroIndicatorKey` in `src/data/macro/useMacro.tsx`.
2. Add a colour in `SERIES_COLORS` in `src/screens/components/governments/GovernmentTimeline.tsx`.
3. Add the indicator to a section's `indicatorKeys` in `src/screens/GovernmentsScreen.tsx` (and source link in the `ChartSources`).
4. If the section needs its own chart, copy an existing `<section>` block.
5. Run this skill to regenerate `data/macro.json`.

Before adding a new dataset, verify the query against the Eurostat REST API:

```bash
curl -s 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/<dataset>?format=JSON&lang=EN&<query>&lastTimePeriod=4' | head -c 1500
```

A 400 `INVALID_QUERY_DIMENSION` means the dimension name is wrong — inspect the dataset's dimensions:

```bash
curl -s 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/<dataset>?format=JSON&lang=EN&geo=BG&lastTimePeriod=1' | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
for k, v in d.get('dimension', {}).items():
  print(k, list(v.get('category', {}).get('index', {}).keys())[:15])
"
```

A 413 `EXTRACTION_TOO_BIG` means a dimension wasn't narrowed enough — add a filter.

## EU funds / contribution series (EC per-MS XLSX)

Unlike the other curated tables (TI CPI, Eurobarometer), `EU_FUNDS` and `EU_CONTRIBUTION` are **sourced from a known upstream spreadsheet** — the European Commission's "EU spending and revenue" per-Member-State XLSX. The daily watcher (`scripts/watch/sources/ec_budget_per_ms.ts`) fingerprints the listing page's XLSX link; when the EC publishes a new edition (typically the July following the reference year), the watcher flips and this skill should re-pull.

### Listing page

```
https://commission.europa.eu/strategy-and-policy/eu-budget/long-term-eu-budget/2021-2027/spending-and-revenue_en
```

The current XLSX link can be read directly from `state/watch/ec_budget_per_ms.json`'s `meta.href` field; prepend `https://commission.europa.eu` if it starts with `/`.

### Refresh procedure

1. Read the latest XLSX URL out of the watcher state:

   ```bash
   HREF=$(jq -r '.meta.href' state/watch/ec_budget_per_ms.json)
   URL="https://commission.europa.eu${HREF}"
   curl -sL "$URL" -o /tmp/ec_budget.xlsx
   ```

2. Extract Bulgaria's `TOTAL EXPENDITURE` and `TOTAL National contributions` rows from every per-year sheet. The column header for Bulgaria is `"BG"` and lives somewhere in rows 1–5 (varies by year). Pre-2014 sheets use `TOTAL national contribution` (lowercase, no NGEU breakout); 2014+ use the same label; 2021+ also include a `TOTAL NGEU` row which the per-year `TOTAL EXPENDITURE` already rolls up — do not double-count.

   ```bash
   python3 <<'PY'
   from openpyxl import load_workbook
   import warnings; warnings.filterwarnings('ignore')
   wb = load_workbook('/tmp/ec_budget.xlsx', data_only=True)
   for sheet in wb.sheetnames:
     try:
       year = int(sheet)
     except ValueError:
       continue
     if year < 2007: continue
     ws = wb[sheet]
     bg = next(
       (c for hr in range(1, 6) for c in range(1, ws.max_column + 1)
        if ws.cell(hr, c).value == 'BG'),
       None,
     )
     if not bg: continue
     exp = nat = None
     for r in range(1, ws.max_row + 1):
       label = ' | '.join(str(ws.cell(r, c).value) for c in range(1, 6) if ws.cell(r, c).value)
       if 'TOTAL EXPENDITURE' in label.upper(): exp = ws.cell(r, bg).value
       elif 'TOTAL national contribution' in label or 'TOTAL National contribution' in label: nat = ws.cell(r, bg).value
     if exp is not None and nat is not None:
       print(f"{year}\t{round(exp/1000, 2)}\t{round(nat/1000, 2)}")
   PY
   ```

   Columns are `year`, `EU_FUNDS (€B)`, `EU_CONTRIBUTION (€B)` — both rounded to two decimals.

3. Patch `EU_FUNDS` and `EU_CONTRIBUTION` in `scripts/macro/fetch_eurostat.ts` with the new figures. Diff carefully — only new years should be additions; pre-existing years should generally match (the EC occasionally restates older sheets when an own-resources reconciliation closes, so small revisions are normal).

4. Run the fetcher to regenerate `data/macro.json`:

   ```bash
   npx tsx scripts/macro/fetch_eurostat.ts
   ```

5. Eyeball the chart on `/governments` (EU funds section) — the new year should appear at the right edge with the same units (€B).

### Why this isn't fully automated

The per-year sheet schema has shifted twice since 2007 (2014 layout overhaul, 2021 NGEU rollup) and the BG column position drifts. A scripted ingest would need defensive parsing that's brittle in its own way. Hand-patching keeps the curated arrays auditable in `git blame` and lets the operator catch silent restatements of prior years.

### Note on the 2008 funds suspension

`EU_FUNDS` for 2008 is €0.97B — gross EU disbursements rose YoY despite the mid-year freeze of ~€825M in pre-accession funds (PHARE/ISPA/SAPARD) after OLAF investigations. The freeze hit *future commitments*; CAP direct payments and structural-fund pre-financing kept flowing in calendar 2008. The chart shows this with a dedicated reference-line marker — see `governments_chart_eu_funds_2008_marker` in translations and the `eventMarkers` prop on `GovernmentTimeline`.

## Data-integrity contract

The fetcher is designed to **fail loud rather than write a partial `data/macro.json`** when an indicator's upstream API returns errors or unexpected data.

Fail-loud surfaces (the script throws and writes nothing):

| Surface | Trigger |
|---|---|
| Eurostat HTTP non-2xx for any indicator | `Eurostat <key> returned <status> for <url>` |
| World Bank HTTP non-2xx for any WGI series | `World Bank <key> returned <status> for <url>` |
| Any per-indicator parsing exception | Logged as `failed: <message>` then re-thrown — halts the whole run |
| `process.exit(1)` from the top-level `.catch` | Any unhandled rejection during the run |

Two layers of count-based guards are enforced automatically (since adding the `minPoints` plumbing):

1. **Absolute floor.** Each Eurostat / WorldBank indicator must return at least its `minPoints` (or the cadence default: 60 quarterly, 12 annual). A fetch returning fewer points throws `safety check: <key> (<source>) returned N points, below floor F`. Catches the catastrophic case where the upstream query is silently rejected and returns near-empty data. Override per-indicator on series with known shorter history (e.g. `retailVolume` starts ~2014, override `minPoints: 35`).

2. **Regression vs. prior committed run.** Before writing, each fetched series is compared against the same `key` in the previously-committed `data/macro.json`. If the count dropped by more than 10%, throws `safety check: <key> dropped from P → C points (X% < -10%)`. Catches the gradual case where the upstream still answers but with a narrower window (dimension filter semantics changed). Run the same script after a clean fetch to re-seed the baseline.

Curated series (CPI, Eurobarometer, EU funds) bypass both checks — they're inline constants in `fetch_eurostat.ts` and self-validating.

Intentional non-fatal skips:

| Surface | Behaviour |
|---|---|
| Curated CPI / Eurobarometer / EU-funds entry missing for a year | The chart simply lacks that point; no error. These are inline constants edited by hand. |
| Quarterly Eurostat dataset returning a `null` last cell (publication lag) | Filtered out of the series; no warning needed. Standard Eurostat behaviour at the leading edge. |

After every run, eyeball the per-indicator `N points (latest …)` lines. If a series suddenly halves, the upstream query was rejected silently OR the dataset publisher changed dimensions — investigate before committing.

### Annual ESA deficit — the EDP series is the single source of truth

The per-year headline deficit/surplus ratio (the **Салдо (ЕСС)** column/bars on `/indicators/budgets`) comes **only** from `esaBalanceAnnual` (Eurostat `gov_10dd_edpt1`, na_item `B9`, sector `S13`, unit `PC_GDP`, freq `A`) — the EDP-notification annual figure.

**Never reconstruct the annual deficit by summing the quarterly `budgetBalance` / `budgetBalanceNominal` series and dividing by GDP.** Those quarterly series are `s_adj: SCA` (seasonally + calendar adjusted) and come from a different quarterly-GFS vintage (`gov_10q_ggnfa`); their four-quarter sum drifts **0.1–0.5pp** from the official annual. This was a real bug: before `esaBalanceAnnual` existed the scorecard read **2025 = −3.6% (official −3.5%)** and **2021 = −3.5% (official −4.0%)**, and the "deepest deficit" stat showed **−4.7% '14** instead of the correct **−5.4%**. The quarterly SCA triple is for within-year *shape* only. `CabinetBudgetScorecard.tsx` reads `esaBalanceAnnual` directly and only falls back to the summed-quarters derivation if that series is absent (stale `macro.json`).

A quick sanity check after a refresh — these must match the Eurostat EDP table exactly:
```bash
curl -s 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/gov_10dd_edpt1?format=JSON&lang=EN&geo=BG&na_item=B9&sector=S13&unit=PC_GDP&lastTimePeriod=6' | python3 -c "import json,sys;d=json.load(sys.stdin);i=d['dimension']['time']['category']['index'];v=d['value'];print({k:v.get(str(p)) for k,p in i.items()})"
```

## What this skill does NOT do

- **Does not change the chart UI.** Adding a new indicator key requires hand-editing `useMacro.tsx`, `GovernmentTimeline.tsx`, and `GovernmentsScreen.tsx` (see above). The skill only refreshes data.
- **Does not redownload curated tables automatically.** TI CPI and Eurobarometer trust are inline constants in `fetch_eurostat.ts` and must be updated by hand when the publishing body releases a new year. `EU_FUNDS` / `EU_CONTRIBUTION` are also inline but have a known upstream (EC per-MS XLSX) — the daily watcher detects new editions and this skill includes a refresh procedure (see "EU funds / contribution series" above).
- **Does not auto-fire on its own.** The watcher reports new Eurostat releases; the user (or a GitHub Action) decides when to refresh.

## File map

| Path | Purpose |
|---|---|
| `scripts/macro/fetch_eurostat.ts` | CLI entry — fetch all macro series + curated tables, write `data/macro.json` |
| `scripts/macro/fetch_cofog.ts` | CLI entry — fetch general-government expenditure by COFOG function (gov_10a_exp), write `data/cofog.json` (BG series + 27-member peer distribution) |
| `scripts/macro/fetch_eu_peers.ts` | CLI entry — two-pass fetch into `data/macro_peers.json`. Pass 1: legacy gov_10a_main (annual % GDP) revenue/expenditure/balance for BG + EU27 + RO + GR + HU + HR + the 27-member distribution. Pass 2: per-indicator quarterly peer series for inflation, GDP growth, unemployment, government debt %GDP, budget balance %GDP, current account %GDP, house-price index YoY, youth unemployment — plus a 27-member latest-quarter rank snapshot for each direction-unambiguous indicator. |
| `scripts/macro/fetch_bnb_fdi.ts` | CLI entry — download the БНБ monthly FDI-by-investment-type SpreadsheetML export (pageId 544), parse total/equity/reinvested/debt back to 2010, derive the year-to-date current-vs-prior summary, write `data/macro_fdi.json` |
| `scripts/watch/sources/bnb_fdi.ts` | Daily watcher (monthly cadence) — fingerprints the same monthly FDI export; a new reporting month advances the latest `YYYY-MM`, a revision flips the content hash |
| `scripts/watch/sources/eurostat.ts` | Daily watcher — fingerprints every tracked Eurostat dataset (quarterly macro triple, annual GDP, COFOG, gov_10a_main peer series, …). The dataset-level `updated` timestamp is geo-independent, so fingerprinting with `geo=BG` correctly catches new releases that also affect EU27/RO/GR/HU/HR peer series. |
| `scripts/watch/sources/ec_budget_per_ms.ts` | Daily watcher — fingerprints the EC per-MS XLSX link (EU funds / contribution source) |
| `data/macro.json` | Generated payload (~40 KB, minified) — committed |
| `data/cofog.json` | Generated payload — Eurostat COFOG annual series, top-level functions GF01..GF10 + TOTAL, ~15 years, plus per-function 27-member peer band — committed |
| `data/macro_peers.json` | Generated payload — legacy gov_10a_main 6-country series (BG, EU27, RO, GR, HU, HR) + 27-member distribution that powers the /budget headline-card peer chips, **plus** quarterly per-indicator peer series and latest-quarter EU rank snapshots that power the /indicators peer-overlay (Compare with EU peers toggle). HR replaced PL as a CEE peer; GR joined as a southern geographic neighbor. — committed |
| `data/macro_fdi.json` | Generated payload (~32 KB, minified) — БНБ monthly FDI flows (total + equity + reinvested earnings + debt) since 2010 + the YTD current-vs-prior block — committed |
| `src/data/macro/useMacro.tsx` | React Query hook + types |
| `src/data/macro/useMacroFdi.tsx` | React Query hook + types for `data/macro_fdi.json` |
| `src/screens/components/macro/FdiMonthlyTile.tsx` | БНБ monthly FDI tile on `/indicators/fiscal` (YTD headline cards + monthly component chart) |
| `src/screens/components/governments/GovernmentTimeline.tsx` | Chart |
| `src/screens/GovernmentsScreen.tsx` | Page that hosts the chart sections |
