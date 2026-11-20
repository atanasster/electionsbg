# Health hub v1: `/sector/health` becomes a sector dashboard

**Status: PLAN, 2026-11-20. §0 is OPEN — the operator decides D1–D5 before `/implement-plan`
runs.** The "default proposed" column is what the tiers below assume.

**Templates** (closest first):
- `edu-hub-v1.md` (this folder) — the last generic `/sector/:id` page turned into a hub, shipped
  2026-11-20: tier structure, head and KPI band, 4/4/4 bands, T9 gates.
- `transport-hub-v1.md` — shipping order, `?mode`-style page-local params.
- Shipped code: `src/screens/edu/*`, `src/screens/transport/*`,
  `scripts/db/gen_{edu,transport}/hub_stats.ts`.
- The existing health surface: `src/screens/components/procurement/nzok/NzokPack.tsx` (the
  thematic pack on `/awarder/121858220`, ~25 tiles), `src/lib/healthReferenceData.ts`,
  `src/lib/mzSecondLevelBodies.ts`, `NzokSearchBox`.

**Governing skills.** `dashboard-hub` owns what is visible, `sector-dashboard` owns what is
countable, `audit-sectors` is the method for T9.

**How the figures were measured.** Local PG (5433), 2026-11-20, `tag='contract'`. Cloud SQL
was not checked; T8 step 1 re-measures §1 there before anything ships.

**What is different from edu.** Health already has the richest dataset on the site — НЗОК's
hospital payments, drug reimbursement, activity, tariffs, hospital financials and a risk
index — but all of it lives inside one awarder page (`/awarder/121858220`), while
`/sector/health` is the generic procurement dashboard, whose subject (ЗОП procurement) is
about 2% of НЗОК's spending. So most of this plan is moving the content: few new figures, a
new home and a different starting question: „къде отиват здравните пари" (where the health
money goes), not „какво купува НЗОК" (what НЗОК buys).

---

## 0. Decisions (STOP: operator's call)

| id | question | options and measured impact | default proposed |
| --- | --- | --- | --- |
| **D1** | **Universe.** Today the roll-up is НЗОК + МЗ. МЗ's 55 second-level budget units (28 ЦСМП + air ambulance, 23 РЗИ, НЦОЗА; `mzSecondLevelBodies.ts`) are reachable from the finder only. Their principal is МЗ. | Adding them: **+€86.9M** procurement (+3.0%). Hospitals: 283 awarders by name, **€10.89bn**. They are commercial companies (ЕАД/ООД), the PAYEES of НЗОК money and not budget units, so adding them to the roll-up would count the same euro twice: once as a НЗОК payment and again as hospital procurement. | Add the 55 as universe `mz_bodies` in the roll-up. **Hospitals stay outside**: shown as recipients, with their own procurement as a separately labelled figure that is never summed into the total. |
| **D2** | **Headline basis.** KPI 1 is НЗОК's cash expenditure (`sector_stats.health`, `basis='payout'`, **€4,715,308,021, 2025**), or something narrower. | НЗОК 2025 expenditure €4.72bn. Hospital payments in the corpus (bmp+devices+drugs, 2025) **€3.13bn**. Pharmacy drug reimbursement (`nzok_drug_quarterly`, 2025) **€1.62bn**. МЗ's own budget is not added: transfers from МЗ to НЗОК would double-count. | Keep **€4.72bn НЗОК expenditure** as KPI 1, which is the same basis as `/governance/sectors`. The other figures are shown as parts of it with their own basis lines, never summed with it. |
| **D3** | **Framework ceilings.** 34 МЗ rows with `joint_kind='framework'`: **€1,311.3M**, i.e. **46% of МЗ's €2.84bn**. 18 of them, €1,306.7M, are the 2025 central-purchasing drug framework `00080-2024-0030`. Hospitals place the call-offs. | (a) keep them in the total with a caption; (b) exclude them from KPI 1/procurement and show them as their own line „рамкови споразумения: таван, не разход" (framework agreements: a ceiling, not spending); (c) count them at 0. | **(b).** With the ceiling counted, МЗ's 2025 procurement reads €1.51bn, roughly 7× its normal year. Excluding it, 2025 is €203M, in line with other years. |
| **D4** | **What happens to NzokPack on `/awarder/121858220`?** | (a) the hub sub-pages render the same tile components, and NzokPack stays as it is for v1; (b) the tiles move to the hub and the awarder page becomes a plain awarder page (the MonPack move in edu). | **(a)** for v1. NzokPack is ~25 tiles, linked from many places, and `/awarder/121858220` is well indexed. Move them in v2, after the hub's sub-pages are indexed. |
| **D5** | **Hospital pages.** Is there a `/sector/health/hospitals` list page? | The hospital map, payments, momentum, regional choropleth and public/private band already exist as tiles. | Yes: `/sector/health/hospitals` is the payee-side sub-page. Per-hospital pages stay on `/company/:eik` with the existing `NzokReportCardTile` (no new page family; that is a file-count matter). |

---

## 1. Measured baseline

### Procurement by body (all scope, local PG, `tag='contract'`, 2011-01-05 → 2026-11-18)

| body | rows | € | single-bid* |
| --- | --- | --- | --- |
| МЗ `000695317`, excluding framework ceilings | 5,577 | €1,527.1M | 16.6% |
| МЗ, framework ceilings (`joint_kind='framework'`) | 34 | €1,311.3M | — |
| НЗОК `121858220` | 1,713 | €84.5M | 51.1% |
| МЗ second-level family (55 EIKs, today NOT in the roll-up) | — | €86.9M | — |
| hospitals by name (outside, D1) | 283 awarders | €10.89bn | — |

\* share with one bidder among rows with a known `number_of_tenderers`. The bidder count is
known for 81.8% of МЗ rows and 72.6% of НЗОК rows. National, all time, excluding members:
**41.8%**. T4 replaces this all-time comparison with the same-window one.

### МЗ by year (€M, split by kind)

| year | other | call-off ("по рамково споразумение") | ceiling |
| --- | --- | --- | --- |
| 2019 | 31.6 | — | — |
| 2020 | 32.8 | — | — |
| 2021 | 252.0 | 104.8 (1,207 rows) | 4.5 |
| 2022 | 73.6 | 7.9 | 0.0 |
| 2023 | 238.4 | 0.0 | — |
| 2024 | 105.4 | 0.2 | — |
| 2025 | 203.2 | 0.1 | **1,306.7** |
| 2026 | 115.9 | 0.1 | — |

The 2021 spike is the COVID year: 1,207 call-offs from МЗ's own framework (РД-11-277), plus
direct purchases from Рош and Софарма. The 2023 figure contains the €153.5M Leonardo S.p.A.
air-ambulance contract (2023-03-31, negotiated without notice).

### НЗОК money (the headline side)

| figure | 2023 | 2024 | 2025 | 2026 YTD |
| --- | --- | --- | --- | --- |
| НЗОК expenditure, B1 (`execution_history.json`) | €3,519M | €4,167M | **€4,715M** | €3,406M (Aug) |
| НЗОК "revenue", B1 ЕБК line | €2,223M | €2,576M | €2,898M | €2,080M |
| hospital payments: bmp (facilities paid) | €1,703.7M (249) | €1,996.8M (254) | €2,270.7M (258) | €1,709.3M (258) |
| hospital payments: drugs | €555.7M (39) | €692.5M (42) | €798.8M (44) | €752.4M (45) |
| hospital payments: devices | €39.1M (90) | €49.0M (92) | €58.6M (94) | €70.5M (99) |
| pharmacy drug reimbursement (`nzok_drug_quarterly`, INNs) | €1,183.3M (537) | €1,409.2M (563) | €1,621.5M (584) | €432.1M (Q1) |

Facility counts use `month_eur <> 0` (finding A2). The payment corpus runs to 2026-10, 46
periods.

### Reach per corpus (`sector-dashboard` §5)

| corpus | НЗОК | МЗ | note |
| --- | --- | --- | --- |
| `contracts` | ✅ | ✅ | above |
| `fund_projects` (ИСУН) | 0 | **€738.3M** grant | EU money for МЗ projects (EIK-exact) |
| `nzok_*` | ✅ | — | the payee side: hospitals, drugs, activity |
| budget (`admin-ministerstvo-na-zdraveopazvaneto.json`) | — | ✅ | МЗ's budget by year; not summable with НЗОК (transfers) |

---

## 2. Audit findings and where each is fixed

### Data (caption or fix; none hidden)

- **A1 (framework ceiling, STOP → D3).** 46% of МЗ's procurement is framework ceilings. The
  generic dashboard sums them into the total and into the by-year chart, so 2025 reads €1.51bn,
  and the „top contracts" list opens with framework rows that are ceilings, not money spent.
  T1/T2 split them.
- **A2 (placeholder zeros).** `nzok_hospital_payments` has 2024 rows with `month_eur = 0` in
  the devices/drugs streams. A `count(DISTINCT eik)` without `month_eur <> 0` inflates the
  number of facilities paid. Every count in the hub blob filters on it; T9 gates it.
- **A3 (revenue < expenditure).** B1's ЕБК „приходи" line is **61–63%** of expenditure every
  year (2025: €2.90bn of €4.72bn). The likely reason is that the state-budget transfers for the
  insured it pays for are booked as трансфери, not приходи. **This is not established — check
  it in T1 against the B1 form.** Until then, nothing on the hub may show revenue next to
  expenditure as if the two were comparable: that pairing reads as a €1.8bn deficit.
- **A4 (one contractor, four spellings).** Софарма Трейдинг АД (`103267194`) appears under
  four name spellings (€130.4M + €98.5M + €7.2M + €2.3M), plus two consortia (`obed-`). The
  EIK is the same, so EIK-grouped lists are correct. Any NAME-grouped list on the new pages
  must group by EIK and render the latest name. T9 asserts it.
- **A5 (headline basis label).** `sector_stats.health` is labelled `payout`, but its value is
  НЗОК's TOTAL cash expenditure (administration included), not payments to providers. The KPI 1
  basis line says „касови разходи на НЗОК" (НЗОК cash expenditure), never „плащания към
  болници" (payments to hospitals).
- **A6 (second-level family invisible).** €86.9M of procurement by 55 МЗ budget units shows up
  in no total and in no list except the finder (→ D1).
- **A7 (competition reads two ways).** МЗ's 16.6% single-bid rate is far below the national
  rate, while НЗОК's 51.1% is above it. They are different kinds of buyer: МЗ buys drugs and
  vaccines centrally, while НЗОК's contracts are mostly IT and services. The page shows them
  as two rows against one same-window baseline, never as one blended rate.
- **A8 (large non-competitive items).** Leonardo €153.5M (2023, negotiated without notice) and
  the COVID-year direct drug purchases dominate the non-framework top list. Caption them by
  procedure type; do not flag them (`audit-sectors`: statutory sole-source is not weak
  competition by itself).

### Page

- **P1.** `/sector/health` is the generic procurement dashboard. Its whole subject is ~2% of
  the sector's money, and the content readers need (hospitals, drugs) is two clicks away, on
  an awarder page.
- **P2.** The governance hub tile for health links to `/sector/health`. It keeps that URL, so
  only the page under it changes.

---

## 3. Target shape

```
/sector/health              hub (unscoped; links carry ?pscope=all where the target is scoped)
/sector/health/hospitals    #map · #payments (bmp/drugs/devices, facilities paid) · #momentum
                            · #regions · #ownership (public/private) · #financials · #risk  („без период")
/sector/health/drugs        #pharmacy (nzok_drug_quarterly) · #trend · #savings · #unit-price
                            · #overpay · #hospital-drugs                                      („без период")
/sector/health/procurement  #spine (by year, kind split per D3) · #frameworks · #competition (same-window)
                            · #contractors (EIK-grouped, A4) · #top-contracts · #bodies         (scoped)
/sector/health/money        #nzok-budget (B1 execution, A3 caption) · #mz-budget · #funds (ИСУН, МЗ)
                            · #activity (cases, pathways, tariffs)                            („без период")
```

- Fragment ids are this set only. The registry test checks that every `#fragment` a tile
  emits exists on its destination. Every sub-page runs `useHashScroll`.
- **`?universe=<nzok|mz|mz_bodies>`** on `/procurement` only; page-local, validated on read.
- `?ownership=<public|private>` on `/hospitals`, reusing `OwnershipFilter`.
- The `/hospitals`, `/drugs` and `/money` pages have no ScopeControl (their corpora are
  monthly/quarterly time series). They resolve an inbound `pscope` (transport O1) and show
  „без период" (no period).
- The sub-pages render the existing Nzok tile components (D4a). No tile is forked; a tile that
  needs a prop to sit on a new page gets the prop.
- `SECTOR_DASHBOARDS.health` becomes INERT once the bespoke hub is routed ahead of
  `sector/:id` (the roads pattern): keep `members` and the browse pack.

### Head (dashboard-hub §3.0)

- **Breadcrumb:** Управление › Сектори › Здравеопазване.
- **Eyebrow:** „СЕКТОР · ЗДРАВЕОПАЗВАНЕ · обновено dd.mm".
- **Deck:** „къде отиват парите на здравната каса: болници, лекарства, поръчки и кой ги
  харчи" (where the health fund's money goes: hospitals, drugs, procurement, and who spends
  it). `seoDescription` is a separate sentence.

**KPI band:**

| # | value | basis line | links to |
| --- | --- | --- | --- |
| 1 | **€4,72 млрд.** | „касови разходи на НЗОК за {year}, отчет B1" | `/sector/health/money#nzok-budget` |
| 2 | **€3,13 млрд. към {n} болници** | „плащания по договори с НЗОК за {year}: болнична помощ, лекарства, изделия · {n} лечебни заведения с плащане" | `/sector/health/hospitals#payments` |
| 3 | **€1,62 млрд. лекарства в аптеките** | „реимбурсирани лекарства, {n} INN, {year}" | `/sector/health/drugs#pharmacy` |
| 4 | **€1,61 млрд. поръчки** | „договори на НЗОК, МЗ{ и 55 второстепенни разпоредители}, {first}–{last}, без таван на рамкови споразумения · {pct}% с една оферта при {nat}% средно" | `/sector/health/procurement?pscope=all` |

- `kpiNote`: KPI 2 and KPI 3 are PARTS of KPI 1 (paid out of it). KPI 4 is a different basis.
  The four are never summed.
- KPI 4 depends on D1 and D3; the figure above is €1,527.1M + €84.5M (+ €86.9M under D1).
- Evidence rail: the top 5 hospitals by 2025 НЗОК payments → `/company/:eik`.
- Finder: `HubSearch` over the bodies (all lists, incl. the 55), hospitals (`nzok_hospital_geo`),
  drugs by INN (`/molecule/:inn`) and contracts. It reuses the `NzokSearchBox` index.

### Bands (4/4/4)

| band | tiles → destination |
| --- | --- |
| **Болниците**: „колко получава всяка болница и за какво" (how much each hospital gets, and for what) | map → `/hospitals#map`; payments by stream → `#payments`; growth (momentum) → `#momentum`; public vs private → `#ownership` |
| **Лекарствата**: „аптеки, болници и цени" (pharmacies, hospitals and prices) | pharmacy reimbursement → `/drugs#pharmacy`; quarterly trend → `#trend`; above-median prices → `#overpay`; hospital drugs → `#hospital-drugs` |
| **Поръчки и бюджет**: „какво купуват касата и министерството" (what the fund and the ministry buy) | procurement by year (D3 split) → `/procurement#spine`; framework ceilings → `#frameworks`; НЗОК budget execution → `/money#nzok-budget`; EU funds (МЗ) → `/money#funds` |

Copy is inline `{bg,en}` in `healthRegistry.ts`, as in edu/transport.

---

## 4. Tiers

### T0: register and stale copy (ships and deploys alone)
1. `healthReferenceData.ts`:
   - four-list shape;
   - D1 (`mz_bodies` from `mzSecondLevelBodies.ts`, imported rather than restated);
   - hospitals in the anti-allowlist with a reason;
   - dated header figures.
2. `mzSecondLevelBodies.test.ts`: its disjointness assertion inverts. The 55 are now members;
   the test keeps them disjoint from the excluded and adjacent lists.
3. Regenerate `sector_stats.json`: health is `basis='payout'` and must not move. Verify that it
   does not.
4. Regenerate `functions/generated/procurement_query.js`. If D1 adds members, the server-side
   `?sector=health` filter keeps the old roster until it is rebuilt AND `deploy:db` ships it.

### T1: engine corrections (bug fixes, fixture tests)
- D3: the framework-ceiling split in the group roll-up (`awarder-group-*`): a
  `joint_kind='framework'` arm returned separately, not summed into the total or the by-year
  spine. Check first whether edu or transport already added a hook for this.
- A3: confirm what B1's revenue line covers. If it is the transfers, the revenue series either
  gets the трансфери line added or is not rendered beside expenditure.
- A4: confirm the contractor list groups by EIK (it should, via `contractor_eik`); add the
  fixture.

### T2: hub blob
`scripts/db/gen_health/hub_stats.ts` → `data/health/derived/hub_stats.json`. Check
`bucket_sync_paths.isExcluded` first (skill §11 rule 2). Contents:
- KPI 1–4 with numerators and denominators un-divided, and `year`/`firstDate`/`lastDate`;
- facility counts with `month_eur <> 0` (A2);
- procurement per universe, the framework ceiling as its own field (`frameworkCeilingEur`, never
  folded into `procurementEur`);
- national baseline via `national_competition(NULL,NULL)`, the same whole-corpus window as the
  figure.

Inputs are `contracts`, `nzok_hospital_payments`, `nzok_drug_quarterly` and
`execution_history.json`. Register the generator in `REFRESH_GENERATORS` with `bucketPath`, and
put it in the `db:refresh` chain after the last of those (the nzok family). Add the order
pair.

### T3: hub, sub-pages and page layer, in ONE commit
- `src/screens/health/`: `HealthHubScreen`, `HealthHospitalsScreen`, `HealthDrugsScreen`,
  `HealthProcurementScreen`, `HealthMoneyScreen`, `HealthPageFrame`, `healthRegistry.ts`,
  `healthScenes.tsx`, `healthHubFigures.ts`.
- Routes before the generic `/sector/:id`. `SECTOR_DASHBOARDS.health` becomes inert.
- Prerender + sitemap for all five pages × 2 languages; og image.
- English head strings name the bodies in English (the edu lesson: no Cyrillic acronyms in
  `/en` titles).
- Open every page in both languages and compare the runtime `<title>`/`<h1>` against the
  prerender (`dashboard-hub` §12). Read `dist/` directly, never through `vite preview`.

### T4: same-window baselines
Competition per universe (НЗОК and МЗ as separate rows, A7) against the same-window national
rate (`national_competition(from, to)`), coloured as in transport T4. The scoped
`/procurement` page computes them live.

### T5: money page
- НЗОК B1 execution by year (A3 caption or the transfers fix).
- МЗ budget by year from the ministry node. A footnote states that the two are not summed
  (МЗ transfers to НЗОК).
- `fund_projects` for МЗ grouped by programme, grant basis.
- Activity: cases, pathways and tariffs. These are the existing tiles; their case-mix guards
  stay as they are.

### T6: finder
`healthSearch.ts`: bodies (all lists), hospitals, INNs and contracts. Bodies resolve to
`/awarder/:eik`, hospitals to `/company/:eik`, INNs to `/molecule/:inn`.

### T7: reload and publish path
- `process-watch-report` / `update-nzok` / `update-procurement` name the regen and
  `bucket:sync:paths health/derived/hub_stats.json`.
- Run `db:check-generated` after the bucket sync.
- `cloud_loader_coverage.test.ts` stays green.

### T8: shipping order
1. Cloud SQL reachable; re-measure §1 there (procurement per body, the 2025 payments).
2. `bucket:sync:paths` for the blob and `sector_stats.json`.
3. If a route changed, `deploy:db` first. Then `deploy` → `deploy:db` →
   `SKIP_PREDEPLOY=1 deploy` (the CLAUDE.md three-step rule).

### T9: gates (last, separate) + `/audit-sectors` pass
- Corpus sweep over BOTH corpora: every health-like buyer above €0.5M (ЦСМП, РЗИ, НЦОЗА,
  "здрав" names) sits in exactly one list, with hospitals in the excluded list (would have
  caught A6).
- KPI 4 equals `awarder-group-model` over the roster minus the framework arm, for every scope.
  The framework arm equals `sum(amount_eur) WHERE joint_kind='framework'` re-derived from
  `contracts` (mutation-checked: put the arm back into the total and watch the gate fail).
- Facility counts re-derived with and without `month_eur <> 0`; the gate fails if they are
  equal while placeholder rows exist (A2).
- KPI 2 and KPI 3 each stay below KPI 1 for the same year (parts of the whole).
- No name-grouped contractor list (A4).
- KPI 4's baseline window equals the figure's window.
- Every `?universe`/`?ownership`/`#fragment` a tile emits is read by its destination.
- Each gate is broken once by hand to watch it fail.

---

## 5. Not in v1
- Moving the NzokPack tiles off `/awarder/121858220` (D4b).
- Hospitals' own procurement in the roll-up (D1). It is shown, labelled, never summed.
- Hospital call-offs under the МЗ central framework, matched back to the ceiling (needs a
  call-off ↔ framework join the corpus does not carry reliably).
- Per-capita health spending by oblast (needs a residence-based denominator; the
  hospital-location basis is not one).
- A `/person` bridge for hospital directors.
