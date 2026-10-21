# КФП monthly history — located (v1)

Status: **located, not built** (deferred-followups-verification-fixes-v1, T4.12). Measured
2026-10-21.

## Where it is

The plan named minfin.bg `/statistics/5` (Cloudflare-walled, so an operator download). The same
monthly КФП tables are on data.egov.bg, published by МФ:

`bfcdd4cb-4737-4272-92ea-9b2395f7cb14` „Консолидирана фискална програма и национални бюджети –
информация на месечна база" — 101 resources, one per month, the newest „август 2026 г."
(posted 2026-09-30). The dataset description points back to МФ's publication calendar
(minfin.bg/bg/613).

Months present: **March–April 2016, then March 2018 → August 2026**, with these holes:
2016-05…2017-12 (all of 2017), 2018-01/02, and 2020-02, -03, -07. So data.egov.bg answers 2018-03 on,
less those five months; **1998–2017, 2018-01/02 and 2020-02/03/07 still need the minfin.bg
workbooks**, i.e. an operator download, as the plan said.

## Shape

Each resource is one matrix, cumulative from January (state-budget tax revenue reads 15,852.9 for
January–August 2026):

- rows = budget kind: Държавен бюджет · ВУЗ, БАН, ССА, БНТ, БНР, БТА и бюджети по чл. 13 (4) ЗПФ ·
  Бюджети на социалното осигуряване · Бюджети на общините · Други сметки · Европейски средства;
- columns = economic categories (Данъчни приходи, Неданъчни приходи, Помощи, Персонал, Издръжка,
  interest, social payments, subsidies, capital spending, transfers, balance, financing …).

⚠️ **The column set changes over time** — the 2016 files split „Заплати и възнаграждения за
персонала" and „Социални и здравно-осигурителни вноски" where 2025/2026 have one „Персонал"
column, and the 2016 header row carries the month („Консолидирана фискална програма - март") where
the later ones say „Вид бюджет". The ROW labels drift too: the 2016 file prints „Държавен /
бюджет", „Бюджети на / социалното осигуряване" (`/` line-break artifacts), „Други сметки \*", and
ends with an empty row. A loader must map both rows and columns by a normalised LABEL and refuse an
unknown one, never by position.

## ⚠️ The unit is not stated in the file — and it changes

No header names a unit. It was established by reconciliation against the repo's own state-budget
series (`budget_kfp_observation`, a different data.egov.bg dataset):

State-budget row, tax + non-tax + grants, summed on the unrounded cells:

| month   | this file  | stored `revenue` (EUR m) | stored × 1.95583 | unit                 |
| ------- | ---------- | ------------------------ | ---------------- | -------------------- |
| 2021-06 | 14,488.296 | 7,407.748                | 14,488.296       | **millions of лева** |
| 2025-08 | 32,729.773 | 16,734.467               | 32,729.773       | **millions of лева** |
| 2025-12 | 51,455.992 | 26,309.031               | 51,455.992       | **millions of лева** |
| 2026-01 | 2,250.534  | 2,250.534                | —                | **millions of EUR**  |
| 2026-08 | 17,628.492 | 17,628.492               | —                | **millions of EUR**  |

The balance column agrees as well (−2,070.7 against the stored −€2,070.7m for 2026-08). So the switch
falls exactly between the December 2025 and January 2026 files — measured, five months either side
of it. Months before 2021-06 were not checked. A loader must **not** infer the unit
from the year (the rule this repo applies everywhere a unit is unstated): it should prove each
file by reconciling the state-budget row against `budget_kfp_observation` for the same month where
one exists (2021-06 on), and refuse a file where neither unit reconciles. Before 2021 there is no
second series to reconcile against, so those months need another anchor (the annual КФП, or the
minfin.bg workbooks' own header) — that is the open design question.

## What is still not verified

- The methodology breaks the followups entry names (GFSM 86 / GFSM 2001 / GFSM 2014; ЗПФ from
  01.01.2014) were not re-checked here, and the 2016 → 2026 column change above is the only break
  observed in these files.
- 1998–2017 from minfin.bg remains an operator download behind Cloudflare.

## Proposed shape

`kfp_monthly` — (period, budget_kind, category) → `amount_eur`, plus `amount_native` and
`native_unit` and the source resource id (whether the 1998 workbooks are in pre-1999 old leva is
unverified, so the unit enum must stay open until they are read), cumulative-YTD as published (a
month-on-month series is a derived view, never stored). No ESA claim: КФП is cash-based.
