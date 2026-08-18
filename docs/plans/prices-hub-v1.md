# /prices — index integrity + hub redesign (v1)

Two halves, and the order matters: **T0 is a data-integrity defect that makes the
page's headline number meaningless**, and every UI change below is downstream of
deciding what that number is. Do not ship the redesign on top of an index that
swings 4 points a day.

Scope: `src/screens/PricesScreen.tsx`, `scripts/prices/build_index.ts`,
`scripts/prices/load_day.ts`, `scripts/prices/ingest.ts`.

---

## T0 — the headline index is measuring its own sample, not prices

> **T0.1 SHIPPED 2026-08-17.** What landed differs from what T0.1 proposed below,
> in three ways worth knowing:
>
> 1. **The matching is pairwise per comparison, not a fixed baseline chain set.**
>    Each day is compared against the baseline using only the chains that priced
>    that (settlement, product) on *both* of those two days — which is why
>    `repNat[i]` carries its own `.base` rather than reusing `repNat[0]`. Better
>    than a globally fixed set: a chain that joins mid-series still contributes to
>    every later comparison instead of being excluded forever.
> 2. **The estimator changed, deliberately.** From median-over-raw-store-rows to
>    median-over-per-chain-minimums, because raw rows carry no chain attribution
>    and therefore cannot be matched at all. The level moved with it
>    (~100.8 → ~97.7 on 2026-08-14). That is a decision, not a regression, and
>    `index.json`'s `note` states the basis.
> 3. **It reaches readers only via `price_payloads`.** `npm run prices:payloads`
>    must be re-run against the target database; a `build_index.ts` change alone
>    changes nothing anyone sees.
>
> Measured after: mean |Δ/day| over the last 13 days **1.278 → 0.492**, and
> 2026-08-01…08-08 goes flat (≤0.4/day). The residual −2.0 on 08-09 is what T0.4
> exists to withhold from the headline.
>
> Shipped with it, from review: matched denominators (`n` on every index point,
> `indexN`/`indexChains` on every rank row and settlement shard), a
> `MIN_INDEX_PRODUCTS` floor on the since-euro board, `promoShare` restricted to
> the panel, and `scripts/db/tests/prices_index_stability.data.test.ts` (T0.6).

### What was observed

Two screenshots of `/prices`, taken minutes apart, one on localhost and one on
production, disagreed on the headline: **−1.5%** vs **+0.8%**.

They are **the same corpus one day apart**. Re-deriving the shipped Jevons math
in SQL against local Postgres reproduces both exactly:

| day | published index | reads as |
|---|---|---|
| 2026-08-13 | 98.50 | −1.5% ← localhost |
| 2026-08-14 | 100.78 | +0.8% ← production |

So a national food basket appeared to move **2.3 percentage points in 24 hours**.
It did not. Neither number is more correct than the other — both are noise.

### Root cause: the chain panel halved in six days

*(Past tense throughout — this describes the code before T0.1. `cells[].median`
is still computed this way as a shipped per-product field, and `basketLevel` still
rests on it, but no index figure does.)*

`build_index.ts` fixed the **settlement** panel (`panel = baseline.settMed.keys()`)
so the series tracked the same markets over time. It did **not** fix the
**store/chain** panel inside each settlement. The cell price was
`percentile_cont(0.5)` over every raw row in that (settlement, product) on that day
(`load_day.ts`, the `price_grid_days` INSERT), so which shops reported that day
changed the median with no price changing.

Chain coverage since 2026-07-28:

```
07-28..08-08   ~203–209 chains, ~237–244 settlements   index 98.3–100.0  (Δ mostly ±0.3)
08-09          140 chains   213 setts                  index 97.64  Δ −1.04
08-10          132          211                        index 99.43  Δ +1.79
08-11          115          196                        index 96.81  Δ −2.62
08-12          107          198                        index 100.38 Δ +3.57
08-13          101          188                        index 98.50  Δ −1.88
08-14           98          184                        index 100.78 Δ +2.28
```

**−52% of chains in six days.** Daily volatility rises with the collapse — exactly
the variance-inflation signature of a shrinking sample.

### The isolation experiment (this is the proof, not the inference)

Holding the estimator constant (per-chain min → median across chains → median
across panel settlements) and varying **only** whether the chain set is fixed to
chains present on both euro day and 08-14:

| day | chains | drifting panel | fixed panel |
|---|---|---|---|
| 08-06 | 208 | 100.75 | 96.23 |
| 08-07 | 209 | 101.26 | 97.13 |
| 08-08 | 203 | 100.34 | 96.82 |
| 08-09 | 140 | **96.15** | **96.93** |
| 08-10 | 132 | 95.64 | 97.95 |
| 08-11 | 115 | 95.85 | 96.33 |
| 08-12 | 107 | 98.87 | 97.51 |
| 08-13 | 101 | 97.17 | 96.61 |
| 08-14 |  98 | 97.66 | 97.72 |

The drifting series drops **4.19 points in one day** (100.34 → 96.15) precisely
when chains go 203 → 140. Over the same transition the fixed panel moves
**+0.11 — flat**. Day-to-day standard deviation over the window: **2.1 drifting
vs 0.57 fixed**, a ~4× reduction. The two series converge at 08-14 because by then
almost the only chains left *are* the fixed panel.

The 08-09 cliff is entirely sample composition. No price moved.

### The dropouts are systematically biased, not random

Of the 203 chains reporting on 08-08, **108 are gone by 08-14**. They are the long
tail plus pharmacies:

| | chains | avg rows/chain |
|---|---|---|
| dropped out | 108 | 3,564 |
| still present | 95 | 10,579 |

Largest departures: СОФАРМАСИ (172,248 rows), Фреш Маркет, МАГАЗИНИ НИВЕН,
РЕМЕДИУМ, HOT MARKET, ABC MARKET, Аптеки Ремедиум, СИТИМАРКЕТ.

Small regional shops and pharmacies price differently from hypermarkets, so this
is **bias**, not just variance: the surviving panel is a big-chain panel.

### Why nothing caught it

`load_day.ts` has a sanity floor (`SANITY_DROP = 0.2`) that should refuse a day
whose rows or chains fall >20% below the previous day. It has three holes, and all
three fired here:

1. **`--backfill` and `--force` disable it wholesale** — `ingest.ts:110`,
   `skipFloor = has("--backfill") || has("--force")`. The 08-08 → 08-09 drop was
   −31% on chains and would have thrown; it was loaded on a bypassing path. The
   rationale ("backfill replays known-good history") does not hold when the
   *source archive* for recent days is itself incomplete.
2. **It only ever compares to the previous day.** After the initial break, the
   slide is −5.7%, −12.9%, −7.0%, −5.6%, −3.0% — every step under 20%, compounding
   to −52%. A monotone ratchet is invisible to a per-day threshold.
3. **It guards the INGEST, nothing guards the PUBLISH.** Even a knowingly thin day
   is still headlined by `build_index.ts` as the latest value with no qualifier.

### Is it publication lag?

The post-08-09 shape — each *more recent* day thinner than the last (140, 132, 115,
107, 101, 98) — is the classic lag curve of chains filing late. A genuine mass
departure would be a step, not a ramp. **Verify first**: re-run the ingest for
2026-08-09..08-14 and see whether the chains return. The answer changes the fix.

- **If lag** → the last N days are structurally incomplete and must never be the
  headline. Fix in the publisher.
- **If real departure** → the panel must be re-based, and the euro-day comparison
  needs restating on the surviving panel.

### T0 fixes

- **T0.1 — fix the chain panel in the index.** Compute `repPrices` over a chain set
  fixed at the baseline (or the intersection of baseline ∩ latest), the way the
  settlement panel already is. This is the actual defect; everything else is
  mitigation. Note the **level** is estimator-dependent (~97 fixed vs ~100.8
  published on 08-14), so choosing the estimator is a deliberate decision to make
  once and document in the note field, not a side effect of the panel fix.
- **T0.2 — headline a trailing average, never a raw day.** Even fixed, the daily
  series carries ~0.6pp of noise. `PricesScreen.tsx` reads
  `series[series.length-1].v` raw while the sparkline beside it plots a **7-day
  moving average** — the big number and the line next to it are computed
  differently today. Use the same smoothing for both.
- **T0.3 — make the guard cumulative and un-bypassable.** Keep the per-day floor,
  add a floor against a **trailing median** (e.g. refuse below 80% of the 7-day
  median chain count) so a ratchet trips, and make `--backfill` skip only the
  *out-of-order* check, not the coverage floor.
- **T0.4 — publish-side coverage gate.** `build_index.ts` should refuse to headline
  a latest day whose chain count is materially below the trailing median, and fall
  back to the last complete day, saying so in the payload.
- **T0.5 — coverage is a first-class published field.** `coverage.chains` already
  ships; add the trailing median and a `complete: boolean` so the UI can qualify
  the number instead of the reader having to.
- **T0.6 — regression gate. ✅ SHIPPED 2026-08-17** as
  `scripts/db/tests/prices_index_stability.data.test.ts` (3 gates: unexplained
  single-day move, fabricated-100 with zero matched products, thin places on the
  since-euro board), plus `scripts/prices/build_index.test.ts` (11 unit tests on
  `matchedCell`, including a mutation check). This class of defect is invisible to
  every row count — the corpus is complete and internally consistent; it is the
  *composition* that moved. Note the move gate carries an `EXAMINED_MOVES`
  allowlist: a large move is not by itself a defect, so clearing one means
  recording the measurement that cleared it, and a stale entry fails too.

### T0 also invalidates two leaderboards on the page

Same one-day window, from the screenshots:

- **Най-евтини области** — Пловдив 13,03 → 13,01, Кюстендил 13,75 → 14,03, Габрово
  13,99 → 14,24, and **Добрич drops out entirely, replaced by Бургас**. The
  "cheapest oblast" ranking reshuffles day to day.
- **€ на килограм** — a completely different four items on each day.

Both need the same treatment: a trailing window, not a single day.

---

## T1 — presentation defects (wrong, not merely plain)

### T1.1 — "Най-евтини вериги" is not a ranking

`build_index.ts:765` keeps any chain pricing ≥50% of the 12-item common basket and
sorts by the **raw sum over whatever subset it priced**. A chain missing items
floats to the top:

| shown as | basket | items | €/item |
|---|---|---|---|
| 1. ДИМЕКС | 10,99 € | 8/12 | **1,37** |
| 2. Вилтон | 12,38 € | 7/12 | **1,77** |
| 3. ТАРИТА | 12,45 € | 10/12 | **1,25** |
| 4. Славекс | 12,69 € | 8/12 | **1,59** |

Like-for-like the order is nearly **reversed** — ТАРИТА is the cheapest chain on
the page and is ranked third. The builder's own `note` field says *"Compare
like-with-like"*; the UI renders the denominator as `opacity-60` fine print after
a `·`.

Fix, preferred: **restrict the hub tile to full-coverage chains**
(`nPriced === commonBasketSize`) and let `/consumption/chains` carry the long tail
with its caveat. A front page should not need a footnote to be read correctly.
Alternatives: sort and display €/item; or render coverage as a visible bar.

The ≥50%-coverage filter and the raw-sum sort are in `buildChains` — the national
arm and the per-município arm, which apply the same rule twice.

### T1.2 — two different things are both called "кошница"

The hero prints `кошница 10,99 €–24,29 €` (a **chain** basket range); "Най-евтини
области" lists `13,03 €` (a **place** basket level, `PriceRankPlace.basketLevel`).
Different denominators, same word, 40px apart. Name the basis on each.

### T1.3 — nothing on the page says how fresh it is

`index.latestDate`, `deals.latestDate` and `chains.latestDate` all exist and none
reach the screen. "Промоции днес" asserts *today* without proving it. Given T0 the
date is not a nicety — it is the difference between two headlines that disagree by
2.3pp. Put `Данни към <дата>` in the hero and drop the duplicate disclaimer from
the footer.

### T1.4 — "€ на килограм" is measuring pack size

The tile lists 10КГ КРОМИД ЛУК, 5КГ маслини, 10КГ КАРТОФИ. True per kg, and a
restatement of "bulk packs are cheaper per kg" rather than a consumer insight.
Either band by pack size or exclude catering packs. Relates to the known
per-piece unit pollution guard.

---

## T2 — layout

### T2.1 — the middle row blows out

`EuroVerdictTile` is a bar + 3-item legend + 3-line disclaimer + a link inside a
1/3-width cell, so it sets the row height and leaves ~200px of white space in
"Промоции днес" and "€ на килограм" either side. **Promote it to a full-width band
under the hero** — it is the page's headline question — leaving eight tiles in two
clean rows of four. Its in-tile ECB caveat duplicates the footer.

### T2.2 — the hero wastes its right two-thirds

`+0.8%` sits alone with a 280px sparkline pinned far right. Per the standing
preference, **no sparklines** — an axis-less squiggle carries shape but no readable
value. Replace with a real axed chart (`PriceIndexTrendChart` exists) spanning the
free width, baseline-100 line drawn, endpoint dates labelled. With T0.2 this also
makes the headline and the chart the same number.

### T2.3 — a second hero stat row from data already fetched

`hub.products`, `hub.foodInflationPct`, `hub.biggestDealPct`, `hub.electricityGapPct`
and `hub.gasGapPct` are all fetched by `useHubStats()` and never rendered.

---

## T3 — tile-level

- **Deals show a discount with no price.** `DealRow` carries `promo` and `reg`; the
  tile prints only `−53%`. Render "3,49 € (от 7,12 €)". Also sentence-case the
  ALL-CAPS source titles, which truncate badly.
- **Categories are text-only percentages.** +6,5% vs −5,0% are not visually
  comparable as coloured text. Use a diverging bar or a dumbbell row.
- **Two "спрямо ЕС" tiles in different idioms** — `60% от средното` (a level) and
  `−23,5%` (a gap), different colours. Merge into one tile with rows: храна /
  горива / ток / газ, using the unused `HubStats` fields.
- **"Карта на цените" is the only prose-only tile** — a dead card among eight data
  cards. Give it a thumbnail choropleth, or fold it into "Най-евтини области",
  which already points at `/prices/map`.
- **No loading state.** Every tile returns `null` until its query resolves, so the
  grid pops in tile-by-tile and reflows; the prerendered HTML ships empty tiles.

---

## T4 — missing entirely

- **Search.** `/consumption` has `ConsumptionSearchTile` over `/api/db/price-search`
  (~118k products). `/prices` has none — the only route to a product is 4 deals or
  4 €/kg rows. "Колко струва X" is the modal intent here and it is unserved.
- **The reader's own place.** `ConsumptionAreaBanner`, `useMuniChains`,
  `useMuniDeals` and `useSettlementPrices` all exist. A Sofia reader is currently
  shown Пловдив / Кюстендил / Габрово. A "цените при вас" tile anchored on `?area=`
  is the highest-value slot on the page.

---

## T5 — system consistency

`/prices` hand-rolls `DashTile` (a `Card` + lucide icon) while `/consumption`, the
sectors hub and the procurement hub all use `InfographicTile` / `TileHubGrid` with
accent tokens and bespoke SVG scenes — which is why this page reads flatter than
its siblings. Porting gets the accent system, the phone-row/desktop-banner
responsive behaviour and the metric-overlay pattern for free.

Open question beyond this plan: `/prices` and `/consumption` are two hubs over one
corpus with overlapping tiles. Whether `/prices` should remain a separate page is a
product decision, not a UI one.

---

## Order

1. **T0.1 ✅ + T0.2 + T1.1 + T1.3** — the page stops publishing numbers that are
   wrong or incomparable. Nothing below matters until this lands.
2. **T0.3–T0.5** (T0.6 ✅) — the guards, so it cannot recur silently.
3. **T2** — the visual payoff.
4. **T1.2, T1.4, T3, T4** — the long tail.
5. **T5** — only if `/prices` survives the consolidation question.
