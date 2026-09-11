# Release validation outcome

The observed routing, grounding and wording failures are repaired locally.
Recommendation: proceed to staging smoke validation, and hold public deployment
until the real proxy/authentication path, browser rendering and live data are
checked. This work did not deploy anything.

## What changed

- Explicit requests for all of Bulgaria now retain national scope. Bulgarian
  province prefixes and “Пловдивска област” resolve correctly. “The same for/in…”
  follow-ups honor an explicit city or province rather than inheriting the old one.
- Narration receives registered/actual voter counts and an explicit party-vote
  basis, plus meaningful municipality-transfer values and row-unit labels.
- The guard checks observed asset/debt/payment bindings, wrong turnout denominator
  wording, internal identifiers and mixed-script misspellings. It permits the
  tested supported absence explanations and negated risk statements.
- Tax fallbacks use the requested place language and correct singular wording;
  scalar turnout and municipality-transfer fallbacks provide a useful statement.

These are bounded checks for observed failures, not a general entailment engine.
Unmatched phrasing, entity/year attribution and other semantic errors remain
possible. The shared guard protects cloud and on-device narration, but this run
exercised the cloud provider; it is not an on-device model evaluation.

## Results — keep the evaluation stages separate

| Stage | Questions | Scope/data correct | Full-answer quality |
| --- | ---: | ---: | ---: |
| Frozen primary run, before repairs | 48 | 44/48 | 32/48 |
| Retained primary outputs replayed after repairs | 48 | 48/48 | 48/48 |
| Original reserved confirmation run | 8 | 7/8 | 7/8 |
| Retained confirmation outputs replayed after its repair | 8 | 8/8 | 8/8 |
| Four newly frozen targeted follow-ups | 4 | 4/4 | 4/4 |

Replays reuse old model completions and current tools/guards/templates. They cost
no model calls and are development evidence, not fresh validation. Four primary
and one confirmation narration had originally been withheld; no model completion
exists for them, so their repaired replay uses deterministic templates.

The original confirmation failure (“the same for Varna city”) was retained, then
fixed. Four new questions checked that repair; they do not replace the original
7/8 result or establish a broad independent success rate. Across this work there
were 60 distinct question/language instances, plus 20 separate guard probes.
Bilingual pairs are correlated, and the coding agent authored and reviewed them.

All 20 original guard probes now pass as regression tests, up from 13/20 before
repair. The primary replay uses templates for 16 of its 38 data answers. In the
12 fresh confirmation/follow-up questions, three generated narrations were
correctly rejected (mixed-script names or an invented year); safe templates were
shown. Do not interpret these small-suite fallback counts as production rates.

## Latency and checks

The primary run's correctly scoped data answers had a 1,411 ms median and 1,616 ms
p95. Validation-to-callback overhead after completion had a 0.13 ms median and
1.02 ms p95. The production payload already forces non-streaming responses; no
first-token or incremental-stream baseline was invented. These measurements
precede repairs and exclude public proxy/auth, browser and live-data overhead.
See [latency details](LATENCY.md).

Final full AI test run: 3,270 passed, 209 existing expected failures, 23
database-dependent skips. A subsequent focused repair run passed 40 tests,
including four added Sofia-province regressions. Lint, AI typecheck and production build passed. Skipped
database checks are not passes. The unrelated roll-call test edit was preserved.

The new runs used 101 requests with a $3.131 reservation ceiling; actual billed
cost was not returned. Numerical inputs were fictional. Unexpected narration
payloads were withheld before transport, and old pilot evidence is unchanged.

[Primary assessment](PRIMARY_RESULTS.md) preserves the initial failures.
`data/ai/toolgrad/release/final-review.json` contains per-answer final judgments,
content signatures, source-report hashes and the deployment decision. Fixed
judgments refuse different text, tool arguments or envelopes; comparisons check
original numeric facts, table rows and geographic scope against pre-call captures.

Next release gate: a staging smoke test through normal authentication and the
public proxy, checking real-data answers and browser presentation in both
languages. No further prompt tuning should reuse this inspected set as a holdout.
