# Социална политика / Социално подпомагане (МТСП + АСП) sector view — v1 plan & competitive research

Status: **BUILT & SHIPPED (Phases 1–3) 2026-07-17.** `/sector/social` now renders the МТСП/АСП group
dashboard: the €15bn disbursement-iceberg hero, the benefit-mix budget bridge (disability ×7.2), the
before/after poverty dumbbell (BG −27% vs EU −33%) + value-for-money scatter, the GF10 EU-peer strip, the
АСП benefit tiles (heating 357k hh/€110M; child/GMI/disability spend×caseload), and the CPV-category /
competition / HHI procurement tiles. Redundancy fix landed (НОИ reclaimed its NoiPack). **Deferred
follow-ups** (infra, not user-visible): AI `socialSpending`/`socialBenefits` chat tools, the `asp_benefits`
watcher + `update-social` skill + process-watch mapping, `data_map/model.ts` wiring, README/`/data` pages,
and the OG-image regen. Original plan/audit preserved below.
This was the single biggest coverage gap in the app: the
Social-protection function is **€15.09bn = 36.8% of ALL Bulgarian government spending (2024)** — the
largest COFOG function by a wide margin — and the app today surfaces only its pension slice (НОИ, via
`/pensions`). The entire social-**assistance** side (family/child allowances, disability support,
heating aid, guaranteed minimum income, means-tested help) — disbursed by **АСП** under **МТСП** — is
uncovered. This plan graduates the currently-redundant `social` slot into a real АСП/МТСП view.

Closest built siblings to copy: **`security` (МВР)** and **`transport` (МТС)** — the two freshest
multi-EIK **group** sector dashboards with a lead ministry + universe-segmented members
(`docs/plans/police-mvr-view-v1.md`, `docs/plans/transport-view-v1.md`). The **budget-bridge / iceberg**
grammar (`MvrBudgetBridgeTile` reading the ministry budget node) is the direct template for the
disbursement-envelope hero. **But note the inversion** (§0): for MvrPack/DefensePack the iceberg is
"procurement is the visible tip of a big *budget*"; here the budget itself is mostly **cash transfers to
citizens**, not procured goods — the design must lead with disbursement + outcomes, not procurement.

> All corpus figures are **MEASURED** from `data/procurement/derived/awarders_index.json` +
> `data/procurement/awarders/<eik>.json` (read 2026-07-16). €m = per-row `amountEur`, the PG basis.
> Budget figures are from the already-ingested `data/budget/ministries/admin-ministerstvo-na-truda-i-
> sotsialnata-politika.json` (State Budget Law, planned expenditure). COFOG from `data/cofog.json`.

---

## 0. The one-line thesis (and why it inverts every other sector)

**Тридесет и седем процента от държавата минава през социалната защита — и почти нищо от нея не се вижда.**
Social protection is **36.8% of all government spending** (€15.09bn, 2024) — bigger than health, defense,
education and roads combined. The app shows the pension half (НОИ). The other half — the **benefits АСП
pays directly to households** (детски надбавки, помощи за хора с увреждания, целева помощ за отопление,
гарантиран минимален доход) — has **no public per-euro, per-oblast, spend-vs-outcome front-end anywhere**.

**The structural inversion (the design's central constraint).** In roads/defense/МВР the money IS
procurement, so the story is "who won the contracts." Here procurement is a **rounding error**: the whole
6-EIK social group has awarded **~€285M cumulative since 2011 (~€19M/yr)** against a **€1.80bn/yr МТСП
disbursement budget** (2025) and a **€15.09bn/yr** function. So:

| Sector | What the money IS | The iceberg |
|---|---|---|
| Roads / Defense / МВР | procurement (+ payroll) | procurement is the visible tip |
| **Social assistance** | **cash transfers to citizens** | **procurement is ~1% of the МТСП budget; the disbursement + its poverty impact is the whole story** |

The signature framing, verified:

| Entity | In АОП corpus | Reality |
|---|---|---|
| **Агенция за социално подпомагане (АСП)** | **€124.6M / 1,343 contracts** (admin buys: топъл обяд, IT, лични асистенти logistics) | Administers **~€2–3bn/yr** in means-tested benefits to households — off-corpus by nature |
| **МТСП** budget (disbursements) | procurement €81.9M | **€1.80bn planned (2025)**, of which "хора с увреждания" alone = **€1.045bn** |

Differentiated thesis = **adequacy + reach, not just amount**. Bulgaria has among the EU's **highest
at-risk-of-poverty rates and one of the weakest poverty-reduction effects of social transfers** — and we
already ingest the Eurostat SILC data to prove it (`data/macro.json`: `ilc_di12`, `ilc_peps01n`; add
`ilc_li10` before/after transfers). No BG portal pairs the €15bn social budget with the poverty outcome
it buys. That pairing is the "world's best" move.

---

## 0.5 Audit — plan verified against live code (2026-07-16)

Every load-bearing claim below was re-checked against the working tree on the plan date. **The plan
is accurate and buildable as written; three of the four open questions are now resolved.** Findings:

**Corpus figures — all six EIKs match exactly** (`data/procurement/derived/awarders_index.json`, per-row
`amountEur`):

| EIK | Entity | Corpus name in index | Measured €m | Plan €m |
|---|---|---|---:|---:|
| 000695395 | МТСП | „Министерство на труда и социалната политика" | 81.87 | 81.9 ✓ |
| 121015056 | АСП ⭐ | **„Регионална дирекция за социално подпомагане - Видин"** | 124.63 | 124.6 ✓ |
| 121604974 | АЗ | „Агенция по заетостта" | 68.04 | 68.0 ✓ |
| 831545394 | ГИТ | „Изпълнителна агенция «Главна инспекция по труда»" | 10.06 | 10.1 ✓ |
| 121350407 | АХУ | „Агенция за хората с увреждания" | 0.89 | 0.9 ✓ |
| 177453060 | АКСУ | „Агенция за качеството на социалните **усулги**" (sic — corpus typo) | 0.077 | 0.08 ✓ |
| — | **Group total** | — | **285.5** | ≈285 ✓ |

- **АСП shared-Булстат collision CONFIRMED** — `121015056` really does render as "РДСП — Видин" in the
  index. The name-pin (§6) is mandatory. **Blast radius (open-Q 3) RESOLVED:** the only consumer of
  `AWARDER_NAME_OVERRIDES` / `canonicalAwarderName` is `CompanyDbScreen.tsx:490` — which **is** the
  `/awarder/:eik` route element (`routes.tsx:2454`). So adding `121015056 → "Агенция за социално
  подпомагане (АСП)"` to `src/lib/awarderNameOverrides.ts` (today it holds only the МВР `000695235` pin)
  flips the awarder header cleanly; no other surface hard-codes the "Видин" string. The `SectorAwardersTile`
  chips read the inline `SOCIAL_ENTITIES` names, so they're already canonical.

**Budget node CONFIRMED** — `data/budget/ministries/admin-ministerstvo-na-truda-i-sotsialnata-politika.json`
carries 8 fiscal years (2018–2025), `years[]` each with `{expenditure.amountEur, programs[].planned.amountEur}`.
FY2025: total expenditure **€1,796,645,056**; program "Политика в областта на хората с увреждания"
planned **€1,045,048,343**, "социалното включване" €409,856,838, "социалното подпомагане…" €231M — matches
the §2 table to the euro. Read via `useBudgetMinistryRollup(SOCIAL_BUDGET_NODE)`. **Phase-2 benefit-mix +
iceberg tiles are fully backed today.**

**COFOG GF10 peers CONFIRMED** — `data/cofog.json` `peers.GF10` = `{year:2024, bgPctGdp:14.4,
euAvgPctGdp:19.6, rank:17, total:26, top:{geo:"FI", pctGdp:26.5}}`. The EU league-table strip renders with
zero new data. **⚠ Two different denominators — do not conflate in copy:** §0's "36.8% / €15.09bn" is
GF10's **share of total government expenditure** (`cofogTopLevel` / `data/cofog.json`); `peers.GF10` is GF10
as **% of GDP** (14.4%, EU 19.6%). Both true; label each tile's basis explicitly.

**SILC outcomes — partial.** `data/macro.json` has `series.gini` + `series.povertyRate` (AROPE proxy) and
matching `indicators` — so the AROPE trend tile ships in Phase 2. **`ilc_li10` (AROP before transfers) is
NOT present** — Tier B #7 fetch is genuinely still needed for the flagship before/after tile (see §3
enhancement — pair it with `ilc_li02`, AROP after).

**`PassThroughHero` / `IcebergHero` — neither exists.** Confirmed this view is the first to build the shared
part-to-whole iceberg component (§5). Sibling packs (`TransportPack`, `MvrPack`) build heroes inline.

**Redundancy CONFIRMED in all three surfaces** exactly as §6 states: `sectorRegistry.ts` (`social`
`agency:"НОИ"`, `accent:TILE_ACCENTS.olive`, `to:"/sector/social"`); `sectorDashboards.ts:162-178`
(`leadEik:NOI_EIK`, `browsePackId:"noi"`, single НОИ member); `scripts/prerender/routes.ts:612-633`
(`id:"social"`, `eik:"121082521"`, "Осигуряване — обществените поръчки на НОИ" copy). **Extra find:**
`scripts/db/gen_procurement/sector_stats.ts:100` already maps `social:
"admin-ministerstvo-na-truda-i-sotsialnata-politika"` (a budget-node string, not an EIK set) — repoint to
`social: SOCIAL_SECTOR_EIKS` alongside the other `SECTOR_EIKS` arrays. Current i18n: `sector_social_title`
= "Осигуряване"/"Social security", `sector_social_desc` = "Осигуровки · договори на НОИ"/"Contributions ·
НОИ procurement" — both retitled per §6.5. Cluster label `sectors_cluster_social` = "Социална държава" (keep).

**Templates confirmed present & fresh** (both merged 2026-07-16): `src/lib/transportReferenceData.ts` +
`transport/TransportPack.tsx` (the freshest sibling), `src/lib/securityReferenceData.ts` +
`security/MvrPack.tsx`. `src/lib/socialReferenceData.ts` and `src/screens/components/procurement/social/`
do **not** yet exist — clean greenfield.

---

## 0.6 Second-pass technical audit — reuse-API errata (2026-07-17)

A deep verification of every §5 reuse claim and §6 wiring claim against the live code. **All reuse targets
exist; the plan is buildable — but eight specifics are stale or mis-stated and would bite a builder.
Corrections (authoritative — prefer these over the §5 prose where they differ):**

1. **The `social` id is deliberately REPOINTED, not new (not a collision).** `social` already exists
   end-to-end for НОИ (`sectorDashboards.ts:167`, `sectorScenes.tsx:247`+`:817` `social: Social`,
   `sectorRegistry.ts:83-88` accent `olive`, `prerender/routes.ts:635`). §6 *intends* to rewrite that same
   slot МТСП-ward — so keeping `accent: TILE_ACCENTS.olive`, replacing the `Social` scene FC in place, and
   rewriting the prerender entry are all correct. Confirm the `pension` tile (→`/pensions`) still carries
   the НОИ story so nothing is lost when `social` stops pointing at НОИ.

2. **`OblastChoropleth` has NO built-in count⇄perCapita toggle** (§5 + §4.5 wrong). It is **single-metric**:
   props `{values: Map<canon,number|undefined>, names?, ramp?, formatValue, tooltipExtra?, activeCanon?,
   onSelectOblast?, ariaLabel, heightClass?}` (`OblastChoropleth.tsx:41-65`). Click-to-filter IS supported
   (`onSelectOblast` + `activeCanon` dimming). **The caller must build the count/€-per-household toggle**
   by swapping the `values` Map — budget a small amount of tile code for it (the heating-aid tile, §4.5).

3. **The classifier template is `buildSecurityModelFromAggregates` in `src/lib/securityAttributes.ts`** —
   NOT `buildMvrModelFromAggregates` / `mvrAttributes.ts` (those don't exist). Shapes to mirror:
   `SecurityCategory` union, `SecurityModel = AwarderModel<SecurityCategory>`, `SectorClassifier<Cat> =
   {categoryOf, order, sink}`, a two-digit-CPV-division `switch` in `categoryOfCpv`, plus `CATEGORY_LABEL` /
   `CATEGORY_CPV_DIVS`. So the plan's `socialAttributes.ts` → `buildSocialModelFromAggregates`.

4. **`useAwarderGroupModel`'s `buildModel` receives the WHOLE `GroupModelPayload`**, not a single row —
   `{totalEur, contractCount, bidKnownN, singleBidN, suppliers[], byCpv[], byCpvContractor[], byMethod[],
   byYear[], byUnit[]}` (`awarderModel.ts:331`). Typical impl: `buildAwarderModelFromAggregates(payload,
   classifier)`. The hook also returns **`isError`** (plan's destructure omitted it). `byUnit` =
   `{eik,totalEur,contractCount,bidKnownN,singleBidN}[]`.

5. **`useBudgetMinistryRollup(nodeId)` returns `Money` objects, and programs are nested per-year** — NOT
   scalar EUR / a top-level programs array. `MinistryRollup.years[]` = `{fiscalYear, revenue, expenditure,
   balance, execution, programs[]}`; `programs[]` = `{nodeId, nameBg, nameEn, planned, execution}`; every
   money field is `Money | null` = `{amount, amountEur, currency}`. So the benefit-mix tile reads
   `rollup.years[i].programs[j].planned?.amountEur` per year (this matches the §0.5 node inspection).

6. **`useCofog` access path is `useCofog().data?.peers?.GF10`** (destructure `data` first), NOT
   `useCofog().peers.GF10`. `GF10` is a valid `CofogCode`; the fetch builds bands over all top-level codes,
   so `peers.GF10` (`CofogPeerBand`) is reachable exactly like `MvrEuPeerTile`'s `peers.GF03`. `euFlags` is
   at `src/screens/components/procurement/security/euFlags.tsx`.

7. **The prerender guard is NOT a named `assertAllSectorsHavePrerenderCopy`** (§8) — it's an anonymous
   top-level block at `scripts/prerender/routes.ts:799-815` that throws if any `SECTOR_DASHBOARD_IDS` id
   lacks a matching `SECTOR_PAGES.id` (a second block rejects duplicate ids). Behaviour is as described
   (requires a `social` entry, which exists) — just don't grep for that function name.

8. **No server-side sector-id allowlist exists — §6/§7's "(and allow-listed server-side)" caveat is
   stale.** `functions/db_table.js` whitelists only per-dataset columns; `contracts.awarder_eik` /
   `tenders.buyer_eik` are `filter:"in"`. `?sector=social` is resolved to an EIK-set **client-side**
   (`SECTOR_BROWSE_PACKS`, `sectorPacks.tsx:194`) and sent as `buyer_eik IN (...)` — the string `social`
   never reaches the server. Only action needed: add the `social` browse-pack entry with
   `eiks: SOCIAL_SECTOR_EIKS` (today the social sector reuses `browsePackId:"noi"`).

**Confirmed exactly as planned (no change):** `StatCard` `{label,hint?,to?,seeMoreTo?}`
(`dashboard/StatCard.tsx:28`); `PackSection` `{icon?,title?,note?,id?}`; `buildPackInsights<Cat>(model,
categoryLabel, lang, sink)` + `PackInsight`; `VikContractorHhiTile` `{suppliers:{eik,name,totalEur}[],
totalEur}` (gates `<3`); `SectorAwardersTile` `{config}`, `SectorSpendByYearTile`/`SectorTopContractorsTile`
`{model: AwarderModel<"all">}`; `DbDataTable`; `SECTOR_DASHBOARD_IDS = Object.keys(SECTOR_DASHBOARDS)`
auto-flows to sitemap (`route_defs.ts:11`) + OG (`screenshot_sectors.ts` — filters out `transport` only);
`SECTOR_SCENES` (`sectorScenes.tsx:810`); `TILE_ACCENTS.olive` (`tileAccents.ts:24`); `PACKS`/`getSectorPack`
lazy-registration pattern (`sectorPacks.tsx:106,145,152`).

---

## 1. Entities — the FROZEN EIK allowlist (measured, curate by EIK never by name)

Curate by an **EIK allowlist** in a new `src/lib/socialReferenceData.ts` (mirror
`securityReferenceData.ts` / `transportReferenceData.ts`). A name sweep on "социал" false-positives badly
(28+ "Дом за медико-социални грижи за деца" — municipal/МЗ children's homes; "Социално-битов комплекс —
БАН"; municipal "Социално подпомагане" service units) — none are МТСП budget units.

### The state social group (6 EIKs — measured 2026-07-16)

| Universe | Entity | EIK | Corpus €m | n | Role |
|---|---|---:|---:|---:|---|
| `ministry` | **Министерство на труда и социалната политика (МТСП, lead)** | **000695395** | 81.9 | 335 | Ministry / policy principal; €1.80bn disbursement budget |
| `assistance` | **Агенция за социално подпомагане (АСП)** ⭐ | **121015056** | 124.6 | 1,343 | Pays family/child/disability/heating/GMI benefits — **the star** |
| `employment` | **Агенция по заетостта (АЗ)** | **121604974** | 68.0 | — | Labour-market policy; registered-unemployment data already ingested |
| `inspection` | **ИА „Главна инспекция по труда" (ГИТ)** | **831545394** | 10.1 | — | Labour inspectorate — undeclared work, wage/safety violations |
| `disability` | **Агенция за хората с увреждания (АХУ)** | **121350407** | 0.9 | — | Disability policy, assistive-device register, sheltered employment |
| `quality` | **Агенция за качеството на социалните услуги (АКСУ)** | **177453060** | 0.08 | — | Social-services licensing/inspection (est. 2021) |
| — | **Group total** | — | **≈ 285** | — | — |

**⚠ Critical data-quality finding — the АСП shared-Булстат collision (must be pinned).** EIK
**121015056** holds **all 1,343 АСП contracts (€124.6M, 2011–2026)** but the corpus labels it
**"Регионална дирекция за социално подпомагане — Видин"**. АСП central + its **28 регионални дирекции
(РДСП)** + municipal directorates all operate under the one legal-entity Булстат `121015056`, and the
awarder name latched onto a representative regional record. This is exactly the МВР `000695235`
shared-Булстат issue (fixed by a pinned canonical name, `892453b83`). **Pin `121015056` → "Агенция за
социално подпомагане (АСП)"** in the reference data and spot-check the awarder header renders
canonically. This single EIK is the disbursement agency and the center of the view — getting its name
right is load-bearing.

**Adjacent-but-excluded (cross-link, never fold):**
- **НОИ (`121082521`)** — pensions + short-term benefits. Its own bespoke `/pensions` view; the social
  view cross-links "пенсиите виж на /pensions" and never double-counts. (This is the redundancy fix, §6.)
- **28 РДСП / municipal social directorates** — subsumed under АСП's `121015056` (same Булстат), so no
  separate member chips; the per-oblast benefit story comes from АСП disbursement stats (§2), not from
  splitting the awarder.
- **~28 "Дом за медико-социални грижи за деца" (ДМСГД)** — municipal/МЗ children's homes; NOT МТСП.

---

## 2. Data sources & availability (tiered by ingest cost; PG-preferred)

### Tier A — already ingested, zero pipeline (the Phase-1 dashboard renders entirely off this)
1. **Procurement corpus (PG).** All 6 EIKs are awarders; the group folds via `awarder_group_model`
   (§5). CPV/procedure mix, single-bid, HHI, top-contracts, tenders, КЗК appeals, MP-connected — all free.
2. **МТСП program budget** — `data/budget/ministries/admin-ministerstvo-na-truda-i-sotsialnata-
   politika.json`, written by **`update-budget`** (State Budget Law, planned expenditure by policy
   program). This is the **disbursement envelope** — the iceberg's "whole bar". Verified series (planned
   expenditure, EUR):

   | FY | МТСП total | of which "Хора с увреждания" | "Социално включване" | "Социално подпомагане" | "Заетост / пазар на труда" |
   |---|---:|---:|---:|---:|---:|
   | 2018 | €605M | €145M | €313M | €82M | €53M |
   | 2021 | €940M | €369M | €344M | €138M | €70M |
   | 2024 | €1,463M | €764M | €392M | €204M | €79M |
   | **2025** | **€1,797M** | **€1,045M** | **€410M** | **€231M** | **€84M** |

   The €605M→€1,797M (×3.0) climb — driven by the disability program's €145M→€1,045M (×7.2) explosion
   (the 2019 Закон за хората с увреждания personal-assistance entitlement) — is itself a headline tile.
   Read via the existing `useBudgetMinistryRollup("admin-ministerstvo-na-truda-i-sotsialnata-politika")`.
3. **Eurostat SILC outcomes** — `data/macro.json` (via **`update-macro`**): `ilc_di12` (Gini),
   `ilc_peps01n` (people at risk of poverty or social exclusion), life expectancy. Enables the
   spend-vs-poverty pairing.
4. **COFOG GF10** — `data/cofog.json`: GF10 = **€15,091.9M (2024) = 36.8% of €41,059.6M total** gov
   expenditure; `peers.GF10` carries the %GDP EU peer composition for a league-table strip (the
   `MvrEuPeerTile` / `euFlags.tsx` pattern, swap the function code to GF10).
5. **АЗ registered unemployment** — already in `data/indicators.json` (per-municipality, `update-
   indicators`). Feeds the `employment` universe / an oblast labour-market context tile.

### Tier B — one parser each, PG-ingestable (Phase 3 — the flagship ingest)
6. **АСП benefit-disbursement statistics** ⭐ — the differentiator. АСП publishes monthly/annual
   statistics (recipients + amounts) for each benefit family: **месечни помощи за деца** (child
   allowances, ЗСПД), **помощи за хора с увреждания** (ЗХУ), **целева помощ за отопление** (heating aid —
   seasonal, ~300–500k households), **гарантиран минимален доход / месечни социални помощи** (ЗСП/GMI),
   **еднократни помощи**. Sources to probe in order:
   - **data.egov.bg АСП org datasets** — discover via `POST /api/listDatasets {"criteria":{"org_ids":
     [<АСП org id>]}}` then `getResourceData` per resource (client `scripts/budget/lib/egov_api.ts`; see
     memory `reference_egov_api_endpoints`). Portal-hosted resources (`resource_url:null`) return rows;
     validate content-type (the egov outage silently writes HTML-as-CSV — sniff `<!doctype`).
   - **asp.government.bg → Статистика/Отчети** — the annual "Отчет за дейността" + monthly benefit tables
     (XLSX/PDF), the authoritative fallback if egov is thin.
   - Grain: **per benefit type × month/year × (oblast where available)**; amount in BGN → **EUR at ingest**
     (÷1.95583, `feedback_bg_uses_eur`). → new PG table **`social_benefits`** (+ `social_payloads`
     overview blob if a precompute is warranted — see §5/§11). This is the "heating-aid map" + "child-
     allowance coverage" + "benefit-mix stacked area" data.
7. **Eurostat `ilc_li10`** (at-risk-of-poverty rate **before vs after** social transfers, BG vs EU) —
   the poverty-reduction-effectiveness series; cheap, fits the `update-macro` fetch pattern → fold into
   `data/macro.json` or a small `data/social/*.json`. THE outcome tile's spine.

### Tier C — recurring PDF / scrape (watcher candidates, Phase 3+)
8. **ГИТ labour-inspection stats** — annual "Отчет" (inspections, violations, undeclared-work cases,
   ordered back-pay). Small ingest; pairs with the €10M ГИТ procurement to make the `inspection` universe
   outcome-legible.
9. **АХУ registers** — assistive-device (медицински изделия/помощни средства) spend, sheltered-employment
   subsidies. Thin, deferred.

### Tier D — manual/annotated overlay
10. **Curated benefit-parameter constants** (like defense mega-programs): the statutory monthly amounts
    (детски €X/child, ГМД base, disability supplement bands) as cited constants for the "какво е една
    помощ" explainer — no clean machine feed; hand-maintain in `socialReferenceData.ts`.

**Top 3 sources:** (1) МТСП program budget [have it, Tier A], (2) АСП benefit-disbursement stats [new
ingest, Tier B — the flagship; **national/annual PDF, see §2.1**], (3) Eurostat SILC + `ilc_li10`/`ilc_li02`
poverty-reduction [have SILC; add li10+li02].

### 2.1 АСП benefit-source verdict — live probe (2026-07-17), resolves open-Q1

**Authoritative machine-readable source = the АСП annual activity-report PDFs** (`Годишен отчет за
дейността на АСП`), NOT data.egov.bg and NOT NSI:
- **data.egov.bg — dead end for benefits.** АСП publishes only **register** datasets there (e.g. Регистър
  на доставчиците на социални услуги, resource `2a97b078-da71-4c3f-a307-1ba5b4fc952e`). A keyword sweep
  (целев/отопл/надбавк/увреж/гарантиран/подпомаг/минимал доход) across the portal returned **zero
  benefit-disbursement datasets**. (АСП's exact org id was not definitively pinned — `listOrganisations`
  only returns the 50 newest — but the keyword sweep is conclusive.)
- **NSI — not an oblast fallback.** NSI "Социална защита" is **ESSPROS, national-only** (expenditure by
  function). The NSI *regional* section (`nsi.bg/statistical-data/179`) covers demography/health/
  education/crime — **no социално подпомагане recipient series at oblast level.**
- **The report PDFs are the source.** Section `asp.government.bg/bg/za-agentsiyata/misiya-i-tseli/
  otcheti-i-dokladi/`; one PDF/year (2020 report links 2006–2019 too). Per-benefit tables (recipients/cases
  + BGN paid, current vs prior year). **National grain, annual.** Ingest = **low cost**: deterministic
  `pdftotext -layout` + regex on stable section headings (the probe extracted every figure below cleanly).
  Convert BGN→EUR at ingest (÷1.95583).
- **Per-oblast exists internally but is UNPUBLISHED.** The report states АСП aggregates monthly data from
  147 дирекции „Социално подпомагане" via 28 РДСП and produces internal quarterly "анализи по области" —
  but those oblast breakdowns are **not published**; the only route is a one-off **ЗДОИ (FOI) request**, not
  a repeatable ingest. **⇒ §4.5 heating-aid tile must be national-headline + benefit-family split + season
  trend, NOT an `OblastChoropleth`.** (This frees the OblastChoropleth reuse dependency for this view.)

**Concrete figures extracted from the 2024 & 2025 reports** (seed the Phase-3 benefit tiles; all BGN):

| Benefit (national, annual) | 2025 recipients | 2025 paid (BGN) | Note |
|---|---:|---:|---|
| Целева помощ за отопление (season 2025/26, to 31.12) | 357,271 orders | 215,098,559 | 121.34 BGN/mo × 5 mo; 2024/25 = 338,923 / €187.1M |
| Месечни помощи за деца (чл.7 ЗСПД) | 416,687 children | 266,686,943 | means-test ≤760 BGN/member (from Apr 2025); 50/110/165/175 BGN by #children |
| Месечни социални помощи / ГМД (чл.9) | 35,987 cases | 144,984,544 | base = 30% of poverty line = 157.80 BGN/mo (2024); poverty line 526 BGN |
| Месечна финансова подкрепа — хора с увреждания (ЗХУ) | 732,634 | 858,022,302 | matches §0 "~858M (2025)" exactly; 2024 = 685M; 2019 ≈ 405M |

These corroborate the §2 budget-node climb and the §3.1 disability trajectory to the lev. **Ingest cadence =
yearly** (revise §9's `asp_benefits` watcher from `monthly` → `yearly`; the report drops ~once/year).
**Storage:** a small national-annual series (~4 benefits × ~10 years) is well under any precompute
threshold — prefer **static `data/social/benefits.json`** (like the li10 series / `cofog`), not a PG table;
`feedback_pg_changelog_required` only binds PG-migrated datasets, so a static JSON sidesteps it (still add a
`recent_updates` line for user-facing freshness).

---

## 3. Competitive research — world-class social-protection transparency

Surveyed 2026-07-16. Social-assistance transparency dashboards worldwide, ranked for adoptable tiles.

| Source | What's world-class | Adopt for the АСП/МТСП view |
|---|---|---|
| **OECD SOCX / Social Expenditure database** | The canonical %GDP social-spend framework, cash-vs-in-kind and by-branch (old age / family / incapacity / unemployment / housing / social exclusion). | The **branch/benefit-family breakdown** as the primary decomposition (maps 1:1 onto МТСП programs + АСП benefit types). |
| **Eurostat ESSPROS + SILC "impact of social transfers on poverty"** | The single most-cited effectiveness metric: at-risk-of-poverty **before vs after** transfers. | The **flagship outcome tile** — "социалните трансфери намаляват бедността с X% — сред най-слабото в ЕС." Data = `ilc_li10` (Tier B #7). |
| **UK DWP "Benefit expenditure and caseload tables" + StatXplore** | Per-benefit spend **and caseload** time series, forecast vs outturn, drill to region. | The **spend × caseload** pairing (€ and recipients per benefit) — the shape of the `social_benefits` table. |
| **US ACF/HHS TANF & LIHEAP dashboards** | Means-tested caseload + heating-assistance (LIHEAP) households served, per state. | Direct analog for **целева помощ за отопление** — households served + €/household, per oblast map. |
| **IME / ИПИ (Bulgaria)** — "Колко струва държавата", kolkodavam.bg, regionalprofiles.bg (memory `project_competitor_ime`) | Established BG fiscal-transparency brand; regional composite ratings; personal tax calculator. | **They do NOT decompose social assistance by benefit or pair it with poverty outcomes.** Our moat = per-benefit, per-oblast, spend-vs-poverty, live, neutral, election-linked. Cite IME as a source, don't compete on calculators. |
| **World Bank ASPIRE (social-protection indicators)** | Cross-country coverage / adequacy / benefit-incidence (share of transfers reaching the poorest quintile). | The **coverage + targeting-accuracy** framing — "reaches X% of the poorest quintile" (from SILC deciles where available). |

**Citizen/journalist questions nobody currently answers (and this view will):**
1. Колко харчи държавата за социално подпомагане — и колко от това стига до най-бедните? (adequacy/targeting)
2. Колко домакинства получиха помощ за отопление тази зима и по колко на домакинство, по области? (heating map)
3. Защо бюджетът за хората с увреждания се утрои за 5 години? (the disability-program explosion)
4. Намаляват ли социалните трансфери бедността в България — и как се сравнява с ЕС? (the outcome tile)
5. Колко от €15 млрд. социална защита виждаме изобщо, и колко е пенсии срещу подпомагане? (the split)

**Positioning:** "Социалната защита е най-големият разход на държавата — а е и най-невидимият. Тук са
парите, помощите и това, което постигат."

### 3.1 Competitive research refresh (2026-07-16) — the world-class specifics to steal

A fresh survey of the best-in-class portals sharpened four things the v1 tile list under-specified. **The
first two are buildable in Phase 2 off already-ingested data** and materially raise the ceiling.

**The single headline effectiveness metric — lock it in.** Across Eurostat, OECD, DWP and the World Bank
the one number that fuses "€ spent → poverty outcome" is the **poverty-reduction effect of social
transfers**: `AROP_before_transfers − AROP_after_transfers`, as a % cut. For Bulgaria it is a genuinely
stark headline — transfers (excl. pensions) cut poverty by **~27.7%** vs an EU average nearer **~35%**:
Bulgaria spends a near-EU-average share of GDP on social protection but **buys less poverty reduction per
euro**. That sentence is the dashboard's thesis and the hero caption.

**Chart forms the leaders use (adopt these exact shapes):**
- **Before/after-transfers dumbbell** (Eurostat/OECD/DREES) — one row per year, a dot at "AROP before
  transfers" and a dot at "AROP after transfers"; **the bar length IS the effectiveness.** Out-communicates
  a Sankey for a single message. Data = **`ilc_li10` (before) paired with `ilc_li02` (after)** — a small
  add on top of the Tier B #7 fetch. This REPLACES the vaguer §4.4 "before vs after" description with a
  concrete mark. Buildable Phase 2.
- **Value-for-money scatter** (OECD/Eurostat) — x = social-protection spend (% GDP), y = poverty-reduction
  effect (pp), one dot per country, BG highlighted. Puts "spends a lot, reduces little" into a picture and
  is **buildable now** off `peers.GF10` (x) + `ilc_li10`/`ilc_li02` per peer (y). New tile — the sharpest
  single visual against the IME PDF. Buildable Phase 2 (once li10/li02 land).
- **Spend × caseload dual series per benefit** (UK DWP "Benefit expenditure & caseload tables" — the
  definitive model): area = € spend, overlaid line = recipients, caption = average benefit per recipient,
  so `Δspend = Δcaseload × Δaverage-award` is legible. This is the shape of the `social_benefits` table and
  the Phase-3 per-benefit tiles (child allowances / disability / heating / ГМД).

**Novel tiles the leaders show that v1 omitted (Phase 3, ranked by impact):**
1. **Targeting bars by income quintile** (World Bank ASPIRE benefit-incidence) — €/recipients by welfare
   quintile Q1→Q5 per benefit; leans-left = well-targeted. THE "кой получава помощите" tile and precisely
   the IME critique (child allowances spread broadly, not concentrated on the poor). Needs SILC deciles.
2. **Take-up / non-take-up gap** (France DREES *non-recours* — "~4 in 10 eligible don't claim RSA"; also
   DWP take-up): estimated eligible vs actual recipients per benefit, gap called out. Rare, high-impact,
   almost nobody shows it.
3. **Adequacy gauge** (ASPIRE) — average benefit as % of the poverty line, per family (exposes ГМД ≈
   16–25% of the line — "the minimum-income floor is a quarter of the poverty line").
4. **Error/fraud & admin cost** (DWP fraud-and-error is standard) — overpayment rate + admin cost per €100
   delivered where АСП publishes it; render as an explicit **data-gap tile** if BG doesn't disclose.
5. **Cash-vs-services split** (OECD SOCX) — for the disability family, indexed monthly support (cash) vs the
   личната помощ personal-assistance mechanism (service).

**Bulgaria-specific figures refreshed (cite these in copy, with the current basis):**

| Metric | Value | Source |
|---|---|---|
| At-risk-of-poverty (AROP), 2024 | **21.7%** | Eurostat |
| At-risk-of-poverty-or-social-exclusion (AROPE), 2024 | **30.3% — highest in the EU** | Eurostat (ddn-20250430-2) |
| Poverty-reduction effect of transfers (excl. pensions), 2024 | **~27.7%** vs EU **~35%** | Eurostat `ilc_li10`/`ilc_li02` |
| Disability monthly financial support | **405M BGN (2019) → ~858M BGN (2025)**, recipients ~752,955 | ИПИ/IME; МТСП ЗХУ |

The disability figures independently corroborate the §2 budget table's €145M→€1,045M program climb: the
2019 Закон за хората с увреждания tied support to the poverty line and launched личната помощ — the single
biggest driver of social-spending growth (share of the reviewed social-programs budget ~20.7%→40.3%,
2015→2019). The "×7 / tripled" framing in §0/§2 is corroborated when the indexed monthly support and the
new personal-assistance service are taken together.

**Sources (all live gov/IGO portals):** Eurostat ESSPROS + SILC `ilc_li10`/`ilc_li02`/`ilc_li10_r`; UK DWP
Benefit expenditure & caseload tables + StatXplore; US HHS/ACF LIHEAP FY-Data dashboard (the households-served
+ average-benefit state card — the direct model for the heating-aid map) + TANF; World Bank ASPIRE
(coverage/adequacy/incidence); France DREES monthly solidarity-benefits tracker + non-recours; OECD SOCX +
Social Expenditure Dashboard; NZ MSD Benefit Fact Sheets; Ireland DSP quarterly stats; IME/ИПИ for the BG
targeting critique.

---

## 4. The "world's best" dashboard — tile-by-tile (NO tabs; stacked `PackSection` bands)

House grammar exactly as MvrPack/DefensePack: `Title → SectorBreadcrumb → ScopeControl → universe
<Select> → group-only KPI row → buildPackInsights chips → money-first stacked PackSection bands → per-unit
awarders bridge → source footnote`. Bilingual-inline (`const bg = lang==="bg"`), no i18n keys except the
nav/registry label. Each tile carries a **per-tile data-basis caption** — `● real` (ЗОП, measured) /
`◆ budget` (ЗДБ) / `◇ context` (АСП статистика / Eurostat). Signature tiles marked ★. The pack registers
under the **МТСП lead EIK** (`SocialPack` in `PACKS`) and becomes the whole `/sector/social` content.

1. **Group KPI row** (`StatCard`, scope + universe aware, `● real`): Договорено ЗОП · Договори ·
   Изпълнители · Структури с договори · От което АСП % (the assistance-agency share). Generic per-EIK
   total lives in the awarder header above — don't duplicate.

2. **★ Hero — "Къде отиват парите за социална защита" (the split + the iceberg).** A part-to-whole
   showing **€15.09bn GF10 → {Пенсии ~€10–11bn (НОИ, cross-link /pensions) · Социално подпомагане ~€X bn
   (МТСП/АСП) · Друго}**, then the МТСП disbursement bar (€1.80bn 2025) with the group's **annual
   procurement (~€19M/yr, ~1%)** pulled out as a labelled sliver (broken-axis blow-up, the §7b МВР
   iceberg spec). Fixed-color-by-branch. `data-og="social-hero"`. `◆ budget + ◇ context`.

3. **★ Разход по вид помощ (benefit-mix).** МТСП program budget as a stacked series 2018→2025 —
   "хора с увреждания" (the ×7 climber) vs соц. включване vs соц. подпомагане vs заетост. Adapts
   `MvrBudgetBridgeTile` / the program-node reader (`useBudgetMinistryRollup`). Ships in **Phase 1**
   off the already-ingested node. `◆ budget`.

4. **★ Социалните трансфери и бедността (the outcome tile — the differentiator).** Concrete mark =
   **before/after-transfers dumbbell** (§3.1): AROP **before** (`ilc_li10`) vs **after** (`ilc_li02`)
   transfers, one bar per year, bar length = the poverty reduction; BG vs EU. Caption locks the headline
   metric: "Трансферите свалят бедността с ~27.7% — под средното за ЕС (~35%)." Pair with the AROPE trend
   (`ilc_peps01n` / `series.povertyRate`, have it). Positional/non-judgmental framing (education report-card
   precedent). **Phase 2** (li10 + li02 fetch). `◇ context`.

4b. **★ Стойност за парите — разход спрямо ефект (value-for-money scatter, NEW from §3.1).** x = social-
   protection spend (% GDP, `peers.GF10`), y = poverty-reduction effect (pp, `ilc_li10`−`ilc_li02` per
   country), one dot per EU country, BG highlighted in the "spends-average / reduces-below-average"
   quadrant. The single sharpest visual against the IME PDF. **Phase 2** (reuses the compare-dashboard
   scatter pattern). `◇ context`.

5. **★ Целева помощ за отопление (heating aid — NATIONAL, reframed per §2.1).** ⚠ **NOT a choropleth** —
   АСП publishes national-only (no oblast breakdown exists publicly). Instead: a big-number headline
   (**357,271 households, €110M, 2025/26 season**) + **season-over-season trend** (households + total +
   €/household/month) + its place in the benefit-mix. The most concrete, most-covered benefit. **Phase 3**
   (АСП report-PDF ingest). `◇ context`. *(A per-oblast version is possible only via a one-off ЗДОИ/FOI
   table — out of scope for a repeatable ingest.)*

6. **★ Детски надбавки / помощи за деца — обхват (coverage).** Recipients vs eligible-child population
   (416,687 children covered, 2025; means-test ≤760 BGN/member); child-allowance €/child vs the statutory
   amount (50/110/165/175 BGN by #children). Coverage is the ASPIRE-style targeting story. **National,
   Phase 3.** `◇ context`.

7. **EU league-table strip (GF10 %GDP).** BG social-protection spend %GDP vs EU peers — reuse
   `MvrEuPeerTile` + `euFlags.tsx`, swap the function code to **GF10** (`useCofog().peers.GF10`). Near-
   mechanical. `◇ context`.

8. **Разход по функция — what the group buys** (`● real`, CPV-classified via a new `socialAttributes.ts`
   classifier): социални услуги (топъл обяд / патронажна грижа), IT/системи (АСП eligibility systems),
   строителство/ремонт (social-service buildings), консултантски (EU-project TA). Universe-segmentable so
   АСП's топъл-обяд doesn't dominate. `SectorCharts` / `MvrCategoryTile` clone.

9. **Contractor concentration (HHI)** — reuse `VikContractorHhiTile` (shared) verbatim; gates `<3`.
   **Single-bid competition** — per-unit `MvrCompetitionTile` clone; gate on `cpv_competition.json`,
   disclose covered-`n`. `● real`.

10. **ГИТ — инспекции и нарушения (employment/inspection outcome).** ГИТ inspections, undeclared-work
    cases, ordered back-pay, paired with the €10M ГИТ procurement. **Phase 3** (Tier C). `◇ context`.

11. **Top contracts / top contractors / tenders / КЗК appeals / MP-connected** — free generic tiles
    (the АСП топъл-обяд + личен-асистент logistics contracts + IT systems surface here). `● real`.

12. **Институции bridge — `SectorAwardersTile`** listing all 6 units grouped by universe, each →
    `/awarder/:eik`. `● real`.

13. **See-all deep-links** — every Top-N tile → the shared `DbDataTable` scoped to `?sector=social`,
    scope + `?q=` carried forward.

**dataviz house rules (from defense):** one axis per chart; categorical hues fixed order, 9th→"Other";
color-follows-branch-not-rank; heroes = CSS flex bars (OG-screenshottable), Recharts only for the one
trend/donut; run `scripts/validate_palette.js` on the branch palette light+dark.

---

## 5. Common UI elements inventory — reuse map (verified paths)

**Reuse as-is (no rebuild):**
- `StatCard` — `src/screens/dashboard/StatCard.tsx` (`{label,hint?,to?,seeMoreTo?}`).
- `PackSection` — `src/screens/components/procurement/PackSection.tsx` (`{icon?,title?,note?,id?}`).
- `OblastChoropleth` — `src/screens/components/procurement/OblastChoropleth.tsx` (count⇄perCapita, ramp,
  click-to-filter) — heating-aid + coverage maps.
- `SectorPointMap` — `src/screens/components/maps/SectorPointMap.tsx` (shared marker map; used by
  judiciary `CourtLoadMap`, `MvrDirectorateMap`, `NzokHospitalMap`) — optional АСП РДСП-seat map (weak,
  all Sofia-registered like transport — prefer the disbursement choropleth).
- `VikContractorHhiTile` — `src/screens/components/procurement/vik/VikContractorHhiTile.tsx` (the de-facto
  shared HHI tile).
- `buildPackInsights` / `PackInsight` — `src/lib/packInsights.ts`.
- `WARN_CHIP_COLORS` — `src/screens/components/procurement/chipStyles.ts`.
- HHI helpers — `src/lib/textbookPublishers.ts` (`hhiBand`, `HHI_BAND_COLOR`).
- `measureStanding` / decile-fan helpers — `src/lib/nzokMeasures.ts` (for a per-benefit "над/около/под
  медианата" band if wanted).
- `useBudgetMinistryRollup(nodeId)` — `src/data/budget/useBudget.tsx:144` → reads
  `data/budget/ministries/<id>.json` (the budget bridge / benefit-mix tile).
- `useAwarderGroupModel<Cat>(eiks, buildModel, windowOverride?, enabled?)` —
  `src/data/procurement/useAwarderGroupModel.ts`; returns `{model, byUnit, groupTotalEur, isLoading}`;
  ONE `/api/db/awarder-group-model` call over the 6-EIK set.
- Generic sector tiles (render free if no pack): `SectorAwardersTile` (`src/screens/sector/
  SectorAwardersTile.tsx`), `SectorSpendByYearTile` + `SectorTopContractorsTile` (`src/screens/sector/
  SectorCharts.tsx`).
- `InfographicTile` — `src/ux/infographic/InfographicTile.tsx` (the hub card).
- `MvrEuPeerTile` + `euFlags.tsx` — adopt for the GF10 EU strip (swap function code).
- `DbDataTable` — `src/ux/data_table/DbDataTable.tsx` (see-all pages / `?sector=social` browse).

**Near-mechanical clones (from MvrPack):** `MvrBudgetBridgeTile`→`SocialBudgetBridgeTile` (benefit-mix +
iceberg), `MvrCategoryTile`→`SocialCategoryTile`, `MvrCompetitionTile`→`SocialCompetitionTile`,
`MvrTopContractsTile`→reuse.

**Shared cross-pack component to build ONCE (confirmed with operator).** Social, regional (МРРБ) and — in
part — environment are all **pass-through / inversion packs**: the entity controls far more money than it
procures, so all three lead with a disbursement/outcome hero + an "iceberg" caption ("procurement is only
X% of a €Y bn envelope"). Rather than three near-identical heroes, build one reusable
`PassThroughHero` (a.k.a. `IcebergHero`) — a part-to-whole bar (procured slice vs whole envelope) with a
configurable caption, OG-screenshottable (CSS flex bars, `data-og`), fixed-color-by-branch — and reuse it
here (`social-hero`), in `RegionalPack`, and for environment's money strip. Home it under
`src/screens/components/procurement/PassThroughHero.tsx`. This view is the first to build it.

**Genuinely bespoke:** `SocialPovertyImpactTile` (§4.4, Eurostat li10), `SocialHeatingAidTile` (§4.5,
АСП stats + OblastChoropleth), `SocialBenefitCoverageTile` (§4.6), `socialAttributes.ts` (CPV→category
classifier + `buildSocialModelFromAggregates`), `socialReferenceData.ts` (the 6-EIK allowlist +
canonical АСП name pin + universe labels).

---

## 6. Routing / registry wiring — and the pension/social redundancy FIX

**The redundancy (verified 2026-07-16):** the `social` slot points at НОИ in **three** places, exactly
duplicating `pension`:
- `src/screens/governance/sectorRegistry.ts` — `social` `agency:"НОИ"`, `to:"/sector/social"`.
- `src/screens/sector/sectorDashboards.ts` — `social` `leadEik: NOI_EIK`, `browsePackId:"noi"`, single
  НОИ member.
- `scripts/prerender/routes.ts` `SECTOR_PAGES` — `id:"social"`, `eik:"121082521"`, copy titled
  "Осигуряване — обществените поръчки на НОИ".

Because `sectorDashboardForLeadEik(NOI_EIK)` resolves to the `social` config, НОИ's `/awarder/121082521`
page currently suppresses its own pack and mislinks to a НОИ-labelled "social" dashboard.

**The fix (all three surfaces):**
1. `sectorRegistry.ts` — `social`: `agency:"НОИ"→"МТСП"` (or "АСП"), keep `to:"/sector/social"`, keep
   `accent: TILE_ACCENTS.olive`. Retitle `sector_social_title/desc` → "Социално подпомагане" / the
   АСП/МТСП description.
2. `sectorDashboards.ts` — `social`: `leadEik: NOI_EIK → SOCIAL_LEAD_EIK` (МТСП `000695395`),
   `browsePackId:"noi"→"social"`, `members` = the 6-EIK allowlist grouped by universe (map
   `SOCIAL_ENTITIES` like transport/security). This removes `NOI_EIK` from `DASHBOARD_BY_LEAD_EIK`, so
   НОИ's awarder page shows its `NoiPack` again and `/pensions` stays the pension home.
3. `sectorPacks.tsx` — register `[SOCIAL_LEAD_EIK]: SocialPack` in `PACKS` (lazy import parallel to
   MvrPack); add a `social` entry to `SECTOR_BROWSE_PACKS` (`eiks: SOCIAL_SECTOR_EIKS`). No
   `SOCIAL_AWARDER_PATH` export (like ВСС/МВР — the nav points at `/sector/social`).
4. `sectorScenes.tsx` — a `social` SVG scene (a helping-hand / support glyph, distinct from НОИ's amber
   pension scene). Keyed by id in `SECTOR_SCENES`.
5. i18n — retitle `sector_social_title` = "Социално подпомагане" / "Social assistance",
   `sector_social_desc` = the МТСП/АСП description, in `src/locales/{bg,en}/translation.json`.

Architecture: `/sector/social` (generic `SectorDashboardScreen`, no route intercept — unlike
administration). Phase 1 = generic 6-EIK group dashboard. Phase 2+ = `SocialPack` becomes the content via
`getSectorPack(leadEik)` (the MvrPack path). `id:"social"` matches sectorRegistry, sectorDashboards,
SECTOR_BROWSE_PACKS, prerender, OG, scene, sector_stats — one id everywhere.

`scripts/db/gen_procurement/sector_stats.ts` — repoint `social` (or add) `SECTOR_EIKS.social =
SOCIAL_SECTOR_EIKS`; rerun `db:gen-sector-stats` (needs live PG; non-blocking — the dashboard KPIs come
from the runtime `awarder-group-model`, only the hub € badge waits).

---

## 7. Date scoping (`?pscope`, identical to every sector)

Reuse `src/data/scope/` unchanged. `Scope = ns | all | y:YYYY`:
- `ns` (default, omitted) — the selected parliament's contract window.
- `all` — full corpus; `y:YYYY` — one calendar year, half-open `[Y-01-01,(Y+1)-01-01)`.

`SectorDashboardScreen` already renders `<ScopeControl mode="toggle">`, so `/sector/social` inherits
`?pscope` free. The corpus spans ~2011–2026, meaningful for `y:`. `SocialPack` (Phase 2) consumes the
controlled `scopeWindow` for **contract** tiles. **Annual disbursement/outcome tiles** (benefit-mix,
poverty impact, heating aid, GF10 peer) follow the MvrPack convention: **hard-pin to latest year + show
full series, ignore `scopeWindow`** — simpler and consistent (don't lift NZOK/VSS's independent year
picker unless АСП monthly data warrants it). **Half-open caveat:** normalize `y:` to `to=(Y+1)-01-01` for
any DB-backed scoped tile (the confirmed inclusive-`to` Dec-31 drop bug; `reference_pg_sargable_windows`).

---

## 8. Sitemap, OG screenshot, prerender (exact files)

- **Sitemap:** `/sector/social` (+ `/en/`) auto-derived from `SECTOR_DASHBOARD_IDS`
  (`scripts/sitemap/route_defs.ts`) — no edit needed once the config lands.
- **Prerender SEO:** `scripts/prerender/routes.ts` — **rewrite the existing `social` `SECTOR_PAGES`
  entry** (currently the НОИ copy, `eik:"121082521"`) to `eik:"000695395"` + keyword-rich bilingual copy
  (naming АСП, детски надбавки, помощи за хора с увреждания, целева помощ за отопление, ГМД, €15bn / 37%,
  poverty-reduction, and that pensions/НОИ are a separate `/pensions` view). The build guard
  `assertAllSectorsHavePrerenderCopy` requires a `social` entry (it exists — just fix it). Prerender the
  hero's live € figures into the crawlable body (judiciary precedent). `ogImage: /og/sector-social.png`
  auto-referenced.
- **OG image:** `scripts/og/screenshot_sectors.ts` captures `/sector/:id` for every id in
  `SECTOR_DASHBOARD_IDS` **except transport** → `public/og/sector-social.png` (2400×1260) generated with
  the bulk loop; no per-sector script needed (unlike transport's map-focused capture) unless a bespoke
  hero crop is wanted later. `data-og="social-hero"` on the hero for a future dedicated capture.

---

## 9. Watcher + process-watch-report wiring

New/reused watch sources in `scripts/watch/sources/` (register in `scripts/watch/sources/index.ts`
`SOURCES`; `WatchSource` shape `{id,label,url,cadence,fingerprint(),describe()}`):
- **`asp_benefits.ts`** (new, Tier B #6) — cadence **`yearly`** (revised from `monthly` per §2.1 — the
  authoritative source is the annual report PDF, not a monthly feed); fingerprint = the latest report link
  on `asp.government.bg/bg/za-agentsiyata/misiya-i-tseli/otcheti-i-dokladi/` (page hash / newest PDF
  filename). → maps to a new **`update-social`** skill running the АСП report-PDF ingest.
- **`eurostat` (existing)** — the SILC / `ilc_li10` / GF10 releases already ride the `eurostat` +
  `eurostat_policy` watchers; no new source (folds into `update-macro`).
- **`budget_law` / `ministry_execution_reports` (existing)** — the МТСП budget node rides `update-budget`;
  no new source.
- **`git_inspections.ts`** (new, Tier C, Phase 3+) — cadence `yearly`; ГИТ annual report fingerprint.

**process-watch-report** (`.claude/skills/process-watch-report/SKILL.md` mapping table — markdown rows
` | \`source\` | \`update-skill\` (notes) | `): add `asp_benefits → update-social` and (later)
`git_inspections → update-social`. The МТСП-budget and Eurostat rows already map to `update-budget` /
`update-macro`; note in those rows that the social view consumes them.

**New `update-social` skill** (`.claude/skills/update-social/SKILL.md`) — mirror `update-agri` /
`update-noi`: fetch АСП benefit stats → load the `social_benefits` PG table (+ `social_payloads` blob if
used) → wire into `recent_updates` changelog (`feedback_pg_changelog_required` — mandatory for any new
PG-migrated dataset). `feedback_no_json_from_pg`: the benefit data is PG-served (payloads/blobs), not a
JSON serving tree; the small Eurostat li10 series may stay static JSON like `cofog`/`road_safety`.

---

## 10. AI chat tools

New `ai/tools/social.ts` (mirror `ai/tools/transport.ts`; tools narrate `env.facts`, never compute prose
numbers; `ai/` cannot import `@/data/*` — keep engines in `src/lib/`). Register in `ai/tools/registry.ts`
(`TOOLS` entries + import), add a router keyword block in `ai/orchestrator/router.ts`, cases in
`narrate.ts`. Proposed tools:

- **`socialSpending`** (domain `fiscal`) — the 6-EIK group procurement folded by universe + function +
  competition (the `/sector/social` pack analog; `fetchDb("awarder-group-model", {eiks:
  SOCIAL_SECTOR_EIKS.join(",")})` → `buildSocialModelFromAggregates`). Signature `(args,ctx)=>Envelope`.
- **`socialBenefits`** (domain `fiscal`) — the disbursement story: МТСП budget by benefit family + АСП
  recipients/amounts by type (heating aid, child allowances, disability, GMI). `fetchDb("social-*")` /
  `fetchData` once ingested.
- **`socialPovertyImpact`** (domain `indicators`) — at-risk-of-poverty before/after transfers, BG vs EU
  (`data/social/*.json` or `macro.json`). The differentiator tool.
- ~~**`heatingAidByOblast`**~~ — **dropped (§2.1: no oblast data published).** Fold heating aid into
  `socialBenefits` as a national headline + season trend instead.

**Router keywords:** `социал|подпомаг|помощ|детски надбавк|отоплен|увреждан|инвалид|бедност|минимален доход|
ГМД|заетост|МТСП|АСП|social assistance|welfare|benefit|allowance|poverty|heating aid|disability`. **Guard
against collision:** route `пенси|pension|НОИ|осигурителн` → the existing NOI/pension tools, NOT social
(both are "социал"-adjacent — the router already special-cases pensions at `router.ts:2345`; add the
social block after it so pension wins the overlap). Any `/social/*.json` path an `ai/` tool reads MUST get
an `AI_PATH_RULES` entry (`scripts/data_map/model.ts`) or the prebuild fails.

---

## 11. Performance — PG query/payload plan

- **Critical path (Phase 1):** ONE `awarder-group-model` call over the **6-EIK** set — far smaller than
  МВР (74 EIK) or defense (25 EIK), which measure ~74ms / ~285KB. Expect **<40ms**, `idx_contracts_awarder`
  bitmap scan. `staleTime:Infinity`, parallel with the static budget/COFOG JSONs (1–2ms each).
- **Worst-case entity = АСП `121015056`** (1,343 contracts — the largest single member). EXPLAIN ANALYZE
  the group-model + any `?sector=social` DbDataTable window-filter on АСП; both hit `idx_contracts_awarder`
  / `idx_contracts_awarder_date` (exist) — no new index expected (`feedback_db_query_perf`).
- **АСП benefit ingest (Tier B) — revised per §2.1:** the data is **national + annual** (~4 benefit
  families × ~10 years ≈ a few hundred rows), not a per-oblast corpus. **No PG table, no `social_payloads`
  blob, no `OblastChoropleth`** — this is a tiny reference series. Emit **static `data/social/benefits.json`**
  (like the li10 series / `cofog`). The earlier "COPY into `social_benefits` PG + per-oblast precompute"
  plan is over-built for national-annual data; drop it.
- The small Eurostat `ilc_li10`/`ilc_li02` series (~2KB annual) stays **static JSON** (like
  `cofog`/`road_safety`) — no PG round-trip for a reference series.

---

## 12. Mobile responsive

Verify at **375×812** (`resize_window` mobile) + 768 tablet, light + dark: 0px horizontal overflow; KPI
cards stack 2-col (mobile) → 3-col (desktop); the benefit-mix stacked bars + poverty-impact bars + the
oblast choropleth scale to the column; broken-axis iceberg blow-up legible; EU-peer strip wraps. Risks:
the benefit-mix stacked series legend (many categories) and the heating-aid choropleth ranked list —
apply the МВР scatter fix (right-half labels anchor leftward) and cap tile body heights (`StatCard
bodyMaxHeight`). Wide DbDataTable "see all" pages scroll inside their own `overflow-x:auto`.

---

## 13. Phased rollout

**Phase 1 (~½–1d) — generic group dashboard + redundancy fix, zero new ingest.**
Files: `src/lib/socialReferenceData.ts` (NEW — 6-EIK allowlist, canonical АСП name pin, universes,
`SOCIAL_LEAD_EIK`/`SOCIAL_SECTOR_EIKS`/`SOCIAL_ENTITIES`/`SOCIAL_UNIVERSE_LABEL`); `sectorRegistry.ts`
(agency + titles); `sectorDashboards.ts` (`social` leadEik→МТСП, members, browsePackId→social);
`sectorPacks.tsx` (`social` `SECTOR_BROWSE_PACKS` entry); `sectorScenes.tsx` (scene); i18n; `scripts/
prerender/routes.ts` (rewrite the `social` entry); `sector_stats.ts` (EIK-set). Renders the real ~€285M
6-EIK group with scope, awarders tile, spend-by-year, top-contractors. **Delivers the redundancy fix + a
real АСП/МТСП dashboard.**

**Phase 2 (~1–2d) — bespoke `SocialPack` off Tier-A data.**
Files: `src/lib/socialAttributes.ts` (classifier + `buildSocialModelFromAggregates`);
`src/data/procurement/useSocial.tsx` (universe filter + two `useAwarderGroupModel` calls for a
filter-invariant group total); `src/screens/components/procurement/social/` — `SocialPack.tsx` +
`SocialBudgetBridgeTile` (iceberg + benefit-mix from `useBudgetMinistryRollup`), `SocialCategoryTile`,
`SocialCompetitionTile`, `SocialEuPeerTile` (GF10), `SocialPovertyImpactTile` (§4.4 before/after **dumbbell**
— fetch `ilc_li10` + `ilc_li02`; AROPE trend already in `series.povertyRate`), and `SocialValueForMoneyTile`
(§4b scatter — `peers.GF10` × per-country li10−li02, reuses the `/indicators/compare` scatter pattern).
Also build the shared `PassThroughHero` (§5, confirmed new). Register `SocialPack` in `PACKS`. AI
`socialSpending` tool. Everything off already-ingested data (only the small li10/li02 Eurostat series is new,
as static `data/social/*.json` per §11).

**Phase 3 (~2–3d) — the АСП benefit ingest (the flagship) + outcomes.**
Files (revised per §2.1 — national/annual static JSON, no PG): `scripts/social/fetch_asp_benefits.ts`
(**`pdftotext -layout` + regex over the АСП annual report PDFs** → static `data/social/benefits.json`; NO
egov, NO PG table, NO migration); `src/data/social/useSocialBenefits.tsx`; tiles `SocialHeatingAidTile`
(**national headline + season trend, NOT OblastChoropleth**), `SocialBenefitCoverageTile` (child-allowance
coverage, national); `update-social` skill + `asp_benefits` watcher (**cadence `yearly`**) + process-watch
mapping; `data_map/model.ts` (`social` SOURCE_GROUP + DATASET `data/social/` + `src:social→ds:social` edge +
`/^\/social\//` AI_PATH_RULE); AI tool `socialBenefits` (**drop `heatingAidByOblast`** — no oblast data;
fold heating into `socialBenefits`); README section + `/data` pages; `recent_updates` changelog. Optional
Phase 3+: ГИТ inspection tile + watcher.

---

## Open questions

**All four resolved as of 2026-07-17 — see the section noted on each. Nothing blocks the build.**

1. ~~**АСП benefit-stats source shape**~~ — **RESOLVED (§2.1).** National/annual, from the АСП report PDFs
   (`pdftotext`); no oblast breakdown published anywhere. Heating-aid tile = national headline + season
   trend, not a choropleth. Static `data/social/benefits.json`, no PG.
2. ~~**The €15bn split**~~ — **RESOLVED (the NOI×COFOG join table just below).** GF10 €15.09bn =
   НОИ €12.64bn + МТСП/АСП €1.46bn + ~€1bn residual; no COFOG-subfunction footnote needed.
3. ~~**АСП name-pin blast radius**~~ — **RESOLVED in §0.5 audit.** Only `CompanyDbScreen.tsx:490`
   consumes `canonicalAwarderName`, and it is the `/awarder/:eik` route element — the pin flips the header
   cleanly; no other surface hard-codes "Видин"; `SectorAwardersTile` chips already read canonical
   `SOCIAL_ENTITIES` names. Just add the pin.
4. **Lead EIK** — МТСП (ministry/principal, chosen here for the security/transport parity) vs АСП (the
   actual disbursement star). МТСП recommended (its awarder page suppresses the pack + links to the sector,
   the МО/МТС pattern); АСП remains the most prominent member chip + the star of the benefit tiles.

**Q2 (the €15bn split) — RESOLVED from local data (2026-07-17).** Join `data/budget/noi/funds.json`
(NOI ДОО cash-execution) against `data/cofog.json` `series.GF10.valueEur`:

| Leg | 2024 €bn | Source | Hero label |
|---|---:|---|---|
| GF10 social protection (whole bar) | **15.09** | `cofog.json series.GF10` (2024) | — |
| НОИ ДОО disbursement | **12.64** | `noi/funds.json` totals.expenditure | → cross-link `/pensions` |
| — of which pensions | 11.13 | `noi/funds.json` totals.pensions | |
| — of which short-term benefits | ~1.5 | (ДОО exp − pensions) | |
| МТСП / АСП disbursement | **~1.46** | budget node FY2024 total | → **this view** |
| Residual (municipal social services / other) | **~1.0** | GF10 − НОИ − МТСП | "друго" sliver |

So the §4.2 hero partition is a clean, defensible join — **no COFOG-subfunction footnote hedge needed.**
The group's annual procurement (~€19M/yr) is a ~1% sliver of the МТСП €1.46bn leg, a ~0.1% sliver of GF10 —
the iceberg framing holds and quantifies.

**Q1 (АСП benefit-stats source shape) — RESOLVED by live probe (2026-07-17). See §2.1 for the full
verdict.** Headline: **a per-oblast heating-aid choropleth is NOT feasible** — АСП publishes
**national-only, annual, PDF** (the `Годишен отчет за дейността`); there is NO per-oblast recipient/amount
breakdown for any benefit, on egov (register datasets only) or NSI (ESSPROS national-only; regional section
has no социално подпомагане recipient series). §4.5 must be reframed national-with-benefit-split.

**Nothing is now open.** Phases 1–2 (redundancy fix + full budget/outcome/EU-peer dashboard, incl. the
resolved hero split) are unblocked off already-ingested data; Phase 3 is now fully scoped (national-annual
benefit series from the АСП report PDFs — §2.1).
