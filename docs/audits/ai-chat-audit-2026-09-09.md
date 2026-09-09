# AI chat: coverage audit and starter taxonomy

Date: 9 September 2026. Scope: the standalone `ai/` app, tool registry, rule router, local JSON, local PostgreSQL route handlers, main-app data readers, and source manifest. This is an implementation audit with local execution evidence. It does not certify production freshness, measure LLM routing accuracy, or establish how frequently citizens ask each question.

## Findings and delivered changes

The chat already has substantial coverage: **217 tools**, **388 bilingual registry examples**, and vectors for every registered tool. The principal gaps are narrower than “new sources never added”: some new datasets have no answer surface; other sources are present only in summaries; and some implemented tools are unreachable or incorrectly parameterized through advertised questions.

The deterministic router selects the wrong tool or no tool for **200 of 776 language-specific registry examples**: **76 Bulgarian**, **124 English**, including **71 unrouted examples**. These are example-contract failures, not an estimate of error rates on real users or LLM providers. Forty tools have no single example pair that both routes correctly and supplies required parameters. The remaining 177 candidate pairs were executed against local data in both languages: **354 executions, no thrown exceptions**. Some nevertheless returned empty results, unresolved entities, or a different scope.

This change expands the runtime starter bank from **60 to 150 bilingual prompts**, with stable IDs, category paths, expected tools, and language-specific arguments. It adds an **18-category / 64-subcategory taxonomy**, a separate **257-question Bulgarian editorial bank**, and a test of each active prompt's exact tool and arguments in both languages. Twenty-seven probed candidates are withheld for concrete output, wording, or coverage reasons. The test does not substitute for data freshness or semantic validation.

The existing chips consume the expanded bank immediately. The category picker is specified below, with its data ready; its UI is **not implemented in this change**. Integration fixes in this report are a prioritized follow-up backlog, not claims of completed repairs.

### Review artifacts

- [Implementation plan: shared chat and SQL question selector](../plans/ai-chat-and-db-starters-v1.md).
- [Wiring snapshot](ai-chat-wiring.json): all 217 tools, all examples and routes, source manifest entries, literal/dynamic data reads, API review candidates.
- [Local execution snapshot](ai-chat-starter-execution.json): bilingual candidate results, parameters, output titles, provenance, and all 27 withholding reasons.
- [Tool → category mapping](ai-chat-tool-topics.json): every registered tool mapped to a civic topic, including tools not promoted to starters.
- [Bulgarian question collection](bulgarian-civic-questions.md), also [structured JSON](bulgarian-civic-questions.json).
- Runtime: [starters module](../../ai/app/starters.ts), [150 prompts](../../ai/app/starterPrompts.json), [taxonomy](../../ai/app/starterCategories.json), [intent tests](../../ai/app/starters.test.ts).

## 1. Confirmed drift and failure cases

| Priority | Finding and evidence | Required correction |
|---|---|---|
| P1 | **Presidential questions can return parliamentary results.** `presidentialResults` exists in `ai/tools/registry.ts`, but its example routes fail the intended-tool contract. The rule router has no dedicated presidential branch. An elections category alone will not fix it. | Route election type before generic election rules; retain year, round, place and candidate. Make starter clicks carry the declared tool intent. Test first round, runoff and geography. |
| P1 | **Entity text reaches the correct tool without being resolved.** Local `contractSearch` English passes the whole sentence as contractor; `ministryBudget` English fails to match a ministry; `personProfile`, `personConnections`, `personWealth` cannot resolve the short-name Boyko Borisov example. `institutionMaintenance` English returns a national ranking instead of defence history. | Separate entity extraction from lookup; resolve aliases and two-part names to IDs, preserve ambiguity, and validate the chosen entity in the returned envelope. Do not use a generic fallback as if it answered the requested entity. |
| P1 | **Election districts are called oblasts.** `regionWinners` returns 32 rows and facts such as “31 области”; `rankPlaces` can rank 31 domestic MIR units as oblasts. `regionBreakdown` has the same terminology exposure. There are 28 administrative oblasts; Sofia has three MIR and Plovdiv two, plus the separate abroad district. See `ai/tools/national.ts`, `ai/tools/indicators.ts` and execution snapshot. | Use the administrative concordance for oblast results, or explicitly label and offer MIR results. Exclude abroad from domestic administrative comparisons. Reconcile denominators before comparing with census, GDP or unemployment. |
| P1 | **Air-quality absence can become a clean-air claim.** In `ai/tools/placeData.ts`, missing PM10 is replaced by zero before `Math.max`; the tool can say “в нормата”. It silently falls back from municipality stations to oblast stations, retains the town title, and does not carry averaging period/date into the comparison. | Preserve missing values, identify station location and observation period, and only compare compatible measures and thresholds. “No measurement” must remain unknown. Separate historical/quarterly readings from today's air. |
| P1 | **Budget facts omit a balancing component.** `budgetOverview` gives 2025 revenue €26.3bn, expenditure €28.4bn and balance −€3.1bn. The source calculation also subtracts the outgoing EU contribution, but narration facts omit it; the table says “Принос от ЕС”. See `ai/tools/fiscal.ts:118`. | Expose the full reconciliation and label the contribution **to** the EU budget. Keep state-budget execution, consolidated fiscal programme and general-government COFOG distinct. |
| P1 | **A whole year silently becomes one election.** The example “Сравни 2022 и 2024” resolves to October 2024 and omits June. The model few-shot in `ai/orchestrator/prompts.ts` also pins an exact October date, defeating the later year-expansion logic. | Ask which election or compare both elections in that year; use explicit dated starters until fixed. Add tests of returned periods, not merely the tool name. |
| P2 | **Session caches have no freshness policy.** `ai/tools/dataClient.ts` caches successful JSON and API promises for the browser session. `clearDataCache` exists, but no active chat invalidation was found. An open call can remain visible after expiry, or a refreshed data source remain stale until reload. | Introduce TTL/version invalidation by data family. Revalidate deadline-sensitive calls at use time and show source observation time separately from retrieval time. |
| P2 | **Historical context is inconsistently applied.** Several parliament tools load the current `parliament/votes/index.json` and use its `ns` rather than the selected election. Some tools intentionally use a historical fallback (e.g. MP similarity), but that must be explicit. | Carry an assembly ID independently of an election date, bind every roll-call query to it, and label fallback periods. Test a historical selection against current data. |
| P2 | **A source can be present while the question's measure is absent.** `socialSpending` answers a broad assistance-spending question with procurement of the ministry group; the benefits are separate. `basketAffordability` uses GDP per capita as an income proxy. Asset “richest” examples cover declared assets, not total wealth. | Scope questions and titles to the measured quantity; include numerator, denominator, currency, money basis, time and coverage in facts passed to narration. |
| P2 | **Search language and data language diverge.** English `voteSearch` returns no vote matching an English sentence in Bulgarian titles. Tool-name equality misses this failure. | Normalize query entities/topics in both languages; test the returned subject, not just existence of an envelope. |
| P2 | **Discovery copy and tests lag capability.** `EmptyHero.tsx` still advertises “2005–2024”; `suggestions.ts` has a separate static prompt/party vocabulary. The older starter regression only rejects a null route and accepts a completely wrong tool. | Generate dates/party labels from canonical data; unify hero, autocomplete and category starter sources. Keep intent/argument contracts and a separate execution/coverage gate. |
| P2 | **Tool-call schema is permissive.** `ai/orchestrator/toolSchema.ts` coerces a limited numeric-name set and does not enforce all registry-required arguments before execution. Vector freshness tests check names/dimensions, not changes to tool semantics. | Validate arguments against declared schema; hash descriptions/examples/schema with vectors, and rebuild or fail when content changes. No vectors are currently missing by tool name. |
| P2 | **AI build packaging copies unrelated corpora.** `vite.config.ai.ts` copies the main `public/`, whose `procurement`, `myarea` and `home` entries are data symlinks, then prunes output. Validation hit `ENOTEMPTY` clearing `dist-ai/procurement`; a separate-output retry copied over 2 GB and was stopped. Prune/SEO plugins also hardcode `dist-ai`, ignoring a supplied output directory. | Copy an allowlist of required static assets and use Vite's resolved output directory in plugins. Validate packaging separately from application compilation. |

Neighbourhood ethnicity, statistical risk and inferred vote-flow questions need exact population and method wording: aggregates do not identify how individuals voted, anomalies do not establish offences, and estimated flows are not observed movements. These are starter/narration scope issues even when underlying tools execute correctly.

## 2. Added data not fully exposed through chat

An API route without a direct caller is a **review candidate**, not proof of a missing source. The audit finds 206 API routes and 45 distinct literal route names in chat readers; generic `table`, `payload`, `company`, group-model and helper readers can expose many underlying datasets. The 161-route difference must not be reported as “161 broken integrations”. The families below also compare tool intent and the fields reaching answer envelopes.

| Family | Existing repository/main-app evidence | Chat gap and proposed answer surface |
|---|---|---|
| Municipal fiscal health | `municipal-fiscal`, `municipal-fiscal-national`, `municipal-fiscal-ranking`, `municipal-fiscal-years` | Transfers and local tax rates exist, but debt, arrears, own revenues, fiscal-health comparison and series lack dedicated tools. Add `municipalFiscalProfile`, `municipalFiscalRank`, `municipalFiscalTrend`. |
| New budget explorer | `budget-variance`, `budget-personnel`, `budget-ministry`, `budget-municipality`, `budget-municipal-capital`, `budget-law` | Legacy JSON tools expose selected totals, ministries and transfers. They do not expose the full newer plan/execution, personnel, programme and municipality drilldowns. Add parameterized budget breakdown/variance tools with basis metadata. |
| Detailed declarations | `declaration-detail`, `person-declarations`, `person-breakdowns`, `person-declaration-events`, `person-abroad-overview`, `person-accumulation-gap`, `person-cohort-benchmark`, `person-declared-stake-status`, `person-stake-procurement` | Three person tools and MP/official rankings cover a subset. No dedicated bank-country/crypto/declaration-line/event/cohort/accumulation/stake-status exploration. Add explicit declaration queries with year, ownership/use, declared value basis and provenance. |
| Mayor pay and municipal officials | `mayor-pay`, `mayor-pay-ranking`, municipal official indexes | No mayor-pay or detailed municipal-declarant discovery tool. Keep declared income distinct from official salary scales. |
| Financial inspections | AДФИ loader, `src:adfi`, company inspection data | No dedicated inspection query or inspection facts in the chat company envelope. Add entity/year findings with source document, scope and outcome. Findings must not be inferred from generic procurement risk. |
| European tender notices | TED loader and `src:ted` | No dedicated TED/cross-publication coverage or notice-history query. `openTenders` covers the domestic tender surface, not all TED semantics. |
| Builder register | ЦПРС loader and `src:cprs` | No construction-registration, category or valid-at-date tool, even where a composite company payload contains these fields. |
| External procurement experts | АОП experts loader and `src:aop_experts` | No searchable expert qualification/status tool. |
| Contract execution detail | `contract-annexes`, `contract-risk-detail`, subcontractor loader, `tender-dossier`, `tender-document` | Contract search and curated project summaries do not provide the full annex/value-change, consortium/subcontractor and document trail. Add contract detail with deduped base + annex values and dated execution evidence. |
| Procurement benchmarks | `procurement-concentration`, `procurement-award-criteria`, `procurement-benchmarks`, `national-competition`, `tender-normalcy` | Some single-bid/normalcy tools exist; not all main-app dimensions and per-contract baselines are available. Extend existing tools instead of creating a duplicate totals pipeline. |
| ISUN completion/fit | `src:isun_clean_delivery`, `funds-fit`, `funds-procedure-rates` | Beneficiary/project totals exist. No explicit completion-without-correction filter, procedure aid-rate comparison or similarity/fit query. “No correction in this register” does not prove absence of problems. |
| Interreg detail | `interregArm.ts`, `interreg-operation`, `interreg-programme`, `interreg-company` | **Already included** through the Interreg helper in funds/place summaries. Missing programme/operation/partner drilldowns and explicit partial-coverage reporting on soft failure; do not count the whole source as absent. |
| Hospital detail | `nzok-hospital-by-eik`, `nzok-hospital-trends`, `nzok-hospital-risk`, `nzok-hospital-momentum-by-eik`, financials/coverage routes | Hospital totals, scorecards and activity tools exist, but not the full hospital history, financial-measure/coverage and geographic discovery surfaces. |
| Drug pack and time detail | `nzok-drug-pack`, `nzok-drug-pack-trend`, `nzok-drug-quarterly`, `nzok-drug-unit-prices` | INN/molecule/growth/savings tools cover part of this. Add comparable pack/unit/quarter detail; avoid comparing different packs or implying clinical substitutability from price. |
| Water rationing and geography | `data/water/water_stats.json`, `src/data/water/useWaterStats.ts`, `water-operator-map` | Procurement/river-cleaning coverage exists; the NSI rationing series and operator geography have no dedicated tool. Tariffs, network-loss metrics and live rationing by settlement require a separate ingestion/coverage check; not all are proven available. |
| Education context | `data/education/school_context.json`, `data/education/textbook_market.json`, school detail/main-app education surfaces | `schoolMatura` already includes cohort, percentile and SES context from the directory payload. Remaining gaps include fuller prior-attainment/history exploration, textbook-market and school procurement detail. Extend that profile; a matura score alone is not overall school quality. |
| Service directory | `data/services/index.json`, `src/data/services/useServices.tsx` | Administration-size/e-government summaries exist, but service lookup, responsible authority and application links are not surfaced. Exact fees, eligibility and deadlines need current official documents. |
| Detailed council/magistrate records | `council-resolution`, `council-councillor`, `magistrate-filing-assets`, `magistrate-politician-links`, `court` | Council resolution lists and judiciary totals exist; named councillor votes, individual resolution detail and magistrate declaration/relationship drilldowns are incomplete. Preserve municipality/court coverage, absent votes and filing type. |
| Transport/security place detail | `transport-project-map`, `transport-facility-map`, `mvr-directorate-map` | National/group statistics exist, but mapped facility/project/directorate discovery is not generally queryable. Project/authority address must not stand in for the actual beneficiary or works location. |
| News and civic fact-check context | `news/` corpus and separate `newsapp/` | No news retrieval/citation tools in this chat registry. A cross-source claim-check workflow would need article retrieval, dates, authoritative statistic lookup and explicit separation of reporting from measured fact. |

### Sources represented in the manifest

This is the full 47-entry source-node inventory from `data/data_map.json`, grouped only by the existing manifest's identity. “Present” means an answer path exists, not that every field or year has been certified. Several nodes contain multiple publishers; the manifest itself can lag ingestion (for example, the water description still calls rationing statistics planned).

| Source ID | Source | Chat coverage assessment |
|---|---|---|
| water | ВиК sector | Partial: procurement and river cleaning; missing rationing tool and operator map. |
| cik | ЦИК | Extensive parliamentary/local coverage; presidential routing gap, district/oblast scope drift. |
| parliament | Народно събрание | Roll-call/MP tools present; current/historical assembly and detail gaps. |
| dv | Държавен вестник | Budget law-derived transfers/projects present; no general law search. |
| sp | Сметна палата | Finance and asset summaries present; declaration detail incomplete. |
| ofac | OFAC | Flags included in unified person profile; not an independent sanctions search. |
| comdos | Комисия по досиетата | Person-profile flags included; no document-level exploration. |
| regulators | Independent/regulatory bodies | Person roles/profile fields present; no broad regulator decision search. |
| egov | data.egov.bg | Multiple procurement, budget and registry readers; coverage varies by dataset. |
| eop | ЦАИС ЕОП | Tenders/contracts present; documents, annexes and counterparties incomplete. |
| aop | Debarred suppliers | Dedicated debarment tool present. |
| kzk | КЗК | Appeals summary present; not full case/outcome/document drilldown. |
| isun | ИСУН | Beneficiaries/projects present; fit, rate and completion detail incomplete. |
| opencalls | Open procedures | Tool present; zero rows in this local probe, expiry-sensitive cache. |
| keep_eu | keep.eu / INTERACT | Included through Interreg helper; operation/programme detail missing. |
| dfz | ДФ „Земеделие“ | Rankings/schemes/entity tools present; placeholder entity example broken. |
| ec_fts | EC Financial Transparency System | Aggregate foreign funding in NGO/funding paths; no general FTS project explorer. |
| ministries | Ministries/agencies | Budget and sector tools present; newer budget explorer not fully exposed. |
| municipalities | Municipalities | Council/place/transfer tools present; fiscal health and official detail missing. |
| nsi | НСИ | Census/macro/regional/sector series present; water and school-context omissions. |
| az | Employment Agency | Registered unemployment tools present. |
| grao | ГРАО | Place demographic context present; registered population must stay distinct from census. |
| eurostat | Eurostat / EC | Broad macro/peer/sector tools present; not arbitrary access to all Eurostat series. |
| eu_policy_anchors | EU/NATO/IMF policy anchors | Selected tool explanations/targets; no independent policy document query. |
| bg_fiscal_anchors | Bulgarian fiscal anchors | Simulator/budget assumptions; not a live legal guidance source. |
| intl | International indices | Macro/category/peer paths; coverage depends on registered indicators. |
| bnb | БНБ | Macro/debt/FDI paths present. |
| kzp | КЗП retail prices | Broad price tools present; affordability proxy and freshness need attention. |
| oil_bulletin | EC fuel prices | Dedicated fuel comparison present. |
| tibg | Transparency International Bulgaria | Place transparency context; limited municipality/year coverage applies. |
| vss | ВСС / judiciary statistics | Caseload/workload/filing summaries; court and magistrate detail incomplete. |
| defense | NATO / Bulgarian defence sources | Spending, equipment/programme, peers and export tools present. |
| energy | Ember / Eurostat / GEM | Generation, prices, plants present. |
| security | Eurostat / МВР / road safety | National crime/road-safety tools present; detailed place maps incomplete. |
| transport | Eurostat / rail | Rail/subsidy/sector/funds tools present; project/facility detail incomplete. |
| administration | ИИСДА / Eurostat | Administration/digital adoption present; service directory missing. |
| social | АСП / МТСП / Eurostat | Benefits/poverty/procurement tools present; generic spending question mixes scope. |
| adfi | АДФИ | No dedicated inspection answer surface. |
| ted | TED | No dedicated European notice/coverage answer surface. |
| cprs | ЦПРС | No dedicated builder-register answer surface. |
| aop_experts | АОП experts | No dedicated expert-register answer surface. |
| isun_clean_delivery | ISUN no-correction completion list | No dedicated completion-status answer surface. |
| culture | НФЦ / НФК / МК | Film, grants, commissions, municipal/community-centre tools present. |
| ipi | ИПИ | Local tax rates and regional context present. |
| pollsters | Polling agencies | Polls, profiles and accuracy tools present; check latest poll dates separately. |
| wiki | Wikipedia | Historical cabinets/polling inputs; not live encyclopaedic retrieval. |
| geo | Geography/boundaries | Place resolution/navigation context; administrative/MIR conflation remains. |

No literal static reader examined points to a bucket-excluded or locally absent file, and no literal API call names an unknown route. This does **not** prove hosted availability or dynamic path coverage. Parliament's remaining summary JSON is a parallel derivation to newer PG routes, not automatically a retired/blocked path. Migrate with numeric parity checks rather than declaring every JSON reader broken.

## 3. Starter hierarchy and interaction

Use civic categories independent of the registry's six technical `Domain` values. A category is navigation; a tool can support several questions. The primary tool-topic mapping is exhaustive for today's 217 tools, while question records can reference several related tools. Related tools are discovery metadata, not a claim that the question is answerable.

1. Empty chat shows topic choices and a small curated set of cross-topic questions. Prefer prices, my area, health, elections, public money and funding near the top; allow search across all topics.
2. Choosing **Избори** opens its six subcategories. Choosing **Парламентарни избори** shows 4–6 varied prompts, with “Още въпроси”, a back control and a breadcrumb.
3. A starter click uses its explicit tool and arguments through the existing `runChoice`/clarification pathway. Free typing continues through the router. The category itself never silently changes a question's election type or period.
4. Where a question needs “моята община”, ask/select the place; do not silently reuse a different locality. Use explicit date/round selectors for ambiguous years. Keep the selected geographic level visible.
5. Expose only validated active prompts in the answerable list. A zero-active leaf can remain an editorial planning entry, but the released UI should hide it or explain the missing capability with a relevant data-page link. Do not offer an apparent executable chip for a future integration.
6. Prefer topic diversity over uniform random sampling of all prompts; there are more procurement/fiscal tools than some civic topics. Avoid showing multiple variations of the same tool together. On mobile use an accessible list or compact grid, not 64 simultaneous chips.

The complete taxonomy and per-subcategory questions are in [the Bulgarian collection](bulgarian-civic-questions.md); stable IDs and English labels are in the runtime JSON. Top-level groups are:

| Category | Subcategories |
|---|---|
| Избори | Парламентарни; Президентски; Местни; Вотът по места; Изборен риск; Социология и поведение |
| Парламент и управление | Депутати и гласувания; Правителства и длъжности; Общински съвети; Администрация и услуги |
| Бюджет и данъци | Приходи и разходи; Министерства и програми; Общински финанси; Дълг и дефицит; Данъчни сценарии |
| Обществени поръчки | Търгове; Договори и изпълнители; Конкуренция и риск; Жалби и контрол; Строежи и досиета; Поръчки по места |
| Фирми, интереси и имущество | Собственици и връзки; Декларации; Партийно финансиране; НПО и читалища |
| Еврофондове и земеделие | Кандидатстване и срокове; Финансирани проекти; Регионално развитие и Interreg; Земеделски субсидии |
| Цени и семейни разходи | Храни и пазаруване; Инфлация и евро; Горива |
| Икономика и работа | Икономика и ЕС; Заплати и заетост; Инвестиции и бизнес среда |
| Здравеопазване | Финансиране; Болници и дейности; Лекарства и цени; Достъп и права на пациента |
| Пенсии и социална подкрепа | Държавни пенсии; Допълнително осигуряване; Помощи и бедност |
| Образование | Училища и изпити; Детски градини и достъп; Университети и наука |
| Население и моето място | Население; Моето място; Регионални различия |
| Правосъдие и сигурност | Съдилища; Престъпност; Отбрана |
| Енергетика | Цени и сметки; Производство и преход |
| Вода и околна среда | Вода и ВиК; Реки и наводнения; Въздух; Отпадъци и земя |
| Транспорт и жилища | Железници; Пътища и безопасност; Жилища и строителство |
| Култура и туризъм | Култура; Туризъм |
| Медии и общество | Обществено доверие; Медии и проверка на твърдения |

### How the question collection should be used

The 257 Bulgarian questions are original editorial formulations informed by the repository's civic coverage and public-priority research. Price concerns are supported by [Alpha Research's May 2026 survey](https://alpharesearch.bg/post/1051-merkite-na-pravitelstvoto-za-ovladiavane-na-cenite-podkrepiani-no-vse-oshte-neiasni.html); health, education, pensions and fiscal choices are reflected in [its Budget 2025 survey](https://alpharesearch.bg/post/1032-zdraveopazvaneto-absoliuten-prioritet-na-bulgarskite-grajdani-v-biudjet-2025-spored-65-durjavata-triabva-da-harchi-tolkova-kolkoto-ima-a-ne-da-zadlujniava.html). Broader security/economic concerns are also covered by [European Parliament Eurobarometer research](https://www.europarl.europa.eu/news/bg/press-room/20250317IPR27385/eurobarometer-obcania-od-eu-ziadaju-ochranu-a-jednotu). EU-wide rankings are not presented as Bulgarian rankings.

This is a broad collection, not a literal “all commonly used questions” dataset. There are no user-query logs or search-volume evidence here. Keep every editorial record in `editorial-review` until its exact scope, tool arguments and output have been checked; do not promote a whole category because one neighboring tool works. Future opt-in query analytics can identify real demand, repeated failures, unresolved places and useful paraphrases without treating synthetic prompts as observed users.

New-source work and prompt work should be connected through a capability contract: tool ID, supported measures, entity/period/geography constraints, source IDs, freshness policy, money basis, evidence links, empty-data behavior, and bilingual examples. Publish only the examples passing that contract.

## 4. Recommended implementation order

1. **Correct answers and routing:** presidential intent, entity extraction/IDs, district/oblast separation, historical assembly, budget reconciliation and air missingness. Reuse failing examples from the wiring snapshot as regression cases. Update hero/autocomplete through the unified bank.
2. **High-value existing-data integrations:** municipal fiscal health, budget variance/personnel, detailed declarations, water rationing, services and individual contract/inspection detail. These connect existing data to frequent civic needs without first inventing new ingestion pipelines.
3. **Category picker:** use the supplied JSON, stable IDs, explicit intent dispatch, place/date selection and active-only leaves. Track success by answered scope and evidence, not by non-null response or chip click.
4. **Deeper coverage:** contract annexes/subcontractors, TED/ЦПРС/experts, ISUN completion/fit, Interreg details, hospital/drug detail, education context and council/magistrate drilldowns.
5. **Questions needing additional sources:** waiting times, individual eligibility, kindergarten places, current water tariffs/outages, train punctuality, building permits and current media claims. First check authoritative source availability, date/geography and rights to reuse; do not imply the current statistical corpus answers these.

For each source migration, compare chat facts with the main-app source for the same filters and date, including nulls, money basis, totals and cohort coverage. Check production source/load versions separately from this local audit. A correct entity and tool can still return a stale or incomplete answer.

## Reproduction and limits

```sh
node --import tsx scripts/ai/audit_chat.ts
node --import tsx scripts/ai/probe_starters.ts
npx vitest run ai/app/starters.test.ts
npm run typecheck:ai
npm run build:ai
```

The audit script uses static TypeScript calls and actual rule routing. The probe script reads local JSON and executes the existing DB route handlers against local PostgreSQL; it writes `/tmp/chat-starter-probes.json`. It does not call an LLM. The checked-in execution snapshot also includes the editorial selection and withholding reasons, so rerunning the raw probe does not automatically promote prompts. Data can change between runs, especially open calls and entity registers.

All 354 executions completed without thrown exceptions; candidate output failures remain visible in the snapshot. Local reachability is not evidence of production reachability. An absence of literal reads cannot rule out indirect access, and this audit has not evaluated every possible argument combination, every row, hosted dataset version, or provider-generated answer. The full source and example inventories make those remaining checks reproducible rather than hiding them behind a coverage percentage.

### Validation of this change

- Starter contract suite: **303 tests passed** (150 prompts × two languages, plus identity/taxonomy checks).
- AI TypeScript compilation: passed as the first stage of `build:ai`.
- Targeted ESLint: passed for the starter module/test and both audit scripts.
- Editorial inventory: 257 unique questions, all 64 leaves represented, all 217 tool-topic mappings valid.
- Application production bundle: passed with public copying disabled. Vite emitted its chunk-size warning and an expected unresolved `/fonts/fonts.css` warning because public assets were deliberately excluded from this compilation check.
- Standard production packaging: **not passed**. The default build failed clearing `dist-ai/procurement`; the isolated-output retry was stopped during multi-gigabyte public-data copying. This packaging issue is recorded above. Nothing was deployed.

Bundle-only reproduction (does not validate the deploy's static-asset package):

```sh
node --input-type=module -e 'import { build } from "vite"; await build({ configFile: "vite.config.ai.ts", publicDir: false, build: { outDir: "/tmp/data-bg-ai-chat-bundle-check-20260909", emptyOutDir: true, copyPublicDir: false } });'
```
