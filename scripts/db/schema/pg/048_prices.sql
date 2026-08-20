-- КЗП „Колко струва" retail prices — Postgres-only serving + queryable tables.
-- See docs/plans/consumption-pg-v1.md and consumption-pg-v1-implementation.md.
--
-- NAMING: the feed's "Категория" column is a 1..101 PRODUCT id (`pid`), and each
-- pid belongs to one of 14 CATEGORIES (`cat`). The codebase already uses
-- productId/pid and cat this way; do not swap them.
--
-- THE CENTRAL INVARIANT (design §3.2):
--   price_facts is HISTORY. A run closes only when the price CHANGES, so a
--   delisted SKU's run stays open forever. Measured: 1,899,083 open runs vs
--   1,400,705 rows actually observed after only 8 days — a 36% phantom
--   over-count. NEVER read price_facts for "current price" or for a day's
--   aggregate. Use price_current and price_grid_days, which are written from
--   each day's OWN observations, because absence is only knowable at the moment
--   of observation.

-- ── dimensions ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS price_chains (
  eik         text PRIMARY KEY,
  name        text NOT NULL,
  first_seen  date NOT NULL,
  last_seen   date NOT NULL
);

CREATE TABLE IF NOT EXISTS price_stores (
  store_id    bigserial PRIMARY KEY,
  eik         text NOT NULL REFERENCES price_chains(eik),
  ekatte      text NOT NULL,
  -- Denormalized place names. There is no settlements dimension in Postgres;
  -- the precedent is awarder_seats. Populated by resolvePlace() at ingest.
  settlement  text NOT NULL,
  obshtina    text NOT NULL,
  oblast      text NOT NULL,
  label       text NOT NULL,          -- raw "Търговски обект"
  label_norm  text NOT NULL,
  lat         double precision,       -- NULL until geocoded (phase 6)
  lon         double precision,
  first_seen  date NOT NULL,
  last_seen   date NOT NULL,
  UNIQUE (eik, ekatte, label_norm)
);

-- Mirror of the hand-authored scripts/prices/products.json. Git is the source of
-- truth (a change to unit_priced changes a MERGE RULE and must be reviewable);
-- this copy exists so SQL can join pid -> label. TRUNCATE+reload each catalog run.
CREATE TABLE IF NOT EXISTS price_kzp_cats (
  cat  smallint PRIMARY KEY,          -- 1..14
  bg   text NOT NULL,
  en   text NOT NULL
);

CREATE TABLE IF NOT EXISTS price_kzp_products (
  pid         smallint PRIMARY KEY,   -- 1..101
  cat         smallint NOT NULL REFERENCES price_kzp_cats(cat),
  bg          text NOT NULL,
  en          text NOT NULL,
  -- Loose per-kg goods (produce, loose meat/cheese). They legitimately have no
  -- pack size, so the "no size => no cross-chain merge" rule must exempt them,
  -- or 2,811 multi-chain groups (БАНАНИ, МОРКОВИ …) collapse to singletons.
  unit_priced boolean NOT NULL DEFAULT false
);

-- Canonical product: the cross-chain identity derived from names (there is NO
-- EAN — chain_code collides across chains). See design §4.
CREATE TABLE IF NOT EXISTS price_products (
  product_id      bigserial PRIMARY KEY,
  canon_key       text NOT NULL UNIQUE,
  -- FROZEN at first insert, never updated. `title` is a recomputed modal name;
  -- letting it drive the slug would break every indexed URL. Design §4.5.
  slug            text NOT NULL UNIQUE,
  pid             smallint NOT NULL REFERENCES price_kzp_products(pid),
  title           text NOT NULL,
  brand           text,
  net_qty         numeric,            -- normalized to g / ml / pc
  net_unit        text,
  unit_priced     boolean NOT NULL DEFAULT false,
  attrs           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"fat":"3","class":"II"} — identity
  chain_count     int  NOT NULL DEFAULT 0,
  sku_count       int  NOT NULL DEFAULT 0,
  confidence      smallint NOT NULL DEFAULT 0,
  -- Materialized by prices:catalog. The /api/db/table registry can only ORDER BY
  -- real base-table columns, so these cannot be derived at query time.
  current_min_eur double precision,
  pct_since_euro  numeric(8,3),
  first_seen      date NOT NULL,
  last_seen       date NOT NULL       -- retire vanished products by this, never DELETE
);

-- A chain's own listing. chain_code is chain-internal, NOT a barcode:
-- code '000006' is three unrelated products at three chains. Never join on it.
CREATE TABLE IF NOT EXISTS price_skus (
  sku_id      bigserial PRIMARY KEY,
  eik         text NOT NULL REFERENCES price_chains(eik),
  chain_code  text NOT NULL,
  raw_name    text NOT NULL,
  name_norm   text NOT NULL,
  pid         smallint,
  product_id  bigint REFERENCES price_products(product_id),  -- NULL = unmatched, still browsable
  first_seen  date NOT NULL,
  last_seen   date NOT NULL,
  UNIQUE (eik, chain_code, name_norm)
);

-- ── facts ─────────────────────────────────────────────────────────────────

-- HISTORY. valid_to IS NULL = last known price, NOT "still on sale".
-- price_eur is double precision, not numeric: chains publish EUR already
-- converted from BGN (26.90/1.95583 = 13.753751604178277), so the feed carries
-- full float precision. A numeric(12,6) column silently rounds it and the
-- parity gate against the 188 shipped grids fails on min/max.
CREATE TABLE IF NOT EXISTS price_facts (
  store_id    bigint NOT NULL REFERENCES price_stores(store_id),
  sku_id      bigint NOT NULL REFERENCES price_skus(sku_id),
  valid_from  date NOT NULL,
  valid_to    date,
  price_eur   double precision NOT NULL,
  promo_eur   double precision,
  PRIMARY KEY (store_id, sku_id, valid_from)
);

-- TODAY'S TRUTH. MERGED from each day's observations (upsert + anti-join
-- delete), never TRUNCATE — see load_day.ts step (3): TRUNCATE's
-- AccessExclusiveLock 500'd /api/db/price-product readers on every ingest.
CREATE TABLE IF NOT EXISTS price_current (
  store_id    bigint NOT NULL,
  sku_id      bigint NOT NULL,
  price_eur   double precision NOT NULL,
  promo_eur   double precision,
  PRIMARY KEY (store_id, sku_id)
);

-- LAST-KNOWN price per (store, sku), with the day it was observed.
--
-- price_current answers "what does this cost NOW" and is deliberately emptied
-- of anything today's feed omits — absence is only knowable at observation
-- time, and inferring it from price_facts over-counts 3.7x (4,387,949 open runs
-- against 1,177,730 real rows, measured 2026-08-20). That rule is load-bearing
-- and this table does not touch it.
--
-- What it adds is the OTHER question: "when did we last see a price for this,
-- and what was it". Upsert-only, never deleted, so a chain that stops filing
-- keeps its record here after price_current has dropped it. That is what lets a
-- chain's page survive its absence instead of being pruned out of existence
-- (docs/plans/prices-chain-absence-v1.md, T2).
--
-- ⚠️ `as_of` is not decoration. A row whose as_of is not the latest loaded day
-- is a STALE price, and no consumer may put one into a minimum, a ranking or a
-- cross-chain comparison — a retained price with no date is strictly worse than
-- a deleted one, because the reader cannot tell. Render it, label it, exclude
-- it from aggregates.
CREATE TABLE IF NOT EXISTS price_last_seen (
  store_id    bigint NOT NULL,
  sku_id      bigint NOT NULL,
  price_eur   double precision NOT NULL,
  promo_eur   double precision,
  as_of       date NOT NULL,
  PRIMARY KEY (store_id, sku_id)
);

-- DAILY AGGREGATE from the day's actual observations. The input to the Jevons
-- index. Mirrors CellAgg in scripts/prices/types.ts exactly.
CREATE TABLE IF NOT EXISTS price_grid_days (
  day            date NOT NULL,
  ekatte         text NOT NULL,
  pid            smallint NOT NULL,
  min_eur        double precision NOT NULL,
  avg_eur        double precision NOT NULL,
  max_eur        double precision NOT NULL,
  median_eur     double precision NOT NULL,
  promo_min_eur  double precision,
  stores         int NOT NULL,
  chains         int NOT NULL,
  cheapest_eik   text,
  cheapest_store text,
  PRIMARY KEY (day, ekatte, pid)
);

-- Per-chain daily minimum: chain comparison + the local-anomaly tile.
CREATE TABLE IF NOT EXISTS price_chain_grid_days (
  day     date NOT NULL,
  ekatte  text NOT NULL,
  eik     text NOT NULL,
  pid     smallint NOT NULL,
  min_eur double precision NOT NULL,
  PRIMARY KEY (day, ekatte, eik, pid)
);

-- Which chain reported on which day (~210 rows/day). Masks reporting gaps in
-- charts: a gap is a gap, never a price change.
CREATE TABLE IF NOT EXISTS price_chain_days (
  day   date NOT NULL,
  eik   text NOT NULL REFERENCES price_chains(eik),
  rows  int  NOT NULL,
  PRIMARY KEY (day, eik)
);

-- Per-product daily minimum, materialized for the products we actually serve
-- pages for (the prerendered head, by chain_count).
--
-- Expanding the step function live costs ~190k row-days for the worst product
-- (БАНАНИ: 90 chains, 133 SKUs) → ~370ms, over budget. Materializing ALL 118k
-- products would cost ~380M row-days, so this is deliberately bounded: the head
-- is precomputed, and the long tail falls back to the live query, which is fast
-- there precisely because those products have one or two SKUs.
CREATE TABLE IF NOT EXISTS price_product_days (
  product_id    bigint NOT NULL REFERENCES price_products(product_id),
  day           date   NOT NULL,
  min_eur       double precision NOT NULL,  -- regular (list) price min that day
  min_promo_eur double precision,           -- effective min incl. promos (dips on a real promo)
  chains        int    NOT NULL,
  PRIMARY KEY (product_id, day)
);
-- Backfill column for DBs created before the promo series was added.
ALTER TABLE price_product_days
  ADD COLUMN IF NOT EXISTS min_promo_eur double precision;

-- Hand-authored merge/split corrections, mirrored from
-- data/prices/product_overrides.json. Human review beats a better regex.
CREATE TABLE IF NOT EXISTS price_product_overrides (
  kind   text NOT NULL,               -- 'merge' | 'split' | 'brand'
  a      text NOT NULL,               -- canon_key
  b      text,                        -- canon_key (merge) or value (brand)
  PRIMARY KEY (kind, a, b)
);

-- Precomputed serving blobs, mirroring agri_payloads / fund_payloads.
CREATE TABLE IF NOT EXISTS price_payloads (
  kind    text  NOT NULL,
  key     text  NOT NULL DEFAULT '',
  payload jsonb NOT NULL,
  PRIMARY KEY (kind, key)
);

-- ── staging (UNLOGGED: no WAL, no replication; NOT absent from pg_dump) ────
CREATE UNLOGGED TABLE IF NOT EXISTS price_stage (
  eik              text          NOT NULL,
  ekatte           text          NOT NULL,
  settlement       text          NOT NULL,
  obshtina         text          NOT NULL,
  oblast           text          NOT NULL,
  chain_name       text          NOT NULL,
  store_label      text          NOT NULL,
  store_label_norm text          NOT NULL,
  chain_code       text          NOT NULL,
  raw_name         text          NOT NULL,
  name_norm        text          NOT NULL,
  pid              smallint      NOT NULL,
  price_eur        double precision NOT NULL,
  promo_eur        double precision
);

-- recordIngestBatch full-scans opts.table. Pointed at price_facts it would scan
-- the whole 10-70M-row corpus daily and grow ingest_first_seen to match. Scope
-- it to the day just loaded.
CREATE OR REPLACE VIEW price_facts_today AS
  SELECT * FROM price_facts
   WHERE valid_from = (SELECT max(valid_from) FROM price_facts);

-- ── indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS price_facts_sku_time  ON price_facts (sku_id, valid_from DESC);
CREATE INDEX IF NOT EXISTS price_facts_open      ON price_facts (sku_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS price_facts_from_brin ON price_facts USING brin (valid_from);
CREATE INDEX IF NOT EXISTS price_current_sku     ON price_current (sku_id);
CREATE INDEX IF NOT EXISTS price_skus_product    ON price_skus (product_id);
CREATE INDEX IF NOT EXISTS price_skus_eik        ON price_skus (eik);
CREATE INDEX IF NOT EXISTS price_stores_ekatte   ON price_stores (ekatte);
CREATE INDEX IF NOT EXISTS price_products_pid    ON price_products (pid);
-- ⚠️ `DESC NULLS LAST`, and the DROP above it, are BOTH load-bearing.
--
-- db_table.js's buildOrder emits `chain_count DESC NULLS LAST` for the `price_products`
-- default sort, while a plain `DESC` index is NULLS FIRST — and Postgres bridges neither
-- direction. Note it does NOT matter that `chain_count` is NOT NULL: pathkeys are compared
-- structurally and no NOT NULL constraint is consulted, so this table is the corpus proof
-- that the defect is not confined to matviews. MEASURED on the /consumption/products
-- arrival (chain_count >= 1, 102,976 rows): 19,261 buffers / 18.7 ms parallel seq scan +
-- top-N heapsort, against 27 buffers / 0.036 ms.
--
-- The partial predicate stays: the browser's own fixed filter is `chain_count >= 1`, which
-- Postgres proves implies `chain_count > 0`, so the index is still a candidate for it.
--
-- The DROP is required because this file is applied to WARM databases and
-- `CREATE INDEX IF NOT EXISTS` is a no-op against an existing name — editing the definition
-- alone would reach a fresh clone and nowhere else. (Cheap here: 048 is applied with
-- execEach, so the DROP commits on its own and the rebuild takes a ~1 s ShareLock on a
-- 118k-row table. Do NOT fold this pattern into an `exec`-applied file, where the lock
-- would be held for the whole migration.)
-- Gate: scripts/db/tests/db_table_sort_indexes.data.test.ts.
DROP INDEX IF EXISTS price_products_browse;
CREATE INDEX IF NOT EXISTS price_products_browse ON price_products (chain_count DESC NULLS LAST, product_id) WHERE chain_count > 0;
CREATE INDEX IF NOT EXISTS price_products_since   ON price_products (pct_since_euro) WHERE chain_count > 1 AND pct_since_euro IS NOT NULL;
CREATE INDEX IF NOT EXISTS price_products_trgm   ON price_products USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS price_grid_days_day   ON price_grid_days (day);
CREATE INDEX IF NOT EXISTS price_grid_days_pid   ON price_grid_days (pid, day);
CREATE INDEX IF NOT EXISTS price_chain_grid_eik  ON price_chain_grid_days (eik, day);
-- Mirrors price_current_sku; serves the product-ladder join.
--
-- Deliberately NO index on `as_of`. The query it would serve — "everything not
-- observed on the latest day" — matches ~73% of the table at steady state
-- (~3.2M of ~4.4M), and a plain btree over most of a table is never chosen.
-- The repo's rule is to EXPLAIN a new consumer before indexing for it, so this
-- waits for T2b's real query shape; `(as_of, store_id)` or a partial index
-- anchored to what T2b actually filters on is the likelier answer.
CREATE INDEX IF NOT EXISTS price_last_seen_sku   ON price_last_seen (sku_id);

-- ── warm-database reconcile ───────────────────────────────────────────────
-- `CREATE TABLE IF NOT EXISTS` is a no-op where the prices schema already
-- exists, so on every database that has ever loaded a day the new table would
-- sit empty until the next ingest — and the chain pages that read it (T2b)
-- would render nothing in the meantime, which is the very outcome this table
-- was added to prevent.
--
-- ⚠️ Seeding from `price_current` would be the WRONG rescue, and precisely
-- backwards. price_current holds only the chains that reported on the latest
-- day — measured 2026-08-20: 98 of 215 chains, leaving 117 with history and no
-- last-seen row. Those are exactly the chains that already went silent (the
-- feed fell 210 → 98 between 2026-07-26 and 2026-08-14), i.e. the entire
-- population this table exists for, and nothing would ever add them: only the
-- daily `obs` write does, and they will never appear in `obs` again.
--
-- So seed from the OPEN RUNS instead: the latest run per (store, sku), dated
-- from that store's own last reporting day. Reading an open run as LAST-KNOWN
-- is literally what an open run is — the 3.7x phantom-count warning in this
-- file's header forbids reading them as CURRENT, which is a different claim and
-- still holds.
--
-- ⚠️ `as_of` here is STORE-granular and an upper bound: a SKU delisted while
-- its store kept filing gets the store's last day rather than its own. The
-- daily writer stamps exact per-observation dates and supersedes these rows as
-- soon as a chain files again. Seeded dates are a best-effort recovery of
-- history that predates the table, never a claim of per-SKU precision.
--
-- Sizing: ~4.4M rows on the 2026-08 corpus (against ~1.2M in price_current).
-- Retention is an open question — nothing prunes this table today, and it grows
-- with the union of every (store, sku) ever seen rather than with the feed.
INSERT INTO price_last_seen (store_id, sku_id, price_eur, promo_eur, as_of)
SELECT DISTINCT ON (f.store_id, f.sku_id)
       f.store_id, f.sku_id, f.price_eur, f.promo_eur, s.last_seen
  FROM price_facts f
  JOIN price_stores s ON s.store_id = f.store_id
 WHERE f.valid_to IS NULL
   AND NOT EXISTS (SELECT 1 FROM price_last_seen)
 ORDER BY f.store_id, f.sku_id, f.valid_from DESC
ON CONFLICT (store_id, sku_id) DO NOTHING;
