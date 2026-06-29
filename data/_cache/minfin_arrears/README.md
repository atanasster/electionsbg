# Manual overdue-obligations (просрочени задължения) drops

`scripts/macro/fetch_arrears.ts` reads every arrears file dropped into this
directory, parses the `Общо` total (consolidated central government +
social-security funds + local government), converts it to euro, and writes the
annual year-end aggregate to `../arrears.json` + patches `data/macro.json`.

Both **`.xls`** and **`.pdf`** are supported, in two filename schemes:

- new (2013+): `Payment arrears Q4 2015_BG.xls` / `.pdf` (4-digit year)
- old (2005–2012): `Payment_arrears_4Q12_BG.pdf`, `Payment_arrears_1Q05_BG-new08.pdf`,
  `Payment_arrears_4Q09_Bg_new.pdf` (quarter-then-`Q`, 2-digit year, assorted
  `-new`/case suffixes — leave them exactly as downloaded).

The `(year, quarter)` is parsed from the filename; the highest quarter per year
wins (Q4 = year-end). Drop more years to extend the chart backward.

## Why manual

The Министерство на финансите "Просрочени задължения" page
(<https://www.minfin.bg/bg/statistics/10>) sits behind Cloudflare, which 403s
non-browser clients (even static `/upload/…` files) and serves an interactive
Turnstile that Playwright-driven Chromium can't clear (verified: it just
re-challenges). So the files are downloaded by hand from a real browser
(Safari / regular Chrome, which pass) and dropped here. The parsed aggregate is
committed; the raw `.xls`/`.pdf` files are git-ignored.

## How to refresh / add years

1. Open <https://www.minfin.bg/bg/statistics/10> in your normal browser.
2. Step through the year timeline (`<` for older years) and save the **Q4 /
   31.12** file for each year you want. Don't rename it.
3. Move it into this directory.
4. From the repo root:
   ```bash
   npx tsx scripts/macro/fetch_arrears.ts    # rebuilds ../arrears.json + patches data/macro.json
   npx tsx scripts/macro/fetch_eurostat.ts   # (optional) full macro.json regen also picks it up
   ```

## Notes / data quality

- **2022** Q4 file has a corrupt "Местно правителство" cell (≈ 91 037 316 хил. лв,
  i.e. ~€46.5 bn — ~500× its neighbours). `fetch_arrears.ts` flags any year over
  a ~€3 bn sanity ceiling as `suspect` and excludes it. Re-download a corrected
  2022 to fill the gap.
- **2005** only has a Q1 file (към 31.03.2005) on the page, so 2005's value is a
  Q1 snapshot, not strictly year-end.
- The **2005–2008 PDFs** come out of pdf.js with their cells in scrambled order,
  so the labelled `Общо` row can't be reassembled. For those the parser falls
  back to the largest figure in the report (= the total, since it's the sum of
  the parts). The per-tier breakdown isn't recoverable for those four files
  (it's provenance-only anyway).

Coverage as committed: 2005–2025 (2022 excluded). Peak = 2009 (≈ €409 M, driven
by central-government arrears after the financial crisis).
