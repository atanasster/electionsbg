# Location-aware Consumption dashboard — v1 plan

**Goal.** Let a user pin a location (detect via GPS or pick a settlement/município) and see, *for that place*: the price basket, the full local product list with per-store cheapest prices, and the promotions currently running near them. Today the Consumption view has all the geo data in the serving layer but only surfaces a thin oblast tile and a curated "featured staples" list; nothing on the products browser or the deals feed is location-scoped.

---

## 1. What already exists (reuse, don't rebuild)

### Location backbone — already global
- **`?area=<id>` anchor** — `AreaAnchorProvider` mounted at the root, id = settlement EKATTE / obshtina / raion. Read via `useAreaAnchor()`, set via `useSetAreaAnchor()` (`src/data/area/areaAnchor.tsx`, `AreaAnchorProvider.tsx`).
- **Geolocation** — `AreaSniperButton` crosshair in the header → `useNearestSettlement` (`src/data/area/useNearestSettlement.ts`) auto-picks a settlement within 1.5 km or shows `AmbiguitySettlementChooser`. Persistent `AreaPill` chip.
- **`useAreaResolver(id)`** — O(1) resolve of an anchor id to `{kind: settlement|municipality|raion, ekatte, obshtina, oblast}`. Sofia handled (`SOF00` / EKATTE 68134).
- **`resolvePriceKeys`** (`src/data/prices/pricePlaceKeys.ts`) — maps a resolved area to the right price-payload keys (place ekatte + chains-muni obshtina; Sofia районы → city).

### Consumption data — geo levels already served (Postgres `price_payloads`, PK `(kind,key)`)
| kind | key | contents |
|---|---|---|
| `index` | `''` | national + per-oblast series, category index, `promoShare` |
| `ranking` | `''` | every place, `tier: settlement\|muni\|oblast`, basket level + rank |
| `place` | `<ekatte>` | **per-settlement: EVERY basket product** with `min/avg/max/median`, `cheapestEik/Chain/Store`, `stores`, **`promoMin`**, per-category change, movers, weekly series |
| `chains-muni` | `<obshtina>` | per-município chain comparison |
| `chain-map` | `''` | cheapest chain per município |
| `chain-products` | `<eik>` | a chain's own products |
| `deals` | `''` | **national** top-48 promos (slug, was→promo, disc%, chain/eik) |
| `unit-prices`, `dict`, `deals`, `verdict`, `hub-stats` | `''` | national/aggregate |

### Consumption screens — already built
- `/consumption/:id` → `ConsumptionPlaceScreen` (resolves to settlement **or** município) renders `MyAreaPricesTile` (basket level, rank, cheapest chains, movers, **FEATURED staples only** — a hard-coded subset — with cheapest store + Maps link).
- `/product/:slug` → `ProductScreen` is **already location-aware** via `useProduct(slug, ekatte)` → `price-product?slug=&ekatte=`.
- `/consumption/products` browser — **national**, ~118k catalogue, trigram search + category facet (`DbDataTable`).
- `/consumption/deals` → `useDeals()` — **national**.

### Hard data constraint (shapes the whole design)
Per-**place** prices exist only for the **~100-product monitored basket** across **~245 covered settlements**. The 118k full catalogue carries only a **national** `current_min`. Raw `price_current.promo_eur` is per SKU **per store** and `price_stores` carries `obshtina`/geo — so *scoped promotions are computable*, but *full-catalogue local pricing is not*. Therefore:
- "Products near you" with real local prices = **the monitored basket**.
- The full catalogue stays national at the list level; it becomes location-aware only at the **`/product/:slug`** detail (already works).
- Coverage fallback ladder everywhere: **settlement → obshtina → oblast → national**.

---

## 2. Gaps to close

1. Region page lists settlements as **dead text** — no drill-down link.
2. Place page shows only **featured staples**, not the full local basket, and doesn't foreground promotions.
3. Products browser + Deals feed **ignore the `?area=` anchor** — always national.
4. No single **place-scoped consumption dashboard** that ties basket + products + promos together.
5. No **"promotions near me"** — the data supports it (per-store `promo_eur`), the serving layer doesn't emit it per geo.

---

## 3. Phased plan

### Phase 0 — Wire location into the Consumption view (foundation, ~small)
- **Region drill-down:** in `GovernancePricesTile.placeRow`, wrap the settlement name in `<Link to={/consumption/${p.code}}>` (settlement `code` = EKATTE, resolver-safe). One-liner, unlocks data already built.
- **Anchor-aware hub:** on `/consumption` (`ConsumptionScreen`), if `useAreaAnchor()` is set, show a prominent "Вашето място: {name}" CTA linking to `/consumption/<anchor.id>`; if not set, surface the `AreaSniperButton` inline ("Вижте цените край вас" → detect/pick → route to `/consumption/<ekatte>`).
- **Scoped nav:** add a `useConsumptionScopedHref` helper (mirror the procurement `useScopedHref` pattern) so links within the view carry `?area=` forward. Keeps the pinned place sticky across products/deals/category sub-pages.

### Phase 1 — Full local basket on the place page (no new ingest)
- Extend `MyAreaPricesTile` (or a new `PlaceBasketTile`) from FEATURED-only to the **full basket**: all products present in `place:<ekatte>`, grouped by `dict` category, each row = name · local min · cheapest chain+store (Maps link) · **promo badge** when `promoMin != null` (strikethrough min → promoMin).
- Sort within category by since-euro mover or by price; collapse long categories ("show all"). Reuses `useSettlementPrices(ekatte)` — data is already in the shard.
- Município-level (`:id` resolves to obshtina): fall back to `chains-muni` + the muni ranking row; show "pick a settlement for store-level prices".

### Phase 2 — Promotions near you (new scoped payload)
- **Serving:** add `deals-muni:<obshtina>` to `scripts/prices/build_payloads.ts` — same promo CTE as `deals` but `GROUP BY st.obshtina`, top-N per obshtina (mirror `chains-muni` keying). Obshtina (not settlement) chosen: a settlement often has ≤2 stores, obshtina gives a usable feed; still local. (`price_stores.obshtina` already indexed for `chains-muni`.)
- **Hook:** `useMuniDeals(obshtina)` → `fetchPricePayload('deals-muni', obshtina)`.
- **UI:** new "Промоции край вас" section on the place dashboard + make `/consumption/deals` anchor-aware — when `?area=` is set, show local deals with a "показва промоции в {obshtina}" caption and a "виж всички" link to the national feed; no anchor → national as today.
- Changelog: wire the new payload into `recent_updates` per the PG-changelog rule.

### Phase 3 — Location-aware full-catalogue browser (detail-level only, honest)
- Thread the anchored ekatte into `ProductsBrowserScreen`: rows keep the national min but link to `/product/:slug` **carrying `?area=`**, so the product page opens straight to local pricing (already supported). Add a one-line banner "цените по места се виждат в самия продукт" when an area is set — avoids implying per-row local prices we don't have.
- Optional stretch: for rows whose slug is in the monitored basket, show a local-price chip (join to the anchored `place` shard client-side — only ~100 slugs, cheap).

### Phase 4 — Unified place consumption dashboard + polish
- Restructure `/consumption/:id` into a proper dashboard shell (copy homepage shell per the dashboard-layout convention): header (place · basket % · rank) → sections: **Basket (full)** · **Промоции край вас** · **Cheapest chains** · **Biggest movers** · **Compare to oblast/neighbours**.
- Coverage/empty states across the ladder (settlement→obshtina→oblast→national); Sofia районы → city aggregate.
- SEO: keep place/region consumption nodes SPA-only, canonical → governance region (matches the current `RegionConsumptionScreen` decision).

### Phase 6 — AI chat tools (location-aware consumption)
The chat (`ai/`) already ships a price-tool family in `ai/tools/prices.ts` — `priceIndex`, `settlementPrices`, `cheapestChains`, `priceRanking`, `basketAffordability`, `basketVsInflation`, `euFoodPriceLevels`, `productPrice`, `chainProfile` — routed from `ai/orchestrator/router.ts`, which resolves a place from the query via the settlement/oblast locators. Gaps: no **promotions** tool, and no use of the app's active `?area=` anchor. Extend, don't fork (per the tools-architecture note).
- **New tool `localDeals`** (promotions near a place) backed by the Phase-2 `deals-muni:<obshtina>` payload: args `{ place?, product? }` → resolve place to an obshtina (settlement→its obshtina), fetch `deals-muni`, narrate the top current promos (product · was→promo · disc% · chain). `.catch(() => undefined)` on uncovered places like the other place tools. Register in `ai/tools/registry.ts`; parity with the `/consumption/deals` UI.
- **Extend `settlementPrices` narration** to expose the **full local basket + promo flags** (`promoMin`) it already fetches from the `place` shard — today it summarizes; surface per-category cheapest + "на промоция сега" so "цените в {place}" answers match the new dashboard.
- **Router intents:** detect promotions/deals queries ("промоции / намаления / оферти / deals / on sale в {place}" and bare "промоции край мен") → `localDeals`; keep the existing price intents. Add a `detectPriceDeal(q)` sync predicate mirroring `detectPriceProduct` / `detectChain`.
- **Ambient location.** Pass the app's active `?area=` anchor into the chat context (ambient place) so a place-less query — "какви са цените край мен", "има ли промоции наблизо" — resolves to the pinned location instead of asking. Falls back to `clarify` when no anchor and no place in the query.
- **Grounding + narration gates.** All new numbers go through the deterministic grounded-number gate (reject ungrounded/rounded figures in prose); EUR basis = Σ per-row (never re-summed); BG narration natural, not word-for-word; keep answers grounded to real fetched values.
- **Tests.** Add live-PG tool tests (mirror the existing price-tool tests under `ai/tests/`) for `localDeals` + the extended `settlementPrices`, asserting a covered obshtina returns promos and an uncovered place resolves to `undefined` (no throw).

### Phase 5 — Future (out of v1 scope, note only)
- Price-drop **alerts / watchlist** for a pinned place + product (reuse the `MyAreaAlertsTile` pattern).
- Per-store detail pages (raw `price_stores` exists; likely noise for a public dashboard — defer).

---

## Cross-cutting: performance (every phase, before shipping)
Applies to every new/changed DB query and payload build — do not ship a phase until this passes.
- **Measure first.** `EXPLAIN (ANALYZE, BUFFERS)` every new/changed query on the **worst-case entity** (biggest obshtina — Sofia `SOF00`/район set — and the highest-store-count settlement), not a toy row. Record the before/after timing in the phase's commit message.
- **New scoped-deals query (Phase 2).** The `deals-muni` CTE groups `price_current` × `price_stores` by `obshtina` — verify it uses the existing `chains-muni` supporting indexes; if it seq-scans, add a covering index (`price_stores(obshtina, store_id)` / `price_current(store_id) WHERE promo_eur IS NOT NULL`). Because it is precomputed into `price_payloads` at build time, the *serving* read stays an O(1) PK seek — the cost is build-time only; still measure the build query so a nightly rebuild doesn't blow up.
- **Matview / precompute decision.** Follow the existing prices pattern: anything whose live aggregation is >~200 ms goes into `price_payloads` as a precomputed blob (as `chain-products` and `chain-map` already do), NOT a live per-request query. If a new cross-place rollup is needed (e.g. "cheapest município near you"), add it as a **matview** feeding the payload build, refreshed in the same step as the rest of the prices rebuild — never a live join on the request path.
- **Index checklist (per the PG performance playbook).** Index every entity FK and **both sides** of every join key; guard `search + ORDER BY indexed-col + LIMIT` with the OFFSET-0 fence (it seq-scans under the parameterized prod plan even when a psql literal test looks fine); use `COALESCE` bounds, not `OR NULL`, on any windowed/date-scoped filter.
- **Payload determinism.** New `price_payloads` blobs must be deterministic (ROUND sums, rounded sort keys + eik/ekatte tiebreaks) so the parity test (`scripts/db/tests/prices_payload_parity.data.test.ts`) stays green.
- **Regression gate.** Re-run the prices payload parity test after any builder change; confirm the `/api/db/price-payload` seek latency is unchanged (single-row PK lookup).

## Cross-cutting: mobile / responsive QA (every UI phase, before shipping)
Naясно is FB-first / mobile-first — every new or changed surface must be verified on a phone viewport, not just desktop.
- **Drive it in the preview at mobile width** (375×812) via the Browser pane `resize_window` preset `mobile`, for each new/changed route: `/consumption`, `/consumption/region/:oblast`, the new `/consumption/:id` place dashboard, `/consumption/deals` (anchor-aware), `/consumption/products`.
- **Per-surface checks:** no horizontal body scroll; the full-basket table/rows reflow to a single column on phones (movers grid already does — match it); promo badges + cheapest-store + Maps link don't overflow the row; the `AreaSniperButton` / area pill and the "detect my location" CTA are tappable (≥44 px targets) and don't collide with the header search; sticky section headers behave; dark mode holds.
- **Interaction pass:** GPS-detect flow, settlement/município autocomplete, "show all" category expand/collapse, and every drill-down link all work by tap.
- **Proof:** capture a mobile screenshot of each changed surface and confirm no console errors (`read_console_messages`) before marking the phase done. Re-check desktop (1280) for the same routes so the wider layout isn't regressed.

---

## 4. Decisions (locked)
1. **Deals scope granularity** — ✅ **`deals-muni:<obshtina>`** (per-município: usable store density, mirrors `chains-muni` keying).
2. **Place page** — ✅ **Build the dedicated place dashboard shell first** (the Phase 4 restructure moves to the front), then fill its sections. `MyAreaPricesTile`'s featured-staples logic is folded into the new full-basket section rather than extended in place.
3. **Catalogue browser** — detail-level location only (honest re: data; no per-place pricing for the full 118k, which isn't available).

## 5. Sequencing (revised per decisions)
1. **Phase 0** — location plumbing (region drill-down links, anchor-aware hub, scoped href). Pure reuse, ship immediately.
2. **Phase 4 (shell) first** — build `PlaceConsumptionDashboard` at `/consumption/:id`: homepage-shell layout, header (place · basket % · rank), empty section scaffolding + coverage/fallback ladder.
3. **Phase 1** — fill the **Basket (full local)** section: whole basket grouped by category, cheapest store + Maps link + promo badge (from the `place` shard, no ingest).
4. **Phase 2** — **Промоции край вас** section + `deals-muni:<obshtina>` payload + anchor-aware `/consumption/deals`; wire `recent_updates`.
5. **Phase 3** — location-aware catalogue browser (thread `?area=` into product links).
6. **Phase 6** — AI chat tools: `localDeals` + ambient `?area=` + extended `settlementPrices` narration (after Phase 2 lands the `deals-muni` payload).
7. **Phase 5** — alerts/watchlist (later).
