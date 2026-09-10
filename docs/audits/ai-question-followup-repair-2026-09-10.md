# AI question and follow-up repair — 2026-09-10

The before-state audit remains in `ai-question-followup-audit-2026-09-10.{md,json}`. This report describes the repaired release.

## Outcome

- The empty-chat Budget card selects state-budget plan and execution, using the latest available fiscal year. Explicit 2025 requests retain that year. COFOG remains a separately named, lagged general-government expenditure dataset.
- Functional-spending questions work without the COFOG acronym.
- All clickable catalog questions, autocomplete entries and follow-ups carry typed catalog intent. Bulgarian and English labels cannot select different tools.
- Autocomplete uses the full catalog plus validated entity templates. The absent Ataka example was removed; retail-chain profiles are labeled as profiles. Public-contract questions select actual contracts.
- Follow-ups use the same topic, omit arbitrary example entities, preserve company IDs and place pins, show inherited election/fiscal dates, and exclude answered intents. A missing suitable continuation has an explicit no-suggestion policy.
- Price-increase ranking orders by increase; regional GDP and EU-funds questions retain geographic aggregation. English Trading company names retry the registered transliteration only after the original lookup has no match.
- Incomplete macro labels with omitted age/cadence/unit qualifiers request clarification instead of changing subject.

## Evidence

- Local discovery graph: 2,960 provider executions; zero hard failures; eight legitimate person/election clarification responses. This covers deduplicated BG/EN catalog/autocomplete intents and their generated follow-ups, not every possible typed sentence or entity/year combination. See `ai-discovery-validation-2026-09-10.json`.
- Production data prerequisites: 62 executions, zero failures, including budget, contract lookup, price ranking, regional investment, MP assets, assets by party, and officials' assets. See `ai-discovery-production-2026-09-10.json`.
- Separate tests exercise rendered hero identities, native autocomplete activation, typed-provider dispatch, every registered tool's continuation policy, historical labels, stable entity IDs, repeat suppression, ranking direction and budget columns. The probe explicitly distinguishes missing data, unresolved entities, and valid clarification/zero-result responses.
- The existing assets relations were available during these production checks. No migration was applied on the basis of the earlier local-only failures.
- Retail-chain provider validation was refreshed in both languages. Tool embeddings were regenerated from the committed release's 227-tool registry after correcting its retail-profile example.

## Release isolation

The release is built from commit `b36e493753` plus the reviewed final registry-example, contracts-routing, regression-expectation and embedding updates. Concurrent unfinished presidential-poll changes are excluded from this release and preserved in the shared workspace.

## Deployment and acceptance

Deployed successfully to Firebase Hosting `electionsbg-ai` / https://ai.electionsbg.com/ on 2026-09-10. The standard deployment ran its correctness harness and production build; no predeploy gate was skipped.

Isolated release validation: 43 test files, 2,165 tests passed, one explicitly skipped; all 1,823 question regression cases passed. Browser checks in Chrome confirmed BG/EN empty-chat Budget cards show 2026 plan/actual (partial through 2026-07-31), explicit 2025 shows a complete year through 2025-12-31, and acronym-free functional-spending questions show the COFOG table. A budget follow-up opens the completed-year budget trend, with no election suggestions. English party-by-municipality autocomplete also dispatches the correct party and Plovdiv province, with relevant election follow-ups.

Existing saved answers are not recomputed on reload. Start a new chat or ask the question again to see the repaired answer.

## Plan commits

1. `48f25cf4d3` — budget entry points and topic fallback.
2. `832009f500` — typed dispatch and suggestion semantics.
3. `2704fc12c1` — contextual follow-ups and coverage policy.
4. `b36e493753` — discovery graph and semantic regression gates.
5. Final release evidence and retrieval refresh — this report's commit.

All numbered review findings were repaired; none remain for manual review.

