---
name: update-noi
description: Refresh the NOI (Национален осигурителен институт) social-security fund-execution data — re-parse the cached B1 per-fund monthly XLS files for ДОО (5500), УчПФ (5591), and ГВРС (5592) and rebuild data/budget/noi/funds.json. Use when the daily watch report flags `nssi_b1` as changed (a new month's B1 has been uploaded or an existing one was re-uploaded), when the user asks to refresh NOI / social-security funds data, when adding a new fiscal year, or after a fresh git clone if data/budget/noi/funds.json is missing.
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
| Watcher: `nssi_b1` describe-line says "N new B1 file(s)" or "N B1 file(s) re-uploaded" | Manual fetch + re-run (steps below) |
| User asks to refresh NOI / social-security data | Same |
| Adding a new fiscal year (e.g. 2026 once Jan 2027 file lands) | Same — `TRY_YEARS` in `__write_funds.ts` already covers 2020-2025 |
| Fresh clone, `data/budget/noi/funds.json` missing | Manual fetch + re-run; auto-fetch is unreliable |

## Procedure

### 1. Manually download new B1 XLSes

Auto-fetch from `nssi.bg/wp-content/uploads/B1_{YYYY}_{MM}_{FUND}.xls` is **unreliable** — the NSSI returns HTTP 302 redirecting to the homepage on GET requests for many user-agents, despite returning HTTP 200 on HEAD. The watcher uses HEAD-only probing for the fingerprint, but the ingest needs the body bytes.

For each year × fund the watcher flagged as added/changed:

```bash
mkdir -p raw_data/budget/noi
for fund in 5500 5591 5592; do
  curl -sSL -o raw_data/budget/noi/B1_2024_12_${fund}.xls \
    "https://www.nssi.bg/wp-content/uploads/B1_2024_12_${fund}.xls" \
    -A "Mozilla/5.0 (compatible; electionsbg-budget/1.0)"
done
```

After download verify each file is a real BIFF8 document:

```bash
file raw_data/budget/noi/B1_2024_12_5500.xls
# Expected: Composite Document File V2 Document, Little Endian, Os: Windows, Code page: 1251, …
# If you see "HTML document" — the NSSI redirect bit you. Try a different UA or hit the
# nssi.bg page in a browser first to seed cookies, then retry curl from the same shell.
```

### 2. Run the writer

```bash
tsx scripts/budget/noi/__write_funds.ts
```

The writer iterates `TRY_YEARS = [2020..2025]`, skipping any year × fund combo that doesn't have a cached XLS. It writes `data/budget/noi/funds.json` (~16 KB across the available fiscal years).

Output sample:

```
  • 2024/5500: rev €6590528454M, exp €12585M
  • 2024/5591: rev €68700085M, exp €53M
  • 2024/5592: rev €1388894M, exp €1M
  →  wrote /Users/.../data/budget/noi/funds.json (1 year(s))
```

### 3. Sanity-check the output

Quick canary: the 2024 ДОО pensions figure (§4100) should be in the €11.0-€11.2B band. Anything below €5B or above €15B → re-check the source file or parser.

```bash
python3 -c "
import json
d = json.load(open('data/budget/noi/funds.json'))
for y in d['years']:
  print(y['fiscalYear'], 'pensions €', y['totals']['pensions']['amountEur'] // 1_000_000, 'M')
"
```

### 4. Stamp the ingest marker

```bash
tsx scripts/stamp-ingest.ts update-noi --summary "noi: 2024 (all 3 funds)"
```

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
