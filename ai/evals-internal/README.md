# Internal eval artifacts — not published

Measurements kept as a record but deliberately NOT under `data/`, which is synced
wholesale to the public bucket. Nothing on the evals page reads them.

- `jev_lane.json` — the no-AI Jev lane on the main question bank
  (`ai/llm/jevLane.run.ts`).
- `jev_gate_sweep.json` — the Jev confidence-gate sweep on the same bank
  (`ai/llm/jevGateSweep.ts`).
- `jev_noai_stages.json` — every row of the no-AI Jev lane's stages 0-3 on the
  robustness questions (`ai/llm/jevNoAiStages.ts`). Unlike the two above it IS
  on the evals page, as a summary without rows:
  `data/ai/evals/jev_noai_robustness.json`, written by the same run.
- `jev_noai_trigger.json` — whether a cheap offline trigger ("rules found no
  tool", "any word the rules' vocabulary does not know") could call Jev only
  for the questions the rules get wrong (`ai/llm/jevNoAiTrigger.ts`, no API
  calls). It could not: the trigger that catches the misses also fires on
  60-100% of reader-typed questions, so "Jev only when the rules fail" costs
  almost what "Jev on every question" does.

The first two were measured on a bank made mostly of the examples the rules router was
built from, so they compare Jev with the rules on the rules' own material. Jev
is compared on questions the rules were not built from in
`data/ai/evals/jev_robustness.json` / `gemini_robustness.json`.
