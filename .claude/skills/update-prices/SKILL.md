---
name: update-prices
description: Refresh the КЗП "Колко струва" retail-price data (data/prices/) — fetch the daily euro-adoption open-data ZIP from kolkostruva.bg, parse ~1.45M store rows for the 101-product consumer basket into per (settlement × product) min/avg/max/median, and rebuild the national/oblast/category price index since the euro + per-settlement snapshots + cross-place ranking + chain comparison. Use when the daily watch report flags `kzp_prices` as changed (a new daily archive landed), when the user asks to refresh prices / цени / euro price monitoring, to run the one-off historical backfill to euro-adoption day, or after a fresh git clone if data/prices/index.json is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Prices skill

Refreshes `data/prices/` — the retail-price layer behind the "Цени / Prices" section on the Governance place dashboards (country / oblast / muni / settlement) and the compact My-Area price tile.

**Source:** `kolkostruva.bg` — the КЗП (Consumer Protection Commission) price-monitoring portal mandated by **ЗВЕРБ чл. 55б** for the euro changeover. One ZIP per day at `https://kolkostruva.bg/opendata_files/YYYY-MM-DD.zip` (free, no registration), one CSV per retail chain. Day D's file appears D+1 ~00:01. **Prices are in EUR since 2026-01-01.** Granularity: ~245 settlements (EKATTE-keyed), ~207 chains, 101 products in 14 categories. See `docs/plans/prices_kolkostruva_design.md` and the `[[reference_kzp_kolkostruva_prices]]` memory.

> **Not official CPI.** What we publish is a *monitoring basket index* (unweighted Jevons of the median-of-per-settlement price). Keep that framing in any copy; it sits beside — never replaces — the macro CPI/HICP tile.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `kzp_prices: new daily price archive: <date>` | `npm run prices` (fetches every advertised day not yet cached, parses, rebuilds) |
| User asks "refresh prices" / "update цени" / "обнови цените" | `npm run prices` |
| One-off historical pull back to euro-adoption day | `npm run prices -- --backfill --from 2026-01-02` (operator step; ~25 MB/day, never in the watcher/CI) |
| Fresh clone with no `data/prices/index.json` | `npm run prices -- --backfill --from 2026-01-02` then commit the artifacts |

## Daily run

```bash
npm run prices
```

This:
1. reads the advertised dates from `/opendata`, downloads each ZIP not already in `data/prices/_cache/daily/` to `raw_data/prices/<date>.zip`,
2. parses every chain CSV → per (settlement × product) `{min, avg, max, median, cheapestEik, stores, promoMin}` grid in `_cache/daily/<date>.json` (BOM / `,`-vs-`;` / quoting absorbed; EKATTE normalized incl. Sofia `-NN` suffix → `68134`; legacy product codes outside 1–101 logged + skipped),
3. rebuilds the shipped artifacts (`buildPriceIndex`):
   - `index.json` — national + per-oblast + per-category index since the euro, 101-product dictionary, promo share, coverage,
   - `settlement/<ekatte>.json` — per-place snapshot (min/avg/max per product, cheapest chain, since-euro change, weekly sparkline, top movers),
   - `ranking.json` — per-place basket level (cheapest core basket €) **and** since-euro change, ranked across national / size-class / oblast peer groups,
   - `chains.json` + `chains/<muni>.json` — chain comparison on the intersection core basket (with `nPriced` coverage).

`--archive` also cold-copies each raw ZIP to `gs://data-electionsbg-com/prices/_archive/` (best-effort) — longevity insurance against a feed shutdown after the Aug-2026 dual-display window.

## Methodology notes (keep stable)

- **Index = median price, not min.** A single cheap/expensive store swings the min and made per-settlement trends spike (e.g. one wine outlier → +137%). The Jevons index uses each settlement's *median* price; min is reserved for the "cheapest to shop" basket level + per-product display.
- **Fixed panel.** Indices and since-euro leaderboards use only settlements present on the baseline (euro) day, so the series tracks the same markets rather than drifting as feed coverage changes. Non-panel places still get their own page.
- **Core basket.** Cross-place ranking uses a curated 12-staple food basket (bread, milk, cheese, kashkaval, rice, sugar, flour, oil, bananas, tomatoes, onions, potatoes — each ≥82% present). The products present in ~all settlements are non-food packaged goods, so they are *not* used as the "groceries" proxy. Tiny outlets that don't price the full core get `rank=null` but keep their index.

## After a successful run

- `npm run prices` is idempotent — safe to re-run.
- Hot artifacts (`prices/index.json`, `prices/ranking.json`, `prices/chains.json`) are in the `bucket:gz` GLOBAL_FILES list; run `npm run bucket:sync:all` to ship the whole `data/prices/` tree (small per-settlement/per-muni files serve identity).
- Commit the `data/prices/` artifacts (the `_cache/` grids + `raw_data/prices/` ZIPs are gitignored).
- Stamp the ingest watermark if the watcher orchestration expects it.

## Adding the product dictionary (rare)

The 101-product / 14-category dictionary lives in `scripts/prices/products.json` (`set` id == CSV `Категория`). If КЗП revises the basket, re-scrape `https://kolkostruva.bg/compare?city=68134` (each `product-card` `<h3>` is a category; each `<a ...set=ID>` a product) and regenerate.
