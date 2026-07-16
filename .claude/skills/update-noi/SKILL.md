---
name: update-noi
description: Refresh the NOI (Национален осигурителен институт) social-security data behind /awarder/121082521 and the /pensions view. Three artifacts share this skill — the B1 per-fund cash-execution (ДОО 5500 / УчПФ 5591 / ГВРС 5592) → data/budget/noi/funds.json; the pension statistical yearbook ZIP → data/budget/noi/pensions.json (per-oblast average pension, size distribution, cash-vs-bank, national wage/income/pension series); and the КФН private-pension quarterly ZIP (pillars 2 & 3) → data/budget/kfn/funds.json. Use when the daily watch report flags `nssi_b1`, `nssi_yearbook`, or `kfn_pensions` as changed, when the user asks to refresh NOI / pensions / social-security / private-pension-fund data, when adding a new fiscal year, or after a fresh git clone if any of data/budget/noi/funds.json, data/budget/noi/pensions.json, or data/budget/kfn/funds.json is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - WebFetch
---

# Update NOI skill

Refreshes the NOI per-fund cash-execution data that powers the **"Социалноосигурителни фондове"** drill-down on `/budget`. Single artifact: `data/budget/noi/funds.json`.

Three funds at the EBK level — all aggregated to fund 5500 from sub-funds:

| EBK code | Fund | What it covers | 2024 expenditure |
|---|---|---|---|
| 5500 | ДОО (Държавно обществено осигуряване) | Pensions, sickness/maternity, unemployment, labour-injury | €12.59B |
| 5591 | Учителски пенсионен фонд | Teacher pension top-up | €53M |
| 5592 | Фонд "Гарантирани вземания на работниците и служителите" | Bankruptcy receivables | €1M |

## When to run

| Trigger | Action |
|---|---|
| Watcher: `nssi_b1` describe-line says "N new B1 file(s)" or "N B1 file(s) re-uploaded" | `tsx scripts/budget/noi/__write_funds.ts --fetch` (auto-downloads + rebuilds `funds.json`) |
| User asks to refresh NOI / social-security data | Same |
| Adding a new fiscal year (e.g. 2026 once Jan 2027 file lands) | Same — `TRY_YEARS` in `__write_funds.ts` already covers 2020-2025 |
| Fresh clone, `data/budget/noi/funds.json` missing | `--fetch` re-run (the Referer workaround pulls the bodies) |
| Watcher: `nssi_yearbook` says "N new yearbook ZIP(s)" | Pensions ingest (§ Yearbook below) → `pensions.json` |
| Watcher: `kfn_pensions` says "N new КФН statistics period(s)" | КФН ingest (§ КФН below) → `kfn/funds.json` |
| Fresh clone, `data/budget/noi/pensions.json` or `data/budget/kfn/funds.json` missing | Run the yearbook / КФН ingests below (both auto-fetch cleanly) |

## Procedure

### 1. Fetch + rebuild (one command)

```bash
tsx scripts/budget/noi/__write_funds.ts --fetch
```

`--fetch` downloads the full-year (`_12_`) B1 for every year × fund via
`scripts/budget/noi/fetch_b1.ts` before parsing. nssi.bg 302-redirects B1 GETs
to its homepage for most clients, but sending a **Referer** of the
`отчети-и-баланси` listing page defeats the redirect and serves the real BIFF8
body; the fetcher validates the OLE2 magic bytes so an HTML redirect is never
cached, and overwrites a cached file only when the bytes differ (reports
`saved` / `unchanged`). Years whose `_12_` file isn't published yet (the current
year mid-cycle — e.g. 2025 only had months 01–11 as of Jul 2026) simply 302 and
are skipped. Files land in `raw_data/budget/noi/`.

Then the writer iterates `TRY_YEARS = [2020..2025]`, skipping any year × fund
without a cached XLS, and writes `data/budget/noi/funds.json` (~16 KB).

Offline / testing: drop the `--fetch` flag to parse whatever is already cached.
To verify a cached file by hand: `file raw_data/budget/noi/B1_2024_12_5500.xls`
→ expect `Composite Document File V2 Document …` (an `HTML document` means a
stale manual download hit the redirect — re-run with `--fetch`).

Output sample:

```
  • 2024/5500: rev €6590528454M, exp €12585M
  • 2024/5591: rev €68700085M, exp €53M
  • 2024/5592: rev €1388894M, exp €1M
  →  wrote /Users/.../data/budget/noi/funds.json (1 year(s))
```

### 2. Sanity-check the output

Quick canary: the 2024 ДОО pensions figure (§4100) should be in the €11.0-€11.2B band. Anything below €5B or above €15B → re-check the source file or parser.

```bash
python3 -c "
import json
d = json.load(open('data/budget/noi/funds.json'))
for y in d['years']:
  print(y['fiscalYear'], 'pensions €', y['totals']['pensions']['amountEur'] // 1_000_000, 'M')
"
```

### 3. Stamp the ingest marker

```bash
tsx scripts/stamp-ingest.ts update-noi --summary "noi: 2024 (all 3 funds)"
```

## Yearbook → pensions.json (the /pensions view)

Separate artifact from `funds.json`. The НОИ pension statistical yearbook drives
the per-oblast average pension, the pension size distribution, the cash-vs-bank
split, and the national wage/income/pension series. Unlike the B1 files, the
yearbook **ZIP GETs cleanly** — no manual-download dance.

```bash
# Fetch the newest editions (clean XLSX exists 2022+; 2021/2025-style unpublished
# years return an HTML 404 at HTTP 200 — the parser sniffs the PK magic bytes and
# skips them). Anchor: the watcher's describe-line names the new year.
for y in 2022 2023 2024; do
  curl -sSL -o raw_data/budget/noi/yearbooks/Yearbook_Pensions_${y}.zip \
    "https://www.nssi.bg/wp-content/uploads/Yearbook_Pensions_${y}.zip"
done

tsx scripts/budget/noi/__write_pensions.ts   # → data/budget/noi/pensions.json
```

Sanity: the run prints `N oblasts, N brackets (Σ=<total>)` per year — the bracket
sum MUST equal the "Общо" pensioner headline or the parser throws (§ the sum gate
in `parse_yearbook_xlsx.ts`). The Eurostat poverty line is fetched inline; it
degrades to null offline. Then `git add data/budget/noi/pensions.json` and
`bucket:sync data/budget/noi/`.

## КФН → kfn/funds.json (private pillars 2 & 3)

The `/pensions` private-funds tile. КФН publishes a quarterly ZIP of English
workbooks. The URL is unpredictable (upload-dir + suffix) — the `kfn_pensions`
watcher fingerprints the `fsc.bg/.../statistics/YYYY-N/` sub-page list; when a new
period appears, open that sub-page and grab its `statistics_*.zip`.

```bash
# Download the newest quarter's ZIP (from the sub-page the watcher named), then:
curl -sSL -o raw_data/budget/kfn/statistics_2025_q2.zip "<the ZIP URL>"
tsx scripts/budget/kfn/__write_funds.ts       # → data/budget/kfn/funds.json
```

Only the four accumulation workbooks (UPF/PPF/VPF/VPFOS) are parsed; DPF/LPPF are
payout-phase with a different layout and skipped. Sanity: the run prints
`N funds [UPF:10 PPF:10 VPF:10 VPFOS:1]`. Then `git add` + `bucket:sync
data/budget/kfn/`.

## Parser internals

`scripts/budget/noi/parse_b1_xls.ts` reads two sheets:

- **OTCHET-agregirani pokazateli** — the cleanest summary view. Walks rows by their numbered Roman-section + Arabic-line labels (`II. РАЗХОДИ`, `1. Персонал`, `4. Социални разходи, стипендии`, etc) and emits a typed `NoiExpenseLine[]`. JavaScript regex `\b` doesn't anchor on Cyrillic letters, so the patterns rely on numbered prefixes (`^1\.`) for word separation rather than `\b`.
- **OTCHET** — the per-paragraph detail. Used to extract §4100 (Пенсии) and §4200 (Текущи трансфери, обезщетения и помощи) for the pension/benefit split. Codes 4100 / 4200 are **reused** across the revenue and expenditure sides of this sheet, so the parser disambiguates by matching on the column-2 label as well as the numeric code.

Amounts in B1 files are in **whole leva** (not thousands like the budget-law tables) — `moneyFromLeva` doesn't apply the ×1000 multiplier.

## Adding a new fiscal year

When a new full-year-end file (`B1_{YYYY+1}_12_5500.xls`) lands:

1. Manually download all three funds (5500, 5591, 5592) for the new YYYY.
2. Re-run `tsx scripts/budget/noi/__write_funds.ts` (no code change needed — the writer iterates years 2020-2025 and gracefully skips missing files).
3. Bump the `TRY_YEARS` array in `__write_funds.ts` if going past 2025.
4. Stamp the marker.

The watcher's `nssi_b1.ts` tracks the current and prior fiscal year — extend its `trackedYears()` function if you need monitoring of older years.

## File map

| Path | Purpose |
|---|---|
| `scripts/budget/noi/parse_b1_xls.ts` | XLS reader + typed snapshot builder |
| `scripts/budget/noi/__write_funds.ts` | Writer CLI (this is what you run) |
| `scripts/budget/noi/__smoke_b1.ts` | One-fund inspection for debugging |
| `raw_data/budget/noi/B1_*.xls` | Manually-cached source XLS files (gitignored) |
| `data/budget/noi/funds.json` | The committed artifact |
| `scripts/watch/sources/nssi_b1.ts` | Daily fingerprint of B1 file signatures |
| `src/data/budget/useBudget.tsx` (`useNoiFunds`) | React Query hook the drilldown consumes |
| `src/screens/components/budget/BudgetFlowSocialFundsDrilldown.tsx` | The UI |

## What this skill does NOT do

- **Sub-pension breakdown** (old-age vs. disability vs. survivors) — that requires parsing the annual NOI pension yearbook PDF (Table 6.3). Deferred to a separate skill / Phase 4 of the original plan.
- **NHIF (НЗОК) ingest** — that's a separate institution with its own budget law; not part of NOI.
- **Active labour-market measures** (Агенция по заетостта retraining) — passive unemployment benefits ARE in NOI fund 5500 §4200, but active measures sit in a different ministry budget.
