# Отбрана (МО / Българска армия) view — v1

## Status (2026-07-09, rev 1.3 — pre-implementation audit applied)

- **Design doc only** — nothing built yet. Written against the five shipped
  "Държавни структури" dashboards (АПИ / НОИ / НЗОК / ВСС + ДФ „Земеделие“ awarder) so the
  defense view reuses their proven anatomy instead of inventing a new shell. **ВСС + `/judiciary`
  are now SHIPPED** and are the closest analogue — copy them, not the older packs.
- **Rev 1.3 audit corrections (blocking, read before coding):**
  1. **Thesis was factually wrong.** МО's visible corpus is NOT thin: 1 212 contracts / €852M of
     real aviation & vehicle sustainment. Part 2 rewritten.
  2. **Defense family of 7 EIKs** (€940,6M) — the "single entity" dismissal was wrong; use the
     ВСС alias fan-out (`useQueries` + `combine`).
  3. No `defenseBenchmarks.ts` — split `defenseReferenceData.ts` + `defenseAttributes.ts`;
     build on the generic **`buildAwarderModel` / `SectorClassifier`** seam.
  4. **МО budget belongs to `update-budget`** (`budget_law` watcher), not `update-defense`.
  5. **No `DEFENSE_AWARDER_PATH`**; nav key `defense_nav` → `/defense`, `unscoped: true`.
  6. `/defense` prerender lives in **`scripts/prerender/routes.ts`**, not `dynamicRoutes.ts`.
  7. Budget types + budget hook go in `src/data/budget/{types.ts,useBudget.tsx}`.
  8. Router = guarded `has()` cue logic with **inlined `MOD_EIK`** + substring-collision defenses.
  9. Data map needs **cross-dataset feature edges** (`ds:budget`, `ds:macro` → `f:defense`).
 10. `SectorPackProps.scopeWindow` is `ScopeWindow` (not `RoadsWindow`); `/defense` is a plain
     lazy child route (not `<LayoutScreen>`); screen reuses `ProcurementScopeControl`.
- **Rev 1.1** adds the full engineering plumbing (Parts 4–8) modeled on
  `docs/plans/water-view-v1.md` and the real contracts browse/detail screens: SQL-perf
  gates, watcher + process-watch-report wiring, changelog, AI chat tools, data-map/README
  docs. Key reuse confirmed from source: "see all МО contracts" = `CompanyContractsDbScreen`
  scoped by `awarder_eik` (no new screen); `SECTOR_BROWSE_PACKS` is unbuilt and unneeded here.
- **Rev 1.2** adds Part 9 (sitemap, static prerender, OG screenshots). Confirmed from source: all
  three pipelines are driven by one `INSTITUTION_PACKS` entry in `scripts/prerender/institutions.ts`;
  a `data-og`-tagged hero chart/map produces the 1200×630 OG card via Playwright.
- Competitive research + a static layout mockup are done (SIPRI, NATO, EDA, МО,
  Prozorro/DOZORRO, TI GDI, USAspending, IISS, Kiel tracker). See memory
  `project_defense_pack.md`.
- **МО EIK = `000695324`** (confirmed: strategy.bg institution profile + АОП buyer
  profile; ЦАИС ЕОП buyer/1199). Route: `/awarder/000695324`.

---

## Part 1 — The common anatomy we're reusing (extracted from АПИ/НОИ/НЗОК)

Same seam as `judiciary-vss-v1.md`. All existing state-entity dashboards are
**sector packs**, not standalone screens: they mount on the generic awarder page
`/awarder/:eik` via a lazy registry and render **only the domain-unique tiles** —
the generic buy-side tiles already sit above them.

### Mounting mechanism
- `src/screens/components/procurement/sectorPacks.tsx` — `PACKS: Record<eik,
  ComponentType<SectorPackProps>>`; `getSectorPack(eik)` returns the pack;
  `src/screens/dev/CompanyDbScreen.tsx` renders it (lines ~383, ~913) in a
  `<Suspense>` as a hero **below** the generic KPIs, **above** "Какво купува".
- Each pack is a `lazy()` dynamic import keyed by EIK — only packed buyers pay the
  contract-corpus download.
- Canonical path constants (`ROADS_AWARDER_PATH`, `NOI_AWARDER_PATH`,
  `NZOK_AWARDER_PATH`, `DFZ_AWARDER_PATH`) are the single source for nav surfaces.

### Pack component contract
```ts
// sectorPacks.tsx
export interface SectorPackProps {
  eik: string;
  scopeWindow: ScopeWindow; // { from: string|null; to: string|null } — [from,to), from useAwarderContracts
}
```
`scopeWindow` is inherited from the host's `ProcurementScopeControl` pill
(`?pscope=ns|all|y:YYYY`). Data flow in every pack:
`useAwarderContracts(eik)` → `scopeByWindow(contracts, from, to)` → `build<Domain>Model(...)`.

**The actual reuse seam (missed in earlier drafts): `buildAwarderModel` + `SectorClassifier`**
in `src/lib/awarderModel.ts`. ВСС does *not* write a bespoke engine — `buildVssModel` is a thin
wrapper: `buildAwarderModel(rows.filter(isSpendRow), vssClassifier)`. Returning the standard model
surface (`totalEur`, `years[]`, `categories[]`, `directShare`, `suppliers[]`) makes the KPI row,
insight chips and category tile light up for free. Do the same for defense.

**Domain constants live in TWO files, not one** (there is no `<domain>Benchmarks.ts` for ВСС):
`src/lib/vssReferenceData.ts` (EIK + alias set, CPV→category map, labels, colors) and
`src/lib/vssAttributes.ts` (the classifier + `buildVssModel`). Mirror as
`defenseReferenceData.ts` + `defenseAttributes.ts`.

### Shared UI skeleton (identical across all packs)
1. **Data hook** `use<Domain>(eik, scopeWindow)` in `src/data/procurement/` — fuses
   `useAwarderContracts(eik)` with domain budget/fund JSON. Returns
   `{ model, ...domainData, isLoading }`.
2. **Loading skeleton** — `<div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />`.
3. **Empty guard** — `return null` when no model AND no domain data.
4. **Section wrapper** — `<section className="space-y-4">`.
5. **Header row** — a lucide icon + `<h2 className="text-lg font-semibold">`, bilingual inline title.
6. **KPI row** — `grid gap-3 grid-cols-2` of `StatCard` (`@/screens/dashboard/StatCard`),
   `formatEurCompact` values. Only **domain-only** KPIs (generic total/contracts/suppliers
   render in the awarder header above).
7. **Insight chips** — auto-generated `{text, warn?}[]` pills; `warn` uses
   `WARN_CHIP_COLORS` (`../chipStyles`).
8. **Hero "bridge/flow" tile** — the signature viz placing the small procurement
   number inside the big money flow (`NzokBudgetBridgeTile`, `NoiFundFlowTile`,
   `RoadNetworkMap`).
9. **Domain tiles** — `defense/Defense<Feature>Tile.tsx`, each consuming a slice of `model`.
10. **Footer provenance** — `<p className="text-[11px] text-muted-foreground/80">`, bilingual source note. Non-negotiable.

### What every pack inherits FREE from the awarder page above it
KPI header (total/contracts/suppliers), **Top Contracts** (`CompanyTopContractsTile`),
**Top Contractors** (`AwarderTopContractorsTile`), **CPV/procedure breakdown**
(`ProcurementBreakdownTile`), **EU competition benchmarks** (`ProcurementBenchmarksTile` —
single-bid ≤10% green / >20% red), **money→suppliers Sankey** (`EntityFlowTile`, with MP
overlay), **portfolio treemap** (`CompanyPortfolioTreemap`), **by-year chart**
(`CompanyByYearChart`), **tenders pipeline** (`AwarderTendersTile`), **КЗК appeals**
(`AwarderAppealsTile`), the scope pill, risk chips, geography, officials, related entities.

### Conventions
- **Bilingual inline** in packs (`const bg = lang === "bg"`), **no i18n keys** — only the
  nav label goes through i18next.
- Shared shells: `Card/CardHeader/CardTitle/CardContent` from `@/ux/Card`, `StatCard` from
  `@/screens/dashboard/StatCard`, `Select` from `@/components/ui/select`, `formatEurCompact`
  from `@/lib/currency`. Reusable geo/table primitives available: `ProcurementOblastMap` /
  `ProcurementChoroplethTile` and the server-side **DbDataTable** registry.
- Domain constants + labels in `@/lib/<domain>Benchmarks.ts` (EIK, category labels, ref levels).
- Optional widgets: local year `Select` (НЗОК — annual budget where the parliament window is
  meaningless), map metric selector + click-to-focus (Roads), static explainer card (Roads).

---

## Part 2 — The real thesis: sustainment is visible, acquisition is not

**Corrected 2026-07-09 after querying the live corpus. The earlier draft claimed МО's visible
procurement was thin routine support (fuel/food/uniforms). That is FALSE.**

Measured against local PG (`contracts`, EIK `000695324`):

| Fact | Value |
|---|---|
| МО contracts | **1 212** (2011-01-03 → 2026-06-02) |
| МО awarded value | **€852M** (across 3 `awarder_name` variants) |
| Defense family (7 EIKs incl. subordinates) | **2 614 contracts, €940,6M** |
| Open procedure, share of value | **17,8%** |
| Negotiated **without** prior notice, share of value | **13,2%** |
| Single-bid contracts | **243 = 44,3%** of the 548 with bid data (**45% coverage**) |
| МО tenders | **230** |

The visible contracts are **real defense sustainment**, not stationery: C-27J Spartan integrated
logistic support (€38,8M + €23,2M), RD-33 engines for MiG-29 (€21,8M), L-39ZA airframe overhaul
(€20,0M), Mi-24 helicopter airworthiness restoration (€14,2M), Jet A-1 aviation kerosene (€15,0M),
high-mobility vehicles (€21,3M).

**So the thesis is sharper than "the corpus is thin" — and it is true:**

> **You can see, line by line, what it costs to keep the Soviet-era fleet flying.
> You cannot see what it costs to replace it.**

Sustainment (engines, overhauls, logistic support, fuel) flows through ЗОП into our corpus.
**Acquisition of new major platforms does not:** F-16 (~$2,6bn) and Stryker (~$1,38bn) are US
**Foreign Military Sales** — government-to-government, no competitive ЦАИС ЕОП record, only a
parliamentary ratification law. Weapons/ammunition/intelligence procurement is exempt under
**ЗОП чл. 148–149** (EU Dir. 2009/81/ЕО), чл. 149(1)(3) for intelligence.

**Design consequences (all changed from the earlier draft):**
1. The pack is **contract-led AND budget-led**. The generic tiles above it (top contracts,
   contractors, CPV, benchmarks, Sankey, by-year, tenders, appeals) render *richly*, not emptily.
   Phase 1 is worth far more than previously scoped.
2. **The competition story is a real, defensible finding**, not a footnote: 17,8% of value via
   open procedure; 44,3% single-bid among covered contracts (EU red line >20%); 13,2% of value
   negotiated without prior notice. `ProcurementBenchmarksTile` lights up.
3. The transparency tile still names the FMS/чл.149 gap — now framed as
   **sustainment-visible / acquisition-invisible**, which is more precise and more damning.
4. Non-contract data (%GDP path, equipment/personnel mix, mega-programs, exports, readiness)
   still loads via the **НЗОК/ВСС pattern** (budget + curated JSON hooks).

### The defense family (7 EIKs) — the plan was WRONG to dismiss this
The earlier draft said "single entity, no multi-EIK roll-up needed." The corpus disagrees:

| EIK | Entity | Contracts | Value |
|---|---|---|---|
| `000695324` | Министерство на отбраната (3 name variants) | 1 212 | €852M |
| `129008829` | ИА „Военни клубове и военно-почивно дело“ | 232 | €16,3M |
| `129010221` | Командване за комуникационно-информационна поддръжка и киберотбрана | 100 | €3,7M |
| `129010214` | Военно-географска служба | 65 | €0,9M |
| `129010545` | Информационен център на МО | 14 | €1,0M |
| `129010036` | Институт по отбрана „Проф. Цветан Лазаров“ | 16 | €1,5M |
| `129010142` | Комендантство — МО | 3 | €0,2M |

Follow the **ВСС alias pattern**: `useVss` fans out over `[VSS_EIK, ...VSS_ALIAS_EIKS]` with
react-query `useQueries` + `combine` (stable array identity — without it the model rebuilds on
every hover) and footnotes the `aliasEur` delta so the pack reconciles against the per-EIK awarder
header above it. Do the same in `useDefense`.

### Data-quality caveats that MUST be disclosed in-tile
- `procurement_method` is **NULL for 614 / 1 212 (51%)** — a clean direct-award % cannot be
  computed over the full span. Scope the chip to the ЦАИС era and say so.
- `number_of_tenderers` covers only **45%** of rows — the 44,3% single-bid figure is *of covered
  contracts*. `ProcurementBenchmarksTile` already prints a coverage line; keep it.
- `contracts.date` is **`text`** (not `date`); `amount_eur` is `double precision`. `scopeByWindow`
  string-compares ISO dates (fine); any date arithmetic needs an explicit cast.
- Three `awarder_name` variants share EIK `000695324` (incl. „Централно военно окръжие“, whose
  contract title confirms it is a МО sub-unit). Group by **EIK**, pick a canonical display name.

Because the national-defense story vastly exceeds procurement, defense — like the
judiciary — justifies **BOTH a pack and a dedicated screen**:

| Defense feature | Fits the awarder pack? |
|---|---|
| МО budget bridge (procurement as % of the МО budget) | Yes — pure pack, clone НЗОК |
| МО procurement lens, category split, top suppliers | Yes — free/near-free from corpus |
| "See all visible МО contracts" | Yes — **no new screen**: reuse `CompanyContractsDbScreen` scoped `{col:"awarder_eik", val:MOD_EIK}`; rows deep-link to the existing `/procurement/contract/:key` |
| Transparency gap (FMS/чл.149, what's visible vs classified) | Yes — belongs in the pack (explains the thin corpus above) |
| % GDP path to 5% (2%→3.5%→5% target lines, 2019 spike) | No — not a contract metric; screen |
| Equipment vs personnel vs ops crossover | No — NATO Table 8a; screen |
| Mega-programs board / lifecycle Gantt (F-16, Stryker, MMPV, ammo JV) | No — curated; screen |
| Arms-export boom (€1.65→2.83bn; Ukraine sub-flow) | No — МИ export report; screen |
| Readiness & personnel (21.8% vacancy, 16% reserve) | No — доклад за отбраната; screen |
| Peer benchmarking (per-capita, %GDP, %gov-exp vs RO/GR/HR/HU) | No — reuse `/indicators/compare` |
| Arms-flow Sankey (BG → PL/RO/CZ → Ukraine) | No — SIPRI/МИ; screen |

**Conclusion: phase it.** Ship the money story as a pack (fast, on-pattern), then
promote the full national-defense story to a dedicated `/defense` (Отбрана) screen
reusing the same primitives. The screen is essentially the published mockup.

---

## Part 3 — Phased build

### Phase 1 — `DefensePack` on `/awarder/000695324` (clone the НЗОК pack)
Cheapest ship; reuses the entire anatomy above. МО has its own first-level budget.

1. `src/lib/defenseReferenceData.ts` — `MOD_EIK = "000695324"`, `DEFENSE_ALIAS_EIKS` (the 6
   subordinates), CPV→category map + labels (авиационна поддръжка / двигатели и ремонт / горива /
   транспорт / ИТ и свръзки / строителство / медицинско / храна и облекло), category colors, the
   two МО policy areas (1200.01 отбранителни способности, 1200.02 съюзна сигурност) + 11
   programme codes.
2. `src/lib/defenseAttributes.ts` — `defenseClassifier` (a `SectorClassifier`) +
   `buildDefenseModel = (rows) => buildAwarderModel(rows.filter(isSpendRow), defenseClassifier)`.
   **Do not write a bespoke engine.**
3. `src/data/budget/types.ts` (EDIT) — `DefenseBudgetLine`, `DefenseBudgetYear`,
   `DefenseBudgetFile` (mirroring `JudiciaryBudgetFile`).
4. `src/data/budget/useBudget.tsx` (EDIT) — `useDefenseBudget()` react-query hook keyed
   `["budget","mo","budget"]` → `/budget/mo/budget.json`. **The budget hook lives here, not in
   `useDefense.tsx`.**
5. `src/data/procurement/useDefense.tsx` — `useQueries` fan-out over `[MOD_EIK,
   ...DEFENSE_ALIAS_EIKS]` with `combine` (stable array identity), `scopeByWindow`,
   `buildDefenseModel`, + `useDefenseBudget()`. Returns `{ model, budget, aliasEur, isLoading }`.
6. `src/screens/components/procurement/defense/DefensePack.tsx` — header (`Shield` icon),
   StatCards (visible procurement/year, МО budget/year, procurement's % of budget), insight chips,
   hero **`DefenseBudgetBridgeTile`** (`data-og="defense-hero"`; visible procurement inside the
   ~€2.2bn МО budget, FMS/classified remainder called out), **`DefenseTransparencyTile`**
   (sustainment-visible / acquisition-invisible + чл.149/FMS + Prozorro redaction principle),
   `DefenseCategoryTile`, provenance footer. Bilingual inline (`const bg = lang === "bg"`).
7. Register in `sectorPacks.tsx`: `PACKS[MOD_EIK] = DefensePack` via `lazy()`.
   **Do NOT export `DEFENSE_AWARDER_PATH`** — ВСС deliberately exports no `VSS_AWARDER_PATH`
   because its nav points at the `/judiciary` screen. Defense gets a `/defense` screen too.
8. Nav: single i18n key **`defense_nav`** ("Отбрана" / "Defence") → **`/defense`** (not the awarder
   path), in `reportMenus.ts` under `menu_group_state_entities` **and** in `ProcurementNav.tsx`
   `secondaryItems` with **`unscoped: true`** (the screen has no `?pscope`). Icon `Shield`.

**Cost: mostly assembly**, and the payoff is bigger than first scoped — €852M / 1 212 contracts
of real content behind the generic tiles. МО budget slice comes from `update-budget` (Part 5).
If the `/defense` screen slips, temporarily point `defense_nav` at `/awarder/000695324`.

### Phase 2 — dedicated `/defense` (Отбрана) screen (the national-defense story)
Mirror `src/screens/judiciary/JudiciaryScreen.tsx` exactly:
- Route: a **plain lazy child route** in `src/routes.tsx` (`path="defense"`) — **not** a
  `<LayoutScreen>` wrapper (earlier draft was wrong).
- `<Title description=…>` for SEO; stacked `space-y-4` sections; homepage width (no `max-w`), no tabs.
- **Reuse `ProcurementScopeControl`** with `allowAll={false}` + `nsLabelOverride="Последна година"`,
  mapping a year override onto the `ProcurementScope` vocabulary. Do **not** roll a new control.
- **Budget the full loading/error/empty triad** (judiciary spends real code here): `isLoading`
  skeleton (`h-[320px] animate-pulse`), an `isError || !data` fallback card, and each artifact gated
  independently so a failed `exports.json` doesn't blank the %GDP tiles.
- KPI grid responsive: `grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`.
- Add a **`DefenseAwardersTile`** mirroring `JudicialAwardersTile` — links МО + the 6 subordinate
  EIKs back to their `/awarder/:eik` pages (the "back to the money" tile).

Tiles (the published mockup, tile-by-tile):

- **Headline KPIs** — `StatCard` row: %GDP 2025 (2,06%), budget (€2,2bn), equipment share
  (32%), arms exports 2024 (€2,83bn).
- **Hero "Пътят към 5%"** (signature) — %GDP line 2014–2025 with dashed inline-labelled
  target lines (2% Уелс → 3,5% основна → 5% Хага-2035), conditional above/below color, 2019
  spike annotated as the one-off F-16 prepayment. New Recharts tile.
- **Structура на разхода** — NATO 4-category 100% stacked bars (equipment/personnel/
  infra/ops), 2019–2025, with the 20% equipment guideline line; the 8%→32% crossover is the
  story. Absolute↔share toggle (`Select`).
- **Мега-програми** — curated program board → lifecycle Gantt + cost-drift; F-16 (with the
  Gripen/veto-override 128-73/grounding+fuel-leak markers), Stryker, MMPV, Rheinmetall–ВМЗ
  ammo JV, T-72. Obligated-vs-ceiling framing.
- **Износ на оръжие** — the €1.65→2.83bn boom bars with the Ukraine sub-portion; note SIPRI
  TIV excludes ammunition → use МИ euro figures. Later: arms-flow Sankey (Arms Globe fork).
- **Хора и готовност** — 21.8% vacancy, 16% reserve, personnel-vs-capital budget split.
- **Peer compare** — reuse `/indicators/compare` radar: %GDP, per-capita (€314.84, EDA),
  %gov-exp (5.48%, EDA), equipment share; BG vs RO/GR/HR/HU.

Data ingest (new, small curated JSON — no heavy scrape):
`data/defense/gdp_share.json` (NATO Table 3), `.../category_split.json` (Table 8a),
`.../programs.json` (curated), `.../exports.json` (МИ report), `.../readiness.json` (доклад).
Eurostat COFOG GF02 + EDA xlsx fold into the existing macro/peers artifacts.

**Wire the plumbing with this phase** (Parts 5–8): the `update-defense` skill + the three
watcher sources + process-watch-report mapping; the `defense` SOURCE_GROUP/DATASET + AI_PATH_RULES
in `data_map/model.ts`; README data-sources/layout; and the AI chat tool family. `bucket:sync`
the new `data/defense/` JSON.

### Phase 3 — differentiators
- **Arms-flow Sankey/map** (BG → PL/RO/CZ → Ukraine) — SIPRI + МИ; the export story nobody
  visualizes.
- **GDI-style risk pillar** — reuse `computeProcurementRisk` on the visible corpus; 6-band
  scale, evidence-on-click, downloadable image scorecard (feeds the `naiasno-post` pipeline).
- **Program lifecycle Gantt + cost-estimate-vs-baseline drift** — the gap in the global
  market (no one ships this interactively).
- **Cabinet anchoring** — attribute the F-16 decision / 5% commitment / export surge to the
  governments that made them (reuse `cabinetAnchorContext`).

---

## Part 4 — Data model & SQL performance

Unlike water (42 operators × years, 52 reservoirs × daily) the defense-specific data is
**tiny** — annual NATO/EDA series, a handful of curated programs, one export table. So:

**Serve the defense-specific series as static JSON** under `data/defense/` (simplest, matches
the `update-budget` per-ministry pattern), NOT a new PG blob table:
- `data/defense/gdp_share.json` — NATO Table 3 series (year, pct, real_change, is_estimate).
- `data/defense/category_split.json` — NATO Table 8a (year, equipment/personnel/infra/ops %).
- `data/defense/programs.json` — curated mega-programs (name, domain, value_eur, ceiling_eur,
  supplier, milestones[], flags[]).
- `data/defense/exports.json` — МИ export report (year, total_eur, to_ukraine_eur, top_dest[]).
- `data/defense/readiness.json` — vacancy %, reserve fill %, personnel/capital split.
- `data/defense/budget.json` — МО programme budget (policy areas 1200.01/1200.02, plan vs actual)
  — sliced by the `update-budget` per-ministry execution path (`mod.bg/doc8`).
- COFOG GF02 + EDA per-capita/%gov-exp fold into the existing `macro`/`macro_peers` artifacts
  (via `update-macro`), reused by the `/indicators/compare` peer radar — no new table.

**The only SQL touchpoints are the (thin) МО contract corpus** — already served + indexed:
- **Per the "always check DB query perf" rule**, `EXPLAIN ANALYZE` the МО filter on the
  worst-case: `contracts WHERE awarder_eik = '000695324' [AND date >= …]`. The
  `contracts(awarder_eik, date)` index already backs `/company/:eik`; confirm it index-scans for
  МО, don't seq-scan the corpus. No new index expected.
- "See all visible МО contracts" reuses the **`contracts` DbDataTable registry** via
  `CompanyContractsDbScreen` (`scope:{col:"awarder_eik", val:MOD_EIK}`) — no new registry entry,
  no new endpoint. The column whitelist is the security boundary; nothing new to whitelist.
- EUR sums use `totalEur = Σ per-row amountEur` (PG basis), never per-currency convert.
- **If** `programs.json`/`exports.json` ever grow into queryable tables (unlikely at this scale),
  promote to a `defense_payloads (kind, key) → jsonb` blob (mirroring `agri_payloads`/
  `fund_payloads`) and apply the payload-determinism rules (ROUND sums, rounded sort keys + eik
  tiebreaks, `COLLATE "C"` MINs, parity audit). Not needed for v1.
- Not needed for defense (single entity): the water plan's proposed `SECTOR_BROWSE_PACKS` seam.
  Revisit only if a "defense sector" (МО + subordinate EIKs — ВГС 129010214, Терем, ВМЗ) view is
  wanted later.

## Part 5 — Watchers & process-watch-report wiring

**Budget ownership — corrected.** The МО budget slice is **NOT** an `update-defense`
responsibility. House precedent (judiciary): `data/budget/vss/budget.json` is written by
`scripts/budget/__write_judiciary.ts`, triggered by the **`budget_law`** watcher, owned by
**`update-budget`**. So: `data/budget/mo/budget.json` ← `scripts/budget/__write_defense.ts`,
riding `budget_law` / `update-budget`'s per-ministry path. `update-defense` owns only the three
defense-specific artifacts below.

Watcher sources (`scripts/watch/sources/*.ts`; `WatchSource` = `{ id, label, url, cadence,
fingerprint(): Promise<Fingerprint /* {value, detail, meta} */>, describe(prev, curr) }`),
imported into `SOURCES` in `scripts/watch/sources/index.ts`. **Single-source the URL from the
ingest module** (as `vss_court_statistics` imports `VSS_STATS_PAGE` from
`scripts/judiciary/sources.ts`) so watcher and parser can't drift:
- `nato_defexp.ts` — cadence `monthly` (annual PDF, check often); fingerprint = hash of the
  latest `def-exp-*-en.pdf` link/date on nato.int.
- `mod_defense_report.ts` — cadence `monthly`; fingerprint = latest "Доклад за състоянието на
  отбраната" link on `mod.bg/doc8` / `mod.bg/doc46`.
- `moe_arms_exports.ts` — cadence `monthly`; fingerprint = latest МИ annual export-control
  report link (via the SIPRI national-reports mirror if МИ is WAF-blocked).
- (Eurostat COFOG GF02 + EDA ride `update-macro`; the МО budget rides `budget_law` — no new source.)

Process-watch-report has **TWO mapping surfaces** — add rows to BOTH in
`.claude/skills/process-watch-report/SKILL.md`:
1. ~L80, keyed by **label**: `| НАТО — разходи за отбрана | update-defense (…) |` etc.
2. ~L425, keyed by **source id**, each with a full inline imperative runbook (incl. `bucket:sync`):

| Watcher source id | Skill |
|---|---|
| `nato_defexp` | `update-defense` (runbook: parse PDF → `data/defense/gdp_share.json` + `category_split.json` → assert latest year → `bucket:sync`) |
| `mod_defense_report` | `update-defense` (→ `readiness.json`) |
| `moe_arms_exports` | `update-defense` (→ `exports.json`) |

Skill: create `.claude/skills/update-defense/SKILL.md` (shape on `update-judiciary`). Required
structure: **frontmatter with `name`, `description`, `allowed-tools: [Read, Bash, Edit, Write]`**;
an "independent artifacts" table (artifact → source → watcher → script); a "when to run" trigger
table; numbered steps (ingest → verify asserts → stamp → commit → `bucket:sync`); a trust-boundary
note; parser gotchas (NATO PDF is vector-chart + tables — read Tables 3/8a, not the charts; МО PDFs
are FlateDecode → `pdftotext -layout`); one-off backfill. One skill may own multiple artifacts with
**independent triggers and per-artifact completeness asserts** (judiciary does exactly this).
Stamps `state/ingest/update-defense.json` via
`npx tsx scripts/stamp-ingest.ts update-defense --summary "…"`.
Curated program milestones (F-16 etc.) stay MANUAL per the one-off-backfill rule; `--backfill` for
historical NATO years, documented in README, never in CI.

## Part 6 — recent_updates / changelog

The defense-specific data is static JSON (Part 4), so there is **no PG `recordIngestBatch`
wiring** for it — that rule applies only to PG-migrated tables. The one changelog surface that
IS relevant: the МО contract corpus already flows through the procurement ingest's changelog, so
new МО contracts already appear in `recent_updates` with no extra work. If `defense_payloads`
is ever introduced (Part 4), wire it via `recordIngestBatch` (`scripts/db/lib/ingest_changelog.ts`)
inside the loader txn with a stable natural key — but that is explicitly deferred.

## Part 7 — AI chat tools

Add a defense tool family mirroring the procurement/awarder tools. Files (per the `ai/` recipe):
create `ai/tools/defense.ts`; edit `ai/tools/registry.ts` (import + `ToolDef` entries in `TOOLS`),
`ai/orchestrator/router.ts` (keyword block), `ai/orchestrator/narrate.ts` (a case per tool).

`ToolDef` shape (`ai/tools/types.ts`): `{ name, domain, description:{bg,en}, params[],
examples[{bg,en}], run }`. Domain enum: `fiscal | elections | local | people | indicators |
place`. **Tools NEVER compute numbers in prose** — the handler populates pre-formatted
`env.facts` (via `fmtEurCompact`/`fmtInt`, `ctx.lang`) and `narrate.ts` only interpolates them.
Data via `fetchDb("<registry-key>", …)` for PG or `fetchData("/defense/*.json")` for static JSON
(`ai/tools/dataClient.ts`). Templates to clone: `awarderProcurement`, `roadsSpending`,
`contractSearch` in `ai/tools/fiscal.ts`.

Tools:
- `defenseSpending` (domain `fiscal`) — %GDP trajectory + 2%/3,5%/5% targets, МО budget,
  equipment vs personnel share, path to 5%. Reads `/defense/gdp_share.json` +
  `/defense/category_split.json` + `/defense/budget.json`.
- `armsExports` (domain `fiscal`) — the export boom by year + top destinations + Ukraine sub-flow;
  facts note the SIPRI-TIV-excludes-ammo caveat. Reads `/defense/exports.json`.
- `defenseProgram` (domain `fiscal`) — one mega-program (F-16 / Stryker / MMPV / ammo JV): value,
  ceiling, delivery status, key flags. Reads `/defense/programs.json`.
- `defensePeerCompare` (domain `indicators`) — BG vs RO/GR/HR/HU on %GDP / per-capita / %gov-exp /
  equipment share. Reuses the existing macro/peers artifacts (no new data).

**The router is NOT a flat alternation regex** (earlier draft was wrong). `router.ts` is ~150 lines
of guarded `has()` cue logic. Budget real effort for it, and copy three judiciary conventions:
1. **Inline `MOD_EIK`** in `router.ts` — the router runs outside the app bundle and *cannot import
   from `src/`* (judiciary inlines `VSS_EIK`/`IVSS_EIK` with a comment saying so).
2. **Substring-collision defenses.** Judiciary guards `"ивсс" ⊃ "всс"`, `"spending" ⊃ "pending"`,
   `"отдела" ⊃ "дела"`, `"showcase" ⊃ "case"`. Our cues have the same trap:
   `"charms"/"harms" ⊃ "arms"`, `"armory" ⊃ "army"`, `"отбраната" vs "избраната"`. Use anchored
   `has()` guards, not a raw alternation.
3. **Priority ordering + a shared `routeDefense()`** so every entry branch resolves identically
   (judiciary: workload > budget > caseload).
4. **Procurement-phrased questions route to the generic tool**, not a domain tool:
   "поръчките на МО" → `awarderProcurement { org: MOD_EIK }` (judiciary does this for ВСС).

`narrate.ts` — most cases are pure interpolation, but `judiciaryDeclarations` carries **real
conditional clauses** to avoid mis-stating a remainder. `armsExports` needs the same: a guarded
clause for the Ukraine sub-flow and the "SIPRI TIV excludes ammunition" caveat, not a flat template.

Provenance strings: `defense/*.json`. **Every `/defense/*.json` path an AI tool reads MUST have an
`AI_PATH_RULES` entry (Part 8) or the prebuild fails.** The budget tool's `/budget/mo/…` path is
already covered by the pre-existing `/^\/budget\//` rule.

## Part 8 — Data Map & README docs

### Data Map (`scripts/data_map/model.ts`) — prebuild fails on an unplaced source
- `SOURCE_GROUPS`: add one `defense` group (`origin: "state"`, `members: ["nato_defexp",
  "mod_defense_report", "moe_arms_exports"]`, `skills: ["update-defense"]`, `tags:
  ["fiscal","indicators"]`, `label/detail/desc/url` → НАТО / МО / МИ).
- `DATASETS`: add `defense` (`path: "data/defense/"`). **No separate dataset for
  `data/budget/mo/`** — that file belongs to the existing `budget` dataset (judiciary precedent).
- `FEATURES`: add a `defense` feature node with `route: "/defense"`.
- `EDGES` — **cross-dataset feature edges were missing from the earlier draft.** The feature
  consumes three datasets: `["src:defense","ds:defense"]`, `["ds:defense","f:defense"]`,
  **`["ds:budget","f:defense"]`** (the budget bridge + `defenseSpending` tool) and
  **`["ds:macro","f:defense"]`** (the `defensePeerCompare` tool reads macro/peers).
- `AI_PATH_RULES`: add `{ pattern: /^\/defense\//, dataset: "defense" }`. `/budget/mo/…` is already
  covered by the existing `/^\/budget\//` rule.
- Verify with `npm run data:map`; the build errors "watcher source(s) not placed on the data map"
  if a source is missing from a group.

### README.md
- "Data sources" (~L472) — add NATO Defence Expenditure, МО доклад + programme-budget execution,
  МИ arms-export report, and the COFOG GF02 / EDA reuse.
- "Data layout" (~L205) — document `data/defense/`.
- Note the `update-defense` CLI flags (`--backfill` for historical NATO years) alongside the
  other `update-*` skills.

### /data pages (the site's own data map)
The generated diagram (`/data`, `/data/sources`, `/data/updates`) picks up the new `defense`
SOURCE_GROUP/DATASET automatically from `model.ts`; no separate hand-edit. Confirm the Отбрана
feature node renders after `npm run data:map`.

## Part 9 — Sitemap, static prerender & OG screenshots

All three pipelines are driven by **one source of truth**: the `INSTITUTION_PACKS` array in
`scripts/prerender/institutions.ts` (currently roads/noi/nzok/dfz; note НЗОК is also enumerated
via `scripts/sitemap/route_defs.ts`). Adding a `data-og`-tagged signature visual to the pack +
one `InstitutionPack` entry wires the awarder page into sitemap, prerendered HTML, and the OG
card automatically.

### a. The pack page `/awarder/000695324`
Add one entry to `INSTITUTION_PACKS`. Shape (`InstitutionPack`):
```ts
{
  eik: "000695324",
  slug: "defence",                 // → public/og/awarder/defence.png
  nameBg: "Министерство на отбраната", nameEn: "Ministry of Defence (МО)",
  titleBg: "…поръчки | …", titleEn: "…procurement | …",
  descriptionBg: "…ЕИК 000695324…", descriptionEn: "…EIK 000695324…",
  bodyBg: "<h1>…</h1><p>… crawlable, links to /procurement …</p>", bodyEn: "…",
  ogAnchor: '[data-og="defense-hero"]', // CSS selector of the signature chart/map
  ogCenter: true,                        // center the 1200×630 clip on the chart
  ogSettleMs: 3000,                      // let Recharts/Leaflet finish rendering
}
```
This one entry gives (per the review):
- **Sitemap** — `scripts/sitemap/index.ts` (~L701) loops `INSTITUTION_PACKS` and pushes
  `/awarder/000695324` + `/en/awarder/000695324` (bucket `static`, lastmod `today`). Every
  `<loc>` must have a real `dist/awarder/000695324/index.html` — the prerender below creates it
  (heed the sitemap-validity rule: no loc without prerendered HTML).
- **Prerender** — `buildInstitutionAwarderRoutes()` (`dynamicRoutes.ts` ~L2841) emits the BG+EN
  route with `ogImage:/og/awarder/defence.png`, WebPage + Breadcrumb JSON-LD; `prerender/index.ts`
  `renderSeoBlock()` injects `<title>`/description/OG tags/hreflang → `dist/awarder/000695324/
  index.html` (+ `/en/`). ~8KB, negligible vs the Firebase file ceiling.
- **OG card** — `scripts/og/capture-screens.ts` (~L337) loops `INSTITUTION_PACKS`, Playwright-
  screenshots `localhost:5173/awarder/000695324` at **1200×630**, waits for `ogAnchor`, scrolls it
  in, settles `ogSettleMs`, hides chrome, clips centered → `public/og/awarder/defence.png`.

**Beautiful screenshot (chart or map) — the deliberate choice:** the pack must render a signature
visual carrying `data-og="defense-hero"`. Best candidates, in order:
1. the **%GDP-to-5% chart** (the most striking, target-line story) rendered as the pack hero, or
2. the **DefenseBudgetBridgeTile** chart, or
3. later, an **arms-flow map/Sankey** (Phase 3) — `ogCenter` shines for maps.
Match the existing anchors' quality bar (roads = Leaflet map 3500ms, nzok = budget-bridge chart
2500ms). Keep app-side constants in sync: `MOD_EIK` in `src/lib/defenseBenchmarks.ts` mirrors the
`INSTITUTION_PACKS` eik, and the tile with `data-og="defense-hero"` lives in `DefensePack`.

Note: ВСС anchors on `[data-og="vss-bridge"]` (the budget-bridge chart), `ogSettleMs: 2500`, and
does **not** set `ogCenter`. Committed PNG; dist serves `.webp`.

### b. The `/defense` screen (Phase 2) — its own SEO surface
The institutions pipeline covers only `/awarder/:eik`. The dedicated `/defense` screen is a
separate route, so it needs its own three-pipeline wiring:
- **Sitemap** — add `/defense` (+ `/en/defense`) to the static-pages list **and** a `RouteDef` in
  `scripts/sitemap/route_defs.ts` (judiciary does both).
- **Prerender** — **`scripts/prerender/routes.ts`, NOT `dynamicRoutes.ts`** (earlier draft was
  wrong; `dynamicRoutes.ts` is only for awarder/institution routes). Add a static `PrerenderRoute`
  (`path:"defense"`, `ogImage:"/og/defense.png"`, bilingual `bodyHtml`, JSON-LD) →
  `dist/defense/index.html` (+ `/en/`).
- **Build-time facts injection** (judiciary does this; earlier draft missed it): `routes.ts` has a
  `judiciaryFacts()` that synchronously reads the data JSON at build time so the crawlable body
  quotes live figures. Add `defenseFacts()` reading `data/defense/gdp_share.json` +
  `exports.json` so the prerendered body says "2,06% от БВП" / "€2,83 млрд износ" — real SEO text.
- **OG card** — add a capture entry to the **non-awarder** list in `capture-screens.ts`:
  `slug:"defense"`, `waitFor:'[data-og="defense-gdp"] .recharts-surface'` (**wait for the Recharts
  surface, not just the container** — judiciary's convention), `anchor:'[data-og="defense-gdp"]'`
  → `public/og/defense.png`.

### c. Build/commit
`npm run build` runs the `postbuild` chain (`og/generate.ts` → `prerender/index.ts`); `npm run
sitemap` is separate. Commit the new `public/og/awarder/defence.png` (+ `public/og/defense.png`)
and `bucket:sync` any data. Verify `dist/awarder/000695324/index.html` exists (else the sitemap
loc is a soft-duplicate of the homepage).

---

## Data sources (obtainable vs classified)

**Machine-readable / obtainable:**
- **NATO Defence Expenditure** PDF (annual, `pdftotext -layout`): %GDP 1,31%(2014)→3,14%
  (2019 spike)→2,06%(2025e); equipment share 8,4%(2020)→32,5%(2024); personnel ~53–55%.
  Hague-2025: 5% by 2035 (3,5%+1,5%); BG national plan approved 2026-06-10.
- **Eurostat COFOG GF02** (`gov_10a_exp`, via `update-macro`): defense-only €914,7M(2020)→
  €1 430,9M(2023). **GOTCHA:** the BG budget function "Отбрана и сигурност" is NOT defense —
  it bundles police+courts+prisons (~12% of spend). Never label the function as defense.
- **EDA Defence Data xlsx** (per-country): 2024 total €2 026,56M, per-capita €314,84,
  5,48% of gov exp. (BG equipment/R&D split stops at 2021 — use NATO for the trend.)
- **МО** — programme-budget execution (`mod.bg/doc8`, quarterly, FlateDecode PDFs; 2024 law
  2 129,19M лв), annual "Доклад за състоянието на отбраната" (readiness), Investment
  Programme to 2032. minfin.bg is WAF-blocked — source from mod.bg / strategy.bg.
- **Ministry of Economy** arms-export report (via SIPRI national-reports): €1,65bn(2022)→
  €2,17bn(2023)→€2,83bn(2024 record); €6,65bn cumulative since 2022; to Ukraine
  €0→€12,6M→€156M. Governance body: Междуведомствен съвет по отбранителна индустрия
  (Decree №120/2012, successor to the 1993 ВПК). SIPRI TIV undercounts (excludes ammo).

**Classified/opaque (flag as a gap, don't fabricate):** FMS contract terms, чл.149
intelligence procurement, itemized Ukraine-aid packages. No official "% of МО spend that
is classified" figure exists.

**Mega-programs (curated from ratification laws + press, NOT in ЦАИС):** F-16 Block 70
(16 jets, ~$2,6bn; first delivered Feb 2025 ~3yr late; batch 2 from 2027; Gripen was cheaper
~€511M vs ~€767M; Radev veto overridden 128–73; grounded on delivery + fuel leak). Stryker
($1,38bn, 183 vehicles, first 5 at Burgas Feb 2026, Terem hub). MMPV Храбри/Смели (~€500M,
2×90m, NVL/Lürssen at МТГ Долфин Варна, sea trials Nov 2025). Rheinmetall–ВМЗ ammo JV (~€1bn,
51/49%, Oct 2025, Sopot, ~100k 155mm shells/yr from 2027–28, ~1000 jobs). T-72 mod
(BGN 78,7M, Terem, 2020–22).

---

## Competitive context (why this wins)

**No structured/interactive Bulgarian defense-spending tracker exists.** The niche is
PDFs, articles, one-off static charts.

- **IME / ИПИ** — written analyses only ("Кой колко харчи за отбрана в Европа");
  regionalprofiles.bg has zero defense indicators. Cite, don't compete.
- **Bird.bg** (`bird.bg/eop`, `/contracts`) — the only structured, searchable BG procurement
  data, but generic (МО is one buyer, no budget angle). Out-structure it with budget→contract→
  NATO integration.
- **Capital.bg** ("отбрана" section), **Mediapool.bg** — journalism/articles, paywalled, no tool.
- **АКФ, CSD, Sofia Security Forum, Rakovski, Atlantic Council BG** — PDF/event output, no data product.
- **International reference layers** (cover the top line only, not competitors): SIPRI, NATO,
  EDA, IISS Military Balance, TI Government Defence Integrity Index (BG entry:
  government.defenceindex.org/countries/bulgaria).

Differentiation = (a) budget → visible МО procurement (we already ingest EIK 000695324 as a
buyer), (b) the parliamentary defence-report figures made queryable, (c) the МИ arms-export
report structured, (d) NATO/EDA peer benchmarking with target-line trends, (e) the honest
transparency-gap framing no PDF publisher offers.

---

## Design references worth stealing (from the competitive scan)

- **Ranked bar + dashed target line** (NATO) — the %GDP verdict; use stepped 2%→3,5%→5% lines.
- **4-way category split with 20% guideline** (NATO/EDA Fig 10 traffic-light).
- **Normalization toggle** total/per-capita/%GDP/%gov-exp with animated reorder (SIPRI/IISS).
- **Field-level redaction with stated rationale** (Prozorro/TI-Ukraine) — the transparency tile model.
- **6-band risk + evidence-on-click + downloadable scorecard** (TI GDI).
- **Dual "Account vs Award" split** (USAspending) — budget-execution vs contracts.
- **Count + modernity badge** inventory rows (IISS); **EU-vs-US facing bars** (EDA Fig 5).
- **Many small focused charts, GDP-normalized** (Kiel Ukraine Support Tracker) — matches the
  house no-tabs, dashboard-tiles convention.
- **Animated choropleth + diverging import/export bars** (SIPRI viz) for the arms-flow tile.

---

## Build checklist (zero-guesswork)

### Phase 1 — DefensePack on `/awarder/000695324`
- [ ] `src/lib/defenseReferenceData.ts` — `MOD_EIK`, `DEFENSE_ALIAS_EIKS` (6 subordinates), CPV→category map, labels, colors, programme codes
- [ ] `src/lib/defenseAttributes.ts` — `defenseClassifier` + `buildDefenseModel` on `buildAwarderModel`/`SectorClassifier` (no bespoke engine)
- [ ] `src/data/budget/types.ts` (EDIT) — `DefenseBudgetFile` + line/year types
- [ ] `src/data/budget/useBudget.tsx` (EDIT) — `useDefenseBudget()` → `/budget/mo/budget.json`
- [ ] `scripts/budget/__write_defense.ts` + `data/budget/mo/budget.json` — owned by **`update-budget`** / `budget_law` watcher (NOT `update-defense`)
- [ ] `src/data/procurement/useDefense.tsx` — `useQueries` + `combine` alias fan-out, `scopeByWindow`, `buildDefenseModel`, `aliasEur` delta
- [ ] `src/screens/components/procurement/defense/DefensePack.tsx` + `DefenseBudgetBridgeTile` (`data-og="defense-hero"`) + `DefenseTransparencyTile` + `DefenseCategoryTile` (bilingual inline, no i18n)
- [ ] `sectorPacks.tsx` — `PACKS[MOD_EIK] = DefensePack` via `lazy()`; **no `DEFENSE_AWARDER_PATH` export**
- [ ] `reportMenus.ts` + `ProcurementNav.tsx` — key **`defense_nav`** → **`/defense`**, `unscoped: true`, icon `Shield`
- [ ] `locales/{bg,en}/translation.json` — `defense_nav` (only nav goes through i18n)
- [ ] Disclose the data-quality caveats in-tile (51% NULL `procurement_method`, 45% bid coverage)
- [ ] "See all visible МО contracts" — reuse `CompanyContractsDbScreen` scoped by `awarder_eik` (no new screen). `EXPLAIN ANALYZE` **done**: `idx_contracts_awarder` bitmap scan, МО 1,3ms / 7-EIK family 13,2ms — no new index
- [ ] **OG (Part 9a):** `INSTITUTION_PACKS` entry (slug `defence`, anchor `[data-og="defense-hero"]`, `ogSettleMs` 2500–3000) → auto-wires sitemap + prerender + `public/og/awarder/defence.png`. Verify `dist/awarder/000695324/index.html` exists.

### Phase 2 — `/defense` screen + full plumbing
- [ ] Route in `src/routes.tsx` (`<LayoutScreen>`), screen in `src/screens/`, homepage shell (no `max-w`, no tabs)
- [ ] Tiles: %GDP hero, equipment/personnel stack, mega-programs board, arms-export, readiness, peer compare
- [ ] `data/defense/{gdp_share,category_split,programs,exports,readiness}.json` + `bucket:sync`
- [ ] COFOG GF02 + EDA per-capita/%gov-exp into `macro`/`macro_peers` via `update-macro`
- [ ] **Watchers (Part 5):** `nato_defexp.ts`, `mod_defense_report.ts`, `moe_arms_exports.ts` → `SOURCES`; map to `update-defense` in `process-watch-report/SKILL.md`
- [ ] **Skill (Part 5):** `.claude/skills/update-defense/SKILL.md`; stamp `state/ingest/update-defense.json` via `stamp-ingest.ts`
- [ ] **AI tools (Part 7):** `ai/tools/defense.ts` (`defenseSpending`, `armsExports`, `defenseProgram`, `defensePeerCompare`) + `registry.ts` + `router.ts` keywords + `narrate.ts` cases
- [ ] **Data map (Part 8):** `defense` SOURCE_GROUP + DATASET + EDGES + `AI_PATH_RULES /^\/defense\//` in `data_map/model.ts`; verify `npm run data:map`
- [ ] **Docs (Part 8):** README data-sources (~L472) + data-layout (~L205) + `update-defense` CLI flags
- [ ] **SQL perf (Part 4):** `EXPLAIN ANALYZE` any new query on worst-case; defense JSON is small so no new tables/indexes expected
- [ ] **`/defense` screen SEO (Part 9b):** `/defense` in `sitemap/route_defs.ts` (static list **+** `RouteDef`); static `PrerenderRoute` in **`scripts/prerender/routes.ts`** → `dist/defense/index.html` (+ `/en/`); `defenseFacts()` build-time JSON read for the crawlable body; OG entry `waitFor:'[data-og="defense-gdp"] .recharts-surface'` → `public/og/defense.png`
- [ ] **AI router (Part 7):** inline `MOD_EIK` in `router.ts` (cannot import from `src/`); guard substring collisions (`arms`⊂`charms`, `army`⊂`armory`); shared `routeDefense()` + priority order; procurement-phrased → `awarderProcurement{org: MOD_EIK}`
- [ ] **AI narrate (Part 7):** `armsExports` needs conditional clauses (Ukraine sub-flow, SIPRI-TIV-excludes-ammo caveat), not a flat template
- [ ] **Skill frontmatter (Part 5):** `allowed-tools: [Read, Bash, Edit, Write]`; artifacts table; per-artifact completeness asserts
- [ ] **process-watch-report (Part 5):** add rows to **both** mapping surfaces (label table ~L80 + source-id runbook table ~L425)

### Phase 3 — differentiators
- [ ] Arms-flow Sankey, GDI risk pillar (reuse `computeProcurementRisk` + evidence-on-click + scorecard image), program lifecycle Gantt + cost-drift, cabinet anchoring

### Conventions to honor
- [ ] Bilingual inline in packs; only nav labels through i18next
- [ ] [[feedback_pg_changelog_required]] only if a `defense_payloads` PG table is ever added (deferred — v1 is static JSON)
- [ ] `bucket:sync` every new `data/defense/` JSON; NATO/МИ/МО backfills behind `--backfill`, never in CI (one-off-backfill rule)
