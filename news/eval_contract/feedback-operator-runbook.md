# Public article feedback operator runbook

This workflow turns anonymous public observations into a private, reviewable artifact. A public
submission is evidence to inspect, never a correction by itself. Only a maintainer command can
review, quarantine or promote it, and accepted feedback remains separate from published analysis
until a later pipeline step consumes it.

Generated exports, bundles, accepted snapshots and registry archives live under
`news/data/evals/feedback-*`. They are gitignored and written with mode `0600`. Do not copy them
into the public app-data tree or commit them.

## 1. Preserve the target registry

Archive the registry for every published release before `news/app-data/feedback-targets.json` is
replaced:

```sh
npm run news:feedback:archive-targets
```

The filename is the registry's canonical SHA-256. Existing submissions retain that source hash.
Review and acceptance load the current registry plus up to 99 archived snapshots; malformed,
misnamed or hash-mismatched archives fail closed.

## 2. Export and assemble local evidence

```sh
npm run news:feedback:export
npm run news:feedback:review-bundle
```

The export is a sorted, allowlisted JSONL snapshot with a manifest hash and Firestore read time.
The bundle joins it to full local article text. Check `local_content_matches_all_submissions`, each
submission's registry match, every `resolved_target_refs` entry, and its quoted context. If content
or canonical identity is uncertain, quarantine rather than promote.

## 3. Review or quarantine one submission

Create a private JSON command such as:

```json
{
  "schema_version": 1,
  "operation_id": "feedback-review-20260901-0001",
  "occurred_at": "2026-09-01T10:00:00.000Z",
  "actor": {"kind": "maintainer", "id": "editor@example.test"},
  "action": "submission_reviewed",
  "article_key": "example.bg/article-123",
  "content_sha256": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "target_registry_sha256": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  "source_submission_ids": ["feedback-submission-id"],
  "reason": "Checked against the local article and its source registry."
}
```

Use `"action": "submission_quarantined"` when the evidence is stale, abusive or unresolved. Apply
the command with:

```sh
npm run news:feedback:apply-review -- --file /absolute/private/command.json
```

Retrying byte-equivalent intent with the same `operation_id` is idempotent. Reusing that ID with
changed intent fails. Do not edit Firestore records manually.

## 4. Accept an adjudicated result

An acceptance command may cite 1–100 reviewed/raw sources from this article. It freezes the final
feedback payload and binds each source to the registry under which the reader submitted it:

```json
{
  "schema_version": 1,
  "operation_id": "feedback-accept-20260901-0001",
  "occurred_at": "2026-09-01T10:15:00.000Z",
  "actor": {"kind": "maintainer", "id": "editor@example.test"},
  "action": "adjudication_accepted",
  "article_key": "example.bg/article-123",
  "content_sha256": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "analysis_sha256": null,
  "target_registry_sha256": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  "source_submission_ids": ["feedback-submission-id"],
  "source_target_registry_sha256s": {
    "feedback-submission-id": "sha256:1111111111111111111111111111111111111111111111111111111111111111"
  },
  "expected_task_revision": 1,
  "expected_adjudication_revision": 0,
  "feedback": {
    "leaning": {"label": "progressive", "evidence": "Quoted editorial evidence."},
    "russia_stance": null,
    "party_tones": [],
    "link_proposals": [],
    "issue_kinds": [],
    "public_note": null
  },
  "public_explanation": "Verified against the article and canonical registry.",
  "reason": "Accepted after editorial review."
}
```

`target_registry_sha256` must be the active article task's current registry. Historical hashes are
allowed only in `source_target_registry_sha256s`, and every one must have a matching archive. The
operator resolves the final selected entity/link references against the current registry; this is
the explicit carry-forward gate. Acceptance atomically writes the adjudication, promotes its source
submissions and appends audit events. For supersession, use a new operation ID and set
`expected_adjudication_revision` to the current accepted revision.

## 5. Export the accepted snapshot

```sh
npm run news:feedback:export-accepted
```

The snapshot validator rejects unknown fields, malformed provenance, more than 100 sources and
invalid operation IDs. An empty or malformed Firestore read cannot overwrite the last-known-good
file. Correct the source data and rerun; do not delete the prior snapshot as a recovery shortcut.

## 6. Apply and build model-improvement inputs

The ordinary app-data build automatically reads
`news/data/evals/feedback-accepted/current.json`. It never reads the raw submission export. Accepted
leaning, Russia and selected party/link decisions are overlaid in memory; original analysis JSON is
not rewritten. Before either publication or training, every selected evidence quote and link
surface/context is re-grounded in the frozen article text, duplicate normalized surfaces/party IDs
are rejected, and selected links must still exist in the freshly built current canonical target
registry. Archived registries prove historical provenance but never restore a removed target's
release eligibility. Accepted
issue kinds—including `missing_analysis`, `missing_topic` and `missing_sector`—are published only as
editorial provenance until an actual replacement value exists. Content drift withholds every
accepted change and marks the review for revalidation. Analysis drift withholds link/issue claims;
their badges and explanation are suppressed until re-adjudication, while content-grounded scalar
and party decisions can remain effective.

The analysis revision is one explicit pre-community-feedback baseline. The app-data build publishes
its hash beside each article, feedback tasks copy that hash instead of hashing a prior feedback
overlay, and the improvement builder recomputes it from the current raw analysis plus any formal
maintainer adjudication. Therefore job ordering and a previous public bundle cannot make stale
link/issue feedback current again.

Build the private improvement artifact with:

```sh
npm run news:feedback:build-improvement
```

The artifact is mode `0600` under `news/data/evals/feedback-improvement/`. It contains no raw
community records, source submission IDs, operator identity or visitor public note. Only
maintainer-accepted, content-current records become field-level targets; unresolved link/party
proposals and analysis-stale link/issue claims remain excluded rather than becoming weak canonical
truth. The manifest binds the current target-registry hash and each record retains only its accepted
source-registry hash—never source submission IDs.
