# Регионално развитие / МРРБ sector view — v1 plan & competitive brainstorm

Status: **NOT BUILT — plan/design only.** All figures below are **MEASURED** from the repo
(`data/procurement/derived/awarders_index.json`, `data/funds/`, `data/budget/ministries/`,
`data/cofog.json`, `data/regional.json`) as of 2026-07-16 unless marked EXTERNAL.

Closest built siblings to copy: **`transport-view-v1.md`** (an infra-cluster sector that also had
to carve a sibling — roads — out of its scope, cross-link instead of double-count; the freshest
generic-dashboard→bespoke-pack playbook), **`police-mvr-view-v1.md`** (the budget "iceberg"
bridge + EU-peer COFOG tile + per-oblast choropleth), and **`water-view-v1.md`** (the ИСУН
EU-funds spine + `OblastChoropleth` small-multiples + the `?sector=` browse pack). The **committed
`TransportPack`** (`src/screens/components/procurement/transport/`) is the near-mechanical template.

---

## 0. The one-line thesis

**МРРБ is a pass-through ministry: it controls ~€1.06bn/year but spends almost none of it through
its own tenders — the money leaves as capital transfers to municipalities, EU-cohesion
co-financing, and grants to АПИ (roads) and ВиК (water). Follow that money to where it actually
lands, per oblast, and the picture of regional (in)equality is the story nobody else tells.**

The signature contrast, measured against the corpus:

| | Figure | Source |
|---|---|---|
| МРРБ **budget** (2025 total expenditure, ЗДБ) | **€1,058.6M** | budget node `831661388` |
| МРРБ **own procurement** (all-time, PG basis) | **€100.0M / 684 contracts** | `awarders_index.json` |
| ИСУН cohesion money МРРБ programmes route to municipalities | **€1.61bn (ОПРР 14-20) + €2.47bn (РР 21-27) contracted** | `data/funds/taxonomy.json` |
| АПИ (roads, МРРБ's biggest child, **separate sector**) | **€6,332M** | `awarders_index.json` |

So МРРБ's "iceberg" is the **inverse of МВР's**: МВР's invisible money is payroll; МРРБ's is
**transfers** — money it directs but does not itself procure. The dashboard makes those transfers
legible: where does the cohesion money land, does it go to the poorest oblasts, and is the current
programme (Развитие на регионите 2021-27) absorbing or stalling.

Unlike transport (a network sector with no per-oblast split), **МРРБ has genuine oblast
geography** — the 27 областни администрации spend per-oblast, ИСУН projects are oblast-tagged, and
`data/regional.json` is NUTS3 — so the per-oblast **choropleth is a strong hero here**, not the
weak fit it was for transport.

---

## 1. Scope carve-out — the МРРБ EIK-set (roads + water EXCLUDED)

**CRITICAL constraint (mirrors transport excluding АПИ/roads):** МРРБ is the administrative parent
of two things the app **already covers as their own sectors** — АПИ roads (`/sector/roads`) and the
ВиК water holding (`/water`). The Регионално-развитие view must **NOT** roll those into its KPIs; it
**cross-links** to them instead (§4 tile 11). Curate by a **curated EIK allowlist, never a name
regex** — a `регионал*`/`развитие`/`геодез`/`благоустройство` sweep false-positives badly (see the
anti-allowlist below).

### The FROZEN allowlist (measured 2026-07-16)

Home: **`src/lib/regionalReferenceData.ts`** (mirror `transportReferenceData.ts` /
`securityReferenceData.ts`) — one row per EIK `{eik, name, universe}`, plus `REGIONAL_EIK` (lead),
`REGIONAL_SECTOR_EIKS`, `REGIONAL_UNIVERSE_LABEL`, `REGIONAL_BUDGET_NODE`.

| Universe | Entity | EIK | €m | n |
|---|---|---|---:|---:|
| ministry | **Министерство на регионалното развитие и благоустройството (МРРБ, lead)** | **831661388** | 100.0 | 684 |
| cadastre | Агенция по геодезия, картография и кадастър (АГКК) | **130362903** | 48.7 | 549 |
| control | Дирекция за национален строителен контрол (ДНСК) | **130008993** | 6.6 | 142 |
| governors | 27 × Областна администрация (regional governors) | see below | 58.3 | — |
| — | **Group total** | — | **≈213** | **≈1,700** |

- Core three (ministry + cadastre + control): **~€155.3M / 1,375 contracts**.
- The **27 областни администрации** (regional governors, МРРБ-supervised) add **~€58.3M** and — more
  importantly — the **per-oblast geography** the choropleth hero needs. Top spenders: Варна
  `000093360` (€13.6M), Бургас `000056757` (€11.6M), Смолян `120068166` (€9.4M), Пловдив
  `115009166` (€4.5M), Ловеч `000291335` (€2.6M). Enumerate all 27 from the corpus into the
  allowlist (their `Областна администрация - област <x>` names resolve cleanly to oblasts).

**Decision — include the 27 governors as a segmentable `governors` universe (recommended).** They
are the МРРБ regional chain and give the map its backbone, but a universe `<Select>`
(ministry / cadastre / control / governors) lets the reader isolate them, and a footnote states
they are the regional-governor administrations, not МРРБ HQ procurement. This mirrors МВР's
`health` (Мед. институт) confound segmentation and defense's ВМА split.

### EXCLUDED — separate sectors (cross-link, never roll up)
- **Агенция „Пътна инфраструктура" (АПИ) `000695089` — €6,332M / 2,232** → `/sector/roads`. МРРБ's
  biggest child; dwarfs the whole МРРБ group ~30×. A silent inclusion would make the dashboard
  read as "roads" (the exact transport lesson).
- **Български ВиК холдинг `206086428` (€0.3M) + ~30 operating ВиК utilities** (Варна `103002253`
  €394M, София `812115210` €303M, …) → `/water`. Principal is МРРБ, but they are the water sector.

### Anti-allowlist — do NOT sweep in by name (false-positive clusters found in the corpus)
- **„Регионална дирекция …" that are NOT МРРБ:** РЗИ health inspections (~28, МЗ), РДПБЗН fire
  (~30, МВР), РДГ forestry (~16, МЗХ/ИАГ), РИОСВ environment (~15, МОСВ), РУО education (МОН),
  and especially **Регионална дирекция за социално подпомагане `121015056` €124.6M (АСП/МТСП)**.
- **„…геодезия" that are NOT МРРБ:** УАСГ university `000670616` (€24.4M, МОН); Национален институт
  по геофизика, геодезия и география `175905823` (€2.5M, БАН); vocational гимназии.
- **„благоустройство" substring** → municipal cleaning firms (Благоустройство и чистота-Разлог…).
- **„вик" substring** → schools (81 СУ „Виктор Юго", ОУ „Виктория…").
- ДП „Транспортно/Съобщително строителство и възстановяване" `130847116`/`000631663` (transport SOEs).

---

## 2. Competitive research — regional-development / cohesion transparency

Surveyed the best regional-money & cohesion-absorption dashboards, and the strongest BG competitor.

| Source | What's world-class | Adopt for МРРБ |
|---|---|---|
| **EU Cohesion Open Data Platform** (cohesiondata.ec.europa.eu) | Planned→decided→spent burn-down per programme/fund/region; absorption % as the headline; category-of-intervention split. | The **absorption burn-down** hero (ОПРР closed vs Развитие на регионите stalling) + planned-vs-paid gauge. |
| **Kohesio** (kohesio.ec.europa.eu) | Per-project, per-beneficiary explorer for every EU-funded project, geocoded. | Our ИСУН corpus already IS this for BG — surface it per-oblast + per-municipality beneficiary. |
| **ИПИ / IME `regionalprofiles.bg`** (the strongest BG competitor — see `project_competitor_ime`) | 75 indicators × 28 oblasts, annual since 2012, per-category 5-band rating map; centre-on-mean + variance-correction normalization. | The per-oblast **convergence** frame — but we beat them on **currency (live vs annual PDF), money-linkage (they have indicators, not the cohesion € that drives them), and interactivity**. |
| **OECD Regional Well-Being / EU Regional Competitiveness Index** | Multi-indicator regional convergence, "is the gap closing" trajectory. | The spend-vs-outcome scatter: does cohesion € flow to the poorest oblasts, and is GDP/capita converging. |
| **UK "Levelling Up" fund trackers / Bloomberg CityLab** | Per-place allocation vs need, "did the money follow the deprivation." | The distributional-fairness tile — cohesion €/capita vs GDP/capita residual. |

**Differentiated thesis (where МРРБ is unique):** it is the one ministry where **regional
inequality + capital investment + EU cohesion money meet**. `regionalprofiles.bg` shows the
*outcome* (oblast indicators); cohesiondata shows the *money* (EU absorption); **nobody joins
them**. Наясно's move: put the **money next to the map next to the convergence trajectory**, live,
per oblast, with the EU peer band (COFOG GF06) — "€X.Xbn of cohesion money is landing here; is it
going where the gap is widest, and is the current programme absorbing before the 2027 deadline."

Positioning line: **„Парите за регионите — къде отиват и стигат ли до най-бедните области."**

---

## 3. Data sources & availability (tiered by ingest cost)

Four assets form the spine — **all already in the repo** and all share the oblast/EIK join keys.
The Tier-A MVP renders before any new ingest.

### Tier A — already ingested, zero new pipeline (the MVP renders entirely off this)
1. **Procurement corpus (PG)** — every EIK in §1 is already an awarder. Group rollup, CPV/procedure
   mix, single-bid, HHI, tenders, КЗК appeals, MP-connected all come free via `awarder_group_model`
   + the generic awarder tiles.
2. **ИСУН EU funds (PG, `fund_projects`)** — the cohesion spine, already migrated
   (`project_funds_pg_migration`). Both regional OPs present in `data/funds/taxonomy.json`:
   - **`2014BG16RFOP001` — ОПРР „Региони в растеж" 2014-20:** €1,613.9M contracted / €1,549.4M paid
     / 824 contracts / 119 beneficiaries — **~96% absorbed (closed)**.
   - **`2021BG16FFPR003` — Програма „Развитие на регионите" 2021-27:** €2,469.3M contracted /
     **€491.5M paid** / 669 contracts — **~20% absorbed** (the absorption-risk story).
   - `fund_projects` is **indexed on `program_code`, `beneficiary_eik`, AND `oblast`** — so
     cohesion-by-oblast × programme is a direct SQL filter (no new heavy table). Municipalities are
     the beneficiaries (e.g. Столична община `000696327` €42.3M under ОПРР).
3. **МРРБ budget node** — `data/budget/ministries/admin-ministerstvo-na-regionalnoto-razvitie-i-blagoustroystvoto.json`
   (EIK 831661388, written by `update-budget`). `years[].expenditure.amountEur`: 2018 €213.9M → 2022
   €1,298.3M → 2024 €567.6M → **2025 €1,058.6M** (capital-heavy, volatile — the transfer signature).
   3 programs from 2022 on. ⚠ **Data-hygiene fix required (see §12):** a **duplicate soft-hyphen
   node** (`…-blago-ustroystvoto.json`, `eik:null`) orphans the **2019** slice (€264.2M) — fold it
   in or the МРРБ series has a hole.
4. **COFOG GF06 „Housing & community amenities"** — `data/cofog.json` (Eurostat `gov_10a_exp`,
   `update-macro`). `series.GF06`: €0.466bn (2020) → €0.766bn (2022) → **€1.067bn (2024), +129%
   since 2020**. `peers.GF06 = {bgPctGdp:1.0, euAvgPctGdp:0.7, rank:5, total:26, top:CY 2.1}` — the
   EU peer band, drop-in for the `MvrEuPeerTile`/`euFlags.tsx` pattern.
5. **NUTS3 regional indicators** — `data/regional.json` (`update-regional`; writers
   `scripts/regional/fetch_{eurostat,az_oblast,nsi}.ts`). 10 indicators keyed by 3-letter oblast
   code → `{year,value}` series: `gdpPerCapita`, `fdiPerCapita`, `netMigration`, `enterpriseDensity`,
   `ltUnemployment`, `population`, plus theft/museums/hospital-beds/death-rate. This is the
   convergence axis for the spend-vs-outcome scatter. ⚠ Carries the Sofia-shard (S23/S24/S25) +
   PDV/PDV-00 quirk — derive the primary oblast the same way `RegionalChoroplethMap` already does.

### Tier B — structured, one parser each (later phases, optional)
- **АГКК digital-cadastre coverage %** (кадастрална карта покритие по области) — the cadastre
  outcome metric to pair with АГКК's €48.7M. Source: cadastre.bg / АГКК annual report; oblast-grained.
- **МРРБ per-municipality capital-transfer envelope** — the ЗДБ Art. 53 transfers are **already
  ingested** under `data/budget/municipal_transfers/` (national + per-oblast totals, `update-budget`)
  and surfaced by the AI `municipalTransfers` tool. Fold the МРРБ-relevant slice; do **not** re-ingest.

### Dead ends (do not attempt — documented)
- **egov municipal capital programmes** — `project_egov_municipal_budgets`: the portal copy lags
  ~12 months, worse text, most munis set `resource_url` to their own site. Not worth migrating; the
  existing `data/budget/capital_programs/` (XLSX-sourced, ~30 munis) is the source of record.

---

## 4. World's-best dashboard design — tile by tile (NO tabs)

House grammar: single vertical stack of `PackSection` bands (no tabs — `feedback_no_tabs_ux`);
`StatCard` KPI row; bilingual-inline (`const bg = lang==="bg"`, one nav i18n key only); EUR-only
display (`feedback_bg_uses_eur`); Radix `<Select>` only (`feedback_no_native_select`); homepage
shell, tiles expand (`feedback_dashboard_layout`). Each tile closes with a **per-tile data-basis
caption**. Money-first band order. Signature tiles marked ★.

`Title → AwarderBreadcrumb → ScopeControl → universe Select → KPI row → tiles → awarders bridge → source footnote`

1. **★ Hero — „Къде отиват парите на МРРБ" (the pass-through flow).** A stacked/Sankey hero:
   МРРБ €1.06bn budget → { own procurement €100M · капиталови трансфери към общини · EU
   съфинансиране (ОПРР/РР) · → АПИ пътища* (cross-link) · → ВиК капитал* (cross-link) }. The
   inverse-iceberg framing: "МРРБ управлява €1.06 млрд, но само ~€100 млн минават през собствени
   поръчки — останалото са трансфери." `data-og="regional-hero"` anchor. Fixed-color-by-destination.

2. **★ EU cohesion absorption burn-down (the flagship).** Two burn-down bars: ОПРР 2014-20
   (€1.61bn contracted / €1.55bn paid = ~96%, closed) vs Развитие на регионите 2021-27 (€2.47bn
   contracted / €491M paid = ~20%) — planned → contracted → paid, absorption-risk highlighted
   against the 2027 deadline. Straight from `fund_projects` by `program_code`. *Inspired by EU
   Cohesion Open Data.* THE differentiator tile.

3. **★ Regional-investment-by-oblast choropleth.** Cohesion € absorbed per capita by oblast (ИСУН
   `fund_projects` grouped by `oblast` ÷ `regional.json` population), click-to-filter a Top-N
   municipality table below. Reuse the shared **`OblastChoropleth`**
   (`src/screens/components/procurement/OblastChoropleth.tsx`, `count⇄perCapita` toggle already
   wired) — the strong per-oblast hero transport lacked. Small-multiples option: € absorbed · €/capita
   · GDP/capita, one map each.

4. **★ Regional-convergence scatter — „стигат ли парите до най-бедните области?"** Each oblast a dot
   at (x = GDP/capita or FDI/capita from `regional.json`, y = cohesion €/capita absorbed), with an
   OLS expectation line — judge whether the money is **regressive or convergent** by the residual.
   The direct answer to the distributional question `regionalprofiles.bg` never links to money.
   *Adapted from `education/ContextScatter.tsx` / `MvrCrimeScatterTile.tsx` (inline SVG, median
   quadrant lines).* The beat-the-competitor tile.

5. **COFOG GF06 EU peer band.** BG spends **1.0% of GDP** on Housing & community amenities vs EU-avg
   0.7%, **rank 5/26**, +129% since 2020 — bars BG vs peers. Near-mechanical clone of
   `MvrEuPeerTile` + `euFlags.tsx` (swap the function code to `GF06`; `useCofog()` → `peers.GF06`).

6. **Budget bridge — the transfer gap.** МРРБ €1.06bn total budget (`years[].expenditure.amountEur`,
   ЗДБ, authoritative) vs €100M own procurement highlighted as the thin visible slice; a sourced
   context annotation names the capital-transfer + EU-cofinance share. Clone `MvrBudgetBridgeTile`
   (`useBudgetMinistryRollup(REGIONAL_BUDGET_NODE)`); ignores `scopeWindow` (latest budget year +
   full series). ⚠ fold the 2019 stub-node slice first (§12).

7. **What МРРБ + АГКК buy — CPV/function breakdown.** Universe-segmentable (ministry / cadastre /
   control / governors) so cadastre-IT doesn't dominate. Driven by a new `regionalAttributes.ts`
   CPV classifier (cadastre & geodesy IT 48/72/71, construction & supervision 45/71, housing,
   regional-office operations). Clone `TransportCategoryTile`.

8. **Cadastre (АГКК) tile.** €48.7M / 549 — the digital-cadastre programme; pair with АГКК coverage %
   (Tier B) when ingested. The "what does the state's map of itself cost" angle.

9. **Contractor market — HHI + single-bid competition.** Reuse `VikContractorHhiTile` (DOJ bands,
   gated `<3` suppliers) + a per-universe single-bid heatmap (`TransportCompetitionTile` shape).

10. **Top contracts / top contractors / MP-connected / tenders / КЗК appeals** — all free generic
    tiles above/around the pack; concentration + MP overlay surface the regional-governor
    small-contract patterns.

11. **★ Cross-link strip — the honest carve-out.** A labelled band: „Пътищата (АПИ €6.3 млрд) и
    ВиК (холдинг + оператори) са отделни сектори" → cards linking to `/sector/roads` and `/water`,
    with МРРБ's parent role stated. This is what makes the exclusion honest rather than hidden
    (mirror `TransportRoadsLinkTile`).

12. **Awarders bridge + see-all.** `SectorAwardersTile` listing every member grouped by universe,
    each → `/awarder/:eik`; Top-N tiles deep-link to the shared `/procurement/contracts?sector=regional`
    (`DbDataTable`), scope + `?q=` carried forward.

**dataviz house rules:** one axis per chart; categorical hues fixed order; heroes = CSS flex bars,
Recharts only for the one trend/donut; run `scripts/validate_palette.js` on the oblast ramp
light+dark; color-follows-entity-not-rank.

---

## 5. Common UI elements inventory (reuse, don't rebuild)

| Reuse | File | Regional use |
|---|---|---|
| KPI strip | `@/screens/dashboard/StatCard` | total € · contracts · suppliers · cohesion absorbed % · units-with-contracts |
| Stacked bands (no tabs) | `../PackSection` | every band + `id` deep-link anchor |
| Insight chips | `@/lib/packInsights` (`buildPackInsights`) | absorption %, top oblast, direct-award warn |
| Per-oblast map | `src/screens/components/procurement/OblastChoropleth.tsx` (count⇄perCapita toggle, click-to-filter) | tiles 3; **the strong hero** |
| Regional indicators map | `src/screens/components/regional/RegionalChoroplethMap.tsx` (Sofia-shard + PDV/PDV-00 handling) | convergence layer reference |
| Contractor HHI | `../vik/VikContractorHhiTile` (DOJ bands, gated) | tile 9 |
| EU peer band | `security/MvrEuPeerTile` + `euFlags.tsx` (`useCofog().peers.<GF>`) | tile 5 (GF06) |
| Budget bridge | `security/MvrBudgetBridgeTile` (`useBudgetMinistryRollup`) | tile 6 |
| **Pass-through / iceberg hero** | `src/screens/components/procurement/PassThroughHero.tsx` — the shared inversion-hero built once by the **social-assistance** plan (part-to-whole bar: procured slice vs whole envelope + caption, OG-screenshottable). See `docs/plans/social-assistance-view-v1.md §5` | tile 1 (МРРБ €1.06bn controls vs ~€100M procured) — reuse, don't rebuild |
| Group model | `useAwarderGroupModel` → `/api/db/awarder-group-model` (`reference_awarder_group_model`) | KPI rollup over the ~30-EIK set |
| Scope control | `src/data/scope/` (`useScope`/`useScopeWindow`, `?pscope`) | §6 |
| Browse pack | `SECTOR_BROWSE_PACKS` + `SectorBrowseSlot` (sectorPacks.tsx) | `?sector=regional` |
| Breadcrumb | `AwarderBreadcrumb` (shipped) | free on the awarder page |
| Tenders / appeals / MP-connected | generic awarder tiles | free above the pack |

Genuinely bespoke: `regionalReferenceData.ts` (allowlist), `regionalAttributes.ts` (CPV classifier),
`useRegional*` hooks, the absorption burn-down tile, the convergence scatter, the cross-link strip.

---

## 6. Date scoping (`?pscope`)

Vocabulary is strictly `ns | all | y:YYYY` via `useScope`/`useScopeWindow` — **no calendar picker**.

- **Contract tiles** re-window on `?pscope` (`scopeWindow={{from,to}}`). Corpus spans ~2011-2026;
  `y:YYYY` is meaningful (the post-2021 ОПРР/РР surge).
- **Annual reference tiles** (COFOG GF06, budget bridge, cohesion absorption, regional convergence,
  cadastre coverage) follow the **МВР/transport precedent**: pin to latest year + full series,
  **ignore `scopeWindow`**, with a "latest data · independent of scope" chip. Do **not** add a
  second year `<Select>` (МВР/transport don't).
- **⚠ Half-open bug to avoid** (transport audit item 4, `reference_pg_sargable_windows`):
  `scopeRange` yields an inclusive `to=YYYY-12-31`, but `awarder_group_model` is half-open
  `date < COALESCE($3,…)`. Normalize `y:` to `to=(Y+1)-01-01` for any DB-backed scoped tile so
  Dec-31 contracts aren't dropped. Keep the COALESCE form (sargable).
- ИСУН has **no calendar dates** (`project_funds_pg_migration`) — the cohesion tiles are all-time /
  programme-scoped, correctly independent of `?pscope`.

---

## 7. Routing / registry wiring

Sector **id `regional`**, route **`/sector/regional`**, cluster **`sectors_cluster_infra`** (with
roads/water/transport/energy). Accent: an unused `TILE_ACCENTS` token — recommend **`brass`
(#8a7734)** or `moss` (#6e845d) (clay/teal/steel/copper are taken by the infra siblings).

Prerequisite: **`src/lib/regionalReferenceData.ts`** (the allowlist — imported by every surface).

| # | File | Edit |
|---|---|---|
| 1 | `src/lib/regionalReferenceData.ts` (**new**) | `REGIONAL_EIK`, `MRRB_ENTITIES[]`, `REGIONAL_SECTOR_EIKS`, universe labels, `REGIONAL_BUDGET_NODE` |
| 2 | `src/screens/sector/sectorDashboards.ts` | add `regional:` to `SECTOR_DASHBOARDS` (`leadEik: REGIONAL_EIK`, `members = MRRB_ENTITIES.map(...)` with `group`, `browsePackId:"regional"`, `agency:"МРРБ"`). Drives sitemap/OG/prerender/hub via `SECTOR_DASHBOARD_IDS` |
| 3 | `src/screens/governance/sectorRegistry.ts` | add a `Sector` to the **infra** cluster (`to:"/sector/regional"`, `accent: TILE_ACCENTS.brass`) |
| 4 | `src/ux/infographic/tileAccents.ts` | add `brass`/`moss` token if not free (it is free) |
| 5 | `src/screens/governance/sectorScenes.tsx` | new `Regional` SVG scene (map/building motif) + `regional:` in `SECTOR_SCENES` |
| 6 | `src/screens/components/procurement/sectorPacks.tsx` | `SECTOR_BROWSE_PACKS.regional` (`eiks: REGIONAL_SECTOR_EIKS`); **Phase 2** `[REGIONAL_EIK]: RegionalPack` in `PACKS` (lazy) |
| 7 | `scripts/db/gen_procurement/sector_stats.ts` | add `regional: REGIONAL_SECTOR_EIKS` to `SECTOR_EIKS`; rerun `db:gen-sector-stats` (needs PG) |
| 8 | `scripts/prerender/routes.ts` | add `regional` to `SECTOR_PAGES` (**hard build guard** `assertAllSectorsHavePrerenderCopy` — bilingual title/description/intro naming cohesion/oblasts/АГКК and that roads/water are separate) |
| 9 | `src/locales/{bg,en}/translation.json` | `sector_regional_title` = "Регионално развитие" / "Regional development"; `sector_regional_desc` = middot subtitle (e.g. "Кохезия · кадастър · области") |

**Auto-wired (no edit):** the `sector/:id` route (`routes.tsx`), sitemap (`route_defs.ts`
`SECTOR_SLUGS`), the OG bulk loop, scope. The `?sector=` filter rides the generic `filter:"in"` on
`awarder_eik` (no server change). **Two-phase:** Phase 1 = generic `SectorDashboardScreen` (config
only, real ~€213M group + KPIs + awarders); Phase 2 = bespoke `RegionalPack` under `REGIONAL_EIK`.

---

## 8. Sitemap, OG, prerender

- **Sitemap:** `/sector/regional` (+ `/en/`) auto-derived from `SECTOR_DASHBOARD_IDS`
  (`scripts/sitemap/route_defs.ts:15`) — no edit.
- **Prerender SEO (mandatory build guard):** `scripts/prerender/routes.ts` `SECTOR_PAGES` entry —
  bilingual, keyword-rich, prerender the hero's live cohesion/absorption € into the crawlable body
  (`feedback_static_seo`, judiciary precedent).
- **OG image:** `public/og/sector-regional.png` auto-captured by
  `scripts/og/screenshot_sectors.ts` once `regional` is in `SECTOR_DASHBOARDS` (output
  `#sector-dashboard`). If the choropleth becomes the signature visual, add a **bespoke map-focused
  capture** modeled on `scripts/og/screenshot_transport.ts` (frame `[data-og="regional-oblast-map"]`,
  1× + sharp palette-quantise, exclude `regional` from the bulk loop like transport does).

---

## 9. Watcher + process-watch-report wiring

**Reuse existing skills — minimal new watcher surface** (the spine is already watched):
- **NSI/Eurostat regional indicators** → the existing `nsi_regional` / `eurostat_regional` watchers
  → **`update-regional`** (already mapped in both `process-watch-report` SKILL.md tables).
- **ИСУН ОПРР/РР absorption** → the existing `isun_eu_funds` watcher → **`update-funds`**.
- **МРРБ budget node** → `update-budget` (`ministry_execution_reports`); **COFOG GF06** rides the
  existing `eurostat` `gov_10a_exp` watcher → `update-macro`. No new source for either.
- **(Tier B, optional new)** `scripts/watch/sources/agkk_cadastre.ts` (АГКК coverage %, cadence
  `monthly`) → a new `update-regional-development` skill OR fold into `update-regional`. `WatchSource`
  shape `{id,label,url,cadence,fingerprint(),describe()}`; register in
  `scripts/watch/sources/index.ts` `SOURCES`; **place the id in a `SOURCE_GROUPS` member list** in
  `scripts/data_map/model.ts` or `build_manifest.ts` throws `watcher source not placed`.
- Add rows to **both** `process-watch-report` mapping tables (by-label + by-id) for any new source.
- **Recommendation:** ship Phase 1/2 with **zero new watchers** (spine fully covered by
  update-regional / update-funds / update-budget / update-macro); add the АГКК watcher only if the
  cadastre-coverage tile (Tier B) is built.

---

## 10. Docs (README + /data data-map)

- **README.md:** a sector-view bullet (Регионално развитие / МРРБ, `/sector/regional`), a
  `data/` directory row if a new tree is created, and data-source entries (ИСУН ОПРР/РР, COFOG GF06,
  regional NUTS3) — mirror the transport/security README rows.
- **Data map** (`scripts/data_map/model.ts` → `npm run data:map` → `data/data_map.json`): a
  `regional` FEATURE (`route:"/sector/regional"`, `tags:["fiscal"]`) with EDGES to the **existing**
  datasets it reuses — `["ds:funds","f:regional"]`, `["ds:budget","f:regional"]`,
  `["ds:macro","f:regional"]`, `["ds:regional"→"f:regional"]`, `["ds:procurement","f:regional"]`.
  A **new SOURCE_GROUP/DATASET is only needed if a new `data/` tree is created** (e.g. АГКК cadastre);
  if the view reads only existing datasets, add just the FEATURE + edges. Any `ai/` `fetchData` path
  needs an `AI_PATH_RULES` entry (existing `/regional`, `/funds/`, `/macro` rules already cover the
  spine) — `build_manifest.ts` fails the build on an unmatched path.
- **/data/updates label:** if a new `update-regional-development` skill lands, add
  `data_changes_skill_update-regional-development` to `src/locales/{bg,en}/translation.json`;
  reused skills already have keys.

---

## 11. AI chat tools

Files (per `project_ai_chat_tools`, 5 wiring points): `ai/tools/regional.ts` (new); edit
`ai/tools/registry.ts` (`TOOLS`), `ai/orchestrator/router.ts` (keyword block), `narrate.ts` (cases),
+ `links.ts`/`followups.ts`/regression. `ai/` **cannot import `@/data/*`** — keep the engine in
`src/lib/regionalAttributes.ts`. `domain: "fiscal"` or `"indicators"` (no "sectors" domain).

Proposed tools (Envelope → narrate `facts`, never compute prose numbers):
- **`cohesionAbsorption`** (`fiscal`) — ОПРР vs Развитие на регионите: contracted/paid/absorption %.
  `fetchDb` a fund rollup by `program_code` (or `fetchData` a small precomputed blob).
- **`regionalInvestment`** (`indicators`/`place`) — cohesion € absorbed per oblast (+ per capita),
  drill to one oblast. `fetchDb` a `fund_projects` by-oblast aggregate.
- **`mrrbSpending`** (`fiscal`) — the group procurement rollup (`fetchDb("awarder-group-model",
  {eiks: REGIONAL_SECTOR_EIKS})`) — CPV mix + single-bid + top contractors.
- **`cadastreSpending`** (`fiscal`) — АГКК slice (+ coverage % when Tier B lands).

Router keywords: `регионал|МРРБ|благоустройств|кохези|Региони в растеж|развитие на регионите|
кадастър|геодез|области|regional|cohesion|cadastre`. Guards: route **АПИ/магистрал/път → roads**
(existing `roadsSpending`), **ВиК/вод → water** — a specific regional block placed BEFORE the
generic budget/procurement gates. Note existing overlap to differentiate: `municipalTransfers`
(Art-53 transfers), `fundsProjects` (all-ИСУН), `subnationalIndicator`/`regionIndicator`
(NUTS3 indicators) — the new tools are the **МРРБ-scoped / cohesion-programme-scoped** cuts.

---

## 12. Performance (PG query/payload plan)

- **Procurement:** ONE `awarder_group_model(p_eiks, p_from, p_to)` call over the **~30-EIK** set
  (ministry + cadastre + control + 27 governors). Trivially small vs МВР's 75-EIK / water's 26-EIK
  groups (both measured ~15-210ms). **Worst-case entity = the whole group, all-time
  (`?pscope=all`)** — expect **<100ms**, bitmap index scan on `idx_contracts_awarder`. No new index.
  Run `EXPLAIN ANALYZE` on the all-time full-group path before ship (`feedback_db_query_perf`).
- **Cohesion by oblast/programme:** `fund_projects` is already indexed on `program_code`,
  `beneficiary_eik`, AND `oblast` (`project_funds_pg_migration`) — the by-oblast × programme
  aggregate is an index-driven group-by, expect **~2ms** (the funds perf profile). Either add a
  small serving fn/route or a `fund_payloads`-style precomputed `regional_absorption` blob (kind/key
  = programme|oblast) if the aggregate is global-hot; jsonb determinism rules if precomputed
  (`reference_pg_payload_determinism`).
- **Static JSON (correct, do NOT migrate to PG):** `cofog.json` (GF06 + peers, ~2KB annual),
  `regional.json` (NUTS3, 135KB, shared cross-app), the budget node — all small annual/shared
  reference series loading in 1-2ms, exactly like transport's `rail_subsidy.json`. Migrating them
  adds a round-trip for no gain (`feedback_no_json_from_pg` is about JSON-*generated*-from-PG, not
  reference series).
- **`feedback_pg_changelog_required`:** only if a **new PG-migrated dataset** is created (e.g. an
  `agkk_cadastre` table) — then `recordIngestBatch` into `recent_updates` inside the loader txn.
  The reused procurement/funds tables need no new changelog wiring.
- **DbDataTable:** the `?sector=regional` browse reuses the existing `contracts`/`tenders` REGISTRY
  (`awarder_eik filter:"in"` already flipped) — no new registry entry unless a bespoke
  `/regional/*` browse page is added.

---

## 13. Mobile responsive (375px)

Verify at 375×812 before ship (transport/МВР precedent — both pass): 0px horizontal overflow; KPI
cards stack 2-col; tile pairs 1-up→2-up; the **`OblastChoropleth` scales to the column** (its main
risk — SVG map + legend; the scatter's outlier labels must anchor inward, cf. the МВР scatter fix);
absorption bars + convergence scatter + EU-peer band readable. Light + dark verified.

---

## 14. Phased rollout

- **Phase 0 — config-only generic dashboard (~½ day, zero ingest).** `regionalReferenceData.ts`
  allowlist + `sectorDashboards.ts` + `sectorRegistry.ts` (infra cluster) + scene + i18n +
  `SECTOR_BROWSE_PACKS` + `sector_stats` + `SECTOR_PAGES` SEO copy. Delivers the real ~€213M group
  dashboard (KPI rollup + spend-by-year + top-contractors + awarders tile) with `?pscope`, the
  27-governor per-oblast members, and the roads/water carve-out live. Files: §7 rows 1-9.
- **Phase 1 — bespoke `RegionalPack` (~1-2 days, zero new ingest).** `src/lib/regionalAttributes.ts`
  (CPV classifier + `buildRegionalModelFromAggregates`) + `src/data/procurement/useRegional*.tsx` +
  `src/screens/components/procurement/regional/RegionalPack.tsx` + tiles: hero pass-through flow,
  **cohesion absorption burn-down** (ИСУН), **oblast choropleth** (ИСУН × population), **COFOG GF06
  EU-peer band**, budget bridge, category (universe-segmented), HHI/competition, cross-link strip,
  awarders bridge. Register `[REGIONAL_EIK]: RegionalPack`. All off Tier-A. **Data-hygiene fix:**
  fold the 2019 soft-hyphen stub node into the МРРБ series (`update-budget` de-dup).
- **Phase 2 — the convergence differentiator + AI + productionization (~1-2 days).** The
  regional-convergence scatter (spend vs GDP/capita residual — the beat-`regionalprofiles.bg`
  tile), the 4 AI tools, bespoke map-focused OG, data-map FEATURE + edges, README, watcher/PWR rows.
- **Phase 3 — Tier B (optional).** АГКК digital-cadastre coverage % ingest + tile (the only genuinely
  new ingest); its watcher + `update-regional-development` skill if built.

---

## 15. Open questions

1. **Include the 27 областни администрации?** Recommended yes as a segmentable `governors` universe
   (gives the choropleth its backbone), footnoted as regional-governor administrations — but confirm
   the editorial call (МРРБ HQ vs МРРБ-supervised chain).
2. **Cohesion-by-oblast: serving fn vs precomputed blob?** `fund_projects` by-oblast is fast enough
   (~2ms) to serve live; a `fund_payloads`-style `regional_absorption` blob is only worth it if the
   aggregate is global-hot. Decide at Phase 1 build.
3. **Sector id `regional` vs `regional-development`.** Recommend `regional` (short, matches
   transport/security/roads single-token convention; `/sector/regional`); the doc filename uses the
   long form for clarity.
4. **Convergence scatter denominator.** GDP/capita vs FDI/capita vs a composite — pick the axis that
   most cleanly shows regressive-vs-convergent allocation without cherry-picking; disclose the choice.
5. **Bespoke map OG vs bulk capture.** If the oblast choropleth is the signature visual, a
   transport-style bespoke capture is warranted; else the flat-UI bulk OG suffices.
6. **МРРБ 2019 budget hole** — fix the soft-hyphen duplicate node in `update-budget` (the clean fix)
   vs folding the stub slice at read time (the quick fix). Prefer the ingest fix.
