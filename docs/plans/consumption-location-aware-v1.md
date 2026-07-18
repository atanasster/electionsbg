# Location-aware Consumption dashboard — v1 plan

**Goal.** Let a user pin a location (detect via GPS or pick a settlement/município) and see, *for that place*: the price basket, the full local product list with per-store cheapest prices, and the promotions currently running near them. Today the Consumption view has all the geo data in the serving layer but only surfaces a thin oblast tile and a curated "featured staples" list; nothing on the products browser or the deals feed is location-scoped.

---

## 1. What already exists (reuse, don't rebuild)

### Location backbone — already global
- **`?area=<id>` anchor** — `AreaAnchorProvider` mounted at the root, id = settlement EKATTE / obshtina / raion. Read via `useAreaAnchor()`, set via `useSetAreaAnchor()` (`src/data/area/areaAnchor.tsx`, `AreaAnchorProvider.tsx`). ⚠️ **URL-only — NOT persisted** (no localStorage; `setParams(..., {replace:true})`). A fresh load / bookmark / new session with no `?area=` starts anchorless — the anchor only survives navigation when links carry the search string forward (see §Audit A2).
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
- **Anchor-aware hub:** on `/consumption` (`ConsumptionScreen`), slot a banner between `<ConsumptionSearchTile>` and the `<TileHubGrid>` (`ConsumptionScreen.tsx:237-239`). If `useAreaAnchor()` is set → "Вашето място: {name}" CTA to `/consumption/<anchor.id>`; if not → the location picker.
  ⚠️ **`AreaSniperButton` is NOT free reuse** — its `goTo` hardcodes `navigate('/governance/'+id)` (`AreaSniperButton.tsx:80-92,105,216`). Fix path: **parameterize the sniper's destination** (prop `basePath="/governance" | "/consumption"`) rather than fork it — reusing its GPS + `useNearestSettlement` + autocomplete (all gated on `open`, so no ~980 KB payload on an idle hub). Do NOT build a parallel inline detector.
- **Scoped nav — reuse, don't add a helper:** `useScopedHref` (`src/data/scope/useScope.ts:63`) already forwards the **entire** search string, so it carries `?area=` for free. Route consumption links through it (they currently emit bare pathnames and drop all query params). No new `useConsumptionScopedHref` needed.

### Phase 1 — Full local basket on the place page (no new ingest)
- Extend `MyAreaPricesTile` (or a new `PlaceBasketTile`) from FEATURED-only to the **full basket**: all products present in `place:<ekatte>`, grouped by `dict` category, each row = name · local min · cheapest chain+store (Maps link) · **promo badge** when `promoMin != null` (strikethrough min → promoMin).
- Sort within category by since-euro mover or by price; collapse long categories ("show all"). Reuses `useSettlementPrices(ekatte)` — data is already in the shard.
- Município-level (`:id` resolves to obshtina): fall back to `chains-muni` + the muni ranking row; show "pick a settlement for store-level prices".

### Phase 2 — Promotions near you (new scoped payload)
- **Serving:** add `deals-muni:<obshtina>` to `scripts/prices/build_payloads.ts` — same promo CTE as `deals` but `GROUP BY st.obshtina`, top-N per obshtina (mirror `chains-muni` keying). Obshtina (not settlement) chosen: a settlement often has ≤2 stores, obshtina gives a usable feed; still local. (`price_stores.obshtina` already indexed for `chains-muni`.)
  - **Carry `latestDate`** in the blob (mirror `deals` at `build_payloads.ts:79-82`) so the UI shows an as-of date — otherwise the local feed loses the freshness affordance the national feed has.
  - **No promo expiry dates exist** — `promo_eur` is a snapshot column, not a validity window. Staleness is safe *only* because `price_current` is TRUNCATE+reload of the latest ingested day (`load_day.ts:322`), so an ended promo drops out next ingest. **Pipeline dependency:** `deals-muni` must be built *after* `price_current` reloads (same ordering the `deals` build already relies on) — note it in the build step.
  - Obshtini with 0 covered stores emit no key → `useMuniDeals` must treat a null/404 payload as "fall back to national", not an error.
- **Hook:** `useMuniDeals(obshtina)` → `fetchPricePayload('deals-muni', obshtina)`.
- **UI:** new "Промоции край вас" section on the place dashboard + make `/consumption/deals` anchor-aware — when `?area=` is set, show local deals with a "показва промоции в {obshtina}" caption and a "виж всички" link to the national feed; no anchor → national as today.
- Changelog: wire the new payload into `recent_updates` per the PG-changelog rule.

### Phase 3 — Location-aware full-catalogue browser (detail-level only, honest)
- Thread the anchored ekatte into `ProductsBrowserScreen`: rows keep the national min but link to `/product/:slug` **carrying `?area=`**, so the product page opens straight to local pricing (already supported). Add a one-line banner "цените по места се виждат в самия продукт" when an area is set — avoids implying per-row local prices we don't have.
- Optional stretch: for rows whose slug is in the monitored basket, show a local-price chip (join to the anchored `place` shard client-side — only ~100 slugs, cheap).

### Phase 4 — Unified place consumption dashboard + polish
- Restructure `/consumption/:id` into a proper dashboard shell (copy homepage shell per the dashboard-layout convention): header (place · basket % · rank) → sections: **Basket (full)** · **Промоции край вас** · **Cheapest chains** · **Biggest movers** · **Compare to peer group** (size-class / oblast — the `ranking` payload's `RankTriple`; there is **no geographic-adjacency / "neighbours"** data, don't imply it).
- **Coverage ladder is NET-NEW work, not reuse.** Today only **settlement→obshtina** exists (`MyAreaPricesTile` hides when both miss, `MyAreaPricesTile.tsx:74`) plus the Sofia-район→city rekey (`pricePlaceKeys.ts:38`). The **oblast and national rungs don't exist anywhere** — building them (fall back to `index.regions[oblast]` / national basket when a place has no shard) is new. Sofia районы → city aggregate.
- SEO: keep place/region consumption nodes SPA-only, canonical → governance region (matches the current `RegionConsumptionScreen` decision).

### Phase 6 — AI chat tools (location-aware consumption)
The chat (`ai/`) already ships a price-tool family in `ai/tools/prices.ts` — `priceIndex`, `settlementPrices`, `cheapestChains`, `priceRanking`, `basketAffordability`, `basketVsInflation`, `euFoodPriceLevels`, `productPrice`, `chainProfile` — routed from `ai/orchestrator/router.ts`, which resolves a place from the query via the settlement/oblast locators. Gaps: no **promotions** tool, and no use of the app's active `?area=` anchor. Extend, don't fork (per the tools-architecture note).
- **New tool `localDeals`** (promotions near a place) backed by the Phase-2 `deals-muni:<obshtina>` payload: args `{ place?, product? }` → resolve place to an obshtina (settlement→its obshtina), fetch `deals-muni`, narrate the top current promos (product · was→promo · disc% · chain). `.catch(() => undefined)` on uncovered places like the other place tools. Register in `ai/tools/registry.ts`; parity with the `/consumption/deals` UI.
- **Extend `settlementPrices` narration** to expose the **full local basket + promo flags** (`promoMin`) it already fetches from the `place` shard — today it summarizes; surface per-category cheapest + "на промоция сега" so "цените в {place}" answers match the new dashboard.
- **Router intents:** detect promotions/deals queries ("промоции / намаления / оферти / deals / on sale в {place}" and bare "промоции край мен") → `localDeals`; keep the existing price intents. Add a `detectPriceDeal(q)` sync predicate mirroring `detectPriceProduct` / `detectChain`.
- **Ambient location — mechanism is net-new.** The chat is a **standalone app** (`ai/App.tsx`) that reads its own URL (`ai/app/Chat.tsx:637` reads `?q=`) and has **no `?area=` awareness today**. So "pass the anchor in" needs a concrete channel — choose one: (a) the host app appends `?area=<id>` when it links into `/ai`, and the chat reads it alongside `?q=`; or (b) if we add localStorage persistence for the anchor (see Audit A2), the chat reads that shared key. Without one of these, a place-less "цените край мен" cannot resolve. Fall back to `clarify` when no anchor and no place in the query.
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
- **Prerequisite (Audit A1):** dev has no `/api/db` proxy, so the price screens render empty under `npm run dev`. Add a `/api/db` proxy to `vite.config.ts` (target prod or the functions emulator) *before* QA, or the preview shows blank tiles.
- **Drive it in the preview at mobile width** (375×812) via the Browser pane `resize_window` preset `mobile`, for each new/changed route: `/consumption`, `/consumption/region/:oblast`, the new `/consumption/:id` place dashboard, `/consumption/deals` (anchor-aware), `/consumption/products`.
- **Per-surface checks:** no horizontal body scroll; the full-basket table/rows reflow to a single column on phones (movers grid already does — match it); promo badges + cheapest-store + Maps link don't overflow the row; the `AreaSniperButton` / area pill and the "detect my location" CTA are tappable (≥44 px targets) and don't collide with the header search; sticky section headers behave; dark mode holds.
- **Interaction pass:** GPS-detect flow, settlement/município autocomplete, "show all" category expand/collapse, and every drill-down link all work by tap.
- **Proof:** capture a mobile screenshot of each changed surface and confirm no console errors (`read_console_messages`) before marking the phase done. Re-check desktop (1280) for the same routes so the wider layout isn't regressed.

---

## Audit findings (verified against code, 2026-07-18)

Corrections already folded inline above; these are the cross-cutting gaps the first draft missed:

**A1 — Dev has no `/api/db` proxy → the mobile-QA loop can't render data screens.** `vite.config.ts` proxies only `/api/scenarios` (`:158-163`). The consumption screens fetch price payloads from `/api/db/price-payload`, which 404s under `npm run dev`. **Fix:** add a dev proxy for `/api/db` (target prod `https://electionsbg.com` or the functions emulator) before the mobile/responsive QA step, else "drive it in the preview" is a no-op. Add to the mobile-QA cross-cutting section as a prerequisite.

**A2 — Anchor is URL-only, not persisted.** (See §1 note.) Decide explicitly: keep URL-only (matches the app's existing convention; returning users must re-detect) **or** add localStorage persistence (a returning user keeps their place, and it gives the chat's ambient-area channel for free — Phase 6). Small change, product call — raise before Phase 0.

**A3 — `/consumption/deals` & `/consumption/products` are prerendered + in the sitemap** (`scripts/prerender/routes.ts:1812,1836`; `scripts/sitemap/route_defs.ts:78-79`). Making them anchor-aware (Phases 2–3) must stay **client-only**: the prerendered HTML and canonical must remain the **national** version, `?area=` refines after hydration. Don't emit area-specific prerender variants. (Settlement/region consumption nodes are correctly SPA-only already — `route_defs.ts:162`.)

**A4 — i18n keys.** New consumption strings use inline `T(bg,en)`, but reused area/sniper copy uses `t()` keys (`my_area_*`, `area_sniper_*`). Any anchor-aware CTA reusing that copy needs matching keys in both locale files; new bespoke strings can stay inline `T()`. Enumerate the new keys per phase.

**A5 — Catch-all route is safe (note only).** `consumption/:id` is last (`routes.tsx:3576`) but React Router v6 ranks by specificity, so static segments win regardless. `:id` is always EKATTE/obshtina (digit/alnum dispatch, `useAreaResolver.ts:44`) — no collision with word segments. Just don't add a new bare `/consumption/<word>` without registering it as a static route.

**A6 — Under-addressed non-functionals.** No analytics events for the detect/drill CTAs; no frontend/route tests for the new `/consumption/:id` dashboard or the area-threaded links (repo has no FE test harness, so at least a manual checklist); promo-badge a11y (strikethrough → `promoMin` must not be conveyed by styling alone — add an sr-only "на промоция"). Add the `deals-muni` case to the payload parity test.

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
