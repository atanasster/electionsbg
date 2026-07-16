# Полиция / Вътрешен ред (МВР) sector view — v1 plan, competitive research & brainstorm

Status: **PHASE 1 + 2 + 3-CORE BUILT & VERIFIED (uncommitted) — 2026-07-15.** Research/brainstorm below
drove the build; see the "SHIPPED" block for what actually landed (incl. the §7a road-safety ingest and
the Phase-3 spend-vs-outcome tiles).
Closest built siblings to copy: **`defense-pack-v1.md`** (the nearest analogue by far — a security-cluster
multi-EIK group with a health confound, a budget bridge, a competition heatmap and an explicit
"invisible spend" transparency gap) and the shipped **generic sector dashboard**
(`SectorDashboardScreen` + `sectorDashboards.ts`) for the cheapest Phase-1 ship. `tourism-view-v1.md`
is the reference for the two-phase generic-first playbook and the exact files-to-touch checklist.

---

## SHIPPED — Phase 1 + 2 (2026-07-15, uncommitted, verified live)

`/sector/security` is live with the full bespoke `MvrPack` — no new ingest, all real corpus + the
already-ingested МВР budget/population data.

**New files (13):**
- `src/lib/securityReferenceData.ts` — the curated **75-EIK allowlist** with 7 universes. The corpus scan
  caught **€255M+ of Ministry-of-Justice spend** (ГД Изпълнение на наказанията €159M, Фонд затворно дело
  €97M, ГД „Охрана" €22M) a naive `1290*` sweep would misattribute, and МВР units the name-scan missed
  (ДКИС €85M, ГДБОП €13.5M, ГД „Охранителна полиция").
- `src/lib/securityAttributes.ts` — CPV→policing-function classifier.
- `src/data/procurement/useMvr.tsx` — group-model hook (universe filter, health-confound share).
- `src/screens/components/procurement/security/` — `MvrPack` + `MvrBudgetBridgeTile` (the iceberg),
  `MvrCategoryTile`, `MvrTopContractsTile` (award-level, 4 big buyers, risk chips), `MvrCompetitionTile`,
  `MvrOblastMapTile` (per-capita choropleth), `MvrTransparencyTile`.

**Wired (config, 9 files):** `sectorDashboards.ts` (police config, 75 members), `sectorPacks.tsx`
(pack under `MVR_EIK` + browse pack), `sectorRegistry.ts` (security cluster, new `slate` accent),
`sectorScenes.tsx` (police-badge scene), `tileAccents.ts` (`slate #48587a`), i18n bg+en,
`sector_stats.ts`, `scripts/prerender/routes.ts` (SEO copy — build guard satisfied).

**Verified live** (`/sector/security?pscope=all`): iceberg **€2.1bn budget (×3.2 since 2018)**,
procurement the ~6% tip; **ИТ и видеонаблюдение €407.5M (21%)** leads what-МВР-buys; **fuel 58% single-bid**;
biggest contracts name the real hooks — **ID-documents €129.3M**, **license plates €44.7M · 1 bid**,
**Bulgarian-Turkish border surveillance €35.8M · ЕС**; per-oblast €/capita map (Смолян €30 → Перник €5,
nat mean €10); 74-unit competition heatmap; HHI 149. Date scoping re-filters (y:2016 → €41.1M/21 units).
`tsc` + `eslint` clean; **both light & dark themes** verified; no console errors.

**§7a ingest + Phase-3 outcomes — SHIPPED (2026-07-15).** The spend-vs-outcome layer is real, not deferred:
- **Road-safety ingest** — `scripts/security/fetch_road_safety.ts` fetches Eurostat `sdg_11_40` (Road
  traffic deaths, unit=NR, TOTAL) → `data/security/road_safety.json` (14 yrs: 2011=656 → **2024=478**,
  peak 2015=708, **−32% vs peak**). Verified reachable + parsed.
- **`MvrRoadSafetyTile`** — road-death trend + the −32% headline, paired with the group's vehicle
  procurement (€316.4M) as the traffic-police instrument, honestly framed (context, not causation).
- **`MvrCrimeScatterTile`** — the signature §7 tile 9 / §7b.D visual: an inline-SVG per-oblast scatter,
  x = МВР €/resident, y = recorded theft/100k (from the ALREADY-ingested `data/regional.json` — no new
  fetch), median quadrant lines + labelled outliers. **27 oblasts** join cleanly (Sofia city dropped —
  its theft series is МИР-sharded); real values (Бургас €20·466, Варна €15·646, Пловдив €12·207).
- Both live under a new **"Резултати / Outcomes"** `PackSection`. `tsc`+`eslint` clean; verified live.

**Performance + PG (2026-07-15).** Loading + data-architecture audit:
- **Biggest contracts moved to PG.** The tile originally fanned out over 4 full awarder corpuses
  client-side (**3.56 MB** to render 8 rows). Added a `awarder-group-top-contracts` route to
  `functions/db_routes.js` — one server-side `ORDER BY amount_eur DESC … LIMIT 8` over the whole 75-EIK
  group. Payload **3.56 MB → 3.8 KB (~910×)**; EXPLAIN ANALYZE: **2.66 ms, Index Scan on
  `idx_contracts_tag_amount`** (presorted amount_eur → LIMIT short-circuits, no seq scan). No new
  migration/dataset (queries the existing table+index), so no `recent_updates` changelog entry needed.
- **What stayed JSON (correctly):** `road_safety.json` (14-row curated series — a static file like
  `data/defense/*.json`, not worth a table); `regional.json` (shared cross-app artifact); the budget
  ministry tree. All the heavy/queryable procurement data already goes through PG (group-model + the new
  top-contracts route). Other payloads are fine: group-model 212 KB, regional 132 KB (shared), road_safety 1 KB.
- **Responsive** — verified mobile (375) + tablet (768): zero horizontal overflow; KPIs 2-up
  (mobile/tablet) → 3-up desktop; tile pairs 1-up → 2-up; the choropleth + scatter SVGs scale to the
  column; fixed the scatter outlier label clipping (right-half labels anchor leftward). Light + dark OK.

**Integration surfaces wired (2026-07-15).**
- **Watcher:** `scripts/watch/sources/eurostat_road_safety.ts` (fingerprints the `sdg_11_40` publish
  timestamp; verified live — update 2026-07-10) registered in the SOURCES index; two `process-watch-report`
  mapping rows (by-label + by-id) → run `npx tsx scripts/security/fetch_road_safety.ts` (small committed
  file, no bucket/PG/skill).
- **Docs:** README in 3 places (the "What's in here" Police bullet, the `data/security/` directory row, the
  Eurostat `sdg_11_40` data-source entry); the **data map** (`scripts/data_map/model.ts` — route pattern,
  `AI_PATH_RULES` `/security/` rule, `src:security` source group, `ds:security` dataset, `src→ds` edge) rebuilt
  into `data/data_map.json` (84 nodes; `ds:security → f:ai` edge auto-derived from the AI tool).
- **AI chat:** `ai/tools/security.ts` → `securityRoadSafety` (reads `road_safety.json`, `series`+`facts`),
  registered in `ai/tools/registry.ts`.
- **Sitemap:** `/sector/security` auto-included (derives from `SECTOR_DASHBOARD_IDS`).
- **OG image:** `public/og/sector-security.png` (1200×630 @2x), auto-referenced by the prerender
  (`ogImage: /og/sector-${id}.png`) — title + KPIs + iceberg hero, on-brand with sibling sectors.

**RENAMED to "Security" / "Сигурност" (2026-07-15, pre-deploy).** The user-facing sector was renamed from
"Police / Полиция" — **sector id `police` → `security`**, URL **`/sector/police` → `/sector/security`**,
titles (`sector_security_title/desc` = Сигурност/Security), browse pack (`?sector=security`), scene key,
`sector_stats` key, prerender `SECTOR_PAGES` id + copy, the `MvrPack` heading ("Сигурност / МВР"), OG
image (`sector-security.png`), and the data-map dataset. **The internal `police`→`security` rename was
then completed too** (files: `securityReferenceData.ts`, `securityAttributes.ts`, `securityOblast.ts`,
`ai/tools/security.ts`, `scripts/security/`, `data/security/`, `components/procurement/security/`;
identifiers: `SECURITY_SECTOR_EIKS`, `SECURITY_ALIAS_EIKS`, `SECURITY_UNIVERSES`, `SecurityUniverse`,
`securityRoadSafety`, `build/…SecurityModel`, …; data-map `src:security`/`ds:security`; AI path
`/security/…`). **Kept as МВР (the ministry, unchanged):** `MvrPack`, `useMvr`, `MvrUnitAgg`, `MVR_EIK`,
`MVR_ENTITIES`, `MEDICAL_INSTITUTE_EIK`, `MVR_BUDGET_NODE`. **Kept as `police`:** the `police` **universe
value** (a real sub-group — ГДНП/ОДМВР — distinct from border/fire) and its "Полиция" universe label; the
`eurostat_road_safety` watcher + `road_safety.json` filename (road safety, not a police concept). Note:
"Сигурност" sits inside the cluster "Сигурност и правосъдие", so it reads slightly redundant — kept per
the rename request; easy to switch to "Вътрешна сигурност" / "Обществен ред" if preferred.

**Per-structure marker map — SHIPPED (2026-07-16, uncommitted).** The §7 geographic layer now has a
second, per-STRUCTURE view alongside the per-oblast €/capita choropleth: `MvrDirectorateMap`
(`src/screens/components/procurement/security/MvrDirectorateMap.tsx`) — one marker per CITY (the 28
областни центрове + София's central bodies), coloured by each structure's ЗОП spend (slate sequential
ramp) OR single-bid share (risk ramp, metric toggle), badged with its contract count, each linking to
`/awarder/:eik`; София (24 bodies) + every oblast capital (ОДМВР + РДПБЗН) open the shared
`SectorPointMap` paginating popup. Mirrors the /judiciary court-load map end-to-end:
- **Serving:** `mvr_directorate_map(p_eiks, p_from, p_to)` (schema `074_mvr_directorate_map.sql`) folds the
  LIVE contracts corpus per structure onto a tiny static geo crosswalk `mvr_directorate_geo` (loaded by
  `scripts/db/load_mvr_directorate_map_pg.ts` via EIK → `awarder_seats` seat ekatte → `settlements.json`
  centroid, with an entity-name fallback — awarder_seats resolves only 53/74, so the ~21 regional
  directorates geocode by their oblast-capital name — for **74/74 geolocated, 0 dropped**). No new ingest.
  EXPLAIN ANALYZE: **5.3 ms warm**, `idx_contracts_awarder` bitmap scan. Route `mvr-directorate-map` in
  `functions/db_routes.js` (`missingMigrationEmpty`); hook `useMvrDirectorateMap` (mirrors
  `useAwarderGroupModel`'s scope window, so it stays scope-restricted like the rest of the pack); mounted
  at the **top** of `MvrPack` (the house convention for sector maps, cf. `NzokPack`), and passes an
  `openLabel` ("Виж структурата") to the shared `SectorPointMap` popup. Verified live on
  `/sector/security?pscope=all` (27 city markers, both ramps, toggle, scope windowing 74→58 for y:2024);
  `tsc` + `eslint` clean. **NOT deployed** — needs `074` applied to Cloud SQL
  + `db:load:mvr-directorate-map:pg:cloud` + `firebase deploy --only functions:db` (separate step).

**Still deferred (genuinely blocked / low-value):** `db:gen-sector-stats` (needs live PG — hub € badge
only; the dashboard reads the runtime API); §7a #2–#4 outcomes (fire incidents, crime-clearance rate,
border apprehensions — each a further ingest); a bespoke `/police` vanity route (the pack on
`/sector/security` already delivers the full Phase-3 experience, so a separate screen adds no value);
the browse-pack `Section` enrichment strip (filter-only for now).

---

## Audit rev 1.1 (2026-07-15) — verified against current code

Every load-bearing claim below was checked against the live repo before commit. Results:

1. **Machinery all confirmed present.** `assertAllSectorsHavePrerenderCopy` + `SECTOR_PAGES`
   (`scripts/prerender/routes.ts:477,778`) — the build guard is real, so `police` SEO copy is
   **required**. `SECTOR_EIKS` map (`sector_stats.ts:67`, imports `DEFENSE_SECTOR_EIKS`/`TOURISM_SECTOR_EIKS`
   the exact way the plan copies). `SECTOR_SCENES: Record<string, FC>` (`sectorScenes.tsx:740`, keyed
   `defense`/`justice`/`tourism`) — add `police: Police`. `StatCard`, `PackSection`, `packInsights`,
   `defenseAttributes` all present. Crime/population data files all exist: `data/regional.json` (theft),
   `data/macro.json` (homicide), `data/grao_population.json` (per-capita denominator).

2. **BONUS — the МВР budget node is ALREADY wired.** `data/budget/ministries/admin-ministerstvo-na-vatreshnite-raboti.json`
   exists with `{ eik, nameBg, nameEn, nodeId, procurement, years }` — a real budget series, same shape
   as the МО node. So the iceberg/budget-bridge tile (§7 tile 2) needs **no new ingest** — the МВР
   budget-node id is **`admin-ministerstvo-na-vatreshnite-raboti`** (mirror of
   `MO_BUDGET_NODE = "admin-ministerstvo-na-otbranata"`). Resolves the §9 "confirm budget node" TODO and
   §10 decision 6's data dependency (the budget SERIES is there; only the "total vs salary-line" headline
   framing still needs a Budget-Law-annex sanity check).

3. **CORRECTION — clone paths are `.tsx`, not `.ts`.** The defense hook lives at
   `src/data/procurement/useDefense.tsx` (exports `useDefense`, `useDefenseGroupRollup`, `type ScopeWindow`)
   — NOT `.ts`. So Phase 2 clones to `src/data/procurement/useMvr.tsx`. (`defenseAttributes.ts` IS `.ts`.)

4. **МВР group size CONFIRMED — 28 ОДМВР.** `grep -rl "Областна дирекция на МВР"` returns exactly **28**
   awarder files (all 28 oblasts present in the corpus, EIK range `129009735`–`129010004`); the §1 note
   that "6 surface under name variants" was over-cautious — the count is complete. Still pin each EIK
   into the allowlist from the corpus rather than transcribing, but there is no missing-oblast gap.
   ~28 РДПБЗН confirmed likewise. Group EIK count ≈ **71** stands.

5. **No server/SQL/route change for Phase 1 CONFIRMED** — `awarder_eik` is a whitelisted `filter:"in"`
   column and `awarder-group-model` accepts any `/^\d{9,13}$/` set `.slice(0,300)`; a ~71-EIK МВР set
   passes. Sitemap derives slugs from `SECTOR_DASHBOARD_IDS` (no edit).

**Net: the plan is sound as written. Two path fixes applied (budget node id filled, `useMvr.tsx`), one
TODO closed (budget node exists). Phase-1 surface unchanged: ~8 edits + 1 new allowlist file, no
server/SQL/route change.**

### Audit rev 1.2 (2026-07-15) — §10.6 open item RESOLVED (budget headline)

Inspected the actual `years` series in the МВР budget node. **The "total budget vs salary line"
conflation is a non-issue for us** — the node carries the authoritative **State Budget Law total
expenditure** (планирани разходи по ЗДБ, `years[].expenditure.amountEur`), broken down by **policy
area**, not by economic type. So we never touch a press number:

| Fiscal year | МВР total budget (разходи, ЗДБ) | Fiscal year | МВР total budget |
|---|---:|---|---:|
| 2018 | €662.8M | 2022 | €1,053.4M |
| 2019 | €774.5M | 2023 | €1,230.8M |
| 2020 | €853.6M | 2024 | €1,414.9M |
| 2021 | €997.2M | **2025** | **€2,114.5M** |

The 4 policy programs per year (share of the 2025 total): противодействие на престъпността и обществен
ред €1,273M (60%) · пожарна безопасност и защита €347M (16%) · защита на границите и миграция €330M
(16%) · управление и развитие на системата €164M (8%). The 2025 jump (€1.41bn→€2.11bn) is the
security-sector wage indexation — real and in our data.

**RESOLUTION (implements the user's steer "display the larger amount"):**
- The iceberg tile's "whole budget" bar = **`years[].expenditure.amountEur`** — the **total** МВР budget
  (the larger figure), authoritative from the State Budget Law, **already ingested**. No Budget-Law-annex
  lookup needed; no salary-line dependency.
- The **~92% personnel / ~1% capital** decomposition is NOT in this node (it's by policy, not by §01
  заплати / §52 капитал). Render it as a **sourced context annotation** on the tile (`◇ context —
  програмен отчет / Сметна палата`, 2025 салдо ≈ 3.82bn лв заплати of 4.14bn лв, ~92%; capital ≈ 55M лв
  / €28M), NOT as a competing headline. If a clean economic-type split is wanted as data later, it comes
  from the МВР program-budget **execution report** (`mvr.bg/budjet`), a separate small ingest — deferred.
- The iceberg's "visible tip" = the group's annual procurement (~€1.84bn ÷ ~15yr ≈ **€123M/yr**), i.e.
  ~**6% of one year's МВР budget** — the headline gap number, computed from data we already have.

§10.6 is now **CLOSED**. §7 tile 2 and §8 are updated below to match.

### Audit rev 1.3 (2026-07-15) — outcomes data honestly scoped

Checked the indicator codes actually present. **Correction to an earlier overstatement:** the free
outcomes layer is thin — `data/regional.json` has **`theftRate`** per oblast (the only per-oblast crime
indicator) and `data/macro.json` has **`intentionalHomicideRate`** + **`prisonPopulationRate`**
national-only. Fire/rescue, road-safety/traffic deaths, crime-clearance, crime-by-type and
border/migration outcomes are **NOT ingested**. Phases 1–2 need none of it (pure money); a genuine
Phase-3 outcomes pairing needs new ingest — now scoped and ranked in **§7a**. The `crim_off_cat`/
`crim_pris_age` Eurostat codes named in §2 resolve to those two national series only, NOT a per-oblast
crime layer.

---

### Audit rev 1.4 (2026-07-15) — re-audit for the UX pass; reusable primitives confirmed

Re-verified the plan against code while adding the UI/UX section (§7b). Findings — every world-class
recommendation maps onto an **existing reusable house component**, so the UX ambition is cheap:

1. **`OblastChoropleth` is a shared, reusable component** (`src/screens/components/procurement/OblastChoropleth.tsx`),
   already consumed by `CultureOblastMapTile` and the procurement-by-oblast views with a per-sector color
   ramp, **a `count ⇄ perCapita` metric toggle**, click-to-filter, and the "pair the map with a ranked
   bar list" convention. So the §7 tile-7 per-oblast €/capita map is a **config of an existing tile**, not
   new Leaflet work — `MvrOblastMapTile` just needs a police-slate ramp + the 28-ОДМВР data.
2. **Per-capita is already wired** — `fetchPopulation` + `provinceToCanon` in `useProcurementByOblast`
   feed the choropleth's per-capita metric. The per-capita denominator (the research's #1 normalization)
   needs no new ingest. This makes the per-oblast €/capita tile shippable as early as **Phase 2**, not 3.
3. **Provenance is an inline `Източник: …` convention**, not a component (`CultureScreen.tsx:233`,
   `CultureGrantsTile.tsx:99`). §7b's provenance chips follow that convention; the "modeled vs reported"
   distinction is a new (small) visual treatment, not a new system.
4. **The hero precedent is `CultureScaleTile`** (magnitude bars as a "scale anchor") — but note it uses
   INDEPENDENT bars *because its streams don't partition one budget*. МВР's budget DOES partition (salaries
   + capital + other + procurement sum to the total), so the iceberg is correctly a **stacked/part-to-whole**,
   not independent bars (§7b hero). Good precedent, opposite chart choice — documented so it isn't miscopied.
5. `StatCard` (drill-down `to`/`seeMoreTo`, `hint`, `bodyMaxHeight` scroll cap) and `PackSection` (stacked
   bands, `note` header chip, `id` deep-link anchor) are the confirmed tile/band primitives — the §7b IA
   maps onto them 1:1. All rev 1.1–1.3 findings still stand.

---

> All corpus figures below are **MEASURED** from `data/procurement/awarders/<eik>.json` (rebuilt through
> the 2026-07-14 ingest). €m = per-row `amountEur`, the PG basis. Budget / personnel-share / crime /
> per-capita figures are **EXTERNAL** (State Budget Law, НСИ, Eurostat) and MUST carry a source chip and
> stay clearly separated from the measured ЗОП money (see §8).

---

## 1. Goal & thesis

Give the **Ministry of Interior (Министерство на вътрешните работи, МВР, ЕИК 000695235)** — Bulgaria's
police, border, fire and civil-protection apparatus — a proper sector dashboard at `/sector/security`
(Phase 1) and, if warranted, a bespoke `/police` screen (Phase 2), consistent with the other
government-entity dashboards.

The thesis is the differentiator, and it is unusually strong here:

> **МВР spends ~€2.1–2.5bn every single year — but almost none of it is visible.**
> ~85–90% is payroll (invisible by nature), capital is a rounding error (~€28M/yr), and a further
> slice is legally exempt from the open register (класифицирани поръчки, ЗОП Част четвърта / чл. 13 /
> чл. 149). Our whole visible corpus (~€1.84bn cumulative 2011–2026) is **less than one year** of
> МВР's budget. The dashboard's job is to show **the tip of the iceberg honestly — and name the part
> that's underwater.**

This is the exact structural analogue of the defense pack's headline ("sustainment is visible,
acquisition is not — F-16/Stryker go through US FMS and never hit the corpus"). For МВР the invisible
half is **payroll + security-exempt buys** (ГДБОП surveillance/СРС, border-surveillance tech,
чл. 346(1)(б) ДФЕС national-security carve-outs). Making that gap legible is the "world's best" move —
no Bulgarian portal shows it.

### Measured shape of the corpus (why МВР is a top-tier security sector)

МВР is a **multi-EIK group** on the scale of defense — ~€1.84bn cumulative across **~71 budget units**.
The heavyweight units (measured lifetime `totalEur`, awarders corpus):

| Unit | EIK | € (lifetime) | What it buys |
|---|---|---:|---|
| **Министерство на вътрешните работи** (централа) | `000695235` | **€665.1M** · 972 contracts · 379 suppliers | central buys: vehicles, uniforms, IT, weapons/ammo |
| **ГД „Гранична полиция"** (ГДГП) | `129010125` | **€330.1M** | border surveillance, thermal/radar, patrol vehicles/vessels, fence tech |
| **ДУССД** (собственост, логистика, соц. дейности) | `129010157` | **€291.3M** | buildings, fuel, fleet, food, energy — the central logistics arm |
| **Медицински институт на МВР** | `129007218` | **€161.4M** | a full hospital — drugs, consumables, medical equipment |
| **ГД „Пожарна безопасност и защита на населението"** (ГДПБЗН) | `129010164` | **€151.1M** | fire trucks, rescue gear, disaster/civil-protection equipment |
| Дирекция „Международни проекти" | `129010068` | €38.6M | EU-funded projects (border/migration external money) |
| Академия на МВР | `129001232` | €32.2M | training facility — construction, catering, education |
| Дирекция „Миграция" (two EIKs) | `129010666` + `129010050` | €30.8M + €6.2M | detention/reception centres (СДВНЧ), catering, facilities |
| ГД „Борба с организираната престъпност" (ГДБОП, two EIKs) | `129010659` + `129010043` | €13.5M + €0.1M | surveillance/СРС, cyber, covert equipment — **most exempt-prone** |
| Столична дирекция на вътрешните работи (СДВР) | `129009938` | €12.0M | Sofia city police |
| ГД „Национална полиция" (ГДНП, two EIKs) | `129010641` + `129010513` | €10.5M + €0.1M | forensics, case systems, КАТ traffic, general policing |
| ГД „Жандармерия, спец. операции и борба с тероризма" | `129011017` | €10.0M | riot/tactical gear, armoured vehicles |
| ГД „Криминална полиция" | `129010082` | €0.3M | (surprisingly small — most crime-police buys route via ГДНП/МВР) |
| Специална куриерска служба (two EIKs) | `129010673` + `831616418` | €0.03M + €0.2M | classified-mail courier |
| **28 × Областни дирекции (ОДМВР)** | `1290097xx`–`1290100xx` | ~€70M combined | regional police — local fuel, maintenance, utilities (per-oblast map) |
| **28 × Регионални дирекции ПБЗН (РДПБЗН)** | `1290107xx`–`1290109xx` | ~€12M combined | regional fire directorates |

> Group total ≈ **€1.84bn** (measured sum of the units above; a handful of ОДМВР — Русе, Стара Загора,
> Сливен, Шумен, Перник, Кюстендил — surface under name variants and lift the ОДМВР line further).
> This puts МВР alongside МО as the second pillar of the `sectors_cluster_security` cluster.

**Two immediate consequences for the design (both have defense precedent):**
1. **The Медицински институт (€161M, ~9% of the group) is a health confound** — it buys drugs and
   hospital consumables, exactly like ВМА is ~47% of the МО group. Any "what МВР buys" tile that folds
   the whole group must be **segmentable by universe** or it reads as medicines. Copy the
   `DEFENSE_UNIVERSES` + universe-`Select` pattern verbatim.
2. **Alias-merge is real** — Дирекция Миграция, ГДНП, ГДБОП and Спец. куриерска служба each appear under
   **two EIKs** in the corpus. Curate by an **EIK allowlist, never a name regex** (§3), and fold the
   alias pairs to one canonical entity.

---

## 2. What ALREADY exists (do NOT rebuild)

This is a **presentation + config** project first, then an optional bespoke pack. The machinery is shipped:

- **The awarder records** — every МВР EIK is already served at `/awarder/<eik>` with `byYear`,
  `byContractor`, `topContracts`. The generic dashboard rolls the group up automatically via
  `useAwarderGroupModel` → the server-side `awarder_group_model` SQL fn (see
  `reference_awarder_group_model` — folds the whole EIK-set server-side, no client fan-out).
- **Generic sector dashboard** — `src/screens/sector/SectorDashboardScreen.tsx` (`/sector/:id`),
  config in `src/screens/sector/sectorDashboards.ts`. Adding a sector = a config object; a KPI row +
  spend-by-year + top-contractors + awarders tile render with **no new screen file**. Multi-EIK
  `members` fold into the KPI rollup exactly as energy's 9-EIK group does.
- **Sector-pack seam** — `SECTOR_BROWSE_PACKS`/`getSectorPack` in
  `src/screens/components/procurement/sectorPacks.tsx`. A bespoke pack (like `DefensePack`) is a
  lazily-loaded component keyed by the lead EIK, rendered on the sector dashboard when registered.
- **Sector hub + registry** — `src/screens/governance/sectorRegistry.ts` (`SECTOR_CLUSTERS`),
  `GovernanceSectorsScreen`, `sectorScenes.tsx`. A new sector appears in nav automatically once in the
  registry.
- **Date scoping** — `src/data/scope/` (`useScope`, `useScopeWindow`, `scopeRange`) + the shared
  `ScopeControl` pill. `SectorDashboardScreen` already renders it, so МВР inherits `?pscope` for free
  (§5). The `DefensePack` shows the controlled `scopeWindow` variant if a bespoke pack re-anchors KPIs.
- **Server allow-list is already open** — `functions/db_table.js` whitelists the `awarder_eik` COLUMN
  with `filter:"in"` (values are not enumerated); `awarder-group-model` (`db_routes.js`) parses `eiks`
  as `/^\d{9,13}$/`, `.slice(0,300)`. A ~71-EIK МВР set passes with **no Functions/SQL change**.
- **Budget bridge data** — `data/budget/ministries/<id>.json` (written by `update-budget`) already
  carries the МВР budget series; the defense pack's `DefenseBudgetBridgeTile` reads the МО node the same
  way. The МВР node id needs confirming (mirror `MO_BUDGET_NODE = "admin-ministerstvo-na-otbranata"`).
- **Sector-tile € on the hub** — `scripts/db/gen_procurement/sector_stats.ts` (`SECTOR_EIKS` map) →
  `data/procurement/derived/sector_stats.json`, precomputed per scope, bucket-synced.
- **A PARTIAL crime layer is already ingested** (verified 2026-07-15, Audit rev 1.3 — do not overstate):
  `data/regional.json` carries **`theftRate`** (recorded theft per 100k) **per oblast** — the only
  per-oblast crime indicator; `data/macro.json` carries **`intentionalHomicideRate`** + **`prisonPopulationRate`**
  **national only**. That is the whole free outcomes layer. Fire/rescue, road-safety/traffic deaths,
  crime-clearance (разкриваемост), crime-by-type and border/migration outcomes are **NOT ingested** — a
  genuine outcomes pairing needs new ingest (see §7a). Phases 1–2 need none of this (pure money).

### Not built (this plan's work)

- A curated `SECURITY_SECTOR_EIKS` allowlist with per-unit universe tags (§3) — the one load-bearing new
  data artifact.
- Config wiring: `sectorDashboards.ts`, `sectorRegistry.ts`, `sectorScenes.tsx`, `sectorPacks.tsx`,
  i18n keys, `sector_stats.ts`, `scripts/prerender/routes.ts` SEO copy.
- (Phase 2) A bespoke `MvrPack` (clone `DefensePack`) with the universe segmentation, budget bridge,
  competition heatmap, transparency tile, and the МВР-specific tiles (§7).
- (Phase 3, optional) A bespoke `/police` screen with the crime-context / per-oblast map layer.

---

## 3. МВР as an EIK set — the allowlist (curate by EIK, NEVER by name)

Linkage to a sector in this repo is a **curated buyer-EIK allowlist**, never a CPV or keyword
classifier. МВР is the textbook reason why: `defenseReferenceData.ts` already warns that the `1290*`
EIK prefix is *"the whole security-services range (mostly МВР)"* and that a name sweep false-positives
badly ("7-МО Основно училище" matches "МО"). For МВР specifically:

**Anti-allowlist — do NOT sweep in by name:**
- `Средно/Основно училище …` and `Спортно училище …` (municipal schools, principal = МОН) — never МВР.
- ДАНС (`129009710`), ДАТО (`129010090`) — separate security agencies, **not** МВР budget units.
- ЦППКОП (`176073030`, "Център за превенция… корупцията", към МС) — a Council-of-Ministers body, not МВР.
- The town of names / academies that share the `129*` prefix but belong to МО (military academies).

**Universe segmentation** (mirror `DefenseUniverse` — every group tile is labelled with which it covers,
and a `Select` lets the reader isolate one or drop the health confound):

| Universe | Label (bg / en) | Members |
|---|---|---|
| `ministry` | Министерство (централа) / Ministry (HQ) | `000695235` |
| `police` | Полиция / Police | ГДНП, СДВР, 28× ОДМВР, ГД Криминална полиция, ГДБОП, Жандармерия |
| `border` | Гранична полиция / Border police | ГДГП `129010125` |
| `fire` | Пожарна и защита / Fire & civil protection | ГДПБЗН `129010164` + 28× РДПБЗН |
| `migration` | Миграция / Migration | Дирекция Миграция (`129010666` + `129010050`) |
| `health` | Здравеопазване (Мед. институт) / Health (Medical Institute) | `129007218` — **the confound** |
| `logistics` | Собственост и обучение / Estate & training | ДУССД, Академия, Международни проекти, СКС |

Ship the allowlist in `src/lib/securityReferenceData.ts` (mirror `defenseReferenceData.ts`): one row per
distinct EIK with `{ eik, name, universe }`, `MVR_EIK`, `MEDICAL_INSTITUTE_EIK` (the ВМА analogue),
`SECURITY_SECTOR_EIKS`, `SECURITY_ALIAS_EIKS`, `SECURITY_UNIVERSES`, `universeOf`, `universeLabel`.

**Tier verification before ship:** the 28 ОДМВР + 28 РДПБЗН + ~15 central units are all EIK-verified
from the corpus (§1). Re-run the corpus scan for the 6 ОДМВР that surfaced only under name variants
(Русе, Стара Загора, Сливен, Шумен, Перник, Кюстендил) and pin their EIKs before finalizing the list.

---

## 4. Architecture — three-phase, generic first (defense playbook)

### Phase 1 — generic `/sector/security` (cheapest real-data ship)

Add config; no new screen. Delivers the real ~€1.84bn group dashboard with date scoping and the
per-unit awarders tile today.

1. `src/lib/securityReferenceData.ts` — the allowlist (§3). The one load-bearing new artifact.
2. `src/screens/sector/sectorDashboards.ts` — add `SECTOR_DASHBOARDS.police`
   (`leadEik: MVR_EIK`, `members` = the full group with `group` tags, `browsePackId: "police"`,
   `agency: "МВР"`, `titleKey/descKey`). The multi-EIK `members` array folds every unit into the KPI
   rollup exactly like `energy`.
3. `src/screens/components/procurement/sectorPacks.tsx` — add `police` to `SECTOR_BROWSE_PACKS`
   (`eiks: SECURITY_SECTOR_EIKS`). Enables `?sector=police` on `/procurement/contracts|tenders`. No server change.
4. `src/screens/governance/sectorRegistry.ts` — add a `Sector` entry to `sectors_cluster_security`
   (next to defense/justice): `id: "police"`, `to: "/sector/security"`, `agency: "МВР"`, a new accent
   token (§10 decision 3).
5. `src/screens/governance/sectorScenes.tsx` — a `police` SVG scene (shield / badge + bars, reusing the
   scene primitives; a slate-blue shield reads distinctly from МО's green).
6. `scripts/db/gen_procurement/sector_stats.ts` — add `police: SECURITY_SECTOR_EIKS` to `SECTOR_EIKS`;
   rerun `db:gen-sector-stats` (needs live PG) → hub tile € populates per `?pscope`. Non-blocking: the
   dashboard KPIs come from the runtime `awarder-group-model` call; only the hub badge waits.
7. i18n — `sector_police_title` / `sector_police_desc` in `src/locales/{en,bg}/translation.json`.
8. `scripts/prerender/routes.ts` — add `police` SEO copy to `SECTOR_PAGES` (the build-time guard
   `assertAllSectorsHavePrerenderCopy` fails prerender otherwise). Sitemap needs no edit (derives slugs
   from `SECTOR_DASHBOARD_IDS`).

### Phase 2 — bespoke `MvrPack` (the defense-parity story, still no new ingest)

Clone `DefensePack` end-to-end — it is a near-exact structural twin (multi-EIK security group + health
confound + budget bridge + competition heatmap + transparency gap). Register it under `MVR_EIK` in
`PACKS`. Wire `SECTOR_DASHBOARDS.police.ThematicTiles` OR (better) let `getSectorPack(leadEik)` return
`MvrPack` so it becomes the whole content (the defense path). Files (mirror `defense/`):

- `src/screens/components/procurement/security/MvrPack.tsx` — universe `Select` + the tile stack.
- `MvrBudgetBridgeTile.tsx` — the iceberg (visible procurement vs total МВР budget vs personnel share).
- `MvrCategoryTile.tsx` — what МВР buys by operating function (reuse the CPV→category classifier idea).
- `MvrCompetitionTile.tsx` — single-bid share **by unit** (the 28 ОДМВР make a great small-multiples heatmap).
- `MvrTransparencyTile.tsx` — the security-exemption gap narrative (§7 tile 8).
- `src/data/procurement/useMvr.tsx` + `src/lib/securityAttributes.ts` — clone `useDefense.tsx` / `defenseAttributes.ts`.

No new data ingest — renders off the existing corpus + the already-ingested МВР budget node.

### Phase 3 (optional) — bespoke `/police` screen with crime + per-oblast layer

Only warranted once the spend-vs-crime overlay proves out. Starts on the **thin existing layer** —
`data/regional.json` (per-oblast theft rate) + `data/macro.json` (national homicide, prisoners) — then
grows via the **§7a outcomes ingest** (road-safety deaths, fires, clearance rate, border apprehensions),
which is mostly NEW ingest, not existing data. A Leaflet oblast choropleth of €/capita police spend
(28 ОДМВР) vs recorded crime is the signature Phase-3 visual. Clone the Culture or Water bespoke-screen
vertical for the shell.

---

## 5. Date scoping — the explicit requirement (identical to every other sector)

Reuse `src/data/scope/` unchanged. `Scope = "ns" | "all" | "y:<year>"`:

- **`ns`** (default, omitted from URL) — the selected parliament's contract window
  `[selected election, next election)`.
- **`all`** — `?pscope=all` — full corpus (null, null).
- **`y:<year>`** — `?pscope=y:2024` — one calendar year; `[Y-01-01, (Y+1)-01-01)` half-open.

`SCOPE_FIRST_YEAR = 2011` is the picker floor; МВР's corpus starts 2011 so no empty early years. The
generic dashboard already renders `<ScopeControl mode="toggle" />` and reads the URL-backed hook — МВР
inherits `?pscope` with zero new code. A bespoke `MvrPack` uses the controlled `scopeWindow` variant
(as `DefensePack` does) so it can re-anchor KPIs to a picked year while keeping the spend-by-year
time-spine full-history.

**Half-open caveat (confirmed bug elsewhere — do not repeat):** if a Phase-2 tile drives a DB fetch via
`scopeRange` (inclusive `to=YYYY-12-31`) against the half-open group-rollup SQL, Dec-31 contracts drop
silently. Normalize `y:` to `to=(Y+1)-01-01` for any DB-backed scoped tile (see `transport-view-v1.md`
audit item 4 and `reference_pg_sargable_windows`).

---

## 6. Competitive research — world-class police / interior transparency dashboards

Benchmarks surveyed (2026-07):

| Source | What's world-class | Adopt for МВР |
|---|---|---|
| **Vera Institute — "What Policing Costs in America's Biggest Cities"** ([vera.org](https://www.vera.org/publications/what-policing-costs-in-americas-biggest-cities)) | The gold standard. Four canonical ratios, not raw totals: total budget · **% of city funds on police** · **$ per resident** · **police-employees per resident**. Sortable, per-city drill-down, "what-if" re-allocation calculator. | The per-oblast €/capita tile + the personnel-share framing come straight from here. |
| **Vera — Police Data Transparency Index** ([policetransparency.vera.org](https://policetransparency.vera.org/)) | Scores *how transparent* each department is — meta-transparency. | A per-unit "how much do we even see" scorecard for the ГДБОП/ГДГП exempt units. |
| **data.police.uk** ([data.police.uk](https://data.police.uk/)) | Best open-data plumbing: street-level crime + outcomes + stop-and-search as clean CSV/API per force. | The crime-context layer to pair with spend (Phase 3). |
| **UK Home Office police-funding tables** ([gov.uk](https://www.gov.uk/government/statistics/police-funding-for-england-and-wales-2015-to-2026)) | Clean multi-year per-force funding time series. | Template for the МВР multi-year funding trend + the budget bridge. |
| **USASpending.gov — DOJ / COPS grants** ([usaspending.gov](https://www.usaspending.gov/agency/department-of-justice)) | Award-level explorer, national→recipient drill-down. | The award-level drill-down UX (our `/awarder/:eik` + contracts browser already do this). |
| **Transparency Int'l — Government Defence Integrity Index & "Arresting Corruption in the Police"** ([ti-defence.org/gdi](https://ti-defence.org/gdi/)) | Scores procurement + financial corruption-risk controls; extends the defense integrity frame to policing. | The qualitative integrity-risk framing for the security-exemption tile. |
| **Statewatch / TNI — "At what cost? Funding the EU's security, defence and border policies"** ([statewatch.org](https://statewatch.org/publications/reports-and-books/at-what-cost-funding-the-eu-s-security-defence-and-border-policies-2021-2027/)) | Civil-society tracking of ballooning border budgets (Frontex €5.6bn 2021–27) where "oversight is sorely lacking" and surveillance/lethal-tech spend hides behind confidentiality. | Direct EU peer for the Гранична полиция surveillance-opacity angle — positions Наясно alongside Statewatch. |

**What makes them world-class (the pattern to steal):** (1) a few canonical, **comparable ratios**
(per-capita, %-of-budget) not raw totals; (2) per-capita normalization so a small oblast is comparable
to Sofia; (3) drill-down national→unit→award; (4) spend paired with **outcomes** (crime, fire response);
(5) an explicit **transparency-of-the-transparency** layer that says what it can't see.

**Bulgaria specifics (sourced):**
- МВР budget **~€2.1–2.5bn/yr**; **2025 personnel jumped +50.5%** (2.54bn→3.82bn лв) on the security-
  sector auto-indexation; МВР+МО personnel = **49% of ALL state personnel spending**; **2025 capital
  only ~55M лв (~€28M)**. Primary source: the State Budget Law annex + the МВР program-budget execution
  report ([mvr.bg/budjet](https://www.mvr.bg/programni-dokumenti-otcheti-analizi/budjet-fin-otcheti)).
  ⚠ Press conflates "total budget" with the salary line (they're nearly equal) — pin the headline
  against the Budget Law annex, not press.
- **Security-exemption opacity:** ЗОП Част четвърта (отбрана и сигурност), чл. 149 (класифицирана
  информация / negotiated procedures), and чл. 13 (full carve-out via чл. 346(1)(б) ДФЕС) let МВР award
  contracts that need not appear in the open register. **No official aggregate exists — that opacity is
  the point** and should be stated plainly. Lex.bg documented millions in contracts routed to secretly-
  chosen contractors through these exemptions.
- **Real scandal hooks (all measurable / reportable):** ~1,200 patrol cars + motorcycles for >126M лв
  (Road-Safety-Fund financed); **681 Škoda Kodiaq 4×4 for €33.44M** signed last-minute; a Court-of-Audit
  finding that **54% (67.3M лв) of road-safety money went to general-policing cars**, with €1.3M of
  vehicles **rusting unused in a garage**; a **110M лв МВР tender nobody bid on** (single-supplier red flag).

**Canonical police/interior KPIs** (ranked by distinctiveness + defensibility for our angle):
1. **Personnel share of budget (~85–90%)** — the single most striking fully-sourced number; frames why
   procurement is only the tip.
2. **Spend per capita** — €/resident national and per-oblast (28 ОДМВР); Vera's flagship metric.
3. **The visible-vs-total gap ("iceberg")** — ~€1.84bn/15yr visible vs ~€25–30bn/15yr total. Our
   differentiator; nobody in BG shows this.
4. **Fleet / vehicle spend** — patrol cars are the most-covered, most-scandal-prone, cleanly-visible line.
5. Fuel spend (per-ОДМВР, operational-tempo proxy) · border-surveillance tech spend (visible ГДГП vs the
   exempt gap) · IT/surveillance spend (ГДБОП, "what we can and can't see") · per-oblast crime-rate
   context · fire-response context (ГДПБЗН) · € per officer · single-bid & repeat-supplier flags.

---

## 7. The dashboard design — tile by tile (the "world's best" МВР view)

House grammar: single vertical stack, **no tabs** (dashboard tiles / stacked sections only). Every
external tile carries a **provenance chip**: `● real` (green — OCDS/data.egov.bg, measured) vs
`◆ budget` (State Budget Law) vs `◇ context` (НСИ/Eurostat). Nothing modeled is shown as official.

`Title → SectorBreadcrumb → ScopeControl → universe Select → KPI row → tiles → per-unit awarders bridge → source footnote`

1. **KPI scorecard** (`StatCard` row, scope + universe aware, REAL): Договорено ЗОП · Договори ·
   Изпълнители · Структури с договори (units-with-contracts, like defense) · От което Мед. институт %
   (the health-confound caveat, mirrors "Of which ВМА").
2. **Айсбергът — видимо срещу общо** (the budget bridge / iceberg — the signature tile): the whole bar =
   one year of МВР **total budget** (`years[].expenditure.amountEur`, ЗДБ — 2025 = €2.11bn, the
   authoritative larger figure, already ingested), with the group's annual open procurement (~€123M/yr,
   ~6%) highlighted as the thin visible tip. A sourced context annotation states the ~92% personnel /
   ~1% capital split (execution report, not this node — see Audit rev 1.2). This is the defense
   `BudgetBridgeTile` generalized to the payroll story. `◆ budget` for the total, `◇ context` for the
   personnel split. **Chart form: exploded stacked bar (overview + 20× magnified sliver), waffle alternate
   — see §7b.B for the full hero spec.**
3. **Разход по години** (spend-by-year columns, REAL, hand-rolled CSS bars): active `?pscope` window
   highlighted; the free `SectorSpendByYearTile` already ships this.
4. **Разход по функция** (what МВР buys — vehicles/fuel/uniforms/IT/border-tech/medical/construction;
   CPV-classified, marked as a classification not an official taxonomy). Universe-segmentable so
   "health" doesn't dominate. `● real`.
5. **Пазар на изпълнителите (HHI)** (contractor concentration — reuse `VikContractorHhiTile` as the
   defense pack does). `● real`.
6. **Конкуренция по структура** (single-bid share **by unit** — the 28 ОДМВР + border + fire as a
   small-multiples heatmap; surfaces the 110M-лв-no-bidder pattern). Reuse `DefenseCompetitionTile`.
7. **€ на глава по области** (per-oblast €/capita choropleth — 28 ОДМВР ÷ population; Vera's flagship
   metric). Reuses the shared **`OblastChoropleth`** with its built-in `count⇄perCapita` toggle
   (`fetchPopulation` already wired) + ranked bar list + click-to-filter — a config, not new Leaflet work,
   so it can land as early as **Phase 2** (Audit rev 1.4 §1–2). Slate sequential ramp, quantile-classed
   (§7b.D). `● real ÷ context`.
8. **Прозрачност — какво НЕ виждаме** (the transparency gap — the differentiator): names the legal
   exemptions (ЗОП Част четвърта / чл. 13 / чл. 149), estimates the invisible share as budget-minus-
   visible, and links the real scandal hooks (patrol-car buys, the no-bidder tender). Clone
   `DefenseTransparencyTile`. `◆ budget + ◇ context`.
9. **Разход срещу престъпност** (Phase 3 — spend vs recorded crime per oblast). With TODAY's data this can
   only pair €/capita against **theft rate per oblast** (`data/regional.json`) + **national homicide**
   (`data/macro.json`) — an honest but thin start. The full outcomes pairing (traffic deaths, fires,
   clearance rate, border apprehensions) needs the §7a ingest. `◇ context`.
10. **Институции bridge** — `SectorAwardersTile` listing all ~71 units, each → `/awarder/:eik`, grouped
    by universe (police / border / fire / migration / health / logistics). The awarder pages hold each
    unit's own full ЗОП financials.

Chart forms follow the dataviz method (form before color): CSS bars for spend-by-year, category and the
iceberg (dependency-free, OG-screenshottable); the competition heatmap as CSS small-multiples; Leaflet
choropleth for per-oblast €/capita and crime (Phase 3); Recharts only if an axis-heavy YoY view is added.

---

## 7a. Outcomes ingest — what a world-class outcomes layer actually needs (Phase 3)

**Do we need to ingest outcomes (crime, fires, road deaths)?** For Phases 1–2 — **no**; they are pure
procurement + budget. For the Phase-3 "spend → outcome" pairing that makes the dashboard best-in-class —
**yes, mostly new ingest.** Audited (rev 1.3): the only outcome data we hold today is per-oblast
**theft rate** and national **homicide** + **prison** rate. Every МВР universe except general police is
outcome-blind. Ranked by narrative payoff ÷ ingest cost:

| # | Outcome dataset | Pairs with (universe / €) | Source & cost | Why it matters |
|---|---|---|---|---|
| 1 | **Road-safety / traffic deaths** (per oblast + national) | Пътна полиция / КАТ within Police; the patrol-car buys | **Eurostat `tran_sf_roadse`** (+ НСИ/КАТ regional) — cheap, fits the `update-macro`/`update-regional` pattern | The patrol-car / Road-Safety-Fund scandals are the loudest МВР procurement story; "€126M on cars → did road deaths fall?" is the killer tile. Highest payoff. |
| 2 | **Fire & rescue incidents** (fires, fire deaths, interventions; ideally per oblast) | Fire (ГДПБЗН, €151M + 28 РДПБЗН) | **НСИ** annual fire-safety / ГДПБЗН activity report — small ingest | The €151M+ fire universe is otherwise entirely outcome-blind. |
| 3 | **Recorded crime by oblast + clearance rate (разкриваемост)** | Police (28 ОДМВР, ГДНП) | **НСИ „Престъпления, обвиняеми и осъдени лица"** — moderate | Clearance rate is THE police-effectiveness metric; crime-by-type widens beyond theft-only. |
| 4 | **Border apprehensions / irregular crossings / asylum** | Border (ГДГП, €330M) + Migration | **Frontex** / **Eurostat `migr_*`** — moderate | The second-largest unit (€330M) is outcome-blind; ties border-surveillance-tech spend to interceptions. |

Recommendation: ship Phase 3 first with the **existing thin layer** (theft + homicide, honestly
labelled), then add **#1 (road-safety)** as the first new ingest — it is the cheapest and the most
on-thesis. #2–#4 follow if the outcomes view proves out. None of this blocks Phases 1–2.

## 7b. World-class UI/UX — the experience design

The tiles in §7 are *what*; this is *how it should feel*. Competitive UX study (2026-07) of the best
public-money / accountability dashboards — **Vera Institute "What Policing Costs"**
([vera.org](https://www.vera.org/publications/what-policing-costs-in-americas-biggest-cities), the single
closest analogue: policing budgets, per-capita, city-comparison table, re-allocation calculator),
**Our World in Data** (per-chart Chart/Map/Table toggle + Sources/Download drawer), **USAFacts** (source
chip on every number), **Open Contracting Partnership** procurement-viz + red-flag guidance
([open-contracting.org red-flags](https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement-1.pdf)),
**opentender.eu** / **BI ProZorro** (named analytic views, not a blank explorer; integrity indicators as
traffic-light chips), and **gov.uk** design principles ("do the hard work to make it simple"). The
takeaways below are filtered to what our stack (React SPA, hand-rolled CSS bars, Recharts, the reusable
`OblastChoropleth`, light+dark HSL tokens) can ship, and each is mapped to a house primitive.

### A. Information architecture — an explainer spine with explorer pull-outs

The two archetypes are *explainer* (narrative, citizen-first) and *explorer* (filter-heavy, analyst-first).
The best civic pages are an **explainer spine with explorer pull-outs** — and this matches the house rule
(single vertical stack, **no tabs**; `PackSection` stacked bands). Order = inverted pyramid → progressive
disclosure (the answer first, detail one interaction away, never a filter wall):

`thesis + iceberg hero → KPI strip (≤5) → budget composition → the visible slice (universe segment) →
per-oblast €/capita map → red-flags/concentration → contracts explorer (deep-linkable) → provenance footer`

Ship **4–6 named, opinionated bands** (the ProZorro "Schedules" model — "Къде отиват парите на МВР",
"Договори с една оферта", "€ на глава по области"), never a blank-canvas BI. Lead each band with the
**conclusion**, not the dataset ("92% от €2.1 млрд на МВР са заплати — само тънка ивица минава през открита
поръчка"), and prove it with the chart below.

### B. The hero moment — the iceberg (the signature visual)

The thesis is a part-to-whole where one slice (~92% salaries) dominates and the *interesting* slice
(~6%/yr procurement) is nearly invisible at true scale. That tension IS the story — design for it:

- **Form: exploded stacked bar** — one full-width 100% stacked bar of one year's budget (salaries · capital ·
  other · visible procurement), then a **broken-axis blow-up** that pulls the thin procurement sliver out at
  ~20× ("тази ивица = €123 млн/год, показана тук увеличена"). Honest at true scale, legible in the blow-up,
  pure CSS/SVG, screenshots cleanly, themes by swapping two tokens. **A 100-cell waffle** (each cell = 1% of
  budget, 92 muted + the accent cells glowing) is the alternate/secondary.
- **NOT** a pie/donut (small slices vanish when one is >80%), **NOT** a literal illustrated-iceberg PNG
  (chartjunk, won't theme or scale on mobile), **NOT** an animation that *hides* the true proportion to build
  suspense (reads as manipulation on public-money data). If animating, grow bars from 0 **once** on
  scroll-into-view, gate on `prefers-reduced-motion`, land on the honest static state.
- **Relatability anchor:** the €/citizen framing (Vera's whole hook) makes €2.1bn graspable — put "≈ €X на
  гражданин" on the hero.
- Distinct from `CultureScaleTile` (which uses *independent* magnitude bars because its streams don't
  partition one budget). МВР's budget partitions, so stacked part-to-whole is correct (Audit rev 1.4 §4).

### C. Interaction patterns

- **Universe segment + scope pill stay on the surface** — both are primary controls, never a menu. The
  universe `Select` (ministry/security/border/fire/migration/health/logistics) is the defense pattern; the
  `?pscope` pill is the shared `ScopeControl`. Keep segments ≤5 visible, plain-BG labels.
- **Every state is URL-encoded** — extend the strong house URL contract (`?elections`/`?cabinet`/`?pscope`)
  so the universe filter, map-selected oblast and scope all round-trip. This is what makes a shared link (and
  a screenshot) reproduce the exact view — a genuine differentiator most gov dashboards lack.
- **Drill-down in place, breadcrumb-preserved** — national → oblast → awarder → contract, never a modal stack
  or new tab (house rule). Every entity is a link; drilling keeps the upstream scope (reuse `useScopedHref`).
- **Filters are visible, dismissible chips** — "МВР ▸ Пловдив ▸ 2024 ✕"; never let filters silently stack into
  an empty result. **Opinionated defaults** (whole group · current parliament · per-capita) so the page
  answers before it's configured.
- **Tooltip discipline** — one richly-formatted tooltip (money + €/capita + share-of-total + `Източник`), and
  a tap/selected-state equivalent so nothing critical dies on touch.

### D. Data-viz craft (per the dataviz skill — form before color)

- **Per-oblast map = the reusable `OblastChoropleth`** with a **per-capita default** (raw⇄per-capita toggle,
  already wired via `fetchPopulation`), a **sequential single-hue police-slate ramp** (NOT rainbow, NOT
  red-green), **quantile/natural-breaks classing** into 5–6 buckets (linear flattens everything under the
  Sofia outlier), no-data oblasts hatched (not shown as zero), paired with an adjacent ranked bar list +
  click-to-filter (the established convention). Classification method named in the legend.
- **28 units = small-multiples**, shared y-scale, sorted by value (not alphabetically), the reader's oblast
  highlighted — not 28 full charts (a scroll of doom). The single-bid-by-unit heatmap (§7 tile 6) is this.
- **Red-flag chips = risk framing, never accusation** — single-bidder / repeat-winner / short-window as
  0/50/100 traffic-light chips with plain-BG hover ("само една фирма е кандидатствала — ниска конкуренция"),
  labelled "сигнал за риск / заслужава проверка". Show single-bid **share of value**, not just count (single-bid
  contracts run pricier). Concentration as a top-N Pareto/HHI (`VikContractorHhiTile` already exists).
- **Money formatting:** `tabular-nums` everywhere (columns align, digits don't jitter on hover-update); one
  abbreviation ladder — €X млрд / €X млн / €X хил. (BG memory: EUR throughout, BG separators); **no false
  precision** — hero is "€2.1 млрд", full precision only in table/tooltip.

### E. Craft details that separate world-class from average

- **States:** content-shaped **skeletons** (not spinners) matching the tile layout (no layout shift);
  **empty state** that explains why + offers an exit ("Няма договори за Пловдив + 2019 — [изчисти година]");
  **error state** with source + retry (static-JSON fetch fails shouldn't blank the tile).
- **Motion:** purposeful only (~200–400ms), `prefers-reduced-motion` gated, never on every re-render.
- **Dark/light:** semantic tokens for the iceberg's two colors so they swap per theme without touching chart
  code; keep a lightened map ramp for dark (light-tuned sequential scales go muddy on navy); desaturate the
  red-flag red on dark.
- **Accessibility:** colorblind-safe (never color as the *only* signal — pair with icon/label); a text/table
  equivalent for each chart (doubles as the screen-reader path); keyboard-navigable filters; WCAG-AA on money.
- **Provenance = credibility moat:** an inline `Източник: АОП/ЦАИС · към 2026-07` chip on every tile (house
  convention), and a clear visual distinction (dashed border / „оценка" tag) for anything **modeled/inferred**
  (the classified-spend gap, the personnel split) vs **reported** (measured ЗОП, ЗДБ budget). A competitor
  already mislabels EUR-as-лв — being scrupulous here is a differentiator.
- **Shareability:** because state is URL-encoded, generate an **OG/social card per hero tile** (iceberg,
  €/capita map, red-flag summary) off the existing prerender pipeline, stamped with the headline number +
  `Източник` + naiasno.bg watermark so a screenshot is self-attributing.

### F. Anti-patterns to avoid (explicit)

Dead KPI-tile wall (≤5 KPIs, each with a "so what" + comparison) · tab maze (house rule: stacked bands) ·
unlabeled jargon (ЦАИС/CPV glossed in hover only) · false precision (€-to-the-cent headlines) · chartjunk
(3D, decorative gradients, 12-slice pies, literal-iceberg PNG) · filter paralysis (no defaults, blank-until-
configured, silent empties) · rainbow / red-green choropleth · hover-only truth (dies on touch) ·
"корупция!" framing on statistical risk indicators (say "сигнал за риск").

### G. Fast-start UX priority (highest leverage, all adoptable now)

1. Hero = exploded stacked bar (overview + 20× sliver), CSS/SVG, two theme tokens; waffle as alternate.
2. KPI strip ≤5, each with €/capita + `Източник` chip.
3. `OblastChoropleth` per-capita default, quantile-classed, slate sequential, raw⇄per-capita toggle.
4. Red-flag chip row on contracts, "risk" framing, plain-BG hover.
5. `Източник` chip + modeled/reported distinction on every tile.
6. URL-encode hero/segment/map state → OG cards off prerender for share.
7. Named, opinionated bands (not a blank explorer).

## 8. Data honesty & provenance (non-negotiable)

- Procurement tiles: `● OCDS · data.egov.bg`, measured from the group rollup over `SECURITY_SECTOR_EIKS`.
- Budget / iceberg: `◆ Закон за държавния бюджет`, from `years[].expenditure.amountEur` in
  `data/budget/ministries/admin-ministerstvo-na-vatreshnite-raboti.json` — the authoritative **total**
  budget (2025 = €2.11bn), already ingested; no press number, no annex lookup (see Audit rev 1.2). The
  ~92% personnel / ~1% capital split is a **sourced context annotation** (`◇` — execution report), not a
  headline. The classified/exempt share is an **inferred gap** (budget − visible), never presented as a
  measured number — say so on the tile.
- Per-capita / crime / fire tiles: `◇ context — НСИ/Eurostat/ГРАО`, kept visually separate from ЗОП money.
- The header awarder card shows МВР-**proper** € (`000695235`, €665M); the group total (~€1.84bn) is a
  footnoted consolidation — the same МО-proper-vs-group precedent the defense pack footnotes.
- The Медицински институт share is stated up front (the ВМА precedent) so "what МВР buys" isn't read as
  medicines.

---

## 9. Files to touch — checklist

| Concern | File | Change |
|---|---|---|
| Buyer allowlist (+ universes) | `src/lib/securityReferenceData.ts` (new) | `MVR_EIK`, `MEDICAL_INSTITUTE_EIK`, `MVR_ENTITIES`, `SECURITY_SECTOR_EIKS`, `SECURITY_ALIAS_EIKS`, `SECURITY_UNIVERSES`, `universeOf`/`universeLabel` |
| Generic dashboard | `src/screens/sector/sectorDashboards.ts` | `SECTOR_DASHBOARDS.police` (multi-EIK `members`) |
| Browse filter | `src/screens/components/procurement/sectorPacks.tsx` | `SECTOR_BROWSE_PACKS.police` (+ register `MvrPack` under `MVR_EIK` in Phase 2) |
| Hub list | `src/screens/governance/sectorRegistry.ts` | `Sector` entry in `sectors_cluster_security` |
| Hub scene | `src/screens/governance/sectorScenes.tsx` | `police` SVG scene (shield) |
| Hub tile € | `scripts/db/gen_procurement/sector_stats.ts` | add `police` to `SECTOR_EIKS`; rerun `db:gen-sector-stats` (needs PG; hub badge only) |
| i18n | `src/locales/{en,bg}/translation.json` | `sector_police_title`/`_desc` (+ `police_nav` if Phase 2 bespoke) |
| Prerender SEO | `scripts/prerender/routes.ts` | `police` copy in `SECTOR_PAGES` (build guard requires it) |
| Accent token | `src/ux/infographic/tileAccents.ts` | add a police slate-blue (all 17 tokens are used — §10.3) |
| Server | — | none (`awarder_eik IN` already allowed) |
| Phase 2 pack | `src/screens/components/procurement/security/*`, `src/data/procurement/useMvr.tsx`, `src/lib/securityAttributes.ts` | clone `defense/*` + `useDefense.tsx` + `defenseAttributes.ts` |
| Phase 3 screen | `src/screens/security/*`, `src/routes.tsx`, per-oblast choropleth off `data/regional.json` + `grao_population.json` | clone Culture/Water shell; crime overlay |
| Budget bridge node | ✅ exists | `admin-ministerstvo-na-vatreshnite-raboti` in `data/budget/ministries/` (mirror `MO_BUDGET_NODE`) |
| AI explorer (optional) | `ai/tools/security.ts` (new) | model on `ai/tools/defense.ts` |

---

## 10. Open decisions

1. **Slug** — `/sector/security` vs `/sector/mvr` vs `/sector/interior`. Recommend **`police`** (matches
   the citizen mental model; the registry `agency: "МВР"` and title carry the acronym). Bespoke Phase-3
   vanity path `/police`.
2. **Cluster** — `sectors_cluster_security` next to defense/justice (zero new i18n keys). Decided.
3. **Accent token** — all 17 existing tokens are used (tourism took the last free slot, `aqua`). Add a
   **police slate-blue** distinct from МО's `moss` green and from the existing blues (`steel #4a7a8f`,
   `azure #3f6a8a`, `indigo #7f85a3`) — propose `slate: "#48587a"` (a darker uniform navy-slate; eyeball
   on both grounds per the `tileAccents.ts` contract before shipping).
4. **Single dashboard vs group** — ship the **full ~71-EIK group** from Phase 1 (МВР's story IS the
   group; unlike tourism it is not a single-member sector). Fold alias pairs (Миграция/ГДНП/ГДБОП/СКС) by
   EIK.
5. **Bespoke pack now or later** — the generic dashboard already tells a strong story (group KPIs +
   spend-by-year + per-unit awarders + `?pscope`). But МВР is the sector where the **bespoke pack pays
   for itself** the most (health confound needs the universe `Select`; the iceberg/transparency tiles are
   the whole thesis). Recommend Phase 1 → Phase 2 back-to-back, Phase 3 (crime layer) deferred.
6. **Budget-bridge headline** — ✅ RESOLVED (Audit rev 1.2). Display the **total** budget from the
   already-ingested budget node (`years[].expenditure.amountEur`, ЗДБ — 2025 = €2.11bn, the larger
   authoritative figure); the ~92% personnel split is sourced context, not a competing headline. No press
   number, no annex dependency.
