# AI question and follow-up audit — 2026-09-10

## Verdict

The three reported problems are confirmed. The previous budget fix changed canonical text and routing but missed the empty-chat hero binding and the global follow-up fallback. This is a discovery and intent-contract problem across topics, not a COFOG data freshness issue alone.

This audit does not modify or deploy application code. Findings below are outstanding.

## Scope and evidence

- Inspected all five empty-chat hero bindings, question catalog projection, starter selection, autocomplete, all follow-up branches, their dispatch in Chat, and routing/provider execution.
- 227 registered tools; 282 catalog starters in Bulgarian and English (564 exact routing contracts).
- 178 bilingual autocomplete entries (356 texts).
- 73 tools have dedicated follow-up cases; 154 have none.
- Fresh local No AI provider execution: 558 of 564 catalog prompts produced envelopes; six encountered missing local database relations.
- Fresh follow-up execution with previous tool and args: 1,102 prompts from successful parent envelopes; 1,101 produced envelopes, one did not route. An envelope is not evidence of a correct answer: several contain the wrong subject, scope or an entity-not-found result.
- 11 paired follow-up tool mismatches persisted with previous-answer context. 18 autocomplete pairs route to different tools.
- Tested removing parenthesized qualifiers from all applicable starters: 19 language-specific tool mismatches. Some removed qualifiers identify a genuinely different measure; these are robustness-review candidates, not 19 automatically confirmed defects.
- Initial inventory also evaluated 1,112 follow-ups using the committed provider fixtures, allowing coverage assessment even for the six locally unavailable parent prompts.
- Machine-readable inventory and execution evidence: `ai-question-followup-audit-2026-09-10.json` beside this report.

Limits: local data and local DB handlers, no paid Gemini calls and no complete production database availability audit. Exact prompt routing was checked for every entry. Semantic failures were identified by comparing question meaning, tool/args and actual result titles; success counts do not claim every returned fact is correct. Alternate entity and year combinations remain a test expansion requirement.

## Findings

### F01 — P1: Empty-chat Budget card still launches COFOG

`ai/app/hero/EmptyHero.tsx:98-104` labels the card Budget and Ministry of Finance, but both accessible label and click use `budgetByFunction`. The separate autocomplete edit cannot change this binding. This explains the user's first screenshot even on the new deployment.

Fix: bind the generic card to `budgetOverview`, retain a separately named COFOG option, and make its preview/source match the resulting answer. Add a rendered hero click test, not just a route test. Audit all five hero cards against their intended question IDs.

### F02 — P1: Functional spending depends on the COFOG acronym

`ai/orchestrator/router.ts:3210` only enters the functional budget branch if the text contains бюджет, budget or COFOG. The user's natural wording has none of these. Its eventual macro match at line 4265 loses “по функции”.

- BG `Разходи на държавното управление по функции?` → `macroIndicator`, government spending time series.
- EN `Government spending by function?` → `governments`, cabinets.

Fix: recognize the functional-breakdown intent before broad macro/cabinet matching, with and without the acronym, preserving requested years. Expected answer shape is categories/functions with amounts and shares, not a time trend. The chart itself is not inherently wrong; the selected subject and grouping are wrong.

### F03 — P1: Global election fallback affects most non-election tools

`ai/app/followups.ts:755-767` sends every unmatched tool to election results and turnout. 154/227 tools lack a dedicated branch; 139 are outside the elections domain. Missing branches include `budgetByFunction`, `budgetFunction`, `budgetExecution`, `budgetTrend`, many ministry/health/social tools and `macroIndicator`.

Fix: select related questions from the catalog's topic/subtopic and capability, exclude the current question, and allow no suggestions when no relevant candidate exists. Never silently use elections as the universal default. Guard every registered tool with coverage/relevance tests.

### F04 — P1: Follow-up translations change the intended tool

Eleven paired mismatches were reproduced through the actual provider with previous-answer context; see the table below. Examples include EU cohesion → parliamentary cohesion, settlement history → national results, and party municipal breakdown → local-election mayors.

Fix: define each follow-up by question ID/tool and typed arguments, with two labels for the same intent. Route strings only when the user types free text. Tests must assert tool, arguments, geographic grain, period and result shape in both languages.

### F05 — P1: Same-tool routing can still answer the wrong question

Actual provider results reveal failures that a tool-name assertion misses:

- `Where did prices rise the most?` → `priceRanking`, but title is **Price ranking: cheapest (places)**. Bulgarian selects largest increase.
- `БВП на човек по области` → `macroIndicator`, but title is **real GDP growth**; English gives a national GDP-per-capita series, not an oblast breakdown.
- `Европейски средства по области` / `EU funds by oblast` → `fundsOverview`, a **beneficiary** ranking, not oblasts.
- `Show the contracts won by Sofarma Trading` → `contractSearch` but returns **No procurement contractor matching “Show the contracts won by Sofarma Trading”**. The Bulgarian counterpart resolves the company.
- `Какви обществени поръчки печели Метро?` / `What public contracts does Metro win?` → `chainProfile`, a retail-chain profile, not contract results.
- `Каква беше активността?` / `What was the turnout?` → `turnoutSeries`, not the preceding election's single turnout result; machine-share follow-up similarly returns a series. Either clarify labels as trends or preserve the selected contest.

Fix: add semantic assertions beyond non-null response/tool equality: ranking metric/direction, entity ID, geographic aggregation, fiscal/election period, and absence of entity-not-found envelopes.

### F06 — P2: Autocomplete translations diverge in four repeated families

18/178 pairs differ in tool selection:

- English irregularities → national results (1).
- English diaspora vote “over recent years” → snapshot rather than trend (1).
- English party “by municipality in Plovdiv” → local municipality instead of party breakdown (8 parties).
- English party “done over the years” → single-election result instead of timeline (8 parties).

`ai/app/suggestions.ts` maintains these texts separately from the catalog. Fix the router precedence/phrasing and generate suggestions from typed catalog templates. Enforce bilingual intent and argument parity for all 356 texts.

### F07 — P2: Hardcoded entities make generic follow-ups arbitrary

`ai/app/followups.ts` hardcodes GERB after national/region results, Plovdiv after local aggregates, Sofarma Trading after top contractors, EIK 831646048 after MP procurement, and Metro after any retail-chain profile. These choices do not necessarily come from the selected answer. The Metro prompt also fails semantically as described above.

Fix: derive drill-down entities from a relevant result row using stable IDs, or label a fixed example explicitly. Preserve geographic and temporal context when continuing the same question. A different party/company should be an intentional comparison, not an invisible default.

### F08 — P2: Four uncoordinated prompt mechanisms defeat current tests

The hero picks IDs; catalog starters have explicit capability/default contracts; autocomplete and follow-ups are plain bilingual strings. `Chat.tsx:935` sends follow-up text back through free-text routing. `starters.test.ts` only proves exact catalog strings route correctly at a fixed election context. All 564 exact contracts passed while the screenshots remained reproducible.

Fix: consolidate click-based prompts into a shared structure: question ID, parameters, localized label, relation to the source answer. Add tests for the actual hero click, every generated follow-up, autocomplete templates, acronym-free variants, source-domain relevance and end-to-end rendered results. Current test totals must not be used as proof that all discovery surfaces work.

### F09 — P2: Shortened indicator names need safe disambiguation

The parenthesis-removal sweep exposes misleading routes such as employment rate → no route, economic activity rate → turnout, house prices → housing government expenditure or retail settlement prices, and municipal obligations → local-election municipality. For measure names whose qualifiers distinguish annual/quarterly or ESA/cash, safe clarification is preferable to silently selecting an unrelated subject.

Fix: use catalog aliases with explicit ambiguity handling. Treat these 19 probe mismatches as a review queue; do not force all shortened names to their original measure when meaningful qualifiers were removed.

### F10 — P2: Local provider readiness is incomplete

Fresh catalog probes failed for `mpAssetsTop`, `mpAssetsByParty`, and `officialsAssetsTop` in both languages because `mp_assets_rankings_table` / `officials_rankings_table` were absent from the local database at probe time. This is an environment/readiness finding, not confirmed production breakage. Subsequent follow-up execution did resolve some assets questions, so local state may have changed concurrently.

Fix: verify migration/serving readiness in the deployment target and make the integration gate explicitly distinguish unavailable local prerequisites from product intent failures. Do not overwrite successful historical validation records with a claim that today's full probe passed.

## Follow-up translation failures (actual provider)

| Source | Bulgarian target | English target | Lost intent |
|---|---|---|---|
| settlementResults | settlementHistory | nationalResults | Results in Inovo over the last 5 years |
| settlementHistory | settlementResults | nationalResults | Results in Inovo |
| cohesionAbsorption | fundsOverview | macroIndicator | Which oblast gets the most EU money per capita? |
| governments | officialsAssetsTop | no route | Which ministers are richest? |
| partyFinance | partyTimeline | partyResult | How has ГЕРБ-СДС done over the years? |
| regionBreakdown | municipalityBreakdown | localMunicipality | ГЕРБ-СДС by municipality in Lovech |
| regionBreakdown | partyTimeline | partyResult | How has ГЕРБ-СДС done over the years? |
| municipalityBreakdown | settlementBreakdown | localSubMayors | ГЕРБ-СДС by settlement in Dolni chiflik municipality |
| localVoteFlows | localCouncilVoteShare | localCouncil | Council results at the local elections |
| regionalInvestment | cohesionAbsorption | factionCohesion | Are the cohesion funds absorbed? |
| problemSections | census | romaVoteTrend | Which party wins the Roma vote over the last 5 years? |

## Missing follow-up coverage by domain

| Registry domain | Tools without a dedicated branch |
|---|---:|
| fiscal | 76 |
| indicators | 30 |
| elections | 15 |
| local | 12 |
| people | 11 |
| place | 10 |

## Recommended repair order and acceptance criteria

1. Fix the three reported defects together: hero → latest budget overview; acronym-independent function routing; topic-aware follow-ups. Verify from a genuinely empty chat and through both chips and typed text in BG/EN.
2. Replace free-text click dispatch with typed catalog intents. Repair all 11 follow-up mismatches, the 18 autocomplete mismatches, and the same-tool semantic errors above.
3. Cover all 227 tools with relevant follow-ups or an explicit no-follow-up decision. Derive entities from answers and prevent accidental repeats; the fourth nationalResults suggestion currently disappears behind `slice(0, 3)`.
4. Expand regression gates from exact strings to the complete discovery graph: hero/catalog/autocomplete → actual provider result → next prompt. Validate meaning, not merely successful execution.
5. Verify production serving prerequisites, refresh embeddings and affected validation evidence after semantics change, then deploy and repeat browser checks. Keep the audit data as the before-state evidence.

No blanket replacement of 2024 with 2025/2026 is appropriate: COFOG's reporting period remains distinct from state-budget cash execution. The fix is selecting the intended dataset and explaining its scope.
