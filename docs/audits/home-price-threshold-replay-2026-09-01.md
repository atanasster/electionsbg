# Home change feed — the 90-day price threshold replay

**Date:** 2026-09-01 · **Corpus:** `price_grid_days` 2026-01-02 … 2026-08-31 (242 days),
local Postgres · **Plan:** `docs/plans/home-dashboard-implementation-v1.md` §6.3, Phase 5 item 1
· **Tool:** `npx tsx scripts/db/gen_home/price_events.ts --replay --days 90`

This is the review artifact §6.3 requires before a price threshold is accepted: it records the
event volume, the false-positive class, the missing days and the category dominance the
proposed rule would produce over the last 90 days of real data.

---

## 1. What the replay measures

The basket is the **same twelve products** (`pid` 1, 6, 9, 11, 35, 38, 40, 42, 52, 54, 55, 61)
as `COMMON_BASKET` in `scripts/prices/build_payloads.ts` — the set the município ranking and
the „who is cheapest where" map are already built on. A home-page sentence about „the basket"
measured over a different set would contradict the page it links to;
`home_price_events.data.test.ts` reads the other file and fails on any divergence.

For each anchor day the cost is the trailing **7-day mean** against the **prior 7-day mean**,
each day's cost being the sum over the twelve products of the median settlement `min_eur`.

## 2. The finding that shaped the rule: coverage moves more than price does

`price_grid_days` is one row per (day, settlement, product), and which settlements report
changes constantly. Summing whatever is present on each day therefore prices a **different
country each day**.

| series | crossing days at ±1.5% | max 14-day coverage swing | max move |
| --- | --- | --- | --- |
| naive (all cells present that day) | **25** | **16.75%** | 4.11% |
| fixed cohort (cells priced on all 14 days) | **18** | 0 by construction | 3.28% |

The single clearest case is **2026-08-26**: the naive series reported **−2.82%** while the
cells underneath it moved **−4.60%**. That „price fall" was the corpus losing settlements.

Every measurement therefore runs over a **fixed cohort** — the (settlement, product) cells
priced on *every* day of the fourteen-day span — so the two windows compare the same shops on
the same products. §6.3's „suppress an event if coverage movement could explain the price
movement" is satisfied **by construction** rather than by a second guard that could be tuned
away. Cohort size over the 92 measurable days: **1,704–2,447 cells, 78.0%–97.9%** of what was
priced. The shipped floors (600 cells, 60% share) sit below the observed minimum, so they
refuse a thin or biased remnant without ever having refused a real day in this corpus.

## 3. Volume: the threshold, and why consecutive days are one event

A trend crosses the threshold on several consecutive days. Emitted per day that is the same
news six times, and it fills the feed — so crossings are collapsed into **runs** of consecutive
same-sign days, one event per run, dated at the run's strongest day.

| threshold | crossing days | episodes | rate | verdict |
| --- | --- | --- | --- | --- |
| ±0.75% | 45 | 5 | 1 per 18 days | merges distinct June episodes into one 11-day run |
| ±1.00% | 40 | 5 | 1 per 18 days | same merge |
| **±1.50%** | **18** | **4** | **1 per 23 days** | **shipped** |
| ±2.00% | 10 | 3 | 1 per 31 days | **splits the August episode in two** (08-15…17 and 08-19…20) |
| ±3.00% | 3 | 2 | 1 per 46 days | silences the corpus — the largest move in 3 months is 3.28% |

The four accepted episodes at ±1.5%:

| run | peak | cohort |
| --- | --- | --- |
| 2026-06-01 … 06-02 | −1.82% on 06-01 | 2,447 |
| 2026-06-19 … 06-20 | −1.72% on 06-19 | 2,366 |
| 2026-07-22 … 07-27 | −3.28% on 07-24 | 2,319 |
| 2026-08-14 … 08-21 | +3.23% on 08-16 | 1,824 |

**±2.0% is rejected for a reason that is not volume.** It produces fewer events, which looks
better, and one of the three is the August episode reported **twice** — precisely the failure
the collapse exists to prevent. Fewer rows is not the objective; one row per episode is.

## 4. Missing days

92 of the last 95 days are measurable. The three that are not are the leading edge of the
series, where no prior window exists — not gaps in the corpus. No day inside the range is
absent, and `collapseRuns` measures adjacency **on the series rather than on the calendar**, so
a future missing day cannot split one episode into two (gated in
`home_price_events.data.test.ts`).

## 5. Category dominance

At ±1.5% the basket contributes **≈1 row per 23 days**, so the feed's 30-day window holds one
or two. The promotion arm is capped at **three**. With `MAX_PER_CATEGORY = 2` in the rendered
prefix, prices can occupy at most two of six — verified against the committed artifact, whose
first six rows are 2 prices / 2 funds / 2 parliament.

## 6. Promotions: what the daily history cannot do, and what was done instead

§6.3 forbids emitting a promotion „from a single low observation".
`price_product_days.min_promo_eur` **is** a single low observation: a per-day minimum across
every store. Two consequences were measured:

- **Corroboration is not recoverable from history.** The daily table records no promo-chain or
  promo-store count, so the deals board's gate (≥3 store listings, ≥2 distinct chains, not a
  low outlier, measured against the chain-deduped baseline regular) can only be evaluated on
  `price_current`. The shipped rule therefore takes **corroboration from `price_current` and
  the start date from the history** — both halves are required, because the gate without the
  history is a state rather than an event, and the history without the gate is a rumour.
- **„A promo exists" is true almost every day.** Of the 3,000 products carrying a promo on
  2026-08-31, **2,982 had carried one every day for a month**. Anchoring the run on presence
  dated every promotion to the edge of the window and produced **zero** qualifying events.

⚠️ **AND THE OBVIOUS SECOND ATTEMPT SHIPPED A WRONG DATE, so the field is now named for what it
actually means.** The first cut anchored the walk-back on the day's own `min_promo_eur` — the
RAW minimum — while the published price comes from `price_current` **after** the outlier floor.
Those are different populations, and where an excluded listing exists the walk-back follows *its*
run. Measured on the shipped `limoni` row, which was the artifact's **highest-ranked of 40**:
`med_promo` 1.59 → floor 1.113, a €0.98 listing below it, published price €1.28 — and a start
date of **31 August** for a level that had been live since **21 August**, i.e. recency bought by
a price we deliberately refused to quote. Nine currently-qualifying products showed the same
raw/gated divergence, the largest at 30.6%.

A per-day MINIMUM cannot establish when an offer began — only that nothing was cheaper. So the
question asked is the one it can answer, and the field is called **`atOrBelowSince`**: *since
when has the cheapest promo for this product been at or below the level we publish.* The
walk-back is anchored on the **gated price** and the comparison is `≤` (plus 2% headroom for
rounding), not a band — a day whose minimum is lower still qualifies, a day whose minimum is
higher does not. `limoni` now reports 2026-08-21, and 1,654 products have such a run starting
inside 30 days.

⚠️ **It is NOT the row's date.** The event is dated at the corpus day (`occurred`, „we observed
this promotion"), because that is what we can prove about the day. `atOrBelowSince` stays in the
measurements artifact, where it gates the 30-day window, and is not rendered — a raw ISO day
mid-sentence is worse copy than none, and formatting it needs a locale the generator lacks.

Discount band: the board's own ceiling (**70%** — above it, empirically a source error) with a
**deliberately higher floor of 30%**. 15% off is a deal — there were **279** live on
2026-08-31, and **89** at ≥30%. 30% off is news. The inequality against the board's `MIN_DISC`
is asserted rather than the equality, so a future relaxation is a red gate.

Output on the accepted rule: **3 promotions**, corroborated across 6/2, 315/5 and 40/2
store/chain listings.

## 7. Accepted

| rule | value |
| --- | --- |
| basket | the 12 `COMMON_BASKET` products, fixed 14-day cohort |
| comparison | trailing 7-day mean vs prior 7-day mean |
| move threshold | **±1.5%**, consecutive same-sign days collapsed to one episode |
| cohort floors | ≥600 cells and ≥60% of the mean daily cell count |
| promotion gate | the deals board's corroboration, discount **30–70%** |
| `atOrBelowSince` | walk-back anchored on the GATED price, `≤` + 2% headroom, inside 30 days |
| promotion cap | 3 |

⚠️ **All fourteen rules are stored in the artifact itself** (`data/home/price_events.json`
`thresholds`), so a reader of a future rebuild can tell a corpus change from a rule change. That
sentence used to say „all seven" and the object held ten of fourteen — it omitted the level
tolerance, the promotion cap and the two inherited gate constants, which after the `limoni`
defect are the numbers a reader would most need. It is now written from ONE exported
`THRESHOLDS` object rather than a literal at the write site, and the data test compares the
whole object rather than a hand-listed subset.

The corroboration constants are no longer restated here at all: `scripts/prices/promoGate.ts`
is the single definition that both the /consumption deals board and this generator import. The
copy the old data test did **not** compare — `PROMO_OUTLIER_FLOOR` — is exactly the one the
`limoni` defect turned on.
