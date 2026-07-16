# Транспорт (Transportation) sector view — v1 plan & competitive brainstorm

Status: **NOT BUILT — plan/design only (verified feasible).** Phase 0 was prototyped + browser-verified
on 2026-07-15, then **reverted at the operator's request** ("we have not started coding yet"). The
committed `/sector/transport` is still the single-member (МТС-only) stub. See **Audit rev 3.0** below.
Closest built sibling to copy is the **committed security/МВР sector** (`MvrPack` +
`securityReferenceData.ts`, commits `0bebf7f36`/`5c9fd317e`) — the freshest multi-EIK-group template;
energy is the group-dashboard-with-ThematicTiles reference.

> All corpus figures are **MEASURED** from `data/procurement/derived/awarders_index.json`
> (rebuilt 2026-07-15). €m = per-row `amountEur`, the PG basis.

---

## Audit rev 3.0 (2026-07-16) — FINAL — status correction + verified pack recipe

Reviewed the current (committed) sector-pack patterns and re-audited the whole plan. **Supersedes
the "SHIPPED" language in rev 2.0.**

### Status correction (important)
Rev 2.0 said "Phase 0 SHIPPED." That is **no longer true**: the group-dashboard code
(`transportReferenceData.ts` + the wiring in `sectorDashboards.ts` / `sectorPacks.tsx` /
`sector_stats.ts`) was written, browser-verified (`/sector/transport?pscope=all` → **€5.9bn /
3,958 contracts / 11 awarders**, top contractor БДЖ-Пътнически €980.6M, roads correctly excluded,
date scoping working), and then **fully reverted** on operator instruction. The working tree is
clean; `/sector/transport` renders the committed single-member stub. **Everything in this plan is
design-only.** The verification stands as proof the approach works — nothing is built. The "What
SHIPPED this session" subsection in rev 2.0 should be read as "what was prototyped then reverted."

### Repo state confirmed (2026-07-16)
- The **security/МВР pack is fully committed and is the definitive template** (`0bebf7f36` base +
  `5c9fd317e` personnel/EU-peer tiles). Defense and judiciary (`72f42dc9a`) are also committed.
  Working tree clean.
- `TRANSPORT_EIK` already exists (`sectorDashboards.ts`, imported by `sectorPacks.tsx`) but **no
  `TransportPack` is registered in `PACKS`** — the МТС awarder EIK falls through to the generic
  awarder dashboard today.

### The verified Phase-1 `TransportPack` recipe (mirror МВР exactly)
Confirmed against the committed МВР pack — build 4 things:
1. **`src/lib/transportReferenceData.ts`** — curated EIK allowlist (NEVER a name regex: a "транспорт"
   sweep hits municipal "Градски транспорт" ЕАД, school-transport lines). Exports `TRANSPORT_ENTITIES`
   (`{eik,name,universe}`), `TRANSPORT_SECTOR_EIKS`, `TRANSPORT_ALIAS_EIKS`, `TRANSPORT_LEAD_EIK`,
   `TRANSPORT_BUDGET_NODE`, universe labels. (This is the file that was prototyped — content below is good.)
2. **`src/lib/transportAttributes.ts`** — clone `securityAttributes.ts`: a 2-digit-CPV-division
   `categoryOfCpv` switch → `SectorClassifier`, `CATEGORY_CPV_DIVS` for `?cpv=` deep-links, and
   `buildTransportModelFromAggregates(p) = buildAwarderModelFromAggregates(p, transportClassifier)`
   (server filters `tag='contract'`). Transport CPV buckets differ from МВР: rolling_stock (34.6 rail
   vehicles), track/construction (45), signalling_it (48/72/32), fuel_energy (09), maintenance (50),
   design_supervision (71), services (63 supporting transport), supplies, other.
3. **`src/data/procurement/useTransport.tsx`** — clone `useMvr.tsx`: fan out `[LEAD, ...ALIAS]` when
   `eik===LEAD`; universe filter; **two** `useAwarderGroupModel` calls (active-universe +
   whole-group, the 2nd `enabled` only when a universe filter is active) for a filter-invariant
   `groupTotalEur`; return `{model, units, groupTotalEur, isLoading}`.
4. **`src/screens/components/procurement/transport/TransportPack.tsx`** + tiles — the shell: `Train`
   icon + `<h2>` + universe `<Select>` (ministry/rail/maritime/aviation/road) pinned right; a
   **group-only** KPI row (`grid-cols-2 lg:grid-cols-3`; the generic per-EIK total/contracts/suppliers
   live in the awarder header ABOVE the pack — don't duplicate); `buildPackInsights` chips (linkified);
   stacked **title-less `PackSection` bands** (child tiles carry their own `<CardTitle>`); footnote.
   Register `[TRANSPORT_EIK]: TransportPack` in `PACKS` + a `lazy()` import (parallel to the МВР lines).

### Reuse map (verified) — build only what's genuinely bespoke
- **Reuse as-is:** `VikContractorHhiTile` (`../vik/`, DOJ HHI bands from `textbookPublishers.ts`,
  attributed denominator, gates `<3` suppliers), `OblastChoropleth`, `PackSection`, `buildPackInsights`,
  `useAwarderGroupModel`, the per-year-vs-"за периода" scope logic.
- **Near-mechanical clones:** `TopContractsTile` (swap EIK-set + `sector=transport`; needs the
  `/api/db/awarder-group-top-contracts` endpoint — confirm it exists or add it), `CompetitionTile`
  (per-unit single-bid heatmap; needs the `{eik,name,totalEur,singleBidShare,bidKnownN}` unit shape,
  which `useTransport` already yields).
- **Bespoke per sector:** `TransportCategoryTile` (driven by `transportAttributes`), the budget bridge
  (§ below), and any spend-vs-outcome tile.

### Two caveats that CORRECT earlier revs
1. **No independent annual-year `<Select>` exists in the МВР pack** — earlier revs said "annual tiles
   get an independent fiscal-year Select (NZOK/VSS precedent)." The МВР pack does NOT do this; its
   annual tiles (budget, EU-peer, road-safety) hard-pin to their latest year and simply ignore
   `scopeWindow`. If Transport wants a year picker for annual subsidy data, that pattern must be lifted
   from **NzokPack/VssPack**, not from МВР. Default recommendation: follow МВР — annual tiles show
   latest + full series, contract tiles honor `scopeWindow`. Simpler and consistent.
2. **A per-oblast spend choropleth is WEAK for transport.** МВР's `OblastMapTile`/`CrimeScatterTile`
   work because МВР has 28 ОДМВР + 28 РДПБЗН seated per-oblast. Transport's big spenders (НКЖИ, БДЖ,
   ports, ministry) are **national single entities** — there's no per-oblast unit split, so an oblast
   choropleth would be near-empty. Transport's geography is **per-mode / per-corridor / per-line /
   per-port**, not per-oblast. Drop the oblast map; the mode-split hero + spend-by-year carry the load.

### Budget bridge = the "rail subsidy-dependency" flagship — data gap flagged
`MvrBudgetBridgeTile` is the template: `useBudgetMinistryRollup(<NODE>)` reads the per-ministry budget
tree (`data/budget/ministries/<id>.json`, written by `update-budget`), uses `expenditure.amountEur`
as the authoritative ЗДБ figure, draws only measured bands solid and **anything estimated as a
hatched, explicitly-labelled band**, and **ignores `scopeWindow`** (always latest budget year + full
series). **Gap:** that node gives the МТС *ministry* total, not the **БДЖ PSO subsidy line** or
farebox revenue — the flagship "3 лв субсидия на 1 лв приход" tile needs (a) the budget PSO/subsidy
line (a specific budget-law row, may need a targeted parse) + (b) БДЖ passenger revenue + ridership
(БДЖ ГФО / annual report). Phase-1 can ship the ministry-level bridge from the existing node; the
БДЖ-specific subsidy tile is Phase-2 and needs that extra data. Do not promise the subsidy-ratio tile
off the ministry node alone.

### One reusable win for the "EU league-table" safety tile
`MvrEuPeerTile` + `euFlags.tsx` are directly adoptable: it reads `useCofog()` → `peers.<GF>` and bars
BG vs EU peers on a COFOG %GDP function. For transport, swap the function code to **COFOG GF04.5
(Transport)** — this makes competitive-tile "#5 EU peer context" **near-mechanical, not bespoke**.
(The road-death league table itself still comes from Eurostat/`eurostat_road_safety.ts`.)

### Minor confirmations
- New `AwarderBreadcrumb` shipped (`0d44a3fb4`): Управление › Обществени поръчки › Държавни сектори ›
  Възложители › `<awarder>` — the transport awarder pages inherit it free.
- Watch for **shared-Булстат EIK** name collisions (МВР's `000695235` needed a pinned canonical name,
  `892453b83`); spot-check the transport EIKs' awarder names render canonically (none observed so far).

---

## Audit rev 2.0 (2026-07-15) — NEW `/sector/:slug` architecture; group dashboard SHIPPED

The whole sector system was refactored into a **registry-driven `/sector/:slug`** platform since
rev 1.1. Both of rev 1's structural assumptions are now dead: there is **no `/transport` standalone
screen** and **no pack on `/awarder/000695388`**. Everything below in rev 1.1 / the body about
*wiring* is superseded by this section (the *entity universe*, *thesis*, *competitive research* and
*tile ideas* remain valid).

### What the architecture is now
- A generic **`SectorDashboardScreen`** (`src/screens/sector/SectorDashboardScreen.tsx`) renders
  `/sector/:id` from a config in **`src/screens/sector/sectorDashboards.ts`** (`SECTOR_DASHBOARDS`).
  Each entry: `{id, titleKey, descKey, agency, leadEik, members[], browsePackId?, ThematicTiles?}`.
- KPIs roll up over the member EIK-set via **`useAwarderGroupModel`** → `/api/db/awarder-group-model`
  (accepts an arbitrary ≤300 EIK set, no server allowlist — verified). A `SectorAwardersTile` lists
  every member (grouped by `member.group`), each chip → `/awarder/:eik`.
- If a **pack** is registered under `leadEik` in `sectorPacks.tsx`, the pack *becomes the entire
  dashboard content* (generic KPI row skipped); otherwise the generic KPI row + `SectorSpendByYearTile`
  + `SectorTopContractorsTile` render, then optional `config.ThematicTiles`, then the awarders tile.
- The awarder page for a `leadEik` **auto-suppresses** the domain pack and links across to the
  sector dashboard (via `sectorDashboardForLeadEik`). The hub is **`/governance/sectors`**; each
  tile's headline € comes from `data/procurement/derived/sector_stats.json` (regen: `npm run
  db:gen-sector-stats`, needs the DB). Full file map: mirror the security sector.

### Phase 0 — prototyped then REVERTED (see Audit rev 3.0; not built)
> ⚠ The changes described in this subsection were made, verified, and then **reverted** at the
> operator's request. They are kept here as the proven recipe, NOT as shipped state.

Transport was a single-member (МТС-only) stub. Prototyped upgrading it to a real **11-entity group**,
verified live at `/sector/transport`, then rolled back:
- **New `src/lib/transportReferenceData.ts`** — the curated EIK allowlist (`TRANSPORT_ENTITIES`,
  5 universes, `TRANSPORT_SECTOR_EIKS`, `TRANSPORT_LEAD_EIK`, labels), mirroring `securityReferenceData.ts`.
- **`sectorDashboards.ts`** — transport `members` now map `TRANSPORT_ENTITIES` (grouped by universe);
  `TRANSPORT_EIK` re-exported from the reference data.
- **`sectorPacks.tsx`** — `SECTOR_BROWSE_PACKS.transport.eiks` widened to `TRANSPORT_SECTOR_EIKS`
  (the `?sector=transport` browse now covers the whole group; `awarder_eik` is a `filter:"in"`
  column so no server change).
- **`sector_stats.ts`** — `transport` metric EIK-set → `TRANSPORT_SECTOR_EIKS` (regen pending a DB run).

**Verified in-browser** (`?pscope=all`): **€5.9bn / 3,958 contracts / 11 awarders**, top contractor
БДЖ-Пътнически €980.6M, a 2011-2026 spend-by-year chart (rail/EU surge: 2019 €864M, 2025 €1.1bn,
2026 €1.5bn), members grouped by 5 universes, no console errors. Parliament-scope → €9.8M (5 active).
tsc + eslint clean. **Then reverted** — the committed `/sector/transport` is the single-member stub.

### The FROZEN transport group (roads excluded — per the dedicated-roads constraint)
11 EIKs, measured 2026-07-15. АПИ (000695089) and Автомагистрали ЕАД (831646048) are the **`roads`
sector** — excluded here; transport keeps only a minimal roads cross-link. Метрополитен (000632256)
is municipal — excluded.

| Universe | Entity | EIK | €m |
|---|---|---|---|
| ministry | Министерство на транспорта и съобщенията (МТС, lead) | 000695388 | 2,197 |
| rail | НКЖИ (rail infrastructure) | 130823243 | 2,878 |
| rail | „БДЖ — Пътнически превози" | 175405647 | 423 |
| rail | „БДЖ — Товарни превози" | 175403856 | 124 |
| rail | Холдинг БДЖ | 130822878 | 33 |
| rail | ИА „Железопътна администрация" (ИАЖА) | 130663221 | 0.1 |
| maritime | ДП „Пристанищна инфраструктура" | 130316140 | 220 |
| maritime | ИА „Морска администрация" | 121797867 | 11 |
| aviation | ГД „Гражданска въздухоплавателна администрация" | 121805755 | 3.1 |
| road | ИА „Автомобилна администрация" | 121410441 | 46 |
| road | ДАБДП (road safety) | 177344399 | 2.0 |
| — | **Group total** | — | **≈5,938** |

### Next: a bespoke `TransportPack` (mirror `MvrPack`) — Phase 1+
The group dashboard is the generic tier. To reach "world's best," add a pack under `TRANSPORT_LEAD_EIK`
in `PACKS` (then it replaces the generic KPI row): `src/data/procurement/useTransport.tsx` +
`src/lib/transportAttributes.ts` (CPV classifier + `buildTransportModel`) + `src/screens/components/
procurement/transport/TransportPack.tsx` + tiles. The competitive-research tiles below map onto its
`PackSection` bands. A universe `<Select>` (ministry/rail/maritime/aviation/road) segments the group.

---

## Competitive research (rev 2.0, 2026-07-15) — civic transport platforms → adoptable tiles

Surveyed the best civic transport-money & safety dashboards worldwide. Roads has its own sector, so
these emphasize **rail subsidy, ports, airport/toll concessions, EU absorption, and safety**.

**Top 5 differentiators to lead the pack with (all money-first, data-ready):**
1. **Rail subsidy-dependency tile** ⭐ — state subsidy € vs farebox € for БДЖ, subsidy-per-passenger
   + farebox-recovery ratio. *Inspired by US NTD (farebox recovery) + UK ORR (govt-support-vs-income
   split).* Data: budget subsidy line (update-budget) + БДЖ revenue/ridership (ГФО). THE flagship story.
2. **Concession scorecard (airports + toll)** ⭐ — per-concession card: concessionaire, term, upfront
   + annual fee/revenue-share to the state, traffic served. *World Bank PPI airport/toll modules.*
   Data: Sofia Airport (SOF Connect/Meridiam), Varna/Burgas (Fraport), АПИ toll — public fees + GFO,
   some terms curated.
3. **EU-funds transport absorption burn-down** ⭐ — planned → contracted → paid for ОП „Транспортна
   свързаност" vs ОПТТИ (99.4% closed). *EU Cohesion Open Data / Kohesio.* Data: existing ИСУН funds
   ingest, filtered to transport OP.
4. **Megaproject cost-growth vs Flyvbjerg reference bands** ⭐ — per project tender-estimate →
   contracted → paid, plotted against Flyvbjerg rail (+45%)/road (+20%) bands. *Reference-class
   forecasting + UK IPA cost-vs-schedule.* Data: corpus УНП lineage + amendments.
5. **"Bulgaria in the EU league table" safety strip** ⭐ — road deaths per million across EU27, BG
   near the bottom, + trajectory-vs-2030-halving-target line. *ETSC PIN + EU CARE dashboard.* Data:
   Eurostat / the existing `eurostat_road_safety.ts` watcher (already ingested for security). Reuses
   `/indicators/compare` peer machinery.

**Further ranked ideas:** per-entity USAspending-style spend profile (already have via group model);
investment-vs-maintenance capital split (ITF/OECD); single-bidder/competition-health per awarder
(Prozorro/DoZorro; bid counts at `release.bids.statistics`); forward megaproject pipeline timeline
(UK IPA / Australia ANZIP; from award dates + Приложение III investment annex); ports throughput vs
capex (ITF + NSI/Eurostat maritime); toll-revenue-vs-network-spend loop (links to /sector/roads);
peer-context KPI header (rail modal share, investment %GDP — EU Transport Scoreboard); civic red-flag
watchlist (existing risk machinery); rail delay-compensation € (UK ORR — low BG feasibility, stretch).

Positioning still holds: **nobody in BG unifies transport money**; sigma.midt.bg re-skins the same
АОП data. Lead = rail subsidy-dependency + the concession/absorption money story.

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

---

## Phase 3 scope — Rail subsidy-dependency tile (the flagship, 2026-07-16)

The "who pays for the railway" tile (competitive research #1 — US NTD farebox recovery + UK ORR
government-support-vs-income). **Probed all three sources against real data; the picture is far better
than the earlier "not feasible" note.** Two of three are cached/reachable now; only the farebox ratio
needs a scrape.

### Sources (probed, not assumed)
| # | Data | Status | Where |
|---|---|---|---|
| **A. Subsidy €** | State PSO subsidy to БДЖ-Пътнически + infrastructure subsidy to НКЖИ, annual | ✅ **CACHED — no fetch** | `raw_data/budget/law-YYYY.html.gz` (2018-2025). The subsidies appendix carries numbered lines: `1.2.1.1 за „БДЖ – Пътнически превози" = 227 890` and `1.2.1.2 за НКЖИ = 353 210` (хил. лв, 2025). Multi-year verified: БДЖ PSO **196.2M (2023) → 209.9M (2024) → 227.9M (2025)** хил. лв. |
| **C. Ridership** | Rail passengers + passenger-km, annual | ✅ **Eurostat, reachable** | `rail_pa_total` (THS_PAS) → BG **21.8M passengers (2023)**; `+ unit=PKM` for passenger-km. Same fetch pattern as the COFOG ingest just shipped. |
| **B. Farebox revenue** | БДЖ-Пътнически sales revenue (нетни приходи от продажби) | ⚠ **Scrape — the hard part** | NOT in our TR feed (`raw_data/tr/state.sqlite` has only `companies`/`company_persons` — no acts/ГФО table). Needs the ГФО from `portal.registryagency.bg` (discover БДЖ-Пътнически 175405647 ActID → PDF → parse код 15000 нетни приходи от продажби), or БДЖ Holding's consolidated annual report (holding.bdz.bg). See [[reference_tr_gfo_documents]]. |

### Phase 3a — MVP tile from A + C only (no scrape, both proven)
Buildable immediately off cached law HTML + one Eurostat fetch:
- **Subsidy split + trend** — PSO to БДЖ (operating) vs infrastructure grant to НКЖИ, stacked, per year.
  2025 ≈ €116.5M PSO + €180.6M infra = **€297M** total rail subsidy (хил.лв ÷ 1.95583; EUR display, [[feedback_bg_uses_eur.md]]).
- **★ Subsidy per passenger** = PSO subsidy ÷ rail ridership → the headline "the state puts ~€5 into
  every БДЖ ticket" (PSO-only ≈ €116.5M / 21.8M ≈ **€5.3/passenger**; +infra ≈ €13.6). Use PSO for the
  per-ticket line; show НКЖИ infra separately (it is track, not tickets).
- Framing: "Кой плаща за влака" — the subsidy IS the story even before the farebox ratio.

### Phase 3b — full farebox recovery (adds source B)
- **Farebox recovery ratio** = passenger revenue ÷ (revenue + subsidy) — "fares cover X% of БДЖ; the
  rest is subsidy" — the "3 лв субсидия на 1 лв приход" line. Needs the ГФО scrape (B).
- BDZ-Cargo insolvency + EU state-aid case as a caveat chip.

### Ingest plan
1. **`scripts/transport/parse_rail_subsidy.ts`** — parse the cached `law-YYYY.html.gz` subsidies section
   (regex on the `1.2.1.x – за <recipient> <amount>` numbered lines; recipients = БДЖ-Пътнически,
   НКЖИ, + the автобусни/вътрешноградски transfers for context) → `data/transport/rail_subsidy.json`
   `{years:[{fiscalYear, psoEur, nkzhiInfraEur, busEur}]}`. Reuses `raw_data/budget/` — a one-off over
   cached files, re-run when a new law lands (fold the trigger into [[update-budget]], `budget_law` watcher).
2. **`scripts/transport/fetch_rail_ridership.ts`** — Eurostat `rail_pa_total` (THS_PAS + PKM), BG series
   → `data/transport/rail_ridership.json`. Mirror `fetch_cofog.ts`; wire into [[update-macro]] or a
   `eurostat_rail` watcher.
3. (3b) **`scripts/transport/fetch_bdz_gfo.ts`** — discover + fetch БДЖ-Пътнически ГФО PDF, parse
   sales-revenue. Manual-ish, gated behind `--gfo`; a curated fallback constant (like defense mega-programs)
   if the parse is brittle.
4. **`TransportSubsidyTile.tsx`** — reads both artifacts; stacked subsidy bars + subsidy-per-passenger
   KPI + (3b) farebox-recovery gauge. Band after `transport-budget` (money context cluster). Honesty:
   per-passenger uses PSO only; infra shown separately; annual (ignores `scopeWindow`).
5. **AI tool** `railSubsidy` (ai/tools/transport.ts) — subsidy total + per-passenger + (3b) recovery.
6. Plumbing: data_map dataset `transport`, `data/transport/` served (bucket:sync), watchers +
   process-watch-report mapping, [[feedback_pg_changelog_required]] N/A (JSON not PG).

### Effort & risk
- **3a: ~½ day, low risk** — both sources proven; the law-parse regex is the only real work (the numbered
  `1.2.1.x` structure is stable across 2018-2025). Ships the flagship headline (subsidy-per-passenger).
- **3b: ~1 day, medium risk** — the ГФО scrape/parse is the fragile bit (PDF layout, revenue-code
  extraction; БДЖ-Пътнически sales revenue may bundle ancillary income). Curate-fallback if brittle.
- Caveat to disclose: the law figure is the BUDGETED subsidy (ЗДБ), not executed; НКЖИ infra subsidy is
  not per-passenger; ridership is national rail ≈ БДЖ (it is the dominant operator, but not identical).

---

## Marker map SHIPPED (facility map, 2026-07-16)

`TransportFacilityMap` — one marker per city where transport entities are based, coloured by
ЗОП spend / single-bid share, badged with contract count, each linking to `/awarder/:eik`. Mounted
at the TOP of `TransportPack` (band `transport-map`). Reuses `SectorPointMap` (the shared
court-load / МВР-directorate map component).

Pattern mirrors `074_mvr_directorate_map`: static crosswalk `transport_facility_geo` (schema
**076**, loaded by `load_transport_facility_map_pg.ts`) + serving fn `transport_facility_map(eiks[],
from, to)` folding the windowed contracts corpus per entity; route `/api/db/transport-facility-map`
(`missingMigrationEmpty`); hook `useTransportFacilityMap`.

**Seat reality (documented in the caption):** all 11 group entities are Sofia-REGISTERED, so the
seat bridge lands 9 on София. A small curated PHYSICAL-facility override in the loader pins the two
maritime bodies (Морска администрация, Пристанищна инфраструктура) to Варна — the map is Sofia (9,
paginating cluster) + Varna (2). Networks (rail, roads) have no single point; АПИ roads are a
separate sector (excluded). **EXPLAIN ANALYZE:** bitmap index scan on `idx_contracts_awarder`, ~81ms
worst-case (all-time, full group) — no new index. Verified live: 11 entities, 2 markers, badges
3379 (Sofia) + 579 (Varna), 0 console errors. **NOT deployed** (Cloud SQL migration 076 + `firebase
deploy --only functions:db` pending, separate).

---

## Phase 3a SHIPPED — rail subsidy-dependency tile (2026-07-16)

The flagship "who pays for the railway" tile, from sources A + C only (no scrape), as scoped.

**Ingests (both ran, artifacts in `data/transport/`):**
- `scripts/transport/parse_rail_subsidy.ts` → `rail_subsidy.json` — parses the CACHED ЗДБ law HTML
  (`raw_data/budget/law-YYYY.html.gz`) for the БДЖ-Пътнически PSO (1.2.1.1) + НКЖИ (1.2.1.2) operating
  + capital (2.2.x) lines, order-based (operating first), хил.лв → EUR ÷1.95583. 8 years 2018-2025:
  PSO €89.5M → **€116.5M**; НКЖИ oper €74.1M → €180.6M.
- `scripts/transport/fetch_rail_ridership.ts` → `rail_ridership.json` — Eurostat `rail_pa_total`
  (THS_PAS + MIO_PKM), BG. 15 years; 2025 = 20.98M passengers.

**Tile** `TransportSubsidyTile` (`useRailSubsidy` joins the two) — mounted after `transport-budget`
(band `transport-rail-subsidy`). Headline **★ €5.55 subsidy per passenger (2025), ×1.3 since 2018**;
total rail subsidy €443M split (PSO €116.5M / НКЖИ €289.8M / БДЖ capital €36.8M); per-passenger trend.
Per-passenger uses PSO only (per-ticket money); annual (ignores scope). **AI tool** `railSubsidy`
(registry + router rule: субсидия/на пътник → railSubsidy, verified 5/5 routing) returns 5.55 €/pax +
€443M + 20.98M passengers.

Verified live: tile renders, both JSONs serve (vite `serve-data-dir`), router 5/5, tool runs, 0 console
errors, tsc + ai-tsc + eslint clean. **NOT deployed** (bucket:sync of `data/transport/` to GCS, +
`update-budget`/`update-macro` watcher wiring + a `data_map` `transport` dataset entry are the pending
deploy-adjacent follow-ups — the build does NOT require them). **Phase 3b** (farebox-recovery ratio via
the БДЖ ГФО scrape) remains the only unbuilt transport item.

---

## Productionization pass — SEO / OG / perf / mobile (2026-07-16)

- **Sitemap:** `/sector/transport` (+ `/en/`) is auto-derived from `SECTOR_DASHBOARD_IDS`
  (`scripts/sitemap/route_defs.ts:15`) — guaranteed included, no change needed.
- **Static prerender SEO:** upgraded the `transport` `SECTOR_PAGES` entry (`scripts/prerender/routes.ts`)
  from the stale "Ministry's procurement" copy to the real group dashboard — title/description/intro now
  name rail (НКЖИ/БДЖ), ports, ~€5.9bn, EU absorption, the per-passenger rail subsidy, and that roads
  (АПИ) are separate. Keyword-rich, bilingual.
- **OG image:** re-shot `public/og/sector-transport.png` (2400×1260) at all-time scope — KPIs
  (rail 58%), insight chips (€2.1bn construction, €1.5bn peak) and the facility-map hero. Replaces the
  stale single-member capture. (One-off; other sectors' OGs untouched.)
- **Performance (local, warm):** critical path is ONE parallel DB call — `awarder-group-model` 74ms /
  285KB; `transport-facility-map` 6ms/3KB, funds/top-contracts 2ms, static JSONs 1–2ms. All parallel,
  `staleTime:Infinity`. The dev ×2 fetches are React-StrictMode double-invoke (React Query dedupes in prod).
- **JSON→PG assessment:** transport data is ALREADY correctly split — procurement + the marker map are
  PG (indexed on `idx_contracts_awarder`, EXPLAIN clean); `rail_subsidy.json`/`rail_ridership.json` are
  2KB annual reference series loading in 1–2ms — correctly static JSON (like `road_safety`/`cofog`).
  Migrating them to PG would add a round-trip for no gain. No migration appropriate.
- **Mobile (375×812):** 0px horizontal overflow, no oversized elements, all 9 bands render, Leaflet map
  loads, KPI cards stack (2-col grid), subsidy composition + trend + EU-funds all readable.

---

## Watchers / data-map / docs wired (2026-07-16)

- **Watcher (new):** `scripts/watch/sources/eurostat_rail.ts` (`eurostat_rail`, fingerprints Eurostat
  `rail_pa_total`, monthly) → registered in `scripts/watch/sources/index.ts`. Fingerprint tested live
  (update 2026-07-08, 776ms). COFOG GF04.5 rides the EXISTING `eurostat` (`gov_10a_exp`) watcher; the
  rail subsidy rides the EXISTING `budget_law` watcher (parses the same cached ЗДБ HTML) — no new source
  for either.
- **process-watch-report** (`.claude/skills/.../SKILL.md`, both mapping surfaces): `eurostat_rail` →
  `npx tsx scripts/transport/fetch_rail_ridership.ts`; the `budget_law` row now also notes
  `parse_rail_subsidy.ts`.
- **Data map** (`scripts/data_map/model.ts` → regenerated `data/data_map.json`): new `transport`
  SOURCE_GROUP (members `["eurostat_rail"]`), `transport` DATASET (`data/transport/`), edge
  `src:transport→ds:transport`, and AI_PATH_RULE `/^\/transport\//`. `npm run data:map` passes (asserts
  every watcher source placed — `eurostat_rail` covered). This is what the `/data` pages render.
- **README:** a feature bullet for the transport view, a `data/transport/` data-directory row, and a
  data-sources entry (Eurostat rail + ЗДБ subsidy).
- **Load performance (local):** full `/sector/transport` render (12 tiles incl. Leaflet map + subsidy)
  in **~289ms**, domInteractive 36ms, 0 console errors. Critical path unchanged (74ms `awarder-group-model`);
  the new watcher/data-map are build/offline artifacts with no runtime cost. tsc + eslint clean.

**Deploy-adjacent (still pending, separate):** Cloud SQL migration 076 + `firebase deploy --only functions:db`
(facility map), `bucket:sync` of `data/transport/` to GCS (subsidy/ridership JSONs in prod), commit the OG asset.

---

## OG image → map-focused (2026-07-16)

Replaced the KPI-clip OG with a **map-focused** capture — the facility marker map (Bulgaria with the
София `3379` + Варна `579` markers) is the sector's signature visual and reads far better as a social
card. Made it durable + reproducible:
- **`scripts/og/screenshot_transport.ts`** (new) — dedicated capture: frames the `[data-og=
  "transport-facility-map"]` card at `?pscope=all`, `deviceScaleFactor:1` (native 1200×630), gated on
  `.leaflet-container` + ≥4 loaded tiles so it **fails loudly** rather than silently capturing the top
  promo banner, then **sharp palette-quantises** the map raster (2.3MB → **262KB**, comparable to the
  ~200KB flat-UI sector OGs).
- **`scripts/og/screenshot_sectors.ts`** — transport EXCLUDED from the bulk loop (`filter(id !==
  "transport")`) so a bulk re-run can't clobber the hand-framed map OG.
`public/og/sector-transport.png` regenerated (262KB). tsc + eslint clean.

---

## Map redesign — seat map → infrastructure map (2026-07-16)

Operator feedback: the seat-based facility map showed "just 2 marker groups" (all 11 state-transport
entities are Sofia-registered → degenerate София + Варна). **Rebuilt the map to show WHERE the money
is spent** — the towns named in the group's construction/rehab contract titles.

- **Probed the alternatives:** contractor-seat map = only 21% value coverage (the big money — €981M БДЖ
  PSO, rail consortia, foreign Шкода — isn't in the Commerce Registry); title→town parsing = the winner.
- **New:** `076_transport_project_map.sql` (`transport_project_site` table + `transport_project_map()`
  fn), `load_transport_project_map_pg.ts` (parses each contract title against the settlements газетеер,
  word-boundary match, ≤6 towns/contract, denylist for ambiguous names), `useTransportProjectMap.tsx`,
  `TransportProjectMap.tsx`. Replaced the facility map files (all uncommitted, so clean swap). Route
  `transport-project-map`, npm `db:load:transport-project-map:pg`.
- **Result:** **113 towns** (999/3,958 contracts sited): София €537M, Видин €405M, Пловдив/Бургас
  ~€340M, Септември €248M, Костенец €210M, Свиленград, Русе, Горна Оряховица… — the real rail corridors
  + ports across the whole country. **113 markers vs 2.** Honest caption: a contract spanning two towns
  appears at both; operations/rolling-stock/fuel are network-wide (~70% of value) and correctly absent.
- **EXPLAIN ANALYZE** 62ms (bitmap `idx_contracts_awarder` + `idx_transport_project_site_key`, no new
  index). tsc + eslint clean, 0 console errors. OG re-captured (242KB — Bulgaria full of markers).
  README/plan updated. NOT deployed (Cloud SQL 076 + `firebase deploy --only functions:db` pending).

## Map v2 — town dots → physical infrastructure (rail lines + typed points) (2026-07-16)

Operator feedback again: the town-dot map "doesn't show much information" and would read better as the
**physical infrastructure named in the titles** — rail lines and ports — the way НЗОК maps hospitals and
the judiciary maps courts. **Probed the corpus:** of 3,958 group contracts, **195 name exactly two towns**
(a rail SECTION — "Костенец–Септември", "Пловдив–Бургас", "Горна Оряховица–Шумен"; samples confirm genuine
railway works), **693 name one** (a station/port/site), 110 name a port, the rest are network-wide.

- **Data model swap:** `transport_project_site` (one row per town) → `transport_project_link` (one row per
  contract-link, `kind='segment'` carries both endpoints, `kind='point'` carries one + a `facility` type:
  rail/port/station/junction from title keywords). `transport_project_map()` now folds segments by the
  UNORDERED town pair (`LEAST`/`GREATEST`) and points by town, returning `{segments, points}`.
- **Loader** (`load_transport_project_map_pg.ts`): title→towns; exactly 2 → a segment (line), exactly 1 →
  a typed point; 3–6 → dropped (multi-site framework); >6 → dropped. **195 segments + 693 points.**
- **Map component:** extended the shared `SectorPointMap` with an additive optional `lines` prop
  (`SectorMapLine` → Leaflet `<Polyline>` with hover card + click-through; line endpoints folded into the
  bounds fit). Zero impact on the court/МВР callers. `TransportProjectMap` builds both: lines coloured +
  width-scaled by spend (2.5→8px), points as count-badged typed markers; shared spend / single-bid metric
  toggle; legend shows both shapes.
- **Result:** the map now **traces the rail corridors** — the thick dark Видин–София (€395M), Пловдив–Бургас
  (€240M), Костенец–Септември (€199M) sections as lines, plus ports (Варна 92, Русе 69, Бургас 86/58) and
  stations as badges. 73 sections + 72 sites at all-time scope. Reads like a transport map, not a dot cloud.
- **EXPLAIN ANALYZE** 138ms worst case (full group, all-time): drives from the tiny `transport_project_link`
  table probing `contracts_pkey` — no seq scan on contracts, link table small so no new index. tsc + eslint
  clean, 0 console errors, OG re-captured (246KB — Bulgaria laced with rail lines). Route + npm names
  unchanged (`transport-project-map`). NOT deployed (Cloud SQL 076 + `firebase deploy --only functions:db`).
