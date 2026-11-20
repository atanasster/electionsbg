# Education hub v1: `/sector/edu` becomes a sector dashboard

**Status: PLAN, 2026-11-20. §0 ACCEPTED by the operator 2026-11-20 — every "default proposed"
column below is the decision** (D1 principal rule, D2 add ЦРЧР + НДД, D3 `support_centres` with
per-EIK verification and unverified → VERIFY, D4 НАПОО/НИО adjacent + ЦРЧРРИ verify, D5a keep
`/education` and cross-link). Implement through `/implement-plan`, one tier per step.

**Templates** (closest first):
- `transport-hub-v1.md` (in this folder): tier structure, head/KPI band, 4/4/4 bands,
  shipping order, T9 gates. Transport was the last generic `/sector/:id` page to become a hub.
- Shipped code: `src/screens/transport/*`, `src/screens/roads/*`, `src/screens/water/*`,
  `scripts/db/gen_{transport,roads,water}/hub_stats.ts`.
- Retired plans (`git show cf6ec257dd^:docs/plans/<name>`): `roads-hub-v1.md`,
  `water-hub-v1.md`, `education-sector-audit-v1.md` (the 2026-08-18 widening from 1 to 126 EIKs).

**Governing skills.** `dashboard-hub` owns what is visible, `sector-dashboard` owns what is
countable, `audit-sectors` is the method for T9.

**How the figures were measured.** Local PG (5433), 2026-11-20, `tag='contract'`. Cloud SQL
(5434) was unreachable, so prod was checked through the live API instead:
`/api/db/awarder-group-model` over the 126 EIKs returns **€2,137,391,841 / 21,706 contracts**
against local **€2,137,447,643 / 21,707**: one contract and ~€60k of vintage drift, no defect.
T8 step 1 still re-checks Cloud SQL directly.

---

## 0. Decisions (STOP: operator's call)

| id | question | options and measured impact | default proposed |
| --- | --- | --- | --- |
| **D1** | **Universe.** `principal = МОН group` (today: МОН, its bodies, 33 state universities, БАН, ССА) or „everything a reader calls education", i.e. also schools and kindergartens? | 2,438 further buyers declare `buyer_main_activity = 'Образование'` in `tenders`: **€1,158.6M / 31,345 contracts**, almost all municipal schools and kindergartens (municipal principal). Adding them is +54% on the headline and a different page. | **Keep the principal rule.** Schools stay on `/education` (outcomes) and get a cross-link band on the hub, with their procurement total shown as a separate, labelled figure, never summed (§4 of the skill). |
| **D2** | **Add the missing МОН bodies to the roll-up?** Corpus sweep (both corpora) found МОН second-level units in no sector at all (§2 A1). | ЦРЧР `130047747` **€9.58M / 221**; Национален дворец на децата `000672382` **€2.58M / 21**. Together +€12.16M (+0.57%) on all-scope. | Add both to `agency`. |
| **D3** | **ЦСОП and РЦПППО** (special-needs support centres and regional inclusive-education centres). State bodies financed via МОН under ЗПУО, but some ЦСОП were municipalised. | 31 ЦСОП EIKs **€6.18M / 125**; 4 РЦПППО **€0.16M / 4**. | New universe `support_centres`, but each EIK verified individually against the МОН register of state ЦСОП. Unverified ones go to the VERIFY list, not the roll-up. |
| **D4** | **Adjacent bodies** (real education bodies, another principal). | НАПОО `130273618` €2.13M (МС); Национален инспекторат по образованието `177268001` €0.04M (МС); ЦРЧРРИ `131275351` €18.09M (principal unknown). | НАПОО and НИО → `adjacent` (shown, not counted). ЦРЧРРИ → `verify`. |
| **D5** | **What happens to `/education`?** | (a) leave it as is and cross-link; (b) make it `/sector/edu/schools`, a sub-page of the hub, with a 301. | **(a)** for v1. It is an outcome page with its own prerender/sitemap/og and search box; moving it is a separate change. |

Not a decision, recorded for completeness: **the hub headline basis.** `/governance/sectors`
keeps `basis='budget'` on МОН's own node (2026: **€758,408,400**). The hub's KPI 1 is the group's
procurement (a different basis). The two are never summed, which the existing footnote already says.

---

## 1. Measured baseline

### Group totals by universe (all scope, local PG)

| universe | EIKs | € | contracts |
| --- | --- | --- | --- |
| ministry (МОН) | 1 | €505.58M | 1,085 |
| agencies & state companies | 16 | €130.36M | 357 |
| state universities | 34 (33 institutions) | **€1,295.40M** (60.6%) | 16,938 |
| БАН | 47 | €151.96M | 2,198 |
| ССА | 28 | €54.14M | 1,129 |
| **total** | **126** | **€2,137.45M** | **21,707** |

- All 126 EIKs have contracts and tenders; none is shared with another sector's
  `members`/`eiks` (checked against all 31 dashboard/pack lists, 934 memberships).
- Default scope `ns:2026_04_19` (live API): **€125.13M / 1,383 contracts, 90 of 126 bodies.**
- 16 contracts carry a NULL `amount_eur` (coverage line, see A9).

### By year

2011 €54.9M · 2012 €40.0M · 2013 €81.3M · 2014 €71.8M · 2015 €43.0M · 2016 €82.5M ·
2017 €77.3M · 2018 €66.5M · 2019 €158.9M · **2020 €24.6M / 116 contracts** (the corpus hole,
see A8) · 2021 €214.7M · 2022 €206.2M · 2023 €282.4M · 2024 €233.6M · 2025 €302.3M ·
2026 (to Nov) €197.4M.

### Competition, same window, edu vs all other buyers

| window | edu single-bid | bid count known | all others |
| --- | --- | --- | --- |
| all | 42.9% | 75.1% | 41.0% |
| 2023+ | 44.2% | 88.4% | 44.6% |
| since 2026-04-19 | 47.0% | 100% | 47.1% |

Read aloud: **education competes like the average buyer.** Shown alone, 47% reads as an
indictment; with the same-window baseline it is typical.

### Other corpora the hub can draw on (reach per corpus, skill §5)

| corpus | rows ∩ roster | figure |
| --- | --- | --- |
| `fund_projects` | 504 rows / 94 EIKs | **€2,539.7M grant** (МОН €1,782.7M, universities €419.2M, БАН €233.2M) |
| `agri_subsidies` | 1,405 rows | ССА institutes take CAP payments (basis: payout) |
| `interreg_partners` | 36 rows | small; partner budget basis |
| budget node `EDU_BUDGET_NODE` | 2018-2026 | МОН's own enacted budget, €298.8M (2018) → €758.4M (2026) |
| `data/education/textbook_market.json` | — | MonPack textbook-market analysis |
| schools / matura (`/education`) | — | outcomes, not money |
| `fund_projects` RRP school projects | 2,175 rows | €318.9M to schools (not roster; D1) |

---

## 2. Audit findings and where each is fixed

### Register (T0, bug fixes unless marked STOP)

- **A1. Missing МОН bodies** (D2, D3, D4). ЦРЧР €9.58M and НДД €2.58M are in no sector; 35
  ЦСОП/РЦПППО centres €6.34M; НАПОО, НИО, ЦРЧРРИ undeclared. Add per §0, and add the four-list
  shape (`roll-up / verify / adjacent / excluded`) that culture/transport use: today the file
  has only the roll-up and an external-schools list.
- **A2. A fifth military higher school is missing from `EDUCATION_EXTERNAL_HIGHER_SCHOOLS`.**
  Висше военновъздушно училище „Г. Бенковски" `129011005` (€8.27M) is in `pack:defense`, but the
  list has four entries. So `educationFootnote()` and the prerender intro
  (`scripts/prerender/routes.ts:1306`) both state **„Други 4 държавни висши училища"** when it is
  five. Add the row; the footnote and intro derive from it.
- **A3. Exclusions not recorded.** The sweep matched Академика 2011 ЕАД `201745141` (€10.18M,
  sports halls, ММС) and Академика спорт ЕАД `131351781` (€0.65M), НСИ, БИМ, БИС, ИПА,
  Дипломатически институт. None is education; add them to `excluded` so a name match cannot
  re-admit them.
- **A4. Stale header figures** in `educationReferenceData.ts`: „~€2.11bn" (now €2.137bn), and
  the `EDU_UNIVERSE_RANK` comment's per-universe € (universities €1.27bn → €1.295bn, БАН €147.3M
  → €152.0M). Replace with „measured on <date>" or drop the figures.

### Page (fixed in T3 by the hub; listed so the gates cover them)

- **A5. Duplicate chip.** The bodies list renders „Стопанска академия „Д. А. Ценов" — Свищов"
  twice (EIKs `000124026` and retired `040624317`). Visible in the current page. Render one chip
  per institution; the retired EIK's contracts (2011-2015, 69 contracts) fold into it.
- **A6. Headline count says 126 bodies** („Възложителите на сектора (126)") while the institution
  count is 125. Use `EDU_INSTITUTION_COUNT`.
- **A7. The page is the generic `SectorDashboardScreen`** with no baseline, no basis lines, no
  coverage and the textbook pack thematic-only. This is what the hub replaces.

### Data-shape observations (caption, don't hide)

- **A8. 2020 corpus hole.** €24.6M / 116 contracts against €158.9M (2019) and €214.7M (2021).
  Same hole transport captioned (its G1). The by-year chart needs the caption.
- **A9. NULL amounts.** 16 contracts have no `amount_eur`; the biggest are database
  subscriptions (Elsevier, EBSCO, ProQuest), the sector's dominant single-bid category. Show
  as a coverage line beside the top-contracts tile, and sort `NULLS LAST` (a naive DESC sort
  puts them first; it did in this audit).
- **A10. A financing agreement counted as procurement.** Изпълнителна агенция „Програма за
  образование" → Фонд мениджър на финансовите инструменти, **€13.91M, 0 tenderers**
  (2024-09-23). It is a transfer between state bodies, not a market purchase. Disclose it in
  the state-bodies list (transport D9 shape). Don't net it (same reason as transport D5).
- **A11. Intra-group flow: €17.6M / 10 contracts**, almost all МОН → „Ученически отдих и спорт"
  ЕАД (its own company: €8.46M 2025, €6.23M 2022, €1.78M 2013). Its own KPI/disclosure, never
  netted.
- **A12. Public-body contractors.** Топлофикация София €57.10M / 26 buyers is the #2 contractor
  all-time; utilities (heat, Mobiltel, ЧЕЗ Трейд) fill the top 10. The leaderboard needs a
  „utility/regulated supply" marker or a tab that excludes them, or it reads as market share.
- **A13. The school-bus programme.** МОН bought school buses from two suppliers: **Исубус
  ООД and Джеми ООД, €92.1M over 40 contracts, 32 of them single-bid (80%)**, 2014-2023. This
  is the strongest thematic finding in the corpus and becomes a tile (worded „за проверка").
- **A14. 2021 devices.** МОН's distance-learning device purchase of 2021-05-18 is three
  contracts (€32.21M А1, €16.97M „Хромбук…" ДЗЗД, €12.79M „Сиенсис-лирекс" ДЗЗД), €61.97M in
  total. Group it as one procurement on the top-contracts tile.
- **A15. `sector_stats.json` parliament windows** carry the 2026 budget (€758.4M, `year: 2026`)
  for every `ns:*` window back to 2005, while `y:2011-2017` carry the same value marked
  `unavailable`. Probably the generic rule for `basis='budget'` (latest budget for parliament
  windows), not edu-specific. **Check in T9 that the hub tile renders the year it shows**; if
  other budget-basis sectors behave the same, it is a separate fix.

---

## 3. Target shape

```
/sector/edu                hub (unscoped; every link carries ?pscope=all)
/sector/edu/procurement    #spine (by year, 2020 caption) · #universes · #competition (same-window)
                           · #contractors (utility marker, in-group) · #top-contracts (A9, A14)
                           · #buses (A13) · #textbooks (MonPack, moved here) · #direct      (scoped)
/sector/edu/bodies         the institutions by universe, one chip per institution (A5, A6)
                           + verify / adjacent / external higher schools lists               (scoped counts)
/sector/edu/money          #budget (МОН node, by year) · #funds (fund_projects, grant basis)
                           · #research (БАН/ССА: procurement + EU + CAP, per-corpus basis)  („без период")
```

- Fragment ids are this set only. A registry test checks that every `#fragment` a tile emits
  exists on its destination. Every sub-page runs `useHashScroll`.
- **`?universe=<ministry|agency|higher_education|research_ban|research_ssa|support_centres>`**
  on `/procurement` and `/bodies` only. Validated on read and page-local (not in
  `usePreserveParams`), like transport's `?mode`.
- `/money` has no ScopeControl but resolves an inbound `pscope` (transport O1).
- **MonPack** stops being the thematic content of `/awarder/000695114`. Its tiles move to
  `/sector/edu/procurement#textbooks`, and `SECTOR_DASHBOARDS.edu` becomes inert:
  - drop `packIsThematic`;
  - keep `members`;
  - delete the pack registration only after confirming nothing else renders it.

### Head (dashboard-hub §3.0)

- **Breadcrumb:** Управление › Сектори › Образование и наука.
- **Eyebrow:** „СЕКТОР · ОБРАЗОВАНИЕ И НАУКА · обновено dd.mm".
- **Deck:** „какво купуват министерството, университетите и БАН, при каква конкуренция и
  колко евро идва отвън". `seoDescription` is a separate sentence.

**KPI band:**

| # | value | basis line | links to |
| --- | --- | --- | --- |
| 1 | **€2,14 млрд.** | „договори на {n} институции, {first}–{last}, текуща стойност след анекси" | `/procurement/contracts?sector=edu&pscope=all` |
| 2 | **61% университети** | „дял на 33-те държавни висши училища в поръчките на групата" | `/sector/edu/procurement?pscope=all#universes` |
| 3 | **43% с една оферта** | „при 41% средно за останалите възложители · известен брой оферти за 75% от договорите" | `…#competition` |
| 4 | **€2,54 млрд. евросредства** | „безвъзмездна финансова помощ по договори в ИСУН на същите институции; не се събира с т. 1" | `/sector/edu/money#funds` |

- `kpiNote`: four figures, different bases, never summed.
- Evidence rail: top 5 bodies by € → `/awarder/:eik?pscope=all`.
- Finder: `HubSearch` over bodies + whole-register companies and contracts (transport T6).

### Bands (4/4/4)

| band | tiles → destination |
| --- | --- |
| **Кой купува**: „министерството, университетите и науката" | universities → `/procurement?universe=higher_education`; МОН and agencies → `?universe=ministry`; БАН → `?universe=research_ban`; all bodies → `/bodies` |
| **Как се възлага**: „конкуренция и най-големите договори" | competition (descriptor only, KPI 3 owns the figure) → `#competition`; school buses (A13) → `#buses`; biggest contracts → `#top-contracts`; textbooks → `#textbooks` |
| **Пари извън поръчките**: „бюджет, евросредства и училищата" | МОН budget by year → `/money#budget`; EU funds → `/money#funds`; research (БАН/ССА incl. CAP) → `/money#research`; schools and matura → `/education` (D5a) |

Copy is inline `{bg,en}` in `eduRegistry.ts`, as in roads/water/transport (no corpus keys).

---

## 4. Tiers

### T0: register and stale copy (ships and deploys alone)
1. `educationReferenceData.ts`:
   - four-list shape;
   - D2/D3/D4 per the operator;
   - A2 (ВВВУ row);
   - A3 exclusions;
   - A4 header figures.
2. Regenerate `sector_stats.json` (`pnpm run db:gen-sector-stats`). The edu entry is
   `basis='budget'`, so it should not move; verify that it does not.
3. Prerender intro and footnote pick up A2 automatically; check both languages.
4. Regenerate `functions/generated/procurement_query.js`
   (`node --import tsx scripts/ai/buildProcurementQuery.ts --write`): it inlines `EDU_ENTITIES`,
   so the server-side `?sector=edu` filter keeps the old roster until it is rebuilt AND
   `deploy:db` ships it (T8).

### T1: engine corrections (bug fixes, fixture tests)
- One chip per institution (A5); institution count (A6).
- Top-contracts sort `NULLS LAST` + coverage line (A9), only if the shared engine does not
  already do it.
- Same-procurement grouping for A14 (one row with its lots). Measured in T1: the purchase is
  FOUR lots under УНП 00165-2021-0004 on 2021-05-18 (€68.07M), and SIX with the June/July lots
  (Кейсием's €1.46M among them), €75.40M in total — the hub folds the whole УНП (T2 review FINDING-001). The engine already excludes NULL amounts and sorts `NULLS LAST`, so A9 needs only the
  coverage line (T2/T3).

### T2: hub blob
`scripts/db/gen_edu/hub_stats.ts` → `data/education/derived/hub_stats.json` (or
`sector/edu/…`; check `bucket_sync_paths.isExcluded` first, skill §11 rule 2):
- KPI 1–4 for the WHOLE corpus, with numerator/denominator un-divided. The hub is unscoped
  (§3), so v1 ships no per-scope map; the scoped sub-pages compute their figures and their
  same-window baseline live (`awarder-group-rollup?exMembers=1` + `national_competition`)
  (T2 review FINDING-003);
- `firstDate`/`lastDate`;
- per-universe split, in-group € (A11), state-body transfers (A10);
- school-bus figures (A13);
- national baseline via `national_competition(NULL,NULL)` (167), i.e. the same (whole-corpus)
  window as the figure.

Register it in `REFRESH_GENERATORS` with `bucketPath` and put it in the `db:refresh` chain after
its last input (`fund_projects`, i.e. after `db:load:funds:pg`; budget nodes).

### T3: hub, sub-pages and page layer, in ONE commit
- `src/screens/edu/` (`EduHubScreen`, `EduProcurementScreen`, `EduBodiesScreen`,
  `EduMoneyScreen`, `EduPageFrame`, `eduRegistry.ts`, `eduScenes.tsx`, `eduHubFigures.ts`).
- Routes before the generic `/sector/:id`.
- Prerender + sitemap entries for all four pages × 2 languages; og image.
- Move the MonPack tiles to `#textbooks`.
- Open every page in both languages and compare runtime `<title>`/`<h1>` against the prerender
  (skill §12).

### T4: same-window baselines
Competition per universe against the same-window national rate, coloured as transport T4.

### T5: money page
- Budget by year from the МОН node.
- `fund_projects` grouped by programme, grant basis.
- Research arm: three corpora, three basis labels, no sum.

### T6: finder
`eduSearch.ts`: bodies (all four lists), companies and contracts in the whole register.

### T7: reload and publish path
- Watcher / `process-watch-report` row for the hub blob's inputs.
- Run `db:check-generated` after the bucket sync.
- `cloud_loader_coverage.test.ts` stays green.

### T8: shipping order
1. Cloud SQL reachable; re-measure §1 on cloud.
2. `bucket:sync:paths` for the blob and `sector_stats.json`.
3. `deploy:db` if any route changed, then `deploy` → `deploy:db` → `SKIP_PREDEPLOY=1 deploy`
   (CLAUDE.md three-step rule).

### T9: gates (last, separate) + `/audit-sectors` pass
- Corpus sweep over BOTH corpora: every education-like buyer above €0.5M is in exactly one
  list (would have caught A1, A2 and A3).
- Every curated external school is claimed by its named sector (extend the existing test to five).
- Hub KPI 1 equals `awarder-group-model` over the roster for every scope; KPI 3's baseline
  window equals the figure's window (mutation-checked).
- Intra-group € and state-transfer € re-derived from contracts, not read back from the blob.
- Every `?sector`/`?universe`/`#fragment` a tile emits is read by its destination.
- A15 check.
- Each gate is broken once by hand to watch it fail.

---

## 5. Not in v1
- Municipal schools' procurement in the roll-up (D1).
- Moving `/education` under the hub (D5b).
- Per-university sub-pages (thin content; `/awarder/:eik` already serves them).
- A per-student cost metric (needs a headcount corpus the repo does not hold for universities).
- The generic budget-basis parliament-window behaviour (A15), if it turns out to be cross-sector.
