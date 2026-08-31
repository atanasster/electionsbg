# /consumption/products — the registry browse pattern

**Status:** SHIPPED 2026-08-31 · **Owner:** —

Bring `/consumption/products` onto the shared registry-browser shape that `/persons` and
`/companies` adopted in `docs/plans/companies-search-first-v1.md` — a committed-term hero
search field, a labelled filter bar that lives OUTSIDE the table, removable active-filter
chips, and every narrowing in the URL.

## 0. What is wrong today

`ProductsBrowserScreen.tsx` is the pre-registry shape:

- **The search box is the table's accessory.** `DbDataTable`'s own toolbar input, uncontrolled,
  debounced at 250 ms per keystroke, and **not in the URL at all** — so a search cannot be
  shared, bookmarked, linked from an article, or recovered with Back.
- **The one filter is `useState`.** The „Всички групи" picker (`pid`) is component state, so the
  same URL renders a different table depending on what the reader clicked, it is lost on
  refresh, and no cross-link can open the page at a group.
- **Nothing on the page names what is applied.** A reader who has narrowed to a group and typed
  a term sees only a dropdown showing its own value; there is no chip row and no „Изчисти".
- **Three columns the reader can see are not filterable.** „Вериги", „От еврото" and the
  net-unit behind the title are all filter-capable server-side (`chain_count` range,
  `pct_since_euro` range, `net_unit` in) and none is offered.

## 1. Decision: the table stays visible — no landing

`/persons` and `/companies` render NO table until something is searched or filtered. That is
not carried over here, deliberately:

- their defaults were a list nobody asked for (137,461 people by prominence; €2.43bn СОФАРМА
  ТРЕЙДИНГ and five more, unchanged on every arrival). This page's default sort —
  `chain_count desc` — is **the most widely stocked products in the КЗП basket**, which is a
  real answer and the top of the monitoring corpus;
- the corpus is 48k rows, not 1.02M, and every column renders a value for every row: there is
  no `has_signal` floor and no „phone book" tail this page has nothing to say about;
- the prerendered body (`scripts/prerender/routes.ts`) and the sitemap `<loc>` both describe a
  catalogue, so a landing would need a copy change on two more surfaces for no reader gain.

Cost, stated rather than hidden: `RegistrySearchField` renders its example chips only on
`!value && !tableVisible`, so this page gets none. The placeholder carries the examples
instead („търси продукт, напр. мляко Верея, олио…"), which is where they already were.

## 2. The corpus, measured

Local Postgres, 2026-08-31, `price_products` at 124,120 rows of which **46,682 are browsable**
(`chain_count >= 1` — the retired-product floor the screen already applies; live is 48,427 on a
fresher corpus).

| dimension | shape |
| --------- | ----- |
| `pid` | **101** groups, the КЗП basket. Labels from `usePriceDict`, counts from the facet. |
| `net_unit` | `g` 19,686 · `ml` 12,784 · **`''` 11,105** · `pc` 3,107 |
| `chain_count` | 1 → 40,457 (86.7%) · **≥2 → 6,225** · ≥3 → 1,674 · ≥5 → 417 |
| `pct_since_euro` | up (≥ +0.1%) 8,572 · down (≤ −0.1%) 8,908 · flat 22,784 · NULL („нов") 6,418 |
| `unit_priced` | 2,590 rows across **30 of the 101 groups**, uniform per `pid` (0 mixed) |
| `brand` | **NULL on every row.** No brand filter, no brand facet. |
| `confidence` | 15 / 35 / 55 / 75 — an internal canon-grouping score. Not offered: see §4. |

## 3. The controls

**Selects** (facet-counted where the facet answers the same column the filter targets):

1. **Група** — `?group`, `pid` in. Labels from `usePriceDict.products[lang]`, counts from the
   `pid` facet. Replaces the `useState` picker.
2. **Мерна единица** — `?unit`, `net_unit` in. ⚠️ The **empty-string bucket (11,105 rows) is
   excluded from the picker**: Radix refuses an empty `SelectItem` value, and „no unit" here
   means „the net quantity did not parse", not a category a reader would pick. Same guard as
   `/companies`' `oblast_name <> ''`.
3. **Промяна от еврото** — `?trend`, `pct_since_euro` range. `up` = `[0.1, 100]`,
   `down` = `[-100, -0.1]`.
   ⚠️ **BOTH bounds, always.** The outer one is `EURO_PCT_ARTIFACT` (`usePrices.tsx`): a value
   past ±100% is a data artifact that `euroPctSafe` renders as „—", so a one-sided
   `min: 0.1` would return rows under a „поскъпнали" chip whose own cell says nothing at all.
   The inner one is the cell's own colour threshold (`v > 0.1` red, `v < -0.1` green), so the
   filter and the rendering cannot disagree about which rows are „flat".

**Toggles:**

4. **„в поне 2 вериги"** — `?multi=1`, `chain_count min 2`. **6,225 products.** This is the
   set for which „най-ниска цена" is a cross-chain COMPARISON rather than the only price
   observed; 86.7% of the catalogue is a single chain's own SKU.
5. **„на килограм (насипни)"** — `?loose=1`, `unit_priced` eq true. 2,590 rows. Uniform per
   `pid`, so it is expressible through the group picker in 30 clicks — which is exactly why it
   is worth one.

## 4. What is deliberately NOT offered

- **`brand`** — NULL on all 124,120 rows. A picker over it would be empty and a text filter
  would match nothing.
- **`confidence`** — the canon-grouping score (15/35/55/75) that gates the cross-chain ladder.
  It is an internal quality signal whose four values mean nothing to a reader without a
  paragraph, and „надеждност 35" beside a price reads as a claim about the PRICE. The
  „в поне 2 вериги" toggle is the reader-facing version of the same concern.
- **`current_min_eur` / `net_qty` range boxes** — a min/max pair over a price is a control whose
  basis („най-ниска цена, национално, към последния зареден ден") does not fit on it.
- **„нови след еврото"** (`pct_since_euro IS NULL`, 6,418 rows) — the engine's `range` filter
  cannot express IS NULL, and there is no null-filter mode. Left out rather than faked.

## 5. Files

| file | what |
| ---- | ---- |
| `src/data/prices/useUrlProductFilters.ts` | URL-backed, every value validated on read |
| `src/data/prices/useProductFacets.ts` | `useRegistryFacets("price_products", …)` |
| `src/screens/consumption/productsBrowseConstants.ts` | label sets + id prefix + the unit/trend label maps |
| `src/screens/consumption/ProductsSearchField.tsx` | `RegistrySearchField` + this page's strings |
| `src/screens/consumption/ProductsFilterBar.tsx` | `RegistryFilterBar` + this page's strings |
| `src/screens/consumption/ProductsActiveFilters.tsx` | `RegistryActiveFilters` + this page's strings |
| `src/screens/consumption/ProductsBrowserScreen.tsx` | rewired |
| `src/data/prices/usePrices.tsx` | `EURO_PCT_FLAT_BAND` — see §6 |
| `src/screens/consumption/productColumns.tsx` | reads that band instead of its own literal |
| `src/locales/{bg,en}/translation.json` | 26 new keys, in BOTH corpora |

## 6. Three things the build changed from the plan above

- **`EURO_PCT_FLAT_BAND` is now a SHARED constant** in `usePrices.tsx`, read by the filter's
  inner range bound AND by the cell's red/green threshold. The plan proposed matching literals;
  matching literals drift, and the symptom would be a grey `+0.05%` row inside a „поскъпнали"
  view — arithmetically defensible and, to a reader, the wrong rows.
- **Every facet spec carries the retired-product floor.** `useRegistryFacets` sends only
  `filters` — it has no `fixedFilters` channel — so an unfloored `pid` facet counts all 124,120
  rows while the table shows 46,682, and „Мляко (2 412)" would promise 2.7× what a click
  returns. With the floor folded in, the facet's buckets sum to **46,682**, exactly the table's
  own total (verified against the live route).
- **The group picker keeps `products.json`'s own order, never alphabetical.** That file is
  ordered by `id`, which runs in `cat` order — bread, dairy, fats, … and the ATC medicine
  groups last — so the list reads as the КЗП basket's structure. Sorted by label it opened on
  „(A02) Лекарства за…" with хляб and мляко below the fold. Shipped alphabetical for one commit
  and caught in the browser.

## 7. Gates

- `src/data/prices/useUrlProductFilters.test.ts` (24) — every param validated on read; the
  `?trend` range asserted against the two imported constants rather than against literals; the
  chip contract driven from `PRODUCT_NARROWING_PARAMS`; `clearFilters` driven from
  `PRODUCT_URL_PARAMS` (a hand-written fixture makes that test vacuous in the one case it
  exists for) and asserted to PRESERVE `?area` and `?elections`; `?q` written through the RAW
  writer so the „all" sentinel cannot erase a term a reader typed.
- `src/screens/consumption/ProductsFilterBar.test.tsx` (11) — the wrapper wiring, with `t`
  echoing the KEY, because most fallbacks here are byte-identical to their /persons and
  /companies twins and a rendered assertion cannot tell the three label sets apart; plus that
  every unit and trend the URL accepts has a label and nothing extra has one.

## 8. Verified in the browser (dev server, `/api/db` proxied to prod)

| check | result |
| ----- | ------ |
| default view | 46 682 реда, `chain_count desc` |
| `?group=6` | chip „Група: Прясно мляко от 2% до 3,6% 1 л", **342 реда** — equals the facet's own bucket |
| `?trend=up` | **8 572 реда**, every visible row red — equals `pct_since_euro BETWEEN 0.1 AND 100` in Postgres |
| `?trend=up&multi=1` | **1 429 реда** — equals the composed predicate in Postgres |
| typing without submitting | table unchanged, „Натиснете „Търси“, за да видите резултатите." |
| submit | `?q=` written once, results follow |
| `?q=олио` deep link | box seeded, 181 реда, live region reads „Намерени са 181 продукта." |
| „Изчисти филтрите" | every chip, the URL and the un-submitted draft in the box all cleared |

⚠️ Enter does not submit **in the browser-automation pane** — a synthetic `Return` there does
not trigger implicit form submission. `form.requestSubmit()` on the same form writes `?q`
correctly, and the control is a real `<form>` with a `type="submit"` button, so Enter works for
a human. Do not "fix" this.

## 9. Follow-up: the search box could not see шльокавица (fixed)

Reported after §8: typing `kafe` returned „Няма резултати".

**Cause.** `price_products.title` is Cyrillic and had only a raw trigram index, and the
registry entry marked it `search: true` with no `searchCol`. So the engine emitted a RAW
substring match. Every other registry resource that searches a Bulgarian name column
(`contractor_rank`, `person_browse_table`, `procurement_settlement_rank`, `companies`,
`tenders`) carries a `*_fold` column and `searchFold: true`; this one never got one.

**Measured before the fix**, over the 46,682 browsable products:

| typed | rows | titles that contain it |
| ----- | ---- | ---------------------- |
| `kafe` | **0** | 1,389 КАФЕ |
| `mlyako` | **0** | 2,366 МЛЯКО |
| `sirene` | **0** | 1,499 СИРЕНЕ |
| `banani` | **0** | 85 БАНАНИ |
| `olio` | 6 | 187 (the 6 were Latin-titled listings) |
| `6okolad` | **0** | 968 ШОКОЛАД |
| `4erven` | **0** | 593 ЧЕРВЕН |

⚠️ There is no error and no empty-state distinction — „no such product" and „this box cannot
see Cyrillic" render identically at a 200. That is why it shipped.

**Fix.** `048_prices.sql` grows `title_fold text GENERATED ALWAYS AS (translit_bg_latin(title))
STORED` plus `price_products_title_fold_trgm`, and `db_table.js` gives the column
`searchCol: "title_fold"` + `searchFold: true`. That is the engine's own mechanism, so both
arms come with it: the plain romanization (`kafe`, `mlyako`, and Cyrillic `кафе` all meet in
one Latin space) and the gated `shlyo_query_fold` keyboard arm (`6` = ш, `4` = ч, `q` = я).
Every figure above becomes the right-hand column. Verified end to end through `runDbTable`
itself, not just `buildWhere`.

`filter` and `sort` stay on the RAW `title` — `searchCol` redirects the free-text arm only.

**Plan shapes**, measured under `PREPARE` (a psql literal constant-folds and hides the generic
plan the pooled route actually gets): the page query rides `price_products_browse` with the
fold as a Filter — 581 buffers / 0.4 ms — and the count rides
`price_products_title_fold_trgm` as a Bitmap Index Scan — 1,076 buffers / 11 ms, of which 9
are the index itself.

**Still open, and deliberately not bundled in.** `/api/db/price-search` (the site-wide
dropdown) ALSO runs a phonetic Latin→**Cyrillic** candidate pass (`shlyoCandidates` in
`db_routes.js`), which catches the i-glide spellings `shlyo_query_fold` leaves alone — `mliako`
→ мляко, `iaica` → яйца. The table does not, so `mliako` still returns 0 there. Closing it
means moving that table into `db_table.js` (the direction the require() graph allows) behind a
per-column flag, and folding each Cyrillic candidate back through `translit_bg_latin` so every
arm stays on ONE index — the engine's own „OR across DIFFERENT indexes is slow" measurement
(292 → 722 buffers) rules out OR-ing the raw column in. Worth doing; worth measuring first.

**⚠️ THE ALTER EMPTIES THE VISIBILITY MAP, AND `ANALYZE` DOES NOT PUT IT BACK.** A STORED
generated column rewrites the heap into a new relfilenode. Measured 2026-08-31 right after the
ALTER *and* after an ANALYZE, on both databases: `relpages 4352 · relallvisible 0 · 0.0%` —
so `price_products_browse`, the index that makes this page's own arrival 27 buffers rather than
19,261, stops being planable as an index-only scan while `last_analyze` reads freshly stamped.
`VACUUM (ANALYZE, PARALLEL 0) price_products` restores it (0.4 s local, 1.5 s cloud → 98.8% /
98.7%) and is part of the documented procedure for that reason.

**DEPLOYED to Cloud SQL 2026-08-31**: ALTER 12.2 s · index 2.7 s · VACUUM 1.5 s = 16.4 s,
off-peak. Both databases then returned identical counts for every probe term (`kafe` 1,389 ·
`mlyako` 2,366 · `sirene` 1,499 · `banani` 85 · `6okolad` 968 · `4erven` 593), and the full
`runDbTable` path was re-run against Cloud SQL rather than only against local. `app_readonly`
needs no new GRANT — the existing one is TABLE-level, so a column added later is covered.

**Deploy — DDL BEFORE `deploy:db`, and this one breaks a working page if reversed.** The
engine emits `title_fold` unconditionally; a missing COLUMN is **42703**, which no degrade
helper in `db_routes.js` covers, so a function shipped first is a 500 on every products search
and every `?q=` deep link. The full note, including why `apply_functions.ts` must NOT be used
for 048, is in CLAUDE.md under "The prices schema".

**Gate:** `scripts/db/tests/prices_search_fold.data.test.ts` (4) — asserts the column is
`GENERATED` (a hand-added plain column would pass every row-returning check and then silently
stop tracking `title`), that the index exists, that the fold strictly BEATS the raw column on
each term (a mutation check — „fold > 0" alone passes on an implementation that reverted), that
Cyrillic and Latin return the identical set, and that the shliokavitsa terms are still
unreachable without `shlyo_query_fold`, so the test cannot go vacuous. Plus 4 in
`functions/db_table.test.js` on the emitted SQL.
