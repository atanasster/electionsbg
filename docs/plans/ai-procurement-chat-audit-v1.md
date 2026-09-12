# Procurement chat audit

Audit date: 2026-09-12. Status: audit completed; implementation proposed in [the implementation plan](/Users/atanasster/data-bg/docs/plans/ai-procurement-chat-implementation-v1.md). No application changes, migrations or data refreshes were made by this audit.

## Conclusion

The screenshot exposes an end-to-end query-contract gap. The deterministic router selects an all-time overview; that tool has no period, sector or metric parameters; model argument validation silently removes undeclared fields. Fixing keywords alone cannot produce a correct scoped answer. Procurement needs one validated query definition used by routing, tools, SQL, discovery questions, follow-ups, narration and destination links.

The existing data layer supplies much of the foundation: parameterized SQL, calendar/parliament windows, contract risk masks and their availability, a canonical risk catalog, tender data and two KZK corpora. Extend these rather than build a separate chat-only statistical system.

## Scope and evidence

This is an end-to-end audit of the code relevant to procurement questions, including shared chat infrastructure and overlapping fiscal routes. It is not a claim to have reviewed every unrelated election, consumption or ingestion implementation. Repository guidance was read before inspection. Existing changes in chat, prices and `CODE_REVIEW_REPORT.md` were preserved; this separate report avoids overwriting another review.

Inspected surfaces:

| Layer | Main evidence |
|---|---|
| Routing and context | [router.ts](/Users/atanasster/data-bg/ai/orchestrator/router.ts:1352), [heuristicRoute.ts](/Users/atanasster/data-bg/ai/llm/heuristicRoute.ts), [routeScope.ts](/Users/atanasster/data-bg/ai/orchestrator/routeScope.ts), [memory.ts](/Users/atanasster/data-bg/ai/orchestrator/memory.ts) |
| Tool contract and execution | [registry.ts](/Users/atanasster/data-bg/ai/tools/registry.ts:3068), [toolSchema.ts](/Users/atanasster/data-bg/ai/orchestrator/toolSchema.ts:96), [validateArguments.ts](/Users/atanasster/data-bg/ai/orchestrator/validateArguments.ts), [types.ts](/Users/atanasster/data-bg/ai/tools/types.ts), [provider.ts](/Users/atanasster/data-bg/ai/llm/provider.ts) |
| Procurement tools | [fiscal.ts](/Users/atanasster/data-bg/ai/tools/fiscal.ts:690): overview, contractors, company/buyer contracts, risk summaries, benchmarks, roads, tenders, tender lookup and KZK |
| Discovery and continuation | [starterPrompts.json](/Users/atanasster/data-bg/ai/app/starterPrompts.json), [catalog.ts](/Users/atanasster/data-bg/src/lib/questions/catalog.ts), [questionAdapter.ts](/Users/atanasster/data-bg/ai/app/questionAdapter.ts), [followups.ts](/Users/atanasster/data-bg/ai/app/followups.ts), [dispatchPrompt.ts](/Users/atanasster/data-bg/ai/app/dispatchPrompt.ts), [Chat.tsx](/Users/atanasster/data-bg/ai/app/Chat.tsx:470) |
| Backend | [db_table.js](/Users/atanasster/data-bg/functions/db_table.js:157), [db_routes.js](/Users/atanasster/data-bg/functions/db_routes.js:3913), procurement SQL migrations 001, 025, 033, 037, 041, 042, 044, 087, 112, 118, 124 and 130; existing data tests |
| Risk semantics | [riskFlagCatalog.ts](/Users/atanasster/data-bg/src/lib/riskFlagCatalog.ts), [contract risk cache](/Users/atanasster/data-bg/scripts/db/schema/pg/112_contract_risk_cache.sql), [computeTenderRisk.ts](/Users/atanasster/data-bg/src/data/procurement/computeTenderRisk.ts) |
| Sectors and links | [sectorPacks.tsx](/Users/atanasster/data-bg/src/screens/components/procurement/sectorPacks.tsx:284), [healthReferenceData.ts](/Users/atanasster/data-bg/src/lib/healthReferenceData.ts), [cpvSectors.ts](/Users/atanasster/data-bg/src/lib/cpvSectors.ts), [tenderTopics.ts](/Users/atanasster/data-bg/src/lib/tenderTopics.ts), [links.ts](/Users/atanasster/data-bg/ai/render/links.ts:919), contracts/tenders/appeals browser screens |

## Reproduced routing failures

Executed the current `route()` and `resolveFollowOn()` under Node/tsx; these are observed outputs, not inferred expected behavior. No model service was called.

| Prompt | Observed result | Lost or misinterpreted requirement |
|---|---|---|
| какъв процент от обществените поръчки за 2026 са с 1 участник | `procurementTotals {}` | Percentage, 2026, bidder count |
| Какъв процент от обществените поръчки за 2026 са с един участник? | `procurementTotals {}` | Same failure with a written number |
| Покажи договори с един участник от 04/2025 до 01/2026 | `contractSearch {company: <whole question>}` | Range and competition parsed as a company |
| Обществени поръчки в здравеопазването за 2026 с един участник | `procurementBySettlement {place: "обществени поръчки здравеопазването един участник"}` | Sector mistaken for a place; year/intent lost |
| Обществени поръчки CPV 45 през 2026 | `procurementSingleBidSectors {}` | CPV filter becomes methodology; year lost |
| Покажи рисковите обществени поръчки за пътища през 2026 | `procurementRedFlags {}` | Sector/year lost; not a scoped risk search |
| Колко жалби пред КЗК срещу обществени поръчки са уважени през 2026? | `procurementAppeals {}` | Outcome and period lost |
| Решения на КЗК за пътища от 04/2025 до 01/2026 | `null` | No decisions query path |
| Покажи търговете на АПИ през 2026 | `openTenders {query:"АПИ", year:"2026"}` | Buyer is a subject keyword |
| Покажи търгове за мантинели на АПИ през 2026 | `openTenders {topic:"guardrails", year:"2026"}` | Buyer disappears on topic branch |
| Покажи прекратените търгове в здравеопазването за 2026 | `budgetFunction {category:"GF07", year:2026}` | Tender/status intent becomes budget spending |
| Покажи договорите на Софарма трейдинг през 2026 | `contractSearch {company:<whole question>}` | Company extraction and year capture |

After `procurementTotals {}`, each of “А за 2025?”, “А само за здравеопазването?” and “А колко от тях са обжалвани?” returned no follow-on route. `parseToolCall({tool:"procurementTotals", args:{year:2026,metric:"singleBidShare",sector:"health"}})` returned `procurementTotals {}`.

## Prioritized findings

### F1 — P1: Explicit constraints disappear before execution

[Generic procurement routing](/Users/atanasster/data-bg/ai/orchestrator/router.ts:3772) falls through to an unparameterized overview. [Registry definitions](/Users/atanasster/data-bg/ai/tools/registry.ts:3068) give totals no parameters, rankings only a count, appeals only count/awarder, and risk tools no scope. [Argument validation](/Users/atanasster/data-bg/ai/orchestrator/toolSchema.ts:96) uses `ignoreUnknown: true`. [runTool](/Users/atanasster/data-bg/ai/tools/registry.ts:6088) has no procurement constraint-completeness check. Thus a plausible model-selected tool can answer a narrower-looking question with broader data.

Fix: a shared procurement query schema plus an execution gate that accounts for every explicit constraint. Reject or clarify unsupported fields instead of dropping them. Apply the gate to deterministic routes, model routes and direct question intents.

### F2 — P1: Overlapping routes change the question's domain

[Company-contract matching](/Users/atanasster/data-bg/ai/orchestrator/router.ts:3537) accepts “договори с” without distinguishing a bidder condition from a company. [Tender routing](/Users/atanasster/data-bg/ai/orchestrator/router.ts:3559) extracts a year/topic but not all other slots. [Budget classification](/Users/atanasster/data-bg/ai/orchestrator/router.ts:3467) excludes procurement words but not all tender/appeal cues. CPV detection routes to a methodology explanation rather than a CPV-filtered dataset.

Fix: identify procurement corpus/operation first, then extract orthogonal slots. Preserve intentional distinctions from Търговище, търговски фирми, antitrust cases, health budgets and road-spending specialist questions with negative regression cases.

### F3 — P1: Tender filtering loses buyers and substitutes periods

In [openTenders](/Users/atanasster/data-bg/ai/tools/fiscal.ts:2514), `orgTokens` is empty for an organization plus year without keyword/topic; short aliases can also be removed by the length filter. Routing topic+buyer loses the buyer even earlier. [tender_corpus_search](/Users/atanasster/data-bg/scripts/db/schema/pg/044_procurement_ai.sql:43) substitutes the latest available year when the requested year is absent. The tool discloses that substitution in its subtitle, but it still answers a different period. Default non-cancelled tenders are also not necessarily open for submissions.

Fix: resolve buyer identities to stable keys, keep date constraints immutable, return an exact empty/unavailable result, and define “open” using deadline and status availability.

### F4 — P1: Counts, money and percentages need explicit population definitions

[contractSearch](/Users/atanasster/data-bg/ai/tools/fiscal.ts:969) queries all matching tags, separately counts one-bid rows, and has no explicit denominator policy. Filtering uses `date`; rendering prefers `dateSigned`. [Benchmark SQL](/Users/atanasster/data-bg/scripts/db/schema/pg/037_procurement_benchmarks.sql:22) uses a different population: known method, non-no-call, non-null bid count (including recorded zero). [Contract keys](/Users/atanasster/data-bg/scripts/procurement/contract_key.ts:1) include release, supplier and tag; distinct UNP is procedure count, not contract count. [Consortium attribution](/Users/atanasster/data-bg/scripts/db/schema/pg/087_procurement_consortium.sql) adds zero-value member participation rows. The overview's count is not automatically the denominator a user intends.

Fix: named statistical populations, numerator/denominator/unknown counts, separate raw one-bid prevalence from adjusted risk/benchmark metrics, explicit amendment and consortium handling, current versus signing value labels, and verified date basis. Do not rename all stored rows “unique legal contracts.”

### F5 — P1: Chat cannot query all existing risk indicators

[procurementRedFlags](/Users/atanasster/data-bg/ai/tools/fiscal.ts:1124) exposes concentration and active debarments, not arbitrary filters over the 13 contract checks. [Table columns](/Users/atanasster/data-bg/functions/db_table.js:344) project risk masks but do not expose per-flag filtering. Tender checks are computed in TypeScript; award-dependent checks need more than a tender list row. No shared server query evaluates all four across the selected tender corpus.

Fix: a catalog-driven capability matrix, contract mask predicates with availability, and a server tender-risk projection backed by parity tests. Preserve contract, buyer and supplier scoring as separate measures. Do not count neutral disclosures as risks or unavailable checks as passed.

### F6 — P1: KZK aggregate lookup cannot answer scoped complaint or decision questions

[procurementAppeals](/Users/atanasster/data-bg/ai/tools/fiscal.ts:2892) always fetches the all-time summary and searches its top-25 buyer list. It has no general date, outcome, CPV/sector or distinct-procedure query. [Appeals browser resource](/Users/atanasster/data-bg/functions/db_table.js:632) supports complaint dates and selected outcomes, but decision dates are unfilterable text. [The decisions corpus](/Users/atanasster/data-bg/scripts/db/schema/pg/130_kzk_decisions.sql) has acts separate from complaint rows; no general chat decision tool exists.

Fix: separate complaints, acts and appealed procedures; explicit complaint-date versus act-date cohorts; preserve unmatched records and linkage coverage; use canonical effective-outcome/suspension functions. An act, complaint and procedure must never become interchangeable count units.

### F7 — P1: Sector names do not identify one unambiguous dataset

[Current packs](/Users/atanasster/data-bg/src/screens/components/procurement/sectorPacks.tsx:284) define buyer EIK sets. Roads is АПИ; health is МЗ + НЗОК. A hospital's food purchase belongs to the healthcare-buyer scope but not necessarily medical-product CPV; a municipality's road repair belongs to a road-subject scope but not the АПИ buyer pack.

Fix: distinguish buyer-sector membership from purchased-subject classification, extract import-free roster metadata, expose the chosen definition, and clarify materially ambiguous broad sector questions. Do not silently expand audited packs or invent an all-healthcare roster.

### F8 — P1: Destination links can show a different result set

[Tender links](/Users/atanasster/data-bg/ai/render/links.ts:919) preserve topic/keyword/year, not buyer or other filters. [Tender browser](/Users/atanasster/data-bg/src/screens/dev/TendersBrowserDbScreen.tsx:97) applies topic CPVs only, while corpus search matches topic text OR CPVs. [Contracts browser](/Users/atanasster/data-bg/src/screens/dev/ContractsBrowserDbScreen.tsx:92), tender and appeals browsers pass an exclusive scope end into an inclusive table `max` filter, admitting the following boundary day. Appeals outcome selection is local state rather than a full durable query URL.

Fix: shared query serialization and filter semantics for answer, drill-down and browser. Use half-open bounds directly or an explicit inclusive-end adapter. Test actual row identity parity, not just URL text.

### F9 — P2: Discovery and follow-ups do not carry full procurement context

[Follow-ups](/Users/atanasster/data-bg/ai/app/followups.ts) inherit only limited declared parameters; procurement tools rarely declare even year. [Question dispatch](/Users/atanasster/data-bg/ai/app/dispatchPrompt.ts) intentionally bypasses text routing for explicit intents, so fixing the router will not fix all entry points. Memory retains tool arguments and a short fact gist, not a validated resolved procurement query. Generated [tool metadata](/Users/atanasster/data-bg/scripts/ai/toolMetadata.ts) and editorial questions also need coordinated updates.

Fix: persist resolved query state; apply explicit follow-up patches; derive localized prompt text, parameter controls and direct calls from the same question contract. Add starter and follow-up equivalence tests.

### F10 — P2: Missing data, failures and multi-query consistency need stronger contracts

[KZK route](/Users/atanasster/data-bg/functions/db_routes.js:3930) catches every cache error and attempts the expensive live query, although its comment says fallback is only for an absent cache. Tender route may return `null` when its migration is missing, while its tool dereferences the result. A READ ONLY transaction in [withReadOnlyTx](/Users/atanasster/data-bg/scripts/db/lib/pg.ts:354) does not itself request repeatable-read isolation: multiple statements are not guaranteed one snapshot under default READ COMMITTED.

Fix: distinguish empty, partial, unsupported and unavailable results; narrow migration fallback by SQLSTATE; never retry a timed-out cache read with an expensive live aggregate. Compute rows/counts/denominators in one statement or deliberately use a consistent transaction snapshot for the new analytics endpoint.

### F11 — P2: Existing passing tests do not establish scoped-answer correctness

There is substantial existing risk parity, route, question and backend coverage. The focused suites below pass while the explicit routing reproductions fail the desired behavior. Current tests do not cover the full period × corpus × metric × sector × continuation path. Some procurement routing failures are already represented in the non-AI known-failures corpus; adding new cases to that allowlist would conceal regressions.

Fix: adopt the acceptance matrix in the implementation plan, independent small SQL fixtures, provider-path scope-loss tests and real browser/query equivalence. No new capability is considered complete after a tool-name-only assertion.

## Read-only local data observations

Queried local PostgreSQL in READ ONLY transactions, pinned to the repository's local database. These are an audit snapshot, not a production release assertion. Window: `date >= '2026-01-01' AND date < '2027-01-01'`.

| Row tag | Rows | Exactly one bidder | Positive known bidders | Recorded zero bidders | Null bidders |
|---|---:|---:|---:|---:|---:|
| contract | 26,779 | 12,656 | 26,330 | 446 | 3 |
| contractAmendment | 3,488 | 1,071 | 2,941 | 14 | 533 |

Contract-tagged rows span 2026-01-03 through 2026-09-10; amendments span 2026-01-04 through 2026-06-03. Max observed record date is not proof that the source is complete through that date.

| Contract-tagged role | Rows | Exactly one bidder | Positive known bidders |
|---|---:|---:|---:|
| ordinary | 24,475 | 11,996 | 24,044 |
| carrier | 614 | 181 | 608 |
| member | 1,690 | 479 | 1,678 |

No 2026 contract-tagged row had both contract tender-period date columns non-null. Thus a request for that contract check currently needs an unavailable-data answer. The separate tender deadline checks may have data; these observations do not measure them.

Using all contract-tagged rows gives 47.26% one-bid/all rows versus 48.07% one-bid/positive-known rows. Both include member participation rows, and neither equals the benchmark's competitive-method population. These illustrate the modeling problem; neither is presented as the final corrected answer to the screenshot.

## Verification performed

- Focused Vitest run: **9 files, 1,523 tests passed** — router integrity/context, argument validation, starters, follow-ups, question adapter, risk catalog, contract masks and CPV sectors.
- `node --test functions/db_routes.procurement.test.js`: **13 tests passed**, no failures or skips.
- Executed 12 direct route probes, three follow-on probes and the extra-argument parsing probe reported above.
- Two successful local READ ONLY aggregate queries after obtaining sandbox access to the local database. No production queries or writes.

No full application build, live model evaluation, browser interaction, production performance measurement or new implementation tests were run. Those are implementation acceptance work, not audit accomplishments. Existing risk thresholds were audited as repository product semantics; this report does not independently validate them as legal tests.

## Second-pass plan audit — gaps folded in

Reviewed the implementation plan against the current schema, question metadata generator, deployed functions package, result envelope/grounding and KZK classification/provenance code. The following were gaps in the proposed plan, not newly reproduced production failures. All are now addressed in the implementation steps and acceptance specification rather than left as optional follow-up work.

| Gap | Correction incorporated | Acceptance coverage |
|---|---|---|
| The query sketch named undefined types and omitted fields required by its own prompts. | Closed per-corpus schemas, complete capability table, explicit amount/minimum-sample/bid/risk comparisons and wire representation. | G01, G06–G07 |
| One period could not represent contracts in one year with complaints in another; a parent reference had no persistence contract. | Primary plus related date scopes; portable, bounded one-hop parent query with explicit relation semantics. | G02–G04 |
| Multiple questions, corrections and mixed predicates could still lose intent. | Bounded two-query orchestration, explicit correction semantics, Boolean grouping limits and source-text isolation. | G05–G12 |
| Per-flag availability did not define composite AND/OR/NOT availability. | Three-valued logic and a complete independent mask truth table. | G08 |
| A shared TypeScript source outside `functions/` would not automatically ship in the CommonJS deployment. | Generated self-contained validator/catalog artifact, schema hash/freshness check and clean package import gate. | G13–G14 |
| Many starters sharing one tool could inherit the first tool category or wrong sources/parameters. | Question-specific defaults, parameter subsets, category/source metadata; separate chat/SQL readiness and localized wording. | G15–G17 |
| “Open now” lacked deadline precision and clock-driven cache invalidation. | Verified timestamps, date-only uncertainty, exact-instant/DST tests, deadline-aware expiry and a concrete rolling-period rule. | G18–G21 |
| Missing dates, monetary precision, comparisons and ranking minimums were underspecified. | Unassignable-date/partition coverage; unknown-versus-zero sums; currency/value/precision semantics; exact-fraction ranking and percentage-point versus relative changes. | G22–G28 |
| Sector and risk filters could imply historical membership, work location or recalculated in-window baselines. | Explicit roster/CPV/geographic and risk-baseline scope/version, with unknown coverage distinguished. | G29–G30 |
| KZK “upheld” could be misread as full complaint success; new projections could endanger protected classifications. | Preserve coarse partial/mixed-act risk semantics, distinguish evidence basis, protect manual/date-only rows and prohibit persisting status-derived outcomes. | G31–G33 |
| Asynchronous responses and restored history could attach a valid query to the wrong conversation state. | Request/message-bound clarification, stale-result guards and version-aware history re-resolution. | G34–G35 |
| A link could preserve filters but change the count population, or promise an old count after ingestion. | Versioned analytics population in browser links, mutable-query versus immutable-answer distinction, revision-bound pagination and explicit export/reference behavior. | G36–G38 |
| Deployment readiness and partial refresh behavior were not concrete enough. | Per-corpus capability negotiation, compatible expand-and-contract release, actual read-only-role checks, atomic revision publication and bounded request/load tests. | G39–G40 |

The KZK fixture previously combined refused proceedings and effective suspension on c3. It now keeps c3 refused/unsuspended and derives suspension on a separate pending-merits complaint. Complaint-specific outcomes in the shared-act fixture are explicitly reviewed fixture evidence, not an assumed result of the current coarse act classifier.

The revised test specification contains **160 named acceptance scenarios**, **30 general starter candidates**, **17 bilingual risk templates** and **25 follow-up patterns**. These remain proposed implementation tests. This plan-review pass validates document links, scenario identity/counts and independent fixture arithmetic/truth tables; it does not rerun or claim new application test results.
