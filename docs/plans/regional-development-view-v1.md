# Регионално развитие / МРРБ sector view — v1 plan & competitive brainstorm

Status: **BUILT (2026-07-17)** — Phases 0-2 shipped; see "Build status" below. All figures are
**MEASURED** from the repo (`data/procurement/derived/awarders_index.json`, `data/funds/`,
`data/budget/ministries/`, `data/cofog.json`, `data/regional.json`) as of 2026-07-16 unless
marked EXTERNAL.

### Build status (2026-07-17)

Shipped across 5 reviewed commits; **full `npm run build` passes** (data:map + `tsc -b` + vite +
prerender of 62,220 routes), `eslint` clean, **AI regression 871/871**.

| Phase | Commit | Delivered |
|---|---|---|
| 0 — config | `53e353001` | `regionalReferenceData.ts` (МРРБ + АГКК + ДНСК + 27 governors), new **`fern`** accent token, `SECTOR_DASHBOARDS`/`sectorRegistry`(infra)/`SECTOR_SCENES`/`SECTOR_BROWSE_PACKS`, **budget-basis** hub headline (C1), bilingual SEO prerender copy, i18n |
| 1a — pack | `846409501` | `regionalAttributes.ts` (CPV classifier), `useRegional` (+`useRegionalCohesion`), `RegionalPack` + cohesion burn-down (31 Dec 2029 n+3 clock), GF06 EU-peer, budget bridge, category, competition, roads/water cross-link, reused `VikContractorHhiTile` |
| 2 — differentiators | `70174073e` | **pass-through hero** (`data-og="regional-hero"`), **ИСУН oblast choropleth** (`data-og="regional-oblast-map"`), **convergence scatter** — all static-data (`muni-map.json` folded to 28 oblasts + `regional.json` GDP join), validated against the real files |
| AI | `1ed6eebcf` | `mrrbSpending` / `cohesionAbsorption` / `regionalInvestment` + registry/router(above the budgetFunction gate, C4)/narrate/links/followups/regression; `src/lib/regionalOblast.ts` extracted so `ai/` avoids the `@/data` ban |
| docs | `d15885a0f` | data-map FEATURE + 5 edges (**`ds:indicators`**, C2), README sector bullet |

**Deviation from plan (documented):** tile 3's choropleth ships off the **static** `muni-map.json`
(all-ИСУН, per-municipality → oblast) rather than the §0.4 DB route — no new route/precompute was
needed. Trade-off disclosed in-tile: it is **all** ИСУН funds (not just the two МРРБ OPs) and Sofia
city is inflated by HQ-attribution (the Kohesio caveat), so the map labels this, the per-capita view
is the default, and the convergence scatter drops Sofia from the fit. The two МРРБ OPs specifically
remain the cohesion burn-down (tile 2). A DB route filtered to `program_code` would sharpen tile 3
if wanted later.

**All gaps closed (2026-07-17, verified against the live local corpus — 357k contracts on
`localhost:5433`; an earlier "no DB" reading was a wrong-port probe of 5432):**

1. ✅ **OG captured** — `public/og/sector-regional.png` (1200×630 @2x). `screenshot_sectors.ts`
   gained an optional CLI id-filter so adding one sector no longer re-shoots all 12+ cards.
   A bespoke map-focused capture (§8) remains optional.
2. ✅ **DB-backed tiles browser-verified.** `awarder_group_model` over the 30-EIK set returns
   **€215.15M / 1,840 contracts / 30 units / 746 suppliers** (vs the ~€213M estimate). Pack renders
   end-to-end, console clean.
3. ✅ **Mobile + dark verified (§13):** 375×812 → **0px horizontal overflow**, no tile exceeds the
   viewport, the `OblastChoropleth` scales to the column, and the scatter's outlier labels anchor
   inward (Сливен `start` / Габрово `end`, zero clipped). Dark renders correctly.
4. ✅ **`db:gen-sector-stats` rerun** → `regional: {basis:"budget", value:1058603611, year:2025}` —
   the hub tile now carries the €1.06bn budget headline (C1), not a €215M procurement figure.
5. ⚠ **Perf (`feedback_db_query_perf`):** worst case (whole group, all-time) `EXPLAIN ANALYZE` =
   **19.95 ms**, 1,883 shared-buffer hits, zero disk reads — well under the <100ms budget. No new index.

**Two real bugs the browser verification caught (both fixed, `a39a81cdc` / `37c327361`):**
- **Hero basis mismatch.** It compared the ANNUAL budget (€1.06bn) against procurement filtered to
  the `?pscope` window (~3 months → a fake **0.1%**). It now self-fetches the **same budget year**
  (half-open `[Y-01-01, Y+1-01-01)`) and ignores `scopeWindow` per §6. True figure: **€25.7M procured
  in 2025 vs €1,058.6M = 2.4%**.
- **Blended cohesion KPI.** "Усвоена кохезия" averaged the closed ОПРР (96%) with the active
  Развитие на регионите (20%) into a comfortable-looking **50%** — averaging the risk away, on the
  share card. Now shows the **active 2021-27 programme (20%, amber)**.

Not built (optional): top-contracts tile (generic awarder tiles cover it), Tier-B АГКК
cadastre-coverage ingest (§3/Phase 3).

**Editorial finding from the shipped scatter:** the 27 oblasts show **no strong convergence
pattern** — Габрово (wealthier, €12.7k GDP/cap) takes the highest €/capita, the poorest (Сливен,
€6.7k) sits mid-field. The money is not visibly following the deprivation, which is precisely the
question `regionalprofiles.bg` documents (their 2025 "persistent polarization") but never links to
the € — the tile's whole reason to exist.

Closest built siblings to copy: **`transport-view-v1.md`** (an infra-cluster sector that also had
to carve a sibling — roads — out of its scope, cross-link instead of double-count; the freshest
generic-dashboard→bespoke-pack playbook), **`police-mvr-view-v1.md`** (the budget "iceberg"
bridge + EU-peer COFOG tile + per-oblast choropleth), and **`water-view-v1.md`** (the ИСУН
EU-funds spine + `OblastChoropleth` small-multiples + the `?sector=` browse pack). The **committed
`TransportPack`** (`src/screens/components/procurement/transport/`) is the near-mechanical template.

---

## 0. Audit addendum (2026-07-16) — verified against repo, with plan corrections

A full audit against the live repo + the committed `TransportPack` template + competitive-research
re-validation. **Every headline figure in §0/§1/§3 confirmed** against the corpus; six plan
assumptions needed correction before a build starts. Read this section first — it overrides the
stale claims flagged inline below.

### Confirmed (no change)
- **Procurement figures exact:** МРРБ `831661388` **€99.96M / 684** (tier `central_ministry`); АГКК
  `130362903` **€48.72M / 549**; ДНСК `130008993` **€6.64M / 142**; АПИ `000695089` **€6,332.0M /
  2,232** (tier `central_agency`, ~63× the whole МРРБ group — the exclusion is load-bearing); ВиК
  холдинг `206086428` €0.33M / 12. Governors tier = `regional_gov`.
- **Cohesion (taxonomy.json):** ОПРР „Региони в растеж" `2014BG16RFOP001` **€1,613.97M contracted /
  €1,549.39M paid = 96%** (824 contracts, closed); „Развитие на регионите" `2021BG16FFPR003`
  **€2,469.32M contracted / €491.52M paid = 20%** (669 contracts — the absorption-risk story).
- **COFOG GF06:** `series.GF06` = €0.466bn (2020) → €1.005bn (2023) → **€1.067bn (2024), +129% since
  2020**; `peers.GF06 = {year:2024, bgPctGdp:1, euAvgPctGdp:0.7, rank:5, total:26, top:{geo:"CY",
  pctGdp:2.1}}`. Drop-in for the EU-peer band.
- **МРРБ 2019 budget hole is real:** the main node
  `admin-ministerstvo-na-regionalnoto-razvitie-i-blagoustroystvoto.json` (eik `831661388`) holds
  2018/2020/2021/2022/2023/2024/2025 (year key is **`fiscalYear`**, not `year`); **2019 (€264.18M)
  lives only in the soft-hyphen duplicate** `…-blago-ustroystvoto.json` (`eik:null`). §12 fix stands.
- **`regional.json` shape:** `series.<indicator>.<oblastCode>[] = {year,value}`; 10 indicators; 31
  oblast keys incl. the Sofia shards `S23/S24/S25`, `SFO`, and `PDV`/`PDV-00`.
- **Reusable components all present & shapes as claimed:** `OblastChoropleth`, `RegionalChoroplethMap`,
  `MvrEuPeerTile`, `MvrBudgetBridgeTile`, `VikContractorHhiTile`, `useAwarderGroupModel`,
  `buildPackInsights`, `StatCard`, `PackSection`, `euFlags.tsx (EuFlag)`, `awarder_group_model` SQL fn.

### Corrections (six) — apply these; the inline text below is superseded where flagged
1. **Accent token — `brass`/`moss` are NOT free (plan §7 rows 3-4 are WRONG).** All 18 `TILE_ACCENTS`
   tokens are already assigned — `brass`→revenue, `moss`→defense; reusing either collides visually.
   **Add a NEW token** to `src/ux/infographic/tileAccents.ts`. Recommend **`fern: "#5f8a4e"`** (a
   fresh regional/land green — the infra cluster currently has no green among clay/teal/steel/copper,
   so it reads distinctly), or `sienna: "#a26b46"` if a warmer building/благоустройство tone is
   preferred. Eyeball on both cream `#F1ECE0` and navy `#0B1224` grounds (~48-58% L, moderate chroma).
2. **`PassThroughHero.tsx` DOES NOT EXIST (plan §5 "reuse, don't rebuild" is WRONG).** The
   social-assistance plan intended it but it was never built — zero references in `src/`. The
   inversion hero (tile 1) is a **genuine new build here**, not a reuse. Either build the shared
   `PassThroughHero.tsx` now (part-to-whole bar: €1.06bn controlled vs ~€100M procured + caption,
   `data-og="regional-hero"`) so social-assistance can later reuse it, or inline a bespoke
   `RegionalPassThroughTile`. Move it from §5's reuse table into the "genuinely bespoke" list.
3. **EU-peer tile reads GF03, not GF06.** `MvrEuPeerTile` hardcodes `data.peers.GF03` +
   `data.peerSeriesByYear[year].GF03`. It is a **template to clone + retarget to GF06**, not a
   reuse-as-is. Confirmed the data is there: `peerSeriesByYear["2024"]` carries `GF06` for
   BG(1.0)/EU27(0.7)/HR/HU/RO and `peers.GF06` the band — so a `RegionalEuPeerTile` swapping the
   function code to `GF06` is clean.
4. **Cohesion-by-oblast choropleth (tile 3) has NO static fallback.** There is no per-oblast funds
   rollup in `data/funds/` (`derived/absorption.json` is programme/period-grained only:
   `byProgramme`/`byPeriod`/`byFundType`/`byBucket`). The oblast map **requires the DB path** —
   `fund_projects` is indexed on `oblast`, so add either a small serving fn/route
   (`/api/db/regional-cohesion-by-oblast`) or a precomputed `regional_absorption` blob. This is the
   one Phase-1 tile that is not pure Tier-A-static; budget its extra route/precompute. (The
   programme-level burn-down tile 2 CAN render off `taxonomy.json` or `derived/absorption.json`
   without the DB.)
5. **Taxonomy carries NO beneficiary counts.** `taxonomy.json` programmes expose only
   `contractCount`/`totalEur`/`paidEur` — the "119 / 96 beneficiaries" figures in §0/§3 must come
   from the DB (`fund_projects` distinct `beneficiary_eik`) or `data/funds/beneficiaries-by-eik/`,
   not the taxonomy. Drop beneficiary counts from any taxonomy-only tile, or source them from the DB.
6. **The 27-governor allowlist is now fully enumerated** (frozen table in §1 below) with oblast-code
   joins. Sofia note: „Областна администрация - област софия" `831912591` = София-град →
   `SOFIA_CITY` (the choropleth's `featureToCanon` folds `S23/S24/S25`→`SOFIA_CITY`); „Софийска
   област" `000776057` → `SFO`. Use the procurement `OblastChoropleth` for the money map (its
   `featureToCanon` folds both Sofia shards AND `PDV-00`→`PDV`); `RegionalChoroplethMap` only
   special-cases Sofia, not Plovdiv, so it is the indicator-layer reference, not the money map.

### Competitive research — re-validated (strengthens §2, no change to thesis)
- **EU Cohesion Open Data Platform** (`cohesiondata.ec.europa.eu`, 2021-27 view): confirmed as the
  gold standard — 150 adopted programmes, >€110bn EU financing, interactive charts on *planned →
  finances implemented → EU payments made → achievement targets*. All 2021-27 programmes finalised,
  so the **planned/contracted/paid burn-down** (our tile 2) is exactly the frame they lead with —
  our differentiator remains joining it to the **per-oblast convergence map** (which they don't do
  at the sub-national BG grain) and to live procurement, per §2.
- **`regionalprofiles.bg` (ИПИ)** remains the strongest BG competitor (outcome indicators, no money
  linkage); our win is money-next-to-map-next-to-convergence, live. Positioning line unchanged:
  „Парите за регионите — къде отиват и стигат ли до най-бедните области."

### Build-readiness verdict
Phase 0 (config-only generic dashboard) is a pure mechanical mirror of the committed `TransportPack`
wiring (reference-data module + 8 registry edits) and can ship immediately once the new accent token
is added. Phase 1's only non-static dependency is the cohesion-by-oblast route/precompute
(correction 4). No blockers found.

---

## 0b. Deep-audit pass 2 (2026-07-16) — wiring mechanics + competitive deep-dive

Pass 1 (§0 above) verified figures + reuse-component existence. Pass 2 deep-audited the wiring
mechanics the plan asserts in §6–§12 (AI tools, watchers, data-map, DB/scope, prerender/OG,
sector-stats basis) against the repo, and ran a deeper competitive dive. **Two more load-bearing
errors found** (both would fail the build or mislead the headline); the rest of the spine wiring is
confirmed accurate.

### Critical corrections (apply before building)

**C1 — Sector-stats basis is WRONG (plan §7 row 7, §12). Use budget-basis, not procurement.**
The plan says add `regional: REGIONAL_SECTOR_EIKS` to `SECTOR_EIKS` in
`scripts/db/gen_procurement/sector_stats.ts` → a **procurement-basis** hub headline (~€213M,
caption "поръчки"). This **contradicts the file's own anti-understatement convention** — its comment
reads *"Procurement alone understated these 100×–78,000× (Култура showed €3k vs a €234M budget)"* —
and it contradicts МРРБ's **own pass-through thesis** (the whole point is that procurement is a thin
slice of the €1.06bn). МРРБ is a **first-level ПРБ ministry**, identical in kind to
defense/security/justice/culture/tourism/social, which the file deliberately routes through
`BUDGET_SECTOR_NODE`. **Fix:** add `regional:
"admin-ministerstvo-na-regionalnoto-razvitie-i-blagoustroystvoto"` to `BUDGET_SECTOR_NODE` (basis
`budget`, headline **€1.06bn / "бюджет 2025"**), NOT `regional` to `SECTOR_EIKS`. The budget node is
already present + populated — **no new ingest for the hub headline**. (A procurement rollup still
powers the dashboard *body* via `useAwarderGroupModel`; only the hub *tile headline* must be
budget-basis.) ⚠ Twin-file hazard: wire the canonical `…blagoustroystvoto.json` (eik `831661388`),
not the soft-hyphen `…blago-ustroystvoto.json` stub. Ref my memory `project_sector_hub_kpi_basis`.

**C2 — data-map edge `["ds:regional"→"f:regional"]` is WRONG and would FAIL the build (plan §10).**
There is no `ds:regional` dataset — regional NUTS3 lives inside **`ds:indicators`** (confirmed:
`AI_PATH_RULES` maps `/regional` → the `indicators` dataset, `model.ts:120`). `build_manifest.ts`
`validate()` throws `edge references unknown node` on `ds:regional`. **Fix:** use
`["ds:indicators","f:regional"]`. The plan's other four proposed edges (`ds:funds`, `ds:budget`,
`ds:macro`, `ds:procurement` → `f:regional`) all reference real datasets and are valid. And because
`/regional`, `/funds/`, `/macro`, `/api/db/*` are **already** covered by `AI_PATH_RULES`, a new
regional AI tool needs **no** `AI_PATH_RULES` edit — the FEATURE + 5 edges is the only data-map work.

### Secondary corrections

**C3 — §11 "ВиК/вод → water (existing `roadsSpending` twin)" has NO existing target.** There is
**no water AI tool** and **no water routing** in `ai/orchestrator/router.ts` (`ai/tools/vik.ts`
exports only `riverbedCleaning`). The roads guard (`router.ts:3016-3059` → real `roadsSpending`) is
genuine; the water guard would be **net-new and needs a water tool built first**. Drop the "reuses
existing" implication, or scope a water tool separately. The АПИ/магистрал/път→roads guard IS real
and correct to place before the new regional block.

**C4 — §11 router placement is UNDER-specified.** The cited `roadsSpending` precedent sits AFTER the
COFOG `budgetFunction` gate (`router.ts:2770`) and before only the procurement gate (`:3061`). A
regional/МРРБ/**кохезия** query can be caught by `budgetFunction` (GF06 housing), so the regional
block must go **above line 2770**, not merely above the procurement gate — stronger than where the
roads precedent actually sits.

**C5 — §6 Dec-31 half-open scope: CONFIRMED real but ALREADY MITIGATED — guard-against, not
fix-needed.** The SQL is half-open (`061_awarder_group_model.sql:32-33`, `date < COALESCE(p_to,
'99999999')`), and `scopeRange` yields an inclusive `YYYY-12-31`. **But** `useAwarderGroupModel`
sources its window from `useScopeWindow` (already half-open, `y:`→`(Y+1)-01-01`), and
`SectorDashboardScreen` passes `windowOverride=undefined`. So a config-driven regional pack is **safe
by construction**; the bug only appears if someone feeds `scopeRange` output as a `windowOverride`
(as `CompanyDbScreen` does, with a manual convert). **Action:** wire the regional pack via the
default `useScopeWindow` path — don't re-plumb `scopeRange`. Route EIK cap is **300**, not 30
(plan's ~30 is fine).

### Minor (doc-accuracy) nits — non-blocking
- The prerender coverage guard is an **anonymous block** (`routes.ts:799-815`), not a named
  `assertAllSectorsHavePrerenderCopy` (§7/§8 cite a name that doesn't exist). Behaviour is as
  described — a missing `SECTOR_PAGES` entry throws.
- §11 file paths: `links.ts`→`ai/render/links.ts`, `followups.ts`→`ai/app/followups.ts`,
  `narrate.ts`→`ai/orchestrator/narrate.ts`, regression→`ai/tests/regression.ts`. `narrate` cases
  are optional (fall through to title).
- Tile 11 (§4): `TransportRoadsLinkTile` is a **zero-prop hardcoded** single-target card, not a
  generic reuse — clone/generalize to `{to,icon,text*}` for the roads+water cross-link strip.
- Tile 4 scatter (§4): **`MvrCrimeScatterTile`** (median quadrant lines + mobile-safe outlier
  anchoring `textAnchor={rightHalf?"end":"start"}` + `regional.json` self-fetch + Card) is the
  ~70%-lift template — better than `education/ContextScatter` (large desktop OLS plot, no mobile
  anchoring). Both are bespoke inline-SVG (copy, not import).
- Use the **`procurement/OblastChoropleth`** (Sofia+PDV fold via `featureToCanon`), NOT the duplicate
  `screens/pensions/OblastChoropleth`. `SectorPointMap` is a city/point map — wrong for oblast fill.

### Confirmed-accurate spine wiring (no change)
`TOOLS` registry shape + the 5 existing tools (`municipalTransfers`/`fundsProjects`/
`subnationalIndicator`/`regionIndicator`/`roadsSpending`); the `ai/**` eslint `no-restricted-imports`
`@/data` boundary (why `regionalAttributes.ts` must live in `src/lib`); the `WatchSource` shape
(`describe?` optional) + `SOURCES` registry with `nsi_regional`/`eurostat_regional`/`isun_eu_funds`;
the `SOURCE_GROUPS` "watcher source(s) not placed" guard (`build_manifest.ts:210`, groups declared
`model.ts:144`); the PWR by-label + by-id tables mapping update-regional/-funds/-budget/-macro; the
`FeatureDef`/`EDGES` model + `data:map` pipeline; `SectorDashboardScreen` delivering a full working
KPI+charts+awarders dashboard from config alone (Phase 0 = zero bespoke code, confirmed).

### Competitive deep-dive (strengthens §2; sharper framings for tiles 2 & 4)

- **OpenCoesione (Italy) is the deepest gold standard** — planned resources + expenditures +
  locations + thematic + implementing bodies + timings + payments per project, 100+ variables + API,
  **plus territorial indicators that connect each project to the issue it should impact** (exactly
  our money-next-to-outcome move, validated by the best-in-class) and **Monithon** civic-monitoring
  ("monitoring marathons" — citizens verify where money landed). *Adopt:* the territorial-indicator
  linkage as the convergence frame; note Monithon as a possible future community layer.
- **Kohesio (EU)** — 1.5M projects / 500k beneficiaries, geocoded, AI smart-search, per-project
  theme/intervention-field/beneficiary. Caveat we beat: its geocode = **beneficiary** location, not
  where the investment landed; our ИСУН `oblast` tag is closer to where the money actually lands.
- **ИПИ `regionalprofiles.bg` precise methodology** — 12 categories (6 economic + 6 social), ~80
  indicators, composite **centred on the national mean + variance-correction**, 5 bands (poor→very
  good), annual, static. **It explicitly does NOT link indicators to EU-fund/budget money** — the
  confirmed gap Наясно fills. Their **2025 headline is our tile-4 thesis handed to us:** *"persistent
  polarization / two-speed development"* — top Sofia/Varna/Plovdiv/Gabrovo/Burgas ("very good"),
  bottom **Kardzhali(KRZ)/Montana(MON)/Vidin(VID)/Silistra(SLS)** ("weak/unsatisfactory"), 9 oblasts
  "unsatisfactory". Convergence tile question: does the cohesion € go to KRZ/MON/VID/SLS, or
  concentrate where absorption capacity already is (Sofia/Varna)?
- **The n+3 clock is a hard 31 Dec 2029** (final decommitment; commitments still open then are LOST).
  **Retarget tile 2** from the vague "before the 2027 deadline" to the real **31 Dec 2029**
  decommitment deadline — Развитие на регионите at ~20% paid must ramp to ~100% or forfeit money;
  quantify the €-at-risk against that date. Sharper, and correct.
- **EU allocation logic is largely GDP-per-capita** (poorer regions get more €/capita by design) —
  this **grounds the tile-4 expectation line:** the OLS/median residual reveals whether BG's *internal*
  cohesion distribution follows the EU's own convergence logic (progressive) or is regressive.
  Positioning line unchanged: „Парите за регионите — къде отиват и стигат ли до най-бедните области."

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
  importantly — the **per-oblast geography** the choropleth hero needs.

**FROZEN 27-governor allowlist (measured 2026-07-16, EIK · oblast-code · €m, all tier `regional_gov`).**
The `Областна администрация - област <x>` names resolve cleanly; `oblastCode` is the choropleth join
key (`featureToCanon` bucket). Add each row to `MRRB_ENTITIES` with `universe:"governors"` and an
`oblastCode` field:

| EIK | Oblast | code | €m | | EIK | Oblast | code | €m |
|---|---|---|--:|---|---|---|---|--:|
| 000093360 | Варна | VAR | 13.60 | | 000531150 | Русе | RSE | 0.74 |
| 000056757 | Бургас | BGS | 11.63 | | 109069461 | Кюстендил | KNL | 0.58 |
| 120068166 | Смолян | SML | 9.36 | | 107053704 | Габрово | GAB | 0.58 |
| 115009166 | Пловдив | PDV | 4.54 | | 123138141 | Стара Загора | SZR | 0.53 |
| 000291335 | Ловеч | LOV | 2.64 | | 128052865 | Ямбол | JAM | 0.38 |
| 116045521 | Разград | RAZ | 2.09 | | 104103739 | Велико Търново | VTR | 0.32 |
| 108070973 | Кърджали | KRZ | 1.79 | | 114125755 | Плевен | PVN | 0.28 |
| 831912591 | София (столица) | SOFIA_CITY | 1.60 | | 000320534 | Монтана | MON | 0.27 |
| 105042424 | Видин | VID | 1.51 | | 113055670 | Перник | PER | 0.24 |
| 106063115 | Враца | VRC | 1.47 | | 124125725 | Добрич | DOB | 0.24 |
| 836147490 | Хасково | HKV | 1.28 | | 112121473 | Пазарджик | PAZ | 0.11 |
| 000776057 | Софийска област | SFO | 1.26 | | 118039613 | Силистра | SLS | 0.11 |
| 101146105 | Благоевград | BLG | 1.01 | | 127070650 | Шумен | SHU | 0.08 |
| | | | | | 119101402 | Сливен | SLV | 0.03 |

Full-group total (core three + 27 governors) ≈ **€213.6M / ~1,700 contracts**.

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
| **Kohesio** (kohesio.ec.europa.eu) | Per-project, per-beneficiary explorer for every EU-funded project (1.5M projects / 500k beneficiaries), geocoded, AI smart-search. | Our ИСУН corpus already IS this for BG — surface it per-oblast + per-municipality beneficiary. We beat its geocode caveat (Kohesio pins to *beneficiary* location, not where the money landed; our `oblast` tag is closer). |
| **OpenCoesione** (opencoesione.gov.it — the deepest gold standard, audit 0b) | Planned resources + expenditures + locations + implementing bodies + timings + payments per project, 100+ vars + API, **territorial indicators linking each project to the issue it should impact**, + **Monithon** citizen civic-monitoring. | The **territorial-indicator linkage** IS our money-next-to-outcome move, validated by the best-in-class. Monithon = a possible future community-monitoring layer. |
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
   against the **hard 31 Dec 2029 n+3 decommitment deadline** (audit 0b: commitments still open then
   are LOST — Развитие на регионите at ~20% paid must ramp to ~100% or forfeit money; quantify the
   €-at-risk against that date, not the vague "2027"). Straight from `fund_projects` by `program_code`
   or `data/funds/derived/absorption.json` (programme-grained, no DB). *Inspired by EU
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
   0.7%, **rank 5/26**, +129% since 2020 — bars BG vs peers. Clone `MvrEuPeerTile` + `euFlags.tsx`
   into a `RegionalEuPeerTile` and **retarget GF03→GF06** (audit §0.3: the МВР tile hardcodes GF03).
   Data verified present: `useCofog().peers.GF06` + `peerSeriesByYear["2024"].GF06` for BG/EU27/HR/HU/RO.

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
| ~~Pass-through / iceberg hero~~ | ⚠ **CORRECTED (audit §0.2): `PassThroughHero.tsx` was NEVER built** — zero refs in `src/`. Tile 1 is a genuine new build (see "genuinely bespoke" below), not a reuse. Build the shared component here (so social-assistance can reuse it) or inline a `RegionalPassThroughTile`. | tile 1 |
| Group model | `useAwarderGroupModel` → `/api/db/awarder-group-model` (`reference_awarder_group_model`) | KPI rollup over the ~30-EIK set |
| Scope control | `src/data/scope/` (`useScope`/`useScopeWindow`, `?pscope`) | §6 |
| Browse pack | `SECTOR_BROWSE_PACKS` + `SectorBrowseSlot` (sectorPacks.tsx) | `?sector=regional` |
| Breadcrumb | `AwarderBreadcrumb` (shipped) | free on the awarder page |
| Tenders / appeals / MP-connected | generic awarder tiles | free above the pack |

Genuinely bespoke: `regionalReferenceData.ts` (allowlist), `regionalAttributes.ts` (CPV classifier),
`useRegional*` hooks, **the pass-through/iceberg hero (tile 1 — not previously built, audit §0.2)**,
the absorption burn-down tile, the convergence scatter, the cross-link strip.

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
| 3 | `src/screens/governance/sectorRegistry.ts` | add a `Sector` to the **infra** cluster (`to:"/sector/regional"`, `accent: TILE_ACCENTS.fern`) |
| 4 | `src/ux/infographic/tileAccents.ts` | ⚠ **CORRECTED (audit §0.2):** all 18 tokens are taken (`brass`→revenue, `moss`→defense). **Add a NEW token** — recommend `fern:"#5f8a4e"` (infra has no green) |
| 5 | `src/screens/governance/sectorScenes.tsx` | new `Regional` SVG scene (map/building motif) + `regional:` in `SECTOR_SCENES` |
| 6 | `src/screens/components/procurement/sectorPacks.tsx` | `SECTOR_BROWSE_PACKS.regional` (`eiks: REGIONAL_SECTOR_EIKS`); **Phase 2** `[REGIONAL_EIK]: RegionalPack` in `PACKS` (lazy) |
| 7 | `scripts/db/gen_procurement/sector_stats.ts` | ⚠ **CORRECTED (audit C1):** add `regional: "admin-ministerstvo-na-regionalnoto-razvitie-i-blagoustroystvoto"` to **`BUDGET_SECTOR_NODE`** (budget-basis headline €1.06bn), **NOT** `regional` to `SECTOR_EIKS` — procurement-basis (~€213M) understates the sector ~5× and contradicts both the file's anti-understatement convention and the pass-through thesis. No PG rerun needed for the tile headline (budget node already populated) |
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
  `["ds:macro","f:regional"]`, `["ds:indicators","f:regional"]` (⚠ **CORRECTED audit C2:** NUTS3
  regional lives in `ds:indicators`; there is **no** `ds:regional` dataset — `["ds:regional",…]`
  would fail `validate()` with `edge references unknown node`), `["ds:procurement","f:regional"]`.
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
`ai/tools/registry.ts` (`TOOLS`), `ai/orchestrator/router.ts` (keyword block),
`ai/orchestrator/narrate.ts` (cases, optional), + `ai/render/links.ts` / `ai/app/followups.ts` /
`ai/tests/regression.ts` (audit 0b: corrected paths). `ai/` **cannot import `@/data/*`** (eslint
`no-restricted-imports`, `eslint.config.js:79`) — keep the engine in
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
(existing `roadsSpending`, real). ⚠ **CORRECTED (audit C3): ВиК/вод → water has NO existing target**
— there is no water AI tool and no water routing in `router.ts`; drop that guard or build a water
tool first. ⚠ **(audit C4):** the regional block must be placed **above the COFOG `budgetFunction`
gate (`router.ts:2770`)**, not merely above the procurement gate (`:3061`) — a кохезия/МРРБ query can
otherwise be swallowed by the GF06 housing budget-function match (stronger than the roads precedent's
placement). Note existing overlap to differentiate: `municipalTransfers`
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
  awarders bridge. Register `[REGIONAL_EIK]: RegionalPack`. Off Tier-A **except the oblast
  choropleth**, which needs the cohesion-by-oblast DB route/precompute (audit §0.4 — no static
  per-oblast funds rollup exists). **Data-hygiene fix:** fold the 2019 soft-hyphen stub node into the
  МРРБ series (`update-budget` de-dup).
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
