# Editorial-treatment v2 Tier 0 artifacts

These files freeze the pre-cutover corpus, the synthetic boundary oracle and
the human-review assignments. They are inputs to a gate, not evidence that the
gate has passed.

## Frozen inputs

- `fixtures.json` contains 63 original synthetic boundary cases.
- `baseline-2026-09-01.json` contains the 1,833-record analysis manifest,
  article/analysis hashes, v1 distributions and prompt/schema hashes.
- `clean-amplification-stratum-2026-09-01.json` is a 17-pair review stratum.
  Its regex match is not an automatic relabeling.
- `party-identity-review-2026-09-01.json` names all 137 unresolved v1 party
  pairs, the fail-closed v2 result and any pending context candidate.
- `human-agreement-sample-2026-09-01.json` contains 50 immutable, blinded
  assignments. It exposes neither v1 labels nor analysis paths.

Do not add human decisions inside these immutable arrays. Review outputs use a
separate file keyed by `assignment_id` or `pair_sha256` and state the matching
`assignments_sha256`.

Verify the fixture and snapshot hashes:

```bash
python3 news/scripts/editorial_treatment_baseline.py --check --verify-live-snapshot
```

## Human agreement gate

`human-agreement-pass-a.template.json` and
`human-agreement-pass-b.template.json` contain the same assignments in
different deterministic orders. Give each adjudicator only their pass file
and access to the referenced corpus articles. Do not provide the other pass,
the v1 analysis files or the clean-amplification stratum.

### Doing a pass

Use the workspace rather than hand-editing the JSON — it serves the article,
the rubric and the three pickers on one page, saves every choice as you make
it, and writes a sealed pass file:

```bash
python3 news/scripts/adjudicate_editorial_treatment.py --pass A --adjudicator "Name"
```

It works from a gitignored copy under `news/var/adjudication/` and refuses to
write inside this directory, so the checked-in templates stay pending. It never
shows a v1 label, an analysis file, the other pass or the clean-amplification
stratum; the outlet and URL are one deliberate click and the click is recorded
on a sidecar (`<work>.notes.json`), because §3.2 rule 7 says judge the text and
an unrecorded reveal is unauditable. Keys: `1-5`/`0` leaning, `q-t`/`y` Russia,
`a-g` party tone. "Finalize & seal" refuses an incomplete pass.

To do it by hand instead: copy the template, set `adjudicator` and a
timezone-aware `completed_at`, keep `annotator_kind` equal to `human`, fill each
row's `decision` without touching the assignment/article/party fields, then

```bash
python3 news/scripts/score_editorial_treatment_agreement.py \
  --seal-pass /path/to/completed-pass-a.json
```

### Scoring

Score the two sealed files against the frozen assignments:

```bash
python3 news/scripts/score_editorial_treatment_agreement.py \
  --assignments news/evals/editorial_treatment_v2/human-agreement-sample-2026-09-01.json \
  --pass-a /path/to/completed-pass-a.json \
  --pass-b /path/to/completed-pass-b.json
```

Two different humans may complete the passes independently. The solo fallback
uses the same human twice, blinded, with pass B completed at least seven days
after pass A. A model pass is rejected. Constant-label agreement is
unscorable, not κ=1. Every axis must independently reach weighted κ ≥ 0.80.

The checked-in templates intentionally return `blocked_pending_humans`.

### `not_applicable` is scored off the ordinal scale (2026-09-01)

Each scalar axis reports TWO measures, not one:

- **applicability** — binary Cohen κ over all 50 rows;
- **direction** — quadratic weighted κ over the five ordinal positions, on the
  rows *both* adjudicators judged applicable.

Both must clear 0.80. `party_tone` has no off-scale category and reports
`direction` only.

⚠️ Scoring `not_applicable` as a sixth ordinal position made the verdict depend
on an array index: it sat one quadratic step from `strong_anti_russia` and five
from `strong_pro_russia`, so the same applicability disagreement scored 0.71 to
0.99 depending only on which direction it fell in. Measured on a pass pair
shaped like this sample, moving the label from the end of the list to the front
— annotations untouched — took the identical data from 0.7146 (fail) to 0.8030
(pass).

Two floors keep a thin measure from rendering as a green tick, and both report
`low_precision`, which is withheld rather than passed or failed:

- `--min-n` (default 20) on `direction` rows;
- `--min-minority-n` (default 5) on the rarer applicability class, because
  Cohen κ on a 48/2 marginal is dominated by one or two cells.

⚠️ **A dry run over this sample's real shape says two measures will be withheld
before a human touches it.** The sample was stratified by hidden v1 party label
only, so on the v1 reading of these same 50 articles the Russia axis has 12
positioned rows (38 `not_applicable`) and the leaning axis has 2
`not_applicable` rows. That gives `russia_stance.direction` n≈12 against a floor
of 20, and `leaning.applicability` a minority class of ~2 against a floor of 5 —
regardless of how well the adjudicators agree. Decide before labelling whether
to widen the sample on those two strata or to record an explicit lowered floor
with its reason in the baseline report. Every figure lands in
`counts`/`ci95`/`minority_n` so neither choice is silent.

## Party-identity audit

Review each row whose `review_status` is `pending_human_link_audit` or which
contains `pending_context_candidates`. Record decisions in a separate output
keyed by `pair_sha256`, bound to the review file's `assignments_sha256` and the
policy hash. A reviewer may accept the exact id, reject it with a refusal
reason, or leave it unresolved. Never write a candidate id into the frozen
assignment row and never approve an aggregation family in place of exact
identity.
