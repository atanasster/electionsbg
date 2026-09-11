# Narration grounding experiment

The candidate supplies the actual local and national tax rates to narration,
asks for one to four grounded sentences, prohibits unsupported arithmetic and
motivation/risk interpretations, and buffers provider output until its checks
pass. Rejected prose uses the existing deterministic fallback. Both cloud and
local providers now deliver validated prose together instead of streaming
unvalidated fragments.

The experiment used only fictional records: four development fixtures derived
from previous failure categories and five new validation fixtures, each in BG
and EN. Cases and rubrics were frozen before 36 model requests. The old pilot
and the new raw responses remain unchanged. This is coding-agent rubric review,
not blinded human evaluation. Paired translations are correlated.

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| Raw outputs meeting the strict factual rubric | 13/18 | 18/18 |
| Development subset | 7/8 | 8/8 |
| Fresh validation subset | 6/10 | 10/10 |
| Original runtime acceptance | 17/18 | 17/18 |
| Accepted when replayed through the repaired semantic guard | 14/18 | 18/18 |
| Tax responses containing supplied local and national rates | 0/2 | 2/2 |

The five baseline rubric failures include one correct but unsupplied duration
calculation, one unsupported reliability judgment, one computed asset difference,
and two unsupported interpretations of an indicator count. The original numeric
guard caught the asset difference. Guard acceptance is not semantic correctness:
the repaired lexical guard still accepts some unsupported baseline judgments.

The candidate's original guard rejected a correct statement that payment was
unknown because payment data was unavailable. The repair permits a literal
supplied missing-data explanation and adds regressions. The replay is explicitly
post-repair evaluation of retained responses, not fresh validation of that repair.
Original acceptance values and manifests are preserved. The original run lacked a
guard-source hash; future runs record one, and the replay records its own hash.

One candidate BG response retains `screening_signals` and English fixture
provenance. It satisfies the factual rubric but remains an editorial defect.
Lexical safeguards do not prove entailment, correct attribution or fluent language;
valid paraphrases can also trigger fallback. The tax cases change available facts
as well as the prompt, so their improvement is not solely prompt tuning.

Run the local review/replay without network access:

```sh
node --import tsx ai/toolgrad/defaults/reviewNarration.run.ts
```

Fixed rubric judgments are bound to the exact assessed report hashes; replacing
responses requires a new review, and local replay refuses mismatched reports.

Per-response assessments and report hashes are in
`data/ai/toolgrad/defaults/narration-review.json`. To generate new experiments,
use `narration.run.ts baseline|candidate <new-directory>` with the documented
synthetic fixtures and model credentials. The committed run used 36 requests,
a $1.116 reservation ceiling, and no captured personal/financial records.
Actual billed cost was not returned. No deployment follows automatically.
