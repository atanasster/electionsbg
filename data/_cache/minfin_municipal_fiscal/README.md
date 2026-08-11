# Manual per-município financial-indicators drops (ЗПФ чл. 130г ал. 2)

`scripts/budget/municipal_fiscal/` (planned — see
`docs/plans/municipal-fiscal-commitments-v1.md`) parses the workbooks dropped here into a
per-município, per-quarter series covering the three liability stocks Bulgarian public finance
distinguishes. The raw `.xlsx`/`.pdf` are gitignored; the parsed JSON is committed.

**Source:** [minfin.bg/bg/810](https://www.minfin.bg/bg/810) — „Финансови показатели на
общините", published by Дирекция „Финанси на общините". Catalogued on data.egov.bg and
mirrored (metadata only) at [data.europa.eu dataset 4229](https://data.europa.eu/data/datasets/4229?locale=bg).

## Why manual

Same reason as `../minfin_arrears/`: minfin.bg sits behind Cloudflare, which 403s every
non-browser client and serves an **interactive Turnstile**. data.egov.bg — where the dataset is
also published — 403s this project's egress (origin IP/reputation rule; see the egov notes).
Download from a real browser (Safari / regular Chrome both pass) and drop the file here
**unrenamed**.

## What is here

| file | contents |
|---|---|
| `1. quarterly-reports-Q22024-Q42024-Q22025-website.xlsx` | Q2-2024 · Q4-2024 · Q2-2025 |
| `1. quarterly-reports-Q32024-Q42024-Q32025-website.xlsx` | Q3-2024 · Q4-2024 · Q3-2025 |
| `4. municipal-analysis of negative trends 31 03 2025.pdf` | МФ narrative analysis to 31.03.2025 (national aggregates + methodology) |

**Both workbooks are needed — they carry disjoint quarters.** Each publishes three quarters in
a rolling comparison (prev / final / current), and they overlap only on **Q4-2024**. Verified
2026-08-11: that shared column is **identical across the two files** (2,120 numeric cells, 0
mismatches), so they merge safely and the overlap doubles as a parser self-check.

## Sheet structure (`показатели`)

265 data rows from row 3, one per община. **Col A = МФ/ЕБК municipal code** (`5101` Банско …
`7805`), **col B = name**. The code is *not* an EKATTE obshtina code — a crosswalk is needed;
join on the name and key on the МФ code.

**Sofia is a single row** (`7200`, „Столична община"). The 24 районни администрации do **not**
report separately here.

Header layout: row 1 = indicator title (merged across its group), row 2 = the period label
(`2024 Q3` / `2024 Q4` / `2025 Q3`). Every indicator is three consecutive columns, one per
quarter, in the workbook's own prev/final/current order.

### The columns that matter (1-based)

| cols | field | unit |
|---|---|---|
| 30–32 | Общински приходи по чл. 45 ал. 1 т. 1 ЗПФ (без §46/§47/§48) | лв. |
| 33–35 | Общински разходи по чл. 45 ал. 1 т. 2 ЗПФ (без §19) | лв. |
| 36–38 | Бюджетно салдо | лв. |
| 39–41 | Налични средства по бюджета (вкл. преводи в процес на сетълмент) | лв. |
| 42–44 | Размер на общинския дълг | лв. |
| **45–47** | **Просрочени задължения по бюджет** | лв. |
| **48–50** | **Задължения за разходи по бюджет** | лв. |
| **51–53** | **Поети ангажименти за разходи по бюджет** | лв. |
| 54–56 | Дял на просрочените задължения — see the denominator trap below | % |
| 57–59 | Дял на задълженията за разходи | % |
| 60–62 | Дял на поетите ангажименти | % |
| 63–65 | Събираемост ДНИ · ДПрС · осреднена (Q4 only) | % |

Cols 3–29 are the eight РМС 436/2017 financial-sustainability indicators (приходен дял,
покритие на местните дейности, салдо, дълг, просрочия, население на служител, заплати,
капиталови разходи).

**The source publishes LEVELS in лв., not only ratios** — which is what makes a national
aggregate, a reconciliation and a re-basing possible at all.

### ⚠ The denominator switches by quarter

Cols 54–62 look like one indicator each but are not comparable across the three columns:

- **Interim quarters (Q1–Q3):** denominator is *планираните разходи за годината*.
- **Q4:** denominator is *отчетените разходи* (arrears) or *средногодишните разходи за
  последните 4 години* (obligations, commitments) — i.e. **only the Q4 column carries the
  actual чл. 130а criterion ratio**.

So the published ratios cannot be charted as a quarterly series, and `criteriaMet` /
`isDistressed` are Q4-only. Store the levels and the denominators; re-derive every ratio.

Row 1 also carries a footnote: for indicators 1–5 помощи и дарения are deducted from total
revenue.

### Other sheets

- `СЕС-код 42 и код 98` (272 × 50) — the EU-funds (код 42) and other (код 98) accounts, same
  município grain.
- `общини фин. оздр.` (33 × 82) — the subset in **финансово оздравяване** (чл. 130д), same
  indicator columns. This is the official distress list.

## Verified reconciliation (2026-08-11)

Summing col 46 (просрочени, Q4-2024) over all 265 rows gives **143,017,277 лв = €73.1m** —
which matches, exactly:

- `../arrears.json` → 2024 `breakdownEurM.local` = **€73.1m** (parsed independently from the
  national year-end Обобщена справка), and
- the negative-trends PDF's implied 31.12.2024 figure (171.6м лв at 31.03.2025, „с 28,6 млн.
  лв. спрямо размера към 31.12.2024 г." → **143.0м лв**).

Three independent МФ publications agree to the lev. Keep this as the T3.1 gate's expected value.

## How to refresh / add quarters

1. Open <https://www.minfin.bg/bg/810> in Safari or regular Chrome.
2. Save the quarterly workbook (`1. quarterly-reports-…-website.xlsx`) and, if published, the
   matching „анализ на негативните тенденции" PDF. **Don't rename them** — the quarters are
   parsed from the filename and re-confirmed against row 2.
3. Move them into this directory.
4. From the repo root: `npx tsx scripts/budget/municipal_fiscal/ingest.ts` (planned).

Each workbook carries three quarters, so two files a year cover most of it; grab both the
Q2- and Q3-anchored releases to avoid gaps.

## Note on units

Values are **лева** through 2025 and **евро** from 01.01.2026 (the dataset description states
this explicitly). Detect the unit per file rather than assuming; the currency-board rate is
locked at 1.95583, so conversion is exact and a 4-year average spanning the changeover is not
an approximation.
