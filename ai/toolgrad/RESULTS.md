# ToolGrad-inspired pilot — 11 September 2026

**Decision: retain the production prompts.** The offline dataset and evaluation
pipeline are complete, but the tested routing appendix did not demonstrate a
reliable improvement. It failed the promotion conditions frozen before validation.
No public chat behavior, model weights, deployment or production data changed.

## What was implemented

- 24 executed workflows across elections, procurement, people and municipal data,
  captured in both languages: 48 successful local tool executions.
- 144 questions: 108 development and 36 held out across six whole workflows.
  All translations and paraphrases of a workflow share its split.
- 57 generation requests produced 141 accepted raw questions. Local semantic
  review changed 41 entries, including three locally authored replacements for
  a failed batch. Raw attempts and every correction are retained.
- A separate reference: 32 hand-written questions and eight conversation cases,
  each in Bulgarian and English (80 cases). These predate this pilot; they may
  already have influenced the production prompt, so this is not a pristine benchmark.
- Isolated model routing through the production Gemini 3.5 Flash-Lite prompt and
  parser; eight synthetic narration checks, reviewed locally against explicit rubrics.

The method borrows ToolGrad's execution-before-question idea. It does not implement
its full API search/textual-gradient optimizer or fine-tune a model. Generation
receives only generic contracts and placeholder arguments; local review supplies
execution-grounded critique. Captured facts, personal names and identifiers remain
local. Routing inputs replace private entities with synthetic ones. Geography and
party names remain. This compromise weakens realism for entity-dependent questions.

## Routing results

Counts below measure the frozen expected call, not end-to-end user satisfaction.
The generated suites require the full validated argument set, allowing supported
aliases and defaults but rejecting added filters. The reference uses its existing,
less exhaustive argument annotations. No API failures occurred.

| Suite | Baseline | Candidate | Interpretation |
| --- | ---: | ---: | --- |
| Development call success |107/108 (99.1%)|107/108 (99.1%)|No gain|
| Held-out call success |33/36 (91.7%)|31/36 (86.1%)|Two fewer successes|
| Hand-written reference call success |73/80 (91.3%)|77/80 (96.3%)|Four more successes|
| Clarification/unsupported abstention, subset of reference |15/16|16/16|One more correct abstention|
| Annotated reference argument success |52/56|53/56|One more success|

The only development miss was a terse synthetic request for one person's declared
wealth. Baseline chose an MP wealth ranking. The candidate explicitly distinguished
individual declarations from rankings, but then abstained on the same question.
Its text is frozen in `data/ai/toolgrad/candidate.json`; no tuning used validation
failures. The candidate failed both the development-improvement and held-out-improvement
conditions, despite better reference results. This is insufficient evidence to ship it.

Some apparent errors need adjudication before a future experiment. The generated
municipality questions sometimes say only “Plovdiv,” which can mean a city or a
province. “Municipal transfers” can mean totals by transfer type (`municipalTransfers`)
or distribution across municipalities (`budgetMunicipalTransfers`). Frozen labels
were not retroactively changed to improve scores. Future datasets should explicitly
state the intended geography and aggregation. The masked name “Example Official”
may also cause abstention; this failure does not prove the same issue occurs with
real public names. After inspecting these hold-out failures, a future revised
candidate needs a new untouched validation set.

These are single runs, not significance estimates. Paraphrases are correlated,
only six workflows are held out, and temperature zero does not guarantee identical
outputs. Independent repeated trials would be needed before claiming a modest gain.
The deterministic runtime fallback and actual entity resolution are outside these
routing measurements; existing safeguards may prevent some observed model mistakes.

## Factual interpretation

All eight fictional narration outputs passed the current number and script guards.
Local semantic review judged five of eight free of unsupported claims under the
stated rubric. The three failures were:

1. Falling turnout was interpreted as declining public interest: an unsupported
   inference about motivation.
2. The model calculated a ten-percentage-point difference and wrote the number in
   words. The digit-based guard accepted it even though the supplied facts did not
   contain that difference.
3. Two risk signals were characterized as a “minimal” level without a denominator
   or benchmark, despite correctly disclaiming proof of wrongdoing.

Awarded-versus-paid money and declared-versus-audited assets remained distinct in
both languages. These checks use invented figures, not the captured personal or
financial records, and are smoke tests rather than a live factual-accuracy estimate.
Review is by the local coding agent, not a human panel or an independent judge.
The explicit review and outputs are in `data/ai/toolgrad/narration/`.

A further local observation: the captured `localTaxes` envelope has the actual rates
in table rows, while narration receives only its `place` and `indicators` facts.
The current narration prompt does not receive rows. Improving factual coverage of
such envelopes may help more than adding routing instructions, but it requires its
own scoped change and evaluation. The pilot does not modify that data contract.

## Latency and cost

| Router suite | Baseline median / p95 | Candidate median / p95 |
| --- | ---: | ---: |
| Development |685 /903 ms|686 /900 ms|
| Held out |746 /966 ms|714 /1144 ms|
| Reference |699 /824 ms|665 /840 ms|

These are direct model-request timings at concurrency 4, not full chat response
latency. Local captured tool execution timings are also retained in `corpus.json`;
they depend on a warm local database and caches, not production serving conditions.
The pilot made 57 generation, 448 routing and 8 narration requests (513 total).
Provider usage is retained, but billed cost was not returned: actual spend is
**unknown**. The production reservation-policy ceiling is **$15.903**, not a bill.
Most routing input tokens are the full tool catalogue; no serving-cost reduction
was demonstrated by this experiment.

## What to do with the result

Use the new corpus and runners to reject weak prompt changes before deployment.
The most promising next experiment is semantic narration grounding: preserve value
attribution, reject unsupported causal/threshold statements, and test arithmetic
written in words. Curate a fresh, unambiguous validation set before another routing
iteration. Neither fine-tuning nor a multi-tool runtime is justified by this pilot.

Reproduction commands and artifact limitations are in [README.md](README.md).
[ToolGrad paper](https://arxiv.org/html/2508.04086v3),
[Google Research overview](https://research.google/blog/toolgrad-efficient-tool-use-dataset-generation-with-textual-gradients/).
