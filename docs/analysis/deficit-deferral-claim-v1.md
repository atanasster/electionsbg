# „Дълговата спирала започна през 2021 и оттогава всички правителства бутат дефицити към следващата бюджетна година"

Fact-check of the claim against the data actually in this repo, 2026-08-11.

The claim decomposes into three testable assertions:

- **A.** The debt spiral started in **2021**.
- **B.** Every government since 2021 has deferred payments into the next budget year.
- **C.** The purpose/effect was an artificially low **registered** deficit.

Verdict: **A is wrong on both readings of "spiral". B is true for 2021–2022 and
false for 2023–2024 on the one indicator that can see it — but the direct
statistic (просрочени задължения) refutes the mechanism entirely, and that
statistic is structurally blind to the exact practice being alleged. C is not
testable with what we hold.**

---

## A. Did the debt spiral start in 2021?

`macro.json` → `govDebtNominal` (Eurostat `gov_10q_ggdebt`), `govDebt` (% GDP).

| year | debt €m | YoY €m | debt % GDP |
|-----:|--------:|-------:|-----------:|
| 2019 | 12,311 |   −116 | 20.1 |
| 2020 | 15,132 | **+2,821** | 24.5 |
| 2021 | 17,015 | **+1,884** | 23.8 |
| 2022 | 19,355 | +2,340 | 22.5 |
| 2023 | 21,675 | +2,320 | 22.9 |
| 2024 | 24,977 | +3,302 | 23.8 |
| 2025 | 34,635 | **+9,658** | **29.9** |

Two independent readings, both against the claim:

- **In levels**, the break is **2020** (+€2.82bn, the largest jump since the
  crisis), not 2021. And **2021 is the smallest annual increase of the whole
  2020–2025 run** (+€1.88bn).
- **As a ratio**, the debt burden was *flat to falling* from 2020 to 2023
  (24.5 → 23.8 → 22.5 → 22.9). Nominal GDP outgrew nominal debt. The ratio
  breaks out only in **2025** (23.8 → 29.9, +6.1pp in one year).

Gross issuance (`debt-emissions.json` + `debt-emissions-domestic.json`,
EUR-equivalent) tells the same story — 2021 is the trough, not the ignition:

| year | international | domestic | total €m |
|-----:|-------:|-------:|------:|
| 2020 | 2,500 |   614 | 3,114 |
| **2021** | **0** | 1,943 | **1,943** |
| 2022 | 2,250 | 1,346 | 3,596 |
| 2023 | 3,800 |     0 | 3,800 |
| 2024 | 4,380 |   869 | 5,249 |
| 2025 | 7,200 | 1,687 | **8,887** |
| 2026 YTD | 2,500 | 1,510 | 4,010 |

2021 saw **zero international issuance**. If a "spiral" has a start date in this
data, it is 2020 (COVID) for the level and **2025** for the acceleration.

**2025 is also the one year where borrowing far exceeded the deficit**:
+€9.66bn of net new debt against a €4.06bn ESA deficit. The fiscal reserve rose
from €5.67bn (2024-Q3) to €8.93bn (2025-Q4) — pre-funding ahead of euro entry,
not deficit financing. Cumulatively 2021–2024, net new debt (€9.85bn) actually
**lagged** the cumulative ESA deficit (€10.38bn); the difference came out of the
reserve.

---

## B. Were payments pushed into the next year?

### B1. The cash-vs-accrual wedge — the indirect indicator

If a government defers a payment across New Year, the **cash** deficit shrinks
while the **accrual (ESA/EDP)** deficit does not — ESA books the expense when
the obligation arises. So a persistently *positive* `cash − ESA` gap is the
signature of the alleged practice.

`cashBalance` (MoF КФП, EUR m) ÷ `nominalGdp` vs `esaBalanceAnnual`
(Eurostat `gov_10dd_edpt1`):

| year | cash % GDP | ESA % GDP | cash − ESA (pp) | dominant cabinet |
|-----:|-----------:|----------:|----------------:|---|
| 2019 | −0.96 | +2.20 | −3.16 | Борисов 3 |
| 2020 | −2.92 | −3.80 | **+0.88** | Борисов 3 |
| 2021 | −2.72 | −4.00 | **+1.28** | Борисов 3 / Янев |
| 2022 | −0.79 | −2.90 | **+2.11** | Петков / Донев |
| 2023 | −3.04 | −2.00 | **−1.04** | Донев / Денков |
| 2024 | −3.01 | −3.00 | **−0.01** | Денков / Главчев |
| 2025 |  n/a  | −3.50 | — | Желязков |

- **2021–2022 fit the claim.** 2022 is the standout: a cash deficit of 0.79% of
  GDP against an accrual deficit of 2.9% — a **€1.8bn wedge** in one year.
- **2023–2024 do not.** The gap reverses in 2023 (cash deficit *larger* than
  accrual — the signature of *paying off* deferred obligations) and is
  arithmetically zero in 2024.

So "**all** governments since then" fails on our data: the pattern is present
under Борисов 3 / Янев / Петков-Донев and absent under Денков and Главчев.

⚠️ **This indicator does not prove deferral.** The cash–ESA wedge also carries
coverage differences (ESA general government vs КФП), EU-funds accrual timing
(large in BG), and one-off ESA adjustments. 2014 shows −5.4% ESA vs −3.65% cash
purely from the КТБ bank resolution. Treat it as consistent-with, not evidence-of.

### B2. Просрочени задължения — the direct statistic, which refutes it

`data/_cache/arrears.json` (MoF, year-end Обобщена справка, хил. лв → EUR m).
This is the only *direct* measure of unpaid bills we hold, and it carries a
**central / social / local split**:

| year | total €m | central | social | **local** |
|-----:|---------:|--------:|-------:|----------:|
| 2009 | 408.5 | 307.9 | — | 100.6 |
| 2017 | 157.6 |  21.9 | 61.1 | 74.6 |
| 2018 | 160.2 |  28.5 | 69.2 | 62.5 |
| 2019 | 134.6 |  45.1 |  5.7 | 83.7 |
| 2020 | 101.2 |  35.3 |    0 | 65.8 |
| 2021 | 161.9 | 101.2 |    0 | **60.7** |
| 2022 | *excluded* | 283.9 | 0 | *46,546.6 ⚠ corrupt source cell* |
| 2023 | 198.8 | 117.9 |    0 | **80.9** |
| 2024 | 168.0 |  94.9 |    0 | **73.1** |
| 2025 | 188.9 |  93.3 |    0 | **95.6** |

- The 2025 total (€188.9m) is **below the 2017–2018 level** and less than half
  the 2009 peak (€408.5m).
- **Municipal arrears are flat**: €60.7m (2021) → €95.6m (2025). Against a
  €116bn economy that is 0.08% of GDP.
- Against the 2024 cash deficit of €3.15bn, total arrears of €168m are ~5%.

**There is no arrears spiral in the official statistic — central or municipal.**

### B3. But the official statistic is the wrong instrument for this claim

`просрочени задължения` counts only obligations **past their statutory payment
term**. A payment *contractually scheduled* for next year is never просрочено.
The alleged practice — sign now, schedule the payment into the next budget year
— sits precisely in the blind spot of the one series we have. B2 therefore
rules out one mechanism (non-payment of due bills) and says nothing about the
other (forward-dated payment terms).

### B4. The December concentration — declining, not escalating

`data/budget/kfp.json`, **state budget** cash balance, cumulative YTD (EUR m):

| year | Nov YTD | Dec YTD | December alone | Dec share of year |
|-----:|--------:|--------:|---------------:|------------------:|
| 2021 | **+5** | −2,240 | −2,246 | **100%** |
| 2022 | −1,028 | −2,895 | −1,867 | 64% |
| 2023 |   −671 | −2,697 | −2,026 | 75% |
| 2024 | −2,161 | −3,325 | −1,165 | 35% |
| 2025 | −2,680 | −3,113 |   −433 | **14%** |

2021 is extreme — the state budget was in **surplus through November** and
booked the entire year's deficit in December. But the trend since is *sharply
down*: by 2025 December carries 14% of the year. That is the opposite of an
escalating deferral regime.

⚠️ Caveat: `kfp.json` is `constituentBudget: "state"` — the state budget, **not**
consolidated КФП. And December concentration is equally consistent with
spend-it-or-lose-it as with settling accumulated bills; on its own it says
nothing about deferral into the *following* year.

### B5. The fiscal reserve flipped from year-end drawdown to year-end build

`macro.json` → `fiscalReserve` (MoF, EUR m, end-of-quarter), Q3 → Q4 change:

| 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | **2021** | **2022** | **2023** | 2024 | **2025** |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| −1,126 | −715 | −818 | −927 | −701 | −2,498 | **+322** | **+2,004** | **+1,047** | *gap* | **+290** |

Every year 2015–2020 the reserve was **drawn down** into year-end. From 2021 it
is **built up** into year-end — consistent with December borrowing to close the
books on a fat cash position. 2024-Q4 is missing from our series.

---

## C. Municipal contracted commitments — the proxy we *do* have

The procurement corpus is a genuine commitments series in the economic sense:
value contracted now, paid over subsequent years. Municipal buyers
(`awarder_name ILIKE 'ОБЩИНА%'`, `tag='contract'`, `amount_eur` = post-annex
current value):

| year | contracts | contracted €m |
|-----:|----------:|--------------:|
| 2015 | 5,512 |   829 |
| 2019 | 7,268 | 1,309 |
| 2020 | *1,392* | *157 — corpus hole, exclude* |
| 2021 | 7,983 | 1,127 |
| 2022 | 8,982 | 1,245 |
| 2023 | 11,170 | 1,870 |
| 2024 | 10,919 | 2,691 |
| 2025 | 13,259 | **3,135** |
| 2026 YTD | 7,839 | 1,992 |

**Municipal contracted value is 2.8× its 2021 level.** Set against B2 — municipal
*arrears* flat at €60–96m over the same span — the combination is exactly what
forward-scheduled payment terms would look like: commitments rising steeply,
overdue bills not moving, because nothing has fallen due yet.

⚠️ Two honest caveats. **2020 is a corpus coverage hole** (4,629 contracts
corpus-wide against 24k–31k either side) and is excluded. And contracted value
≠ deferred payment — multi-year contracts are normal, and much of the
2023–2025 ramp is the 2021–2027 EU programming period landing.

---

## What we do NOT have

Answering the direct question: **no, we do not hold contracted-but-deferred
payment data, and for municipalities we hold essentially nothing.**

| # | Missing | Where it lives | Why it matters |
|---|---|---|---|
| 1 | **Поети ангажименти за разходи** (ЗПФ чл. 94 ал. 3 т. 2 — the 50% limit), per municipality | MoF quarterly municipal reporting | *The* statistic for "contracted, not yet due". Nothing in the repo — no script, no watcher, no data. |
| 2 | **Задължения за разходи** (ЗПФ чл. 94 ал. 3 т. 1 — the 15% limit), per municipality | same | Invoiced but not yet overdue — the tier between commitments and arrears. |
| 3 | **Per-municipality просрочени задължения** | minfin.bg/bg/statistics/10 publishes the aggregate we parse; the per-муниципality breakdown is separate | We hold **one number per year** for all 265 municipalities combined. Cannot name a single distressed município. |
| 4 | ЗПФ **чл. 130а** "общини с финансови затруднения" register | MoF | The official distress list. Not tracked (`grep` for `130а` / `финансови затруднения` → zero hits). |
| 5 | Municipal **cash execution** beyond 2 municipalities | data.egov.bg | `data/budget/municipal_execution/` = Русе + Николаево only, and those files carry revenue/expense plan-vs-actual **by paragraph with no liability lines at all**. |
| 6 | **2022 arrears** | source file corrupt | The published Q4-2022 file lists local arrears at ~€46.5bn — ~500× neighbours. Flagged `suspect` and excluded, so the series has a hole in the single most interesting year (the €1.8bn cash–ESA wedge year). |
| 7 | **2024-Q4 fiscal reserve**, **2025 cashBalance** | MoF | Two gaps directly on the years under dispute. |

### Recommended ingest, in priority order

1. **Per-municipality просрочени задължения + поети ангажименти** (items 1–3).
   This is the single highest-value fiscal ingest available: it turns an
   untestable national claim into a per-município fact with a `/governance`
   surface, and it is the only way to answer this question properly.
2. **Re-download the corrected Q4-2022 arrears file** (item 6) — cheap, and it
   fills the hole in the pivotal year.
3. **Backfill 2024-Q4 fiscal reserve and 2025 cashBalance** (item 7).
4. **Widen `municipal_execution`** past two municipalities (item 5).

---

## Bottom line

- **"The spiral started in 2021"** — no. 2021 is the *trough*: smallest debt
  increase of the period and zero international issuance. The level break is
  2020; the ratio break is 2025.
- **"All governments since then"** — no. The cash-vs-accrual wedge is positive
  in 2021 (+1.28pp) and 2022 (+2.11pp), then reverses in 2023 (−1.04pp) and
  vanishes in 2024. And December's share of the state deficit falls from 100%
  (2021) to 14% (2025).
- **"Pushing bills forward"** — the direct measure says no: arrears are at
  2017–2018 levels and municipal arrears are flat. But that measure cannot see
  forward-*scheduled* payments, which is the mechanism actually alleged.
- **The one thing that does rise steeply** is municipal *contracted* value —
  2.8× since 2021 — against flat municipal arrears. That is suggestive, not
  conclusive, and closing the gap requires the ЗПФ чл. 94 commitments data we
  do not have.
