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
- `russia-supplement-2026-09-01.json` contains 25 more blinded assignments that
  ask `russia_stance` ONLY. It is ENRICHED for ordinal spread and is not a
  prevalence sample.
- `article-content-hashes-2026-09-04.json` freezes a hash over `{title,
  description, content}` per assignment — the fields an adjudicator is shown —
  so a nightly metadata write cannot break provenance. Rebuild with
  `python3 news/scripts/freeze_article_content_hashes.py --write`. ⚠️ It is a
  SIDECAR, keyed by `assignment_id` and stating the `assignments_sha256` it
  binds to, because adding a field to the assignment rows would change that
  hash and invalidate every sealed pass.
- `human-agreement-policy-2026-09-01.json` records the adjudication method, the
  precision floors, the supplement and the one declared exemption, each with
  its reason. Pass it to the scorer with `--policy`.

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

`--policy` also loads the supplement passes the policy declares. Those are
completed files under the gitignored `news/var/adjudication/`, so on a fresh
clone they are absent and the run refuses with the missing key and path named
— a wrong path and a pass nobody has adjudicated here look identical from
inside the scorer, so the message states both. ⚠️ It refuses rather than
scoring without them: dropping the Russia supplement takes
`russia_stance.direction` from n=30 to n=7 and switches the axis to
`low_precision`, which is a different verdict reached by discarding evidence.
A supplement is loaded whole or the run stops.

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

⚠️ **A dry run over this sample's real shape found two measures that would be
withheld on n before a human touched them.** Stratifying by hidden v1 party
label alone leaves the Russia axis with 12 positioned rows (38
`not_applicable`) and the leaning axis with 2 `not_applicable` rows — so
`russia_stance.direction` landed at n≈12 against a floor of 20, and
`leaning.applicability` at a minority class of 2 against a floor of 5,
regardless of how well the adjudicators agree. Both are resolved, differently,
and both resolutions are recorded in the policy file:

- **Russia** — widened. `russia-supplement-2026-09-01.json` adds 25 rows, five
  per ordinal position including both strong endpoints. It pools into
  `russia_stance.direction` and nothing else; a re-run of the dry run with it
  gives n=36 (12 prevalence + 24 supplement).
- **Leaning applicability** — exempt, and argued rather than waived. Every row
  in the main sample is an (article, party_surface) pair, so every article is
  political by construction and the category the measure needs cannot occur;
  widening is not available either, since a party-less article cannot be an
  assignment row without changing the sample's unit. ⚠️ The exemption is
  honoured ONLY while the data corroborates it. If the adjudicator marks enough
  leaning `not_applicable` for the measure to become scorable, the scorer
  REFUSES the exemption and scores it normally — a B4 regression must not be
  switchable off by a policy file.

## Adjudication method (decided 2026-09-04)

**Two independent human adjudicators** — Atanas (pass A) and Stoyan (pass B) —
each blinded to the other's pass. This is the plan's option (a), the strongest
of the three, and it supersedes the solo fallback (b) recorded on 2026-09-01;
no measurement was ever taken under the fallback. ⚠️ It measures **inter-rater
agreement**, and every report derived from it must say so under that name —
calling it `rubric stability` would under-claim a stronger result.

The seven-day gap does not apply, and its absence is not a weakening: the gap
exists only to decorrelate ONE person's two passes from their own memory of the
first, and two people share no such memory. The scorer derives the method from
the sealed passes' adjudicator names and rejects a policy that disagrees, so
the policy file cannot claim a method the passes do not support.

The full run, in order — 75 rows per pass; the supplement rows ask one axis,
not three:

```bash
# adjudicator 1
python3 news/scripts/adjudicate_editorial_treatment.py --pass A --adjudicator "<name 1>"
python3 news/scripts/adjudicate_editorial_treatment.py --pass A --supplement --adjudicator "<name 1>"

# adjudicator 2 — no waiting period
python3 news/scripts/adjudicate_editorial_treatment.py --pass B --adjudicator "<name 2>"
python3 news/scripts/adjudicate_editorial_treatment.py --pass B --supplement --adjudicator "<name 2>"

python3 news/scripts/score_editorial_treatment_agreement.py \
  --policy news/evals/editorial_treatment_v2/human-agreement-policy-2026-09-01.json \
  --pass-a news/var/adjudication/pass-a.json \
  --pass-b news/var/adjudication/pass-b.json
```

The policy's `supplements[0].pass_a`/`pass_b` already point at the completed
supplement working copies. Both scoring inputs live in the gitignored
`news/var/adjudication/`, because the workspace refuses to write inside this
directory and the checked-in templates must stay pending.

⚠️ **The frozen corpus lives in a tree the nightly job writes to.** On
2026-09-02 an image-rights pass rewrote 40 of the 1,833 baseline article files
— three inside the gate's 75 assignment rows — so `file_sha(article)` stopped
matching `article_sha256` and the gate could not be scored at all.

**Fixed on 2026-09-04 by freezing a second hash.**
`article-content-hashes-2026-09-04.json` records a hash over `{title,
description, content}` per row, so the scorer resolves a moved file hash in
three steps:

1. bytes match `article_sha256` → nothing to do;
2. bytes moved but the frozen CONTENT hash still matches → `content_verified`,
   the judged text is unchanged and the run proceeds with no exemption;
3. bytes moved and the content hash moved too → refused, naming the judged text
   as the thing that changed.

So the recurrence is now cleared by a CHECK rather than by an argument. ⚠️ Only
a record whose `basis` is `frozen` may clear a drift. A `post_drift` record was
taken from a file that had ALREADY moved, so it gives forward protection and no
evidence about what the adjudicators read — honouring one would convert the
three hand-argued rows into `content_verified` and make their exemptions look
removable. `basis` is derived by comparing hashes at freeze time, never
hand-set, and the freezer refuses to overwrite a row that would lose `frozen`.

The three original rows therefore keep their `article_drift_exemptions`, each
pinned to one `(frozen_sha256, observed_sha256)` pair so it covers exactly the
recorded mutation and refuses the next. Every drifted row is reported in the
result's `provenance` as `content_verified` / `honoured` / `refused` / `stale`,
because a gate cleared on an argument is a weaker result than one cleared on a
hash, and a report has to be able to say which.

⚠️ Do **not** instead re-freeze `article_sha256`, and do not add the content
hash to the assignment rows: `assignments_sha256` is a canonical hash over the
whole array, so either one invalidates both sealed passes and discards every
human judgment in them. That is why the content hashes are a sidecar.

## Party-identity audit

Review each row whose `review_status` is `pending_human_link_audit` or which
contains `pending_context_candidates`. Record decisions in a separate output
keyed by `pair_sha256`, bound to the review file's `assignments_sha256` and the
policy hash. A reviewer may accept the exact id, reject it with a refusal
reason, or leave it unresolved. Never write a candidate id into the frozen
assignment row and never approve an aggregation family in place of exact
identity.
