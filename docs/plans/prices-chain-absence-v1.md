# Prices: surviving an absent chain — audit and plan (v1)

**Status:** plan only, nothing implemented.

**Trigger:** Билла (ЕИК `130007884`) has been effectively absent from the КЗП feed since
2026-08-15 (171,275 rows → 1,768 → **198**), which blocked the daily `npm run prices` on
its cliff guard and left the price layer held at **2026-08-14**.

**Standing constraint (operator, 2026-08-20): a chain that has ever reported must never be
deleted — including for historical reasons.** §1 and §2 establish, with measurements, that
this splits into two very different things: the historical record already honours it
completely, while the *served* layer violates it through a four-step cascade nobody
intended. §3 states the tension the constraint creates on a price-comparison site, because
"never delete" and "never show a stale price as current" cannot both be satisfied naively.

---

## 1. History already honours the constraint — nothing to do, and nothing at risk

Every DELETE in the pipeline that touches a history table is **day-scoped idempotency**, so
re-loading a day replaces that day and nothing else:

| site | statement | scope |
|---|---|---|
| `load_day.ts:153` | `DELETE FROM price_facts WHERE valid_from = $1::date` | one day's newly-opened runs |
| `load_day.ts:463` | `DELETE FROM price_grid_days WHERE day = $1::date` | one day |
| `load_day.ts:483` | `DELETE FROM price_chain_grid_days WHERE day = $1::date` | one day |

There is **no** unscoped delete or TRUNCATE of `price_facts`, `price_grid_days`,
`price_chain_grid_days` or `price_chain_days` anywhere in `scripts/` or `functions/`. The
dimension tables (`price_stores`, `price_skus`, `price_chains`) are never pruned at all, so
a chain's identity is permanent once seen.

Measured — Билла's record, which loading the held days would leave **entirely intact**:

| table | rows | span |
|---|--:|---|
| `price_facts` | **1,173,752** (231,325 open runs) | 2026-01-02 → 2026-08-14 |
| `price_chain_grid_days` | **360,667** | 222 days |
| `price_current` | 171,274 | today only |

**So "delete" in this codebase never means what the constraint fears.** The only delete that
removes a chain's rows is `price_current`'s anti-join, and `price_current` is not history —
it is the "what does it cost right now" table, fully replaced from each day's observations.

⚠️ **And it cannot be reconstructed from history, which is why it exists.** Absence is only
knowable at observation time: a delisted SKU's run stays open forever, so the corpus carries
**4,387,949 open runs against 1,177,730 real current rows — a 3.7× phantom over-count**
(the 048 header cites 36% from day 8; it has compounded since). Any design that infers
"currently on sale" from `price_facts` publishes 3.7× more products than exist.

---

## 2. What the served layer actually deletes — a confirmed four-step cascade

This is the real violation of the constraint, and it is not in any history table.

1. Билла absent from the feed → `load_day.ts:435` anti-join **deletes its 171,274
   `price_current` rows** (parity guard at `:441` then asserts `price_current` == today's obs).
2. `build_payloads.ts:415` builds `chain-products:<eik>` with `JOIN price_current pc` — so
   the query now returns **no rows** for `130007884` and `emit("chain-products", …)` never
   fires for it.
3. `mergeFromStage(PAYLOADS_MERGE)` runs `stageDeleteSql` — an anti-join DELETE keyed on
   `(kind, key)`, deliberately a *"full rebuild every run"* so a dropped settlement cannot
   leave a stale shard.
4. → the existing **7,087-byte `chain-products / 130007884` payload is DELETED**, and
   `/consumption/chain/130007884` loses its content.

**Four payload kinds are keyed by chain or place and are therefore prunable the same way:**
`chain-products` (98), `chains-muni` (159), `deals-muni` (121), `place` (184).

Measured blast radius on 2026-08-14 (184 places priced):

- **1 place** where Билла is the *only* reporting chain — that place's shard disappears entirely.
- **12 places** would be left with ≤2 chains, i.e. a "comparison" resting on almost nothing.
- 92 of 184 places already rest on a single chain, so the fragility is structural, not
  Билла-specific.

---

## 3. The tension the constraint creates, stated plainly

"Never delete a chain" and "never show a stale price as current" pull in opposite
directions, and on this site the second has teeth: a reader can travel to a store on a price
we published. A Билла price retained unchanged through 08-15…08-19 would render as today's
price on `/product/:slug`, indistinguishable from a chain that actually filed this morning.

So the constraint must be read as **"never delete a chain's presence or its history"**, not
"keep serving its last price as if current". The design that satisfies both is
*retain-and-label*, never *retain-silently*:

- the chain keeps its page, its history and its identity;
- any figure it contributes to carries the date it was last observed;
- no stale value is ever eligible for a **minimum, a ranking, or a comparison** — which is
  exactly where §2's `chain-map` ("cheapest chain per município") and `basketLevel` would
  otherwise be corrupted.

`price_current`'s delete-absent + parity guard is the mechanism that currently enforces the
second half. **T2 therefore keeps it and adds a separate last-known layer beside it**,
rather than relaxing the guard — relaxing it would make "today's truth" mean two things at
once, which is how the 3.7× phantom count arises in the first place.

---

## 4. Tasks

### T1 — make the ingest guard chain-aware (unblocks the daily path honestly)

`SANITY_DROP = 0.2` compares total rows and chain count against **yesterday**, so it cannot
tell "two identified chains went silent" from "the parser regressed". The only available
response is `--no-floor`, which suppresses the check for *every* cause at once.

Replace the bare delta with a **reconciled** check: compute the expected row loss from
chains that reported yesterday and are absent/collapsed today; pass when the observed loss
is explained by them within tolerance, fail on an unexplained residue.

```
2026-08-15: −320,141 rows; 315,486 explained by 2 absent chains (Кауфланд, Билла);
            residue −4,655 (1.4%) — within tolerance, loading
```

`price_chain_days` already records who *did* report; the absent set is its complement and
should be materialised once, not recomputed ad hoc by each reader. Keep `--no-floor` as the
override; the daily path should stop needing it.

### T2 — preserve the chain's served presence (the constraint's actual requirement)

Break the §2 cascade. Three sub-parts, in dependency order:

**T2a — record last-known observation per (store, sku).** A `price_last_seen` table (or an
`as_of` stamp on a sibling of `price_current`) written from the same `obs` set each day.
Additive: `price_current` keeps delete-absent and keeps its parity guard untouched.

**T2b — make chain/place payloads survive absence.** `chain-products` should build from
last-known plus `as_of` rather than `JOIN price_current`, so step 2 of the cascade emits a
payload and step 3 has nothing to prune. Same for the `place` shard of the one
Билла-only settlement.

**T2c — label it everywhere it renders.** A chain page, product row or place shard carrying
a last-known price must state the date ("последно подадена цена: 14.08"). A stale value must
be **excluded** from `chain-map`'s cheapest-chain pick, from `basketLevel`, and from any
min/rank — see T3.

⚠️ The failure mode to design against is not absence but *silence*: a retained price with no
date is strictly worse than a deleted one, because the reader cannot tell.

### T3 — give LEVEL figures the matched-panel treatment (the deferred T0 follow-up)

`build_index.ts:33-38` already states this and defers it: *"LEVEL figures — basketLevel,
every rank derived from it (the 'Най-евтини области' board), and all of chains.json …
remain exposed to exactly the reporter-set drift the index was fixed for. Fixing that is
plan T0 follow-up work, not done here."*

`basketLevel` is the sum of settlement **MIN** prices over the 12-staple core basket
(`:142`, `:663`, `:775-791`). Measured on 2026-08-14 by removing Билла and recomputing every
affected cell:

| basis | mean bias | cells moved | worst |
|---|--:|--:|--:|
| **median** (what the index uses) | **+0.068%** | 89.4%, trivially | — |
| **min** (what `basketLevel` uses) | **+4.293%** | 15.8% | **+415.3%** |

A departing chain is disproportionately likely to have *been* the cheapest, which is
precisely what a cheapness ranking surfaces. Apply the `matchedCell` treatment: compute the
basket over a chain set held fixed between the compared days.

T3 becomes **more** load-bearing under the constraint, not less: once T2 retains stale
prices, T3 is what stops them leaking into a minimum.

Existing partial mitigation to preserve: `:784` nulls `basketLevel` when any core-basket
product is unpriced, so a place drops off the board rather than jumping. `promoShare` needs
the same treatment or an explicit caveat — `index.json`'s own note already flags it as
*"a LEVEL with no baseline to cancel composition against"*.

#### ⚠️ ATTEMPTED 2026-08-20 AND REVERTED — the design above is not sufficient

Implemented as written, reviewed, and backed out rather than shipped. Two defects, and the
second is the one that makes this a design fork rather than a bug:

1. **It reached the wrong tier.** The matched panel was applied at the SETTLEMENT grain,
   because that is where `matchedCell` already lives. The „Най-евтини области" board — the
   surface this task exists for, and the one the +415.3% figure was measured on — ranks at
   the **OBLAST** tier, which aggregates settlements *after* the matching. So the expensive
   half ran and the exposed board was untouched.
2. **Per-place baselines systematically bias newcomers cheaper.** Holding the chain set
   fixed *per place* means each place is matched against its own history, so a place a cheap
   chain has only just entered keeps a baseline that predates it and reads as having fallen.
   The index escapes this because it compares one place against ITSELF across two days; a
   RANKING compares places against each other, and a per-place matched set is not a common
   basis. A single national matched set fixes the basis but strands every place the panel
   chains do not reach — which, at 98 reporting chains, is most of them.

There is no default that is obviously right, so it stays open. **T4 is the only mitigation
currently shipped**, and both `build_index.ts`'s header and `PriceCoverageNote`'s say so in
those words, so nobody reads the note as belt-and-braces over a fix that is not there.

### T4 — surface coverage where the exposed figures render

`coverage.chainsComplete`, `incompleteDates` and `headlineDate` already exist in
`index.json` (`build_index.ts:477-561`) and are the right vocabulary. The level-based
surfaces should read them: `PricesScreen`, `ConsumptionAffordabilityTile`,
`ConsumptionPriceLevelTile`, `PriceChoropleth`, `GovernancePricesTile`, `PlaceBasketTile`,
`MyAreaPricesTile`. Cheapest task, best honesty-per-line, and it is what keeps the pages
defensible until T3 lands.

### T5 — regression gates

- **Non-deletion gate (the constraint itself):** load a fixture day with a large chain
  absent, then assert its `chain-products` payload still exists and its history row counts
  are unchanged. Without this, T2 silently regresses the next time the payload builder is
  refactored.
- **Staleness gate:** assert no retained last-known price is eligible for `chain-map`,
  `basketLevel` or any min/rank.
- **Index-stability gate:** same fixture, assert the index moves < 0.2% (measured 0.068%).
- **Mutation check on T1:** with the reconciliation stubbed out, the guard must go back to
  failing — otherwise the test passes on an implementation that stopped reconciling.
- **Zero-price gate:** assert no writer can introduce `price <= 0` (currently structural via
  `toPrice`; make it a test so it stays structural).

---

## 5. Already true — do not rebuild these

| claim | evidence |
|---|---|
| **A zero price is impossible.** | `toPrice` returns null unless `n > 0` (`normalize.ts:42`); row skipped at `:104`. **0 rows** with `price <= 0` in all four tables. |
| **The backfill is already unblocked.** | `--backfill` / `--force` / `--no-floor` all set `skipFloor` (`ingest.ts:118`), downgrading the cliff guard to a warning (`load_day.ts:276`). |
| **Inflation is already protected.** | `matchedCell` (`build_index.ts:155-221`) compares only chains that priced a product on **both** days. Measured drift from losing Билла: **+0.068%**. |
| **Thin days are already fenced off headlines.** | `dayComplete[]` / `incompleteDates` / `headlineDate` from a 14-day `trailingChainMedian`. |
| **History is never pruned.** | §1. |

---

## 6. Explicitly rejected

- **Imputing an absent chain's prices** (carry-forward *into the grids*, or filling from the
  settlement median). It manufactures observations a named retailer never made, on pages
  that attribute prices to that retailer by name. T2 retains a *labelled last-known*
  observation; it never invents a new one, and never lets one into an aggregate.
- **Writing zero or NULL rows for an absent chain.** Already impossible (§5), and it would
  drag every mean toward zero.
- **Relaxing `price_current`'s delete-absent or its parity guard.** §3 — it is what keeps
  "today's truth" single-valued; the 3.7× phantom-run count is what happens without it.
- **Lowering `SANITY_DROP`.** The threshold is not the problem, the *reference* is (T1).
- **Loading the held days before T2 lands.** Mechanically possible today, but it executes
  the §2 cascade and deletes Билла's chain page.

---

## 7. Open questions

1. **Is Билла's absence a fault or a withdrawal?** ЗВЕРБ чл. 55б is an obligation; five days
   of near-silence under an unchanged filename and ЕИК reads as a pipeline break at their
   end. Worth asking КЗП before designing around it.
2. **How long may a last-known price be served?** T2c labels it; it does not cap it. A
   30-day ceiling after which the chain page shows "не подава данни от…" and no prices is
   probably right, but it is a product call.
3. **The 209 → 98 collapse is the real story.** The corpus lost more than half its reporters
   between 07-26 and 08-14 and only `lib/coverage.ts` currently reasons about it. T3's panel
   should be sized for that, not for one chain.
4. **The one Билла-only settlement** — does its shard get a last-known page (T2b) or an
   explicit "no current data" state? Same question as (2), one place.

---

## 8. Measurements in this document

Taken 2026-08-20 against the local corpus (loaded through 2026-08-14) and the cached day
archives in `raw_data/prices/`.

| what | value |
|---|--:|
| Билла `price_facts` rows / open runs | 1,173,752 / 231,325 |
| Билла `price_chain_grid_days` rows / days | 360,667 / 222 |
| Билла `price_current` rows (the only ones deleted) | 171,274 |
| corpus open runs vs real current rows | 4,387,949 vs 1,177,730 (**3.7×**) |
| Билла share of 08-14 chain-grid cells | 4,400 / 33,651 (13.1%), 56 settlements, 82 products |
| index basis (median) bias without Билла | **+0.068%** |
| level basis (min) bias without Билла | **+4.293%** mean, **+415.3%** worst, 15.8% of cells |
| rows with `price <= 0`, all four tables | **0** |
| places on 08-14 / Билла-only / left with ≤2 chains | 184 / **1** / 12 |
| prunable payload kinds | `chain-products` 98, `chains-muni` 159, `deals-muni` 121, `place` 184 |
| deleted payload if the cascade runs | `chain-products / 130007884`, 7,087 bytes |
| chain count 2026-07-26 → 2026-08-14 | 210 → **98** |
