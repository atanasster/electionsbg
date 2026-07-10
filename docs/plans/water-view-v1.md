# Води (Water sector) view — implementation plan v1

Status: DRAFT (2026-07-08), **pre-implementation audit 2026-07-10 — see §0**. Owner: TBD.

## 0. Pre-implementation audit (2026-07-10) — corrections that SUPERSEDE the text below

Audited against the codebase and the **judiciary/ВСС pack** (`docs/plans/judiciary-vss-v1.md`,
built through Phase 3a on 2026-07-10) — a newer precedent than the roads/НОИ/НЗОК packs this
plan was written against. Where §0 conflicts with a later section, §0 wins.

### 0a. BLOCKERS — resolve before writing code
1. **`awarder_eik` cannot take an `IN` filter today.** `functions/db_table.js` `REGISTRY.contracts`
   declares `awarder_eik: { type: "text", filter: "eq" }` (single value); `scopeCols` is also
   single-value. The SQL builder *does* expand arrays, but only for columns flagged
   `filter: "in"` (as `tag`, `procurement_method`, `category` are). **Fix: flip `awarder_eik` to
   `filter: "in"`** in `functions/db_table.js`. No SQL-builder change. §4.3's "likely already —
   verify" was wrong. Indexes are fine: `idx_contracts_awarder` and `idx_contracts_awarder_date`
   both exist (`scripts/db/schema/pg/001_procurement.sql`).
2. **Entity EIKs unresolved.** Need, from TR/vikholding.bg: the canonical **26-subsidiary EIK
   list**, the **Напоителни системи EIK** (+ any клон/branch EIKs — they may award separately),
   and the **Софийска вода EIK** (concession, must be labelled "извън холдинга").
3. **КЕВР operator name→EIK crosswalk is missing from the plan.** КЕВР publishes operator
   *names*, not EIKs; every join (procurement, ИСУН, TR financials, choropleth) keys on EIK.
   Follow the **`src/lib/vssReferenceData.ts` hand-curated TS-constant pattern** (58 EIKs +
   alias merges + audit note) rather than NZOK's generated `hospital_eik.json` — 42 operators is
   small and the alias/multi-body concerns are identical. Home: `src/lib/vikReferenceData.ts`.

### 0b. ARCHITECTURAL CORRECTIONS (from the judiciary precedent)
4. **`/water` is the PRIMARY surface; the awarder pack is secondary.** The three older packs are
   procurement-centric (everything hangs off `useAwarderContracts`). Water's core story — loss %,
   tariffs, rationing, reservoirs — is *not* procurement-centric, exactly the argument
   judiciary §4.2 makes for its dedicated screen. So: **Phase 1 = `VikPack` on
   `/awarder/206086428`** (the money half); **Phase 2 = a `WaterScreen.tsx` at `/water`** (the
   half money can't tell), built from the same primitives (Card, StatCard, insight chips,
   `OblastChoropleth`, DbDataTable), homepage shell, no tabs. Add a reverse-bridge tile listing
   the 26 subsidiaries → their `/awarder/<eik>` pages (judiciary's `JudicialAwardersTile`).
   **Point both nav surfaces at `/water`**, and do not export `VIK_AWARDER_PATH` (mirrors the
   deliberate `VSS_AWARDER_PATH` omission in the built code). This supersedes §4.2 and the
   orphan `water` route-def in §4.4.
5. **DROP `water_payloads`. Serve domain data as committed static JSON.** Measured in the
   judiciary plan §0.3 via `EXPLAIN ANALYZE`: awarder-contracts = **5.0 ms**; the **58-EIK**
   sector roll-up = **15.8 ms** on `idx_contracts_awarder`. Water's 26-EIK roll-up is smaller —
   both far under the 200 ms precompute threshold. So no blob table, no migration `048_`, no
   jsonb determinism/parity work, no `water-payload` route. **КЕВР benchmarking, tariffs, NSI
   water stats and reservoir series become `data/water/*.json`** (small annual/oblast artifacts,
   fetched with React Query `staleTime: Infinity`), exactly like `data/judiciary/*.json`.
   Postgres is used only for the shared generic contract corpus (`/api/db/awarder-contracts`).
   This also resolves the §5-vs-§4.1b contradiction (precomputed blobs cannot vary by an
   arbitrary scope window; the pack computes its model client-side from the corpus, like every
   existing pack). Supersedes §5's "Tables (new)" and the `water_payloads` design.
6. **AI tools use `fetchData("/water/*.json")`, not `fetchDb`** — all four judiciary tools do.
   The `AI_PATH_RULES` entry `{ pattern: /^\/water\//, dataset: "water" }` is **mandatory, not
   conditional**: `scripts/db/tests/manifest.data.test.ts` fails the build when an `ai/` data
   path has no rule. Supersedes §6/§9's "if any tool reads JSON".
7. **Data map:** tag is **`fiscal`** (not `indicators`) — the VIEWS tags are `null|elections|
   parliament|fiscal|local|indicators|prices`. There is **no awarder-page feature node** to
   reuse, so add a new `FeatureDef` id `water` (`route: "/water"`, `tags:["fiscal"]`, mirror
   `agri`), a VIEW `water`, a DATASET `water` with **`path: "data/water/"`**, and EDGES shaped
   like `src:vss→ds:judiciary→f:judiciary`. Supersedes §9's `tags:["indicators"]` and
   `f:<feature>` placeholder.
8. **`SECTOR_BROWSE_PACKS` + `OblastChoropleth` are SHARED, co-owned prerequisites.** The
   judiciary plan (§4.3) states both are "designed in the water plan but not yet built —
   whoever ships first builds it," and `src/lib/vssReferenceData.ts` already names
   `SECTOR_BROWSE_PACKS` as a blocked dependency. Water ships first ⇒ **water builds them**, and
   must include the **`judiciary` entry (58 EIKs, `JUDICIAL_EIKS`)**. That makes **six** sectors,
   not five: `water`, `roads`, `noi`, `nzok`, `agri`, `judiciary`. Coordinate; do not duplicate.

### 0c. INTERNAL CONTRADICTIONS in this doc (fixed inline below)
9. **Currency.** §4.1a/§6/§10 said "лв/м³". Repo rule: store & display **EUR**, converted at
   ingest at the locked peg. Use `toEur(v,"BGN")` / `BGN_PER_EUR = 1.95583` from
   `src/lib/currency.ts`. Everything is **€/m³**.
10. **MVP OG anchor is impossible.** §4.4 anchors the awarder OG on `[data-og="water-loss-map"]`
    (the загуби choropleth), but the choropleth is Tier B and absent from the §10 MVP — the
    capture would fail on a missing selector. **MVP OG must anchor a Tier-A visual** (the
    subsidiary-tree or EU-funds chart); re-anchor to the map in Fast-follow 1.
11. **`/water/operators` in MVP has no КЕВР data.** §4.1c promises "42 operators (loss/tariff/
    financials)" but Tier A has no loss/tariff. MVP columns = name · oblast · in-holding ·
    procurement € · revenue/PL (TR). Loss/tariff columns land in Fast-follow 1.
12. **АППК SOE report** (§3 Tier B) is consumed by no tile — TR financials already cover group
    P/L. **Drop it** from Tier B (keep as a future all-SOE view note).
13. **Напоителни hero has no dataset.** "88 undocumented reservoirs / 37.8M debt" are Сметна
    палата *narrative* audit findings, not an ingest. Either hand-curate as cited constants in
    `vikReferenceData.ts`, or make the hero **debt-vs-revenue from TR financials** (preferred).
14. Section order is 4.1 → 4.3 → 4.4 → 4.2. Renumber when editing.

### 0d. SMALLER GAPS
15. **`/data/updates` label** is an i18n key, not a code registry: add
    `data_changes_skill_update-water` to `src/locales/{bg,en}/translation.json`; the page reads
    `t(\`data_changes_skill_${entry.skill}\`)`. Writer: `scripts/append-data-change.ts`.
16. **Tests.** `npm run test:data` runs `scripts/db/tests/*.data.test.ts` (node:test). A new
    ingest ships with tests — either there, or a per-pack `scripts/water/*.test.ts` (the
    `test:nzok` precedent). `manifest.data.test.ts` is the AI-path build gate (see §0b.6).
17. **i18n convention:** exactly **one** nav key (`procurement_water_nav`) + inline
    `bg ? "…" : "…"` ternaries for all tile/AI copy. Judiciary uses one key total.
18. **`?sector=` is a new URL param** — document it in the CLAUDE.md "URL contract" section
    alongside `?pscope`, `?q`, `?cabinet`, `?peers`.
19. **operator→oblast is not 1:1** (Софийска вода = Sofia city vs ВиК София-област; some
    operators span oblasts). Define a primary-oblast rule + a caveat caption on the choropleth.
20. **Reservoir series vs scope:** parliament windows predate the МОСВ ingest start. Clip, and
    fall back to the latest available day rather than rendering empty.
21. **Build gates:** `npm run build` (tsc) + `npx eslint . --fix` before done.
22. **Namespace is clear** — no existing `/water` route, no `vik`/`кевр` code, no `water_*`
    table. Next free migration is `048_` (unneeded if §0b.5 holds).

## 1. Goal & thesis

Add a "Води" government-entity view covering Bulgaria's public water sector, mirroring the
existing АПИ (roads) / НОИ / НЗОК sector packs. The reader-facing thesis — the one no
existing site tells — is the **dissonance**: Bulgaria has among the highest rainfall-to-
consumption ratios in the EU, yet loses ~60% of treated water and put 150k–260k people on
rationing (воден режим) in summer 2025. We are the honest, per-oblast, per-euro front-end
to data that today lives only in КЕВР PDFs, МОСВ bulletins, NSI tables, and procurement —
and we are the only place that *joins* them.

Home surface: a **Води sector pack** on `/awarder/206086428` (Български ВиК холдинг) plus a
second pack for Напоителни системи, and a "Води" entry under **Държавни структури** in the
управление menu (next to Пътища/АПИ, Осигуряване/НОИ, Здравна каса/НЗОК).

## 2. Entities & the three "water universes"

This is the single most important scoping decision. Do NOT conflate these; label every tile
with which universe it covers.

| Universe | Members | Note |
|---|---|---|
| **State holding** | Български ВиК холдинг ЕАД (**ЕИК 206086428**) + **26 subsidiaries** (some 100% state, some 51% controlling) | Principal = МРРБ. Parent has ~61 staff; the spend is in the 26 subs. |
| **Regulated sector** | **~42 КЕВР-regulated operators** | Superset of the holding — includes municipal + private operators. КЕВР benchmarking/tariffs cover ALL of these. |
| **Concession (outside holding)** | Софийска вода АД (Veolia, concession to 2034), Веолия Енерджи Варна | NOT in the holding. Must be labelled "извън холдинга" wherever the sector view shows it. |
| **Irrigation** | Напоителни системи ЕАД (EIK **TBD — confirm from TR**) | Principal = МЗХ. Chronic insolvency; separate pack. |

Action items before build:
- Resolve the canonical **26-subsidiary EIK list** (source: vikholding.bg list, or the TR
  children of 206086428 via the connections graph). Store in `src/lib/vikReferenceData.ts`.
- Confirm the **Напоителни системи EIK**.
- Consolidated-group rule: procurement/financials tiles must **aggregate across all 26 sub
  EIKs**, not just the parent (same "union entity vs split-share" issue as the SIGMA audit).
  Each sub is already an awarder EIK, so tiles deep-link to their existing generic pages.

## 3. Data source inventory (tiered by ingest cost)

Three of the strongest sources are **already in our data** — the Tier-A MVP renders before any
new ingest.

### Tier A — already ingested, zero new pipeline
- **Procurement** across the 26 subsidiaries + Напоителни (`contracts` / `tenders`, keyed by
  awarder EIK). Consolidated group roll-up.
- **EU funds (ИСУН / ОПОС „Води")** — ВиК operators are named beneficiaries (Варна, Пловдив,
  Добрич, Сливен, Смолян, Стара Загора…; ~808M lev, 2021–27). We already ingest ИСУН →
  `fund_*` tables. Join by beneficiary EIK. This is the investment half of the hero.
- **TR financials + ownership** — per-operator revenue / profit-loss (e.g. ВиК-Пловдив −14M
  lev, 2023), holding→26 ownership tree, board & remuneration. From TR + connections graph.

### Tier B — structured, official, backfillable (one parser each)
- **КЕВР benchmarking** — annual „Сравнителен анализ на ВиК сектора": water loss %, non-
  revenue water, service coverage, accidents/network, staff, collection rate. **All ~42
  operators.** National loss 60.25% (2024); Shumen/Pernik/Sliven >80%. Annual PDF + annexes.
- **КЕВР tariffs** — lev/m³ per operator (Silistra 6.44 → Пловдив 3.73; euro-convert).
- **NSI water statistics** — JSON-stat open data via the **same `getopendata_json.php?id=N`
  mechanism the `update-regional` skill already uses**: % population connected to water
  (99.4%) / sewerage / treatment (66.8%), per-capita use (99 l/day), and **% population on
  режим as an official annual series** (4.6% in 2023, split seasonal/year-round) by oblast +
  basin district. This is the source that replaces media-reported rationing with real data.
- **АППК SOE consolidated report** — holding group financials (727M→1.09bn revenue 2023→24;
  net profit 2.4M vs −7.9M loss). Note: this report covers *all* state enterprises — a
  broader future view opportunity beyond water (out of scope here).

### Tier C — recurring PDF (watcher candidates)
- **МОСВ daily reservoir bulletins** — 52 complex+significant reservoirs, volume + % full +
  by purpose (питейно / напояване / енергетика). Daily PDF; parse to a daily series.
- **КЕВР 5-year business plans** — per-operator investment programs + quality **targets**
  (loss-reduction, compliance %) for 2022–26 / 2027–31. Enables **targets-vs-actuals**, the
  strongest accountability angle. 42 heavy PDFs (or use the aggregate КЕВР decision) — defer.

### Tier D — hard / stretch
- **Drinking-water quality** (РЗИ per-oblast reports / ИАОС „качество на питейните води") —
  nitrate non-compliance zones (~300 zones, ~150 persistent, agricultural). 28 oblast PDFs;
  ИАОС is the same agency we already pull air-quality from.

### Flood-risk sub-domain (new — the signature accountability feature, see §4.5)
- **Riverbed-cleaning procurement (Tier A, already in corpus):** contracts for „почистване /
  укрепване / корекция на речно корито / дере", проводимост — awarded by municipalities +
  Напоителни системи. Trackable via CPV 45246/45247000 (river-regulation works) + 90721800
  (flood protection) and title keywords (корито, дере, проводимост, укрепване). Real examples:
  Неделино, Kardzhali (13 участъка, €66k), Средец (укрепване, €2.5M). This is the *maintenance-
  spend* half — free, no new ingest.
- **РЗПРН flood-risk geodata (Tier C/D):** „Райони със значителен потенциален риск от
  наводнения" + „Карти на заплахата и риска от наводнения" under the Floods Directive
  (2007/60/EC), ПУРН 2022–27 (adopted Dec 2023). Four basin directorates (earbd.bg, bsbd.org,
  wabd.bg, БДДР) publish hazard maps (water depth · extent · hazard level · flow speed) + risk
  maps at 1:10,000, **with GIS layers as appendices** to the preliminary assessment. Join РЗПРН
  polygons to settlements. Also reported to EEA WISE. This is the *who's-at-risk* half.
- **Flood events / responsibility context:** riverbed-cleaning responsibility is split
  chaotically between mayors, regional governors and Напоителни системи — the direct cause cited
  for the deadly Царево (2023) and Свети Влас (2024) floods. Curate event case-studies as cited
  constants; no clean events feed.

## 4. Architecture — the sector-pack grammar

All three existing packs (`RoadsPack`, `NoiPack`, `NzokPack`) share one 10-part skeleton. The
Води pack reuses it verbatim, differing only in domain tiles. Reference:
`src/screens/components/procurement/{roads,noi,nzok}/*Pack.tsx`.

| # | Element | Shared implementation to reuse | Води usage |
|---|---|---|---|
| 1 | Section shell | `<section className="space-y-4">` | verbatim |
| 2 | Icon + title | `flex items-center gap-2 pt-2` + lucide icon `h-5 w-5 text-muted-foreground` + `<h2 className="text-lg font-semibold">`, bilingual | `Droplets`, "Води (ВиК)" |
| 3 | Domain-only KPI row | `grid gap-3 grid-cols-2` of `StatCard` (`@/screens/dashboard/StatCard`), `text-2xl font-bold tabular-nums`. Generic total/contracts/suppliers KPIs stay in the awarder header above | "Поръчки на година" + "Загуби на вода" (60.25%) |
| 4 | Auto insight chips | `insights: {text, warn?}[]`; `rounded-full border px-2.5 py-1 text-xs`; `warn`→`WARN_CHIP_COLORS` (`../chipStyles`), else `border-border bg-muted/40`. Slice ≤5. Standard: peak year, top category, **direct-award % (warn >10%)** | + water-specific: "Шумен: 83% загуби" (warn), top tariff oblast |
| 5 | Hero "bridge" tile | Fuse the contract ledger with the bigger money it's a sliver of | **invest-vs-result**: € invested (ИСУН + КЕВР) vs. change in loss % |
| 6 | "What X buys, by function" | CPV-division→function classifier, `categoryLabel(id, lang)` | CPV 41 / 45.23 / 90 → водоснабдяване / канализация / ПСОВ / строителство |
| 7 | Domain visuals | `Card / CardHeader / CardTitle (icon) / CardContent` (`@/ux/Card`), each closes with `text-[11px] text-muted-foreground/80` caption | **oblast-grained metrics render as choropleths, not lists** (see §4.1); subsidiary tree, EU-funds, financials, reservoir series |
| 8 | Optional local control | shared Radix `Select` (`@/components/ui/select`), never native | map-metric toggle only where a single map swaps metrics; prefer small-multiples |
| 9 | Static explainer | roads' "Какво влияе на цената на километър" | "Защо загубите на вода са високи" (aging network, terrain, NRW vs physical loss) |
| 10 | Provenance footer | `text-[11px] text-muted-foreground/80` | "показателите са от КЕВР; поръчките — АОП/ЦАИС ЕОП; фондове — ИСУН; финанси — ТР" |

Gating (copy NZOK's nuance): `isLoading` → `h-[280px] animate-pulse rounded-xl border bg-card`;
empty → `return null`, BUT keep the КЕВР/NSI/reservoir tiles alive even with zero contracts in
scope (they don't depend on the contract corpus), gating only the procurement-derived pieces.

## 4.1 UI conventions (v1.1)

Four conventions apply across every Води tile — they override the raw grammar where they conflict.

### a. Choropleth-first for oblast/geo data (no plain lists)
Every metric that is oblast-grained renders as a **choropleth map**, reusing the procurement
map stack, not a ranked list. Specifically:
- **Reuse `ProcurementOblastMap`** (`src/screens/components/procurement/ProcurementOblastMap.tsx`)
  — it owns the oblast geoJSON, colour scale (`PROCUREMENT_RAMP`) and tooltip. It is currently
  procurement-specific (reads `useProcurementByOblast`), so generalize it into a reusable
  **`OblastChoropleth`** that takes `{ oblastCode → value }` + a formatter + a ramp, and have
  the procurement map consume it too (no behaviour change). Water is the second caller.
- **Small-multiples like `ProcurementChoroplethTile`** (three maps side by side, one per metric,
  `grid lg:grid-cols-3`, shared legend) rather than one map behind toggle buttons. The water
  triptych: **загуби на вода % · цена €/м³ · население на воден режим %** — the spatial story
  of all three at a glance. Clicking an oblast filters the operator Top-N table below (same
  `activeOblast` / `onSelectOblast` seam the procurement tile uses).
- Which tiles become maps: `VikWaterLossTile`, `VikTariffTile`, `VikRationingTile`, and the NSI
  connection/treatment coverage. Non-geo tiles stay tiles (subsidiary tree, invest-vs-result
  scatter, reservoir time series, financials).
- Data is oblast-keyed; derive oblast from the operator→oblast map in `vikReferenceData.ts`
  (heed the oblast-code shard-mismatch note — derive oblast from obshtina prefix, don't trust a
  raw `area.oblast`).

### b. Everything is scope-based (like the other packs)
The pack receives `scopeWindow: { from, to }` from the awarder page's scope control and **every**
tile respects it — not just the procurement ones (a deliberate deviation from NZOK's independent
fiscal-year picker, per the requirement that all data be scope-based):
- Procurement / funds / financials tiles re-scope directly (contracts/funds/GFO rows within
  `[from, to)`).
- Annual reference series (КЕВР benchmarking & tariffs, NSI water stats) **clip to the window**:
  trend tiles show only years overlapping `[from, to)`; each **choropleth renders the latest
  year ≤ `to`**. No independent year picker.
- Reservoir daily series clips to the window (falls back to the latest available day when the
  window ends in the future).
- The scope itself is the shared procurement scope (`useProcurementScope` — `?pscope=ns|all|
  y:<year>`); the Води pack reads it exactly like roads/NOI/NZOK, and all nav links preserve it
  (see §4.2).

### c. Large datasets: Top-N tile in the pack → "See all" standalone page
No pack tile dumps a long list. Each large dataset shows a **Top-N tile** (e.g. top 10) ending
in a **"Виж всички" / "See all"** link to a dedicated **server-paginated DbDataTable page** (the
existing browse-page pattern: `ContractsBrowserDbScreen`, `TendersBrowserDbScreen`,
`SubsidiesBrowserDbScreen` in `src/screens/dev/`). New standalone screens + routes + `/api/db/
table` REGISTRY entries (§5):

| Dataset | Top-N tile (in pack) | Standalone page (route) | DbDataTable registry key |
|---|---|---|---|
| 42 operators (loss/tariff/financials) | `VikOperatorsTile` top 10 | `/water/operators` | `water-operators` |
| 26 subsidiaries' contracts | `VikSubsidiaryTreeTile` top spend | `/procurement/contracts?sector=water` (sector browse pack, §4.3) | existing `contracts` |
| ИСУН ОПОС projects | `VikEuFundsTile` top 10 | `/water/funds` | existing `fund_projects` filtered |
| 52 reservoirs × daily | `VikReservoirTile` (chart, latest) | `/water/reservoirs` | `water-reservoirs` |
| Drinking-water zones (~300+, Tier D) | top offenders | `/water/quality` | `water-quality` |

The "See all" link carries the current scope forward (`useProcurementHref`) and can seed the
table's free-text/filter (the `?q=`/filter deep-link convention from the contracts browser).
Contracts are the exception: rather than a bespoke page they route into the **sector browse
pack** on the shared `/procurement/contracts` (§4.3).

## 4.3 Sector browse packs (enrich the shared browse pages)

Generalize the awarder sector-pack seam so it also enriches the corpus-wide browse pages
(`/procurement/contracts`, `/procurement/tenders`) — the same idea as `getSectorPack(eik)`, but
keyed on a **sector (an EIK-set)** instead of a single entity. Avoids a bespoke `/water/contracts`
fork and is reusable by roads/НОИ/НЗОК/agri.

New registry `SECTOR_BROWSE_PACKS` in `sectorPacks.tsx`:
```
interface SectorBrowsePack {
  id: string;                        // "water" — activated by ?sector=water
  eiks: string[];                    // the 26 operators (+ Напоителни)
  fixedFilters(ctx): DbColumnFilter[];   // → [{ id: "awarder_eik", value: eiks }]
  Section?: FC<SectorBrowseProps>;   // enrichment strip rendered ABOVE the table
  columns?: (base) => columns;       // optional client-derived extra columns
  toolbarExtras?: FC;                // optional sector facets (function, oblast)
  resource?: string;                 // optional enriched registry variant
}
```
Mount one `<SectorBrowseSlot ctx={{from,to,all,cpv,method,q}}/>` in `ContractsBrowserDbScreen`
(and `TendersBrowserDbScreen`). It reads `?sector`, resolves the pack, and:
1. Merges `fixedFilters` (`awarder_eik IN <eiks>`) so the whole table becomes the sector's
   contracts — respecting the existing scope/CPV/method/single-bid filters unchanged.
2. Renders the pack's `Section` above the table (mini loss/tariff choropleth, top water
   contractors, funding split, function breakdown — the same tiles, scope-aware).
3. Composes `columns = [...base, ...(pack.columns ?? [])]`. Function / operator / oblast are
   **derived client-side from `awarderEik`** via `vikReferenceData.ts` — no backend change.

**Funding-source chip — build it in v1 (not deferred).** Add an enriched `water-contracts`
`/api/db/table` registry entry backed by a view that LEFT JOINs the contract's awarder EIK to
the ИСУН operator+program grain, yielding a `funding_source` column (ОПОС / national / tariff).
The water browse pack sets `resource: "water-contracts"` so the table gains a **funding chip
column + facet** ("show only ОПОС-cofinanced ПСОВ contracts in Шумен"). Per-contract ocid
linkage is weak (11–23%), so the flag is at operator+program grain (accurate) and the caption
says so. EXPLAIN-ANALYZE the joined view on the worst-case operator; index the ИСУН beneficiary
key both sides.

**All sectors get a browse `Section` in v1 (not water-only).** Populate `SECTOR_BROWSE_PACKS`
with **six** entries: `water`, `roads` (API_EIK), `noi`, `nzok`, `agri`, and **`judiciary`
(`JUDICIAL_EIKS`, the 58 — see §0b.8; the judiciary plan is blocked on this seam)**. Each reuses
its existing pack's tiles as a compact browse `Section` and its own EIK-set as the
`fixedFilters`. So `/procurement/contracts?sector=roads` shows the roads mini-pack over АПИ
contracts, etc. Water tiles are built fresh; the others wrap tiles that already exist (small
refactor to a shared `Section` variant). Judiciary gets a free derived `court level` column from
`COURT_LEVEL[awarderEik]` (client-side). Each sector's nav pill/menu entry can deep-link to its
enriched browse in addition to its awarder page.

**Prerequisite (§0b.8):** `awarder_eik` must be flipped from `filter: "eq"` to `filter: "in"` in
`functions/db_table.js` `REGISTRY.contracts`, or the EIK-set `fixedFilter` cannot be expressed.

The "Води (ВиК)" nav pill (§4.2) links to `/procurement/contracts?sector=water`.

Notes / prerequisites:
- The `Section` must read the **same filter+scope** the table uses, to stay coherent (more props
  than the awarder pack's lone `scopeWindow`).
- **Backend prerequisite:** the `contracts` `/api/db/table` registry must whitelist `awarder_eik`
  as a filter column (likely already, since `/company/:eik` contracts filter by it — verify).
  EXPLAIN-ANALYZE the `awarder_eik IN (26)` + window filter (index on `contracts(awarder_eik,
  date)`).
- Two faces of one idea: `getSectorPack(eik)` (single-entity awarder page) and
  `SECTOR_BROWSE_PACKS[sector]` (multi-entity browse page) share the water tiles and reference
  data; build the tiles once, mount them in both.

## 4.4 SEO: sitemap, static prerender, OG screenshots

Every crawlable Води page needs a real prerendered `dist/<path>/index.html` (a Vite SPA hides
React `<meta>` from crawlers; a sitemap `<loc>` without matching prerender HTML is a homepage
soft-duplicate). One catalogue — `INSTITUTION_PACKS` in `scripts/prerender/institutions.ts` —
drives prerender + sitemap + OG capture for the awarder packs at once.

### Awarder packs (Води + Напоителни)
Add one `InstitutionPack` entry each to `INSTITUTION_PACKS` (`scripts/prerender/institutions.ts`):
```
{ eik: "206086428", slug: "water",
  nameBg/nameEn, titleBg/titleEn, descriptionBg/descriptionEn,
  bodyBg/bodyEn,                 // crawlable prerendered body (real numbers: loss %, subs, invest)
  ogAnchor: '[data-og="water-loss-map"]',   // the загуби choropleth — a MAP, not a KPI header
  ogCenter: true, ogSettleMs: 2500 }         // center-frame + wait for the map to render
```
This auto-emits: the `/awarder/206086428` (+ `/en/…`) sitemap `<loc>` (loop in
`scripts/sitemap/index.ts`), the prerendered HTML, and `public/og/awarder/water.png` via the
`INSTITUTION_PACKS` loop in `scripts/og/capture-screens.ts`. Add a second entry for Напоителни
(`slug: "napoitelni"`, `ogAnchor` = its reservoir/irrigation map or debt chart). No other file
edits needed for the awarder packs.

### Standalone /water/* pages
- `scripts/sitemap/route_defs.ts` — add static route defs: `water`, `water/operators`,
  `water/reservoirs`, `water/funds`.
- `scripts/prerender/dynamicRoutes.ts` — add `buildWaterRoutes(): PrerenderRoute[]` (title,
  description, `ogImage`, crawlable `bodyHtml`, `jsonLd` via `buildWebPageLd` + `buildBreadcrumbLd`)
  and spread it into `buildDynamicRoutes()`.
- `scripts/og/capture-screens.ts` — add three `captures` entries; **each anchor is a chart or a
  map, center-framed, with a settle delay** so the visual is fully painted before the shot:
  - `water/operators` → `data-og="water-operators-chart"` (loss/tariff bar chart), `settleMs 1500`
  - `water/reservoirs` → `data-og="water-reservoirs-map"` (reservoir map/level chart),
    `centerOnAnchor`, `settleMs 2500`
  - `water/funds` → `data-og="water-funds-chart"` (ОПОС investment chart), `settleMs 1500`
  Output: `public/og/water/{operators,reservoirs,funds}.png` (1200×630), referenced via each
  route's `ogImage`.

### Component requirement for beautiful OG
Every OG-anchored visual must wrap its **chart or map** (never a bare KPI row) in a
`<div data-og="…">`: the awarder hero's `VikWaterLossTile` choropleth, the reservoir map, the
operators chart, the funds chart. The capture waits on `waitFor` = the anchor, so Recharts/Leaflet
must have finished animating (hence `ogSettleMs`); disable chart entry animations under the OG
capture flag if needed for a crisp frame.

### ?sector= browse variant — deliberately no sitemap/prerender entry
Query-string variants (`/procurement/contracts?sector=water`) are soft-duplicate filters of the
base page; the already-prerendered `/procurement/contracts` covers them, and adding a `<loc>`
without its own `dist/.../index.html` would violate the sitemap-validity rule. The sector view is
a client-side filter surface reached via the nav pill, not an indexed URL.

### File-count budget
+~8 prerendered HTML (`dist/{,en/}water/*` + 2 awarder pages already counted) and ~6 OG PNGs —
negligible against the ~84k Firebase deploy file ceiling.

## 4.2 Nav links to the Води pack (two surfaces)

Both already link the roads/NOI/NZOK packs by their `*_AWARDER_PATH` constants — add Води the
same way (single source: export `VIK_AWARDER_PATH` from `sectorPacks.tsx`):
- **Governance / управление menu** — `src/layout/header/reportMenus.ts`, the
  `menu_group_state_entities` ("Държавни структури") group (≈L280): add
  `{ title: "procurement_water_nav", link: VIK_AWARDER_PATH }` next to roads/noi/nzok/dfz.
- **Procurement dashboard sub-nav** — `ProcurementNav.tsx` `secondaryItems` ("Sector-specific
  analyses" pill row): add `{ to: VIK_AWARDER_PATH, icon: Droplets, key: "procurement_water_nav" }`.
  Links use `href(to)` (`useProcurementHref`) so scope + election survive the click.
- i18n: add `procurement_water_nav` = "Води (ВиК)" / "Water (ВиК)" to `src/locales/{bg,en}/
  translation.json`.
- Napoitelni gets its own entries the same way once its EIK is confirmed.

### Frontend files (mirror the NZOK pack)
- `src/lib/vikReferenceData.ts` (NEW) — `VIK_HOLDING_EIK="206086428"`, 26-subsidiary EIK list,
  Напоителни EIK, oblast→operator map, `categoryLabel`, loss/tariff benchmark bands.
- `src/lib/vikAttributes.ts` (NEW) — `buildVikModel()` CPV→function classifier.
- `src/data/procurement/useVik.tsx` (NEW) — `useVik(eik, scopeWindow)` joining contracts +
  КЕВР + NSI + funds + financials → `VikModel | null`. Returns the **standard** model surface
  (`totalEur`, `years[]`, `categories[]`, `directShare`, `suppliers[]`) so chips/category/KPI
  light up for free, plus water extras (`lossByOblast`, `tariffByOblast`, `subsidiaries`,
  `euFunds`, `financials`, `reservoirs?`).
- `src/data/budget/useBudget.tsx` (EDIT) — add `useVikBenchmark()`, `useVikTariffs()`,
  `useWaterStats()`, `useReservoirLevels()`.
- `src/data/budget/types.ts` (EDIT) — `VikBenchmarkFile`, `VikTariffFile`, `WaterStatsFile`,
  `ReservoirSeriesFile`.
- `src/screens/components/procurement/vik/` (NEW dir): `VikPack.tsx`, `VikInvestVsResultTile`
  (hero scatter), `VikWaterLossTile` / `VikTariffTile` / `VikRationingTile` (choropleth
  small-multiples via `OblastChoropleth`, §4.1a), `VikOperatorsTile` (Top-N → `/water/operators`),
  `VikCategoryTile` (clone `NzokCategoryTile`), `VikSubsidiaryTreeTile` (consolidates procurement
  + P/L across 26, deep-links each, Top-N), `VikEuFundsTile` (Tier A, Top-N → `/water/funds`),
  `VikReservoirTile` (time series, fast-follow), plus `NapoitelniPack.tsx` (governance-failure
  framing: insolvency, 88 undocumented reservoirs, water-use-fee arrears; hero = debt-vs-revenue).
- `src/screens/components/procurement/OblastChoropleth.tsx` (NEW) — generic oblast map extracted
  from `ProcurementOblastMap` (`{oblastCode→value}` + formatter + ramp); procurement map becomes
  a caller (no behaviour change), water is the second.
- `src/screens/dev/` (NEW standalone DbDataTable browse screens, §4.1c): `WaterOperatorsDbScreen`,
  `WaterReservoirsDbScreen` (+ `WaterQualityDbScreen` for Tier D). Contracts/funds have no bespoke
  screen — contracts route into the sector browse pack (§4.3), funds reuse the funds browser.
- `src/screens/components/procurement/SectorBrowseSlot.tsx` (NEW, §4.3) — reads `?sector`, mounts
  the matching `SECTOR_BROWSE_PACKS` entry's `Section` + merges its filters/columns; add the slot
  to `ContractsBrowserDbScreen` and `TendersBrowserDbScreen`.
- `src/routes.tsx` (EDIT) — routes `/water/operators`, `/water/reservoirs`, `/water/funds`
  (wrapped in `<LayoutScreen>`, mirroring `/procurement/contracts`).
- `src/screens/components/procurement/sectorPacks.tsx` (EDIT) — register `206086428`→`VikPack`
  and Напоителни→`NapoitelniPack` in `PACKS`; add the `water` entry to `SECTOR_BROWSE_PACKS`
  (§4.3); export `VIK_AWARDER_PATH`.
- Nav (§4.2): `reportMenus.ts` (Държавни структури group) + `ProcurementNav.tsx` `secondaryItems`
  pill + `procurement_water_nav` i18n key.

## 4.5 World-best UI/UX — external benchmarks + patterns to import from other packs

Competitive research (2026-07-10) against the best public water dashboards, plus a sweep of our
own packs for reusable UI. Goal: not "a Bulgarian pack" but the honest, per-oblast, per-euro
front-end that beats what any regulator ships — the way the roads pack beats АПИ's own site.

### External benchmarks & what to adopt
- **Ofwat "Discover Water" (UK)** — the gold standard for *public-facing* water performance:
  four plain KPI areas (water supply · sewage · customer service · environmental impact),
  per-company comparison, consumer framing ("how is MY company doing"). **Adopt:** the
  personal, comparative frame — "your operator's loss/tariff vs the national spread" as the
  landing hook (we already personalize prices/местни-данъци this way).
- **ERSAR (Portugal)** — 20 indicators in 6 groups, each operator scored with a **traffic-light
  (good / medium / poor) quality band** and published annually. **Adopt:** a traffic-light rating
  band on the operators table + choropleth (loss %, collection, accidents → green/amber/red
  against КЕВР/EU thresholds), not just raw numbers. Turns a data table into a scorecard.
- **IBNET (World Bank), WAREG (EU regulators)** — global/EU cross-utility benchmarking with
  reference ranges for NRW, coverage, unit cost. **Adopt:** an *international reference band* for
  water loss / NRW (BG ~60% vs EU good-practice <25%), exactly like the roads pack benchmarks
  €/km against ROCKS/RO/GR. Gives the loss number an honest yardstick.

### Patterns to import from our own packs
- **Roads network map → flood-risk river map (the geographic hero).** `RoadNetworkMap` renders
  the motorway network coloured by a selected metric, line thickness = € spent, click-a-corridor
  to focus, metric toggle via shared `Select`. The water analogue is the flood-risk map in §4.5b:
  rivers / РЗПРН polygons as the spine, coloured by flood-risk level, cleaning-spend markers
  sized by €, click-a-basin to focus. Build a generic `NetworkRiskMap` off the RoadNetworkMap
  shape (or reuse its Leaflet scaffolding), not a bespoke map.
- **`RoadCostBenchmarkTile` (vs ROCKS/RO/GR)** → `VikLossBenchmarkTile` (vs IBNET/EU band).
- **`RoadRegionCompetitionTile`** (ОПУ single-bid heatmap — "where competition collapses") →
  the flood risk heatmap in §4.5b ("where flood risk meets zero maintenance").
- **`RoadChainageStripTile`** (spend density along the km axis) → optional river-length cleaning-
  spend density per basin.
- **`OblastChoropleth` small-multiples** (§4.1a) and the **auto insight chips / bridge hero**
  grammar (§4) — already imported.

### 4.5b Signature feature — „Риск от наводнения: непочистени корита" (flood risk × maintenance)
The world-first tile no regulator or competitor has: cross-join the three data halves into a
**per-settlement / per-РЗПРН flood-risk-vs-maintenance score**.

`floodRisk = f(` РЗПРН hazard class (Tier C/D geodata) `,` flood history (Царево/Свети Влас-style
events) `) −` maintenance signal `(` recency + € of riverbed-cleaning contracts in/upstream of
the area, Tier A `)`. High hazard + zero recent cleaning spend = **red "at-risk-but-unmaintained"**.
Surfaced as:
- a **flood-risk river map** (the roads-map analogue) — РЗПРН coloured by risk level, cleaning-
  spend markers sized by €, click-to-focus a basin;
- a ranked **"most at-risk, least maintained" league table** → `/water/flood-risk` DbDataTable
  "See all";
- **responsibility attribution** — each segment tagged mayor / regional governor / Напоителни
  системи (the "chaos" the floods exposed), linking to that entity's awarder page.

This reinforces §0b.4 (the `/water` screen, not the awarder page, is the home — flood risk is not
procurement-centric) and ties the holding + Напоителни + municipalities into one story. Napoitelni
gets a flood-responsibility section (it's a named responsible party). Caveats: РЗПРН↔settlement
and cleaning-contract↔river-segment joins are approximate (title/geo matching) — label the score
as indicative, show the underlying contracts, never assert causation for a specific flood.

## 5. Data model & SQL performance

Follow the **PG-only** convention of the recent agri/funds packs (no build*FromRows / db:gen).
Ingests write PG directly; the dashboard is served from a precomputed blob table.

### Tables (new)
- `water_operators` — dim: `eik PK`, `name`, `oblast`, `type` (holding_sub | concession |
  municipal), `holding_share numeric`, `in_holding bool`.
- `water_benchmark` — fact: `(operator_eik, year) PK`, `loss_pct`, `nrw_pct`, `coverage_pct`,
  `accidents`, `staff`, `collection_pct`.
- `water_tariffs` — `(operator_eik, effective_date) PK`, `water_eur_m3`, `sewer_eur_m3`,
  `treatment_eur_m3`.
- `water_stats_oblast` — NSI: `(oblast, year) PK`, `pct_connected_water/sewer/treatment`,
  `per_capita_l_day`, `pct_rationing_seasonal`, `pct_rationing_annual`.
- `water_reservoirs` — `(reservoir_id, date) PK`, `name`, `volume_mln_m3`, `pct_full`,
  `purpose`.
- `water_payloads` — `(kind, key) PK`, `payload jsonb` — precomputed dashboard blobs (kind =
  `holding_overview` | `operator` | `sector_map` | `reservoirs`), mirroring `agri_payloads` /
  `fund_payloads`. Serve via a `/api/db/water-*` route.

Financials, EU funds and procurement are **NOT** new tables — they are joins onto existing
`tr_financials` / `fund_*` / `contracts` by operator EIK.

### SQL performance verification (per the "always check DB query perf" rule)
Every new/changed query gets `EXPLAIN ANALYZE` on the **worst-case entity** before shipping,
and an index if it seq-scans. Concretely:
- Index `operator_eik` (+ `year`) on `water_benchmark`, `water_tariffs`; `(oblast, year)` on
  `water_stats_oblast`; `(reservoir_id, date)` on `water_reservoirs`.
- **Worst case = the consolidated group roll-up** (`contracts WHERE awarder_eik IN (<26 EIKs>)`
  and the funds join on `fund_beneficiary_eik IN (...)`). Verify `contracts(awarder_eik)` and
  the funds beneficiary FK are indexed on BOTH sides of the join (per the PG perf playbook);
  the 26-EIK `IN` list must use an index scan, not a seq scan over the whole contracts corpus.
- **Precompute** the group roll-up + sector map into `water_payloads` at ingest (global-hot,
  O(26) join, >200ms if live) rather than per page load. jsonb builders follow the payload-
  determinism rules: `ROUND` sums, rounded sort keys with eik tiebreaks, `COLLATE "C"` MINs;
  run the parity audit recipe against a JSON dump of the same query.
- **DbDataTable** (backs the "See all" pages, §4.1c): register REGISTRY entries in `/api/db/
  table` (a registry row each, not new endpoints; the column whitelist is the security boundary)
  for `water-operators` (operator × loss/tariff/financials, oblast + year filters) and
  `water-reservoirs` (reservoir × date series); `water-quality` for Tier D. Contracts/funds
  "See all" reuse the existing `contracts` / `fund_projects` registries with a water EIK filter.
  Every registry query gets the same `EXPLAIN ANALYZE` worst-case check as above.
- EUR sums use `totalEur = Σ per-row amountEur` (PG basis), never per-currency convert.

## 6. AI chat tools

Add a water tool family mirroring the procurement/awarder tools. Files (per the ai/ tool
recipe): create `ai/tools/vik.ts`; edit `ai/tools/registry.ts` (import + `ToolDef` entries in
`TOOLS`), `ai/orchestrator/router.ts` (keyword block), `ai/orchestrator/narrate.ts` (cases).

Tools (Envelope → narrate → UI pipeline; tools NEVER compute numbers in prose — only narrate
`env.facts`; data via `fetchDb("water-*", …)` for PG blobs or `fetchData("/water/*.json")`):
- `waterLossByOblast` (domain `indicators`) — loss % by operator/oblast; national + drill.
- `waterTariffsByOblast` (domain `place`) — €/m³ per operator in an oblast.
- `vikHoldingOverview` (domain `fiscal`) — holding group: revenue, P/L, subsidiary count,
  consolidated procurement, EU-funds drawn.
- `vikOperatorProfile` (domain `place`) — one operator: loss, tariff, service area,
  financials, top contracts.
- `waterRationing` (domain `indicators`) — % population on режим by oblast/year (NSI series).
- `reservoirLevels` (domain `place`) — reservoir fill % + by purpose (once МОСВ lands).
- `floodRisk` (domain `place`) — per-settlement/oblast flood-risk-vs-maintenance score (§4.5b):
  РЗПРН hazard class + riverbed-cleaning spend/recency + responsible party. The differentiator
  tool — narrate "high risk, no cleaning contract since <year>, responsible: <mayor/НС>".

Router keywords: `вода|ви̇к|водно|водоснабд|канализац|напоител|язовир|воден режим|water|vik|
reservoir`. Provenance strings: `db:water-*` / `water/*.json`. Note: any `/water/*.json` path
an ai/ tool reads MUST have an `AI_PATH_RULES` entry (§8) or the prebuild fails.

## 7. Watchers & process-watch-report wiring

Watcher sources (`scripts/watch/sources/*.ts`, `WatchSource` shape: `id`, `label`, `url`,
`cadence`, `fingerprint()`, `describe()`), imported and added to `SOURCES` in
`scripts/watch/sources/index.ts`:
- `kevr_vik_benchmark.ts` — cadence `monthly` (annual report, but check often); fingerprint =
  hash of the latest ВиК-sector-analysis link/date on dker.bg.
- `kevr_vik_tariffs.ts` — fingerprint = hash of the current `Ceni_ViK_uslugi_*.pdf` link/date.
- `mosv_reservoir_bulletin.ts` — cadence `daily`; fingerprint = latest daily-bulletin date.
- `nsi_water_stats.ts` — cadence `monthly`; fingerprint = NSI open-data dataset id + release.

Process-watch-report mapping — add rows to the table in
`.claude/skills/process-watch-report/SKILL.md` (all fan out to one skill; orchestrator
dedupes):

| Watcher source id | Skill |
|---|---|
| `kevr_vik_benchmark` | `update-water` |
| `kevr_vik_tariffs` | `update-water` |
| `mosv_reservoir_bulletin` | `update-water` |
| `nsi_water_stats` | `update-water` |

Skill: create `.claude/skills/update-water/SKILL.md` (shape on `update-nzok`). After a
successful run it stamps `state/ingest/update-water.json` via
`npx tsx scripts/stamp-ingest.ts update-water --summary "…"` (`IngestState` = `{skill,
lastSuccessfulIngest, summary}`).

Follow the one-off-backfill rule: КЕВР/NSI historical backfills go behind a `--backfill` flag,
never in the watcher/CI; document in README.

## 8. recent_updates / changelog

Every water table wires into `recent_updates` via `recordIngestBatch`
(`scripts/db/lib/ingest_changelog.ts`), called INSIDE each loader's BEGIN/COMMIT txn (stable
natural key that survives TRUNCATE+reload). Examples:
- benchmark: `{ source: "water_benchmark", table: "water_benchmark", keyExpr:
  "t.operator_eik || ':' || t.year", nameExpr: "t.operator_eik", detailExpr: "t.year || ' · '
  || t.loss_pct || '% загуби'", amountExpr: "NULL", rowsTotal }`.
- reservoirs: `{ source: "water_reservoir", keyExpr: "t.reservoir_id || ':' || t.date", … }`
  (day-coalesced + auto-summary >500/day is the default per the changelog rule).

## 9. Data Map & README docs

### Data Map (`scripts/data_map/model.ts`) — prebuild fails on an unplaced source
- `SOURCE_GROUPS`: add one `water` group (`origin: "state"`, `members: ["kevr_vik_benchmark",
  "kevr_vik_tariffs", "mosv_reservoir_bulletin", "nsi_water_stats"]`, `skills:
  ["update-water"]`, `tags: ["indicators"]`, `label/detail/desc/url`). МОСВ/КЕВР/НСИ.
- `DATASETS`: add `water` (`path: "data/water/"` — or note it's PG-served via `water_payloads`
  if there's no static JSON; check how agri/funds are represented on the map).
- `EDGES`: `["src:water", "ds:water"]` and `["ds:water", "f:<feature>"]` (feature node for the
  Води pack / awarder view).
- `AI_PATH_RULES`: add `{ pattern: /^\/water\//, dataset: "water" }` if any ai/ tool reads
  `/water/*.json`.
- Verify with `npm run data:map`; the build errors "watcher source(s) not placed on the data
  map" if a source is missing from a group.

### README.md
- "Data sources" (~L472) — add КЕВР ВиК benchmarking/tariffs, МОСВ reservoir bulletins, NSI
  water stats, ИСУН ОПОС „Води" reuse, TR financials reuse.
- "Data layout" (~L205) — document `data/water/` (or the `water_*` PG tables).
- Note the update-water CLI flags (`--backfill` etc.) alongside the other `update-*` skills.

## 10. Phasing

> Restructured per §0b.4: **Phase 1 = the pack** (money, fast, on-pattern); **Phase 2 = the
> `/water` screen** (the half money can't tell). Same shape as the judiciary rollout.

- **Phase 0 — unblock (§0a):** flip `awarder_eik` → `filter: "in"` in `functions/db_table.js`;
  resolve the 26-subsidiary + Напоителни + Софийска вода EIKs; hand-curate the КЕВР
  operator-name→EIK crosswalk into `src/lib/vikReferenceData.ts` (vssReferenceData pattern).
- **Phase 1 — the pack (Tier A, renders off existing corpus/ИСУН/ТР, no new ingest):** register
  `206086428`→`VikPack`, `VikSubsidiaryTreeTile` (consolidated 26-EIK procurement + P/L, Top-N),
  `VikEuFundsTile` (ИСУН join, Top-N), `VikCategoryTile`, auto chips + KPI, all scope-based.
  Napoitelni pack (hero = debt-vs-revenue from TR, §0c.13). **SEO/OG:** `INSTITUTION_PACKS`
  entries for both awarders — **OG anchored on a Tier-A chart, not the absent loss map**
  (§0c.10). `procurement_water_nav` i18n key.
- **Phase 1b — shared seams (§0b.8), unblocks the judiciary plan too:** build `OblastChoropleth`
  (extracted from `ProcurementOblastMap`) and `SECTOR_BROWSE_PACKS` + `SectorBrowseSlot` with all
  **six** sector entries, plus the `water-contracts` enriched registry + **funding-source chip**.
- **Phase 2 — the `/water` screen (primary surface):** `WaterScreen.tsx` + route, nav surfaces
  repointed to `/water`, reverse-bridge subsidiaries tile, `WaterOperatorsDbScreen` +
  `/water/operators` "See all" (MVP columns per §0c.11), `route_defs`/`buildWaterRoutes`/OG
  capture for the screen.
- **Phase 3 (Tier B ingest):** `update-water` skill + КЕВР benchmarking + tariffs (**€/m³**,
  converted at ingest) + NSI water stats → `data/water/*.json` (static, §0b.5) → the choropleth
  triptych, invest-vs-result hero, scope-clipped trends. Wire watchers, changelog + the
  `data_changes_skill_update-water` i18n key, data map (`fiscal` tag, `f:water`), README, AI
  tools (`fetchData` + mandatory `AI_PATH_RULES`), loader tests. Re-anchor the awarder OG on the
  загуби map.
- **Phase 4 (Tier C):** МОСВ daily reservoirs (watcher `daily`) + "Язовири и воден режим" section
  + `/water/reservoirs` page + its map-based OG + a summer FB card. КЕВР business plans →
  targets-vs-actuals. Adopt the ERSAR traffic-light bands + IBNET/EU loss reference band.
- **Phase 5 (signature — flood risk, §4.5b):** riverbed-cleaning procurement lens (Tier A, free)
  first, then РЗПРН geodata (Tier C/D) → the flood-risk river map (`NetworkRiskMap`, roads-map
  pattern), the "at-risk-but-unmaintained" league table + `/water/flood-risk`, `floodRisk` AI
  tool, and the Напоителни flood-responsibility section. Highest-impact, most novel; can start
  the maintenance-spend half immediately since it's corpus-only.
- **Stretch (Tier D):** drinking-water quality (РЗИ/ИАОС nitrate zones) + `/water/quality`.

## 11. Open questions / risks
- Canonical 26-subsidiary EIK list + Напоителни EIK (resolve from TR/vikholding.bg).
- Reservoir→operator→settlement mapping is not clean — keep reservoir tiles national.
- КЕВР PDF layout stability for the benchmarking annex parser (Gemini Vision OCR fallback like
  the budget capital-programmes).
- Sofia/Veolia scope labelling — must never read as a holding subsidiary.
- "Investment" denominator for the hero spans procurement + ИСУН + КЕВР-reported figures;
  document which is shown to avoid double-count.
- **Flood feature (§4.5b):** РЗПРН GIS lives across four basin-directorate sites in mixed formats
  (shapefile appendices, WMS) — access + normalization is the hard part; start with the Tier-A
  maintenance-spend half, add geodata incrementally. The risk score is *indicative*: РЗПРН↔
  settlement and cleaning-contract↔river-segment joins are approximate — never assert a specific
  flood was caused by a specific unlet contract; show the contracts and let the reader judge.

## 12. First social card (already in the data)
"България инвестира 532 млн. лв. във ВиК през 2024 — а загубите на вода се качиха на 60,25%."
(Flood-feature card, once §4.5b lands: "N населени места в риск от наводнения без нито един
договор за почистване на речното корито от <година>.")

## 13. Competitive context (why this wins)

- **vs the regulators' own sites (КЕВР, МОСВ, basin directorates):** they hold the data but ship
  it as annual PDFs and static GIS with no time series, no per-euro link, no cross-source join.
  We are their reader-friendly front-end — the same relationship the roads pack has to АПИ's site.
- **vs Ofwat/ERSAR/IBNET (world-best):** we borrow their strengths (comparative per-operator
  framing, traffic-light quality bands, international reference ranges) and add what they lack —
  the **procurement/EU-funds/financials join** (invest-vs-result) and the **flood-risk ×
  maintenance-spend accountability** feature that no water dashboard anywhere ships.
- **vs Bulgarian media & ИПИ/regionalprofiles.bg (competitor):** they run one-off flood/loss
  investigations; we make it a living, per-place, click-through dashboard backed by the contracts.
- **The moat:** three joins nobody else has assembled — (1) КЕВР performance × procurement spend,
  (2) holding financials × EU funds × ownership tree, (3) flood-risk geodata × riverbed-cleaning
  procurement × responsible party. Each is only possible because the corpus, funds, TR and geo
  layers already live in one place.
