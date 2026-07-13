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

## 3. Туризъм as an EIK set — allowlist (to VERIFY before build)

Linkage to a sector in this repo is a **curated buyer-EIK allowlist**, never a CPV or keyword
classifier (both false-positive badly — see the warnings in `defenseReferenceData.ts` /
`kulturaReferenceData.ts`). Create `src/lib/tourismReferenceData.ts` with a hand-verified set.

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
