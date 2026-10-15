# Transport hub v1: `/sector/transport` becomes a sector dashboard

**Status: IMPLEMENTATION PLAN, audited 2026-10-16.**
- D1–D8 are accepted.
- D9 has a default applied and is flagged for confirmation (§0).
- Nothing is implemented yet.

**How the plan was checked.** It went through three audits on 2026-10-16:
- a first data audit against local PG, findings **A1–A16** (§2);
- a claims/feasibility audit against the code, findings **B1–B5** (blockers), **C1–C11**
  (corrections) and **O1–O11** (omissions);
- a second data audit that re-measured every number with the decisions applied and swept for
  surfaces the first one missed, findings **G1–G16**.

Every finding is folded into the tier that fixes it, with its id kept beside the fix.

⚠ **Cloud SQL was unreachable for all three audits** (the proxy on 5434 was down). Every figure
is local. T8 step 1 is a gate, not a formality (O10).

**Templates.**
- `roads-hub-v1.md` for the tier structure, the shipping order (§5) and its post-implementation
  checklist (§7). Roads was the last migration off the generic `/sector/:id` shell, so it is the
  closest precedent.
- `water-hub-v1.md` for the `PageFrame` / sub-page split, the „data fixes ship first" T0, and its
  G-list.
- `culture-investigative-v1.md` §1.7 for the blob.
- Shipped code: `src/screens/roads/*`, `src/screens/water/*`, `scripts/db/gen_{roads,water}/hub_stats.ts`.

**Governing skills.** `dashboard-hub` owns what is visible, `sector-dashboard` owns what is
countable, and `audit-sectors` is the method. Implement with `/implement-plan`, one tier per step,
with the gates as their own step.

**Prior transport work.** All five steps of `transport-sector-audit-v1.md` (2026-08-13) shipped.
The intra-group figure over the 15 EIKs is still exactly €1,033.67M.

---

## 0. Decisions

### Accepted by the operator, 2026-10-16

| id | decision | measured impact |
| --- | --- | --- |
| **D1** | **Universe unchanged:** `principal = МТС`, the movement of people and goods. Roads and „съобщения" are excluded. The anti-allowlist stands. | — |
| **D2** | **Летище Пловдив ЕАД (`115007069`) joins the aviation roll-up.** It is a 100% state airport operator, the same class as Летище София. All 11 of its contracts are fuel (CPV 09*). | Headline +€1,060,265: all-scope €7,291,970,626 → **€7,293,030,892**. The default `ns:2026_04_19` is unchanged (no rows). y:2024 €975,008,893; y:2026 €1,663,745,373. 17 tenders / €3.0M estimated. It becomes the 16th entity and the first non-Sofia aviation seat on the facility map. |
| **D3** | **„Дунав мост Видин–Калафат" АД (`202623635`) goes on the register's VERIFY list:** shown, not in the roll-up (sector-dashboard §1). TR holds no owner rows for an АД, and public sources describe a joint BG–RO operating structure, so the principal cannot be settled from what we hold. Do not decide by name. | €11,744,530 / 53 contracts; 45 tenders / €21.3M. 0 on the headline. |
| **D4** | **ТСВ ЕАД (`205677435`), ДП ТСВ's corporatised successor, is an in-group CONTRACTOR.** It goes in a new `TRANSPORT_INGROUP_CONTRACTORS` constant, never in the awarder set (the roads in-house shape). | In-group € €1,033.7M → **€1,139,833,719 = 15.63%** of the E+P headline. y:2026 €990.3M (59.5%); default scope €0.88M (0.77%); y:2024 €22.8M; y:2025 €9.4M. |
| **D5** | **No netting.** KPI 1 stays the gross awarder-side Σ (= `sector_stats`). The in-group € is its own KPI. | — |
| **D6** | **EU funds are shown on the grant (БФП, `fund_projects.grant_eur`) basis**, with total project value as a secondary line. Rolled from `fund_projects` (A11). | НКЖИ contracted €3.19bn → grant **€1.50bn**; absorption 30.8% → **65.9%**. МТС paid €441.5M → **€510.7M**. |
| **D7** | **The project map leads the hub's „Къде" band.** The facility map moves to `/sector/transport/bodies#map`. | — |
| **D8** | **KPI 2 re-attributes the ministry's rail contracts to rail (A9, C9).** The rule: МТС rows with CPV `6021*` (PSO, 3 rows, €1,396.3M) or `346*` (rolling stock, 8 rows, €937.4M; all are `34600000`, *not* „3462" as the first draft said). The KPI's basis line names the rule. The raw by-awarder share stays visible on `/procurement#modes`. | Rail share all-scope **89.0%** (raw 57.0%). y:2024 86.8%, y:2025 89.4%, y:2026 95.4%, ns:2024_10_27 94.1%. **Default scope stays 56.1%**: no МТС rail rows fall in that window. Write „89%", not „~90%". |

### Default applied, operator to confirm

| id | question | default | why |
| --- | --- | --- | --- |
| **D9** | **Български пощи** (anti-allowlisted, МТС-owned) wins **€72.4M** from НКЖИ, all meal vouchers (CPV 98000000; €52.0M direct + €20.4M through a consortium). It is in-group in substance, but D1 keeps it out of the sector, and D4 does not reach it (G8). | **Not in KPI 4.** Listed as „държавно дружество на МТС извън сектора" in a disclosed state-bodies list beside the in-group tile, together with НЕК €14.3M, НАИМ-БАН €9.37M, ДАО €2.3M, ЦГМ €1.74M and Информационно обслужване €1.59M. | Adding it to KPI 4 would change a KPI basis on a body the universe rule excludes. Disclosing it changes no figure. Flip only on the operator's word. |

### Reversed by the second data audit

- **A4 is NOT a mislabel (G4).** OCDS `limited` means invitation-only. Of the €27.7M at the
  default scope, the €6.4M that joins a tender by УНП is **entirely** „Договаряне без
  предварителна покана / без предварително обявление" or „Пряко договаряне". The remaining
  €21.3M (БУЛАТСА) has no tender match. „Без обявление" is therefore the honest label.
- The first draft's proposed relabel would also have been a corpus-wide basis change (B2):
  - `procedureBucket` is shared by 14 files;
  - its SQL mirror feeds the risk index (041:59);
  - corpus-wide, `limited` is 4,186 contracts / €1.28bn over 853 buyers.
- So that change is **dropped**. What survives of A4 is the coverage half, now in T1.

---

## 1. Measured baseline (2026-10-16, local PG, 417,605-row corpus)

`E` = the 15 EIKs of `TRANSPORT_SECTOR_EIKS` at `tag='contract'`; `E+P` adds Летище Пловдив (D2).

| scope | `sector_stats.json` (E) | PG (E) | PG (E+P) |
| --- | --- | --- | --- |
| all | €7,291,970,626 | same ✅ | €7,293,030,892 |
| ns:2026_04_19 (default, open) | €114,054,056 | same ✅ | same |
| ns:2024_10_27 | €2,750,202,162 | same ✅ | €2,750,369,984 |
| y:2024 / y:2025 / y:2026 | €974.9M / €1,152.3M / €1,663.6M | same ✅ | €975.0M / €1,152.3M / €1,663.7M |

**What reconciles today:**
- the 92 amendments (€340.6M) are excluded;
- obed- carriers (€252.6M) are counted once;
- the five EIK copies are in lockstep (`transport_facility_geo`: 15 rows, София 12, Варна 2,
  Русе 1);
- the anti-allowlist holds;
- the default head figures reproduce: €114.1M, 10 structures, rail 56.1%;
- the „Подвижен състав" €35.4M and „24% без обявление" (`limited` €27,695,073) are
  arithmetically right. Their meaning is not (A3, G4).

**KPI 3 basis (all-scope, ex-members):**
- E+P: **1,386 / 3,695 = 37.51%**, so D2 rounds it from 37% to **38%**;
- national `national_competition(NULL,NULL)`: `singleBidExMembers` 108,591 / `bidKnownExMembers`
  260,171 = **41.74%**;
- bid-count coverage is **3,695 of 5,775** non-member rows (64%), and that coverage goes on the
  basis line;
- the member-inclusive 061 pair reads 35.3%, i.e. biased *down*.

**The time spine has a 2020 hole that is corpus-wide, not transport's (G1).** Nationally there
are 4,629 contracts in 2020, against 24,443 in 2019 and 31,409 in 2021.

**Annex growth (G5)** is `procurement_annexes.value_diff_eur` = **€170.7M = 2.34%** all-time over
271 contracts. It is a floor: the annex data starts in 2020.
- y:2024: €74.1M (7.6%).
- Signing year 2022: €55.6M (26.7% of that year's €).
- Largest: Шкода +€65.4M; Tesmec +€35.2M and +€14.1M.

---

## 2. Findings and where each is fixed

### Engine defects, fixed in T1 (bug fixes, no STOP)

| id | defect | measured | fix |
| --- | --- | --- | --- |
| **A1** | `transport_project_map()` (076) counts €0 consortium-member rows: the roads R10 defect. | Видин→София shows 11 contracts, really 2 carriers + 9 members. Банско 7 → 4, single-bid 75%. All-scope, 175 member rows are linked; 12 at the default scope. | `consortium_role IS DISTINCT FROM 'member'` in the `base` CTE. |
| **A2 / C1** | Contract counts and single-bid counts include members everywhere on the page. | Group default scope 79/204 → **74/184 = 40.2%**. БУЛАТСА 24/46 → 21/43. All-scope contractCount 6,146 → 5,764 (5,775 with P). | **Do not migrate 061** (it has no applier, `awarder_group_model.data.test.ts:47`). Use the deployed `awarder-group-rollup?exMembers=1` route for per-unit counts (db_routes.js:3206-3231, the water `useVik.ts:199` precedent). **132 has its own `base` CTE** (132:55-68) and needs its own member filter. |
| **A3 / O6** | `categoryOfCpv` sends all of division 34 to „Подвижен състав". | Default scope €14.9M moves out (3494 €6.7M + 3496 €8.2M), leaving **€20.5M** of vehicles. All-scope €188.3M moves. CPV 64: €5.70M all-scope. | Route `3494*` → track and `3496*` → signalling/IT **before** the div-34 rule. Rewrite `CATEGORY_CPV_DIVS` (transportAttributes.ts:101) to explicit prefixes (341–348, 3491–3493, 3495, 3497–3499) so the deep link agrees. State where CPV 64 lands, and drop „и съобщения" from the label (D1). New `transportAttributes.test.ts` mirror test (the `socialAttributes.test.ts` shape), with fixtures on the Saab 34962100 row and the 3494 sleepers. |
| **A4 (residue) / G4** | The „без обявление" denominator includes rows with no method. | Default scope €0.41M. **All-scope method NULL = €2,750.3M (37.7%)** (aop €2,459.1M, eop €190.0M, rop €101.2M). „Вътрешен конкурентен избор по РС" (€25.7M) falls through to `other`. | Keep the label and `?proc=direct`. Compute the share over **method-known €** and put the coverage in the basis line. Do not touch `procedureBucket` (B2). The РС spelling is a corpus-wide bucket question: spin it off, not v1. |
| **A5** | The project-map loader's `\bпорт\b`, `\bкей\b`, `\bгара\b` and `\bгарата\b` never match (JS `\b` is ASCII-only), and the default type is `rail`. | „София — Жп обект" is mostly БУЛАТСА ATC, МТС air-conditioning and depot gas. „Банско" is БУЛАТСА's УВПБ hotel. | `(?<![\p{L}\p{N}])порт(?![\p{L}\p{N}])` with the `u` flag. The default type follows the awarder's universe (aviation/maritime/road/ministry), with an „обект" fallback. Each new type needs its legend entry in `TransportProjectMap.tsx` (C3; „летищ" maps to `junction` today). |
| **A6 / G15** | Any title naming two towns becomes a „Жп участък" segment. | 270 segment links: 38 from non-rail awarders (aviation 20, maritime 16, ministry 2). | Mint a segment only for rail-universe awarders whose title carries жп линия / участък / отсечка / междугарие (Cyrillic-safe boundary). That keeps **128 of 232** rail segments (103 ex-members), €1,174.9M of €1,342.4M. Other two-town titles become **one** unplaced row, never two pins: the link PK `(key, a_town, b_town)` would otherwise put the € on both (C3). |
| **A7 / C4 / G15** | The parent line beats the section, and villages are unresolvable. | Видин–София is drawn for Медковец–Срацимир supervision. 3,247 unplaced non-member rows / €4,850M. | Prefer „участък X–Y" over „линията A–B". Add a village pass through `EkatteResolver` (resolve_ekatte.ts:120, committed `data/ekatte_index.json`) that **accepts only unique whole-name, multi-word-safe hits and counts the refusals**. Measured homonyms: Елин **Пелин** → „Пелин", Горна **Оряховица** → „Оряховица". The pass places 128 rows / €385M, taking all-scope coverage ~29% → ~34%. Харманли–Свиленград (€59.6M) is a gazetteer gap; check it after the pass. |
| **A8** | Lines are centroid chords, and their links drop `pscope`. | — | Caption „схематично — между населените места, не трасе". Carry scope on every link. |
| **C3** | No coverage figure comes from the function. | Distinct-key placed €: all 29.2%, ns:2024_10_27 18.9%, default 27.1%, y:2024 12.4%, y:2025 41.1%, **y:2026 3.5%**. | 076 returns distinct-key `placedEur` / `placedContracts` / `totalEur`. The map's basis line renders them. Caption that pins can overlap. |
| **O5** | The project-map loader does TRUNCATE plus row-by-row INSERT in one transaction on a served table (load_transport_project_map_pg.ts:170-188). | 210 s on cloud, during which every map request blocks. | Stage-merge (`lib/stage_merge.ts`) plus `vacuumAfterReload`. Add the table to `reload_visibility_map.data.test.ts` `RELOADED` and to CLAUDE.md's cloud VACUUM list. |
| **A9 / D8** | The ministry slice is shown as one spender, and the footnote says it „остават вътре в групата". | Only €980.6M of €2,422.5M (40.48%) goes to a member. External: Булему €451.5M, Шкода €326.8M, Stadler €153.7M, Ивкони €415.8M. | Re-attribute per D8 in the shared model, with a test that Σ modes == total. Derive the footnote's in-group share; never assert it. |
| **A10** | The competition tile has fixed 35%/60% thresholds and no baseline. | Default 40.2% vs national 48.8%; all-scope 37.5% vs 41.7%. | T4. |
| **A11 / B3** | EU funds: `awarder-funds-rollup` reads `fund_beneficiaries`, which lags `fund_projects`. That route is shared with water `useVik` and the AI `transportEuFunds`. | МТС paid €441.5M vs €510.7M. | Add an opt-in `basis=grant` param to the route that reads `fund_projects` and **echoes the basis** (the `exMembers` shape), so water is untouched. Needs `deploy:db` **before** hosting (T8). Spin off the `fund_beneficiaries` lag as its own task. |
| **G2 / G3** | The y:2026 peak is three PSO lots at multi-year „прогнозна стойност": **€1,396.3M = 83.9% of y:2026**, 19.1% of all-time. The annual PSO in `rail_subsidy.json` is €110.7M. PSO rows are `open` with 1 tenderer, so a method-keyed caption finds nothing. | On €, y:2026 single-bid is 89.9% vs 45.3% by count. | Caption key: `awarder=МТС AND cpv LIKE '6021%'`. Captions read „многогодишен договор за обществена услуга, прогнозна стойност" on the spine, top contracts and the competition tile. Never set it beside the annual budget line. |
| **G6** | Risk grade D (69 / €1,110.3M) is 88% intra-group or statutory: the €980.6M PSO to БДЖ-ПП (mask 524) plus ТСВ awards (mask 1540). | — | Any risk tile splits in-group from the rest and uses „за проверка" wording. The risk link targets `grade=D,E` (no F exists in the set). |
| **G9** | Pass-through spend ranks as procurement. | All-scope: vouchers €155.7M (2.1%), fuel €195.8M, electricity €112.2M, insurance €103.5M. **Default scope: vouchers €12.4M = 10.9%** (Edenred €12.2M is the #2 top contract). | A `passThroughOf(row)` rule in `transportAttributes.ts` matching title + contractor + CPV. CPV alone misses НКЖИ's vouchers, filed under 98000000. Caption the matched rows wherever they rank; never filter them out. |
| **G10** | HHI ignores ТСВ, so y:2024's in-group share reads 0% instead of 2.4%. | all 353, y:2026 4,154. | Pass `TRANSPORT_INGROUP_CONTRACTORS` as `stateBodyEiks`/in-group to the HHI tile. |
| **B4** | `SECTOR_BROWSE_PACKS.transport` (sectorPacks.tsx:395-399) counts member rows, so every KPI link lands on a different count. | — | Add `excludeConsortiumMembers: true` and `beneficiaryCorpora: ["fund_projects"]` (the roads §7 / water G1 fix). Verify the `sector_beneficiary_reach` gate. Re-run `db:gen-sector-stats`: **no diff expected**, because € sums are unaffected. |

### Stale copy and dead code, fixed in T0

| id | site |
| --- | --- |
| **A14** | `sectorPacks.tsx:123` „11-unit". `132_transport_facility_map.sql` header „all 11 … Sofia". The „Дял на железниците (НКЖИ + БДЖ)" hint (rail also holds ИАЖА and ДП ТСВ). |
| **A15** | `TransportRoadsLinkTile` „~€5.6bn" / „над €5 млрд" (roads is €9.1bn). The literal „~€7,3 млрд" in the prerender (`routes.ts:1092, 1101`), pack/hook comments, and `scripts/data_map/model.ts:2388-2389` (O2). |
| **G12** | Budget-tile comment „~€575M, 2025". The node has 2026 €571,711,900 and 2025 €575,448,735. The `programs` amounts read 0: check their shape before any programme figure renders. |
| **C11** | A16 is half done: `transportReferenceData.test.ts:136-142` already ties the alias set. The remaining `eik === TRANSPORT_EIK ? … : [eik]` branch dies with the pack (C5). |
| **C2** | A13 (`NULLS LAST` in 061) is **dropped**. It is a `jsonb_agg` over an aggregate, so no index applies; the client re-sorts; and 061 has no applier. |

### Source checks: no code, verify before the figure headlines on `/money`

- **G12:** `rail_subsidy.json`.
  - PSO 2018 = 2019 = 2020 (€89,476,079). This is possibly the extended budget law; confirm
    against the ЗДБРБ texts.
  - 2024 capital is null and needs a caption.
- **G12:** `rail_ridership.json`. 2018 = 2019 = 21,329,000: verify against Eurostat `rail_pa_total`.
- **G14:** `road_safety.json`. 2012 = 2013 (601) and 2015 = 2016 (708): one source check.
- **G13:** COFOG GF0405 (2024 BG 3.4%, EU27 2.5%, rank 6/26) covers all general government,
  **including road building and municipal metros**, both outside this sector. It needs a basis
  caption. GR is absent from the peer row (Eurostat EL→GR mapping; memory
  `feedback_eu_peers_flags`).
- **O4:** both rail files are bucket-served (`useRailSubsidy.tsx:51`) with no sync path. The
  bucket ridership file is the 2026-08-14 fetch; the committed one is from 2026-09-13.

### Observations shown honestly, no fix

- **G7: tenders.** 4,253 tenders / €15.07bn estimated (non-cancelled 3,937 / €9.65bn); МТС
  estimates €7.19bn against €2.42bn contracted. A tender tile, if one is ever added, must say an
  estimate is not a cost.
- **G11: per-unit competition, all-scope ex-members.** НКЖИ 35.7%, БУЛАТСА 36.4%, БДЖ-ПП 33.7%,
  ИА МА 57.1%, **ДАБДП 19/23 = 82.6%**. Small n, so the tile keeps `MIN_BID_KNOWN`.
- **Interreg partner budgets:** ИАППД €6.32M, ИА МА €3.25M. An optional line on `/money#funds`
  on its own basis, never summed.
- **Contractor keys:** ph-/np- 4 rows / €5.3M; no-EIK €25.0M. Left as they are.

---

## 3. Target shape

```
/sector/transport               hub (unscoped; every link carries ?pscope=all)
/sector/transport/network       #map  project map (A1, A5–A8, C3) · coverage line · ?mode=   (scoped)
/sector/transport/procurement   #spine (G1, G2, G5 annex line) · #modes (D8, raw beside) · #categories (A3)
                                · #competition (A10, G3) · #contractors (HHI, in-group, D4, D9, G10)
                                · #top-contracts (G2, G9) · #direct (A4) · #risk (G6)           (scoped)
/sector/transport/bodies        the 16 bodies by universe + the VERIFY body (D3) · #map facility map (D7)
                                (scoped counts; seats „без период")
/sector/transport/money         #budget (G12) · #subsidy (G2: annual, not the PSO estimate) · #funds (D6)
                                · #peers (G13) · #road-safety (G14)                    („без период")
```

**Fragment ids are this set, and only this set (C6).** The old ids (`mode-split`, `rail-subsidy`,
`eu-funds`, `transport-budget` duplicated on a PackSection and a Card, …) are retired with the
pack. A registry test asserts every `#fragment` a tile emits exists on its destination. Every
sub-page runs `useHashScroll`.

**`?mode=<universe>`** is used on `/network` and `/procurement` only.
- It is validated on read.
- It collides with no URL-contract param and is not in the `usePreserveParams` allowlist, so it
  stays page-local.
- Tiles a mode cannot filter say „за целия сектор" (A12, G14).

**`/money` has no ScopeControl (O9)**, but it must resolve an inbound `pscope`: the subsidies hub
forwards `pscope=y:2024` (O1). It anchors `useRailSubsidy` to that year and otherwise shows the
latest.

**The pack is deleted, not kept (C5).**
- `showPack = SectorPack && !sectorDash` (CompanyDbScreen.tsx:542) means `TransportPack` never
  renders on `/awarder/000695388` today.
- After the split, `TransportPack` and `useTransport` are unreachable, so they are deleted along
  with the `[TRANSPORT_EIK]` registration (sectorPacks.tsx:182). This is the roads §7 outcome,
  which superseded roads B3.
- `SECTOR_DASHBOARDS.transport` becomes inert:
  - drop `packRendersOwnContractsLink` (sectorDashboards.ts:347);
  - fix the false comment at :336-342;
  - keep `members` (membersIndex.test.ts:109).
- The tiles move into `src/screens/transport/`; their model functions stay in `src/lib/`.

### Head (dashboard-hub §3.0)

- **Breadcrumb:** Управление › Сектори › Транспорт.
- **Eyebrow:** „СЕКТОР · ТРАНСПОРТ · обновено dd.mm".
- **Deck:** „кой купува за железниците, пристанищата и въздушния транспорт, при каква конкуренция
  и колко остава в държавната група". `seoDescription` is a different sentence.

**KPI band:**

| # | value | basis line (dates from blob `firstDate`/`lastDate`, C7) | links to |
| --- | --- | --- | --- |
| 1 | **€7,29 млрд.** | „договори на 16 структури на МТС, {first}–{last}, текуща стойност след анекси"; equals `sector_stats.all.transport` | `/procurement/contracts?sector=transport&pscope=all` |
| 2 | **89% железници** (D8) | „вкл. договорите на МТС за жп превози и подвижен състав" | `/sector/transport/procurement?pscope=all#modes` |
| 3 | **38% с една оферта** (ex-members) | „при 42% средно за всички възложители · известен брой оферти за 64% от договорите". Read it aloud: transport competes better than average. | `…/procurement?pscope=all#competition` |
| 4 | **€1,14 млрд. в групата** (D4) | „договори между структури на МТС, вкл. ТСВ ЕАД; не се изваждат от общата сума" | `…/procurement?pscope=all#contractors` |

- `kpiNote`: the four figures are on different bases and are never summed.
- **Evidence rail:** the top 5 bodies by € → `/awarder/:eik?pscope=all`.
- **Finder:** `HubSearch` (T6).

### Bands (4/4/4)

Each band carries a description line, unique accents and a bespoke scene per tile.

| band | tiles → destination |
| --- | --- |
| **Къде** — „в коя част на мрежата отиват парите" | project map → `/network`; rail → `/network?mode=rail`; ports and Danube → `/network?mode=maritime`; aviation → `/network?mode=aviation` |
| **Как се възлага** — „конкуренция, процедури и изпълнители" | competition (descriptor-only; KPI 3 owns the figure) → `/procurement#competition`; without a notice → `/procurement#direct`; biggest contracts (G2/G9 captions) → `/procurement#top-contracts`; all contracts → `/procurement/contracts?sector=transport&pscope=all` |
| **Кой и колко** — „структурите, групата и парите извън поръчките" | bodies → `/bodies`; in-group (descriptor-only; KPI 4) → `/procurement#contractors`; rail subsidy (annual PSO) → `/money#subsidy`; EU funds (grant basis) → `/money#funds` |

Roads stays a footer cross-link, with its figure read from the roads blob (A15).

**Copy is inline `{bg,en}` in `transportRegistry.ts`**, as roads and water do: no corpus keys
and no `withBundle` (O7).

---

## 4. Tiers

### T0: register, stale copy, dead code (ships and deploys alone)

1. **Register.** Edit `src/lib/transportReferenceData.ts` only:
   - D2: Летище Пловдив into the aviation `TRANSPORT_ENTITIES`, seat Крумово/Пловдив;
   - D3: Дунав мост on a new `TRANSPORT_VERIFY` list, with its reason;
   - D4: the `TRANSPORT_INGROUP_CONTRACTORS` constant;
   - D9: a `TRANSPORT_STATE_CONTRACTORS` disclosure list;
   - update `transportReferenceData.test.ts`. Летище Пловдив's € floor sits on `all` only (the
     Летище София scope trap from the 2026-08-13 audit).
2. **The EIK set feeds the function bundle (B3):**
   - regenerate `functions/generated/procurement_query.js` with
     `node --import tsx scripts/ai/buildProcurementQuery.ts --write` (its test fails with
     „Stale procurement validator");
   - run `db:gen-sector-stats` and `db:load:transport-facility-map:pg` (16 rows);
   - update the fixtures carrying 7,268,093,632 / „€7,3": the `governance-sectors` og figure,
     `sectorsHubFigures.test.ts:28`, `GovernanceSectorsScreen.test.tsx:21` and
     `hubHead.gates.test.ts:732` (O8). Re-shoot only if the rounding moves (€7.293bn still rounds
     to €7,3).
3. **Stale copy:** A14, A15, G12, C11, O2 (data map).
4. Run `npm run test:data`; re-run any red file alone before believing it (G-audit: the local
   container showed 283 s checkpoints under unrelated load).

### T1: engine corrections (bug fixes, fixture tests, no STOP)

1. **076 + loader:**
   - A1 member filter;
   - C3 distinct-key coverage return;
   - A5 Cyrillic-safe types and universe default;
   - A6 segment rule and one-row-not-two-pins;
   - A7 section-over-line and the unique-hit village pass;
   - O5 stage-merge and vacuum.

   Re-run the loader. **New gate `transport_project_map.data.test.ts`** (none exists today):
   - no member rows;
   - no segment from a non-rail awarder;
   - coverage returned and Σ-consistent;
   - the village refusals are counted;
   - a mutation check: re-run the type regex with `\b` and assert „пристанище/порт" titles stop
     typing as `port`.
2. **132:** its own member filter (C1). Gate `transport_facility_map.data.test.ts` extends to
   ex-member counts and the 16th row.
3. **`transportAttributes.ts`:**
   - A3 CPV routing + `CATEGORY_CPV_DIVS` prefixes;
   - D8 re-attribution;
   - G2/G3 PSO key;
   - G9 `passThroughOf`;
   - A4 method-known denominator;
   - each with a fixture in the new `transportAttributes.test.ts`, plus Σ modes == total.
4. **Counts via `awarder-group-rollup?exMembers=1`** (A2/C1). No change to 061.
5. **Browse pack (B4):** `excludeConsortiumMembers` + `beneficiaryCorpora`; `db:gen-sector-stats`
   produces no diff.
6. **Funds route (A11/D6):** opt-in `basis=grant` on `awarder-funds-rollup`, echoing the basis,
   with a `db_routes` test that water's default call is byte-identical.

### T2: hub blob

- **Generator** `scripts/db/gen_transport/hub_stats.ts` (`npm run db:gen-transport-hub-stats`)
  writes `data/transport/derived/hub_stats.json`.
  - `bucketPath: "transport/derived/hub_stats.json"` (`isExcluded` admits it; the path is not
    gitignored).
  - The type lives in `src/data/transport/hubStats.ts`: numbers only, pairs un-divided.
- **Contents:**
  - KPI 1–4 pairs: the E+P sum, the D8 rail pair, the ex-member single-bid pair plus the
    bid-known coverage, and the D4 in-group pair;
  - the national ex-member pair;
  - per-universe € (re-attributed and raw);
  - D9 state-contractor €;
  - G5 annex growth;
  - G2 PSO-estimate €;
  - G9 pass-through €;
  - top 5 bodies;
  - the finder index (16 bodies + the VERIFY body + top segments);
  - C3 map coverage;
  - funds (grant / paid / total);
  - `firstDate` / `lastDate`.
  - Budget ≤ 5,120 B. Re-measure and raise only with a note, as roads did.
- Run the real `transportAttributes` model in Node over the same row shape the routes return
  (roads C14). The preflight **refuses** when the rollup's ex-member keys are absent (C1,
  `gen_roads/hub_stats.ts:110` shape). Skip-and-warn per relation.
- **Chain slot (B1):** after `db:load:transport-facility-map:pg`. That is ~15 steps after
  `db:gen-sector-stats`, because the blob reads the project map's coverage.
  - `ORDER_PAIRS` (in `scripts/db/refresh_coverage.test.ts:88`): after `db:gen-sector-stats`,
    `db:load:funds:pg`, `db:load:transport-project-map:pg` and `db:load:annexes:pg`. The first
    draft listed annexes by copying roads, and B1 dropped it as unread; G5's annex line now
    reads `procurement_annexes`, so the pair is genuinely needed.
  - The `REFRESH_GENERATORS` entry (`scripts/db/refresh_coverage.ts`) gets a `reason` naming this
    slot.
- **Gate `transport_hub_figures.data.test.ts`:**
  - re-derive every figure;
  - KPI 1 == `sector_stats.all.transport`;
  - `notEqual` against the rejected bases: all-tag sum, member-inclusive pair (35.3%),
    `contracted_eur` funds, raw rail share (57.0%), CPV-only pass-through;
  - byte budget.

### T3: hub, sub-pages and page layer, in ONE commit (water T3+T7)

1. **`src/screens/transport/`:**
   - `TransportHubScreen`, `transportRegistry.ts`, `transportScenes.tsx` (12 scenes),
     `transportHubFigures.ts`, `TransportPageFrame`, and the four sub-pages. The tiles move here
     with the §3 fragment ids.
   - `TransportPack.tsx`, `useTransport.tsx` and the pack registration are deleted (C5).
   - Tests mirror `roads*` / `water*`: every `to` routed, `pscope=all`, fragments exist, unique
     accents, band balance, both languages.
2. **Routes:**
   - literal `sector/transport` routes ahead of `sector/:id`;
   - an import-free `src/lib/transportPaths.ts` for the registries (C10; `entryGraph.test.ts`
     must not reach `transportReferenceData`);
   - the inert dashboard entry (C5).
3. **Inbound links (O1):**
   - the subsidies rail tile (`subsidiesRegistry.ts:157`) → `/sector/transport/money`, moved out
     of `VIA_SECTOR_REGISTRY` (`subsidiesRegistry.test.ts:53-59`);
   - keep the `pscope=y:2024` forward and the hub-figure == `useRailSubsidy` year-anchor rule
     (`SubsidiesDashboardScreen.tsx:22-28`, `.test.tsx:222`);
   - the subsidies prerender bodies (`routes.ts:6405, 6433`);
   - governance `sectorRegistry.ts:46` stays `/sector/transport`.
4. **Prerender (C7):**
   - delete the `SECTOR_PAGES` transport entry (`routes.ts:1087-1105`) and add `transport` to
     `BESPOKE_SECTOR_PAGE_IDS` (:1332);
   - hand-authored `staticPage`s for the hub and four sub-pages, BG + EN, figures from the blob
     via a `transportFacts` helper (the `roadsFacts` shape, :387).
5. **Sitemap:** extend `route_defs.ts` (sub-pages :34-37, the `file:` ternary :361-368), run
   `npm run sitemap`, commit the XML.
6. **og (B5):**
   - retire `scripts/og/screenshot_transport.ts`;
   - add `capture-screens.ts` entries `sector-transport` (`[data-hub-head]`) and
     `sector-transport-network` (`/sector/transport/network?pscope=all`,
     `[data-og="transport-map"]`);
   - keep `transport` in `HAND_FRAMED` (`screenshot_sectors.ts:36`);
   - point `/network`'s `ogImage` at the new card;
   - update `ogAndSitemapCoverage.test.ts` (its :856 comment names the old script).
7. **Gates:**
   - `hubHead.gates.test.ts` `HUB_SCREENS`;
   - `tests/ui.spec.ts` `HUB_HEAD_BUDGETS` (measure first; +≤20%; `cells: 4`, `asideRows: 5`)
     and the path→screen map;
   - `tests/seo.spec.ts` `minBodyChars`.
8. **AI (C8):**
   - `ai/render/links.ts:385` becomes three `pages()` calls: `transportSpending` → `/procurement`,
     `railSubsidy` and `transportEuFunds` → `/money`;
   - `subject-destinations.json:91-93` carries pathname+search with no `#`;
   - `transportSpending` (ai/tools/transport.ts:43-60) adopts the D8 mode rule and the ex-member
     rate so it cannot contradict KPI 2/3;
   - `transportEuFunds` moves to the grant basis.
9. **Look at every page in both languages.** Rendered `<title>` / `<h1>` must equal the
   prerender's. Read `dist/<path>/index.html` directly, never through `npm run preview`.

### T4: same-window baselines

- On `/procurement#competition`, per window: `useNationalCompetition()` with the ex-member pair
  against the transport ex-member rate (A10).
- Show no baseline rather than a mismatched one.
- Caption the PSO lots on the CPV + awarder key (G3), and the БУЛАТСА/ДППИ invitation-only rows
  as „без обявление" with their basis (G4).
- Risk signals read „за проверка" (G6).

### T5: maps

- `/network`:
  - the „схематично" caption (A8);
  - the coverage line from the function (C3), which is honest about y:2026 = 3.5%;
  - scoped links;
  - the mode picker as a labelled control **beside** the SVG map, not over it (O11 a11y).
- `/bodies#map`: ex-member counts and the 16th row.

### T6: finder

`transportSearch.ts`: a client index over the blob's bodies, the VERIFY body and top segments,
plus one shared `procurement-search` request labelled „в целия регистър".

### T7: reload and publish path

- **`process-watch-report`:**
  - add `db:gen-transport-hub-stats` + `bucket:sync:paths -- transport/derived/hub_stats.json`
    to the procurement and funds rows (the D6 blob reads `fund_projects`: the sector-dashboard §11
    „a new input adds a trigger" rule);
  - its step 8 `db:check-generated` covers it once registered.
- **O3:** repoint `eurostat_rail.ts:51` and the SKILL.md rows at :141, :553 and :575 from „the
  /sector/transport tile" to `/money`.
- **O4:** register `transport/rail_subsidy.json` and `transport/rail_ridership.json` in
  `UPLOAD_PUBLISHED_ARTIFACTS`, or add `bucket:sync:paths` to their rows. They now headline a page.
- Add the new data tests to the `update-procurement` verification step. Run
  `cloud_loader_coverage.test.ts`.

### T8: shipping order (roads §5 shape, B3; CLAUDE.md three-step rule)

1. **Gate (O10):**
   - `npm run db:proxy:cloud`;
   - re-run §1's headline SQL and KPI 3 on 5434;
   - confirm `transport_project_link` / `transport_facility_geo` counts.
   - Do not continue on a mismatch.
2. Apply **076** and **132** to Cloud SQL (`apply_functions.ts`), off-peak.
3. Run `db:load:awarder-seats:pg:cloud` if `115007069` lacks a seat row there. Then
   `db:load:transport-project-map:pg:cloud` and `db:load:transport-facility-map:pg:cloud`.
4. Run `npx tsx scripts/funds/install_query.ts --cloud` (the EIK set changed), then
   `npm run deploy:db` (the funds `basis` param and the regenerated validator). **This must
   precede hosting.**
5. Run `bucket:sync:paths -- transport/derived/hub_stats.json procurement/derived/sector_stats.json
   transport/rail_subsidy.json transport/rail_ridership.json`, then `db:check-generated`.
6. Run `npm run deploy`, then `npm run deploy:db`, then `SKIP_PREDEPLOY=1 npm run deploy`. The
   bundle hash moves.
7. Run `curl -sL` on the hub and the four sub-pages, and compare the bundle hash with a
   function-served page. Then query the funds route directly; a 200 page is not evidence.

### T9: gates (last, separate) and audit pass

- **Mutation-check every PG gate** from T1/T2. Watch each one fail.
- **`sector_stats.data.test.ts` transport block:**
  - in-group and state-contractor constants are never in the awarder set;
  - the VERIFY body is not in the roll-up;
  - aviation > €250M;
  - Летище Пловдив's floor on `all` only.
- **`/audit-sectors transport`**, with the roads §7 checklist (O11):
  - every destination lands on its figure's count;
  - empty and failed states keep their ids;
  - mobile at 375 px;
  - a11y.

---

## 5. Not in v1

- A per-segment `/sector/transport/segment/:id` family (thin content). Decide after T1 is measured.
- A rail €/km analogue of roads `/costs`. Rail titles rarely carry chainage.
- Netting the intra-group flow (D5).
- The corpus-wide `limited` / „Вътрешен конкурентен избор по РС" bucketing (B2, G4). This is
  its own plan if ever wanted.
- The `fund_beneficiaries` lag beyond transport (A11): spin off.
- The 2020 corpus hole itself (G1). v1 captions it; filling it is an ingest question.
