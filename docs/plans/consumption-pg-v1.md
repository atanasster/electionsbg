# Consumption view v1 → v2: Postgres migration + product browser

Status: **proposed** (2026-07-10)
Scope: `/consumption`, `/consumption/region/:oblast`, `/consumption/:id`, `/prices`, plus the
my-area + governance price tiles and the six `ai/tools/prices.ts` tools.

Companion documents:
- **`docs/plans/consumption-pg-v1-implementation.md`** — the work breakdown, the clustering audit, the test plan.

Three goals, one migration:

1. Move the КЗП "Колко струва" corpus off `data/prices/*.json` and onto Postgres, with a daily
   update that writes **tens of thousands** of rows, not millions.
2. Let users **browse and search individual products** — the thing every serious European price
   monitor has and we (and kolkostruva.bg) do not.
3. Rebuild the three consumption dashboards (country / locality / my-area) around one spine, and
   claim the ground nobody else in Europe occupies (§9).

---

## 1. What we actually have (measured, not assumed)

All figures from `raw_data/prices/*.zip` (188 daily archives, 2026-01-02 … 2026-07-08) and
`data/prices/_cache/daily/*.json`.

### 1.1 Grain and cardinality (day 2026-07-08)

| Thing | Count |
| --- | --- |
| Raw store×SKU observations | 1,400,705 |
| Chains (EIK) | 208 |
| Physical stores (`eik` + `Търговски обект`) | 2,649 |
| **Distinct product names** (`Наименование на продукта`) | **95,324** |
| Distinct chain product codes (`Код на продукта`) | 82,523 |
| КЗП category codes (`Категория`, our `productId`) | 101 in range |
| settlement×product cells (what `build_index.ts` emits) | 17,344 |
| chain×settlement×product cells | 41,216 |

The pipeline collapses 1.4M rows into 17,344 cells and **discards the product-name column
entirely**. What the site calls "101 products" are 101 *product groups*. The actual SKU catalogue —
`КАФЕ ЛАВАЦА 1КГ КУАЛИТА РОСА ЗЪРНА`, `ПЮРЕ БЕБЕЛАН 220ГР МЕНЮ СПАГЕТИ БОЛОНЕЗЕ 8М+` — is thrown
away on every ingest and only survives in the retained ZIPs.

The `1..101` category guard in `parse.ts` drops only 322 rows/day (0.02%) — malformed `cat` values
(`""`, `-1`, `.`, quoted `"86"`). Not a data-loss concern, but the quoted-numeral variants are a
parser bug worth fixing.

### 1.2 Churn — the number that drives the whole design

Over 8 consecutive days (2026-07-01 … 07-08), **10,413,254 raw observations**:

| Grain | Rows/day | Day-over-day dirty |
| --- | --- | --- |
| raw store×SKU | ~1.40M | **1.5%** (158,627 real price changes in 8 days) |
| chain×settlement×product | 41,216 | 8.7% |
| settlement×product, all fields | 17,344 | 37.0% |
| settlement×product, `min` only | 17,344 | **6.5%** |

The 37% figure is a decoy. It is `avg` / `stores` / `cheapestStore` wobbling as the reporting store
panel shifts, not prices moving. Actual prices are extremely sticky.

Key-space stability was tested against five different key definitions (raw name, chain code,
normalized name, normalized store, and combinations). Distinct keys ranged 1,887,908 – 1,899,083 —
a 0.6% spread. **The ~1.9M store×SKU key space is real assortment, not free-text instability.** No
surrogate-key trickery is needed; the natural key is sound.

### 1.3 The two hazards

**Chains skip days.** Daily row counts swing 1,043,681 – 1,623,160; chain counts 204 – 211;
settlement counts 227 – 243. A row missing today does *not* mean the price changed. Any design that
infers change from absence will mint millions of phantom close/open events on the days a large chain
fails to upload.

**`db:dump` is a full `pg_dump` → GCS.** This is the actual "upload millions of unchanged rows every
day" cost today, and it is orthogonal to row churn: a 25k-row delta still triggers a whole-database
dump and upload. It must not sit in the daily path.

---

## 2. Data model — `scripts/db/schema/pg/048_prices.sql`

Highest existing migration is `047_nzok_hospital_trends.sql`, so this is **048**.

Four dimensions and one fact table. The fact table is a pure **SCD-2 step function**: one row per
(store, sku, price-run). It is never rewritten on days when nothing changes.

```sql
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
  -- Denormalized place names. There is NO settlements dimension in Postgres
  -- (verified: no CREATE TABLE settlements/places/ekatte anywhere in
  -- scripts/db/schema/pg/). The precedent is `awarder_seats`, which carries
  -- settlement/municipality/oblast inline keyed by ekatte. Without these, the
  -- price-product / price-search routes cannot render a place name and the
  -- DbDataTable cannot filter by oblast. Populated by resolvePlace() at ingest.
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

-- Mirror of the hand-authored scripts/prices/products.json (§7). Git is the
-- source of truth; this copy exists so SQL can join cat_id → label without
-- round-tripping a payload blob. Reloaded (TRUNCATE + insert) on every catalog run.
CREATE TABLE IF NOT EXISTS price_cats (
  cat_id      smallint PRIMARY KEY,   -- 1..101
  group_id    smallint NOT NULL,      -- one of the 14 categories
  bg          text NOT NULL,
  en          text NOT NULL,
  unit_priced boolean NOT NULL DEFAULT false   -- gates cross-chain merging (§4.3)
);

-- Canonical product: the cross-chain identity. See §4.
CREATE TABLE IF NOT EXISTS price_products (
  product_id   bigserial PRIMARY KEY,
  canon_key    text NOT NULL UNIQUE,
  slug         text NOT NULL UNIQUE,   -- SEO: /product/kafe-lavaca-kualita-rosa-zurna-1kg
                                       -- FROZEN at first insert. Never updated. See §4.5.
  cat_id       smallint NOT NULL,      -- 1..101 КЗП group
  title        text NOT NULL,          -- modal raw name, cleaned (may drift; slug may not)
  brand        text,
  net_qty      numeric,                -- normalized to g / ml / pc
  net_unit     text,
  unit_priced  boolean NOT NULL DEFAULT false,       -- loose per-kg good (§4.3)
  attrs        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"fat":"3","class":"II"} — part of identity
  chain_count  int NOT NULL,
  sku_count    int NOT NULL,
  confidence   smallint NOT NULL,      -- 0..100
  -- Materialized by prices:catalog. The DbDataTable registry (impl §4.3) sorts on
  -- these; the registry engine can only order by real base-table columns.
  current_min_eur numeric(10,4),
  pct_since_euro  numeric(6,2),
  first_seen   date NOT NULL,
  last_seen    date NOT NULL           -- retire vanished products by this, never DELETE
);

-- A chain's own listing. chain_code is NOT global (see §4.1) — never join on it alone.
CREATE TABLE IF NOT EXISTS price_skus (
  sku_id      bigserial PRIMARY KEY,
  eik         text NOT NULL REFERENCES price_chains(eik),
  chain_code  text NOT NULL,
  raw_name    text NOT NULL,
  name_norm   text NOT NULL,
  cat_id      smallint,
  product_id  bigint REFERENCES price_products(product_id),  -- NULL = unmatched, still browsable
  first_seen  date NOT NULL,
  last_seen   date NOT NULL,
  UNIQUE (eik, chain_code, name_norm)
);

-- HISTORY. valid_to IS NULL = last known price, NOT necessarily "still on sale".
-- A run closes only when the price CHANGES. A discontinued SKU's run stays open
-- forever. Never read this table for "current price" or for a day's aggregate —
-- see §3.2 and use price_current / price_grid_days.
CREATE TABLE IF NOT EXISTS price_facts (
  store_id    bigint NOT NULL REFERENCES price_stores(store_id),
  sku_id      bigint NOT NULL REFERENCES price_skus(sku_id),
  valid_from  date NOT NULL,
  valid_to    date,
  price_eur   numeric(10,4) NOT NULL,
  promo_eur   numeric(10,4),
  PRIMARY KEY (store_id, sku_id, valid_from)
);

-- TODAY'S TRUTH. TRUNCATE + reload from the day's observations, every run.
-- ~1.4M rows. TRUNCATE resets the heap, so there is no bloat and no dead tuples.
-- This is what "current price", the cross-chain ladder and cheapest-store read.
CREATE TABLE IF NOT EXISTS price_current (
  store_id    bigint NOT NULL,
  sku_id      bigint NOT NULL,
  price_eur   numeric(10,4) NOT NULL,
  promo_eur   numeric(10,4),
  PRIMARY KEY (store_id, sku_id)
);

-- DAILY AGGREGATE, computed from the day's actual observations — never
-- reconstructed from price_facts (§3.2). ~17.3k rows/day. This is the input to
-- the Jevons index and to every tile that exists today.
CREATE TABLE IF NOT EXISTS price_grid_days (
  day        date NOT NULL,
  ekatte     text NOT NULL,
  cat_id     smallint NOT NULL,      -- the 1..101 КЗП group
  min_eur    numeric(10,4) NOT NULL,
  avg_eur    numeric(10,4) NOT NULL,
  max_eur    numeric(10,4) NOT NULL,
  median_eur numeric(10,4) NOT NULL,
  promo_min_eur numeric(10,4),
  stores     int NOT NULL,
  chains     int NOT NULL,
  cheapest_eik   text,
  cheapest_store text,
  PRIMARY KEY (day, ekatte, cat_id)
);

-- Per-chain daily minimum, for chain comparison + the local-anomaly tile (§9.2.4).
-- ~41.2k rows/day.
CREATE TABLE IF NOT EXISTS price_chain_grid_days (
  day     date NOT NULL,
  ekatte  text NOT NULL,
  eik     text NOT NULL,
  cat_id  smallint NOT NULL,
  min_eur numeric(10,4) NOT NULL,
  PRIMARY KEY (day, ekatte, eik, cat_id)
);

-- Which chain reported on which day. ~210 rows/day. Masks reporting gaps in charts.
CREATE TABLE IF NOT EXISTS price_chain_days (
  day   date NOT NULL,
  eik   text NOT NULL REFERENCES price_chains(eik),
  rows  int  NOT NULL,
  PRIMARY KEY (day, eik)
);
```

Indexes (every one justified by a query in §5; per `reference_pg_query_performance`, EXPLAIN ANALYZE
each on the worst-case entity before shipping):

```sql
CREATE INDEX IF NOT EXISTS price_facts_open      ON price_facts (sku_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS price_facts_sku_time  ON price_facts (sku_id, valid_from DESC);
CREATE INDEX IF NOT EXISTS price_facts_store_sku ON price_facts (store_id, sku_id);
CREATE INDEX IF NOT EXISTS price_facts_from_brin ON price_facts USING brin (valid_from);
CREATE INDEX IF NOT EXISTS price_skus_product    ON price_skus (product_id);
CREATE INDEX IF NOT EXISTS price_products_trgm   ON price_products USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS price_products_cat    ON price_products (cat_id);
CREATE INDEX IF NOT EXISTS price_stores_ekatte   ON price_stores (ekatte);
```

`price_products_trgm` is what powers free-text product search. Note the `pg_trgm` GUC re-apply
gotcha on Cloud SQL (`reference_pg_payload_determinism`).

### 2.1 Sizing

Seed ≈ 1.9M fact rows. Steady state, measured two ways over the 8-day window: real price changes ran
~20k/day; observed total inserts on the two most-converged days were 34,286 and 38,767. The key space
had not finished filling after 8 days, so take **25k–40k inserts/day** as the honest band.

| Table | Steady-state growth | 1 year | 5 years |
| --- | --- | --- | --- |
| `price_facts` | 25–40k/day | 10–15M | 45–70M |
| `price_grid_days` | 17.3k/day | 6.3M | 32M |
| `price_chain_grid_days` | 41.2k/day | 15M | 75M |
| `price_chain_days` | ~210/day | 77k | 385k |
| `price_current` | rewritten, not grown | 1.4M | 1.4M |
| `price_skus` | upserted (**116,510** distinct/day) | ~150–250k total | — |
| `price_stores` | upserted (**2,654** distinct/day) | ~3k total | — |

At ~60 bytes/row plus indexes that is low-double-digit GB at five years — comfortable for Cloud SQL,
and still two orders of magnitude below the 493M rows/year a naive append-every-observation design
would produce.

`price_chain_grid_days` is the largest by growth. It exists only for chain comparison and the
local-anomaly tile (§9.2.4). If those slip, drop it and reclaim 75M rows — it is the one table here
that is a feature dependency rather than a correctness dependency.

The feed is **already denominated in euro** — `scripts/prices/lib/normalize.ts` performs no currency
conversion, and none is needed. Unlike the datasets covered by `feedback_bg_uses_eur`, there is no
1.95583 division at ingest. Columns are named `*_eur` to make that explicit.

---

## 3. The daily update

### 3.1 Algorithm

Replace `build_index.ts`'s "recompute everything from 188 cached days" with a bounded daily delta.
One transaction:

```
BEGIN
  COPY  → price_stage (UNLOGGED, TRUNCATEd after)      -- ~1.4M rows, bulk COPY not row INSERT
  upsert price_chains  ON CONFLICT DO UPDATE last_seen  -- ~210 rows
  upsert price_stores  ON CONFLICT DO UPDATE last_seen  -- ~2,650 rows
  upsert price_skus    ON CONFLICT DO UPDATE last_seen  -- ~150k rows (deduped from stage)
  INSERT price_chain_days                               -- ~210 rows

  -- 1. close the runs whose price actually moved today
  UPDATE price_facts f SET valid_to = :day - 1
    FROM obs o
   WHERE f.store_id = o.store_id AND f.sku_id = o.sku_id AND f.valid_to IS NULL
     AND (f.price_eur, f.promo_eur) IS DISTINCT FROM (o.price_eur, o.promo_eur);

  -- 2. open a run for every changed or never-seen (store, sku)
  INSERT INTO price_facts (store_id, sku_id, valid_from, price_eur, promo_eur)
  SELECT o.store_id, o.sku_id, :day, o.price_eur, o.promo_eur
    FROM obs o LEFT JOIN open_facts c USING (store_id, sku_id)
   WHERE c.store_id IS NULL
  ON CONFLICT DO NOTHING;

  recordIngestBatch(c, { source: 'kzp_prices', table: 'price_facts', ... })
COMMIT
```

Daily write volume: **~25–40k inserts + ~15–25k updates** on `price_facts`, ~150k on `price_skus`,
~2.9k on the small dims. The 1.4M-row COPY lands in an UNLOGGED staging table that is truncated at
the end of the run — it never enters a WAL-logged, replicated, or dumped table.

### 3.2 Why `price_facts` cannot answer "what was true on day D"

*(Corrected after an audit. The first version of this plan got it wrong; the error is instructive, so
it is recorded rather than quietly deleted.)*

The obvious design puts `last_seen` on the fact row so you know a price was still observed today.
That would `UPDATE` ~1.36M unchanged rows every single day — real bloat, a 1.36M-tuple WAL burst, and
autovacuum load. So v1 dropped `last_seen` and claimed coverage could be reconstructed as *"the fact
interval covers D **and** that chain reported on D"*, using the tiny `price_chain_days` table.

**That is wrong, and measurably so.** A run closes only when the price *changes*. When a SKU is
delisted, or a store closes, its run stays open **forever** — the chain keeps reporting, so the
chain-grain mask never excludes it. `price_chain_days` knows a chain reported; it cannot know that
*this store* stopped listing *this SKU*.

Measured over just the eight days 2026-07-01 … 07-08: **1,899,083 distinct (store, sku) runs opened,
against 1,400,705 rows actually observed on 07-08.** Reconstructing that day's grid from open runs
would carry **498,378 phantom observations — a 36% over-count, after eight days.** Over 188 days it
is far worse. Every phantom inflates `stores` and drags `min` / `median` / `max` toward stale
extremes. The Phase-1 parity gate would have failed on the first delisted SKU, and the shipped price
index would have been quietly wrong.

The fix is to stop asking the step function a question it cannot answer. **Absence is only knowable
at the moment of observation**, so it must be recorded then, from the day's own data:

| Table | Written from | Rows/day | Answers |
| --- | --- | --- | --- |
| `price_facts` | the delta | 25–40k inserts | "what did this SKU cost over time" |
| `price_current` | today's obs, TRUNCATE+reload | ~1.4M | "what does it cost **now**, and is it still sold" |
| `price_grid_days` | today's obs | 17.3k | "what was the settlement×product aggregate on day D" |
| `price_chain_grid_days` | today's obs | 41.2k | "what was each chain's minimum on day D" |
| `price_chain_days` | today's obs | ~210 | "did this chain report at all on day D" |

`price_current` is rewritten wholesale each run, but `TRUNCATE` resets the heap — no dead tuples, no
bloat, no index churn on the large historical table. This is exactly the pattern `scripts/agri/ingest.ts`
already uses (`TRUNCATE agri_subsidies` + bulk reload of ~2M rows, in one transaction), and it is far
cheaper than `UPDATE`-ing 1.36M rows inside a 10–70M-row history table.

The honest headline is therefore: **the price *history* grows by 25–40k rows/day; the current
snapshot is a bounded 1.4M-row rewrite; the daily aggregates add ~58k rows/day.** That is still two
orders of magnitude better than appending every observation to a growing table (493M rows/year), and
unlike v1 it is correct.

**A gap in reporting reads as a gap, never as a price change** — that principle survives. It is
`price_current` and `price_grid_days`, not `price_facts`, that enforce it.

### 3.3 Where the loader runs

Per the agri precedent, the loader targets Cloud SQL directly via the `DATABASE_URL` override, not
via a dump round-trip:

```jsonc
"prices:ingest":       "tsx ./scripts/prices/ingest.ts",
"prices:ingest:cloud": "DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npm run prices:ingest",
```

`db:dump` is demoted to a periodic DR snapshot (weekly, or on schema change), never part of the daily
watcher path. This alone removes the recurring multi-GB daily upload.

### 3.4 Backfill

The 188 retained ZIPs replay through the same code path, oldest-first, behind a `--backfill` flag
(per `feedback_one_off_backfills`: manual, never in the watcher). Replaying in date order reproduces
the exact same step-function history, so 2026-01-02 remains the euro baseline for every product.

---

## 4. The canonical catalogue

This is the risky half. Handle it deliberately. The full audit of the clustering algorithm — four
defects found by running it against the real corpus — lives in the implementation plan §3.0.

### 4.1 There is no barcode

`Код на продукта` is a **chain-internal SKU code, not an EAN**. Measured on 2026-07-08:

- 82,523 distinct codes; 19,273 appear at more than one chain
- 15.2% of codes map to more than one distinct product name
- code `000006` is `СИРЕНЕ КРАВЕ РОДОПЕЯ 1КГ КУТИЯ` at one chain, `ПИЛЕ ОХЛАДЕНО ГРАДУС ТАРЕЛКА` at
  another, `КЕН КОЛБАС ТЕЛЕШКИ ЕСТ.ЧЕРВО` at a third
- only 5.7% are EAN-shaped (12–14 digits)

Croatia's `cijene.dev` joins on mandated EANs. We cannot. **Never join SKUs on `chain_code` across
chains.** Identity must come from the name.

### 4.2 The canonical key

Prototyped and measured. `canon_key = cat_id | net_qty+net_unit | sorted content tokens | attrs`,
where tokens are uppercased, punctuation-stripped, ≥3 chars, stopworded, and **sorted** — making the
key word-order invariant. On day 2026-07-08 this yields **74,823 groups from 95,324 raw names**, of
which **15,935 (21.3%) span more than one chain**. Verified merges:

```
[7 chains]  71|1000g|1КГ_ЗЪРНА_КАФЕ_КУАЛИТА_ЛАВАЦА_РОСА
   "КАФЕ ЛАВАЦА 1КГ КУАЛИТА РОСА ЗЪРНА" / "КАФЕ ЛАВАЦА КУАЛИТА РОСА НА ЗЪРНА 1КГ"
   / "КАФЕ ЛАВАЦА ЗЪРНА КУАЛИТА РОСА 1кг"

[14 chains] 9|400g|400ГР_КРАВЕ_САЯНА_СИРЕНЕ
   "СИРЕНЕ КРАВЕ САЯНА 400ГР ВАКУУМ" / "Краве сирене САЯНА 400гр" / "Саяна Краве Сирене 400гр"
```

Fixing the Cyrillic unit regex lifts size-parse coverage from 64.0% → **79.9%** of distinct names.
Capturing `%` as an attribute shatters the false ВЕРЕЯ merge from one 59-chain blob into **19
correct groups**, separated by fat content and volume.

### 4.3 Risk controls (non-negotiable on a transparency site)

- **No size, no cross-chain merge — except for unit-priced goods.** If `net_qty` is unparsed the SKU
  may only form a single-chain group. *But* auditing the rule showed it demotes 2,811 multi-chain
  groups (9,235 chain-listings) — `БАНАНИ`, `МОРКОВИ`, loose meat and cheese, sold per kilogram with
  no pack size by nature. Categories flagged `unit_priced` are exempt.
- **Quality class and homoglyphs.** `БАНАНИ` vs `БАНАНИ II` are different goods, and the corpus
  spells the class with both Latin `II` and Cyrillic `ІІ`. Class is an attribute; folding is required.
- **Unmatched is a first-class state.** `price_skus.product_id IS NULL` renders as a chain-local
  product. We never silently merge to look more complete.
- **Never auto-merge on a similarity threshold.** Under-merging costs a missing comparison;
  over-merging publishes a false price claim under a national transparency brand.
- **`price_product_overrides`** — a committed alias/split table for hand corrections, following the
  precedent of the TR namesake overrides (`project_procurement_namesake_fix`).
- Cross-chain price comparison renders **only** for `confidence >= threshold AND chain_count > 1`.

### 4.5 Slugs are frozen; titles are not

`price_products.title` is the *modal raw name* across member SKUs, recomputed on every
`prices:catalog` run. A single chain adding or renaming a listing can flip the mode, which would flip
the title, which would flip a `slugify(title)`-derived slug — silently breaking every indexed
`/product/:slug` URL and every sitemap entry pointing at it.

**Rule: `slug` is assigned once, at first insert, and never updated.** The `rebuild_catalog.ts`
upsert must exclude `slug` from its `DO UPDATE SET` list. Titles may drift; URLs may not. Vanished
products are retired via `last_seen`, never `DELETE`d, so old links keep resolving.

### 4.6 Honest expectations

~79% of canonical products exist at exactly one chain (private label, niche SKUs). Cross-chain
comparison is meaningful for ~15.9k products. That is not a shortfall — Greece's flagship PosoKanei
covers ~8–10k, Slovakia's cenyslovensko.sk ~160–300. It is the interesting head of the distribution.

---

## 5. Serving layer

Follow the agri split: precomputed blobs for dashboards, the registry table engine for browsing.

**`price_payloads (kind, key) → jsonb`**, exactly mirroring `agri_payloads` / `fund_payloads`, served
by a `price-payload` route in `functions/db_routes.js` with `missingMigrationEmpty` degradation.
Kinds: `overview` (national), `oblast:<code>`, `place:<ekatte>`, `chains`, `chains:<obshtina>`,
`ranking`, `dict`. This preserves today's tile payload sizes and O(1) PK-seek reads.

**Live SQL** for the new surfaces:

| Query | Path |
| --- | --- |
| product search | `price_products_trgm` GIN over `title` |
| per-product history | `price_facts_sku_time`, joined via `price_skus.product_id` |
| current cross-chain ladder | `price_facts_open` partial index |
| product table browse | `/api/db/table` REGISTRY entry `price_products` |

REGISTRY entry (`functions/db_table.js`) modelled on `agri_subsidies`: `title` (`search: true`,
backed by the trgm index), `cat_id` (`filter: "in"`), `brand`, `chain_count`, `net_qty`, plus sort on
current min price and % change since euro. Whitelist is the security boundary — the client never
sends identifiers.

Per `feedback_db_query_perf`, every one of these gets an EXPLAIN ANALYZE on the worst-case entity
(fresh milk: 57 chains, thousands of stores) before it ships. Precompute only what exceeds ~200ms.

---

## 6. Frontend

The data-source swap is mechanical: `usePrices.tsx`'s six hooks trade `dataUrl()` for
`/api/db/price-payload?kind=…`, mirroring `src/data/agri/fetchAgriPayload.ts`. Return types are
unchanged, so no tile component is touched by the migration itself.

The dashboard rebuild — the actual product work — is §9.

---

## 7. Retiring the JSON — a full inventory

**The principle.** *Git stores what a human authors. Postgres stores what the pipeline derives.* The
only admissible exception is a derived artifact consumed by a process that structurally cannot reach
the database — and it must then be bounded, stable, and diffable.

Applied to every JSON artifact that touches prices:

| Artifact | Size | Verdict | Why |
| --- | --- | --- | --- |
| `data/prices/index.json` | 260KB | **→ PG, delete** | derived serving artifact |
| `data/prices/ranking.json` | 128KB | **→ PG, delete** | derived serving artifact |
| `data/prices/chains.json` | 12KB | **→ PG, delete** | derived serving artifact |
| `data/prices/dict.json` | 16KB | **→ PG, delete** | derived; becomes a `price_cats` join |
| `data/prices/settlement/*.json` | 242 files, 4.7MB | **→ PG, delete** | derived shards |
| `data/prices/chains/*.json` | 159 files, 636KB | **→ PG, delete** | derived shards |
| `data/prices/_cache/` | 490MB | **delete** | regenerable cache; already gitignored. Superseded by `price_grid_days`. **Verify the GCS cold archive first** (§11) |
| `raw_data/prices/*.zip` | 4.1GB | **keep, never migrate** | the authoritative source. Gitignored; lives on disk + a best-effort GCS cold archive |
| `scripts/prices/products.json` | 15KB | **KEEP as source** | hand-authored. Mirrored into `price_cats` |
| `data/prices/product_overrides.json` | small | **KEEP as source** | hand-authored. Mirrored into PG |
| `data/prices/product_slugs.json` | ~500KB | **KEEP, reluctantly** | derived, but prerender/sitemap have no DB. See below |

Net: **405 files and ~5.7MB of derived JSON deleted**, plus 490MB of cache. Three files survive.

### 7.1 The two that are genuinely not data

`scripts/prices/products.json` (the 101 КЗП groups, their 14 categories, bg/en labels) and
`data/prices/product_overrides.json` (the hand-curated merge/split corrections) are **configuration,
not output**. Both gate correctness: `unit_priced` in the former decides whether a product may merge
across chains at all (§4.3), and the latter is the human-review artifact of the clustering audit.

A change to either must arrive as a reviewable diff in a pull request. Putting them in Postgres would
make a rule change invisible — an `UPDATE` with no history, no reviewer, no blame. Precedent: the TR
namesake overrides (`project_procurement_namesake_fix`).

So: **git is the source of truth; the ingest loads a copy into `price_cats` / `price_product_overrides`
so SQL can join.** That is not "JSON generated from PG" — the arrow points the other way, which is
exactly what `feedback_no_json_from_pg` is guarding.

### 7.2 The one that is data, and survives anyway

`data/prices/product_slugs.json` is a projection of `price_products` — by the principle above it
should not exist. It survives because `scripts/prerender/` and `scripts/sitemap/` have never opened a
database connection, and the alternatives are worse: giving the build a DB makes it non-hermetic, and
the maintainer's *local* PG (`:5433`) is stale anyway, since the ingest targets Cloud SQL (`:5434`).

It is admissible only because it is bounded and stable:

- **Bounded** — only the prerendered top ~2–5k products by `chain_count`, not all 74k. Fields limited
  to `{ slug, title, catId, chainCount }`.
- **Stable** — slugs are frozen at first insert (§4.5), so the file is append-mostly. It does not
  churn daily; a diff in it means a genuinely new product page.
- **Diffable** — a slug change is visible in review before it breaks an indexed URL.

Written by `export_slugs.ts` as the last step of the *ingest* (which holds the authoritative
connection), never by the build.

### 7.3 Consumers to rewire before deleting

Full PG-only, matching `agri_subsidies` (which already ships with no JSON shard tree).

1. **`ai/tools/prices.ts`** — 6 tools (`priceIndex`, `settlementPrices`, `cheapestChains`,
   `priceRanking`, `basketAffordability`, `basketVsInflation`) move from `fetchData` to the payload
   route. `resolveProduct` / `PRODUCT_ALIASES` (~34 regexes mapping phrases to the 101 group ids) is
   superseded by the trgm search over 74k real products — a large unlock for the chat, and worth two
   new tools: `productPrice` and `productHistory`.
2. **`scripts/prerender/routes.ts`** + `bodyBuilders.ts` — *no change needed for the existing pages.*
   Verified: the `/prices` and `/consumption` bodies (`routes.ts:980-1057`) are static HTML strings,
   and neither `scripts/prerender/` nor `scripts/sitemap/` ever opens a DB connection. OG capture
   drives the live SPA, so it picks up `/api/db` for free. The new `/product/:slug` routes read the
   committed `product_slugs.json` (§7.2).
3. **`scripts/data_map/model.ts`** — `ds:prices` repoints from `data/prices/` to Postgres; add the
   new `f:products` feature node and edge. The prebuild fails on an unplaced source, so this is not
   optional.
4. **`scripts/watch/sources/kzp_prices.ts`** — unchanged (it fingerprints the advertised ZIP date).
5. **`scripts/prices/lib/locations.ts`** — `resolvePlace()` must now run **at ingest**, inside
   `load_day.ts`, before the COPY. It normalizes the raw feed code to a 5-digit EKATTE (strips the
   Sofia district suffix, zero-pads), synthesizes the Sofia city node (68134 → obshtina `SOF46`,
   oblast `S23`), and drops codes it cannot resolve. Its outputs populate `price_stores.settlement /
   obshtina / oblast`. The plan previously never said where this ran; it cannot live in the payload
   builder, because the serving routes need place names too. It keeps reading the shared
   `data/settlements.json` (23 consumers) and `data/census_2021_settlements.json` — cross-cutting
   reference data, out of scope for this migration.
6. `data/prices/_cache/` is deleted last, and only after the GCS cold archive is verified (§11).

`scripts/prices/build_index.ts` (776 lines) is deleted. Its index math — the Jevons index of
per-settlement median-of-minimum prices — moves into the payload builder unchanged, and must be
verified against the current `index.json` values as a parity net before the JSON is removed.

---

## 8. Competitive landscape

Researched across BG, HR, HU, GR, IT, ES, RO, SI, SK, PL, PT, FR, plus the commercial best-in-class.

### 8.1 The source is also the competitor, and it is weak

**kolkostruva.bg** (КЗП) is a legally-mandated portal: every chain with turnover > 10M BGN must
upload individual store prices daily for a fixed basket of 101 product groups. It is authoritative,
daily — and a **dumb lookup table**:

- Two-step funnel: pick a settlement, then pick a product from the 101. **No free-text search.**
- Shows today's price and yesterday's price, plus a promo flag. **No chart. No history. No trend.**
- **No map. No ranking. No aggregation.** It never tells you where it is cheapest.
- Its daily-upload mandate is tied to the euro changeover and **expires 8 Aug 2026** (control regime
  possibly extended to Aug 2027).
- It does compute a **справедлива цена ("fair price")** benchmark under a Ministry of Economy
  methodology — informational, no fine — alongside two enforcement tiers (*икономически необоснована
  цена*, fines €5k–€100k; *прекомерно висока цена*, ruled on by КЗК). Surfacing deviation from the
  fair price is an unclaimed hook, though the benchmark is **not in the open-data ZIP** — it lives on
  the portal. Treat as needs-source.
- Already criticised in the press (Sega) for misleading food-price impressions. **Methodology
  transparency is therefore a competitive weapon, not a footnote.**

### 8.2 European peers — nobody combines official data + store grain + history + open data

| Tool | Country | Product search | History chart | Store-level | Map | Open API | Basket optimizer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kolkostruva.bg | BG | ✗ | ✗ | ✓ | ✗ | ✓ (ZIP) | ✗ |
| cijene.dev | HR | ✓ (EAN) | ✓ | ✓ | ✓ (lat/lon) | ✓ | ✗ |
| Árfigyelő | HU | ✓ | partial | ✓ (1,788 stores) | ✓ | ✗ | ✓ |
| PosoKanei / e-Katanalotis | GR | ✓ (barcode) | ✓ (2 mo) | ✗ | ✗ | ✗ | ✓ |
| cenyslovensko.sk | SK | ✓ | ✗ | ✓ | regional | ✗ | ✓ |
| super.facua.org | ES | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Monitorul Prețurilor | RO | basket only | ✗ | ✓ (1,700 stores) | filter | ✗ | ✓ |
| Naša super hrana | SI | basket only | ✓ | ✗ | ✗ | ✗ | ✓ |
| Osservaprezzi (groceries) | IT | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Koszyk (dlahandlu) | PL | ✓ | ✓ | city | ✗ | ✗ | ✓ |
| DECO Cabaz | PT | ✗ | basket only | ✗ | ✗ | ✗ | ✗ |
| **Наясно (proposed)** | **BG** | **✓** | **✓** | **✓ (2,649)** | **✓** | **✓** | **✓** |

Croatia is the only peer that beats us on every axis, and only because the state mandated barcodes.
Italy's **fuel** observatory is the gold standard for open, station-level, map-based price data with
a real API — while its **grocery** side is a cautionary tale: a registry of participating shops with
no prices published at all.

Ideas worth stealing, attributed:

- **Slovakia (cenyslovensko.sk)** — daily submission SLA (chains by 05:00, published 06:00);
  basket optimizer that finds the cheapest *product-and-store combination*; a domestic-origin flag.
- **Hungary (Árfigyelő)** — map-based nearest-store filter, credited by the GVH with "strengthening
  micro-market competition"; a freely-computable shopping list.
- **Spain (FACUA)** — a **biggest-risers leaderboard** ranking products by % increase today / this
  week / this month, with headline-grade numbers. Extremely press-friendly; the single most viral
  mechanic in the whole survey.
- **Slovenia (Naša super hrana)** — cross-border basket comparison, and an anti-gaming survey design
  (retailers know the survey week, not the day or location). Also a cautionary note: the government
  *removed* the cheapest/most-expensive headline graph after political pressure.
- **Romania** — store-format filter (discounter / hyper / cash&carry); a dedicated simplified view
  for the politically-salient price-capped staples drove a reported +90% jump in usage.
- **Greece (PosoKanei)** — whole-basket cost optimizer with cheaper-alternative suggestions, and a
  **cross-EU price comparison that already shows Bulgarian prices** for identical products. We can
  invert that comparison.
- **Croatia (cijene.dev)** — "normalize once, let everyone build on it": one clean public API plus
  daily ZIP snapshots spawned multiple consumer apps within days. Directly analogous to our own
  offline-pipeline architecture.

### 8.3 Commercial best-in-class (UX patterns, not business models)

- **camelcamelcamel** — the reference price-history chart. Range toggles (1m/3m/6m/1y/all) that
  **recompute** high/low/average; the high and low **annotated with the date they occurred**; hover
  crosshair; colour-coded, individually-toggleable series. This is the crown jewel to rebuild.
- **trolley.co.uk** — a two-level structure: a macro Grocery Price Index page (headline before/after
  with a delta, plus the monitored-product count as a trust anchor) drilling into per-product pages
  via four ranked facets — category / brand / store / product — all sharing one card component.
- **Google Shopping** — the **Low / Typical / High badge**. The best "reduce a chart to a verdict"
  pattern in existence. Pair it with the chart: casual users get the answer, power users the evidence.
- **Numbeo** — low/avg/high per item (honest about spread) and a two-city comparison indexed to a
  baseline, so places with different absolute levels are directly comparable.
- **Idealo / Skroutz / Geizhals** — all converge on the same triad: offer ladder, 12-month history
  graph, threshold alert. The convergence *is* the signal; this is the expected UX.
- **Price-per-unit** — Baymard finds 86% of e-commerce sites fail to show it. We parse `net_qty`.
  Showing €/kg and €/L on every row is cheap differentiation.

### 8.4 The euro-changeover precedent — our single biggest editorial hook

Bulgaria adopted the euro on **2026-01-01**. Every prior changeover produced the same phenomenon: a
large **perceived–actual inflation gap**, driven by a small, service-concentrated one-off effect on
highly visible, frequently-bought items.

- **Germany 2002** — "Teuro" was word of the year; perceived inflation ran 2.6–5.7pp above measured
  CPI while the actual changeover effect was 0.12–0.29pp.
- **Slovenia 2007** — the canonical cautionary tale: a cup of coffee in a bar rose ~48%, beer ~42%,
  a haircut ~29% — yet the aggregate effect on inflation was ~0.3pp. Visible items drive perception.
  Its consumer association ran a crowd-sourced **"PriceWatch"** that published reported rises.
- **Croatia 2023** — the government shipped **"Kretanje cijena"**, which classified each product into
  four buckets — **got more expensive / got cheaper / on promotion / unchanged** — measured against
  the **31 December 2022 pre-euro price**. Its headline stat was literally "299 products cheaper than
  on 31 December". This is the cleanest UX precedent for exactly what we can compute.
- **Bulgaria 2026** — the ECB (Apr 2026) puts the changeover effect at **0.3–0.4pp**, services-driven,
  with "no systematic upward adjustment"; measured inflation *fell* 3.5% → 2.1% (Dec 2025 → Feb 2026).
  Meanwhile НАП/КЗП fines for unjustified rises passed €1M by April.

**Nobody publishes a "did the euro raise prices?" tracker.** kolkostruva has the raw data and shows
only today-vs-yesterday. НСИ publishes national CPI with a lag. The enforcement bodies publish fine
counts. We hold a daily, product-level, settlement-level series anchored to **2026-01-02, euro day**.
That vacuum is the strategic centre of this rebuild.

### 8.5 SEO

74k product pages is a long-tail goldmine (`цена на олио`, `къде е най-евтино яйцата`, `цена мляко
Верея`) and collides head-on with `project_firebase_deploy_ceiling` — a 453k-file `dist` fails to
deploy and we are already at ~84k. **Prerender only the top ~2–5k products** by `chain_count` and
category importance; the rest stay SPA-only with canonical tags. Per `feedback_static_seo`, an
un-prerendered route earns ~0 impressions, so choosing that 2–5k is a real editorial decision.

---

## 9. Dashboard blueprint

Today's dashboards are thin. `/consumption` is four stacked sections (basket index, official
inflation, affordability, map); `/consumption/region/:oblast` is two; `/consumption/:id` is four.
The basket tile is a wall of small numbers with no entry point into a single product, no answer to
"what do I do about it", and no mention of the euro — the one thing every Bulgarian is asking about
in 2026.

### 9.0 One spine, three zooms

Every tier answers the same three questions, at a different zoom. The tiles differ; the questions
never do.

| | **How much?** | **Which way?** | **What do I do?** |
| --- | --- | --- | --- |
| **Country** | The Basket — one branded € number | vs euro day, vs official HICP | Which chain, which product, which town |
| **Locality** | This place vs national (index 100) | this place's drift vs the country | cheapest chain *here*, local anomalies |
| **My area** | **My** basket, my products | how *my* basket moved | where I personally should shop |

The unifying object is **"Кошницата"** — a single, stable, branded basket number. DECO's *Cabaz* in
Portugal became the number the national press quotes precisely because it never changed definition.
Ours must be equally stable and equally documented.

The unifying time anchor is **euro day, 2026-01-02**. Every "since" in the product is since then.

### 9.1 Country — `/consumption`

Ordered by what a first-time visitor needs, not by what we happen to have.

1. **Hero: Кошницата днес.** One large € figure (basket cost today), the delta since euro day, a
   sparkline, and — trolley's credibility move — the **monitored-product count** as a trust anchor
   ("101 групи · 74 000 продукта · 2 649 магазина · 208 вериги"). This is the number we want quoted.

2. **„Поскъпна ли храната заради еврото?"** — the headline feature, and the reason to build any of
   this. Croatia's four-bucket classification against the 2026-01-02 price: **N% поевтиняха ·
   N% поскъпнаха · N% без промяна · N% в промоция.** A big, honest, shareable answer, with the ECB's
   0.3–0.4pp estimate cited alongside our own measurement. Ship this even if nothing else lands.

   **There must be a fifth bucket: „нови след еврото" (no baseline).** Chains skip days (§1.3), so a
   large number of (store, sku) pairs — and some whole chains — have no observation on 2026-01-02 and
   therefore no euro-day price at all. `build_index.ts` already handles this at *settlement* grain
   (`panel`, `firstSeen`, `sinceEuro` gating), but the product- and store-grain verdicts do not
   inherit that logic. Silently dropping unbaselined products understates the denominator; silently
   treating them as "unchanged" fabricates a result. Define the baseline explicitly as *the first run
   active on or after euro day*, carry a `baseline_day` per entity, and put anything whose baseline is
   materially later than 2026-01-02 in the fifth bucket. The bucket counts must sum to 100% of the
   priced universe, and the page must say what the fifth bucket is.

3. **Усещане срещу измерено.** The perceived–actual gap is the universal finding of every changeover
   since 2002. Put our КЗП monitoring basket next to the official НСИ/HICP series and *explain the
   divergence* rather than hiding it. This reframes the existing `ConsumptionInflationTile` from a
   chart into an argument. To compare honestly, weight the КЗП basket by HICP category weights.

4. **Product search, above the fold.** A real search box over 74k products. This is the "browse all
   products" ask; it must be a front door, not a buried sub-page.

5. **Най-голямо поскъпване** — FACUA's leaderboard, at *product* grain rather than category.
   Toggles for 7d / 30d / since-euro. Every row deep-links to `/product/:slug`. This is the most
   press-friendly artefact in the whole plan; expect it to be the thing that gets screenshotted.

6. **Категории** — a 14-card grid (count, delta, spark), each drilling into a filtered product
   browser. Trolley's four-facet pattern; the same card component also serves brands and chains.

7. **Най-евтини вериги** — keep, but state the basket basis and coverage honestly (chains are scored
   on the *intersection* of the common basket they actually price — never raw totals across unequal
   baskets, which is already how `build_index.ts` does it).

8. **Картата** — keep the municipality choropleth, but give it a level-vs-change toggle and treat it
   as the primary doorway into the locality tier.

9. **Методология** — a permanent, linked, plain-language explainer. Sega already attacked
   kolkostruva on basket definition, averaging and promo handling. Our answer to that attack is a
   page, not a tooltip.

### 9.2 Locality — `/consumption/region/:oblast` and `/consumption/:id`

The oblast and settlement nodes share a shell; the settlement one is richer.

1. **Ниво на цените** — keep `ConsumptionPriceLevelTile` (index 100 = national median, MAD band,
   distribution track, rank). It is genuinely good and already exists.

2. **Сравни с друго място** — Numbeo's two-place comparator, which nobody in BG has. Pick any two
   settlements; get a per-product % difference table and one headline ("Пловдив е с 8% по-евтин от
   София"). Directly served by `price_facts` at settlement grain.

3. **Къде да пазарувам тук** — the cheapest chain in *this* settlement by the full basket, and, once
   stores are geocoded, the cheapest store. This is Hungary's and Slovakia's strongest feature and
   the one that converts a data page into a used tool.

4. **Местни аномалии** — *this is ours alone.* For the same product at the same chain, compare this
   settlement's price against that chain's national median. Chains mostly price nationally; **where
   they don't is a story.** No competitor holds chain×settlement×product data (Greece and Spain are
   chain-level only; Croatia and Hungary have store grain but publish no dispersion analysis).

5. **Достъпност** — basket ÷ oblast wage. The existing tile divides by Eurostat GDP per capita, but
   `project_consumption_view` names basket÷oblast-**wage** as the intended differentiator. Switch it,
   and note that the same Sofia-collapse and PDV-00-skip rules are duplicated verbatim in
   `ai/tools/prices.ts::basketAffordability` — extract once, import twice.

6. **Покритие, честно.** N stores, N chains, N of 101 groups priced, last reported day. Places with
   thin coverage must say so rather than render a confident wrong number. The tile already self-hides
   on 404; make the partial case explicit too.

### 9.3 My area — the personal tier

The country tier earns press; the locality tier earns links; **this tier earns return visits.**

1. **Твоята кошница.** Pick 10–20 products; get the total, the cheapest chain and store near you, a
   monthly bill, and — the point — **how *your* basket moved since euro day**, not the national one.
   Hungary, Slovakia, Greece, Poland and Portugal all built a version of this; it is consistently
   their most-used feature. Persist to `localStorage` (the site has no accounts), shareable via a
   URL-encoded list, in keeping with the existing `?pscope=` / `?peers=` URL contract.

2. **Твоята инфлация.** НСИ ships a personal-inflation calculator that reweights *national category
   indices* by your spending. We can do better: compute it from the **actual prices of the actual
   products you buy**. That is a genuinely novel claim in Bulgaria and the strongest single argument
   for the whole product.

3. **Сигнали за цени** — threshold alerts on your basket items. Every commercial tool converges on
   this (camel, idealo, Skroutz, Google). Pre-suggest thresholds ("добра цена" / "най-ниска досега")
   so the user never has to invent a number.

4. Keep `MyAreaPricesTile`'s movers and cheapest-chains, but kill the hardcoded
   `FEATURED = [1, 6, 31, 42, 9, 16]` — six product-group ids standing in for a real query.

### 9.4 The product page — `/product/:slug`

Where the long tail lands from Google. Composition, in order: a **cross-chain ladder** (cheapest
first, "спести 1,20 €" badge, €/kg unit price); the **camelcamelcamel history chart**; a **Low /
Typical / High verdict badge**; the **since-euro bucket**; and a **match-quality note** ("сравнено в
7 вериги" + report-a-bad-match). Reporting gaps must render as gaps — never draw a flat line through
a day a chain did not upload.

### 9.5 Five things only we can do

Ranked by "nobody else in Europe has this, and our data supports it".

1. **Rounding analysis — the euro signature.** Compare the distribution of price *endings* (0.99,
   0.49, psychological points) before and after euro day. Every changeover in history produced
   rounding-up in visible, low-value items; Slovenia's coffee is the canonical example. We hold the
   only dataset in Bulgaria that can show it at product grain. This is a front-page story.

2. **Shrinkflation detection.** Once `net_qty` is parsed, the same product name with a *smaller net
   quantity* over time is shrinkflation. Price per unit stays flat; the pack shrinks. Nobody in
   Bulgaria tracks this. It needs the canonical catalogue, so it is a Phase-6 payoff of Phase-2 work.

3. **Price dispersion — the geography of price.** §9.2's local anomalies, rolled up nationally:
   which chains price uniformly and which don't, and where. A competition-policy artefact that the
   КЗК itself does not publish.

4. **Promo share over time.** We already carry `promo_eur` and compute `promoShare` nationally.
   Retailers manage a changeover through promotions. "What share of the basket is on promotion, and
   is it rising?" is a question no one is asking and we can answer daily.

5. **Chain lockstep.** Do chains change prices on the same days? Daily per-chain data makes
   price-following visible. Handle with care — this is a competition-law-adjacent claim, and it
   belongs in an article with caveats, not a dashboard tile.

Plus the structural one: **an open API and daily ZIP export**, Croatia's `cijene.dev` play. No BG,
RO, ES or GR tool offers one. The registry engine already *is* an API; exposing it is nearly free and
buys an ecosystem.

### 9.6 Cross-EU price comparison — what is actually possible

**Yes, for a curated set of ~50–150 products — but only via one specific route, and not automatically.**

Researched and probed on 2026-07-10. The headline: **there is no pan-EU open per-product price
feed.** Eurostat's *Detailed Average Prices* (`prc_dap12/14/15/16`) — the only Eurostat product that
ever gave an actual euro price for a specific good — was **discontinued; last collection 2015**, and
the live API now returns 404. Greece's PosoKanei *does* show Bulgarian prices, but it has no secret
source: it scrapes each country's largest chain's online store itself. Hungary's Árfigyelő, Romania's
Monitorul Prețurilor, Slovakia's cenyslovensko.sk and Spain's FACUA are all consumer front-ends with
no API or bulk export. Numbeo's terms **forbid redistribution through a public data feed**.

Three tiers, in ascending order of effort and descending order of certainty.

**Tier 1 — Eurostat Price Level Indices. Official, zero matching, ship immediately.**
`prc_ppp_ind` with `na_item=PLI_EU27_2020` is live (verified 200 OK): Bulgarian food price level
**86.8** vs Germany **103.4** (EU27 = 100, 2023). Aggregate COICOP food group, never a euro price for
a loaf of bread — but it is the credible macro backbone, it needs no product matching at all, and it
reuses the `?peers=` URL contract and `macro_peers.json` infrastructure that `/indicators/compare`
already has. This is nearly free.

**Tier 2 — Bulgaria ↔ Croatia, same retailer, same barcode. The one that actually works.**

Croatia's `cijene.dev` publishes **open daily ZIP archives with no authentication** (verified 200 OK,
2025-05-15 → present, ~50–86 MB/day), carrying EAN, regular price, promo price, unit price, chain,
store with lat/lon, and date. It exists because Croatian regulation **NN 75/2025** compels every
retailer to publish daily machine-readable price lists.

And **four of the retailers it covers also trade in Bulgaria and are already in our КЗП feed** —
Kaufland, Metro, dm and Lidl. Measured on 2026-07-08:

| BG chain | distinct SKUs | multinational-brand SKUs | brand + parsed size |
| --- | --- | --- | --- |
| Кауфланд България | 2,493 | 151 | **136** |
| Метро България | 1,669 | 82 | **81** |
| ДМ България | 725 | 72 | **72** |
| Лидл България | 671 | 35 | 4 |
| | | | **293 total** |

That is the upper bound on a **same-retailer, same-brand, same-pack** BG↔HR comparison. Kaufland,
Metro and dm write brands in **Latin script** in the feed (`Milka шоколад Oreo 100 г`,
`Barilla Спагети 500 гр.`, `Nivea шампоан Volume Sensation 400мл`), which makes the hand-match to an
EAN far easier than the Cyrillic transliterations elsewhere in the corpus (`ЛАВАЦА`, `ЯКОБС`,
`КОЛГЕЙТ`). Lidl is nearly useless here — it is private-label heavy, only 4 branded-and-sized SKUs.

This comparison is unusually defensible because it **holds the retailer constant**. Comparing our
208-chain minimum against a single German supermarket would be meaningless; comparing *Kaufland
Bulgaria* against *Kaufland Croatia* for the same barcode is not. And the editorial resonance is
hard to overstate: **Croatia adopted the euro in 2023, Bulgaria in 2026.** Croatia is our changeover
precedent, its post-euro price anger produced the 2025 supermarket boycotts, and we would be putting
the two countries' shelves side by side at the same retailer. No one has done this.

**Tier 3 — the PosoKanei method: scrape one large chain per country.** Tractable for a 20–50 item
basket (Lidl/Kaufland DE, Mega Image RO, Sklavenitis GR). Real ToS and effort cost, no mandate to
lean on outside Croatia. Defer; Tier 2 already proves the concept.

**What we can and cannot compare.** Our matchable universe is narrower than it first appears. The КЗП
mandated basket is staples, hygiene and medicines — **Coca-Cola, Pepsi, Nutella, Heineken and
Schweppes are entirely absent from the corpus** (checked: zero rows). What *is* present, densely, is
coffee (Lavazza: 80 chains, 592 SKUs, 96% sized; Jacobs: 65 chains), chocolate (Milka: 97 chains, 680
SKUs; Kinder, Ferrero, Oreo), pasta (Barilla: 64 chains, 98% sized), baby food (Hipp, Plasmon,
Nestlé) and hygiene (Colgate: 105 chains, 1,689 SKUs; Nivea, Pampers, Ariel). Twenty of thirty tested
multinational brands appear, covering 6.7% of rows. That is a good curated basket, and — not
coincidentally — it is exactly the set of categories the European Commission studied for dual
quality.

**Four caveats that must ship with any number we publish:**

1. **VAT.** Shelf prices are VAT-inclusive and food VAT differs sharply across the EU (Germany 7%
   reduced on food; Romania moved to a single 11% reduced rate in Aug 2025; Croatia's standard rate is
   25%). A raw euro gap silently reports a **tax-policy** difference as a **price** difference. Show
   net-of-VAT, or footnote the rate per country. Non-negotiable.
2. **Dual quality.** The EC's Joint Research Centre found ~**31% of branded samples differed in
   composition across member states (2018/19), falling to ~24% by 2021** — and concluded it is *not*
   a clean East/West split. **Same brand and same pack does not guarantee the same product.** This is
   simultaneously our biggest methodological risk and, handled honestly, a story of its own.
3. **Income.** "Bread costs X in Sofia and Y in Munich" is meaningless unadjusted. The correct
   instrument is Eurostat's **Purchasing Power Standard (PPS)**, derived from the same `prc_ppp_ind`
   PPP factors as Tier 1. Publish the euro figure and the PPS-adjusted figure together, or neither.
4. **No EAN on our side.** Even where the foreign data is barcode-keyed, we cannot auto-join. Every
   cross-country row is a **hand-made match** carrying a confidence flag. That rules out an automated
   pan-EU join at scale — and is precisely why this is scoped as "a select number of products".

`prc_dap`'s frozen 2015 euro prices remain usable as a clearly-labelled historical benchmark. Open
Food Facts' **Open Prices** (ODbL, EAN-keyed, live) is too sparse to lead with — ~275k prices
globally, France-dominated — but is a fine opportunistic cross-walk for resolving a BG product name
to an EAN.

### 9.7 Conventions (from memory — non-negotiable)

- No tabs. Dashboard tiles or stacked sections (`feedback_no_tabs_ux`).
- No native `<select>`; the shared Radix Select (`feedback_no_native_select`).
- Dashboard shell copies the homepage shell, no `max-w-5xl` cap (`feedback_dashboard_layout`).
- Money: `${num} €` in BG, `€${num}` in EN (`feedback_bg_uses_eur`).
- BG copy natural, not word-for-word (`feedback_bg_language`). No emojis (`feedback_no_emojis`).
- Read the `dataviz` skill before the first line of chart code.

### 9.8 Build order

| # | Feature | Tier | Impact | Effort | Needs |
| --- | --- | --- | --- | --- | --- |
| 0 | Eurostat food PLI vs peers (§9.6 Tier 1) | country | High | **S** | nothing — reuses `?peers=` |
| 1 | Since-euro four-bucket verdict | country | **Highest** | S | Phase 1 |
| 2 | Product search + browser | all | Highest | M | Phase 1 |
| 3 | Product page: ladder + history chart | product | Highest | M | Phases 1–2 |
| 4 | Biggest-risers leaderboard | country | High (viral) | S | Phase 1 |
| 5 | Perceived-vs-measured reframe | country | High | S | existing macro data |
| 6 | Unit price everywhere | all | High | S | Phase 2 |
| 7 | Low/Typical/High badge | product | Medium | S | Phase 1 |
| 8 | Two-place comparator | locality | Medium | M | Phase 1 |
| 9 | Твоята кошница + твоята инфлация | my-area | High (retention) | L | Phases 1–2 |
| 10 | Cheapest chain here / basket optimizer | locality | High | L | store grain |
| 11 | Rounding analysis | article + country | High (press) | M | Phase 1 |
| 12 | Local anomalies / dispersion | locality | Medium | M | Phase 1 |
| 13 | Shrinkflation detection | article + product | High (press) | L | Phase 2 |
| 14 | Store map / cheapest near me | locality | High | XL | geocoding |
| 15 | Price alerts | my-area | Medium | L | notification path |
| 16 | Open API + daily ZIP | ecosystem | Medium | S | Phase 3 |
| 17 | **BG↔HR same-retailer basket** (§9.6 Tier 2) | country | **High (press)** | M | Phase 2 + hand-matched EANs |
| 18 | Multi-country curated basket (§9.6 Tier 3) | country | Medium | XL | scrapers, ToS review |

Items 1, 4, 5 and 11 are the editorial payload of 2026 and depend only on Phase 1. **Ship them
before the browser if the catalogue slips.** Item 0 depends on nothing at all and can ship this week.
Item 17 is the strongest single differentiator in the plan: Croatia is Bulgaria's euro-changeover
precedent, and no one has put the two countries' shelves side by side at the same retailer.

---

## 10. Phasing

| Phase | Deliverable | Gate |
| --- | --- | --- |
| 0 | Parity harness: freeze `index.json` / `ranking.json` / `chains.json` as golden files | Test passes against today's JSON |
| 1 | `048_prices.sql`, ingest rewrite (COPY + SCD-2 delta), `--backfill` replay of 188 ZIPs, `recordIngestBatch` | Row counts + a golden day reconcile against `_cache/daily/*.json` |
| 2 | Canonical catalogue: unit regex, `attrs` identity, homoglyph folding, `unit_priced`, overrides | Gold-set precision ≥ 0.99; zero false merges in the top-500 by `chain_count` |
| 3 | `price_payloads` builder + `price-payload` route; swap the 6 `usePrices` hooks | Byte-parity of payloads vs today's JSON |
| 4 | Dashboards §9.1–9.4: since-euro verdict, search, product page, leaderboard | EXPLAIN ANALYZE on fresh milk (57 chains) under 200ms |
| 5 | Retire JSON: rewire AI tools, `data_map`; delete `build_index.ts` + `data/prices/*.json` | Prerender + OG green; `npm run build` clean |
| 5b | Wiring: `cijene_hr` watcher, `process-watch-report` mappings, README, data map + `/data` pages, 6 new AI tools | `npm run build` (proves data-map + `AI_PATH_RULES`); a PG-only ingest still writes a `/data/updates` row |
| 6 | §9.5 differentiators: rounding, shrinkflation, dispersion; geocoding; basket optimizer; open API | — |

Phases 1–3 are a pure migration and can ship without any UI change. Phase 2 is the one with genuine
execution risk and it gates nothing in phases 1 and 3 — if the clustering audit fails, ship the
migration and the SKU-faithful browser, and iterate on identity.

## 11. Open questions

- **Deploy ordering.** Migrations land via `apply_functions.ts` (or a `db:load:*:cloud` wrapper,
  which applies its own DDL) *before* `deploy:functions`, or `missingMigrationEmpty` masks a 500
  as an empty tile. Same trap as agri and NZOK. Note `db:dump` does **not** land a migration —
  it only `pg_dump`s outward to GCS (see §"`db:dump` is a full `pg_dump` → GCS" above).
- ~~**Snapshot size, and whether the ZIPs actually exist anywhere.**~~ **RESOLVED 2026-07-10.** The
  archive was checked and found **completely empty** — `gs://data-electionsbg-com/prices/_archive`
  had never been created. Two bugs: `downloadDay` returned early when the ZIP already existed locally,
  *before* reaching the upload, so a backfilled corpus was never archived; and the `gsutil` failure
  was swallowed by a bare `catch {}`. Meanwhile `bucket:sync`'s `-x '^_cache/.*'` was anchored and did
  not match `prices/_cache/…`, so 490MB of local cache had been rsyncing to the **publicly readable**
  data bucket by accident — the only off-machine copy of anything, and grids only (no store rows, no
  product names, so `price_facts` / `price_products` were unrecoverable).

  Fixed: all 189 ZIPs (4,397,605,281 bytes, MD5-verified) uploaded to
  **`gs://naiasno-archive-prices/prices/_archive`** — a private, COLDLINE, europe-west3 bucket with
  public-access-prevention *enforced*. `fetch.ts` now archives on every run (`cp -n`, idempotent) and
  warns loudly on failure. `bucket:sync`'s exclusion is now `(.*/)?_cache/.*` — note `(^|/)_cache/.*`
  would **not** work, because `gsutil rsync -x` anchors at the start. The accidental public `_cache`
  copy has been purged.

  **DR is therefore: replay the archive.** `price_facts` stays out of the `db:dump` snapshot.
- **Mandate expiry.** If the daily-upload obligation lapses on **8 Aug 2026** the feed may thin out or
  stop. The step-function model degrades gracefully (open runs simply stop being superseded), but the
  since-euro tracker needs an explicit "data ends" affordance rather than a flatlining chart. Build
  it in Phase 4, not after.
- **Fair price (справедлива цена).** КЗП computes it, but it is not in the open-data ZIP. Is it
  scrapeable from the portal, and do we want the dependency? A deviation column would have real teeth.
- **Basket weighting.** The current index is an *unweighted* Jevons index of median-of-minimum
  prices. For §9.1's perceived-vs-measured tile we need an HICP-weighted variant. Ship both, label
  both, and never let one silently stand in for the other.
- **cijene.dev licence.** The code is AGPL-3.0; the *data* is public because Croatian regulation
  NN 75/2025 compels its publication. Confirm the attribution/redistribution terms on the archive
  itself before we restate Croatian prices on naiasno.bg, and mirror rather than hot-link the ZIPs.
- **How many BG↔HR pairs actually survive?** 293 is the BG-side upper bound (§9.6). The realistic
  yield after requiring the same EAN to exist at the same retailer in Croatia is unknown until we
  pull one HR archive and try. Do that spike *before* committing to item 17 — it is a day's work and
  it decides whether the feature is 150 products or 15.
