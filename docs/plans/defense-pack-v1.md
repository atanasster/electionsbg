# Отбрана (МО / Българска армия) view — v1

## Status (2026-07-09, rev 1.6 — shipped-enhancements review + date scoping)

- **Rev 1.6:** Part 11 (adopt shipped pack enhancements) + Part 12 (date/time scoping) added.
  - **`SECTOR_BROWSE_PACKS` is BUILT** — add a `defense:` entry (earlier "unbuilt/deferred" notes were
    stale). The **group-rollup endpoint** (`useVikGroupRollup` → `/api/db/awarder-group-rollup`, 2,7 MB
    → 2,3 KB) **solves the 25-EIK fan-out risk** — Part 4 updated.
  - Reuse shipped tiles, don't invent: **`VikContractorHhiTile`** (+ `hhiBand` helpers, attributed-denom
    guard) and **`VikCompetitionTile`** are the two marquee defense tiles; **`PackSection`** money-first
    bands + **`useHashScroll`** deep-link ids + **`buildPackInsights`** chips.
  - **Signature tile = aviation sustainment** ("keep the Soviet fleet flying", cross-buyer, all-years).
  - **Date scoping:** house vocabulary is strictly `ns | all | y:YYYY` — **no calendar picker exists,
    don't add one**. Two resolvers (half-open `useProcurementWindow` / inclusive `scopeRange`); the pack
    inherits the awarder page's inverted-default (`all`) `?pscope`; contract tiles re-window, annual
    tiles use the NZOK independent-fiscal-year picker + scope-note chip; the `/defense` screen uses the
    culture/education single-year re-aggregation (%GDP trend stays full-history). **Flagged a latent
    off-by-one:** `CompanyDbScreen` feeds inclusive `to=YYYY-12-31` into exclusive `scopeByWindow` →
    Dec-31 contracts dropped from packs on the awarder page.

## Status (2026-07-09, rev 1.5 — UI/UX best practices folded in)

- **Rev 1.5:** Part 10 added — external best-in-class buyer-page research (USAspending, OpenTender/
  DIGIWHIST, Tussell, BI Prozorro/DOZORRO, OpenGov, OCP) cross-referenced against the 5 shipped
  packs, plus the `dataviz` house chart rules. Finding: **most world-best patterns are already
  shipped** (bridge = budget-vs-contracted, `ProcurementBenchmarksTile` = single-bid gauge, many
  small dashboards, tender lineage, faceted see-all) — reuse them. Copy NZOK's bridge (best), VSS's
  conditional KPI grid, the shared benchmark tile (МО's 44,3% single-bid renders RED). Genuine
  deltas: transparency-on-the-KPI, top-5 concentration metric, riskiest-contracts feed, framework
  ceiling-vs-drawdown. Chart rules: single-axis only (killed the dual-axis idea), validate the
  6-universe palette, color-follows-entity so the universe `Select` never repaints.

## Status (2026-07-09, rev 1.4 — audit applied; МО group scoped)

- **Rev 1.4:** subordinate EIKs are **IN**. The group is **25 curated EIKs / 6 889 contracts /
  €2 188,5M** (not the 7 the first sweep found). **ВМА is 46,6% of the group's value** and must be
  segmentable or the category tile becomes a drug chart. Curate by **EIK allowlist, never a name
  regex** — the name sweep false-positived on `7-МО Основно училище` and the town of Раковски, and
  two **МВР** directorates (ДУССД €301M, ДКИС €70M) sit adjacent to the МО units. Perf re-measured:
  25-EIK roll-up = 5,8 ms, still a bitmap index scan.


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
| **МО group** (25 curated EIKs, incl. ВМА + the services) | **6 889 contracts, €2 188,5M** |
| — of which ВМА `129000273` | **€1 020M = 46,6% of value**, 38,6% of contracts |
| Open procedure, share of value (МО proper) | **17,8%** |
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
   open procedure; 44,3% single-bid among covered contracts; 13,2% of value negotiated without
   prior notice. Fed into the shipped `ProcurementBenchmarksTile` (single-bid green ≤10% / **red
   >20%**), МО's 44,3% renders **solidly RED** — reuse the tile unchanged (Part 10a).
3. The transparency tile still names the FMS/чл.149 gap — now framed as
   **sustainment-visible / acquisition-invisible**, which is more precise and more damning.
4. Non-contract data (%GDP path, equipment/personnel mix, mega-programs, exports, readiness)
   still loads via the **НЗОК/ВСС pattern** (budget + curated JSON hooks).

### The МО group: 25 EIKs, 6 889 contracts, €2 188,5M — DECIDED: include them

The earlier draft said "single entity, no multi-EIK roll-up needed." Wrong twice over — first
because subordinates exist, then because the first sweep (name-match on "отбран") found only 7 of
them. A curated sweep of the corpus gives **25 МО budget units, 6 889 contracts, €2 188,5M**.

**The single biggest fact: ВМА (Военномедицинска академия) is 46,6% of the group's value and
38,6% of its contracts — larger than МО proper.** It buys oncology drugs, medicines and nursing
care. If you fold it in unsegmented, "what the МО group buys" reads as *medicines*, and the
sustainment story disappears. This is a design constraint, not a footnote.

**Six universes — label every tile with which one it covers** (the water plan's discipline):

| Universe | Members | Note |
|---|---|---|
| **МО proper** | `000695324` (3 name variants) | 1 212 contracts, €852M — the ministry |
| **Българска армия** (commands & services) | ВВС `129010189`, ВМС `129010196`, Сухопътни войски `129010171`, Съвместно командване на силите `129010207`, СКСО `129010680`, Командване логистична поддръжка `129011031`, Командване киберотбрана `129010221`, Военна полиция `129009023`, Военна информация `129009728`, Национална гвардейска част `129009030`, ЦВО `129011024`, ЦАТИП ВФ 26940 `129010984` | the actual army |
| **Военно здравеопазване** | **ВМА `129000273`** | **€1 020M / 2 656 contracts — 46,6% of value. MUST be segmentable.** |
| **Образование и наука** | Военна академия „Г. С. Раковски“ `129003305`, НВУ „Васил Левски“ `129009094`, ВВМУ „Н. Й. Вапцаров“ `129004492`, ВВВУ „Георги Бенковски“ `129011005`, Институт по отбрана `129010036`, ВГС `129010214` | |
| **Култура и имоти** | ИА „Военни клубове“ `129008829`, НВИМ `129009048`, Театър „Българска армия“ `129009016`, Информационен център МО `129010545`, Комендантство `129010142` | |
| **Изрично ИЗВЪН МО** | ДА „Държавен резерв и военновременни запаси“ `831913661` (€1 139M) · всички структури на **МВР** (ДУССД `129010157` €301M, ДКИС `129010698`, МИ-МВР `129007218`, Гранична полиция, Пожарна безопасност, ОДМВР, ГДБОП…) · ДАНС `129009710` · ДАТО `129010090` | never render as МО |

**Curate by EIK allowlist — NEVER by name regex.** The name sweep produced false positives that
prove the point: `7-МО Основно училище` matched "МО"; the town of **Раковски** (община, ОУ, МБАЛ)
matched the Раковски military academy. And the EIK prefix `1290*` is *not* an МО block — it is the
whole security-services range, mostly МВР. Two МВР directorates (ДУССД €301M, ДКИС €70M) sit right
next to the МО units and would have been a €370M error. Store the allowlist in
`defenseReferenceData.ts` as `DEFENSE_UNITS: { eik, universe, label }[]`, derive
`DEFENSE_ALIAS_EIKS` from it.

**Implementation (ВСС alias pattern):** `useVss` fans out over `[VSS_EIK, ...VSS_ALIAS_EIKS]` with
react-query `useQueries` + `combine` (stable array identity — without it the model rebuilds on every
hover) and footnotes the `aliasEur` delta so the pack reconciles against the per-EIK awarder header
above it. Do the same in `useDefense`. **The delta here is large** (€1 336M of non-МО-proper spend,
> МО itself), so the reconciliation footnote is mandatory, not cosmetic: the awarder header above
the pack shows **МО proper only**; the pack shows **the group**.

**Required UI affordances:**
- A **universe segmentation control** on the category/KPI tiles (Radix `Select`, never native) —
  default "МО група", with "без ВМА" and per-universe options. Without it the category tile is a
  drug-procurement chart.
- `DefenseAwardersTile` (Phase 2) lists all 25 units grouped by universe, each deep-linking to its
  own `/awarder/:eik` page.
- Every tile caption states its universe.

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
- Add a **`DefenseAwardersTile`** mirroring `JudicialAwardersTile` — lists all **25 group units
  grouped by universe**, each deep-linking to its `/awarder/:eik` page (the "back to the money" tile).

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

**The only SQL touchpoints are the МО contract corpus** — already served + indexed. `EXPLAIN
ANALYZE` run on the worst case (2026-07-09), all bitmap **index** scans on `idx_contracts_awarder`,
no seq scan, **no new index needed**:

| Query | Rows | Time |
|---|---|---|
| `awarder_eik = '000695324'` (МО proper) | 1 212 | **1,3 ms** |
| `awarder_eik IN (…7 EIKs)` | 2 614 | **13,2 ms** |
| `awarder_eik IN (…25 EIKs)` (the МО group — worst case) | 6 889 | **5,8 ms** |

Re-run these if the allowlist grows. The pack fetches per-EIK via `useAwarderContracts` (25 parallel
react-query fetches, cached `staleTime: Infinity`), so the group roll-up is client-side — the
25-EIK `IN` above is the *server-side* worst case for the "see all" DbDataTable page.

**RISK — the 25-EIK client fan-out — now SOLVED by a shipped pattern.** 25 parallel
`/api/db/awarder-contracts` calls pulling 6 889 rows (ВМА alone 2 656) would be far heavier than any
pack. The water pack already solved exactly this: **`useVikGroupRollup` → one `/api/db/awarder-group-rollup`
aggregate call (2,7 MB → 2,3 KB)**. Adopt it:
- The pack's **group KPIs, HHI, competition, category** consume a `useDefenseGroupRollup()` — a single
  aggregate endpoint over `DEFENSE_SECTOR_EIKS` (server-side `GROUP BY awarder_eik` + category/supplier
  rollup), not 25 corpus fetches. Add a `defense-group-rollup` serving fn mirroring `awarder-group-rollup`.
- Fetch **МО proper's full corpus eagerly** (the awarder page already loads `useAwarderContracts(MOD_EIK)`
  for the generic tiles); load the group aggregate for the group tiles. Per-EIK drill happens via
  deep-link to each `/awarder/:eik`, not an eager fan-out.
- The 25-EIK `IN` (5,8 ms, bitmap index scan) is the server-side worst case for the group-rollup fn and
  the "see all" DbDataTable page. `EXPLAIN ANALYZE` the group-rollup fn before shipping.
- "See all visible МО contracts" reuses the **`contracts` DbDataTable registry** via
  `CompanyContractsDbScreen` (`scope:{col:"awarder_eik", val:MOD_EIK}`) — no new registry entry,
  no new endpoint. The column whitelist is the security boundary; nothing new to whitelist.
- EUR sums use `totalEur = Σ per-row amountEur` (PG basis), never per-currency convert.
- **If** `programs.json`/`exports.json` ever grow into queryable tables (unlikely at this scale),
  promote to a `defense_payloads (kind, key) → jsonb` blob (mirroring `agri_payloads`/
  `fund_payloads`) and apply the payload-determinism rules (ROUND sums, rounded sort keys + eik
  tiebreaks, `COLLATE "C"` MINs, parity audit). Not needed for v1.
- **`SECTOR_BROWSE_PACKS` is BUILT and live** (water/roads/noi/nzok/agri/judiciary). Add a `defense:`
  entry (Part 11a) → `/procurement/contracts?sector=defense` restricted to `DEFENSE_SECTOR_EIKS`, with a
  `DefenseBrowseSection` enrichment strip. This IS the group "see all". `CompanyContractsDbScreen`
  scoped to МО proper still serves the МО-proper deep-link.

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

## Part 10 — UI/UX best practices & the world-class bar

Two research passes (external best-in-class buyer/contract dashboards; internal harvest of the 5
shipped packs). **Headline: most "world-best" patterns are ALREADY shipped in the packs.** The job
is to reuse them unchanged, copy the best-executed version of each, and add a short list of genuine
deltas. Nothing here is a new framework.

### a. External top-12 → already shipped? (reuse, don't reinvent)

| World-best pattern (source) | Status in the packs | Defense action |
|---|---|---|
| Single-bid % + no-call % as gauges vs a threshold, 0/50/100 red-flag color (OpenTender/DIGIWHIST) | **Shipped** — `ProcurementBenchmarksTile` (zone divs: single-bid green ≤10 / red >20; no-call green ≤5 / red ≥10; coverage line; self-hides <100 known) | **Reuse UNCHANGED**, fed `{total, singleBidder, noCall}`. МО's **44,3% single-bid renders solidly RED** — a real headline, not a footnote |
| Budget-vs-contracted split at the top (USAspending account-vs-award) | **Shipped, and it's the packs' best idea** — the "bridge" hero | Copy the **NZOK bridge** (below) |
| Many small independently-linkable dashboards (BI Prozorro) | **Shipped** — dashboard tiles, no tabs (house convention) | Keep |
| Tender→contract lineage + forecast-vs-actual (OCP) | **Shipped** — `ContractTenderLineage` (УНП join) + `AwarderTendersTile` | Reuse (МО has 230 tenders) |
| Faceted cross-filtered "checkbook" + CSV export (OpenGov) | **Shipped** — DbDataTable "see all" + contracts browser | Reuse via `CompanyContractsDbScreen` |
| Redaction as a measured category; coverage caveat on the KPI (OpenTender/USAspending) | **Partial** — coverage lines on benchmark tiles + provenance footers | **Sharpen**: put "excl. classified acquisition (FMS/чл.149)" *on the KPI*, treat "value not disclosed" as a shown bar |
| Supplier concentration = top-N share of spend (+ HHI), on a top-N spine (Tussell) | **Partial** — `AwarderTopContractorsTile` exists; no explicit share/HHI | **Add** a "топ-5 доставчици = X% от разхода" concentration chip/KPI |
| Supplier entity-resolution into "supplier groups" (Tussell) | **Partial** — buyer side merged by EIK; supplier-side name-variant merge is a known gap ([[project_procurement_namesake_fix]], SIGMA parity) | Adopt where cheap; don't block v1 |
| Risk as a reverse-chron flagged feed + sortable "most-flagged contracts" (DOZORRO/OCP Cardinal) | **Partial** — `computeProcurementRisk`/`RiskSignalsTile`/`RiskBadges` exist | **Phase 3**: a sortable "най-рискови поръчки на МО" feed |
| Award detail = ceiling bar + obligation + mod timeline + funding trace (USAspending) | **Partial** — `ContractDetailScreen` has KvRows + lineage + connected people; no ceiling-vs-drawdown | **Add** ceiling-vs-drawdown for МО **рамкови споразумения** (several МО contracts are 48-month frameworks) — shared-screen enhancement |
| Treemap w/ multiple entry axes + breadcrumb drill (USAspending Explorer) | **Not shipped** — `CompanyPortfolioTreemap` is static; category tiles are horizontal bars | **Stretch.** The universe `Select` (Part 2) is a lightweight "multiple entry axes"; defer the breadcrumb-treemap |
| "single-bid pending" honest state for open tenders (OCP) | **Not shipped** | Cheap micro-UX to add on the tenders tile |

### b. Best-of-each-pack — copy these exact implementations

- **Hero bridge — copy NZOK `nzok/NzokBudgetBridgeTile.tsx` (best-executed).** It layers: year-picker
  pill group, headline €, a **BG-vs-EU context sub-bar** (COFOG GF07 health), the composition bar,
  an **execution-pace curve that falls back to a single gauge** when <2 months of data, then the
  procurement bridge. **Defense bridge:** МО's ЗОП contracts inside the total defense budget
  (function 02), with the **NATO 2%-of-GDP line as the EU-context sub-bar** (direct analogue of
  NZOK's COFOG sub-bar). `data-og="defense-hero"`. Heroes are **pure CSS/Tailwind flex bars — no
  charting lib** (the only Recharts in the whole set is the roads donut).
- **The single most important pattern — the honest bridge.** Budget context + **rounding-floor
  honesty** (`procShare < 0.005 ? "под 0,5%" : "~"+pct`) + **period-matched ratios** (same-year on
  both sides). This is what makes the packs read as trustworthy, not gotcha-hunting. МО's line:
  "ЗОП поръчките на МО са ~X% от бюджета за отбрана; останалото е личен състав, ангажименти към НАТО
  и класифицирано придобиване извън ЗОП." Copy `NzokBudgetBridgeTile:90-98` verbatim.
- **Insight chips.** Import `chipStyles.ts` `WARN_CHIP_COLORS` (the comment **forbids forking a 4th
  amber** — do not). `directShare > 0.05` emits, `warn: > 0.1` (verbatim across all packs).
  `slice(0,5)`. Skip the `other` category in "largest category" recipes. Add an МО domain warn chip
  (e.g. negotiated-w/o-notice share, which is 13,2% by value; warn over a threshold), following the
  roads capture-chip pattern (`contractCount≥3 && singleBidShare≥0.8`).
- **KPI row.** Copy **VSS's conditional grid** — `grid gap-3 ${hasModel && year ? "grid-cols-2" :
  "grid-cols-1"}` so a lone card never leaves an empty half-column. Only **domain-unique** KPIs
  (generic total/contracts/suppliers are in the awarder header above). `formatEurCompact`,
  `tabular-nums`. Use `StatCard`'s `seeMoreTo` for drill-down (corner chevron).
- **Category "what it buys" tile.** Clone `NzokCategoryTile`/`VssCategoryTile` (near-identical):
  **horizontal bars, not donut/treemap**; `max = Math.max(...all rows)` **NOT `rows[0]`** (the
  `other` sink is sorted last but can be largest → bar overflow); single-bid overlay only when
  `bidKnownN ≥ 3`, amber at `≥0.5`; **"Other" disclosure** when `otherShare ≥ 0.1` ("«Друго» е
  предимно договори без CPV"). A donut is legit ONLY for a true 4-way part-of-whole (roads
  build-vs-repair), never for a ranked list.
- **Benchmark tile.** Reuse `ProcurementBenchmarksTile` unchanged. Add one axis-band tile modeled on
  `NoiAdminBenchmarkTile` (a dot on an axis inside a reference band) for the NATO/EU defense-%-of-GDP
  comparison — BG's dot inside the EU range, with the 2% line.
- **Maps (optional, lower priority — defense has no network).** If a "where МО buys" tile is wanted,
  use the **small-multiples choropleth** (`ProcurementChoroplethTile`: 3 maps side-by-side, one per
  metric, **percentile color** so Sofia doesn't wash out the ramp, click-to-filter
  `onSelectOblast`), keyed by supplier/awarder seat. The custom-SVG `RoadNetworkMap` doesn't apply
  (no road network).
- **Micro-UX — copy verbatim:** loading skeleton `my-4 h-[280px] animate-pulse rounded-xl border
  bg-card`; **per-tile gating so the bridge survives a zero-contract scope** (NZOK/VSS `hasModel`
  pattern); `text-[11px] text-muted-foreground/80` provenance footers; `useTooltip()` rendered as a
  **sibling** of the map; a `dark:` variant on every conditional color; `lib/currency.ts`
  (`formatEurCompact`/`formatEur`/`formatPct`/`formatInt`, `BGN_PER_EUR=1.95583`, **never footnote
  leva post-2026**); mobile `grid-cols-2 lg:grid-cols-3`, `flex-wrap` legends; `data-og`;
  `role="group"`+`aria-pressed` on toggles, `role="img"`+`aria-label` on maps.

### c. Genuine deltas to adopt for defense (ranked)

1. **Sharpen the transparency framing** (external #11): "excl. classified acquisition (FMS/чл.149)"
   goes **on the KPI**, and "стойност не е обявена" is a **shown bar**, not an omission. This is the
   defining defense caveat — surface it, don't footnote it.
2. **Concentration** (external #6) — **now shipped, reuse it**: `VikContractorHhiTile` + shared
   `hhiBand` helpers (HHI + CR-4 + top suppliers). See Part 11b. Do NOT hand-roll a chip.
3. **Competition heatmap** — **now shipped, reuse it**: `VikCompetitionTile` (per-buyer single-bid
   share). The marquee defense tile. See Part 11b.
4. **Riskiest-contracts feed** (external #7, Phase 3): sortable "най-рискови поръчки" via
   `computeProcurementRisk`, each row = flag + contract + why + click-through to `/contract/:key`.
   Flags labeled by scope (process/buyer/supplier), per OCP.
4. **Framework ceiling-vs-drawdown** (external #5): several МО contracts are 48-month рамкови
   споразумения — show contracted-ceiling vs drawn, like USAspending's IDIQ bar. Shared
   `ContractDetailScreen` enhancement.
5. **"single-bid pending" honest state** (external #12) on open МО tenders — don't false-green a
   tender that hasn't closed.

### d. House chart conventions (the `dataviz` skill — non-negotiable)

- **One axis only.** **Kill the earlier "dual-axis per-soldier + per-citizen" idea** from the EDA
  research (it violates the rule) — use two small charts or index to a common base.
- **Categorical hues fixed order, never cycled; a 9th series folds into "Other."** The 6 defense
  **universes** = 6 categorical series → **run `scripts/validate_palette.js` on the universe
  palette** (light + dark) before shipping; CVD ≥ 12.
- **Color follows the entity, never its rank.** When the **universe `Select`** filters "без ВМА" or
  the single-bid toggle changes the series count, **surviving series keep their colors** — do not
  repaint. (The packs' fixed `Record<id,color>` maps already do this; keep it.)
- **Sequential = one hue light→dark** (the choropleth percentile ramp; single-source via
  `procurementPalette.ts`). **Status colors reserved** (good/warn/serious/crit), always with a
  **label, never color alone** — the single-bid amber must carry text.
- Legend present for ≥2 series (none for 1); direct-label ≤4; hover layer by default; a table view
  exists (the "see all" DbDataTable satisfies this).

## Part 11 — Adopt from the shipped pack enhancements (post-plan work)

Since rev 1.0 the packs shipped major upgrades. Review harvested the best applicable ones. **Most of
Part 10's "deltas to add" are now shipped primitives to REUSE, not invent.**

### a. `SECTOR_BROWSE_PACKS` is BUILT — earlier "unbuilt/deferred" notes are STALE
`sectorPacks.tsx` now ships live `SECTOR_BROWSE_PACKS` entries for water/roads/noi/nzok/agri/judiciary,
consumed by `SectorBrowseSlot.tsx` + the browse hosts (`ContractsBrowserDbScreen`,
`TendersBrowserDbScreen` call `getSectorBrowsePack(?sector)`, restrict the table to the pack's EIK-set,
mount the slot). The DB prereq is done (`contracts.awarder_eik` / `tenders.buyer_eik` flipped
`eq`→`in` in `functions/db_table.js`). **Defense adds:**
```ts
defense: { id:"defense", label:{bg:"Отбрана (МО)",en:"Defense (МО)"},
           eiks: DEFENSE_SECTOR_EIKS, Section: DefenseBrowseSection }
```
→ `/procurement/contracts?sector=defense` for free, restricted to all 25 МО EIKs, with an enrichment
strip. `DefenseBrowseSection` mirrors `VikBrowseSection` — **one group-rollup aggregate call, not a
25-EIK corpus fan-out** (Part 4).

### b. Reuse these shipped tiles (the two marquee defense tiles)
- **HHI / concentration — reuse `vik/VikContractorHhiTile.tsx` + the shared `hhiBand` /
  `HHI_BAND_COLOR` / `hhiBandLabel` helpers in `src/lib/textbookPublishers.ts`.** DOJ/FTC bands
  (<1500 competitive / ≤2500 moderate / >2500 concentrated), CR-4 + top-8 supplier bars. **Copy the
  attributed-denominator guard exactly** — HHI denom = Σ over suppliers *with* a contractor EIK, NOT
  the awarder headline total; defense has heavy sole-source/classified awards with patchy contractor
  coverage, so using the headline total would mislabel a concentrated market as competitive. Guards:
  `null` if <3 suppliers. This supersedes Part 10c#2 (don't hand-roll a concentration chip).
- **Competition heatmap — reuse `vik/VikCompetitionTile.tsx` ("Къде се къса конкуренцията").** Per-buyer
  single-bid share: bar **length** = € contracted, **color** = single-bid share (green <35% / amber
  35–60% / red ≥60%), sorted desc, top 12. **Keep the `bidKnownN ≥ 3` floor** so a thin denominator
  doesn't paint a noisy red. **This is the marquee defense tile** — МО's 44,3% single-bid across 25
  buyers, "which formations award without competition." Needs `singleBidShare` + `bidKnownN` per buyer
  in the defense rollup (mirror `VikOperatorAgg`). Frame as signpost (much defense single-bid is
  legitimately sole-source/classified).

### c. Pack skeleton upgrades
- **Money-first banded layout via `PackSection.tsx`** — order bands biggest-flow-first, procurement
  (the scrutinised slice) last: МО budget/capital → suppliers & concentration (HHI) → competition →
  category → contracts detail → transparency. Use `hideTitle` on lead tiles to kill the
  band-title↔tile-title echo; pair compact tiles 2-up (`grid gap-4 lg:grid-cols-2 [&>*]:min-w-0`).
- **Hash-scroll deep-links — `src/ux/useHashScroll.ts`.** Give every band a stable `id` on `PackSection`
  (`mo-budget`, `mo-suppliers`, `mo-competition`, `mo-hhi`, `mo-category`, `mo-transparency`) — it adds
  `scroll-mt-24` so the sticky header doesn't overlap. Call `useHashScroll([...payloads])` in the pack
  **keyed on the async payloads** (bands mount as data settles; the deps re-fire the scroll after
  layout shifts). Confirm the host `CompanyDbScreen` hook covers it. Enables `/awarder/000695324#mo-competition`
  deep-links from AI chat + articles. (This replaces the plain `data-og`-only anchor note — the OG
  anchor `data-og="defense-hero"` still lives on the hero for the screenshot.)
- **`buildPackInsights` shared helper — `src/lib/packInsights.ts`.** Every pack now uses it for the
  headline chips (peak year, top category **by €** — it fixed the top-category-by-declared-order bug —
  direct-award % with `>10%` warn). **Use it directly**, feed the `AwarderModel`; the direct-award warn
  is apt for defense. Supersedes hand-rolling the chip `useMemo`.
- **Reference data — clone `src/lib/vikReferenceData.ts` into `defenseReferenceData.ts`**: `MO_ENTITIES[]`
  (eik, name, universe, type) + derived `DEFENSE_SECTOR_EIKS = MO_ENTITIES.map(e=>e.eik)` + `MOD_EIK` +
  `entityByEik`. Same table drives the pack alias fan-out, the browse-pack `eiks`, and the screen's
  awarders tile. (Aligns with Part-2 `DEFENSE_UNITS`; unify into one `MO_ENTITIES` table.)

### d. The signature feature (flood-tile analogue)
Every mature view has one cross-cutting signature tile (`WaterFloodTile` = flood-maintenance spend,
all-buyers, all-years, spend-not-verdict, "(all years)" label). **Defense's signature = aviation
sustainment** — the thesis made concrete. A CPV/subject-matched cross-buyer aggregate of the "keep the
Soviet-era fleet flying" spend (C-27J logistic support, MiG-29 RD-33 engines, L-39ZA overhaul, Mi-24
airworthiness, Jet A-1, helicopter maintenance) across all 25 МО buyers, all years, framed as spend not
verdict, "(all years)" scope-independent. Build it like `WaterFloodTile` + a
`data/defense/aviation_sustainment.json`-style aggregate (or derive client-side from the corpus).
Secondary candidate: ammunition/modernisation. This is the defense marquee narrative tile.

### e. Also adopt / defer
- **Thematic-analyses strip is NOT free** — add a defense entry to the hardcoded `thematicItems` in
  `ProcurementThematicNav.tsx` (icon `Shield`, route `/defense`, i18n key, `unscoped: true`), modeled on
  `/water`. The strip auto-renders on the МО awarder page once the pack registers; the *pill* needs this.
- **Report-card + decile-fan (`NzokReportCardTile` / `nzokMeasures.ts`)** — skip the machinery (МО buyers
  lack a panel of comparable ratios over time), but **adopt the framing**: positional & polarity-aware
  ("над/около/под медианата"), a p40/p60 "around" tolerance band, "signpost, not a verdict" language.
- **`/molecule/:inn` drill pattern** (route + screen + serving-fn) → Phase 3 `/defense/programme/:id` or
  per-supplier drill-down template.

## Part 12 — Date / time scoping

**There is NO calendar from–to picker anywhere in the procurement UI, and defense must not add one.**
The house vocabulary is strictly `ProcurementScope = "ns" | "all" | "y:YYYY"` (`useProcurementScope.ts`);
the `CalendarRange` icon in the control is decorative. Every `{from,to}` window is *derived* from one of
those three enum values. Reuse the machinery; do not invent a date control.

**Why scoping matters here (measured):** the МО group spans **2011–2026** with a clear post-2021 surge
(€53M in 2011 → €344M in 2022 → €245M in 2025). `y:2022` isolates the Ukraine-era peak; `ns` isolates a
parliament. Scoping is genuinely useful, not decorative.

**Two window resolvers with DIFFERENT bounds — know which the host feeds:**
- `useProcurementWindow()` → **half-open** `[from, to)`; `y:YYYY` → `to = (YYYY+1)-01-01`. Section pages.
- `scopeRange(scope, selected)` → **inclusive** `[from, to]`; `y:YYYY` → `to = "YYYY-12-31"`. DB endpoints
  **and `CompanyDbScreen`** (the awarder page the pack mounts on).
- `scopeByWindow(rows, from, to)` filters `date >= from && date < to` (**half-open, exclusive `to`**,
  string compare on the text `date`).

**⚠️ Latent bug to verify/fix (affects the defense pack, and every pack on the awarder page):**
`CompanyDbScreen` feeds the **inclusive** `scopeRange` `to = "YYYY-12-31"` straight into
`scopeByWindow`'s **exclusive** `< to`, so with a `y:YYYY` scope on an awarder page **contracts dated
exactly `YYYY-12-31` are silently dropped** from packs (they are NOT dropped on section pages, which use
the half-open resolver). МО has December-dated contracts. Recommend the defense pack (or better,
`CompanyDbScreen`) normalize `y:` to the half-open `(YYYY+1)-01-01` before `scopeByWindow`. Flag in the
build; don't ship the off-by-one.

**How each surface scopes:**
1. **The pack (`/awarder/000695324`)** inherits the awarder page's inline `?pscope` control — note its
   **inverted default is `all`** (headline totals read best all-time; `ns`/`y:` are written, `all`
   omitted). The `scopeWindow` flows in via `scopeRange`. **Contract-derived tiles re-window**
   (HHI, competition, category, top contracts). **Annual/reference tiles do NOT honour the pill** —
   the МО budget, NATO %GDP, and exports are annual snapshots on their own cadence. Follow the **NZOK
   precedent**: an **independent fiscal-year picker** for the budget (a local `Select` over
   `budget.years`, default latest), and when the scope pill IS narrowed show the **"latest data ·
   independent of scope" chip** (only when `scopeWindow.from || scopeWindow.to`). The aviation-sustainment
   signature tile is "(all years)", scope-independent.
2. **The `/defense` screen** maps local state onto the same vocabulary (judiciary/culture pattern):
   render `ProcurementScopeControl` with `nsLabelOverride` + a real `years={…}` list. The **%GDP trend is
   a historical time-spine — always full-history, never scoped** (exactly like culture's `byYear` spine).
   The KPIs / equipment-personnel / exports / mega-programs **re-anchor to the selected year** by
   client-side single-year re-aggregation — the **culture `scopeCultureOverview` / education
   `market.yearly[activeYear]` pattern** (derive the year from the window; distinguish an exact "Години"
   pick from a parliament window collapsed to its year → "≈ calendar YYYY" chip; a multi-year window →
   stay on full corpus + a chip). No `{from,to}` row-filtering needed for annual series.
3. **The "see all" browse** (`?sector=defense`) maps the scope to the DbDataTable date filter
   `{ id:"date", min: from, max: to }` (from `useProcurementWindow`), merged with the sector EIK-set and
   method/CPV/single-bid facets. "All years" drops the date filter.

**Note the "latest year ≤ to" annual-clip helper is NOT built** (the water plan's promise is aspirational;
only `euCompare/useElectionYear.ts` does `series.year <= targetYear`). If defense wants a scope-clipped
annual series later, port that helper — but v1 uses the NZOK independent-picker + culture-reaggregation
patterns above, which ARE shipped.

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
- [ ] `src/lib/defenseReferenceData.ts` — `MOD_EIK`, **`DEFENSE_UNITS: {eik, universe, label}[]` (the 25-EIK curated allowlist, NEVER a name regex)**, `DEFENSE_ALIAS_EIKS` derived from it, the 6 universes, CPV→category map, labels, colors, programme codes
- [ ] `src/lib/defenseAttributes.ts` — `defenseClassifier` + `buildDefenseModel` on `buildAwarderModel`/`SectorClassifier` (no bespoke engine)
- [ ] **Universe segmentation** — Radix `Select` on the KPI/category tiles: default "МО група", plus "без ВМА" and per-universe. Without it the category tile is a drug-procurement chart (ВМА = 46,6% of value)
- [ ] **Reconciliation footnote** — awarder header above shows МО proper (€852M); pack shows the group (€2 188,5M). Surface `aliasEur` (€1 336M) explicitly
- [ ] **Measure the 25-EIK fan-out** before shipping eager fetches (Part 4 risk); МО-proper-eager / group-on-demand is the default
- [ ] `src/data/budget/types.ts` (EDIT) — `DefenseBudgetFile` + line/year types
- [ ] `src/data/budget/useBudget.tsx` (EDIT) — `useDefenseBudget()` → `/budget/mo/budget.json`
- [ ] `scripts/budget/__write_defense.ts` + `data/budget/mo/budget.json` — owned by **`update-budget`** / `budget_law` watcher (NOT `update-defense`)
- [ ] `src/data/procurement/useDefense.tsx` — `useQueries` + `combine` alias fan-out, `scopeByWindow`, `buildDefenseModel`, `aliasEur` delta
- [ ] `defenseReferenceData.ts` — unify `MO_ENTITIES[]` (Part 11c) = `DEFENSE_UNITS`; export `DEFENSE_SECTOR_EIKS`, `MOD_EIK`, `entityByEik`
- [ ] `useDefenseGroupRollup()` + `defense-group-rollup` serving fn (one aggregate call, NOT a 25-EIK fan-out — Part 4); `EXPLAIN ANALYZE` it
- [ ] `DefensePack.tsx` on **`PackSection` bands, money-first**, each with an `id`; call **`useHashScroll([...payloads])`**; **`buildPackInsights`** for chips (`chipStyles`, no forked amber); VSS conditional grid; loading skeleton verbatim; per-tile gating; provenance footer
- [ ] `DefenseBudgetBridgeTile` (`data-og="defense-hero"`) — clone `NzokBudgetBridgeTile`; NATO 2%-of-GDP sub-bar; **rounding-floor honesty** (`<0.5% → "под 0,5%"`); period-matched ratio
- [ ] **Reuse `VikContractorHhiTile`** (+ shared `hhiBand`/`HHI_BAND_COLOR`) — keep the **attributed-denominator guard**; and **`VikCompetitionTile`** (per-buyer single-bid, `bidKnownN≥3` floor) — the marquee tiles (Part 11b)
- [ ] `DefenseCategoryTile` — clone `NzokCategoryTile`; `max = Math.max(...all)` not `rows[0]`; single-bid overlay (amber ≥0.5, `bidKnownN≥3`); "Other" disclosure ≥10%
- [ ] `DefenseTransparencyTile` — sustainment-visible / acquisition-invisible; "excl. classified acquisition" **on the KPI**; "стойност не е обявена" as a **shown bar**
- [ ] **Reuse `ProcurementBenchmarksTile` unchanged** — МО's 44,3% single-bid renders RED
- [ ] **Signature tile: aviation sustainment** (Part 11d) — cross-buyer "keep the fleet flying" aggregate, all-years, spend-not-verdict
- [ ] `SECTOR_BROWSE_PACKS['defense']` + `DefenseBrowseSection` (group-rollup backed) — Part 11a
- [ ] Defense pill in `ProcurementThematicNav.tsx thematicItems` (Shield, `/defense`, `unscoped`)
- [ ] **Date scoping (Part 12):** contract tiles re-window via `scopeWindow`; budget = independent fiscal-year picker + "latest data · independent of scope" chip when scope narrowed; **verify/fix the inclusive-vs-exclusive `y:YYYY` off-by-one** (Dec-31 drop)
- [ ] Universe palette (≤6 series) — **run `scripts/validate_palette.js` light+dark**; fixed `Record<id,color>` so the universe `Select` never repaints survivors
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
- [ ] **Riskiest-contracts feed** (Part 10c#3) — sortable "най-рискови поръчки на МО" via `computeProcurementRisk`, each row = flag (scoped process/buyer/supplier) + contract + why + click-through to `/contract/:key`
- [ ] Framework **ceiling-vs-drawdown** on 48-month рамкови споразумения (Part 10c#4) — shared `ContractDetailScreen` enhancement
- [ ] Arms-flow Sankey, GDI risk pillar (evidence-on-click + scorecard image), program lifecycle Gantt + cost-drift, cabinet anchoring
- [ ] "single-bid pending" honest state on open МО tenders (Part 10c#5)

### Conventions to honor
- [ ] Bilingual inline in packs; only nav labels through i18next
- [ ] [[feedback_pg_changelog_required]] only if a `defense_payloads` PG table is ever added (deferred — v1 is static JSON)
- [ ] `bucket:sync` every new `data/defense/` JSON; NATO/МИ/МО backfills behind `--backfill`, never in CI (one-off-backfill rule)
