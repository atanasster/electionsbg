# Non AI shared eval coverage — 2026-09-10

The deterministic chat tests now import the same 471 bilingual cases as the Gemini evals, including all 40 new realistic pairs. There is no separate copy of the prompts or gold answers. Both language variants run: 942 route/argument checks.

`HeuristicProvider.respond()` and the tests share `selectHeuristicRoute()`, extracted without changing behavior. It includes scope notices, previous-turn resolution and election pinning. Structured history supplies the previous tool/arguments; the three older embedded-context examples are adapted into the same input. The Non AI provider still only uses its supported previous-turn behavior, not the model's richer conversation logic. No Gemini prompt, model route repair, model call, credential, database or network is used.

Tool selection and argument validity/exact annotated values are checked separately. Argument validity is an evaluation check; it does not add validation to the Non AI execution path. The existing database-backed end-to-end regression suite remains intact. A separate mocked provider check confirms that real chat calls the shared route and emits rules metadata without network/model use.

## Measured current behavior

| Metric | English | Bulgarian |
|---|---:|---:|
| Correct tool | 75.8% | 83.2% |
| Validated call with annotated arguments | 73.7% | 81.1% |
| Exact annotated arguments (53 cases) | 30.2% | 39.6% |
| New everyday questions | 7/24 | 9/24 |
| New conversation follow-ups | 0/8 | 2/8 |
| New clarification/action cases | 4/8 | 6/8 |

729 of 942 prompt responses meet their original expectations; **213 are known gaps**. Those are explicit `it.fails` cases, with an inspected route inventory in `ai/tests/nonAiEval.knownFailures.json`. The expected tool/arguments are never changed to match current behavior. A new failure in a passing case fails the gate; fixing a known gap creates an unexpected pass and requires removing its inventory entry. This is a regression baseline, not a claim that Non AI handles all these questions.

The test run reports 731 passes (729 prompt cases plus two coverage/provider checks) and 213 expected failures. Typechecking, targeted lint and the cloud-provider regression harness also pass. No routing fixes are included in this test-coverage change.

## Commands

```sh
npm run ai:test:non-ai   # Hermetic regression gate, includes known-gap tracking
npm run ai:eval:non-ai   # Recompute honest metrics and per-case details
```

Both `npm run ai:test` and `npm run ai:test:all` now start with this gate before their existing checks. The standalone gate does not require the local database; the later existing integration checks still do. Results are saved in `data/ai/evals/non_ai.json`, including a suite hash, expected arguments and observed routes. This task did not rerun the unrelated database-backed integration suite or change the public eval page.
