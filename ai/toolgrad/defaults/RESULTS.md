# ToolGrad follow-up: implementation and promotion decisions

The requested defaults are implemented: unqualified Plovdiv means the city;
municipal transfers means totals by transfer type. Explicit province, national
scope, municipality distribution and ranking requests override these defaults.
Conversation follow-ups preserve year and scope without hijacking new topics.

## Routing: retain deterministic defaults; no prompt-only promotion

Accept the shared product-default policy in the local implementation. On the
50-question fresh suite, the current parser and conversation resolver produced
50/50 expected selections with both prompts, including 14/14 controls. Raw model
selection was 39/50 for the old prompt and 40/50 for the clarified prompt; raw
transfer selection actually declined from 7/12 to 6/12. This supports keeping the
policy enforcement and explicit product wording, not claiming a reliable routing
improvement from prompt tuning alone. The earlier learned routing appendix
remains unpromoted. These are not old/new runtime or end-to-end answer scores.

## Narration: accept the local candidate; qualify rollout evidence

Accept the revised narration prompt, tax fact coverage, conservative semantic
checks and validated-output buffering in the local implementation. The fixed
rubric review improved from 13/18 to 18/18, including 6/10 to 10/10 on the fresh
validation subset. One baseline failure was a mathematically correct but
unsupplied duration calculation; do not describe all five as hallucinations.
The tax improvement includes better supplied facts, not just better wording.

A correct missing-payment explanation initially triggered fallback. The repaired
guard accepts it and all 18 retained candidate responses on replay. That replay
is not fresh validation of the repair. One BG response still exposes an English
field key; lexical checks neither prove entailment nor ensure fluent Bulgarian.
Buffering also means narration appears together after validation rather than
incrementally. Before production rollout, use fresh unseen cases for the repaired
guard and assess real provider latency and Bulgarian prose quality. No deployment
or production acceptance decision is part of this change.

## Evidence and verification

- [Routing evidence](ROUTING_RESULTS.md): frozen generic questions, raw outputs,
  explicit scope controls, reproducible scoring and original-score preservation.
- [Narration evidence](NARRATION_RESULTS.md): fictional facts only, frozen rubrics,
  exact-report-bound assessments and separately labeled guard replay.
- Machine-readable decisions: `data/ai/toolgrad/defaults/promotion.json`.
- Full AI suite: 3,223 passed, 209 existing expected failures, 23 database-dependent
  skips. The subsequent focused repair run passed 14 tests, including two new
  assessment-binding regressions. Lint, AI typecheck and production build passed.
  Expected failures and skipped database checks are not counted as passes.

The new evaluations used 136 model requests and a $4.216 reservation ceiling;
actual billed cost was unavailable. The original pilot is preserved. Captured
personal/financial records were not sent in these follow-up runs. All remaining
assessment and promotion work ran locally.

The useful ToolGrad principle here is to turn concrete failure feedback into
controlled revisions and test them separately. This implementation uses that
workflow; it does not train a model or establish general improvement across all
chat questions. Further tuning needs a new evaluation set because these outputs
have now been inspected.
