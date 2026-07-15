# Туризъм (Tourism) sector view — v1 plan & competitive brainstorm

Status: **RESEARCH + BRAINSTORM (not yet built)** — drafted 2026-07-14.
Closest built siblings to copy: **`kultura-view-v1.md`** (a single-ministry funder whose money is
grants/marketing rather than infrastructure — the nearest thematic analogue) and the shipped
**generic sector dashboard** (`SectorDashboardScreen` + `sectorDashboards.ts`) for the cheapest
first ship. `defense-pack-v1.md` remains the reference for the tile vocabulary, the multi-EIK group
rollup, and the date-scoping wiring.

> All corpus figures below are **MEASURED** from `data/procurement/awarders/176789478.json`
> (Ministry of Tourism, rebuilt 2026-07-14), not external estimates. €m = per-row `amountEur`, the
> PG basis. Visitor / seasonality / source-market figures are **ILLUSTRATIVE** placeholders and
> MUST be sourced from НСИ / ЕСТИ before any such tile ships (see §7).

Interactive concept mockup (reproduces the house shell + `?pscope` scoping live):
`https://claude.ai/code/artifact/3ab2a067-48f5-419e-ae0c-fb3ce7e8249b`

---

## Audit rev 1.1 (2026-07-14) — corrections that SUPERSEDE the text below

Verified every load-bearing claim against current code before implementation. Gaps found and closed:

1. **No `tourism_nav` breadcrumb key for Phase 1.** The generic dashboard reuses `config.titleKey`
   for its breadcrumb (`SectorDashboardScreen.tsx:103` → `<SectorBreadcrumb currentKey={config.titleKey}/>`).
   The `*_nav` keys are only for BESPOKE screens (Culture uses `currentKey="culture_nav"`). Phase 1
   needs ONLY `sector_tourism_title` + `sector_tourism_desc`. §9's `tourism_nav` is Phase-2-only.

2. **No server allow-list to widen — delete that concern.** `functions/db_table.js:48` already
   whitelists the `awarder_eik` COLUMN with `filter:"in"` (values are not listed); the
   `awarder-group-model` endpoint (`db_routes.js:707`) parses `eiks` as `/^\d{9,13}$/`, `.slice(0,300)`,
   accepting any EIK set. `176789478` (9 digits) passes. The `sectorPacks.tsx` comment "(and the
   server allow-list)" refers to that existing column whitelist — **no Functions/SQL change.**

3. **`sector_stats.json` regen needs a LIVE Postgres** (`sector_stats.ts` imports `../lib/pg`, runs
   SQL per scope) — NOT a trivial rerun. But it feeds ONLY the hub-tile € badge; the dashboard KPIs
   come from the runtime `/api/db/awarder-group-model` call. The hub degrades gracefully (tile shows
   no € until a DB-connected `db:gen-sector-stats` runs). → **Non-blocking; deferred.** §4 step 6 and
   §9's "rerun `db:gen-sector-stats`" must be read as "requires PG; hub badge only".

4. **Accent DECIDED: `TILE_ACCENTS.aqua`** (#1f9e94, NEW token). Re-checked at build time: all 16
   existing tokens are now used (energy took `copper`), so a fresh token was added to
   `tileAccents.ts` — a sea-aqua that stands out among the earthy "land & culture" cluster
   (agri=gold, culture=terracotta) and evokes the Black Sea. Supersedes §10 decision 3 (and the
   earlier "copper" note — copper is taken).

5. **EIK uniqueness CONFIRMED** — exactly one awarder file matches "Министерство на туризма"
   (`176789478.json`). No dedup/alias work (contrast transport's MTITC concern). Ship single-member.

6. **Cluster DECIDED: `sectors_cluster_land`** ("Земя и култура" / "Land & culture"), next to Culture —
   culture & tourism are sibling ministries; zero new i18n keys. Supersedes §10 decision 2.

7. **Render path CONFIRMED** (`SectorDashboardScreen.tsx:80-180`): `getSectorPack(leadEik)` returns
   `null` for a non-pack EIK → `useAwarderGroupModel` runs → KPI row + spend-by-year + top-contractors
   + `<ScopeControl mode="toggle">` (date scoping) + `SectorAwardersTile`. Pure config, no new screen.

**Net Phase-1 surface: 6 edits (1 new file) + 1 deferred PG pipeline line.** No route/server/SQL change.

### Code-repair pass (2026-07-15) — CODE_REVIEW_REPORT.md findings applied

All 5 findings implemented + stabilized (lint → tsc → build → test all green):
- **FINDING-001 (bug)** — removed the duplicate `SECTOR_PAGES` tourism entry (a concurrent worker's
  generic copy) in `scripts/prerender/routes.ts`; kept the richer advertiser-thesis entry. Added a
  duplicate-id guard next to the existing coverage assert. Verified: exactly 1 `sector/tourism` route.
- **DUP-001 / DUP-003** — extracted a shared `src/lib/tourismLabels.ts` (`TOURISM_MARKET_NAMES_BG`
  superset + `MONTH_NAMES_BG/EN`); the source-markets tile, seasonality tile and AI tool now import it
  (the AI map had drifted, lacking RU/BE/CH/…). Tile-specific single-letter axis labels stay local.
- **DUP-002** — added `formatCompact` to `@/lib/currency` (the non-€ sibling of `formatEurCompact`);
  the 3 tiles now import it instead of each defining an identical helper.
- **TEST-001** — `scripts/db/tests/tourism_classifier.data.test.ts` (node `--test`) locks the CPV→bucket
  mapping (advertising/events/research/digital/production/other). Passes 3/3 standalone.
Verified live: source-markets, seasonality and ROI tiles still render (Румъния 22%, peak август) — the
refactor is behavior-preserving. `CODE_REVIEW_REPORT.md` left in the repo root (reviewer artifact).

### Self-audit (2026-07-15)

Full audit of all uncommitted changes (26 files). Whole suite green: `tsc -b`, `eslint` (every changed
file), `vite build` (✓ 53s), `build_manifest` gate, locales valid JSON, watcher fingerprint live, AI
registry parses (188 tools).

Findings:
1. **BUG FOUND + FIXED — multi-member "Изпълнители" link.** The generic `KpiCard` contractors link I
   added pointed to `/awarder/<leadEik>/contractors` for ALL sectors, but `energy` is multi-member (9
   EIKs) — its supplier COUNT spans the group while that link shows only the lead's contractors (a
   misleading subset). Fixed: the contractors drill-down is now single-member-only
   (`config.members.length === 1`); energy's tile is non-linked (money/contracts still link to the
   group browse, top-contractor to the company). Verified live: energy `Изпълнители → null`, tourism
   `→ /awarder/176789478/contractors`.
2. **OPEN — CPV terminology inconsistency (needs a call).** Renaming the CPV filter сектори→категории
   fixed the on-page collision the user flagged, but the app elsewhere still calls CPV divisions
   "сектори" (`/procurement/sectors` = "Какво купува държавата", "Виж всички сектори", the ProcurementSectorsTile).
   So the CPV *filter* now says "категории" while the CPV *breakdown* pages say "сектори" — a mild
   cross-page mismatch (different pages, same taxonomy). Options: (a) accept it — the pages are separate
   contexts and the collision fix is worth it; (b) extend "категории (CPV)" app-wide (~7 i18n keys +
   the /procurement/sectors page). Left for a decision; not auto-changed.

Clean checks: `aqua` accent unique; no TODO/FIXME/stray console (the fetch script's `console.log` is CLI
output); `data/tourism/` bucket-syncs (not PG-excluded); spend-vs-nights zero-bar floor never triggers
(all overlap years have spend); prerender emits `sector/tourism` bg+en; only intended files touched
(the two `nzok/*` in `git status` are a concurrent worker's, not mine).

### Term disambiguation (2026-07-15)

Drilling from a government **sector** (Туризъм) into `/procurement/contracts?sector=tourism` showed a
CPV-division filter also labelled "Всички **сектори** (CPV)" — two different "sector" meanings on one page.
Renamed the CPV filter's user-facing term from **сектори → категории (CPV)** so "сектор" is reserved for the
government entity: `CpvFilterCombobox.tsx` (trigger + item + search placeholder, hardcoded strings) and the
`company_contracts_all_cpv` i18n key (bg/en) + its `CompanyContractsDbScreen` fallback. Verified live: the
banner reads "…поръчките на: Туризъм", the dropdown now reads "Всички категории (CPV)". App-wide change
(shared CPV combobox), not tourism-only.

### KPI drill-downs (2026-07-15)

The generic `KpiCard` (SectorDashboardScreen) gained an optional `to` prop → the whole tile becomes a
drill-down link (hover border). Wired for EVERY config-driven sector (not just tourism): **Общо
възложени** + **Договори** → `/procurement/contracts?sector=<id>` (scope carried forward), **Изпълнители**
→ `/awarder/<leadEik>/contractors` (the awarder's full contractors list), **Топ изпълнител** →
`/company/<eik>` (that specific contractor). Verified live on tourism: hrefs resolve to
`…?pscope=all&sector=tourism`, `/awarder/176789478/contractors`, `/company/831727361` (Апра); all target
pages load.

### Phase 1 SHIPPED (2026-07-14)

Generic `/sector/tourism` is wired and live. Files landed:
`src/lib/tourismReferenceData.ts` (new) · `src/ux/infographic/tileAccents.ts` (+`aqua`) ·
`src/screens/sector/sectorDashboards.ts` (`SECTOR_DASHBOARDS.tourism`) ·
`src/screens/components/procurement/sectorPacks.tsx` (`SECTOR_BROWSE_PACKS.tourism`) ·
`src/screens/governance/sectorRegistry.ts` (land cluster, aqua) ·
`src/screens/governance/sectorScenes.tsx` (sun/sea/sailboat scene) ·
`src/locales/{bg,en}/translation.json` (`sector_tourism_title`/`_desc`) ·
`scripts/db/gen_procurement/sector_stats.ts` (`tourism` in `SECTOR_EIKS`) ·
`scripts/prerender/routes.ts` (`SECTOR_PAGES` tourism SEO copy — REQUIRED: a build-time guard
`assertAllSectorsHavePrerenderCopy` fails prerender if a `SECTOR_DASHBOARD_IDS` sector lacks copy;
verified `prerenderRoutes()` emits `sector/tourism` bg+en). The sitemap needs no edit — it derives
slugs from `SECTOR_DASHBOARD_IDS`.

Verified: `tsc -b` clean, `eslint` clean, full `vite build` clean (4837 modules), locales valid
JSON, dev server serves `/governance/sectors` + `/sector/tourism` → 200.

Deferred (needs live Postgres): `npm run db:gen-sector-stats` to populate the hub-tile € badge for
tourism in `sector_stats.json`. The dashboard itself needs no regen (KPIs come from the runtime
`/api/db/awarder-group-model` call).

### Phase 2 IN PROGRESS (2026-07-15) — campaign-category tile

Rather than a full bespoke screen (which the NSI fork §10.4 blocks), Phase 2 starts with the
highest-value all-real differentiator via the config's `ThematicTiles` slot — no NSI needed.

Landed (uncommitted, pending review):
- `src/screens/sector/tourism/tourismCategories.ts` — `tourismClassifier` (CPV→campaign category)
  + `TOURISM_CAT_LABELS`. Validated on the real 303-row corpus: advertising ~53%, production ~14%,
  operational ~11%, events ~9%, digital ~9%, research ~4%. Classifies by CPV ONLY.
- `src/screens/sector/tourism/TourismThematicTiles.tsx` — TWO tiles in a responsive grid:
  (1) **"Разход по кампании"** — per-category €/%, contract count, single-bid rate, top supplier;
  reuses the dashboard's own group-model fetch (deduped → free), inherits `?pscope`.
  (2) **"Най-големи кампании"** — biggest individual contracts by name, with contractor link, year,
  EU-funded badge and single-bid flag; pulls МТ's 300-row corpus once via `useAwarderContracts` +
  `scopeByWindow` (prod-safe `awarder-contracts` endpoint), also `?pscope`-scoped. Each title links to
  the contract detail page `/procurement/contract/:key` (verified: opens the full risk/normalcy view);
  a **"виж всички →"** header link goes to `/procurement/contracts?sector=tourism` carrying the current
  scope forward (the browse pack filters to "Туризъм (МТ)", 300 rows).
- `sectorDashboards.ts` — `SECTOR_DASHBOARDS.tourism.ThematicTiles` (lazy).

Verified live on `/sector/tourism?pscope=all`:
- Category split: **Реклама и медиа €14.4M · 53% · 98% single-bid** (the headline transparency
  signal), matching the offline CPV validation.
- Biggest campaigns: **BBC News Channel airtime €1.1M (2024, 1 bid)**, VisitBulgaria.com platform
  €1M (2025), Apra media campaign €740.6K (2018) — real named campaigns.
- tsc -b + eslint clean.

Follow-on tiles ADDED (2026-07-15):
- **"Най-големи кампании"** — biggest individual contracts by name (BBC airtime €1.1M, VisitBulgaria.com
  €1M), EU-funded + single-bid flags, via the prod-safe `awarder-contracts` endpoint + `scopeByWindow`.
- **"Сезонност на нощувките"** — the VISITOR-OUTCOME layer, REAL Eurostat data (no NSI-ingest decision
  needed after all): `scripts/tourism/fetch_eurostat_tourism.ts` pulls `tour_occ_nim` (monthly nights,
  foreign vs domestic, hotels/I551) → `data/tourism/visitors.json` → `useTourismVisitors` +
  `TourismSeasonalityTile`. Verified live: **summer (Jun–Sep) = 79% of foreign nights, peak August,
  15.8M foreign nights 2025**, sourced to Eurostat. This is the spend↔outcome fusion the competitive
  research (§6) flagged as the differentiator — shipped with real data.
  - §10.4 RESOLVED: the visitor layer uses **Eurostat** (public JSON-stat REST, reachable, no auth) —
    NOT gated on NSI. NSI/ЕСТИ stays a future enhancement for resort-level / source-market detail.
  - The fetcher is a standalone `tsx` script (like the macro fetchers); `data/tourism/` bucket-syncs
    normally. Re-run on a cadence (Eurostat updates monthly); optionally register in the refresh pipeline.

- **"Реклама и чужди нощувки"** (spend↔outcome bridge) — ADDED. `TourismSpendVsNightsTile` overlays
  the ministry's marketing € per year (real procurement) on foreign nights per year (real Eurostat,
  from `visitors.json` `annualForeign`) as an inline-SVG bars+line chart. NO new data source — both
  series already on the page. Framed DESCRIPTIVELY ("trends side by side — not a causal claim"),
  dual-sourced (ЗОП + Eurostat). Full-history, not `?pscope`-scoped. Verified live, no console errors.

The `/sector/tourism` ThematicTiles now render a 2×2: visitor-outcome row (seasonality +
spend-vs-nights) over the procurement row (categories + biggest campaigns) — the complete
spend↔outcome fusion, all real.

- **"Пазари на произход"** (source markets) — ADDED. The correct Eurostat dataset is
  **`tour_occ_ninraw`** (nights by country of origin; earlier `ninrt`/`arnrt` guesses 404'd — a wrong
  code, not a missing dataset). The fetcher pulls it, keeps individual foreign countries (2-letter ISO,
  minus BG/EU), and `TourismSourceMarketsTile` renders the top markets with BG-localized names. Verified
  live: **Romania 22%, Ukraine 11%, Poland 10%, UK 9%, Germany 8%, Czechia 6%** (2024) — the real
  concentration (top market = 1/5 of foreign nights) is itself a policy signal. Source: Eurostat.

The ThematicTiles now render: **visitor row** (seasonality + source markets) → **fusion** (spend-vs-
nights, full width) → **procurement row** (categories + biggest campaigns) — all real, all verified live.

Remaining follow-ons (optional): (a) Tier-B EIK verification — DONE (§3, empty); (b) NSI resort-level
detail (Sunny Beach / Bansko splits) — a bigger Infostat ingest, deferred, not fabricated. A bespoke
`/tourism` screen is only warranted if these tiles outgrow the ThematicTiles slot.

### Cross-cutting integration of the new Eurostat data (2026-07-15)

The `data/tourism/visitors.json` blob is wired into every system a first-class dataset touches:

- **Watchers / process-watch-report** — `scripts/watch/sources/eurostat_tourism.ts` fingerprints the
  `updated` field of `tour_occ_nim` + `tour_occ_ninraw` (cadence monthly), registered in
  `scripts/watch/sources/index.ts`. `npm run watch` now reports a tourism-data release. Placed on the
  data map (below) — mandatory, or `build_manifest` fails.
- **Data map + data pages** — added `eurostat_tourism` to the "eurostat" source group and an
  `AI_PATH_RULES` entry `/tourism/ → indicators` in `scripts/data_map/model.ts`; `build_manifest`
  regenerated `data/data_map.json` (93 watched sources). `/data/map` is model-driven (auto). `/data/sources`
  is curated — added a Eurostat-tourism `SourceItem` + `eurostat_tourism_source` i18n key (bg/en).
- **AI chat tools** — `ai/tools/tourism.ts` (`tourismSeasonality`, `tourismSourceMarkets`) modeled on
  `culture.ts` (Envelope/facts, domain `indicators`), registered in `ai/tools/registry.ts` (188 tools).
  The explorer can now answer "when is Bulgaria's tourism season?" / "where do tourists come from?".
- **Docs** — `README.md` "Other scripts" block lists `npm run data:tourism`; `package.json` carries the
  script (mirrors `data:nzok`).

Verified: `tsc -b` + `eslint` clean, `build_manifest` green, watcher fingerprint returns live Eurostat
timestamps, registry parses with both tourism tools present.

### Performance & responsive (tested 2026-07-15)

**Data loading — measured, no migration/index needed.** Evidence from the local PG (:5433):
- `awarder-contracts` (tourism EIK, 303 rows) → **2.7ms**, Bitmap Index Scan on the existing
  `idx_contracts_awarder_date` composite (`awarder_eik, date`) — exactly what
  `WHERE awarder_eik ORDER BY date` needs.
- `awarder_group_model(['176789478'])` → **3.9–9.7ms**.
- `data/tourism/visitors.json` is a **2.8 KB** static reference blob → correctly NOT in PG (matches the
  culture/macro/indicators JAMstack convention; a DB round-trip would cost more than the payload). The
  procurement side is already PG + indexed. **Conclusion: nothing to migrate, no index to add** — a
  redundant index would only add write cost. (Verdict is measured, not assumed.)

**Responsive — audited at 375 / 768 / 1280, one fix.** No page-level horizontal overflow at any width
(`document.body.scrollWidth` == viewport). Thematic tiles use `grid md:grid-cols-2` → stack to 1 column
on mobile, 2 columns on tablet/desktop (verified 737px columns at 768). The generic spend-by-year tile
scrolls inside its own `overflow-x-auto` container on narrow screens (existing house pattern). Fixes
applied:
1. The source-market value (`3,3 млн. · 22%`) was wrapping to two lines in a fixed `w-20` column →
   switched to `whitespace-nowrap` (auto width) + narrowed the country label to `w-24`; now single-line
   (h:16px) at 375px.
2. **`TourismSpendVsNightsTile` chart towered over every other chart** — it used a `viewBox` SVG with
   `w-full h-auto`, so its height scaled with the (full-width) tile → ~430–700px on desktop while
   siblings are fixed-height (seasonality 150, spend-by-year 220). Rebuilt it the house way: a
   FIXED-height (`170px`) container with HTML spend bars + an SVG line overlay (`preserveAspectRatio="none"`
   + `vector-effect="non-scaling-stroke"`, so no text/stroke distortion) + HTML round vertices + HTML year
   labels. Now fixed-height / fluid-width like the others (measured inner height = 170px at any width).
   Follow-up: the first cut of that rebuild set the bar `height` as a `%`, which collapses to 0 against
   the auto-height flex item (only the line showed) — switched to **pixel** heights
   (`(spend/maxSpend) * (CHART_H-8)`), the same approach seasonality / spend-by-year use. Both series now
   render (measured 8 bars, e.g. 2024 → 162px, 2022 → 17px).

Long country names / campaign titles / contractor names clip via `truncate` (ellipsis) as designed.

---

## 1. Goal & thesis

Give the **Ministry of Tourism (Министерство на туризма, ЕИК 176789478)** a proper sector
dashboard at `/sector/tourism` (Phase 1) and — if warranted — a bespoke `/tourism` screen
(Phase 2), consistent with the other government-entity dashboards.

The thesis is the differentiator. The Tourism ministry's procurement is **overwhelmingly
destination marketing** — the money buys media, broadcast air-time and PR, not roads or drugs. So
the dashboard answers a question no ordinary tourism portal answers:

> **Where does Bulgaria's tourism-marketing money go — and what visitor outcome does it buy?**

The competitive research (§6) is blunt on this: national tourism dashboards publish visitor KPIs;
budget dashboards publish agency spend; **almost none fuse the two.** electionsbg already owns the
public-money layer — layering NSI visitor context on top of the real ЗОП spend is the "world's
best" move that is uniquely ours to make.

### Measured shape of the corpus (why this is a marketing story)

`data/procurement/awarders/176789478.json` — Ministry of Tourism, seat София (BG411):

- **€27.26M** total contracted · **300** contracts · **144** unique suppliers · 2014→2026.
- Spend by year (€, contracts): 2014 0.10M/1 · 2015 0.31M/8 · 2016 0.74M/13 · 2017 1.08M/25 ·
  **2018 4.90M/39** · 2019 1.41M/25 · 2020 2.89M/17 · 2021 2.07M/29 · 2022 0.70M/17 ·
  2023 1.49M/37 · **2024 6.85M/38** · 2025 3.73M/34 · 2026 1.00M/17. Two clear campaign peaks
  (2018, 2024).
- Top suppliers (measured `totalEur`): **Апра ООД €2.09M** (PR/agency, 7) · Директ медия крес
  €1.62M (media buying, 3) · Нова броудкастинг €1.62M (TV, 4) · **BBC Global News €1.10M** (intl
  broadcast, 1 — the single largest contract, 2024) · Медиа планинг груп €1.09M · БНТ €1.07M ·
  Моудшифт европа €1.01M · Арка Л.Т.Д. €0.96M (events) · bTV €0.94M · Формат вижън €0.87M.
- Top-10 suppliers are ~all media/broadcast/PR ⇒ the "63% media & advertising" framing is
  defensible and is the lead narrative.

---

## 2. What ALREADY exists (do NOT rebuild)

This is mostly a **presentation + config** project. The machinery is shipped:

- **The awarder record** — `176789478.json` served at `/awarder/176789478`, with `byYear`,
  `byContractor`, `topContracts`. The generic dashboard rolls this up automatically.
- **Generic sector dashboard** — `src/screens/sector/SectorDashboardScreen.tsx` (`/sector/:id`),
  config in `src/screens/sector/sectorDashboards.ts`. Adding a sector = a config object; a KPI row
  + spend-by-year + top-contractors + awarders tile render with no new screen file.
- **Sector hub + registry** — `src/screens/governance/sectorRegistry.ts` (`SECTOR_CLUSTERS`),
  `GovernanceSectorsScreen`, `sectorScenes.tsx`. A new sector appears in nav automatically once in
  the registry (the header only links the hub, `reportMenus.ts`).
- **Browse packs** — `SECTOR_BROWSE_PACKS` in `sectorPacks.tsx` gates `?sector=<id>` on
  `/procurement/contracts|tenders`. Server side, `functions/db_table.js` already allow-lists
  `awarder_eik IN (…)` — **no Functions/SQL change is needed** for a new multi-EIK sector.
- **Date scoping** — `src/data/scope/` (`useScope`, `useScopeWindow`, `scopeRange`) + the shared
  `ScopeControl` pill. `SectorDashboardScreen` already renders it, so Tourism inherits `?pscope`
  for free (see §5).
- **Sector-tile € on the hub** — `scripts/db/gen_procurement/sector_stats.ts` (`SECTOR_EIKS` map)
  → `data/procurement/derived/sector_stats.json`, precomputed per scope, bucket-synced.

### Not built (this plan's work)

- A curated `TOURISM_SECTOR_EIKS` allowlist (§3).
- Config wiring: `sectorDashboards.ts`, `sectorRegistry.ts`, `sectorScenes.tsx`, `sectorPacks.tsx`,
  i18n keys, `sector_stats.ts`.
- (Phase 2) A bespoke `/tourism` screen + NSI/ЕСТИ visitor data blobs under `data/tourism/`.

---

## 3. Туризъм as an EIK set — allowlist (VERIFIED 2026-07-15)

Linkage to a sector in this repo is a **curated buyer-EIK allowlist**, never a CPV or keyword
classifier (both false-positive badly — see the warnings in `defenseReferenceData.ts` /
`kulturaReferenceData.ts`). Shipped in `src/lib/tourismReferenceData.ts`.

> **Tier-B verdict: EMPTY → ship single-member.** A full scan of the awarder corpus for state
> tourism bodies (name contains туриз*/туристическ*, minus schools/private) returns exactly TWO
> hits: the anchor **176789478 Министерство на туризма** (€27.26M), and **130169256 МИЕТ**
> (Министерство на икономиката, енергетиката и туризма — the pre-2014 combined Economy+Energy+
> Tourism ministry, €16.8M, 2011–2015). МИЕТ held tourism before МТ was split out, but its spend is
> a MIXED economy/energy/tourism mandate that cannot be separated by EIK, so it is **EXCLUDED** (a
> textbook anti-allowlist case). No clean subordinate tourism agency / regional centre exists in the
> corpus. The single-member set is therefore correct, and the exclusion is documented in
> `tourismReferenceData.ts` so МИЕТ isn't naively added later.

- **Tier A — the anchor (VERIFIED):** `176789478` Министерство на туризма (€27.26M, seat BG411).
- **Tier B — verify principal before including:** subordinate / second-level spending units under
  the Minister of Tourism, and any state tourism-promotion body. Candidates to probe in the corpus
  (do NOT include unverified): a national/executive tourism agency, regional tourist information
  centres funded by МТ, the "Обединена система за туристическа информация (ЕСТИ)" operator.
- **EXCLUDE — the anti-allowlist:** the many `Професионална гимназия по туризъм …` (vocational
  tourism *schools*, principal = МОН, municipal) that match "туризъм" by name; private firms with
  "туризъм" in the title; municipal tourism departments (principal = the община, not МТ). These are
  the reason a name/keyword classifier is forbidden here.

Until Tier B is verified, ship as a **single-member sector** (anchor only) — identical to
health/roads/revenue. Multi-entity model to copy if Tier B lands: `MO_ENTITIES` in
`defenseReferenceData.ts` (per-entity group tags).

---

## 4. Architecture — two-phase, generic first

### Phase 1 — generic `/sector/tourism` (cheapest real-data ship)

Add config; no new screen. Delivers the real €27.26M dashboard with date scoping today.

1. `src/lib/tourismReferenceData.ts` — `TOURISM_SECTOR_EIKS = ["176789478", …verified]`,
   `TOURISM_LEAD_EIK`. The one load-bearing new artifact.
2. `src/screens/sector/sectorDashboards.ts` — add `SECTOR_DASHBOARDS.tourism`
   (`leadEik: TOURISM_LEAD_EIK`, `members`, `browsePackId: "tourism"`, `agency: "МТ"`,
   `titleKey/descKey`).
3. `src/screens/components/procurement/sectorPacks.tsx` — add `tourism` to `SECTOR_BROWSE_PACKS`
   (`eiks: TOURISM_SECTOR_EIKS`). Enables `?sector=tourism`. No server change.
4. `src/screens/governance/sectorRegistry.ts` — add a `Sector` entry (`id: "tourism"`,
   `to: "/sector/tourism"`, `agency: "МТ"`, an `accent` token). Cluster: a new
   `sectors_cluster_economy` (with revenue/customs?) or fold into `state`. (Decide at build.)
5. `src/screens/governance/sectorScenes.tsx` — a `Tourism` SVG scene under key `"tourism"`
   (sun/coast + trend line, reusing the `Bars`/`TrendLine` scene primitives).
6. `scripts/db/gen_procurement/sector_stats.ts` — add `tourism: TOURISM_SECTOR_EIKS` to
   `SECTOR_EIKS`; rerun `npm run db:gen-sector-stats` → hub tile € populates across every `?pscope`
   bucket (`sector_stats.json` is already bucket-synced).
7. i18n — `sector_tourism_title` / `sector_tourism_desc` (+ `tourism_nav` breadcrumb label) in
   `src/locales/{en,bg}/translation.json`.

### Phase 2 — bespoke `/tourism` screen (the "world's best" story)

Clone the **Culture** vertical end-to-end (nearest thematic sibling — a ministry whose money is
programmatic, not km of road):

- `src/screens/culture/*` → `src/screens/tourism/*` (screen + tiles)
- `src/data/culture/*` → `src/data/tourism/*` (`useTourism`, `types.ts`, `scopeTourismOverview.ts`)
- `data/culture/*.json` → `data/tourism/*.json` (served at `/tourism/*.json` via the `serve-data-dir`
  overlay; fetched through the `dataUrl()` seam)
- `scripts/culture/*` → `scripts/tourism/*` (ingest from НСИ / ЕСТИ)
- Wire `routes.tsx` (lazy import + `<Route path="tourism">`), point the registry `to: "/tourism"`.

Keep `<SectorBreadcrumb>`, `<ScopeControl>`, `<StatCard>`, and the `useScope`/`scopeYear` +
`scopeTourismOverview(data, year)` re-aggregation pattern **verbatim** — those are load-bearing
conventions.

---

## 5. Date scoping — the explicit requirement (identical to other sectors)

Reuse `src/data/scope/` unchanged. `Scope = "ns" | "all" | "y:<year>"`:

- **`ns`** — the selected parliament's contract window `[selected election, next election)`
  (default; omitted from the URL to keep it canonical).
- **`all`** — `?pscope=all` — full corpus (null, null).
- **`y:<year>`** — `?pscope=y:2024` — one calendar year; `[Y-01-01, (Y+1)-01-01)` half-open.

`SCOPE_FIRST_YEAR = 2011` (`scope/constants.ts`) is the picker floor; Tourism's corpus starts 2014
so early years render empty tiles legitimately. `ScopeControl` renders the segmented
"Този парламент · YYYY-MM-DD" pill + a years `<Select>` ("All years" + one item per year). The
generic dashboard uses the URL-backed hook; a bespoke screen may use the controlled
`value`/`onChange` variant (as Defense does) if it re-anchors KPIs to a picked year while keeping
the time-spine full-history.

**Half-open caveat (confirmed bug elsewhere — do not repeat):** if a Phase-2 tile drives a DB fetch
via `scopeRange` (inclusive `to=YYYY-12-31`) against the half-open group-rollup SQL, Dec-31
contracts drop silently. Normalize `y:` to `to=(Y+1)-01-01` when wiring any DB-backed scoped tile
(see `transport-view-v1.md` audit item 4).

---

## 6. Competitive research — world-class tourism dashboards

Benchmarks surveyed (2026-07): **UN Tourism (UNWTO) Data Dashboard**, **OECD Tourism Trends**,
**Eurostat tourism** (`tour_occ_*`, `tour_cap_*`); national exemplars **Tourism Research Australia**
(embedded "visitor economy" BI), **Singapore STB "Stan"** (monthly/quarterly/annual cadence tabs),
**NZ MBIE / TEIC** (card-transaction spend — TECTs), **Fáilte Ireland** (themed dashboards + how-to
videos), **Destination Canada** (7 traveller personas + forecast fan chart), **Spain
DATAESTUR / FRONTUR / EGATUR** (arrivals + expenditure surveys), **VisitBritain** (IPS-based),
**Dubai DET** (glossy KPI scorecard). Spend/procurement exemplar: **U.S. Travel State Tourism Office
Budget Dashboard** (total funding / marketing share / funding source / staffing / YoY).

**Canonical tourism KPIs:** international arrivals · overnight stays (nights) · tourism receipts ·
average length of stay · occupancy / RevPAR · **arrivals by source market** · **seasonality** ·
tourism GDP & employment (Tourism Satellite Account) · spend per visitor · purpose of visit ·
accommodation capacity · air/cruise connectivity.

**Best-in-class visuals:** **seasonality heatmap** (month × year — the single most tourism-specific
chart) · source-market **choropleth / flow map** · YoY-vs-2019 recovery · regional choropleth ·
KPI scorecard with delta arrows · ranked bars with % share · treemap by market · forecast fan chart.

**Tourism-agency procurement categories** (the spend side): advertising / media buying · digital &
martech · trade fairs & events (ITB, WTM, FITUR) · market research · PR / in-market representation ·
grants to regions/DMOs · product/infrastructure. Accountability framing: campaign spend → arrivals /
receipts from the targeted source market (measurable ROI).

**Bulgaria specifics:** ~13.6M foreign arrivals (2025); **twin-peak seasonality** — summer Black Sea
(Слънчев бряг / Златни пясъци) + winter ski (Банско / Боровец) + Sofia city/cultural; source markets
**Румъния, Германия, Турция, Гърция, Обединено кралство, Украйна**. НСИ publishes arrivals by
country of origin & purpose, resort-level activity (`/statistical-data/278`), accommodation
occupancy, and a Tourism Satellite Account; ЕСТИ registers nights at accommodation. These are the
Phase-2 data sources.

---

## 7. The dashboard design — tile by tile (mirrors the mockup)

House grammar: single vertical stack, no tabs. `Title → SectorBreadcrumb → ScopeControl → KPI row
→ tiles → awarder bridge → source footnote`. Every tile carries a **provenance chip**:
`● real` (green — OCDS/data.egov.bg, measured) vs `◐ illustrative · НСИ pending` (amber). Nothing
modeled is shown as official — non-negotiable for government figures.

1. **KPI scorecard** (`StatCard` row, scope-aware, REAL): Договорено ЗОП · Договори · Изпълнители ·
   Медиа/PR concentration (top-10 share) · Пик (year + €).
2. **Разход по години** (spend-by-year columns, REAL, hand-rolled CSS bars): the active `?pscope`
   window is highlighted; peak-year narrative (2018 / 2024 campaigns).
3. **Сезонност** (month × segment heatmap, ILLUSTRATIVE → НСИ): the signature tourism chart —
   summer-sea vs winter-ski twin peaks. Ship only once НСИ resort/nights data is ingested.
4. **Разход по категория** (horizontal proportion bars — media buying / TV / PR / events /
   research; classified from supplier profiles, mark ILLUSTRATIVE classification).
5. **Топ изпълнители** (leaderboard, REAL €, category chips media/PR/prod).
6. **Разход → приток** (ROI bridge: marketing € bars vs foreign-arrivals line; € REAL, arrivals
   ILLUSTRATIVE → НСИ). The differentiator tile.
7. **Пазари на произход** (source-market ranked bars / Phase-2 Leaflet choropleth; ILLUSTRATIVE →
   НСИ arrivals-by-origin).
8. **Институция bridge** — Министерство на туризма → `/awarder/176789478` (full ЗОП financials),
   with a note that the set is expandable via `TOURISM_SECTOR_EIKS`.

Chart forms follow the dataviz method (pick the form before the color): CSS bars for spend-by-year
& categories (dependency-free, OG-screenshottable), a small inline-SVG composed chart for the ROI
bridge, Leaflet choropleth for source markets / resorts in Phase 2, Recharts only if an axis-heavy
YoY-vs-2019 view is added.

---

## 8. Data honesty & provenance (non-negotiable)

- Procurement tiles: `● OCDS · data.egov.bg`, measured from `176789478.json` (and the group rollup
  once multi-EIK).
- Visitor / seasonality / source-market / ROI-arrivals: `◐ illustrative` until wired to НСИ / ЕСТИ.
  Do **not** ship these tiles with placeholder numbers to production; they exist in the mockup only
  to show layout.
- Category split is a **classification** of suppliers, not an official taxonomy — label it as such.
- The awarder header shows МТ-proper €; if a multi-EIK group total diverges, footnote the delta
  (the defense МО-proper-vs-group precedent).

---

## 9. Files to touch — checklist

| Concern | File | Change |
|---|---|---|
| Buyer allowlist | `src/lib/tourismReferenceData.ts` (new) | `TOURISM_SECTOR_EIKS`, `TOURISM_LEAD_EIK` |
| Generic dashboard | `src/screens/sector/sectorDashboards.ts` | `SECTOR_DASHBOARDS.tourism` |
| Browse filter | `src/screens/components/procurement/sectorPacks.tsx` | `SECTOR_BROWSE_PACKS.tourism` |
| Hub list | `src/screens/governance/sectorRegistry.ts` | `Sector` entry (+ cluster) |
| Hub scene | `src/screens/governance/sectorScenes.tsx` | `tourism` SVG scene |
| Hub tile € | `scripts/db/gen_procurement/sector_stats.ts` | add `tourism` to `SECTOR_EIKS`; rerun `db:gen-sector-stats` |
| i18n | `src/locales/{en,bg}/translation.json` | `sector_tourism_title/_desc`, `tourism_nav` |
| Server | — | none (`awarder_eik IN` already allowed) |
| Phase 2 screen | `src/screens/tourism/*`, `src/data/tourism/*`, `data/tourism/*.json`, `scripts/tourism/*`, `src/routes.tsx` | clone Culture; НСИ/ЕСТИ ingest |
| AI explorer (optional) | `ai/tools/tourism.ts` (new) | model on `ai/tools/culture.ts` |

---

## 10. Open decisions

1. **Single-member vs group** — ship anchor-only now, or verify Tier B (executive agency / regional
   centres) first? (Recommend: anchor-only Phase 1, verify Tier B before Phase 2.)
2. **Cluster placement** — new `sectors_cluster_economy` vs fold into `state`/`land`.
3. **Accent token** — a coastal teal/azure (`TILE_ACCENTS.azure`/`teal`) reads as "sea"; confirm no
   clash with water (`teal`) / customs (`azure`) already using those.
4. **Phase 2 scope** — is НСИ resort/arrivals ingest in appetite, or does v1 stay procurement-only
   (honest, real, shippable) with visitor context deferred?
