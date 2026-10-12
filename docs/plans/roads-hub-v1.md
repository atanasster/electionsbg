# Roads hub v1: `/sector/roads` becomes a sector dashboard

Status: **IMPLEMENTATION PLAN**, audited 2026-10-12. D1–D8 all accepted 2026-10-12; implementation started.

**Template.** The `/culture` migration: `culture-investigative-v1.md` §1.7, commits
`c990d36dcf` → `61be083e18`.

**Governing skills.**
- `dashboard-hub` covers everything visible.
- `sector-dashboard` covers everything countable.
- `audit-sectors` is the method behind §2.

**How to implement.** Run `/implement-plan`, one tier per step, with the gates as their own
step.

**How the plan was checked.** It went through two audits on 2026-10-12:
- a data audit against local Postgres, findings **R1–R27** (§2);
- a claims/feasibility audit against the code, findings **B1–B6** (blockers),
  **C1–C20** (corrections) and **O1–O7** (omissions).

Every finding is folded into the tier that fixes it. The finding id is kept beside each fix,
so a reviewer can trace it back.

---

## 0. Decisions

### Accepted by the operator, 2026-10-12

| id | decision |
| --- | --- |
| **D1** | **Universe: buyers of the republican road network, with АПИ as principal.** The ~28 ОПУ directorates are name variants under АПИ's one EIK (R3: no alias EIK exists). „Автомагистрали" ЕАД is **not** a buyer. It is the in-house *contractor*, declared in its own constant and shown in its own tile, never summed (C16). |
| **D2** | **Headline basis stays procurement.** АПИ has no `budget_admin_node`; a budget line needs the МРРБ road programme parsed. That is out of v1. |
| **D3** | **Keep `/sector/roads`.** Sub-pages go under it. |
| **D4** | **The ×1.5 annex figure is not a KPI.** It ships as a labelled section after Tier 5. ⚠ The audit **changed the premise**; see R9. It is not an „ал.2 overrun", so the section is an *option-exercise* story, not an overrun story. |

### Accepted by the operator, 2026-10-12 (second round)

| id | question | € impact | decision (recommendation accepted) | tier |
| --- | --- | --- | --- | --- |
| **D5** | **НКСИП (`202062287`)**: roll-up or adjacent? It is a state company that procured АМ Струма lots 3.1/3.3, plus НАИМ archaeology, 2013–2019. | +€220.7M all-time (+2.5%); 0 in every parliament window since 2019 | **Roll-up.** It is a buyer of the same network under the same principal (МРРБ). Leaving it out makes Струма's construction history start mid-way. | T2 |
| **D6** | **How to caption post-annex money.** The headline sums current value (CLAUDE.md „current-value"), so 28–29% of 2024 and of `ns:2024_06_09` is annex growth booked at the signing date (R8). | Caption only | Basis line „текуща стойност след анекси". The time spine gains a signing-vs-growth split. The ×1.5 cluster is labelled „упражнени опции (чл. 116, ал. 1, т. 1)", never „преразход". | T4, T5 |
| **D7** | **How to label in-house and statutory sole-source awards.** Автомагистрали ЕАД is 11.0% of all-time (R16, R19). It is 96.7% of the „politically linked" € (R24), through state-company board seats. The largest ns:2026 row (38.4%) is one negotiated award (R17). | Caption only | Label Автомагистрали „държавно дружество, in-house (чл. 14 ЗОП)" wherever it ranks. The political-link figure excludes state companies, or names them. Single-bid captions say „включва законови изключения". Never filter the rows out. | T4 |
| **D8** | **EU-funds arm on the roads browse pack** (`beneficiaryCorpora: ["fund_projects"]`, as culture has). | Adds 71 projects / €2,397.8M `total_eur` (separate basis, never summed) | **Yes.** Without it the EU-funds tile has no `?sector` destination (C8). | T4 |

---

## 1. Measured baseline (2026-10-12, local PG, 410k-row corpus)

Basis throughout: `tag='contract' AND awarder_eik='000695089'`, ns windows from
`parliamentWindow`.

| scope | `sector_stats.json` | PG | |
| --- | --- | --- | --- |
| all | €8,917,376,622 | same | ✅ R1 |
| ns:2026_04_19 (open) | €233,931,795 | same | ✅ |
| ns:2024_10_27 | €723,015,957 | same | ✅ |
| ns:2024_06_09 (4.5 months) | €1,996,183,377 | same | ✅ but 28.9% is annex growth (R8) |
| y:2024 / y:2025 / y:2026 | €2,884.1M / €448.6M / €365.9M | same | ✅ |

Other figures measured on the same basis:

- **Contracts.** 2,826 at `tag='contract'`: 2,327 non-member rows plus 499 €0 consortium-member
  rows. The route returns 2,993 rows, the 2,826 plus 167 amendments, which `isSpendRow` drops.
- **Contractors.** 935 distinct EIKs, consortium members included; re-define in T3.
- **Tenders.** 2,122.
- **Single-bid vs national, all-time.** АПИ 443/1,836 = **24.1%**, national 110,866/270,065 =
  **41.1%** (R21). Both count member rows today; see T1.
- **Single-bid vs national, ns:2026.** АПИ 23.7%, national 47.7%.
- **Risk grades.** A 2,126 · B 525 · C 145 · D 21 · E 9 · **F 0** (B6).
- **EU funds** (`fund_projects`, beneficiary АПИ). 71 projects; total €2,397.8M, grant
  €1,613.3M, paid €1,082.7M. Largest: Транспортна свързаност 2021-27 €1,146.2M; ОПТТИ
  2014-20 €766.1M (R26).
- **Buildability.** `buildRoadsModel` run in Node over the route's SELECT gives
  `totalEur` = headline at every scope (R1, O-class).

---

## 2. Data audit findings (R1–R27)

### Correct, and pinned in T9

These need no fix; T9 adds a regression pin for each:

- R1: the headline reproduces.
- R4: the four EIK copies agree.
- R6: time spine, components and work groups each sum to the total.
- R16: the all-time top-20 is a spread from 11.0% down to 1.4%.
- R21: АПИ is well below the national single-bid rate.
- R22: no null EIK or amount, no self-deal, no `ph-`/`np-` keys.
- R23: the 53 same-content groups are distinct lots.
- R25: intra-group circulation is 0.

### Defects: engine fixes, all in T1

| id | defect | measured |
| --- | --- | --- |
| **R10** | `buildRoadsModel` keeps the 499 €0 consortium-member rows. The members inherit `number_of_tenderers`, so every count and every single-bid share counts a consortium 1 + members times. The awarder route already excludes them. | Pack counts +499 (+21%) vs the „Договори" tile. winter_maint 90.0% shown vs **76.9%** true. That 90% drives the RoadsPack warn insight. safety_barriers 18.8% vs 37.5%; markings 50.0% vs 66.7%. € sums are unaffected. |
| **R7** | `roadRefOf` does not recognise АМ Русе–Велико Търново („Участък Русе – Бяла"), and misses the Железница tunnel. | `refCoverageEur` 52.6% all-time. €448.2M Русе–Бяла plus €348.5M „Обход Бяла" (ОП2 of the same procurement) plus €94.8M tunnel sit unattributed. The €509.4M „ДЗЗД ХЕМУС-16320" is mostly Русе–Бяла, not Хемус. |
| **R12** | `regionOf` puts a multi-ОПУ lot into the oblast with the longest name. | 87 lots / **€800.6M (23.5%** of the region tile) go to one oblast. Шумен shows €0.6M; Търговище €175.7M; Стара Загора €463.4M (АМ Тракия OP3 €193.1M across 7 ОПУ). The code's TODO calls this „low impact"; it is wrong. |
| **R14** | `MOTORWAY_MAX_KM.Струма = 165` rejects every Струма construction contract. Those use the I-1/E79 chainage (km 305–442). | Strip shows Струма 13 contracts / €47.7M against a corridor total of €943.9M. Lot 2 €152.8M, Lot 3.1 €89.9M and others are dropped. OP6 maintenance (to km 166.5) is dropped by 1.5 km. All other caps are OK. |
| **R15** | The chainage strip's „покритие" uses the span between the outermost contracted km markers as its denominator, and lights a bin for any € > 0. | The screenshot's „Хемус 68% покритие €4.8M · 4 договора" is ns:2026: 3 near-€0 safety audits plus one €4.8M archaeology dig. „68% of the motorway is covered" is false as a sentence. |
| **R13** | The €/km tile shows a corridor's median from a single row. | ns:2026 Струма **€33.3M/km from n=1** (Lot 3.1 over 2.7 km). |
| **R27** | `awarder-contracts` ships 167 amendment rows that the client discards. Comments say „~2.1k rows"; the real figure is 2,993. | cosmetic |

### Caption / editorial (D6, D7) and the annex finding

**R9: the ×1.5 cluster.** The audit corrected the plan and the operator memory.
- Tolerance ±0.005: 45 contracts, €3,055.7M current value, **€1,018.5M growth**. Exactly 1.5000:
  44 contracts, €961.7M growth.
- All 45 join `procurement_annexes` (70 annex rows). By `change_reason`:
  - **„клаузи за преразглеждане или опции": 35 contracts / €930.1M.** The text reads „чл. 116,
    ал. 1, т. 1 от ЗОП, във връзка с чл. 44, ал. 3, т. 2 от Договора". This is a +50% option
    written into the contract at signing.
  - unforeseen circumstances (т.3): 14 contracts / €68.4M;
  - de minimis: €12.5M.
- It is **neither ал.2 nor чл.117а indexation.**
- By signing year: 2024 has 27 contracts (+€801.5M), mostly the ОПУ maintenance frameworks and
  the Тракия/Хемус in-house maintenance lots.
- National ×1.5: 450 contracts / €1,019.3M growth over 113 awarders. **АПИ is 94.3% of it.**

The memory entry „€857M at +50% (чл.116 ал.2)" has been corrected. The finding is still
publishable, but as „АПИ exercises pre-set +50% options almost alone in the corpus", not as an
overrun.

**R8.** Total annex growth is €1,221.6M over 122 contracts. It is booked at the signing date.
The RoadsPack insight „2024: €2.9bn — най-силна година" is ~⅓ growth.

**R11.** Old memory claims re-checked:
- „markings €31M 100% single-bid" is **one** contract, to Автомагистрали under чл. 14, ал. 1,
  т. 6, i.e. in-house. It is statutory, not weak competition.
- „guardrails €25M ~100%" does **not reproduce** at any scope.
- „roadway 17%" is the €-weighted figure (16.9%); the tile is count-based (19.5%).

**R17.** In ns:2026 the top row is 38.4%: one negotiated-without-notice award (Струма 3.1,
€89.9M). It drives „40% без търг".

**R18.** The contracting-authority probe finds €1,030.3M = 11.55% that went to public bodies:
- Автомагистрали €982.9M;
- НАИМ-БАН rescue archaeology €45.9M;
- three small ones.

Four gas distributors (€0.30M) are utilities-regime false positives.

**R19.** Автомагистрали ЕАД's largest award is €461.4M (2020, I-1 Видин–Ботевград), labelled
„вътрешен конкурентен избор по РС". 67% of its contracts are single-bid.

**R20.** € of single-bid by procedure method:

| method | € | rows |
| --- | --- | --- |
| in-house „вътрешен конкурентен избор" | €493.6M | 41 |
| negotiated without notice (чл.79) | €267.3M | 58 |
| open | €230.0M | 108 |

**R24.** `company_politicians` returns €1,016.9M = 11.4%, but **96.7% of it is Автомагистрали**
(a state company with board seats). Excluding it leaves ~€34M = 0.38%. 14 consortium carriers /
€59.2M have a linked *member* that is invisible to contractor-EIK matching.

### Register (D5, T2)

**R2.** НКСИП is missing (D5).

**R3.** The stem sweep over contracts and tenders finds no alias EIK and no separate toll EIK.
These go in the **excluded** list:

| EIK | body | why it matched |
| --- | --- | --- |
| 130823243 | НКЖИ (€3.47bn) | „железо**пътна** инфраструктура" |
| 175405647, 202311429, 829054071, 107027467 | БДЖ-Пътнически and municipal passenger carriers | „**пътн**ически" |
| 129010171 | Сухопътни войски | „Сухо**пътни**" |
| — | ИА Железопътна администрация | „Железо**пътна**" |
| 000454845 | a school | carries „ОПУ" in its name |

**R5.** `transportReferenceData.ts:22` misplaces Автомагистрали and quotes АПИ at „~€5.6bn"
(it is €8.92bn).

**R26.** `000698085` „Агенция Пътна инфраструктура" holds 1 ИСУН project (€0.65M) and no
contracts. It is probably an ИСУН EIK typo. Record it; do not fold it.

---

## 3. Target shape

```
/sector/roads               hub: HubHead + 3 bands × 4 tiles
/sector/roads/network       map · km strip · corridor list            (?corridor=<encoded id>)
/sector/roads/costs         €/km by corridor + benchmark · components · build-vs-repair · explainer
/sector/roads/procurement   time spine (signing vs growth) · competition + national baseline
                            #contractors · #regions (ОПУ) · #annexes (options) · #inhouse · #pipeline
```

Three sub-pages, not four:
- `/pipeline` is 12 unscoped rows, which is a thin page, so it is folded into
  `/procurement#pipeline` (O3).
- Per-corridor €/km lives only on `/costs` (N5).

**Scope.** The hub is unscoped: whole corpus, and every procurement link forces `?pscope=all`.
Each sub-page declares its `ScopeSupport`: `/network`, `/costs` and `/procurement` are
`ScopeControl mode="toggle"`, and `#pipeline` is labelled „текущи, без период" (O3).

### Head (dashboard-hub §3.0)

- **Breadcrumb:** Управление › Сектори › Пътища.
- **Eyebrow:** „СЕКТОР · ПЪТИЩА · обновено dd.mm".
- **Deck:** what a reader can do: „кой строи и поддържа републиканските пътища, на каква цена
  на километър и при каква конкуренция".

**KPI band.** Four thesis figures, each with its basis in the cell and each linking to a page
that names its rows (C19):

| # | value | basis line | links to |
| --- | --- | --- | --- |
| 1 | **€8,92 млрд.** | „договори на АПИ 2011–2026, текуща стойност след анекси" (D6) | `/procurement/contracts?sector=roads&pscope=all` |
| 2 | **24% с една оферта** | „при 41% средно за всички възложители" (R21, members excluded per T1). Read the sentence aloud: roads competes *better* than average, so it must not read as an indictment. | `…&single=1` |
| 3 | **direct-award share** (`model.directShare`) | „без обявена процедура" | `…&proc=<bucket>`. Verify the bucket name in `useUrlProcurementFilters` before linking. |
| 4 | **contractor count** | „фирми и обединения с договор, без €0 участници в обединения". Re-measure in T3; the 935 above includes members. | `/sector/roads/procurement#contractors` |

„На разпознат път" (52.6%) is a coverage figure, not a thesis figure. It moves to the network
tile's basis line (C19).

**Evidence aside.** „Коридори по вложени средства" lists the top 5 corridors from the blob,
captioned „от договорите с разпознат път". Each row links
`/sector/roads/network?corridor=<encodeURIComponent(id)>&pscope=all` (C11). Run this after T1's
R7 fix, otherwise Хемус carries Русе–Бяла money.

**Finder.** `HubSearch` (T6).

### Bands

Each band carries a description line (C10 caveat 2). Rule from dashboard-hub §3.1-5: a tile
whose destination equals a KPI's is descriptor-only.

| band | tiles → destination |
| --- | --- |
| **Парите** — „къде отиват средствата и колко струва километър" | spend over time (shows the peak year, **not** €8.92bn) → `/procurement`; corridors → `/network`; €/km (median of defensible rows, n≥3) → `/costs`; EU funds (D8, own basis „общ бюджет на проекти по ИСУН") → `/funds?sector=roads` if D8 lands, else `/awarder/000695089#funds` (C8) |
| **Как се възлага** — „конкуренция, риск и промени по договорите" | competition (descriptor-only; KPI 2 owns the figure) → `/procurement`; risk → `/procurement/contracts?sector=roads&grade=D,E&pscope=all` (B6: no F); tenders → `/procurement/tenders?sector=roads&pscope=all`; options exercised → `/procurement#annexes` (D4/D6 wording) |
| **Кой** — „възложители, изпълнители и държавното дружество" | АПИ and its ОПУ → `/awarder/000695089`; contractors (descriptor-only; KPI 4 owns it) → `/procurement#contractors`; in-house builder → `/company/831646048` (D7 label); ОПУ regions → `/procurement#regions` |

Balance is 4/4/4. Every tile id gets a scene, and accents are unique on the page.

---

## 4. Tiers

### T0: stale copy and paths (no figure moves)

- `transportReferenceData.ts:21-23`:
  - say Автомагистрали is roads' in-house *contractor*;
  - fix „~€5.6bn" → €8.92bn (R5).
- Its one test `transportReferenceData.test.ts:61-64` gets the same wording (C2).
- `scripts/prerender/institutions.ts:55-83`:
  - rewrite `descriptionBg/En` and `bodyBg/En` so they promise only what `/awarder/000695089`
    renders;
  - link `/sector/roads` (O2).
- Add `ROADS_SECTOR_PATH = "/sector/roads"` to the import-free `src/lib/roadsAwarder.ts`, and
  fix its stale docstring (lines 23-25).
- `routes.tsx:3207`: redirect `/procurement/roads` → `ROADS_SECTOR_PATH` (C3).
- `ai/render/links.ts:427-432`: point `roadsSpending` at `/sector/roads`. Fix the comments at
  `ai/tools/fiscal.ts:2007` and `ai/orchestrator/router.ts:4045` (O1).
- `route_defs.ts:674-676` is a prose comment; reword it (C3).
- Update the „~2.1k rows" comments in `db_routes.js` and `useRoads.tsx` to „~3k" (R27).
- **Keep** `RoadTopContractorsTile` (it is in the `companyKey.test.ts:239` sweep) and revive it
  in T4. `model.topContractors` *is* consumed (RoadsPack.tsx:89, `ai/tools/fiscal.ts`); only
  `methods` and `topProjects` are unrendered (C1).

### T1: engine corrections in `src/lib/roadAttributes.ts` (bug fixes, no STOP)

Each fix needs a unit test with a fixture row that fails before the fix.

1. **R10.** Exclude `consortium_role = 'member'` from every count and every single-bid aggregate
   in the engine: `competitionStats`, components, region, repeat winners and the insight chips.
   This is the same predicate as migration 023 and the awarder route. € sums are unchanged.
2. **R10, national side.** `national_competition()` (167) counts members too. Once the roads
   figure excludes them, the baseline must as well, or the comparison stops being like for like.
   - Add the same predicate to 167.
   - Re-derive culture's pair: `gen_culture/hub_stats.ts:406` computes it inline, so regenerate
     `culture/derived/hub_stats.json`.
   - Cloud: `apply_functions.ts 167_national_competition.sql`. 167 is a function, applied and
     never loaded; name its applier.
   - Measured effect is small (corpus 24.13% → 24.95%) but it is a basis rule.
3. **R7.** Teach `roadRefOf`:
   - АМ Русе–Велико Търново, as its own corridor, including „Участък Русе – Бяла" and „Обход
     Бяла" ОП2;
   - Железница tunnel → Струма.
   - Re-measure `refCoverageEur`; expect ~62%.
4. **R12.** A lot naming ≥2 ОПУ goes to a „няколко ОПУ" bucket, not the longest name. The
   region tile shows that bucket as its own row.
5. **R14.** Give Струма two axes: own chainage 0–166.5 (cap 167) and I-1/E79 chainage 300–445.
   Strip rows go by the axis their km falls into.
6. **R15.** Chainage strip:
   - the denominator is the motorway's real length (the `MOTORWAY_MAX_KM` table);
   - bins are €-weighted with a per-bin € floor;
   - the caption reads „дял от дължината с договорени работи над €X".
7. **R13.** The €/km tile hides a corridor median below n=3, or badges it „1 договор".
8. **R27.** Add `AND tag='contract'` to `awarder-contracts`. ⚠ Check every consumer of the route
   first: the awarder page may render amendments. If any does, leave the route alone and keep
   the comment fix.
9. **R8.** Add a growth series to the time spine: per row, signing value vs
   `amount_eur − signing_amount_eur`, so the 2024 peak shows its growth share (D6). Keep the
   insight chip, but word it „текуща стойност".

Gate: a `roads_engine.data.test.ts` arm reproduces the R10/R12/R14 measured figures from PG
with bands.

**Implementation notes (2026-10-12):**
- **T1.2 deviates from the text above.** 167 gains `singleBidExMembers` / `bidKnownExMembers`
  BESIDE its original keys rather than changing them. Culture's blob, its `/culture/procurement`
  baseline and `awarder_group_model` (061) all count members, so changing 167's existing keys
  would have moved another sector's published figures. Roads WILL compare against the
  ex-member pair (T3's blob, T5's sub-page); no consumer reads it yet after T1. A corpus-wide
  basis change stays a separate decision. Local national rate ex-members:
  108,482 / 259,899 = 41.7% (41.05% with members).
- **T1.8 skipped.** `awarder-contracts` also feeds the tourism tiles and the МОН textbook
  tile, so a `tag='contract'` filter would change pages outside roads. The route instead gains
  `consortium_role`, which R10 needs. That is a `deploy:db` change; until it ships, the deployed
  route omits the column and the engine counts members as before.
- Measured after T1: model rows 2,327 (members dropped), total €8,917.4M (unchanged);
  `refCoverageEur` 52.6% → **58.8%** (the ~62% estimate was high); „Няколко ОПУ" €744M;
  Струма I-1 strip 38 contracts / €433.8M; 2024 growth €809.5M of €2,884.1M.

### T2: register (sector-dashboard §1); needs D5

- New `src/lib/roadsReferenceData.ts`.
  - **roll-up:** АПИ, plus НКСИП if D5 = roll-up.
  - **verify:** empty.
  - **adjacent:** ДА БДП `177344399`, annotated „roll-up of `transport`" (C15).
  - **excluded:** the R3 list.
  - `ROADS_INHOUSE_CONTRACTORS = [{eik:"831646048", name:"Автомагистрали ЕАД"}]`, separate from
    the buyer lists (C16).
- Point the two literal copies at it:
  - `PROCUREMENT_BUYER_SECTORS.roads.eiks` (procurementBuyerSectors.ts:33-37);
  - `SECTOR_EIKS.roads` (sector_stats.ts:112).

  `SECTOR_BROWSE_PACKS.roads` already derives from the first. `SECTOR_DASHBOARDS.roads.members`
  maps the roll-up (C17).
- ⚠ **`entryGraph.test.ts` forbids `*ReferenceData` on the entry path.** `routes.tsx` and the
  hub registry import only from `roadsAwarder.ts`.
- If D5 is roll-up:
  - regenerate `sector_stats.json`; `all.roads` goes €8.92bn → ~€9.14bn, ns windows unchanged;
  - commit it with the code;
  - `bucket:sync:paths -- procurement/derived/sector_stats.json`.
- Gate `roads_register.data.test.ts`:
  - stem sweep of **contracts and tenders** (`пътн|магистрал|областно пътно|ОПУ|тол|винет|НКСИП|стратегически инфраструктурни`),
    with a money floor; every buyer above the floor sits in exactly one list;
  - removing the НКЖИ exclusion must **change** the swept set;
  - every adjacent EIK sits in exactly one other sector's roll-up;
  - `831646048` is in no buyer list;
  - every roll-up entry has a name.

### T3: hub blob (culture step 5b)

**Generator.** `scripts/db/gen_roads/hub_stats.ts` (`npm run db:gen-roads-hub-stats`) writes
`data/roads/derived/hub_stats.json`.
- `bucketPath: "roads/derived/hub_stats.json"`.
- The hook reads `dataUrl("/roads/derived/hub_stats.json")`.
- **Not under `procurement/`**: `isExcluded` refuses that path and `refresh_coverage.test.ts`
  would fail (B2).

**Model.** Run the real `buildRoadsModel` in Node; there are precedents (C14).
- Its runtime imports are browser-free: `awarderModel`, `cpvSectors`, `roadsAwarder`.
- The drift risk is the input row shape. Move the `awarder-contracts` SELECT into one module that
  both the route and the generator use. If the function bundle cannot import it, assert row
  equality in the data test (C14).

**Contents.** Numbers only, no prose and no URLs:
- the four KPI pairs, un-divided;
- the national pair (computed inline, as culture does);
- the top 5 corridors after T1;
- the corridor list and ОПУ list for the finder (C12);
- the peak year with its growth share;
- the in-house share;
- coverage (`refCoverageEur`, defensible €/km rows);
- `firstDate` / `lastDate`;
- a `sources` map.

**Type and budget.** The type is declared once in `src/data/roads/hubStats.ts` and imported by
the script. Byte budget < 4096, the same as culture.

**Wiring.**
- `REFRESH_GENERATORS` entry: `artifact`, `reason`, `bucketPath`, git-tracked.
- The `tsx` entry names the artifact path, with no `--write` gate.
- Chain slot is **immediately after `db:gen-sector-stats`** (C13): it reads `fund_projects`
  (chain step 31) and `procurement_annexes`, and the agreement gate compares against
  sector_stats. Say so in `reason`.
- Add `ORDER_PAIRS` entries for `db:load:pg`, `db:load:annexes:pg`, `db:load:funds:pg` and
  `db:gen-sector-stats`.
- Preflight is a relation→loader map with skip-and-warn, as in `gen_culture/hub_stats.ts`.

**Gate `roads_hub_figures.data.test.ts`:**
- re-derives every figure from PG;
- rejected bases are `notEqual`: all-tag sum, member-inclusive counts, pre-annex sum;
- **KPI 1 == `sector_stats.json` `all.roads`**;
- byte budget.

### T4: hub screen and sub-page move; needs D6, D7, D8

**Files** in `src/screens/roads/`:
- `roadsRegistry.ts`, with inline `ROADS_HUB_COPY` in bg/en, no figures in copy, no i18n corpus
  keys (O6);
- `roadsScenes.tsx`;
- `roadsHubFigures.ts`;
- `roadsSearch.ts`;
- `RoadsHubScreen.tsx`;
- `RoadsNetworkScreen.tsx`, `RoadsCostsScreen.tsx`, `RoadsProcurementScreen.tsx`.

**Sub-pages.** Each one composes existing `Road*Tile`s.
- Section ids `#contractors`, `#regions`, `#annexes`, `#inhouse`, `#pipeline` exist on
  `/procurement` (C9).
- `/network` carries `data-og="roads-map"` (C7) and reads `?corridor` through `useSearchParams`
  into the controlled `focusCorridor` state (C11).
- `/procurement` uses `useNationalCompetition()` on its own window, never the blob (C20).
- `/network` and `/costs` call a light `useRoadsModel` without `useCounterparties` (O4). The hub
  calls neither.
- Revive `RoadTopContractorsTile` under `#contractors`, with the D7 in-house label and
  `CompanyLink` for keys.
- `#annexes`:
  - the ×1.5 option cluster, grouped by `change_reason`;
  - the national baseline (450 contracts, АПИ 94.3%);
  - worded per D6;
  - with the note that `procurement_annexes` gives the legal ground. This replaces 4b's planned
    ал.2/117а split (C18); no migration is needed.

**Routes.** Four literal routes: `sector/roads`, `sector/roads/network`, `sector/roads/costs`,
`sector/roads/procurement`. Use literals, not a splat, so the registry and router-census gates
can read them (C4).

**`SECTOR_DASHBOARDS.roads` becomes inert but complete (B3).**
- Keep `id`, `titleKey`, `descKey`, `agency`, `leadEik`, `browsePackId` and `members`.
- Add an ⚠ INERT comment, as administration has.
- Keep `RoadsPack` registered at `[API_EIK]`, so `CompanyDbScreen`'s
  `showPack = SectorPack && !sectorDash` still suppresses it on `/awarder/000695089`.
- `sectorDashboards.test.ts:529` stays as is.

**Losses to record in the commit (O7).** The generic shell's `SectorAwardersTile` (one АПИ chip)
and `PackContractsLink` go away. Their content is covered by the „Кой" band and KPI 1.

**D8.** `beneficiaryCorpora: ["fund_projects"]` on the roads pack. Verify the funds browser
reads `?sector` before the tile links to it.

**Gates.**
- `roadsRegistry.test.ts`, copying `cultureRegistry.test.ts`:
  - every `to` is routed;
  - every procurement link carries `pscope=all`;
  - unique accents;
  - only grades the corpus has (`A–E`, B6);
  - every emitted fragment exists on its destination;
  - band row balance.
- `roadsScenes.test.tsx`.
- `RoadsHubScreen.test.tsx`.
- `roadsHubFigures.test.ts`.

### T5: competition baselines and annex wording on the sub-pages

- KPI 2 basis and the `/procurement` competition tile, both against `national_competition` on
  the same window, after T1.2.
- ОПУ competition tile: a national peer baseline; worded „за проверка" (sector-dashboard §9).
- Single-bid captions name the statutory share (R20, D7): €493.6M in-house + €267.3M
  negotiated-without-notice of the single-bid €. Do not re-score.

### T6: finder

`roadsSearch.ts` on `HubSearch`:
- **corridors + ОПУ:** a client index over the **blob's** lists. Not `MOTORWAYS` (unexported)
  and not the contract fetch (C12).
- **procurement:** server `procurement-search`.
- **contractors:** `isLinkableCompanyKey`.

If both server groups use `procurement-search`, they share **one memoised request**. Both labels
say they search the whole corpus, because the route takes no sector argument. A see-all link
appears only where the destination reads `?q` (`/procurement/contracts` does).

Gate: `roadsSearch.test.ts`.

### T7: page layer (B1, B4, C5–C7)

**Prerender (B1).**
- Add `BESPOKE_SECTOR_PAGE_IDS = ["roads"]` in `scripts/prerender/routes.ts`.
- Exclude it from the `SECTOR_PAGES` coverage guard (:1324-1330) and from
  `sectorStaticPages()` (:1788), and update the comment at :944-948.
- Hand-author `staticPage`s for `sector/roads` and the three sub-pages, with real BG+EN
  `bodyHtml`.
- The hub's `ogImage` is `/og/sector-roads.png`.
- Add a `tests/seo.spec.ts` entry with `minBodyChars` for each.

**Sitemap (B4).**
- `sector/roads` is already emitted through `SECTOR_SLUGS`; repoint its `file:` at
  `RoadsHubScreen.tsx`.
- Add **only the three sub-pages** to `routeDefs` and `ENGLISH_STATIC_PAGES`, as with
  `sector/administration/services`.
- `file:` points at tracked files: `data/roads/derived/hub_stats.json` or the screen `.tsx`.
  Never `procurement/roads.json`, which is gitignored and would silently drop the `<loc>`.
- Run `npm run sitemap` and **commit** the XML.

**OG (C6, C7).**
- Add roads to `HAND_FRAMED` in `screenshot_sectors.ts`. Unlike administration, do not leave it
  out, or a generic run overwrites the card.
- `capture-screens.ts` entries:
  - `sector-roads`: `anchor: "[data-hub-head]"`, `viewport: OG_CLIP_VIEWPORT`, `waitFor` naming
    the optional KPI cells by href;
  - `sector-roads-network`: anchor `[data-og="roads-map"]`;
  - `sector-roads-costs`.
- Register in `ogAndSitemapCoverage.test.ts`: `HUB_CAPTURES["sector-roads"]`,
  `FIGURES["sector-roads"]`, and the sub-page captures.

**Head gates (C5, C6).**
- `hubHead.gates.test.ts` `HUB_SCREENS` gets `RoadsHubScreen.tsx` and `roadsHubFigures.ts`, plus
  the band↔tile and „no two KPI cells share a destination" fixtures.
- `tests/ui.spec.ts` `HUB_HEAD_BUDGETS` gets `{ path: "/sector/roads", maxPx: measured+≤20%,
  measured, cells: 4, asideRows: 5 }` plus the path→screen map entry. Culture's is 560/495;
  420 was unrealistic.

**Look at the pages (sector-dashboard §12).** Open all four pages in both languages. Compare the
runtime `<title>`/`<h1>` with the prerendered head.

**Needs no change:** `hubMenuCoverage`, the llms index, the governance tile and scene
(N1–N3, verified).

### T8: reload and publish path

- The blob is PG-generated and moves on a procurement / annexes / funds reload. That reload
  wakes `update-procurement`, not anything owning `roads/`, so freshness relies on
  `process-watch-report` step 8 `db:check-generated`. Its `bucketPath` registration (T3) is
  what makes the check see it.
- Add a `process-watch-report` mapping note naming `db:gen-roads-hub-stats` +
  `bucket:sync:paths -- roads/derived/hub_stats.json`.
- Cloud SQL steps:
  - 167 re-apply (T1.2);
  - `sector_stats.json` sync if D5 lands.
- No new table, so no `recent_updates` row or Data Map entry. Say so in the commit.
- `procurement/roads.json` geometry: no change. Optionally give `ingest_osm_roads.ts` an npm
  alias (N4).

### T9: gates (last, separate)

Collected from the tiers above, plus the audit-sectors Phase 4 pins:
- headline bands: all ≈ €8.92bn (or ~€9.14bn with D5); ns:2026 ≈ €234M;
- the four copies equal the roll-up;
- НКЖИ absent; `831646048` never in the buyer set and still classified as a public contractor;
- model total == `sector_stats` per scope;
- pack contract count == non-member count;
- the top-contractor share ceiling (all-time < 20%);
- leaderboard Σ == headline per scope (failure O).

Break each gate's clauses and watch it fire before calling it done (sector-dashboard §13).

---

## 5. Shipping order (B5)

```
1. T1 engine + 167 locally          → npx tsx scripts/db/apply_functions.ts 167…  (local)
2. npm run db:gen-sector-stats && npm run db:gen-roads-hub-stats   → commit both artifacts
3. npm run dev  →  npx tsx scripts/og/capture-screens.ts sector-roads sector-roads-network sector-roads-costs
                                                        → commit PNGs (after screen + figures)
4. npm run sitemap                                      → commit public/sitemap*.xml
5. Cloud: apply_functions.ts 167_national_competition.sql (the :5434 proxy)
6. npm run bucket:sync:paths -- roads/derived/hub_stats.json procurement/derived/sector_stats.json
7. npm run db:check-generated
8. npm run build && npm run deploy
```

`deploy:db` is needed only if T1.8 (the route `tag` filter) or a new route ships. If so, it goes
after step 5 and before step 8.

---

## 6. Not in v1

- A budget-basis headline (D2): the МРРБ road programme.
- Per-corridor pages; `?corridor=` on `/network` is the picker.
- Municipal-road procurement.
- The cost-overrun pillar (11% tenders join).
- НКЖИ rail as a second engine instance.
- Folding consortium *member* political links into the carrier (R24's €59.2M).
- An ИСУН alias fold for `000698085` (R26).
