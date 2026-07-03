# Procurement dashboard redesign — v1 brainstorm

Date: 2026-07-03. Status: **phases 1–4 SHIPPED 2026-07-03** (period selector v2
with year mode, combined search, dashboard re-sectioning + sectors/risk/latest
tiles, EU benchmark tile). Deployment notes: apply schema files 035–037 on
Cloud SQL (`db:push` path), rebuild `awarder_search` + the `contracts.title_fold`
column/indexes, redeploy the DB Cloud Function (`functions:db`). Remaining
backlog: integrity label (A–F) + league tables, treemap explorer, multi-view
browser, alerts, sector profile pages, by-place dashboard section.

Inputs: structural map of the current procurement area (routes, tiles, scope, search, data layer) + competitive research of the best procurement transparency platforms (Opentender/DIGIWHIST, ProZorro + DOZORRO + bi.prozorro.org, USAspending.gov, Red Flags Hungary, OCP/OCDS guidance, transparex.sk, uvostat.sk, Hlídač státu, EU PPDS, DREAM Ukraine).

---

## 1. Competitive landscape — what the best platforms do

### Opentender.eu (DIGIWHIST / GTI)
- Same skeleton per country: three dashboards — **Market analysis**, **Transparency indicators** (data-completeness scores), **Integrity indicators** (red flags) — plus entity search, **sector (CPV) profiles**, **region profiles**, bulk download.
- Core IA rule: **every noun is a page** — sectors, regions, buyers, suppliers, tenders each have a profile, and any name rendered anywhere is a link. Compounds SEO and dwell time.
- Red flags scored 0 (flag) / 50 (mild) / 100 (clean), averaged into an integrity score per tender/buyer/supplier, trended over time.
- **Transparency vs integrity kept separate**: "publishes garbage data" is a different failure from "shows corruption-risk patterns". Protects the risk engine's credibility.
- Time filter: global year-range slider.

### ProZorro ecosystem (Ukraine)
- Three layers, three products: transactional system (prozorro.gov.ua), analytics (bi.prozorro.org — **49 purpose-built dashboards**, each solving a specific user problem, not one mega-dashboard), civic monitoring (DOZORRO + risks.prozorro.gov.ua).
- **risks.prozorro.gov.ua = a public work-queue of risky tenders**: filter by region, buyer id, indicator combinations; sort by alert date or value; download. Converts flags from decoration into a monitoring workflow.
- DOZORRO: ~40 automated risk indicators whose weights are re-trained on activist-confirmed violations; per-tender "leave a review" feedback.
- Published lesson: audience-scoped dashboards beat a universal one; design for non-technical users.

### USAspending.gov
- **Spending Explorer**: one recursive treemap with three entry lenses (purpose / agency / object class), drill step-by-step down to an individual award, breadcrumbed. Best big-picture navigation in the genre.
- **Award search = one filtered set, four renderings**: Table / Time (series) / Map (choropleth) / Categories (top-N bars). Left filter rail incl. location down to county/district, amount buckets, fiscal-year pills + custom range.
- **Award detail page**: obligated-vs-current-vs-potential value as a progress bar; full transaction/modification timeline; buyer + recipient cards linking to profiles; subawards; funding accounts.
- Recipient profiles have **parent/child company roll-ups** (relevant to supplier clusters).
- Analyst's Guide + glossary tooltips on every metric.

### Red Flags project (Hungary, K-Monitor + TI)
- ~40 indicators **grouped by procurement phase** (tender-notice phase vs award phase), each with **plain-language "why this is a flag" microcopy**. No composite score — "flags are leads, not verdicts".
- Saved-search **email alerts** on risky procurements scoped to CPV/keyword.
- Notable indicators: bid deadline below legal minimum, 3+ renewals, reference requirements exceeding estimated value, geographic restrictions, framework with <3 participants, <3 bids, final value deviating from estimate, winner/buyer appears in the press database.
- Cautionary tale: frozen since Oct 2023 by the TED eForms schema migration; tenders.guru offline 2026. NGO flag tools die of schema coupling + grant cycles.

### Hlídač státu (Czechia) — closest single analogue
- IA: contracts, tenders, subsidies, party donations, officials' salaries, politicians, companies — all cross-linked; full-text search with operators across everything incl. OCR'd contract PDFs; open API; an MCP server (2025) exposing the dataset to AI agents.
- **K-Index: an annual A–F corruption-risk "energy label" per public institution** (~10 equal-weight parameters: hidden prices, formal defects, just-under-threshold contracts, newly-founded-firm winners, links to party donors, supplier concentration/HHI overall + near-threshold + per-sector, minus a transparency bonus). Presented like an EU appliance label with per-parameter breakdown and **league tables per institution class** (ministries vs ministries, hospitals vs hospitals, regions ranked).
- Contracts flagged when the supplier connects (directly or via owners/board) to politicians.

### transparex.sk / uvostat.sk (Slovakia)
- transparex: company-registry-first — financial indicators + procurement + person/company connection tracing fused into one profile; continuously computed economic-risk and procurement-risk per entity. Entity risk = procurement behaviour + financial health + relationship graph, in one place.
- uvostat: minimal tables + **email notifications per entity** — proof that entity-scoped watch alerts are cheap and high-value.

### EU-level references
- **ECA / Single Market Scoreboard thresholds** — ready-made green/red benchmark lines: single-bidder share (green ≤10%, red >20%), no-call-for-bids (≤5% / ≥10%), decision speed (≤120 days), price-only award criteria (≤80%), SME share, lots usage, missing registration IDs (≤3%).
- **EU PPDS** (operational 2025): dashboard taxonomy = Data quality / Overview / Competition (single bidder, direct awards) / Strategic / SME participation / Efficiency. Validates data-quality dashboards as first-class citizens.
- **OCP 2024 red-flags guide: 73 indicators mapped to OCDS fields** with formulas; doctrine = calibrate thresholds to context, prefer **compound flags** (short ad period + <3 bids + spec anomaly) over single signals. Open-source `cardinal` (Rust) implements the formulas.
- **DREAM (Ukraine reconstruction)**: full project-lifecycle transparency (need → funding → procurement → construction → operation) with geo dashboards — the model for the АПИ road-spend scorecard direction.

### Time-filter verdict across the field
Year pills / fiscal-year checkboxes with optional custom range (USAspending) or a year-range slider (Opentender). **Nobody has our parliament-window scope — it's a genuine differentiator to keep**, with years as the familiar fallback.

---

## 2. The four asks

### 2.1 Standard period selector — two pills everywhere

Current state: `?pscope=ns|all` via `useProcurementScope` (src/data/procurement/useProcurementScope.ts), rendered by `ProcurementScopeControl` inside `ProcurementSectionHeader`. Respected by: overview, flows, concentration, flags. Ignored by: contracts browser, tenders browser, people, by-settlement (all full-corpus), watchlist (correctly scope-free).

Proposal:

- **Pill A — "Този парламент · 19.04.2026"** (default, unchanged, `pscope` omitted from URL).
- **Pill B — "Години"**: selecting it defaults to all years (`?pscope=all`); an embedded year picker (shared Radix Select, per UX standard) narrows to a single year → `?pscope=y:2024` (extend the `ProcurementScope` type to `"ns" | "all" | \`y:${number}\``). When a year is chosen the pill label becomes the year ("2024 ×"), with × returning to all-years. Range selection (y:2020-2024) is a later increment — start with single year.
- Keep `useProcurementHref` carrying the param across nav pills (already works).
- **Make scope honest on every sub-page.** Each procurement page renders the same header; pages that can't slice yet show the existing `mode="corpus"` badge instead of silently ignoring the toggle. Concretely:
  - Contracts + tenders browsers: **can respect it now** — DbDataTable is server-side; pass from/to (parliament window or year) as default filters to `/api/db/contracts` and `/api/db/tenders`. Cheap and high-value ("contracts signed under this parliament", "contracts in 2023").
  - Overview: extend `/api/db/procurement-overview` to accept from/to (per-NS slices exist; year = the same date-range query). EXPLAIN ANALYZE on the worst case; contracts date column must be indexed (see reference_pg_query_performance).
  - Concentration: already takes from/to — year mode is free.
  - Flows sankey: precomputed per-NS + corpus only. Options: (a) compute per-year server-side from contracts joins, (b) show corpus badge in year mode initially. Recommend (b) first, (a) later.
  - People / by-settlement: precomputed global indexes → corpus badge until per-window aggregation moves to DB.
- Naming note: "current government" in the ask = the parliament window we already use. True cabinet anchoring (`?cabinet=`, as on /governments и /indicators) is a possible third mode later — no competitor has it — but two pills first; don't overload v1.

### 2.2 Main dashboard = sectioned overview of all sub-pages

Mirror `DashboardCards.tsx` (elections homepage): `DashboardSection` blocks with id, title, icon, articleTopic, each section previewing a sub-page and linking into it ("see all"). Every current nav pill gets a corresponding section, so the landing page answers "what's in here" the way the elections homepage does. Homepage shell width (no max-w-5xl cap), tiles not tabs.

Proposed section order:

1. **Header KPI row** (4 cards, existing StatCards): Договори · Общо възложени · Изпълнители · Свързани лица. Consider swapping in a single-bidder-rate card once bid stats land (see 2.4).
2. **Търсене** — the combined search tile (see 2.3).
3. **Парични потоци** (→ /flows): FlowTile (existing sankey) + **new CPV sector treemap** (data already in derived/sector_totals.json, currently unused by any tile) + existing contractor/awarder treemaps.
4. **Кой печели · кой възлага** (→ /contractors, /awarders, /contracts): TopContractorsTile + TopAwardersTile (existing) + a compact "latest big contracts" strip deep-linking into the contracts browser.
5. **Лица и връзки** (→ /people): TopMpsTile + TopOfficialsTile (existing, MpAvatar rows) + connected-money headline.
6. **Рискови сигнали** (→ /flags, /concentration): risk-feed preview (top 5) + top concentration pairs + **new benchmark tile** (BG rates vs EU green/red lines) + debarred count.
7. **Процедури** (→ /tenders): recent tenders strip + forecast-vs-actual roll-up (the per-awarder tile aggregated).
8. **По място** (→ /by-settlement): top settlements table; mini choropleth when the deferred choropleth lands.
9. **Моят списък** (→ /watchlist): WatchlistDigestTile (existing).
10. **Статии**: ArticlesTile via SectionArticlesProvider with procurement topics (pattern exists on elections dashboard).

Keep the nav pills as-is — sections complement, not replace, direct navigation.

### 2.3 Combined search — persons + companies + awarders + contracts + tenders

Current: `CompanySearchTile` → `/api/db/company-search` (contractors only); separate client-side person search on /people; no contract/tender search anywhere.

Proposal — one endpoint, grouped dropdown:

- **`/api/db/procurement-search?q=`** returning grouped arrays: `{ contractors, awarders, tenders, contracts }`.
  - Contractors + awarders: existing name-search machinery (two queries or a UNION with a `kind` column).
  - Tenders: title match — needs `pg_trgm` GIN index on the title column.
  - Contracts: subject match — same treatment; cap per-group results (5–7). EXPLAIN ANALYZE each on worst-case queries before shipping (standing rule).
- **Persons merged client-side** from `person_procurement_index.json` (small, already has bilingual Cyrillic/Latin token matching on /people) — no server work, avoids Cyrillic/translit logic duplication in SQL.
- UX: same focus-gated, 200 ms-debounced tile; dropdown grouped by entity type with headers and icons (Фирми / Възложители / Лица / Процедури / Договори), keyboard nav, footer rows "виж всички в Договори →" deep-linking to the browsers with the query prefilled as a server-side filter. Follows the header-search grouped pattern (src/layout/search/Search.tsx).
- Later: fold procurement entities into the global header search (needs weighing against index size — the DB-backed grouped endpoint sidesteps the static-index cost, so the header could call the same endpoint when the query looks procurement-shaped, or simply always include a "search in procurement" row).

### 2.4 Tile changes — ranked backlog

**Quick wins (data already exists):**
- **CPV sector treemap** — sector_totals.json is computed and unused.
- **Risk queue tile + page upgrade** (risks.prozorro pattern): "riskiest recent contracts" — contracts browser already has risk chips + sort; add a dashboard preview sorted by (risk, date, value) and indicator-combination filters on /flags.
- **Benchmark tile** — BG single-bidder / direct-award / decision-speed rates vs Single Market Scoreboard green-red thresholds. Depends on bid counts: OCDS `release.bids.statistics` (per reference memory) — verify ingested; if not, this becomes a small ingest task first.
- **Latest big contracts strip** — trivial DB query, feeds section 4.

**Medium:**
- **Buyer integrity label (A–F, K-Index style)** on /awarder/:eik + **league tables** (ministries vs ministries, hospitals vs hospitals, 265 municipalities). ~8 equal-weight parameters we mostly compute already: single-bidder share, direct-award share, supplier HHI, near-threshold clustering, young-firm winners, amendment growth, politically-connected winners, data completeness. Publish per-parameter breakdown. Media-shareable; pairs with the naiasno-post skill.
- **Transparency (data-quality) score, separate from integrity** (Opentender/PPDS): grade buyers on field completeness. Cheap defensive credibility.
- **Amendment-growth flag + contract-page timeline**: anexes are already ingested (1095 in current window); show per-contract modification timeline + cumulative growth %, and flag outliers.
- **Contract page lifecycle strip + estimated-vs-final progress bar** (OCDS/USAspending): the ocid tender↔contract lineage join already exists — surface forecast vs contracted vs after-amendments as a horizontal bar.
- **Plain-language flag microcopy**: every risk chip gets a one-line "why this matters" expando; audit our flags against OCP's 73-indicator catalog and upgrade weak solo flags into compound ones (0/50/100 mild scale).

**Big bets:**
- **Treemap spending explorer** (USAspending): sector → buyer → supplier → contract recursive drill with breadcrumbs; place → buyer as a second lens. Could eventually replace several static tiles.
- **Multi-view contracts browser**: same filter state rendered as Table / Time-series / Map / Top-N (segmented control, not tabs-in-dashboard). DbDataTable already centralizes filter state server-side.
- **Alerts**: watchlist is localStorage-only; email digests per followed entity or saved risky-filter (uvostat/Red Flags pattern). Needs accounts or email capture — separate product decision.
- **Sector + place profile pages** (`/procurement/sector/:cpv`): completes the "every noun is a page" rule (company/awarder/contract/tender/settlement already exist). SEO upside given the known discovery gap.
- **"Report a problem with this contract"** (DOZORRO-lite): a mailto/form on contract pages; reader→monitor conversion.

---

## 3. Suggested build order

1. Period selector v2 (two pills + year select; contracts/tenders browsers gain window filtering; corpus badges where data can't slice yet).
2. Combined search endpoint + tile.
3. Dashboard re-sectioning (mostly re-arranging existing tiles into DashboardSection blocks) + CPV treemap + latest-contracts strip + risk-queue preview.
4. Benchmark tile (verify bid-count ingest first) → then integrity label + league tables as the flagship follow-up.

Open questions:
- Are bid counts (release.bids.statistics) ingested into PG? Gate for single-bidder metrics.
- Year scope for the sankey: per-year DB aggregation or corpus badge in v1?
- Should the global header search call the procurement DB endpoint, or stay static-index-only?
