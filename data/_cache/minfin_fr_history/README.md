# Manual fiscal-reserve HISTORY drops (2005–2014)

`scripts/macro/fetch_fiscal_reserve_history.ts` reads the year-end fiscal-reserve
PDFs dropped here, parses each headline figure, converts to euro, and writes the
annual aggregate to `../fiscal-reserve-history.json` + merges the pre-2015 points
into `data/macro.json` series.fiscalReserve (keeping the Wayback-sourced 2015+
data intact).

This is the pre-2015 backfill for the main fiscal-reserve series, which otherwise
starts in 2015 (the reach of the Wayback-based `fetch_fiscal_reserve.ts`).

## Why manual

The minfin.bg "Фискален резерв" page (<https://www.minfin.bg/bg/statistics/4>)
is Cloudflare-blocked to non-browser clients, so the year-end reports are
downloaded by hand from a real browser and dropped here. The parsed aggregate is
committed; the raw PDFs are git-ignored.

## How to refresh / add years

1. Open <https://www.minfin.bg/bg/statistics/4> in your normal browser.
2. Save the **year-end (31.12 / Q4)** "Фискален резерв" report for each year.
3. Drop the PDF here (filename just needs to contain the year + `12`/`Q4`, e.g.
   `FRA-12-2013-BG.pdf`, `FRA–Q4-2011-BG.pdf`).
4. `npx tsx scripts/macro/fetch_fiscal_reserve_history.ts`

## Report layouts + methodology note

Three layouts appear and the parser handles all three:
- **2005–2013** — table headline `Общ баланс на ФР  X млн лв.`
- **2014** — `Фискален резерв* (І+ІІ)  X млн. лв.`
- **2011** — prose `фискалният резерв е в размер на X млрд. лв.`

The **2014 Public Finance Act (§1 т.41)** broadened the measure (the post-2014
figure adds part II — EU-fund receivables / National Fund). So the pre-2014
"Общ баланс" and the 2014+ "(I+II)" are not strictly comparable; the chart
footnotes the break. The 2014+ "(I+II)" is consistent with the 2015+ FRA-xlsx
series, so there is no discontinuity across the 2014/2015 boundary.
