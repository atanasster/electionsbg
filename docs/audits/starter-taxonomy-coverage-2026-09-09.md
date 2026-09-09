# Starter taxonomy and data coverage audit — 9 September 2026

## Verdict

The missing menu entries are real integration gaps, not a limitation of the compact dropdown. The SQL selector exposes only leaves containing a **ready SQL question**. Budget and taxes has five declared leaves, but only Municipal finances contains a selectable SQL question. Existing fiscal data and serving functions cover substantially more.

This is a complete static inventory of the current question catalog, 218 registered chat tools, 44 SQL recipes, 206 API routes, the 37 declared dataset nodes, and SQL function declarations. It includes targeted source inspection and exact read-only local budget database counts. It is **not** a production freshness audit or an execution test of every tool, route, or question. A declared source, a loaded table, a registered tool, a tested answer and a discoverable starter are different stages.

The earlier 12-step completion claim overstated implementation: large portions were recorded as review/unavailable dispositions rather than delivered functionality. Those dispositions must not serve as evidence that the underlying data is missing.

## Measured coverage

| Measure                                                    | Current code |
| ---------------------------------------------------------- | -----------: |
| Declared categories / subcategories                        |      19 / 67 |
| Chat questions                                             |          153 |
| Chat-visible categories / subcategories                    |      16 / 48 |
| SQL-visible categories / subcategories                     |       9 / 18 |
| Subcategories with neither chat nor SQL starters           |           14 |
| Registered chat tools without any starter                  |    65 of 218 |
| Registered SQL recipes / selectable recipes                |      44 / 39 |
| Chat question IDs explicitly ready on both surfaces        |            2 |
| Chat questions without catalog source IDs                  |   146 of 153 |
| Editorial questions promoted / unavailable / new ingestion | 2 / 227 / 28 |

Counts describe catalog readiness before any server capability downgrade. A nonzero starter count is not full coverage of the topic. The two dual-ready IDs are nationalResults and presidentialResults; legacy SQL questions can cover similar subjects under different IDs.

## Findings and repair priorities

### P1 — Fiscal answer double-counts the national total

`ai/tools/fiscal.ts:445`, budgetByFunction, maps all COFOG series including TOTAL, then sums them. In local `data/cofog.json` for 2024, TOTAL is €41,059,600,000 and the ten functional components sum to €41,059,400,000 (a €200 rounding difference). The implementation reports €82,119,000,000, with TOTAL as the top function and approximately 50% of spending. It also falls back to the last point when a function lacks the requested year, potentially mixing periods.

Repair before expanding this starter: exclude TOTAL from component rows, use the official same-year TOTAL as denominator, preserve rounding residuals, and mark missing same-year components as unavailable. Add a regression using the real series shape and a missing-year case. This audit documents the defect; it does not change runtime code.

### P1 — Budget SQL discovery ignores existing populated serving layers

Evidence: `functions/db_routes.js:450` onward and `scripts/db/schema/pg/155_budget_serving.sql`. Existing routes cover administration/function exploration, ministries, plan-versus-execution variance, personnel, laws/documents, municipal execution, capital projects and transfers. None of the 44 recipe relation lists directly references the budget dataset's normalized relations. Chat fiscal tools mostly read JSON artifacts, so absence of literal calls to these routes does **not** mean all fiscal chat answers are absent.

Exact local counts, obtained with read-only COUNT(\*) on 9 September:

| Relation                    |   Rows |
| --------------------------- | -----: |
| budget_admin_fact           |    873 |
| budget_program_fact         |    695 |
| budget_cofog                |    165 |
| budget_kfp_observation      |    305 |
| budget_personnel            |     23 |
| budget_document             |     34 |
| budget_muni_execution       |    452 |
| budget_muni_transfer        |  2,385 |
| budget_muni_capital_project | 13,875 |
| budget_muni_ipop_project    |  3,492 |

`pg_stat_user_tables.n_live_tup` incorrectly reported zero for several of these tables. The schema sidebar uses estimates; never treat its ~0 as proof of missing data. Counts prove population, not completeness, source freshness or availability in production.

Step 7 dispositions call for new budget_variance and budget_personnel_series contracts although functions with those names already exist. Their actual signatures differ from the proposed contracts: budget_variance(int,int), budget_personnel_series(int), and budget_admin_detail(text,int). Inspect their semantics and adapt these contracts first; do not duplicate serving functions based on stale prerequisite prose.

### P1 — Existing chat capabilities are undiscoverable

65 registered tools have no starter. Particularly clear empty leaves are Education/schools (schoolMatura, schoolScores), Government debt (govDebt), Air quality (airQuality), Road safety (securityRoadSafety), Tourism (tourismSeasonality, tourismSourceMarkets), and Open calls (openCalls, absent from chat although SQL has entries). Hospital activity and scorecard tools are missing from the Hospitals chat leaf while several hospital starters are filed under Health budget.

These are starter/content gaps first. Add questions with appropriate parameter forms and validate the returned answer for the exact wording; do not require new ingestion simply because a starter is absent. See the complete tool list below.

### P1 — Editorial dispositions are not a reliable answerability audit

Of 257 Bulgarian questions, only two were promoted; 227 were marked unavailable and 28 assigned new ingestion. `docs/audits/editorial-question-dispositions.json` often lists topic tools as explicitly excluded without recording an attempted answer.

For example, elections.parliamentary.03 asks for turnout since 2005. `ai/tools/series.ts` already intentionally returns the full bundled turnout history since 2005. This needs validation/promotion, not a blanket unavailable disposition. elections.parliamentary.02 asks how many votes were unrepresented: `ai/tools/integrity.ts:973` loads regional wasted-vote counts and computes national share, but the exposed answer emphasizes percentages. That case needs a count output or narrower wording and a precise below-threshold definition, not a claim that the source is absent.

Re-review each editorial question against actual tool inputs, output fields, scope and sources. Preserve genuinely unsupported questions as backlog. The editorial corpus is not integrated as search aliases: current catalog aliases are empty.

### P2 — SQL readiness, inventory and displayed counts disagree

Five recipes exist but their chat-linked questions remain SQL review: municipalFiscalRanking, personWealth, topContractors, procurementAppeals, companyConnections. Only nationalResults and presidentialResults are in REVIEWED_CHAT_SQL_ADAPTERS. Related legacy recipes may already be selectable, so this is partly duplicate identity/readiness drift, not five wholly missing SQL subjects. Validate and reconcile identities; do not blindly mark all recipes ready.

`src/screens/dev/SqlBrowserScreen.tsx:738` displays ALL_QUERIES.length (37 legacy queries), whereas the combined catalog offers 39 ready SQL questions and the registry contains 44 recipes. Count the actual surface catalog after capability filtering.

### P2 — Taxonomy is too coarse and classifications drift

Budget and taxes has no explicit Tax revenues leaf, and lacks separate Personnel, Capital projects and Budget documents leaves. Existing revenueBreakdown is buried in Budget; exciseRegister/exciseWarehouses are classified as Investment. Land use and broad environmental spending are filed under Waste. Municipal transparency is mapped to Demographic inequality. Electoral vote transitions/persistence are mapped to Polls even though they describe election results, not opinion surveys.

The runtime SQL catalog uses categoryFor heuristics; the historical audit generator maintains another explicit map. Ten query IDs have different classifications between these two maps (listed below). Neither map should automatically be treated as authoritative. Store category/subcategory on the canonical question and reuse it in audits and both surfaces. Support secondary topic tags for cross-cutting questions rather than duplicating identity and readiness.

### P2 — Release gates can pass without usable coverage

`scripts/ai/question_release_gate.test.ts` accepts a tool-to-topic entry as coverage even when no starter exists; dual-surface parity is pinned to two election questions. Historical capability matrices capture older counts (150 chat starters) and dispositions, not current end-to-end capability. 146 chat definitions lack sourceIds, while raw chat readiness is hardcoded ready in `src/lib/questions/catalog.ts:215`.

Replace coverage claims with explicit checks for question → capability → source → readiness → rendered selector presence. Source identities should cover static files as well as SQL relations. Each unsupported leaf needs a reason and owner, rather than silently vanishing and appearing forgotten. Keep disabled/unavailable browsing separate from ready questions, with a compact visible explanation of surface limitations.

## Recommended taxonomy and wiring, by subject

These are implementation recommendations, not declarations that every suggested measure is already validated. Retain stable existing IDs where possible and use aliases when moving questions.

| Category                    | Subcategories to expose or refine; next integration                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Избори                      | Парламентарни; Президентски; Местни; Резултати по места; Активност и начин на гласуване; Промени между избори; Рискове и проверки; Социологически проучвания. Separate transitions from polls; add missing geography/local tools and SQL serving where available.                          |
| Парламент и управление      | Депутати и гласувания; Законопроекти; Правителство и назначения; Общински съвети; Административни услуги; Прозрачност и отчетност. Add vote search/cohesion, digital skills, person profiles and transparency.                                                                             |
| Бюджет и данъци             | Бюджет и изпълнение; Данъчни приходи и акцизи; Министерства и програми; Персонал и издръжка; Общински финанси и трансфери; Капиталови проекти; Държавен дълг; Бюджетни закони и документи; Данъчни сценарии. Reuse normalized fiscal serving; distinguish simulations from observed facts. |
| Обществени поръчки          | Търгове; Договори и анекси; Възложители и изпълнители; Конкуренция; Обжалване и контрол; Проекти и изпълнение; По места. Add contract search, buyer profiles, normalcy, lifecycle and regional breakdowns.                                                                                 |
| Фирми, интереси и имущество | Собственост и управление; Политически връзки; Декларирано имущество; Доходи и задължения; Промени в декларации; Партийно финансиране; НПО. Existing person/declaration APIs warrant field-level integration; add asset rankings and party-finance overview.                                |
| Еврофондове и земеделие     | Отворени процедури; Проекти и плащания; Получатели; Регионално и трансгранично сътрудничество; Земеделски субсидии. Keep awarded-project registers out of Open calls. Add openCalls, fundsProjects, subsidiesForEntity and placeEuProjects.                                                |
| Цени и семейни разходи      | Потребителска кошница; Продукти и магазини; Инфлация; Достъпност спрямо доходите; Горива. Add product/price index/affordability starters and SQL adapters over existing price tables.                                                                                                      |
| Икономика и работа          | Макроикономика; Заетост и заплати; Инвестиции; Регионални различия. Remove excise registers from Investment; promote rankPlaces with an explicit metric.                                                                                                                                   |
| Здравеопазване              | Бюджет на НЗОК; Болници и плащания; Дейности и клинични пътеки; Лекарства; Достъп до грижи. Reclassify hospital starters; add activities, pathway hospitals, scorecards and drug savings. Do not infer waiting times from payments.                                                        |
| Пенсии и социална подкрепа  | Държавни пенсии; Фондове на ДОО; Частни пенсионни фондове; Социални помощи. Add socialSpending/socialBenefits; keep procurement distinct from transfers to households.                                                                                                                     |
| Образование                 | Училища и матури; Образователен контекст и достъп; Висше образование. First expose both existing school tools and school SQL sources. University measures require separate source confirmation.                                                                                            |
| Население и моето място     | Население и възраст; Адресна регистрация; Профил на населено място; Регионални неравенства. Add GRAO explicitly; do not equate registration with resident census population. Move transparency to Governance.                                                                              |
| Правосъдие и сигурност      | Съдилища и натовареност; Магистрати и декларации; Престъпност; Отбрана. Add armsExports/defenseReadiness; inspect magistrate endpoints for missing detail adapters. Crime availability must be checked by measure.                                                                         |
| Енергетика                  | Цени; Производство и микс; Потребление и снабдяване. Existing price/production tools have no SQL starters; static datasets need deliberate SQL serving if dual-surface coverage is desired.                                                                                                |
| Води и околна среда         | ВиК и водоснабдяване; Наводнения; Качество на въздуха; Отпадъци и рециклиране; Земеползване; Разходи и екопроекти. Add airQuality; water/water_stats.json and water-operator-map are integration candidates, with different statistical/geographic scope.                                  |
| Транспорт и жилища          | Железници; Пътища и безопасност; Транспортни проекти; Жилища. Add securityRoadSafety now; do not imply road-safety counts answer road-condition questions. Housing remains measure-specific backlog pending source review.                                                                 |
| Култура и туризъм           | Културни институции; Филмово финансиране; Туристически нощувки и сезонност; Пазари на туристите. Add producer subsidies and both tourism tools. Nights are not visitor counts or revenue.                                                                                                  |
| Медии и обществени нагласи  | Медийни публикации; Обществено доверие. Neither leaf currently has a starter. News collection/analysis is a separate pipeline; implement dated cited retrieval and provenance before promoting news questions. Electoral polling alone does not answer institutional trust.                |
| Данни и покритие            | Търсене; Свежест; Обхват и ограничения. Existing SQL utilities should get understandable chat equivalents where useful; fix inventory discrepancies.                                                                                                                                       |

## Budget question set to implement first

| Bulgarian question                                        | Existing capability/source to use                                   | Remaining work                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Как се променят приходите, разходите и салдото по месеци? | budgetExecution; budget-series; budget_kfp_observation              | Shared period/basis contract and SQL recipe.                                                                             |
| За какво държавата харчи най-много?                       | budgetByFunction; budget-functional; budget_cofog                   | Fix TOTAL bug, then validated chat/SQL measures.                                                                         |
| От кои данъци и акцизи идват приходите?                   | revenueBreakdown; budget/revenue_breakdown                          | Tax leaf, explicit period and source scope; SQL normalization/serving assessment.                                        |
| Какъв е бюджетът на избрано министерство по програми?     | ministryBudget; budget-ministry; budget_program_fact                | Starter with institution picker; common plan/execution basis; SQL recipe.                                                |
| Къде изпълнението се различава най-много от плана?        | budget-variance; budget_variance(int,int)                           | Chat adapter and SQL recipe with coverage and comparable period.                                                         |
| Как се променя персоналът на администрацията?             | administrationOverview; budget-personnel                            | Personnel leaf and SQL recipe; distinguish headcount, posts and expenditure.                                             |
| Какви трансфери получава моята община?                    | municipalTransfers; budget-municipality; budget_muni_transfer       | Municipality/year picker and SQL recipe.                                                                                 |
| Кои капиталови проекти са предвидени за общината?         | investmentProjects; budget-municipal-capital; budget-municipal-ipop | Distinguish allocated, contracted and paid; SQL recipe and project filters.                                              |
| Какви са последните емисии държавен дълг?                 | govDebt; debt-emissions.json                                        | Starter now after validation; check currency handling before SQL contract. This is issuance, not total outstanding debt. |
| Къде са бюджетният закон и приложенията за годината?      | budget-law; budget_document                                         | Chat document listing with source links; SQL recipe.                                                                     |
| Как се различават местните данъци между общините?         | localTaxes; data/local_taxes                                        | Dedicated tax wording and municipal comparison scope; SQL exposure assessment.                                           |

## Implementation order and acceptance criteria

1. Fix incorrect answers first (COFOG total and same-year handling); reconcile readiness/counts and canonical classifications.
2. Review and promote the 65 existing tools into starters, prioritizing entirely hidden leaves. Reuse appropriate Bulgarian editorial questions as canonical wording/aliases. Validate parameters, empty results and provenance for each promotion.
3. Build budget chat/SQL contracts on existing serving functions, then cover other already normalized sources: schools, price facts, agricultural subsidies, open calls, declaration details and municipal councils. Query with the read-only SQL role, bound parameters, enforce limits, and compare same-input chat facts with SQL rows.
4. Assess JSON-only sources individually for SQL serving: party finance, energy, social benefits, tourism, local elections and macro series. SQL feature parity requires deliberate normalization or serving functions; adding menu labels alone does not deliver it.
5. Re-review remaining editorial gaps by exact measure. Water/housing/crime/universities/media/trust need narrower evidence than a broad topic match. Record whether the missing layer is ingestion, loading, serving, tool, recipe, wording or freshness.
6. Regenerate coverage from runtime definitions. Gate each supported leaf on a selectable question, an executable capability, source identity, expected units/period and explicit unavailable behavior. Verify desktop/mobile dropdown navigation and both chat/SQL parameter forms.

Definition of done: no supported leaf disappears solely because a question was forgotten; each selected question works on its declared surface; alternate surfaces show a clear reason when unsupported; audit counts match the selector. Do not require every aspirational leaf to claim readiness.

## Full current category/subcategory matrix

Chat and SQL columns count ready question definitions. Zero means no ready starter in that leaf, not no data.

| Category                    | Subcategory                      | ID                        | Chat | SQL |
| --------------------------- | -------------------------------- | ------------------------- | ---: | --: |
| Избори                      | Парламентарни                    | elections/parliamentary   |   11 |   1 |
| Избори                      | Президентски                     | elections/presidential    |    1 |   1 |
| Избори                      | Местни и частични                | elections/local           |    8 |   0 |
| Избори                      | Вотът по места и в чужбина       | elections/geography       |   13 |   0 |
| Избори                      | Честност на вота                 | elections/integrity       |    9 |   0 |
| Избори                      | Проучвания и поведение           | elections/polls           |    8 |   0 |
| Парламент и управление      | Депутати и гласувания            | institutions/parliament   |    5 |   3 |
| Парламент и управление      | Правителства и длъжности         | institutions/cabinet      |    1 |   0 |
| Парламент и управление      | Общински съвети                  | institutions/councils     |    1 |   0 |
| Парламент и управление      | Администрация и услуги           | institutions/services     |    1 |   0 |
| Бюджет и данъци             | Приходи и разходи                | public-money/budget       |    5 |   0 |
| Бюджет и данъци             | Министерства и програми          | public-money/ministries   |    1 |   0 |
| Бюджет и данъци             | Общински финанси                 | public-money/municipal    |    3 |   1 |
| Бюджет и данъци             | Дълг и дефицит                   | public-money/debt         |    0 |   0 |
| Бюджет и данъци             | Данъчни сценарии                 | public-money/scenarios    |    1 |   0 |
| Обществени поръчки          | Текущи търгове и процедури       | procurement/tenders       |    2 |   2 |
| Обществени поръчки          | Договори и изпълнители           | procurement/contracts     |    2 |   6 |
| Обществени поръчки          | Конкуренция и риск               | procurement/competition   |    2 |   2 |
| Обществени поръчки          | Жалби и контрол                  | procurement/control       |    2 |   1 |
| Обществени поръчки          | Строежи и проектни досиета       | procurement/projects      |    1 |   0 |
| Обществени поръчки          | Поръчки по места                 | procurement/local         |    1 |   0 |
| Фирми, интереси и имущество | Собственици и връзки             | business/ownership        |    4 |   3 |
| Фирми, интереси и имущество | Имуществени декларации           | business/assets           |    1 |   3 |
| Фирми, интереси и имущество | Партийно финансиране             | business/party-funding    |    1 |   0 |
| Фирми, интереси и имущество | НПО и читалища                   | business/ngos             |    5 |   0 |
| Еврофондове и земеделие     | Кандидатстване и срокове         | funds/calls               |    0 |   3 |
| Еврофондове и земеделие     | Финансирани проекти              | funds/projects            |    1 |   0 |
| Еврофондове и земеделие     | Регионално развитие и Interreg   | funds/regional            |    2 |   2 |
| Еврофондове и земеделие     | Земеделски субсидии              | funds/agriculture         |    2 |   0 |
| Цени и семейни разходи      | Храни и пазаруване               | cost-living/basket        |    5 |   0 |
| Цени и семейни разходи      | Инфлация и евро                  | cost-living/inflation     |    2 |   0 |
| Цени и семейни разходи      | Горива                           | cost-living/fuel          |    1 |   0 |
| Икономика и работа          | Икономика и ЕС                   | economy-work/macro        |    4 |   0 |
| Икономика и работа          | Заплати и заетост                | economy-work/jobs         |    2 |   0 |
| Икономика и работа          | Инвестиции и бизнес среда        | economy-work/investment   |    3 |   0 |
| Здравеопазване              | Финансиране на здравеопазването  | health/budget             |    4 |   0 |
| Здравеопазване              | Болници и дейности               | health/hospitals          |    0 |   2 |
| Здравеопазване              | Лекарства и цени                 | health/medicines          |    3 |   1 |
| Здравеопазване              | Достъп и права на пациента       | health/access             |    0 |   0 |
| Пенсии и социална подкрепа  | Държавни пенсии                  | pensions-support/pensions |    4 |   0 |
| Пенсии и социална подкрепа  | Допълнително осигуряване         | pensions-support/private  |    1 |   0 |
| Пенсии и социална подкрепа  | Помощи и бедност                 | pensions-support/benefits |    1 |   0 |
| Образование                 | Училища и изпити                 | education/schools         |    0 |   0 |
| Образование                 | Детски градини и достъп          | education/access          |    0 |   0 |
| Образование                 | Университети и наука             | education/universities    |    0 |   0 |
| Население и моето място     | Население и миграция             | demographics/population   |    1 |   0 |
| Население и моето място     | Моето населено място             | demographics/my-area      |    3 |   1 |
| Население и моето място     | Регионални различия              | demographics/inequality   |    0 |   0 |
| Правосъдие и сигурност      | Съдилища и магистрати            | justice-security/courts   |    5 |   0 |
| Правосъдие и сигурност      | Престъпност и защита             | justice-security/crime    |    0 |   0 |
| Правосъдие и сигурност      | Отбрана и международна сигурност | justice-security/defense  |    3 |   0 |
| Енергетика                  | Ток, газ и отопление             | energy/prices             |    2 |   0 |
| Енергетика                  | Производство и преход            | energy/production         |    2 |   0 |
| Води и околна среда         | Вода и воден режим               | water-environment/water   |    0 |   0 |
| Води и околна среда         | Реки и наводнения                | water-environment/floods  |    1 |   0 |
| Води и околна среда         | Въздух                           | water-environment/air     |    0 |   0 |
| Води и околна среда         | Отпадъци и опазване              | water-environment/waste   |    4 |   0 |
| Транспорт и жилища          | Влакове и обществен транспорт    | transport-housing/rail    |    3 |   0 |
| Транспорт и жилища          | Пътища и безопасност             | transport-housing/roads   |    0 |   0 |
| Транспорт и жилища          | Жилища и градска среда           | transport-housing/housing |    0 |   0 |
| Култура и туризъм           | Култура и финансиране            | culture-tourism/culture   |    5 |   0 |
| Култура и туризъм           | Туризъм                          | culture-tourism/tourism   |    0 |   0 |
| Медии и обществени нагласи  | Доверие и обществени приоритети  | media-society/trust       |    0 |   0 |
| Медии и обществени нагласи  | Новини и проверка на твърдения   | media-society/media       |    0 |   0 |
| Данни и покритие            | Търсене                          | data-coverage/search      |    0 |   2 |
| Данни и покритие            | Актуалност                       | data-coverage/freshness   |    0 |   1 |
| Данни и покритие            | Обхват                           | data-coverage/coverage    |    0 |   4 |

## All registered tools without starter questions

These are existing runtime capabilities, not promises that all current parameters/data are production-ready. Topic labels below are the current audit mapping and include classification issues described above. The JSON companion records descriptions and example questions for each tool.

| Tool                   | Current topic mapping       |
| ---------------------- | --------------------------- |
| regionWinners          | elections / geography       |
| turnout                | elections / parliamentary   |
| compareElections       | elections / parliamentary   |
| partyTimeline          | elections / parliamentary   |
| regionBreakdown        | elections / geography       |
| municipalityBreakdown  | elections / geography       |
| sectionHistory         | elections / geography       |
| settlementBreakdown    | elections / geography       |
| electionAnomalies      | elections / integrity       |
| recountByParty         | elections / integrity       |
| voteTransitions        | elections / polls           |
| localCouncilVoteShare  | elections / local           |
| localMayorsWon         | elections / local           |
| localVoteFlows         | elections / local           |
| localPrevoteFlow       | elections / local           |
| localPlaceTrend        | elections / local           |
| localMayorSections     | elections / local           |
| chmiEvents             | elections / local           |
| budgetOverview         | public-money / budget       |
| institutionMaintenance | public-money / ministries   |
| armsExports            | justice-security / defense  |
| defenseReadiness       | justice-security / defense  |
| securityRoadSafety     | transport-housing / roads   |
| socialSpending         | pensions-support / benefits |
| socialBenefits         | pensions-support / benefits |
| regionalInvestment     | funds / regional            |
| nzokActivities         | health / hospitals          |
| nzokDrugSavings        | health / medicines          |
| nzokHospitalScorecard  | health / hospitals          |
| nzokPathwayHospitals   | health / hospitals          |
| contractSearch         | procurement / contracts     |
| awarderProcurement     | procurement / contracts     |
| procurementNormalcy    | procurement / competition   |
| openCalls              | funds / calls               |
| projectLifecycle       | procurement / projects      |
| subsidiesForEntity     | funds / agriculture         |
| filmSubsidyForProducer | culture-tourism / culture   |
| fundsProjects          | funds / projects            |
| govDebt                | public-money / debt         |
| ministryBudget         | public-money / ministries   |
| personProfile          | institutions / cabinet      |
| personConnections      | business / ownership        |
| mpAssetsTop            | business / assets           |
| mpAssetsByParty        | business / assets           |
| officialsAssetsTop     | business / assets           |
| financingOverview      | business / party-funding    |
| schoolMatura           | education / schools         |
| rankPlaces             | economy-work / jobs         |
| transparencyScore      | demographics / inequality   |
| priceIndex             | cost-living / inflation     |
| productPrice           | cost-living / basket        |
| basketAffordability    | cost-living / inflation     |
| placeEuProjects        | funds / projects            |
| procurementByOblast    | procurement / local         |
| airQuality             | water-environment / air     |
| graoPopulation         | demographics / population   |
| problemSections        | elections / integrity       |
| romaVoteTrend          | elections / integrity       |
| voterPersistence       | elections / polls           |
| factionCohesion        | institutions / parliament   |
| voteSearch             | institutions / parliament   |
| schoolScores           | education / schools         |
| digitalSkills          | institutions / services     |
| tourismSeasonality     | culture-tourism / tourism   |
| tourismSourceMarkets   | culture-tourism / tourism   |

## SQL classification disagreements

Historical audit mapping versus current runtime heuristic; resolve deliberately rather than copying either side blindly.

| Query ID                         | Historical audit        | Runtime                  |
| -------------------------------- | ----------------------- | ------------------------ |
| companies-by-all-public-money    | business / ownership    | procurement / contracts  |
| where-a-buyer-sits               | procurement / local     | procurement / contracts  |
| forecast-vs-actual               | procurement / contracts | procurement / tenders    |
| one-buyer-s-procurement-profile  | procurement / local     | procurement / contracts  |
| find-a-person                    | institutions / cabinet  | business / assets        |
| clean-delivery-register          | funds / projects        | funds / calls            |
| contractors-in-the-registry      | business / ownership    | data-coverage / coverage |
| both-contracts-and-eu-funds      | funds / projects        | data-coverage / coverage |
| officials-who-hold-company-roles | business / ownership    | data-coverage / coverage |
| name-search                      | business / ownership    | data-coverage / search   |

## Declared dataset inventory

This is the dataset manifest, not a complete catalog of every file in data/. “Direct recipes” means a recipe explicitly names a manifest relation. Zero can also mean function-mediated access, a stale manifest relation name, or JSON-only serving; it is not proof of missing data. Example: election recipes invoke election_national_results, while the manifest names underlying singular result relations.

| Dataset                                                | Declared serving | Direct recipe relation matches                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Води (ВиК) (ds:water)                                  | both             | —                                                                                                                                                                                                                                                                     |
| Национални избори (ds:elections)                       | both             | —                                                                                                                                                                                                                                                                     |
| Местни избори (ds:local)                               | bucket           | —                                                                                                                                                                                                                                                                     |
| Президентски избори (ds:presidential)                  | bucket           | —                                                                                                                                                                                                                                                                     |
| Гласувания и депутати (ds:parliament)                  | both             | voting-twins, party-cohesion, a-day-in-the-chamber                                                                                                                                                                                                                    |
| Граф на връзките (ds:connections)                      | pg               | companies-by-all-public-money, find-a-person, a-person-s-declared-wealth-by-year, politically-connected-companies, contractors-in-the-registry, officials-who-hold-company-roles, personWealth                                                                        |
| Декларации на длъжностни лица (ds:officials)           | both             | a-person-s-declared-wealth-by-year, money-declared-abroad, officials-who-hold-company-roles                                                                                                                                                                           |
| Партийно финансиране (ds:financing)                    | bucket           | —                                                                                                                                                                                                                                                                     |
| Обществени поръчки (ds:procurement)                    | both             | top-contractors, contractors-ranked-and-scoped, top-awarders, where-a-buyer-sits, biggest-tenders, forecast-vs-actual, single-bidder-contracts, contractors-in-the-registry, both-contracts-and-eu-funds, hospitals-that-also-buy, topContractors, procurementAppeals |
| Организации с нестопанска цел (ds:ngo)                 | both             | —                                                                                                                                                                                                                                                                     |
| Еврофондове (ds:funds)                                 | pg               | base-rates-for-a-procedure, clean-delivery-register, both-contracts-and-eu-funds                                                                                                                                                                                      |
| Interreg (трансгранични) (ds:interreg)                 | pg               | interreg-operations, bulgarian-interreg-partners                                                                                                                                                                                                                      |
| Отворени процедури (ds:opencalls)                      | pg               | —                                                                                                                                                                                                                                                                     |
| Земеделски субсидии (ds:agri)                          | pg               | —                                                                                                                                                                                                                                                                     |
| Здравеопазване (НЗОК) (ds:health)                      | both             | what-the-health-fund-pays-each-hospital, hospitals-that-also-buy                                                                                                                                                                                                      |
| Съдебна власт (ds:judiciary)                           | both             | —                                                                                                                                                                                                                                                                     |
| Отбрана (ds:defense)                                   | bucket           | —                                                                                                                                                                                                                                                                     |
| Енергетика (ds:energy)                                 | bucket           | —                                                                                                                                                                                                                                                                     |
| Сигурност / МВР (ds:security)                          | both             | —                                                                                                                                                                                                                                                                     |
| Транспорт (ds:transport)                               | both             | —                                                                                                                                                                                                                                                                     |
| Държавна администрация (ds:administration)             | both             | —                                                                                                                                                                                                                                                                     |
| Социално подпомагане (ds:social)                       | bucket           | —                                                                                                                                                                                                                                                                     |
| Култура (ds:culture)                                   | bucket           | —                                                                                                                                                                                                                                                                     |
| Пенсии (НОИ) (ds:pensions)                             | bucket           | —                                                                                                                                                                                                                                                                     |
| ДОО по фондове (ЗБДОО) (ds:doo_fund_plan)              | bucket           | —                                                                                                                                                                                                                                                                     |
| МОД по дейности и ТЗПБ (ЗБДОО) (ds:zbdoo_annexes)      | bucket           | —                                                                                                                                                                                                                                                                     |
| Фискална рамка 2026 (ds:fy2026_frame)                  | bucket           | —                                                                                                                                                                                                                                                                     |
| Финансови показатели на общините (ds:municipal_fiscal) | pg               | municipal-financial-health                                                                                                                                                                                                                                            |
| Държавен бюджет (ds:budget)                            | both             | —                                                                                                                                                                                                                                                                     |
| Макро и ЕС сравнения (ds:macro)                        | bucket           | —                                                                                                                                                                                                                                                                     |
| Месечни ПЧИ (БНБ) (ds:macro_fdi)                       | bucket           | —                                                                                                                                                                                                                                                                     |
| Регионални индикатори (ds:indicators)                  | both             | —                                                                                                                                                                                                                                                                     |
| Демография и население (ds:demographics)               | bucket           | —                                                                                                                                                                                                                                                                     |
| Местна власт (ds:localgov)                             | both             | —                                                                                                                                                                                                                                                                     |
| Цени на дребно (ds:prices)                             | pg               | —                                                                                                                                                                                                                                                                     |
| Социология (ds:polls)                                  | bucket           | —                                                                                                                                                                                                                                                                     |
| Карти и граници (ds:geo)                               | both             | companies-registered-in-a-place                                                                                                                                                                                                                                       |

## Reproduction and limits

Run `node --import tsx scripts/ai/audit_starter_taxonomy.mjs` from the repository root. It regenerates the JSON inventory from runtime catalogs/registry, TypeScript reader calls, API route definitions, SQL declarations and data_map.json. The Markdown analysis and exact local DB observations are manual, dated evidence and are not regenerated by that command.

The JSON contains every category/leaf with ready/review IDs, every tool with description/examples/starter IDs, all recipe relations and parameters, all 206 routes with their implementation and literal chat readers, all scanned data-reader locations, and 299 CREATE FUNCTION declarations across migration files. The latter are declarations, not distinct installed functions. 159 routes have no literal chat reader; dynamic routes, helper functions and alternate JSON access mean this is a triage list, not 159 proven missing integrations.

Validation performed: imported actual runtime registries successfully; checked unique tool/recipe IDs and valid taxonomy references; verified summary counts from the generated inventory; directly inspected selector readiness filtering, fiscal routes/tools, editorial decisions and release gates; reproduced the COFOG arithmetic against the local source; obtained exact budget table counts. No application runtime changes, new ingestion, production DB probes or deployment were performed in this audit. Production freshness, every-answer correctness and permissions for each proposed recipe remain implementation validation work.
