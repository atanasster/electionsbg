# Consumption v2 — implementation plan

Companion to `docs/plans/consumption-pg-v1.md` (design, measurements, competitive research, dashboard
blueprint). That document says *what* and *why*; this one says *what to type*.

Status: **ready to implement** · Migration number: **048** (highest existing is `047_nzok_hospital_trends.sql`)

---

## 0. Preconditions

```bash
npm run db:pg:up                       # local Postgres on :5433
ls raw_data/prices/*.zip | wc -l       # expect 188 — the backfill corpus
```

**One new dependency.** `scripts/db/lib/pg.ts` exposes `getPool` / `withClient` / `exec` / `allRows`,
but no `COPY` path, and `pg` alone cannot stream `COPY … FROM STDIN`. The agri loader uses 1000-row
multi-row `INSERT`s; at 1.4M rows/day that is ~1,400 round-trips per day and ~263k across the
backfill. Add:

```bash
npm i pg-copy-streams
```

and a `copyInto` helper in `scripts/db/lib/pg.ts` (§2.2). This is the one place the plan deviates
from the agri pattern, and it is load-bearing: `COPY` turns the daily stage load from minutes into
seconds, and the 188-day backfill from hours into ~20 minutes.

**Resolved (was an open question).** The `/prices` and `/consumption` prerender bodies in
`scripts/prerender/routes.ts:980-1057` are **static HTML strings**, and
`grep -rn "allRows\|getPool" scripts/prerender/ scripts/sitemap/` returns nothing — neither ever
touches a database. Only the *new* dynamic `/product/:slug` routes need product data at build time,
handled by a slug export (§6.4). OG capture (`scripts/og/screenshot_prices.ts`) drives the live SPA at
`localhost:5173`, so it picks up `/api/db` through the Vite dev plugin with no change. `/subsidies`
set no precedent here because it is neither prerendered nor in the sitemap.

---

## 1. Phase 0 — parity harness (do this first)

Before touching the ingest, freeze the current output so every later phase can be checked against it.

**New:** `scripts/prices/tests/parity.data.test.ts`

Snapshot the three shipped artifacts and assert the PG-derived payloads reproduce them:

- `data/prices/index.json` → `national.index` (188 points), `national.byCategory`, `regions.*.index`
- `data/prices/ranking.json` → all 433 places: `basketLevel`, `indexSinceEuro`, `change30d`, ranks
- `data/prices/chains.json` → 106 chains: `basket`, `nPriced`, `products`

Copy the current files to `scripts/prices/tests/__golden__/` and commit them. They are ~400KB total
and they are the only thing standing between this migration and a silently-wrong price index.

**Gate:** test passes against today's JSON (trivially — it compares the file to itself). This
establishes the harness; phases 1–3 keep it green against PG.

---

## 2. Phase 1 — schema + SCD-2 ingest

### 2.1 New: `scripts/db/schema/pg/048_prices.sql`

Full DDL in the design doc §2. Idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT
EXISTS`), applied by the loader itself alongside `005_ingest_tracking.sql`, exactly as
`scripts/agri/ingest.ts` does. Add the staging table (normalization precomputed in TS, so no
`plpgsql` normalizer is needed):

```sql
CREATE UNLOGGED TABLE IF NOT EXISTS price_stage (
  eik              text          NOT NULL,
  ekatte           text          NOT NULL,
  store_label      text          NOT NULL,
  store_label_norm text          NOT NULL,
  chain_name       text          NOT NULL,
  chain_code       text          NOT NULL,
  raw_name         text          NOT NULL,
  name_norm        text          NOT NULL,
  cat_id           smallint      NOT NULL,
  price_eur        numeric(10,4) NOT NULL,
  promo_eur        numeric(10,4)
);
```

`UNLOGGED` means no WAL, no replication, no presence in `pg_dump`. Truncated at the end of every run.

### 2.2 Modified: `scripts/db/lib/pg.ts`

```ts
import { from as copyFrom } from "pg-copy-streams";
import { pipeline } from "node:stream/promises";

/** Stream rows into a table via COPY … FROM STDIN (text format, \N = NULL). */
export const copyInto = async (
  c: PoolClient,
  table: string,
  columns: string[],
  rows: Iterable<(string | number | null)[]>,
): Promise<number> => { /* … */ };
```

Text-format `COPY` requires escaping `\`, tab, newline and `\r` in every text field. Store labels and
product names are free text from 208 different chains — assume they contain all four. Escape, do not
hope.

### 2.3 Modified: `scripts/prices/lib/normalize.ts`

Two fixes, both found by measurement:

1. `parseChainCsv` maps `Категория` through `Number(raw)`; quoted numerals (`"86"`, `"87"` … `"93"`)
   fall outside `1..101` and are silently dropped. Strip quotes before `Number()`. Impact is tiny
   (322 rows/day, 0.02%) but it is a correctness bug, not a policy.
2. Export `normLabel(s)` and `normName(s)` — uppercase, strip punctuation to single spaces, trim.
   These produce `store_label_norm` / `name_norm` and must be the *only* definition of normalization
   in the codebase, because they are baked into the `UNIQUE` constraints on `price_stores` and
   `price_skus`. Changing them later is a data migration.

`parseChainCsv` keeps returning `PriceRow[]`, but `PriceRow` gains the two fields it currently throws
away:

```ts
export interface PriceRow {
  // … existing …
  product: string;      // already present — the raw name; STOP DISCARDING IT
  chainCode: string;    // NEW — "Код на продукта" (chain-internal, NOT an EAN)
}
```

### 2.4 New: `scripts/prices/load_day.ts`

The heart of it. One exported function, one transaction, no JSON:

```ts
export const loadDay = async (zipPath: string, day: string): Promise<DayStats>
```

```
BEGIN
  TRUNCATE price_stage
  COPY   → price_stage                                  ~1.4M rows
  INSERT price_chains  … ON CONFLICT (eik) DO UPDATE SET last_seen = :day       ~210
  INSERT price_stores  … ON CONFLICT (eik,ekatte,label_norm) DO UPDATE …        ~2,650
  INSERT price_skus    … ON CONFLICT (eik,chain_code,name_norm) DO UPDATE …     ~150k
  INSERT price_chain_days (day, eik, rows) … ON CONFLICT DO UPDATE              ~210

  CREATE TEMP TABLE obs ON COMMIT DROP AS
    SELECT s.store_id, k.sku_id,
           min(g.price_eur) AS price_eur,
           min(g.promo_eur) AS promo_eur      -- a store may list one sku twice
      FROM price_stage g
      JOIN price_stores s USING (…) JOIN price_skus k USING (…)
     GROUP BY 1, 2;

  -- (1) close runs whose price actually moved. MUST run before (2).
  UPDATE price_facts f SET valid_to = :day::date - 1
    FROM obs o
   WHERE f.store_id = o.store_id AND f.sku_id = o.sku_id AND f.valid_to IS NULL
     AND (f.price_eur, f.promo_eur) IS DISTINCT FROM (o.price_eur, o.promo_eur);

  -- (2) open a run wherever none is now in force (changed, or never seen)
  INSERT INTO price_facts (store_id, sku_id, valid_from, price_eur, promo_eur)
  SELECT o.store_id, o.sku_id, :day::date, o.price_eur, o.promo_eur
    FROM obs o
    LEFT JOIN price_facts f
      ON f.store_id = o.store_id AND f.sku_id = o.sku_id AND f.valid_to IS NULL
   WHERE f.store_id IS NULL
  ON CONFLICT (store_id, sku_id, valid_from) DO NOTHING;

  recordIngestBatch(c, { source: "kzp_prices", table: "price_facts", … })
  TRUNCATE price_stage
COMMIT
```

Four invariants, each of which a naive implementation gets wrong:

- **Close before insert.** After step 1 a changed row has `valid_to` set, so step 2's `LEFT JOIN` on
  `valid_to IS NULL` finds nothing and opens the new run. Reverse the order and every changed price
  silently keeps its old value.
- **`ON CONFLICT DO NOTHING` makes replay idempotent.** Re-running day D: nothing is distinct, so no
  closes; the open run already exists, so no inserts. Safe.
- **Never load days out of order.** Assert `:day > (SELECT max(valid_from) FROM price_facts)` unless
  `--force-rebuild`. Backfill replays oldest-first. Out-of-order loading corrupts the step function
  irrecoverably.
- **No `last_seen` on `price_facts`.** The whole point. See design doc §3.2.

A gap in reporting means a run's `valid_to` lands on the day before the chain *next* reported, which
overstates the interval. That is correct-by-construction, not a bug: `price_chain_days` records that
the chain was silent, and every read masks accordingly. Document it at the top of the file.

`recordIngestBatch` runs **inside** the transaction (per `feedback_pg_changelog_required`), with a
stable natural key:

```ts
keyExpr: "md5(f.store_id || '|' || f.sku_id || '|' || f.valid_from)",
```

### 2.5 Modified: `scripts/prices/ingest.ts`

Keep the CLI surface. Swap `parseDay(zip, date)` → `loadDay(zip, date)`, and drop `buildPriceIndex()`
in favour of `buildPayloads()` (§4). `--build-only` becomes "rebuild payloads from PG". `--backfill`
replays `raw_data/prices/*.zip` in date order (the flag already exists, and per
`feedback_one_off_backfills` it stays out of the watcher).

### 2.6 `package.json`

```jsonc
"prices":              "tsx ./scripts/prices/ingest.ts",
"prices:ingest:cloud": "DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npm run prices",
"prices:catalog":      "NODE_OPTIONS=--max-old-space-size=4096 tsx ./scripts/prices/rebuild_catalog.ts",
"prices:payloads":     "tsx ./scripts/prices/build_payloads.ts",
"prices:slugs":        "tsx ./scripts/prices/export_slugs.ts",
```

`db:push` stays out of the daily path. It is a weekly DR snapshot.

### Gate — Phase 1

```bash
npm run prices -- --backfill --from 2026-01-02 --to 2026-07-08
```

- `SELECT count(*) FROM price_facts` ≈ **1.9M–2.5M** (seed + 188 days of change runs).
  Materially above ~5M means the delta logic is opening runs it should not.
- `SELECT count(*) FROM price_stores` = **2,649** ± reporting drift.
- Per-day inserts on the last 5 days land in the **25k–40k** band.
- Reconcile one golden day: rebuild `cells` for 2026-07-08 straight from `price_facts` and diff
  against `data/prices/_cache/daily/2026-07-08.json`. **Zero cell differences on `min` / `median` /
  `max` / `stores`.** This is the load-bearing check — it proves the fact table can reproduce the
  aggregate the site has been shipping.
- `recent_updates(1)` shows a `kzp_prices` row.

**Rollback:** `DROP TABLE price_facts, price_skus, price_stores, price_chains, price_chain_days,
price_stage CASCADE;`. Nothing else has changed; the JSON pipeline is untouched and still serving.

---

## 3. Phase 2 — canonical catalogue

Independent of phases 1 and 3. If the audit fails, ship them anyway and browse SKU-faithfully.

### 3.0 Audit of the proposed algorithm

The v1 spec was implemented and run against the full 2026-07-08 corpus (1,400,705 rows / 95,324
distinct names) **before** being written down. It has four defects. All numbers measured.

**What worked.** The Cyrillic-safe unit regex lifts size coverage from 64.0% → **79.9%** of distinct
names (61.3% → **77.8%** row-weighted). Percent-as-attribute correctly shatters the ВЕРЕЯ blob: one
59-chain group becomes **19 groups**, cleanly separated by fat content and volume
(`1000ml|p3` @57 chains, `1000ml|p3.7 ЧУДНО` @12, `1000ml|p1.5` @3, `2000ml|p3` @6). Word-order
invariance merges the Lavazza and Sayana spelling variants as intended. Output: **74,823 groups,
21.3% multi-chain.**

**Defect 1 — the "no size ⇒ no cross-chain merge" rule guts fresh produce.** 20.6% of groups have no
parseable size, and the rule demotes **2,811 multi-chain groups (9,235 chain-listings)** to
singletons — 17.6% of all cross-chain comparability. Inspecting them shows why: they are `БАНАНИ`,
`МОРКОВИ`, loose meat and cheese — **sold per kilogram, so they have no pack size and never will.**
The rule destroys comparability for exactly the politically salient staples the tool exists to cover.
It is right for *packaged* goods and wrong for *unit-priced* ones.

**Defect 2 — Roman-numeral quality classes are silently dropped, causing real false merges.**

```
[52 chains] "МОРКОВИ" · "МОРКОВИ ІІ" · "МОРКОВИ II"
[52 chains] "БАНАНИ"  · "БАНАНИ II"  · "БАНАНИ КГ"
```

`II` is 2 characters, so the `len >= 3` filter drops it. But Class I and Class II produce are
different goods at different prices. Worse, the corpus contains **both** Latin `II` (U+0049) and
Cyrillic `ІІ` (U+0406) for the same concept — a homoglyph collision that would split what the class
attribute should merge.

**Defect 3 — exact token-sort has a recall problem.** Blocking on `(cat, size)` and scoring pairwise
token Jaccard finds **5,248 pairs ≥ 0.70 that landed in different groups; 3,954 of them share no
chain**, i.e. are probably the same product listed by different retailers. Against 15,935 multi-chain
groups that is a ~25% under-merge surface.

```
J=0.83  "KLC.краве.бяло.сирене.в.саламура.1 кг"
        "НЕ KLC.краве.бяло.сирене.в.саламура.1кг"
J=0.83  "КРОАСАН 22 КАРАТА 55ГР КАКАОВ КРЕМ"
        "КРОАСАН 22 КАРАТА 55ГР КАКАОВ КРЕМ /SWEET+/"
```

Some are genuine splits (`СИРЕНЕ РОДОПЕЯ` vs `СИРЕНЕ САЛАМУРЕНО РОДОПЕЯ` may well be two products).
Under-merging is the *safe* failure — a missing comparison, not a wrong one — so this does not block
the phase. It sizes the review queue.

**Defect 4 — leading junk characters.** `"= ЧАЙ БИОПРОГРАМА ШИПКА"`, `"*Чай Биопрограма Мащерка"`,
`"НЕ KLC…"`. These merged correctly by luck (the junk tokenized away); strip them explicitly.

The `[53 chains]` tea groups and `[52 chains]` flour group flagged by the dropped-token detector were
inspected and are **correct merges** — the differing tokens were internal codes (`4241`, `16010`) and
size fragments already captured in `sizeKey`. The detector has a high false-positive rate; it is a
triage tool, not a verdict.

### 3.1 New: `scripts/prices/lib/canon.ts` (revised)

```ts
export interface Canon {
  canonKey: string;
  brand: string | null;
  netQty: number | null;                 // normalized to g | ml | pc
  netUnit: "g" | "ml" | "pc" | null;
  unitPriced: boolean;                   // per-kg loose good; size legitimately absent
  attrs: Record<string, string>;         // { fat: "3", abv: "40", class: "II", count: "6" }
  title: string;
  confidence: number;                    // 0..100
}
export const canonicalize = (rawName: string, catId: number): Canon;
```

Seven rules. The first three were validated by the audit; the last four are its consequences.

1. **Cyrillic-safe unit matching.** `/(\d+(?:[.,]\d+)?)\s*(КГ|ГР|Г|МЛ|Л|БР|KG|G|ML|L)(?![\p{L}])/giu`
   — `\b` is ASCII-word-based, so `/Л\b/u` never matches `1Л`. Normalize `КГ→g ×1000`, `Л→ml ×1000`,
   so `1Л ≡ 1000МЛ` and `0.5КГ ≡ 500Г`. Accept `,` and `.` decimals.

2. **Percentages are identity, not noise.** Capture every `\d+([.,]\d+)?%` into `attrs.fat` /
   `attrs.abv` and include them in `canonKey`, sorted. This is what fixes ВЕРЕЯ.

3. **Word-order invariance.** Uppercase, punctuation→space, `len >= 3`, stopword
   (`ЗА И С В НА ОТ КУТИЯ ВАКУУМ ПАКЕТ ОПАК БУТИЛКА`), drop pure numerals (kills internal codes like
   the `2755` in `ПЮРЕ ПЛАЗМОН 2755 ЗЕЛЕНЧУЦИ С ПИЛЕ 7М+ 200ГР`), then **sort**.

4. **Unicode normalization + homoglyph folding.** `NFKC`, then fold the Cyrillic/Latin lookalikes
   (`А В Е К М Н О Р С Т Х І` ↔ `A B E K M H O P C T X I`) to a single codepoint before tokenizing.
   Without this, `МОРКОВИ ІІ` and `МОРКОВИ II` are different products. Fold to **Cyrillic**, since the
   corpus is overwhelmingly Cyrillic and folding the other way mangles genuine Latin brands (`KLC`,
   `SWEET+`, `ADVANCE WHITE`).

5. **Quality class is an attribute, not a stopword.** Extract a trailing standalone `I` / `II` / `ІІ`
   / `1-ва` / `2-ра` into `attrs.class` **before** the `len >= 3` filter runs. `БАНАНИ` and
   `БАНАНИ II` must not merge.

6. **Leading junk stripped.** `^[=*\-–—+.,\s]+` and a leading standalone `НЕ ` before tokenizing.

7. **Multipacks.** `6х1.5Л` — `parseSize` currently takes the first `qty+unit` match and would read
   `1.5Л`. 12,254 rows/day match `/(\d+)\s*[xх*]\s*(\d+…)(UNIT)/`. Detect it, set
   `netQty = n × qty` and `attrs.count = n`, so a 6-pack never compares against a single bottle. The
   multiplier can be Latin `x` or Cyrillic `х` — rule 4 handles that.

```
canonKey = `${catId}|${netQty}${netUnit}|${sortedTokens.join("_")}|${attrsKey}`
```

`confidence` = 40 (size parsed **or** `unitPriced`) + 25 (brand identified) + 20 (≥3 shared tokens
with the group's modal name) + 15 (cat agreement across members).

**The merge rule, corrected:**

> A group may span more than one chain **iff** it has a parsed `netQty` **or** its category is
> `unitPriced`. Otherwise it is demoted to per-chain singletons.

`unitPriced` is a new boolean on each of the 101 groups in `scripts/prices/products.json` — a
one-time hand annotation of which KZP groups are sold by weight (fruit, vegetables, loose meat, loose
cheese). For those, `netUnit` is implicitly `kg` and prices are already per-kg in the feed. This
preserves the ВЕРЕЯ protection for packaged goods while restoring comparability to the 2,811 produce
groups Defect 1 would have destroyed.

`slug` via the existing `slugify` in `src/lib/slug.ts` (do not write a fourth one — the repo already
has `src/lib/slug.ts`, `scripts/officials/shared.ts`, `scripts/declarations/build_company_index.ts`).

### 3.2 New: `data/prices/product_overrides.json` (committed)

```jsonc
{ "merge": [["canonKeyA", "canonKeyB"]],   // force-join two groups
  "split": ["canonKeyC"],                  // force-split back to per-chain SKUs
  "brand": { "canonKeyD": "Верея" } }
```

Human review beats a better regex — precedent: the TR namesake overrides
(`project_procurement_namesake_fix`). Applied last, after clustering. This is where the ~3,954
near-miss pairs from Defect 3 get resolved, a handful at a time, forever. **Never auto-merge on a
similarity threshold** — under-merging costs a missing comparison; over-merging publishes a false
price claim under a national transparency brand.

### 3.3 New: `scripts/prices/rebuild_catalog.ts`

Full recompute over `price_skus` (~150k rows — seconds). Runs after each daily ingest.

```
canonicalize every sku → group by canonKey
apply overrides
demote groups where (netQty IS NULL AND NOT unitPriced) AND chain_count > 1 → per-chain singletons
upsert price_products (canon_key unique)
UPDATE price_skus SET product_id = …
refresh chain_count, sku_count, confidence
emit review queue → build/prices/merge_candidates.json   (§3.4 Layer 5)
```

Never `TRUNCATE price_products` — `product_id` is a foreign key and `slug` is a public URL. Upsert on
`canon_key`; retire vanished products with a `last_seen` guard rather than deleting them, so old
`/product/:slug` links keep resolving.

### 3.4 Tests

Five layers. Layers 1–3 run in CI on every commit; layer 4 runs against the real corpus in
`db:verify` style; layer 5 is a human loop.

#### Layer 1 — unit tests: `scripts/prices/tests/canon.test.ts`

Pure-function tests on `canonicalize()`. No DB, no corpus. Table-driven.

```ts
// size parsing
["ПРЯСНО МЛЯКО ВЕРЕЯ 1Л 3%",        { netQty: 1000, netUnit: "ml" }],  // Cyrillic Л — the \b bug
["СИРЕНЕ САЯНА 500Г",               { netQty: 500,  netUnit: "g"  }],  // Cyrillic Г
["БРАШНО 1КГ",                      { netQty: 1000, netUnit: "g"  }],  // kg → g
["СОК 0,5Л",                        { netQty: 500,  netUnit: "ml" }],  // comma decimal
["ВОДА 1.5 Л.",                     { netQty: 1500, netUnit: "ml" }],  // space + trailing dot
["ВОДА 6х1.5Л",     { netQty: 9000, netUnit: "ml", attrs: { count: "6" } }],  // Cyrillic х multipack
["ВОДА 6x1.5L",     { netQty: 9000, netUnit: "ml", attrs: { count: "6" } }],  // Latin x, Latin L
["ЛЕПИЛО 1КГМ",                     { netQty: null }],                 // (?![\p{L}]) guard holds

// percent = identity
["МЛЯКО ВЕРЕЯ 1Л 3%",   k => k !== canonicalize("МЛЯКО ВЕРЕЯ 1Л 2%", 6).canonKey],
["РАКИЯ 700МЛ 40%",     { attrs: { abv: "40" } }],

// quality class = identity (Defect 2)
["БАНАНИ II",           { attrs: { class: "II" } }],
["БАНАНИ ІІ",           { attrs: { class: "II" } }],   // Cyrillic І folds to Latin II
["БАНАНИ",              { attrs: {} }],

// junk stripping (Defect 4)
["= ЧАЙ БИОПРОГРАМА ШИПКА",  sameKeyAs("ЧАЙ БИОПРОГРАМА ШИПКА")],
["*Чай Биопрограма Мащерка", sameKeyAs("ЧАЙ БИОПРОГРАМА МАЩЕРКА")],
["НЕ KLC.краве.сирене.1кг",  sameKeyAs("KLC.краве.сирене.1 кг")],

// internal codes dropped
["ПЮРЕ ПЛАЗМОН 2755 ЗЕЛЕНЧУЦИ С ПИЛЕ 7М+ 200ГР",
   sameKeyAs("ПЛАЗМОН ПЮРЕ 200ГР ЗЕЛЕНЧУЦИ С ПИЛЕ")],
```

#### Layer 2 — property tests: `scripts/prices/tests/canon.props.test.ts`

Invariants over 1,000 names sampled from the corpus (committed as a fixture, so CI needs no ZIPs):

| Property | Assertion |
| --- | --- |
| **Permutation invariance** | shuffling the whitespace-separated words of a name yields the same `canonKey` |
| **Unit equivalence** | `1Л ≡ 1000МЛ`, `0.5КГ ≡ 500Г`, `1.5Л ≡ 1500МЛ` |
| **Attr discrimination** | changing any `%` value changes the key |
| **Class discrimination** | appending ` II` changes the key |
| **Multipack discrimination** | `6х1.5Л` ≠ `1.5Л` |
| **Case/homoglyph folding** | Latin↔Cyrillic lookalike substitution does not change the key |
| **Determinism** | `canonicalize(n, c)` is pure; same input → same key across 100 runs |
| **Idempotence** | `canonicalize(group.title).canonKey === group.canonKey` |
| **Slug injectivity** | no two distinct `canonKey`s produce the same `slug` |

#### Layer 3 — labelled gold set: `scripts/prices/tests/__gold__/pairs.jsonl`

The only way to measure precision and recall. ~400 hand-labelled name pairs, committed, stratified:

- **200 positive-side pairs** sampled from pairs the algorithm *merged* → measures **precision**
- **200 negative-side pairs** sampled from the 3,954 high-Jaccard cross-chain pairs it *split* →
  measures **recall**

```jsonl
{"a":"КАФЕ ЛАВАЦА 1КГ КУАЛИТА РОСА ЗЪРНА","b":"КАФЕ ЛАВАЦА ЗЪРНА КУАЛИТА РОСА 1кг","cat":71,"same":true}
{"a":"БАНАНИ","b":"БАНАНИ II","cat":18,"same":false}
{"a":"ПРЯСНО МЛЯКО ВЕРЕЯ 1Л 3%","b":"ПРЯСНО МЛЯКО ВЕРЕЯ 1Л 1,5%","cat":6,"same":false}
{"a":"СИРЕНЕ КРАВЕ РОДОПЕЯ 1КГ КУТИЯ","b":"СИРЕНЕ КРАВЕ САЛАМУРЕНО РОДОПЕЯ 1КГ КУТИЯ","cat":9,"same":false}
```

**Gates, asymmetric by design:**

| Metric | Threshold | Why |
| --- | --- | --- |
| **Precision** (merged pairs that really are the same) | **≥ 0.99** | A false merge publishes a wrong price comparison under a transparency brand. Near-zero tolerance. |
| **Recall** (same-product pairs actually merged) | ≥ 0.75 | A false split is a missing comparison. Annoying, not damaging. Grows over time via the overrides file. |

Regenerate the negative-side sample whenever the algorithm changes, or the gold set silently becomes
a test of yesterday's bugs.

#### Layer 4 — corpus assertions: `scripts/prices/tests/catalog.data.test.ts`

Runs against the loaded database (`DB_VERIFY=1`, alongside `npm run db:verify`). These catch a
regression on real data, not fixtures.

```ts
// structural invariants — must hold for every group
"no group mixes two distinct attrs values"              → 0 rows
"no group spans >1 chain without netQty or unitPriced"  → 0 rows   // the corrected merge rule
"every price_skus row has product_id OR is a demoted singleton"
"slug is unique across price_products"
"chain_count = COUNT(DISTINCT eik) over member skus"

// distribution guards — a silent algorithm change trips these
"canonical groups"            → 60_000 .. 90_000       // measured 74_823
"multi-chain share"           → 0.15 .. 0.30           // measured 0.213
"size-parse coverage (rows)"  → >= 0.75                // measured 0.778
"max chain_count"             → <= 210                 // a group can't exceed the chain count

// named regressions, each traced to a real defect found in the audit
"ВЕРЕЯ ПРЯСНО МЛЯКО splits by fat% and volume"  → >= 15 groups, and the 3% 1L group
                                                   contains no 1.5% or 2L member
"БАНАНИ and БАНАНИ II are different products"
"МОРКОВИ ІІ (Cyrillic) and МОРКОВИ II (Latin) are the SAME product"
"loose produce (unitPriced) still merges across chains" → БАНАНИ chain_count > 10
"6х1.5Л water ≠ 1.5Л water"
```

The distribution guards are the cheapest possible early warning. If a stopword edit quietly collapses
the group count from 74k to 40k, nothing else in the suite notices — but a false merge just shipped
to 15,000 product pages.

#### Layer 5 — the human loop: `scripts/prices/tests/audit_report.ts`

`npm run prices:catalog -- --audit` writes `build/prices/merge_candidates.json` and prints a report:

- **New multi-chain groups since the last run**, ordered by `chain_count` descending. Anything with
  `chain_count >= 20` is high-visibility and gets eyeballed before it ships.
- **Groups whose members disagree on a dropped token** — the Defect-2 detector. High false-positive
  rate (5,332 of 10,070 multi-name groups, mostly redundant size fragments already captured in
  `sizeKey`). Treat as triage; suppress tokens that normalize into `sizeKey` or `attrs` so the signal
  is not buried.
- **High-Jaccard cross-chain pairs that did not merge** — the Defect-3 review queue, ~3,954 pairs.
  Each resolves into `product_overrides.json` or gets dismissed.

### Gate — Phase 2

- Layers 1–4 green.
- **Precision ≥ 0.99 on the gold set.** Non-negotiable. Below that, ship the SKU-faithful browser
  (Phase 4 minus the cross-chain ladder) and keep iterating on identity.
- Recall ≥ 0.75.
- **Zero false merges among the top 500 groups by `chain_count`**, audited by hand once. These are
  the products that will appear on the most-visited pages.
- Every named regression in Layer 4 passes.

---

## 4. Phase 3 — payloads + serving

### 4.1 New: `scripts/prices/build_payloads.ts`

`scripts/prices/build_index.ts` is 776 lines and holds the Jevons index of per-settlement
median-of-minimum prices, the 12-item common basket, the outlier guard, and the peer/rank logic. That
**maths is correct and battle-tested — port it verbatim**, changing only its input (SQL over
`price_facts` instead of 188 cached JSON grids) and its output (`price_payloads` rows instead of
files). Resist improving it in the same commit as the migration; the parity harness cannot tell an
improvement from a regression.

`price_payloads (kind, key) → jsonb`, PK `(kind, key)`, mirroring `agri_payloads`
(`scripts/db/schema/pg/046_agri_subsidies.sql:65-70`). Kinds: `overview`, `oblast:<code>`,
`place:<ekatte>`, `chains`, `chains:<obshtina>`, `ranking`, `dict`.

Per `reference_pg_payload_determinism`: `ROUND` every sum, rounded sort keys with `eik` tiebreaks,
`COLLATE "C"` on string `MIN`s — otherwise local and Cloud SQL disagree byte-for-byte.

**Note for §9.1 of the design doc:** the shipped index is an *unweighted* Jevons index. The
perceived-vs-measured tile needs an **HICP-weighted** variant alongside it. Build both, label both,
and never let one silently stand in for the other.

### 4.2 Modified: `functions/db_routes.js`

Routes following the `agri-payload` shape at `db_routes.js:984-993`, all wrapped in
`missingMigrationEmpty` so a functions-before-migration deploy degrades to an empty tile, not a 500:

| Route | Query |
| --- | --- |
| `price-payload` | `SELECT payload FROM price_payloads WHERE kind=$1 AND key=$2` |
| `price-product` | product + cross-chain current ladder (via `price_facts_open`) |
| `price-history` | per-product daily series, `?from=&to=` |
| `price-search` | trigram search over `price_products.title` |
| `price-movers` | biggest risers/fallers, `?window=7d|30d|euro` |
| `price-verdict` | since-euro four-bucket counts (design doc §9.1) |

### 4.3 Modified: `functions/db_table.js`

One `REGISTRY.price_products` entry, modelled on `agri_subsidies` (`db_table.js:327-369`):
`title` (`search: true` — backed by `price_products_trgm`), `cat_id` (`filter: "in"`), `brand`,
`chain_count`, `net_qty`, `current_min_eur` (sort), `pct_since_euro` (sort).
`select[0]` must be `product_id` — the stable paging tiebreak.

Only mark a column `search: true` if a trgm index backs it. `agri_subsidies.scheme_desc` is
deliberately *not* searchable for exactly this reason; the comment there says so.

### 4.4 Modified: `src/data/prices/usePrices.tsx`

The six hooks (`usePriceIndex`, `usePriceDict`, `usePriceRanking`, `useSettlementPrices`,
`useNationalChains`, `useMuniChains`) swap `dataUrl()` for a new
`src/data/prices/fetchPricePayload.ts`, cloned from `src/data/agri/fetchAgriPayload.ts`. Return types
are unchanged, so **not one tile component is touched in this phase**. `staleTime: Infinity` stays.

### Gate — Phase 3

- Parity harness (Phase 0) green: PG payloads reproduce `index.json`, `ranking.json`, `chains.json`
  to the last decimal. The 188-point national series, all 433 ranking places, all 106 chains.
- `EXPLAIN ANALYZE` every route on the worst case — fresh milk, 57 chains, thousands of stores —
  under **200ms**. Per `feedback_db_query_perf` this is part of "done", not a follow-up. If
  `price-history` seq-scans, the `(sku_id, valid_from DESC)` index is missing or unused.
- The app runs with `data/prices/*.json` renamed away.

---

## 5. Phase 4 — the dashboards

Design doc §9 is the blueprint; this is the file list. Build order follows §9.7 — items 1, 4, 5 and
11 depend only on Phase 1, so **ship the editorial payload before the browser if the catalogue slips.**

### 5.1 New screens and routes

| Route | Screen |
| --- | --- |
| `/consumption/products` | `src/screens/consumption/ProductsBrowserScreen.tsx` |
| `/product/:slug` | `src/screens/product/ProductScreen.tsx` |
| `/product/:slug/:ekatte` | per-store prices in one settlement |

`ProductsBrowserScreen` is a `DbDataTable` over `price_products` — the registry engine already does
backend pagination, sort, filter and aggregation, so this is a config object plus a column renderer
(`reference_db_datatable`: add a REGISTRY entry, not a new endpoint).

### 5.2 New tiles

| Tile | Tier | Design doc |
| --- | --- | --- |
| `EuroVerdictTile` — four-bucket since-euro classification | country | §9.1.2 |
| `PerceivedVsMeasuredTile` — КЗП basket vs HICP, weighted | country | §9.1.3 |
| `ProductSearchTile` — trgm search, above the fold | country | §9.1.4 |
| `BiggestMoversTile` — 7d/30d/euro toggles, product grain | country | §9.1.5 |
| `CategoryGridTile` — 14 cards, shared with brands/chains | country | §9.1.6 |
| `PlaceComparatorTile` — Numbeo-style two-place diff | locality | §9.2.2 |
| `WhereToShopTile` — cheapest chain here | locality | §9.2.3 |
| `LocalAnomaliesTile` — chain's local vs national price | locality | §9.2.4 |
| `MyBasketTile` — personal basket, localStorage + URL | my-area | §9.3.1 |
| `MyInflationTile` — personal inflation from real prices | my-area | §9.3.2 |
| `ChainLadderTile` — cheapest-first, "спести X €", €/kg | product | §9.4 |
| `PriceHistoryChart` — camelcamelcamel pattern | product | §9.4 |
| `PriceVerdictBadge` — Low / Typical / High | product | §9.4 |
| `MatchQualityNote` — "сравнено в N вериги" + report link | product | §9.4 |

`PriceHistoryChart` must **mask days where `price_chain_days` shows the chain silent** — a gap is a
gap, never a flat line. This is the UI-side consequence of the §3.2 storage decision, and it is the
single most likely thing to be gotten wrong.

`ChainLadderTile` renders only when `confidence >= threshold AND chain_count > 1`; otherwise a
single-chain notice. `MatchQualityNote` is what keeps a name-matched catalogue honest.

### 5.3 Cleanups worth doing here

- `MyAreaPricesTile.tsx:44` — `FEATURED = [1, 6, 31, 42, 9, 16]` is six hardcoded product-group ids.
  Replace with a real "cheapest / most-moved products in this settlement" query.
- `ConsumptionAffordabilityTile.tsx:40-42` says in a comment that its Sofia-collapse and PDV-00-skip
  rules are duplicated in `ai/tools/prices.ts::basketAffordability`. Extract once, import twice. While
  there, switch the denominator from Eurostat GDP per capita to **oblast wage** (design doc §9.2.5).

### 5.4 Conventions

Per design doc §9.6: no tabs, no native `<select>`, homepage shell (no `max-w-5xl`), `${num} €` in BG
/ `€${num}` in EN, natural BG copy, no emojis. Read the `dataviz` skill before writing chart code.
New strings in `src/locales/{bg,en}/translation.json`.

### Gate — Phase 4

- `preview_*` verification of `/product/<top-slug>` in light and dark, mobile and desktop.
- A product with a reporting gap renders a broken line, not a flat one.
- A single-chain product renders no ladder and no cross-chain claim.
- The since-euro verdict reconciles against a hand count on one category.

---

## 6. Phase 5 — retire the JSON

Only after phases 1–4 are green.

### 6.1 `ai/tools/prices.ts` (33KB, 6 tools)

`priceIndex`, `settlementPrices`, `cheapestChains`, `priceRanking`, `basketAffordability`,
`basketVsInflation` move from `fetchData` to the payload route. Registered at
`ai/tools/registry.ts:3102-3264`.

The real prize: `resolveProduct` + `PRODUCT_ALIASES` is ~34 hand-written regexes mapping phrases to
the 101 group ids (`prices.ts:156-209`). Trigram search over 74k real products replaces it. Add
`productPrice(name, place?)` and `productHistory(name)`, delete the alias table, and update
`detectPriceProduct` in `ai/orchestrator/router.ts`.

### 6.2 `scripts/data_map/model.ts`

`ds:prices` (`model.ts:940-951`) repoints from `data/prices/` to Postgres. Add an `f:products`
feature node at `/consumption/products` and the `ds:prices → f:products` edge. **The prebuild fails on
an unplaced source** (`project_data_map_diagram`), so this is not optional.

### 6.3 Deletions

```
scripts/prices/build_index.ts        (776 lines — maths ported in Phase 3)
scripts/prices/parse.ts              (superseded by load_day.ts)
data/prices/{index,ranking,chains,dict}.json
data/prices/settlement/*.json        (243 files)
data/prices/chains/*.json            (159 files)
data/prices/_cache/                  (486MB — redundant with raw_data/prices/*.zip)
```

`scripts/watch/sources/kzp_prices.ts` is unchanged: it fingerprints the advertised ZIP date and knows
nothing about storage.

### 6.4 The one JSON that survives

`/product/:slug` needs a slug list at prerender and sitemap time, and neither `scripts/prerender/` nor
`scripts/sitemap/` has ever opened a database connection. Rather than give both a DB dependency,
`scripts/prices/export_slugs.ts` writes a **gitignored build artifact**:

```
build/prices/product_slugs.json   →  [{ slug, title, catId, chainCount }]
```

consumed by `scripts/prerender/routes.ts` (dynamic routes) and `scripts/sitemap/route_defs.ts`. A
build input, not a serving artifact — it never ships to the bucket.

**Prerender only the top ~2,000–5,000 products** by `chain_count`
(`project_firebase_deploy_ceiling`: a 453k-file `dist` fails to deploy; we sit at ~84k). Per
`feedback_static_seo`, an un-prerendered route earns ~0 impressions, so choosing that 2–5k is an
editorial decision about which long-tail queries we intend to win. The rest are SPA-only with
`canonical` tags.

### Gate — Phase 5

`npm run build` clean · prerender + OG green · `npx eslint . --fix` ·
AI chat answers "колко струва олиото в Пловдив" and "как се е променила цената на кафе Лаваца".

---

## 7. Deploy runbook

Order matters. `missingMigrationEmpty` masks a missing table as an empty tile, so a functions-first
deploy looks *fine* while serving nothing — the same trap agri and NZOK hit.

```bash
# 1. schema to Cloud SQL, via the proxy on :5434
npx tsx scripts/db/apply_functions.ts 048_prices.sql

# 2. backfill + catalogue + payloads, straight into Cloud SQL (no pg_dump round-trip)
npm run prices:ingest:cloud -- --backfill --from 2026-01-02 --to <yesterday>
DATABASE_URL=…:5434/electionsbg npm run prices:catalog
DATABASE_URL=…:5434/electionsbg npm run prices:payloads

# 3. only now
npm run deploy:functions

# 4. weekly DR snapshot — NOT part of the daily path
npm run db:push:cloud
```

Daily thereafter (watcher → `update-prices` skill): `prices:ingest:cloud` → `prices:catalog` →
`prices:payloads`. Roughly 30k fact rows and ~2MB of payload jsonb per day. No `db:push`, no
`bucket:sync`, no multi-GB upload.

`gsutil -m` is broken on macOS (`reference_gsutil_macos_multiprocessing`) — irrelevant here, because
after this migration prices never touch the bucket again.

---

## 8. Risk register

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Canonical clustering produces a visible false merge | **High** | Gold-set **precision ≥ 0.99** gate (§3.4 L3); zero false merges in top-500 by `chain_count`; no cross-chain merge without `netQty` or `unitPriced`; homoglyph folding + class-as-attr (Defects 2, 4); overrides file; never auto-merge on a similarity threshold; report-a-match link; `confidence` gate on the ladder |
| Clustering under-merges (missing comparisons) | **Certain** | Measured: 3,954 high-Jaccard cross-chain pairs unmerged. Recall gate ≥ 0.75; drained over time via the `--audit` review queue into `product_overrides.json`. A false split is the *safe* failure. |
| `unitPriced` annotation is wrong for a category | Medium | It gates cross-chain merging for loose produce. Hand-annotate all 101 groups once; Layer-4 assertion `БАНАНИ chain_count > 10` catches a regression |
| Ported Jevons index silently drifts | Medium | Phase 0 golden files + parity test; port verbatim, improve later |
| Out-of-order backfill corrupts the step function | Medium | Assert `day > max(valid_from)`; replay oldest-first; `ON CONFLICT DO NOTHING` |
| `price_facts` bloats `db:push` dumps | Medium | Exclude from routine snapshot; DR = replay the 4.1GB of ZIPs, which are authoritative |
| 74k product pages blow the Firebase file ceiling | Medium | Prerender top 2–5k only |
| КЗП mandate lapses **8 Aug 2026** | **High** | Step function degrades gracefully (open runs stop being superseded). The since-euro tracker needs an explicit "data ends here" affordance, not a flatlining chart. Build it in Phase 4, not after. |
| Free-text store labels have no coordinates | Certain | Geocoding is Phase 6. Do not promise "cheapest near me" until it exists. |
| Publishing a chain-lockstep claim | Medium | Competition-law-adjacent. Article with caveats and methodology, never an unqualified dashboard tile. |

## 9. Deferred (Phase 6)

The §9.5 differentiators — rounding analysis (the euro signature), shrinkflation detection, price
dispersion, promo share, chain lockstep. Geocoding the 2,649 store labels → store map and "cheapest
near me". The basket optimizer. Price alerts. Public API + daily ZIP export, the `cijene.dev` play:
no BG, RO, ES or GR tool offers one.
