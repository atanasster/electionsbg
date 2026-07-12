# Транспорт (Transportation) sector view — v1 plan & competitive brainstorm

Status: **RESEARCH + BRAINSTORM (not yet built)** — drafted 2026-07-12.
Closest built siblings to copy: `water-view-v1.md` (multi-EIK infrastructure sector with a
holding + regional operators, choropleths, a signature "who-spent" tile, a `SECTOR_BROWSE_PACKS`
entry) and the shipped **АПИ roads pack** (`RoadsPack` + `src/lib/roadAttributes.ts`). The defense
plan (`defense-pack-v1.md`) is the reference for the tile vocabulary and the anatomy checklist.

> All corpus figures below are **MEASURED** from `data/procurement/derived/awarders_index.json`
> (rebuilt 2026-07-11), not external estimates. €m = per-row `amountEur`, the PG basis.

---

## Audit rev 1.1 (2026-07-12) — corrections that SUPERSEDE the text below

Verified the load-bearing wiring against current code. Gaps found and closed:

1. **DefensePack has SHIPPED** since this pattern was last surveyed — it is registered in
   `sectorPacks.tsx` under `MOD_EIK`, with a `defense` `SECTOR_BROWSE_PACKS` entry, a `/defense`
   nav link, and a Shield thematic pill. **Copy DefensePack, not older packs** — it is the freshest,
   closest analogue (multi-EIK state group + budget bridge + standalone screen).

2. **MTITC EIK-dedup is a NON-ISSUE — delete that concern.** The corpus holds exactly one
   transport-ministry awarder, `000695388` (€2,190.6M / 290), already canonicalized. There is no
   second MTITC EIK to merge. §1 should NOT say "dedupe MTITC lineage."

3. **`awarder-group-rollup` verified** (`functions/db_routes.js:613`): param is `eiks`
   (comma-joined, `/^\d{9,13}$/`, capped at **300** — transport's ~13 EIK set is fine). It filters
   `tag='contract'` (amendments excluded → totals match the headline, the amendment double-count
   fix holds) and returns per-entity `totalEur`, `contractCount`, `singleBidN`, `bidKnownN` — so
   the KPI row + single-bid gauge + HHI come from ONE call. Query the transport EIK set through it,
   never fan out.

4. **The Dec-31 scope bug is CONFIRMED, not hypothetical.** The group-rollup SQL is
   `date >= COALESCE($2,'') AND date < COALESCE($3,'99999999')` — **half-open**. `CompanyDbScreen`
   passes an *inclusive* `to=YYYY-12-31` from `scopeRange`, so a `y:YYYY` scope on the awarder-page
   pack silently drops Dec-31 contracts. **Normalize `y:` to half-open (`to=(Y+1)-01-01`) when
   wiring the pack.** (`date` is a TEXT column compared as string with COALESCE bounds — keep the
   COALESCE form, it is sargable; do not switch to OR-NULL guards. See [[reference_pg_sargable_windows]].)

5. **Budget side is PARTIALLY pre-wired — check before adding.** `scripts/budget/discover_execution_reports.ts`
   already carries `adminId: "admin-ministerstvoto-na-transporta-i-saobshteniyata"` (label "МТС —
   Transport") and `scripts/budget/facts.ts` maps the ministry name. **But** `fetch_sources.ts`
   notes `mtitc.government.bg returns 0 PDFs` — the domain moved to **`mtc.government.bg`**, so the
   execution-report source is currently dead. Before promising a budget bridge, (a) confirm whether
   МТС is in `EXECUTION_REPORTS` and produces rows, (b) repoint the source domain, (c) heed the
   scope-mismatch warning in [[project_budget_execution_scope]]. The BDZ PSO subsidy line is more
   reliably pulled from the State Budget Law appendix than from the ministry PDF.

6. **Anchor is a CURATED thematic group, not an org chart — say so.** МТС owns rail/port/БДЖ but
   **АПИ (€5.6bn) sits under МРРБ, not МТС.** Putting АПИ in a rollup anchored on the МТС awarder
   page is an editorial choice (like water's "holding membership best-effort"). The МТС awarder
   header will show €2.19bn (МТС proper) while the pack shows the €11.3bn group — **this delta MUST
   be footnoted** (the defense МО-proper-vs-МО-group reconciliation precedent), and АПИ must be
   Select-segmentable so the default view can exclude it.

7. **€/km RAIL is UNVERIFIED — do not promise it in the MVP.** The road €/km engine works because
   ~46% of АПИ titles carry `от км N+NNN до км` chainage, and even then only ~7% yield a defensible
   unit cost ([[project_api_road_effectiveness]]). Whether НКЖИ contract titles carry comparable
   segment/length tokens (vs station names / km-posts / lot bundles) is **not yet probed**. Treat
   the "road↔rail €/km face-off" as a Phase-3 spike gated on that probe; if rail titles don't parse,
   ship the road side alone and a rail *spend-per-line-km-rehabilitated* proxy from the NKZHI
   project registry instead.

8. **Competition metrics need gating + coverage disclosure.** `number_of_tenderers` coverage is
   partial across the corpus (defense measured ~45%). Single-bid share must be gated on
   `cpv_competition.json` (Fazekas "competitive markets only") and the covered-`n` disclosed on the
   tile, exactly as roads/defense do — do not render a bare single-bid % over an unknown denominator.

9. **Convention reminders not stated below:** packs are **bilingual-inline** (`const bg = lang==="bg"`),
   **no i18n keys except the nav label** (the thematic-nav `key` + `reportMenus.ts` `title` are the
   only translated strings). EUR-only display, never footnote leva post-2026 ([[feedback_bg_uses_eur.md]]).
   Radix Select only, never native `<select>` ([[feedback_no_native_select.md]]). Stacked bands,
   never tabs ([[feedback_no_tabs_ux.md]]).

10. **Still genuinely open (flagged, not resolved):** (a) does `/transport` warrant its own OG
    capture + route_def, or is the МТС awarder OG card enough for Phase 1? (defense gave the screen
    its own) — decide at Phase 2. (b) Metropoliten cross-link target = the Sofia governance view
    (`GovernanceScreen`); confirm the deep-link route. (c) The Хемус in-house overlay (Tier D) has
    NO machine source — it is a hand-curated registry; scope its maintenance burden before promising
    it recurring.

---

## 0. The one-line thesis

**Roads and rails already exist as isolated packs; nobody has ever put the whole transport
budget in one frame — and the moment you do, the biggest single road-building entity in the
country goes almost invisible.**

Transport is the natural *umbrella sector*: `/procurement/roads` (АПИ) shipped, НКЖИ rail was
always flagged as "the 2nd sector instance". This view unifies **roads + rail + БДЖ + ports +
airports (concessioned) + the four transport regulators + toll + road-safety** under one entity
group and one accountability story.

The signature finding, verified against the corpus:

| Entity | In АОП corpus | Reality |
|---|---|---|
| **Автомагистрали ЕАД** (state road-builder) | **€0.3M / 16 contracts** | Received **>4.6bn BGN (~€2.35bn)** in *in-house* Хемус awards since 2018 |

That gap **is** the thesis: "You can see €11.3bn of transport procurement — but the single
fastest-growing road program (Хемус, built in-house by Автомагистрали ЕАД) deliberately bypasses
the tender corpus. The more the state builds this way, the less you can see." This mirrors the
defense pack's "you can see sustainment, not acquisition" — same shape, cleaner data.

---

## 1. Entities — the FROZEN EIK allowlist (measured)

Curate **by EIK allowlist, never name regex** (defense-pack lesson: "7-МО училище" matched "МО";
town of Раковски matched the academy). Three universes; never conflate.

### Universe A — State transport group (the МТС principal + owned companies)
| Entity | EIK | Corpus €m | n | Tier / role |
|---|---|---|---|---|
| Министерство на транспорта и съобщенията | **000695388** | 2,190.6 | 290 | Ministry / principal owner (dedupe MTITC lineage on this EIK) |
| ДП НКЖИ (rail infrastructure) | **130823243** | 2,787.2 | 1,587 | State enterprise — rail infra manager |
| БДЖ — Пътнически превози | **175405647** | 342.0 | 483 | Passenger operator (PSO-subsidised) |
| ДП „Пристанищна инфраструктура" | **130316140** | 191.0 | 380 | Port infrastructure |
| БДЖ — Товарни превози | **175403856** | 109.6 | 329 | Freight operator (insolvent, EU state-aid case) |
| ИА „Автомобилна администрация" | **121410441** | 45.4 | 152 | Road-transport regulator (2nd-level unit) |
| Холдинг БДЖ | **130822878** | 33.4 | 28 | Rail holding |
| ИА „Морска администрация" | **121797867** | 8.1 | 92 | Maritime regulator |
| ГД „Гражданска въздухоплавателна администрация" | **121805755** | 2.9 | 40 | Civil-aviation regulator |
| ДАБДП (State Agency Road Safety) | **177344399** | 2.0 | 22 | Road-safety coordination (**EIK resolved from corpus**) |
| ИА „Железопътна администрация" (ИАЖА) | **130663221** | 0.1 | 3 | Rail-safety authority (**EIK resolved from corpus**) |
| **State-transport group subtotal (11 EIK)** | — | **~5,710** | **3,406** | — |

### Universe B — Roads (АПИ), administratively under МРРБ not МТС
| Entity | EIK | Corpus €m | n | Note |
|---|---|---|---|---|
| Агенция „Пътна инфраструктура" (АПИ) | **000695089** | 5,599.3 | 2,034 | Already has its shipped `RoadsPack` |
| „Автомагистрали" ЕАД | **831646048** | **0.3** | **16** | In-house builder — the invisible-money story |

**Group with АПИ included: ~€11.3bn / 5,431 contracts.** Decision needed (mirror the defense
"МО group vs МО proper" segmentation): the Транспорт view **should claim АПИ** thematically but
**footnote** that it is a МРРБ line — expose a Radix Select ("Транспорт група" / "без АПИ" /
"държавни жп" / per-entity) so АПИ's €5.6bn doesn't drown the rail/port story, exactly as the
defense plan segments ВМА out of МО.

### Universe C — Adjacent-but-excluded (show as cross-links, not in rollups)
- **Метрополитен ЕАД `000632256` — €1,297.0M / 296.** MUNICIPAL (Столична община), *not* state.
  Exclude from state rollups; cross-link to the Sofia governance view. (Bigger than all of БДЖ +
  ports combined — worth a labelled call-out, never a silent inclusion.)
- **Airports** — Летище София (concession → SOF Connect 2021), Варна/Бургас (Fraport). Not state
  operators anymore; surface as *concession-fee inflows*, not procurement rollups.

---

## 2. Data sources, tiered by ingest cost

**Tier A — already ingested, zero pipeline (the MVP renders entirely off this):**
- The АОП/ЦАИС procurement corpus — every entity above is already an awarder. Group rollup,
  CPV/procedure mix, single-bid, HHI, tenders, КЗК appeals, MP-connected all come free via
  `buildAwarderModel` + the generic awarder tiles.
- Existing `roadAttributes.ts` engine (chainage, €/km, work-type) for the АПИ slice.

**Tier B — structured, one parser each (Phase 2):**
- **BGTOLL** toll/vignette revenue (899M BGN 2024; e-vignette vs toll vs enforcement split;
  ~63M BGN reseller commissions) — press-release / open-data figures.
- **Програма „Транспортна свързаност" 2021-2027** absorption (EU €1.61bn; rail €711M / road
  €703M / innovation €403M / intermodal €47M) + ОПТТИ 2014-2020 closed at 99.4% — the
  absorption-contrast gauge. Source: eufunds.bg + our existing ИСУН funds pipeline
  (see [[project_funds_pg_migration]]).
- **State budget law** transport envelope + BDZ PSO subsidy line (~260M BGN 2024) + rail infra
  subsidy (~285M BGN) — folds into `update-budget` (`__write_transport.ts`), the judiciary/defense
  precedent (budget belongs to update-budget, NOT the domain skill).

**Tier C — recurring PDF / scrape (watcher candidates, Phase 3):**
- **НСИ / МВР road-fatalities** series (478 killed 2024, 525 in 2023) — the road-safety pillar;
  pair with ДАБДП bulletins.
- БДЖ rolling-stock / financials, NKZHI project registry (Пловдив-Бургас Фаза 2 ~€374-414M).

**Tier D — manual/annotated overlay (no feed):**
- **Хемус in-house awards to Автомагистрали ЕАД** (>4.6bn BGN, 12-16M BGN/km vs planned 7M) — a
  curated registry, because it is *absent by design* from the tender corpus. This is the defense
  "mega-programs" analogue: publicly reported, not in ЦАИС.

---

## 3. Architecture (reuse the shipped grammar — do not reinvent)

Two halves, both patterns already exist:

1. **`TransportPack` on `/awarder/000695388`** (МТС) — the "money half". Register the EIK in
   `src/screens/components/procurement/sectorPacks.tsx` `PACKS` map. `SectorPackProps =
   {eik, scopeWindow}`. Data hook `useTransport` fuses the **group rollup**
   (`/api/db/awarder-group-rollup` — ONE aggregate call over the ~13 EIK set, the water fix for
   N-EIK fan-out; do **not** do 13 client fetches) with a budget/toll payload. Domain constants
   split into `src/lib/transportReferenceData.ts` (EIK sets + universe labels + colors) and
   `src/lib/transportAttributes.ts` (classifier + `buildTransportModel` = thin wrapper over
   `buildAwarderModel`, lighting up the generic KPI row/chips/category tile for free).

2. **`/transport` standalone screen** (`src/screens/transport/TransportScreen.tsx`) — the primary
   surface, managed like `/water`. Shell = `<Title>` → intro → `<ProcurementSectionHeader
   scopeMode="toggle">` → scoped tiles → unscoped national tiles → cross-link strip. Add to the
   управление menu + `ProcurementThematicNav` (Train/TramFront icon) + `SECTOR_BROWSE_PACKS`
   (`?sector=transport` → the EIK set) so the shared `/procurement/contracts` + `/tenders` tables
   filter to transport.

Reuse verbatim: `PackSection` (stacked bands, never tabs), `StatCard` KPI row, `WARN_CHIP_COLORS`,
the 280px loading skeleton, `buildPackInsights`, `VikContractorHhiTile` + `VikCompetitionTile`
(the two marquee reusable tiles), `useHashScroll` deep-links, per-tile `hasModel` gating.
Generic tiles (flow Sankey, CPV breakdown, single-bid gauge, tenders, appeals, MP-connected)
render FREE above the pack.

---

## 4. The "world's best dashboard" — tile-by-tile

Ordered money-first (biggest flow first, procurement detail last), each a `PackSection` band with
a stable deep-link id. Signature tiles marked ★.

1. **★ Hero — "Къде отиват парите за транспорт" mode-split flow.** One Sankey/stacked hero:
   Транспорт €11.3bn → {Пътища €5.6bn · Железници €3.3bn (НКЖИ+БДЖ) · Пристанища €0.2bn · Регулатори · Метро* municipal}. `data-og="transport-hero"` for the OG card. The
   fixed-color-by-mode rule (never repaint on Select) from the defense dataviz house rules.

2. **★ The invisible-builder call-out.** A single honest KPI+chip: "Автомагистрали ЕАД в
   търговете: €0.3M / 16 поръчки — но получи >4,6 млрд лв за Хемус без търг (инхаус)."
   This is the whole thesis in one tile — the "transparency-gap" analogue. Show the in-house
   figure as a *labelled dashed bar* next to the visible €0.3M so the gap is the subject.

3. **Mode comparison KPI strip** (`StatCard` row, `grid-cols-2` mobile / 4-5 desktop): total €,
   single-bid share, direct-award share, top-5 concentration (HHI band via shared
   `hhiBand`/`HHI_BAND_COLOR`), тендери count. Universe Select ("група/без АПИ/жп/…") drives it.

4. **★ Road ↔ Rail €/km face-off.** The differentiator nobody in BG ships. Reuse `roadAttributes`
   €/km reference-class engine for АПИ; build the rail analogue from НКЖИ contract chainage where
   parseable (Пловдив-Бургас is a clean case). Gated, `n` shown, outlier-detection lens not a
   portfolio mean — the АПИ €/km discipline already proven.

5. **★ Rail subsidy dependency.** "3 лв субсидия на 1 лв собствен приход" — БДЖ Пътнически PSO
   ~260M BGN 2024 vs own revenue; БДЖ Товарни insolvency + EU state-aid flag. A budget-vs-revenue
   bridge (the NZOK bridge pattern — BEST-in-repo — with rounding-floor honesty `<0.5% → "под
   0,5%"`).

6. **★ EU absorption gauge — ПТС 2021-27 vs ОПТТИ 2014-20.** Burn-down: 99.4% (closed) vs the
   sluggish new programme (~658M paid of €1.9bn). Rail/road/innovation/intermodal split bars.
   Absorption-risk is the story.

7. **Toll & vignette revenue tile.** 899M BGN 2024 (e-vignette 281M / toll 590M / enforcement 28M),
   +13% YoY, minus ~63M reseller commissions. A revenue-in tile (transport is the one sector that
   earns as well as spends) — contrast with the spend hero.

8. **Road-safety pillar.** Fatalities trend (478 in 2024, 525 in 2023) vs EU per-capita; ties the
   money to the outcome. Positional/non-judgmental framing (education report-card precedent).

9. **What each entity buys — CPV/procedure breakdown** (generic `ProcurementBreakdownTile`), and
   **single-bid competition gauge** per buyer (`VikCompetitionTile`, green<35/amber/red≥60).

10. **Concession-fee inflows** (Phase 2): Sofia Airport (SOF Connect), Варна/Бургас (Fraport) —
    the money that flows *to* the state, not procured. A small labelled tile.

11. **Top contracts / top contractors / MP-connected / tenders / КЗК appeals** — all free generic
    tiles; concentration + MP overlay is where the Хемусгейт subcontractor-chain story surfaces.

12. **See-all deep-links** — every Top-N tile → the shared `DbDataTable` "see all" scoped to the
    transport EIK set (`?sector=transport`), scope + `?q=` carried forward.

**dataviz house rules (non-negotiable, from defense):** one axis per chart; categorical hues fixed
order, 9th→"Other"; run `scripts/validate_palette.js` on the mode palette light+dark (CVD≥12);
color-follows-entity-not-rank; heroes = CSS flex bars, Recharts only for the one donut/trend.

---

## 5. Date scoping (as required)

Vocabulary is **strictly `ns | all | y:YYYY`** via `useProcurementScope` — **no calendar from-to
picker exists anywhere; do not add one**.

- **`/transport` screen:** mount `ProcurementSectionHeader scopeMode="toggle"`; contract tiles
  re-window on `?pscope`. Corpus spans ~2011-2026 with a post-2021 rail/EU surge, so `y:YYYY` is
  meaningful.
- **`TransportPack` on the awarder page:** consumes `scopeWindow={{from,to}}` (controlled
  `ProcurementScopeControl`) for contract tiles. **Annual** tiles (toll revenue, EU absorption,
  BDZ subsidy, road fatalities) do **not** honor the parliament pill — follow the NZOK/VSS
  precedent: an **independent local fiscal-year `Select`** + a "latest data · independent of
  scope" chip when `scopeWindow` is set. Off-scope bands flagged via `PackSection`'s `note` prop.
- **⚠️ Inherited bug to avoid** (defense-plan finding): `CompanyDbScreen` feeds an *inclusive*
  `to=YYYY-12-31` into the *exclusive* `scopeByWindow` (`>=from && <to`), dropping Dec-31 contracts
  on awarder-page packs. Normalize `y:` to half-open when wiring the pack.

---

## 6. Plumbing (mirror water/defense; each a one-liner here, expand at build)

- **Storage:** procurement is already PG. Tier-B/C artifacts (toll, EU absorption, fatalities) →
  static JSON under `data/transport/` (small; no `recordIngestBatch`), except the budget line which
  goes through `update-budget` → `data/budget/transport/`. [[feedback_pg_changelog_required]] only
  applies to any *new PG-migrated* dataset.
- **Watchers:** `scripts/watch/sources/{bgtoll_revenue, pts_absorption, nsi_road_fatalities}.ts`
  → map to an `update-transport` skill in `process-watch-report` (both mapping surfaces).
- **AI tools** (`ai/tools/transport.ts` + registry/router/narrate): `transportSpending`,
  `railSubsidy`, `tollRevenue`, `transportEuAbsorption`. Router guards against АПИ↔roads collision
  (roads tool already exists — route "магистрал/коридор" → roadsSpending, "жп/влак/БДЖ" →
  transport). `ai/` cannot import `@/data/*` → keep engines in `src/lib/`.
- **Data map:** add a transport SOURCE_GROUP + DATASET + cross-dataset edges (budget→transport,
  funds→transport) + `/^\/transport\//` AI_PATH_RULE.
- **SEO:** one `INSTITUTION_PACKS` entry auto-wires sitemap + prerender + OG; the `/transport`
  screen needs its own route_def + OG capture (anchor `data-og="transport-hero"`). Prerender the
  hero's live € figures into the crawlable body (judiciary precedent).

---

## 7. Phasing

- **Phase 1 (~½–1d):** register МТС EIK + `TransportPack` skeleton off the group rollup (KPI row,
  mode-split hero, invisible-builder call-out, generic tiles free). Nav + thematic pill +
  `SECTOR_BROWSE_PACKS` entry. Everything renders off Tier-A, zero new ingest.
- **Phase 2 (~1-2d):** `/transport` screen + toll revenue + EU absorption gauge + BDZ subsidy
  bridge + road↔rail €/km face-off. Budget line via update-budget.
- **Phase 3 (~1-2d):** road-safety pillar + Хемус in-house annotated overlay + concession-fee
  tile + AI tools + watchers. Cabinet anchoring last.

## 8. Competitive positioning

Nobody in BG has a unified transport-money dashboard. IME/ИПИ do fiscal transparency but not
sector-money-flow; sigma.midt.bg is a re-skin of the same АОП data we already hold
([[reference_sigma_platform]]). Global refs are single-mode (ORR rail benchmarking, USAspending
account-vs-award, Prozorro/DOZORRO risk feeds) — none tie *road + rail + the invisible in-house
builder* into one frame. Position = **"Целият транспорт на едно място — и парите, които не се
виждат."**
