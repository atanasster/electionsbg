---
name: update-prices
description: Refresh the КЗП "Колко струва" retail-price data (Postgres, migration 048) — fetch the daily euro-adoption open-data ZIP from kolkostruva.bg, load ~1.4M store rows for the 101-product consumer basket into Postgres as an SCD-2 delta, then rebuild the ~118k-product canonical catalogue and the price_payloads serving blobs (national/oblast/category index since the euro + per-settlement snapshots + cross-place ranking + chain comparison). Postgres-only — no data/prices/*.json serving tree. Use when the daily watch report flags `kzp_prices` as changed (a new daily archive landed), when the user asks to refresh prices / цени / euro price monitoring, to run the one-off historical backfill to euro-adoption day, or after a fresh git clone if the price_facts table is empty.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Prices skill

Refreshes the retail-price layer — behind the "Цени / Prices" section on the Governance + Consumption dashboards, the My-Area price tile, the `/consumption/products` browser (~118k products), the `/product/:slug` pages, and the "did the euro raise prices?" verdict. **Postgres-only** since migration 048 (`price_facts` / `price_current` / `price_grid_days` / `price_products` / `price_payloads`); there is no `data/prices/*.json` serving tree.

**Source:** `kolkostruva.bg` — the КЗП (Consumer Protection Commission) price-monitoring portal mandated by **ЗВЕРБ чл. 55б** for the euro changeover. One ZIP per day at `https://kolkostruva.bg/opendata_files/YYYY-MM-DD.zip` (free, no registration), one CSV per retail chain. Day D's file appears D+1 ~00:01. **Prices are in EUR since 2026-01-01.** Granularity: ~245 settlements (EKATTE-keyed), ~208 chains, ~2,650 stores, 101 product groups in 14 categories, plus ~95k distinct product names per day. See `docs/plans/consumption-pg-v1.md` and the `[[project_prices_pg_migration]]` memory.

> **Not official CPI.** What we publish is a *monitoring basket index* (unweighted Jevons of the median-of-per-settlement price). Keep that framing in any copy; it sits beside — never replaces — the macro CPI/HICP tile.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `kzp_prices: new daily price archive: <date>` | `npm run prices` (fetches every advertised day not yet cached, parses, rebuilds) |
| User asks "refresh prices" / "update цени" / "обнови цените" | `npm run prices` |
| One-off historical replay back to euro-adoption day | `npm run prices -- --backfill --from 2026-01-02` (operator step; loads all ~189 days into Postgres oldest-first, ~2h, never in the watcher/CI) |
| Fresh clone with an empty `price_facts` table | `npm run prices -- --backfill --from 2026-01-02` (rebuilds the whole PG store from the retained ZIPs) |

## Daily run

```bash
npm run prices               # local Postgres
npm run prices:ingest:cloud  # against the Cloud SQL proxy (:5434) — the real serving DB
```

This:
1. reads the advertised dates from `/opendata`, downloads each ZIP not already loaded (tracked by `price_grid_days.day`) to `raw_data/prices/<date>.zip`, **always cold-archiving it** to the private Coldline bucket `gs://naiasno-archive-prices/prices/_archive/` (`cp -n`; `raw_data/prices/` is gitignored, so this is the only durable copy — kolkostruva.bg advertises only ~14 days),
2. `load_day.ts` COPYs every chain CSV into `price_stage`, upserts the dimension tables, then writes the **SCD-2 delta**: closes runs whose price moved, opens new runs (~25–40k rows/day, not 1.4M), and rewrites `price_current` + `price_grid_days` + `price_chain_grid_days` from the day's own observations (BOM / `,`-vs-`;` / quoting absorbed; EKATTE normalized incl. Sofia `-NN` → `68134`; product codes outside 1–101 skipped),
3. rebuilds the catalogue + serving blobs:
   - `rebuild_catalog.ts` — clusters the ~95k SKU names into ~118k canonical products (no EAN — identity is name-derived; see the memory), materializes `current_min_eur` + `pct_since_euro` (median-to-median),
   - `build_product_days.ts` — per-product daily-minimum history for the prerendered head (~3k products),
   - `build_payloads.ts` — `buildPriceIndex` (unchanged Jevons maths, now reading `price_grid_days`) into `price_payloads`,
   - `export_slugs.ts` — the top ~3k product slugs to `data/prices/product_slugs.json` (the one committed artifact; drives prerender + sitemap),
4. **self-reports its `/data/updates` row** via `appendDataChange` when it loaded ≥1 day (so the orchestrator must NOT run `append-data-change.ts` for it — see `process-watch-report`).

## Methodology notes (keep stable)

- **Index = median price, not min.** A single cheap/expensive store swings the min and made per-settlement trends spike (e.g. one wine outlier → +137%). The Jevons index uses each settlement's *median* price; min is reserved for the "cheapest to shop" basket level + per-product display.
- **Fixed panel.** Indices and since-euro leaderboards use only settlements present on the baseline (euro) day, so the series tracks the same markets rather than drifting as feed coverage changes. Non-panel places still get their own page.
- **Core basket.** Cross-place ranking uses a curated 12-staple food basket (bread, milk, cheese, kashkaval, rice, sugar, flour, oil, bananas, tomatoes, onions, potatoes — each ≥82% present). The products present in ~all settlements are non-food packaged goods, so they are *not* used as the "groceries" proxy. Tiny outlets that don't price the full core get `rank=null` but keep their index.

## After a successful run

- `npm run prices` is idempotent — safe to re-run (the SCD-2 delta and `ON CONFLICT DO NOTHING` make a re-run a no-op; loading a day out of order is refused).
- **Serving is live from Postgres** — no `bucket:sync` for prices any more. The daily run writes only PG (+ the small `product_slugs.json`); no multi-GB upload.
- Commit `data/prices/product_slugs.json` if it changed. The `_cache/` grids + `raw_data/prices/` ZIPs are gitignored.
- **For production**, run `npm run prices:ingest:cloud` (targets Cloud SQL directly, the agri pattern); `db:dump` is only a periodic DR snapshot, never the daily path. DR for prices is "replay the archived ZIPs".
- The ingest self-reports its `/data/updates` row — no separate stamp needed for the public changelog.

## Adding the product dictionary (rare)

The 101-product / 14-category dictionary lives in `scripts/prices/products.json` (`set` id == CSV `Категория`). If КЗП revises the basket, re-scrape `https://kolkostruva.bg/compare?city=68134` (each `product-card` `<h3>` is a category; each `<a ...set=ID>` a product) and regenerate.
