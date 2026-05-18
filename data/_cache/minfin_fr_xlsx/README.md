# Manual fiscal-reserve XLSX drops

`scripts/macro/fetch_fiscal_reserve.ts` reads any `FRA-MM-YYYY-BG.xlsx`
(or `-EN.xlsx`) file dropped into this directory as authoritative monthly
fiscal-reserve data. Local files override the Wayback-cached copies of the
same month.

## When to use this

The dedicated Фискален резерв page at <https://www.minfin.bg/bg/statistics/4>
publishes one `FRA-MM-YYYY-BG.xlsx` per month — direct, tabular, ~13 KB.
Wayback Machine has cached the historical files through ~April 2025, but
newer captures return Cloudflare challenge pages, not the PDFs. So any
month after the Wayback cutoff needs to be downloaded manually and dropped
here.

## How to refresh

1. Open <https://www.minfin.bg/bg/statistics/4> in your browser.
2. For each missing month, right-click → "Save link as" on the
   "Фискален резерв по месеци към DD.MM.YYYY г." link.
3. Save the file into this directory **without renaming**. The filename
   must follow the upstream pattern `FRA-MM-YYYY-BG.xlsx` (e.g.
   `FRA-03-2026-BG.xlsx`). The downloader preserves it.
4. From the repo root:
   ```bash
   npx tsx scripts/macro/fetch_fiscal_reserve.ts   # rebuilds the cache
   npx tsx scripts/macro/fetch_eurostat.ts         # bakes into data/macro.json
   ```

The scraper picks up everything in this directory automatically.

## Why filenames matter

The (year, month) is parsed from the filename, not the XLSX contents.
Renaming or stripping the date will silently exclude the file. If you
need an unusual filename, fix `enumerateLocalFraXlsx()` in the scraper
rather than working around it.

## What gets committed

The XLSX files themselves are gitignored — they're third-party content
that can be re-downloaded from minfin.bg. Only this README and the
parsed quarterly aggregates (in `../fiscal-reserve.json`) live in git.
