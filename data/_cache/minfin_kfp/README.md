# Cash КФП balance — manual drop

The "Бюджети по кабинети" scorecard shows a **cash budget balance (касов дефицит
по КФП)** column next to the Eurostat ESA balance. This is the headline cash
deficit/surplus the Ministry of Finance reports — the number politicians quote.

## Source: the МФ annual КФП workbook

The Ministry publishes the authoritative annual cash series at
[minfin.bg/bg/statistics/13](https://www.minfin.bg/bg/statistics/13) → **"Данни
по консолидираната фискална програма (годишни)"**. Under a recent year you'll
find a workbook like **`Консолидирана фискална програма 2014 — 2024 г.`**
(downloads as `Cons_2014-2024_BG.xls`): years across the columns, with a
**`Бюджетно салдо (Дефицит(-) / Излишък(+))`** row in **млн. лв.** — the
canonical cash balance.

That page sits behind Cloudflare (same wall as the arrears and fiscal-reserve
pages), so it can't be fetched headless — even a Playwright browser can't clear
the interactive Turnstile. Download it from a real browser (Safari / regular
Chrome) and drop the `.xls` here.

We deliberately do **not** use the egov monthly КФП feed (`data/budget/
index.json`) for this column — its annual roll-up is a different consolidation
basis and diverges materially from the МФ headline (e.g. 2022: egov −3.4% vs МФ
−0.8%), so mixing the two would mislead.

## How to add / refresh years

1. Drop the workbook `.xls` here (it's gitignored — the parsed
   `cash-balance.json` and this README are committed; the optional
   `cash-manual.json` is committed only if you create it). All `*.xls` in this
   folder are parsed as МФ annual workbooks; a newer range (e.g. `Cons_2015-2025`)
   supersedes an older one on overlapping years.
2. Run `npx tsx scripts/macro/fetch_cash_balance.ts`. It reads the workbook's
   `Бюджетно салдо` row, converts млн. лв. → EUR at the locked board rate
   (1 EUR = 1.95583 BGN), rewrites `data/_cache/cash-balance.json`, and patches
   `data/macro.json` (`series.cashBalance`). Then `bucket:sync` to publish.

## Filling gaps by hand (pre-2014 / current year)

For years not on the annual page yet (a just-closed year is only on the
**monthly** page as the December cumulative; pre-2014 needs an older workbook),
create an **optional** `cash-manual.json` here (it doesn't exist by default;
commit it once you add it):

```json
{
  "note": "МФ КФП, ред „Бюджетно салдо“",
  "annual": [
    { "year": 2025, "bgnMillion": -6828, "source": "МФ КФП месечни, дек. 2025" },
    { "year": 2013, "bgnMillion": -2967, "source": "МФ КФП 2005-2013" }
  ]
}
```

- Give the balance in **either** `bgnMillion` or `eurMillion`; deficits are
  negative, surpluses positive.
- `override: true` forces a year to replace the workbook's value (normally the
  workbook wins and the manual file only fills gaps).
