# Consumption Hub v1 — plan, audit & EU price comparison

Status: PLAN (2026-07-18). Turns `/consumption` from a stack of dashboards into a
navigation-first **hub** (mirroring `ProcurementScreen`), adds a top search control,
several new sub-pages off data already in Postgres, grocery-**chain ↔ company** cross-corpus
links, and an **EU price comparison from official Eurostat price levels**. Fully wired:
watchers, README + `/data` docs, AI chat tools, sitemap, prerender, OG screenshots.

Builds on: `docs/plans/consumption-pg-v1.md` (the KZP→PG migration that shipped the
118k-product catalogue) and the procurement hub pattern (`procurement-dashboard-redesign-v1.md`).

---

## 0. Audit of the v1 brainstorm — what changed after grounding in code

The brainstorm was written against 7–39-day-old memory. Reconciling with current code
surfaced these corrections; the plan below reflects them:

1. **The view is more mature than the brainstorm implied.** Already shipped:
   `/consumption/products` (server-side `DbDataTable` over `price_products`),
   `/product/:slug` (cross-chain ladder + daily history), `EuroVerdictTile`, the price
   choropleth, and **7 AI price tools** (`priceIndex`, `settlementPrices`,
   `cheapestChains`, `priceRanking`, `basketAffordability`, `basketVsInflation`,
   `productPrice`). So the hub is **~70% reshape, ~30% new pages** — not a green field.

2. **Drop the scope control for v1.** Procurement's `ScopeControl` (parliament/year/all)
   has no clean analogue here; consumption's only real scope is "since euro day", which is
   already the baseline everywhere. A scope pill would be dead weight. The hub is
   national-first; geography is reached through search and the place ladder.

3. **OG: the two current pages use *different* paths.** `/consumption` is a **rendered
   card** (`renderStaticPageCard(...,"consumption.png")` → `dist/og/consumption.png`, not
   committed). `/prices` is a **committed Playwright screenshot** (`scripts/og/screenshot_prices.ts`
   → `public/og/prices.png`). The user wants *beautiful screenshots* → every new hub page
   (and a re-shot `/consumption`) goes on the **screenshot path**, not the card path.

4. **Sitemap has a hidden sync obligation.** `scripts/sitemap/route_defs.ts` also carries
   `ENGLISH_STATIC_PAGES`; any page that gets an `/en/` prerender mirror must be added in
   *both* places or the sitemap and prerender drift (header comment warns of this).

5. **Firebase file ceiling is a hard constraint** ([[project_firebase_deploy_ceiling]],
   453k-file dist). The handful of new hub sub-pages are free; the **118k `/product/:slug`
   pages must NOT all be prerendered** — SPA-only, prerender at most the top ~2–5k by
   coverage. The EU-compare page is a single national page (fine).

6. **The EU comparison uses official Eurostat price levels, not per-product matching**
   (see §1). Per-SKU cross-country matching (originally via Croatia's `cijene.dev`) was
   **dropped** — opaque/registered ToS + VAT/dual-quality caveats + a fragile gold set.
   Eurostat PLI (EU=100, per food category) is license-clean and the right altitude.

---

## 1. EU price comparison — official Eurostat price levels (cijene.dev dropped)

### 1.1 Decision: drop per-product cross-country matching; use Eurostat PLI

The v1 draft leaned on Croatia's `cijene.dev` for per-SKU matching. **Dropped** (2026-07-18):

- `cijene.dev` moved from open daily ZIPs to a **registered REST API with access tiers**;
  its `/docs`/`/pricing` are an opaque SPA and the terms for republishing *derived
  comparisons* are unverifiable. Operator call: don't build a public feature on it.
- Per-SKU matching also carried three load-bearing caveats — **VAT-inclusive** price
  differences (DE 7% / RO 11% / HR 25%), **JRC dual quality** (24–31% of branded samples
  differ in composition across MS), and the need for **PPS income adjustment** — plus a
  fragile ~50–150-SKU gold set. Wrong altitude for a civic site; high maintenance, low trust.

**Use official EU statistics instead.** The **Eurostat–OECD PPP programme** publishes
**Price Level Indices (PLI), EU-27 = 100**, from surveys of 2,000+ goods across 36 countries —
already comparable, VAT-handled, quality-adjusted at source, CC-BY 4.0. Greece's PosoKanei
ships a per-product EU compare (IT/FR/BE/RO/**BG**/CY/ES) but via **commercial Circana data** —
validation of demand, not a reusable source. `prc_dap*` (actual €/good) is **dead**
(discontinued 2015). Numbeo redistribution is forbidden. Eurostat PLI is the clean answer.

### 1.2 Source: `prc_ppp_ind_1` (COICOP 2018, EU=100)

- Dataset `prc_ppp_ind_1` — 64 analytical categories, COICOP 2018, applied Dec 2025 for
  2022–2024 (older years via `prc_ppp_ind`, COICOP 1999, 61 categories).
- **Food granularity available**: overall *food & non-alcoholic beverages*, plus sub-groups
  **bread & cereals, meat, fish, milk/cheese/eggs**, and further COICOP food classes
  (oils & fats, fruit, vegetables, sugar/confectionery) — enough for a per-category
  "cheaper/dearer than EU" view. BG food ≈ **86.8** vs EU=100 (illustrative).
- Coverage: 27 EU + 3 EFTA + 6 candidate; annual time series → a trend, not just a snapshot.

### 1.3 Data — extend the existing Eurostat pipeline (NOT a new source/scraper)

PLI is **not currently ingested** (`data/macro_peers.json` has no PPP/PLI fields). So add it
to the **existing** Eurostat fetch in `update-macro` (`scripts/macro/fetch_eu_peers.ts`) —
same license-clean JSON-stat API we already hit for HICP/GDP/COFOG. Emit a small `foodPli`
block into `macro_peers.json` (or a sibling `data/eu_pli.json`): per food category ×
{BG, peer set, EU=100}, latest + short series. No PG payload, no COPY, no `--eu` step, no raw
archive. This rides the **existing Eurostat watcher → `update-macro`** (see §3).

### 1.4 Page `/consumption/eu`

"Българската храна спрямо ЕС (=100)": per-food-category PLI bars (BG vs EU=100 vs a peer
set — reuse the `?peers=` selection + `Flag` component from `/indicators/compare`), a short
trend line, and a plain-language verdict ("хлябът у нас е N% под средното за ЕС"). Pair with a
PPS-adjusted note for honesty. Sourced entirely from Eurostat — zero republication risk.

---

## 2. Hub structure & pages (revised)

`/consumption` becomes navigation-first, copying `ProcurementScreen.tsx`:

```
Title + GovernanceBreadcrumb
ConsumptionSearchTile          ← the top search control (new)
[ My-basket digest tile ]      ← localStorage, mirrors WatchlistDigestTile
TileHubGrid (InfographicTile per sub-page, metric overlaid via consumption_hub_stats)
Featured categories strip (meat / bread / dairy / fuel …)
```

**Search control** — `src/screens/components/consumption/ConsumptionSearchTile.tsx`,
modeled on `ProcurementSearchTile`: one debounced box, grouped dropdown over
**products** (trigram on `price_products` → `/product/:slug`, reuse the existing endpoint),
**places** (→ `/consumption/:id`), **chains**, **categories**.

| Page | Route | Data | New? | Prerender | OG |
|---|---|---|---|---|---|
| Hub | `/consumption` | `consumption_hub_stats` | reshape | yes (exists) | **re-shoot** `consumption.png` |
| Overview (old dashboard) | `/consumption/overview` | existing tiles | move | yes | `consumption-overview.png` |
| Products browser | `/consumption/products` | `price_products` | exists | SPA-only | — |
| **My basket** | `/consumption/basket` | localStorage + ladder | NEW | yes (empty state) | `consumption-basket.png` |
| **Chains index** | `/consumption/chains` | `useNationalChains`/muni | NEW | yes | `consumption-chains.png` |
| **Chain profile** | `/consumption/chain/:eik` | `price_chains` + `chain-products` + `/api/db/company` | NEW | top ~10 chains | `consumption-chain.png` |
| **Deals** | `/consumption/deals` | promo price (~29% rows) | NEW | yes | `consumption-deals.png` |
| **Category** | `/consumption/category/:cat` | basket by group | NEW | top 14 | `consumption-category.png` |
| **Shrinkflation** | `/consumption/shrinkflation` | `net_qty` deltas | NEW | yes | `consumption-shrinkflation.png` |
| **EU compare** | `/consumption/eu` | Eurostat PLI (`foodPli` in `macro_peers.json`) | NEW | yes | `consumption-eu.png` |
| Product detail | `/product/:slug` | ladder + history | exists | top ~2–5k only | per-product card |
| Price map | `/prices` | choropleth | exists | yes | `prices.png` |

Tile numbers overlaid from a new pre-generated **`consumption_hub_stats`** payload (one
fetch), per procurement's `hub_stats.json`. Move the current national dashboard sections
(euro verdict, HICP, affordability, map) behind the **Overview** tile.

---

## 2A. Grocery-chain pages — retail ↔ money-flows cross-corpus join

The differentiator. A retail chain has an **EIK**, so it is already a company in our graph.
Every precondition is met in current code (verified 2026-07-18):

- **EIK is captured**, not discarded: `scripts/prices/lib/normalize.ts` (`parseChainFromFilename`)
  → `price_chains(eik PK, name, first_seen, last_seen)` (`scripts/db/schema/pg/048_prices.sql`),
  upserted daily in `scripts/prices/load_day.ts`. It is the **real Commerce-Register EIK** —
  same id space as `/company/:eik`.
- **EIK already reaches the browser**: `ChainRow { eik, chain, basket, nPriced, products }` in
  every `chains` / `chains-muni` payload (`src/data/prices/usePrices.tsx`). Today chain names
  render keyed on `eik` but **link nowhere** (`GovernancePricesTile`, `MyAreaPricesTile`).
- **`/company/:eik` (`src/screens/dev/CompanyDbScreen.tsx`) already aggregates the whole
  corpus**, each tile self-hiding by EIK: TR identity + officers + ownership %, political
  connections, procurement (contractor/awarder), EU funds (ИСУН), agri subsidies,
  related-entities, magistrates. A chain EIK lights up whatever it has, **zero backend work**.

**EIK spot-check (run 2026-07-18 against local PG — precondition CONFIRMED):** all 7 target
`price_chains` EIKs are the real umbrella-brand Commerce-Register EIKs and resolve in
`tr_companies`; 6/7 carry parsed officers (dm has 0 — the known TR officer-coverage gap). So
the `/company/:eik` link is **safe and correct — no EIK-override map needed** for these 7.

| Brand | EIK | TR? | officers | as supplier (contracts / €) |
|---|---|---|---|---|
| Метро (cash&carry) | 121644736 | ✓ | 15 | **81 / €4.1M** |
| Билла | 130007884 | ✓ | 9 | 0 |
| Кауфланд | 131129282 | ✓ | 11 | 0 |
| Лидл | 131071587 | ✓ | 5 | 0 |
| Фантастико | 206255903 | ✓ | 3 | 0 |
| Софармаси | 175334310 | ✓ | 3 | 0 |
| dm | 200150888 | ✓ | 0 | 0 |

**Reframe the value (important):** for pure retail the reliable cross-corpus payoff is
**TR ownership/connections**, not procurement — grocery chains don't win public tenders.
Only **Метро** (cash-and-carry, sells to institutions) has a real supplier footprint
(€4.1M). The self-hiding tiles handle this gracefully: a chain page shows ownership +
connections for everyone, and the procurement tile appears only for Метро. Don't headline
"procurement" for chains in the hub copy.

**Namesake landmine — EIK-only, never name (`метро` = subway):** name-matching "Метро" in
`contracts` returns €150M+ of subway-construction consortiums (Метробилд, Метрополитен,
metrology firms) — none of them the retailer. Метро cash-and-carry's real EIK 121644736 is
€4.1M. Keying strictly on the `price_chains` EIK (already mandated here) avoids this entirely;
never resolve a chain's procurement by name. See [[project_procurement_namesake_fix]].

**Three linkage levels, cheapest first:**

1. **Wrap chain names in a `<Link>`** (trivial, P2). Every chain row across the price UI
   (`GovernancePricesTile`, `MyAreaPricesTile`, the new `/consumption/chains` index) becomes
   `→ /consumption/chain/:eik`. Instantly connects retail to money-flows.

2. **Dedicated chain page** `/consumption/chain/:eik` (P2/P3) — the retail view + a
   money-flows strip:
   - **Retail (new `chain-products` payload)**: the products this chain carries, each with its
     **price rank vs other chains stocking the same product** (from `price_skus` / `price_grid_days`),
     basket position, `nPriced` coverage, promo intensity, cheapest-vs-dearest markers.
   - **Отвъд щанда ("beyond the shelf")**: embed a subset of the reusable company tiles
     (`CompanyTopContractsTile`, `CompanyFundsTile`, `CompanyRelatedTile`, `CompanyRiskChips`)
     by reusing the existing `fetch('/api/db/company?eik=')` call, plus a prominent
     "пълен профил на фирмата → /company/:eik" cross-link. Tiles are standalone components
     under `src/screens/components/procurement/` — not bound to the company screen.

3. **Reciprocal tile on the company page** (P3) — inject a **retail-prices tile** into
   `CompanyDbScreen` when `eik ∈ price_chains`: basket position, product count, cheapest-chain
   rank, link back to `/consumption/chain/:eik`. Extend `/api/db/company` with a small
   `retailChain` block (join to `price_chains` + latest chains payload). This closes the
   dual-corpus loop both directions, exactly like [[project_dual_corpus_leaderboard]]
   (ЗОП+ИСУН, EIK-exact).

**New data:** `chain-products` payload (jsonb, keyed by eik) + the `retailChain` block on
`/api/db/company`. No new external source — pure PG joins over `price_skus`/`price_grid_days`/
`price_chains` already loaded by `update-prices`.

**Prerender/OG:** `/consumption/chain/:eik` is dynamic → SPA-only except the top ~10 chains
(sitemap + prerender + a screenshot OG for those). Product-per-chain rank pages stay SPA-only.

---

## 3. Watchers + process-watch-report wiring

**No new watch source is needed** — the two new data surfaces both ride existing pipelines:

- **EU price levels** ride the **existing Eurostat watcher → `update-macro`**. The food PLIs
  are just extra series in `fetch_eu_peers.ts` (§1.3); when Eurostat releases, the macro
  watcher already flips and `update-macro` re-fetches. Add a one-line note to
  `.claude/skills/update-macro/SKILL.md` that it now also emits `foodPli`. No mapping change.
- **Grocery chains** ride the **existing `kzp_prices` watcher → `update-prices`** — `price_chains`
  and the `chain-products` payload are built in the same `npm run prices` run. No mapping change.

If we later want the EU release surfaced as its own line item, add a
`scripts/watch/sources/eurostat_ppp.ts` `WatchSource` (id `eurostat_ppp`, fingerprint = latest
`prc_ppp_ind_1` release date) → register in `scripts/watch/sources/index.ts` → map
`eurostat_ppp → update-macro` in `.claude/skills/process-watch-report/SKILL.md`. Optional
polish, not required for v1.

---

## 4. Docs

- **README.md**: (a) data-layout row for the `chain-products` payload + the `foodPli` block
  in `macro_peers.json`; (b) Data-sources bullet for **Eurostat PPP/PLI** (`prc_ppp_ind_1`),
  under the existing Eurostat group.
- **`/data` page** (`DataSources`): add **Eurostat PLI** to the existing Eurostat/macro
  source group (not a new external vendor) + i18n keys; add the new hub sub-pages to the
  `/data` map hub links where the data-map is generated.
- On `/consumption/eu`, cite "Източник: Eurostat (PPP programme, ЕС=100)" and the PPS-adjusted
  note inline.

---

## 5. AI chat tools

New tools in `ai/tools/prices.ts` (join the existing 7), each wired across the full
7-file path (impl → `ai/tools/registry.ts` → `ai/orchestrator/router.ts` →
`ai/app/followups.ts` → `ai/app/starters.ts` → `ai/tools/harness.ts` → `ai/tests/regression.ts`):

- **`euFoodPriceLevels`** — Eurostat food PLI by category: BG vs EU=100 vs a peer set, with
  the cheaper/dearer verdict and PPS note. Answers "по-скъпа ли е храната у нас от ЕС" /
  "цената на месото спрямо Европа". Router cues: `спрямо Европа/ЕС`, `в сравнение с ЕС`; must
  sit **before** the `isCompare` block (the `спрямо` trigger gotcha from the migration).
  (Category-level, not per-branded-product — matches the Eurostat source altitude.)
- **`chainProfile`** — one chain by name/EIK: retail position (basket, product count, promo
  share, cheapest-rank) **plus** a one-line money-flows summary (procurement € won as a state
  supplier, #contracts, top buyer) by joining the existing `/api/db/company` rollup. This is the
  chat surface of the §2A join — "какви обществени поръчки печели Кауфланд" answered with both
  the retail and the procurement footprint. Deep-links to `/consumption/chain/:eik`.
- (Optional) **`priceDeals`** and **`shrinkflation`** tools to back the new pages in chat.

Follow the router discipline from memory: EUR/Cyrillic stems use `[а-яё]*` not `\w`; strip
`от еврото` as a phrase; exclude `инфлация/данък/бюджет`. Add starters + per-tool followup
arms + harness assertions + regression cases; keep `ai:harness`/`ai:test` green.

---

## 6. Sitemap + static generation + OG screenshots

**Sitemap** (`scripts/sitemap/route_defs.ts`): add one `{ path, file }` per new page, e.g.
`{ path: "consumption/chains", file: "src/screens/consumption/ConsumptionChainsScreen.tsx" }`.
If a page gets an `/en/` mirror, also add its slug to `ENGLISH_STATIC_PAGES` (stay in sync).

**Prerender** (`scripts/prerender/routes.ts`): add a `staticPage({...})` node per new page
(BG + `english` bodies, `ogImage: "/og/consumption-<x>.png"`). Add each new hub sub-page to
`NAV_HUBS` in `bodyBuilders.ts` so all ~84k prerendered pages link to them (the discovery
fix that mattered for `/consumption` + `/prices`). **Do not** prerender the 118k product
pages — SPA-only, or top ~2–5k by coverage (Firebase ceiling).

**OG — beautiful screenshots** (the user's explicit ask): put every new page on the
**committed-screenshot path** like `/prices`. Per page add `scripts/og/screenshot_<page>.ts`
(Playwright, 1200×630, capture the live SPA against seeded data) → `public/og/consumption-<x>.png`;
**re-shoot `/consumption`** to replace the rendered card with a real screenshot. Filename
convention `<slug>.png` with `/`→`-`. Verify each capture in the browser preview before
committing (dev server via `preview_start {name}`, screenshot at desktop 1280×800 then the
1200×630 OG crop). The `ogImage` field on each prerender node points at these files.

---

## 7. Phasing

- **P1 — Hub shell.** `ConsumptionSearchTile` + `TileHubGrid` + move dashboard →
  `/consumption/overview` + `consumption_hub_stats` + re-shot OG. Structural unblock.
- **P2 — Tier-A pages** (data already in PG): basket, chains index, deals, category, **plus
  linkage level 1** (wrap chain names → `/consumption/chain/:eik`) and the **chain profile
  page** (retail tiles + reused company tiles). Each with sitemap + prerender + OG +
  (optional) AI tool. `chainProfile` AI tool here.
- **P3 — EU compare + reciprocal chain tile.** EU: extend `fetch_eu_peers.ts` for `foodPli` +
  `/consumption/eu` + `euFoodPriceLevels` AI tool + README/`/data` docs + OG (no ToS gate —
  Eurostat is clean). Chains: the **`retailChain` block** on `/api/db/company` + reciprocal
  tile on `CompanyDbScreen` (linkage level 3).
- **P4 — Differentiators.** Shrinkflation page + fuel indicator (EU Weekly Oil Bulletin,
  public/CC-BY — the one clean cost-of-living indicator beyond groceries).

---

## 8. Risks / open questions

- **EU comparison is category-level, not per-branded-product** (Eurostat PLI). Accepted: it's
  the right altitude for a civic site, fully license-clean, no VAT/dual-quality caveats, and
  it beats a fragile per-SKU match on trust. If a per-product view is ever wanted, revisit
  Open Food Facts Open Prices (CC0/ODbL) — not cijene.dev.
- **Deploy ceiling** — never mass-prerender product/chain pages (SPA-only beyond the top N).
- **Basket / alerts** are localStorage only (static SPA, no accounts) — matches Croatia/
  Trolley "favorites", not push notifications; set expectations in copy.
- **Scope control** deliberately omitted for v1 — revisit only if a time-window need appears.
