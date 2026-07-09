# Води (Water sector) view — implementation plan v1

Status: DRAFT (2026-07-08). Owner: TBD. Ships behind the existing sector-pack seam; no
routing or awarder-page changes.

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
  triptych: **загуби на вода % · цена лв/м³ · население на воден режим %** — the spatial story
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
   Only the funding chip (ИСУН) needs the `resource` override or a client operator→program set.

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
- `waterTariffsByOblast` (domain `place`) — lev/m³ per operator in an oblast, euro.
- `vikHoldingOverview` (domain `fiscal`) — holding group: revenue, P/L, subsidiary count,
  consolidated procurement, EU-funds drawn.
- `vikOperatorProfile` (domain `place`) — one operator: loss, tariff, service area,
  financials, top contracts.
- `waterRationing` (domain `indicators`) — % population on режим by oblast/year (NSI series).
- `reservoirLevels` (domain `place`) — reservoir fill % + by purpose (once МОСВ lands).

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

- **MVP (Tier A only — renders today, no new ingest):** `vikReferenceData.ts` with the 26-EIK
  list, register `206086428`, `VikSubsidiaryTreeTile` (consolidated procurement + P/L, Top-N),
  `VikEuFundsTile` (ИСУН join, Top-N), `VikCategoryTile`, auto chips + KPI, all scope-based.
  Both nav links (§4.2) + `procurement_water_nav` i18n. `WaterOperatorsDbScreen` + `/water/
  operators` "See all". Napoitelni pack shell.
- **Fast-follow 1 (Tier B):** `update-water` skill + КЕВР benchmarking + tariffs + NSI water
  stats → the choropleth triptych (`OblastChoropleth`: загуби % · тариф лв/м³ · воден режим %),
  invest-vs-result hero, scope-clipped trend series. Wire watchers, changelog, data map, README,
  AI tools.
- **Fast-follow 2 (Tier C):** МОСВ daily reservoirs (watcher `daily`) + "Язовири и воден режим"
  section + a summer FB card. КЕВР business plans → targets-vs-actuals.
- **Stretch (Tier D):** drinking-water quality (РЗИ/ИАОС nitrate zones).

## 11. Open questions / risks
- Canonical 26-subsidiary EIK list + Напоителни EIK (resolve from TR/vikholding.bg).
- Reservoir→operator→settlement mapping is not clean — keep reservoir tiles national.
- КЕВР PDF layout stability for the benchmarking annex parser (Gemini Vision OCR fallback like
  the budget capital-programmes).
- Sofia/Veolia scope labelling — must never read as a holding subsidiary.
- "Investment" denominator for the hero spans procurement + ИСУН + КЕВР-reported figures;
  document which is shown to avoid double-count.

## 12. First social card (already in the data)
"България инвестира 532 млн. лв. във ВиК през 2024 — а загубите на вода се качиха на 60,25%."
