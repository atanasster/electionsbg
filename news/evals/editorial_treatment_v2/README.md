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

For each pass:

1. Work from a private copy of its template.
2. Set top-level `adjudicator` and timezone-aware `completed_at`; keep
   `annotator_kind` equal to `human`.
3. Fill each row's `decision` with `leaning`, `russia_stance` and
   `party_tone`. Do not change assignment/article/party fields.
4. Seal the completed rows:

```bash
python3 news/scripts/score_editorial_treatment_agreement.py \
  --seal-pass /path/to/completed-pass-a.json
```

Then score the two sealed files against the frozen assignments:

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

## Party-identity audit

Review each row whose `review_status` is `pending_human_link_audit` or which
contains `pending_context_candidates`. Record decisions in a separate output
keyed by `pair_sha256`, bound to the review file's `assignments_sha256` and the
policy hash. A reviewer may accept the exact id, reject it with a refusal
reason, or leave it unresolved. Never write a candidate id into the frozen
assignment row and never approve an aggregation family in place of exact
identity.
