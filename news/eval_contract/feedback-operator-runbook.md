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
