# News article evaluation contract

This directory is the language-neutral v1 contract shared by the public TypeScript API and
the offline Python news pipeline. `contract.json` is the registry of canonical values and
limits. The JSON Schemas distinguish the untrusted public submission request from the normalized
stored article evaluation, and also define an immutable operator event and versioned dataset
manifest.

The contract deliberately preserves the analysis vocabulary already used by the corpus.
Product copy may describe `progressive` as liberal/progressive, but persisted values must not
be renamed. Russia stance has its own six-value scale. Party tone is categorical and applies
to an article-party pair.

## Trust boundary

- A public submission is an untrusted community observation, not a correction or gold label.
- Only a local maintainer workflow may adjudicate or promote a submission.
- A complete evaluation explicitly assesses both scalar axes and the full meaningful party
  set. An empty `party_tones` array means “no meaningful party,” not “party work omitted.”
- The public request contains selected labels but no model-relative dispositions. The backend
  derives `confirmed`, `changed`, `added` and `unable_to_judge` against the hidden task snapshot
  before validating and storing `article_evaluation.schema.json`.
- Ambiguous party names may use a null `party_id`; the system must never guess an identity.
- Full article text, raw network identifiers, Turnstile tokens, browser IDs and abuse hashes
  are outside this contract and must never enter public or gold datasets.

## Versioning and hashes

Every boundary uses lowercase `sha256:<hex>` digests. Dataset entries bind a URL and content
hash; an analysis hash is optional only when no model analysis existed at selection time.
Changing a stored article's content invalidates an adjudication until it is revalidated. A
model rerun alone does not invalidate a human decision about unchanged content.

Canonical records use sorted object keys, UTF-8 Unicode-scalar strings, Unicode code-point
length and the ECMAScript JSON number spelling. Unpaired UTF-16 surrogates are rejected in
values, object keys and article content. Integer-valued numbers outside JavaScript's safe range
(`±(2^53-1)`) are rejected instead of being rounded differently by Python and TypeScript.
Party surface keys use trim + NFC + locale-independent lowercase in both runtimes.
`canonical.py` and `canonical.ts` are the only hashing implementations; the validators and
pipeline callers import them rather than maintaining another serializer.

Schemas use JSON Schema draft 2020-12. Dataset manifests bind both selection inputs and the
ordered frozen label records, and require a group ID for every split assignment. Semantic checks
that JSON Schema cannot express—such as duplicate canonical party IDs, scope-correct reason
codes, model-relative dispositions, matching statistics, and group leakage across dataset
splits—belong in the matching Python and TypeScript validators.

The `uri` format is deliberately narrower than generic JSON Schema URI: public source URLs
must be absolute HTTP(S) URLs without whitespace or embedded credentials. Timestamps use the
RFC 3339 calendar form `YYYY-MM-DDTHH:MM:SS[.fraction](Z|±HH:MM)` with real calendar dates.
Manifest entries and frozen records are positionally linked by `article_key` and by content or
analysis hashes whenever the record carries them; neither side may contain a duplicate key.
The public HTTP boundary derives its request limit from `limits.public_request_bytes`, rejects every
recognized route above that UTF-8 byte count before route-specific handling, and rejects any body on
aggregate GET requests. Article-key domains use lowercase ASCII DNS labels (canonical `xn--`
punycode is supported), with the DNS label and 253-character hostname limits enforced.

`public_abuse_controls` is the versioned no-login abuse policy. It fixes the expected Turnstile
hostname/action and its official 2,048-character, five-minute token boundary, plus generous
experimental caps. Client IP is explicitly unavailable: the Function ignores request/forwarding
addresses and omits Siteverify `remoteip` until the Hosting proxy topology is proven. A local
per-instance minute window protects Siteverify; browser-day and global counters provide anonymous
friction and are neither identity nor evidence that community agreement is correct. Short-lived
abuse/rate documents carry an `expires_at` timestamp and are excluded from every dataset export.
Opaque idempotency bindings and browser/article/task tombstones are durable and separately excluded
from datasets; HMAC rotation retains previous lookup keys until those records are migrated or
retired.
`community_aggregate_release.public_distribution_enabled` is false while browser nonce is the only
diversity hint; sample floors are reserved for a future independently protected release gate.

## All-article public feedback lifecycle

Every article in the published `news/app-data/articles/*.json` bundles receives an anonymous
feedback task, including articles that have no model analysis and articles outside the curated
benchmark. The public form can submit a partial observation: one or more scalar labels, independent
party-tone evidence, or a missing-analysis/link/topic/sector issue. Firestore remains closed to
browser access; the Function accepts the bounded request only after Turnstile and anonymous abuse
checks, and stores it in `news_feedback_submissions` with `status: raw`. Raw feedback never changes
published analysis and is not benchmark data until a maintainer adjudicates it offline.

The release order is strict: build app-data, build the curated eval-task manifest and the all-article
feedback-task manifest, publish app-data and advance its live manifest, verify every live article
bundle against the publication inventory, then synchronize both task registries. The feedback
manifest binds the exact sorted article keys and effective published-analysis hashes. Tasks written
in chunks remain inert until the final `news_feedback_sync/task_manifest` state activates that
public-data revision; rollback and same-revision drift fail closed.

The scheduled `eval_runtime.py task-build` and post-upload `task-sync` operations perform both
builds and both activations. Manual equivalents are `npm run news:feedback:tasks:write` and
`npm run news:feedback:tasks:sync`. Provision Firestore TTL on `expires_at` for
`news_feedback_abuse` and `news_feedback_rate` through `npm run provision:news:evals:ttl`; durable
dedupe and raw-submission records intentionally are not TTL collections. Operators should verify a
task through `GET /api/news-evals/feedback-task/:domain/:id` after activation. To roll back the
website, publish a new forward revision and rebuild/synchronize its task manifests—the registry
refuses timestamp rollback.

Canonical selections are release-bound references, not browser-authored profile claims. The public
request stores only `{kind,id}` plus the target-registry hash; canonical labels and routes are
resolved from the independently hashed `feedback-targets.json` during offline review. An unresolved
selection is explicit, and a replacement also records the current public href and an occurrence
context quote. Companies, institutions, people, parties, settlements and sectors are supported.
Every canonical entity link already emitted by a public article must occur in the registry or the
app-data build fails.

The private maintainer workflow is:

1. `npm run news:feedback:archive-targets` preserves the current release-bound registry under its
   content hash. Run it for every published registry before replacing `feedback-targets.json`.
2. `npm run news:feedback:export` writes a mode-0600, hashed JSONL export of raw feedback.
3. `npm run news:feedback:review-bundle` joins that export to full local article text and the current
   plus archived target registries, marking stale content and unknown selected refs. Each submission
   is resolved against its original registry rather than silently reinterpreted under the current one.
4. Prepare a strict `submission_reviewed` / `submission_quarantined` or
   `adjudication_accepted` command and run `npm run news:feedback:apply-review -- --file PATH`.
   Applying a command always revalidates its registry file, active feedback-task manifest, task
   revision, content/analysis hashes and source submissions in the same transaction. Acceptance
   records the registry hash for every source submission while validating the final canonical refs
   against the current registry.
5. `npm run news:feedback:export-accepted` writes the last-known-good accepted-feedback snapshot.
6. `build_app_data.py` consumes only that strict accepted snapshot. Content-current scalar, party
   and canonical-link decisions are applied in memory, all affected story/outlet/topic aggregates
   are recomputed, and `stats.json` binds the accepted record-set hash. A changed article keeps its
   model output and publishes only `needs_revalidation`; an accepted `missing_analysis` issue can be
   shown on an unanalysed article without manufacturing an analysis block. Selected evidence,
   surfaces and contexts are re-grounded in the article, duplicate selections fail closed, and only
   the freshly built current registry determines release eligibility; archives are provenance only.
   When the reviewed analysis changes, link/issue claims are withheld and their public badges and
   explanation are suppressed pending re-adjudication.
   Each article also carries the hash of its pre-community-feedback effective analysis; feedback
   tasks, subsequent publication builds and improvement generation all compare against that same
   baseline, never against a prior feedback overlay or yesterday's app-data.
7. `npm run news:feedback:build-improvement` produces the private, mode-0600 model-improvement
   dataset. It contains full text plus accepted field-level targets, excludes stale/missing articles,
   unresolved canonical proposals, raw submissions, source IDs, operator identity, public notes and
   quarantined/review-only observations. It uses the same grounding/current-registry validator as
   publication, excludes analysis-stale link/issue targets, and binds both the accepted source
   registry and the current eligible registry without exposing submission IDs.
   Empty reads and malformed records cannot replace a prior snapshot.

Review, acceptance, source promotion and audit-event append are atomic and retry-idempotent.
Accepted feedback remains separate from immutable model files: publication overlays are in-memory
only and the improvement dataset is explicitly `adjudicated` rather than community gold. Public HTTP
routes expose no review or adjudication capability.

The complete command shapes, carry-forward rules and recovery procedure are in
[`feedback-operator-runbook.md`](feedback-operator-runbook.md). All generated files under the
feedback-specific `news/data/evals/` directories are private, gitignored operator artifacts.

## Entity and canonical-link benchmark v2

Entity extraction is part of the benchmark, not an incidental field beside the political labels.
The v2 reference contract in `entity_link_reference_v2.schema.json` requires a complete list of
meaningful, unique `(kind, normalized surface)` pairs for each selected article. Repeated occurrences
of the same surface are one benchmark unit because the deployed entity-chip linker also makes one
article-wide decision for that surface; if occurrences refer to different identities, the correct
target is null. Each surface has an explicit canonical target or deliberate null refusal and an exact
quote that contains the surface. People, parties, institutions, companies, settlements and sectors
are covered. Candidate output is scored from its extracted `entities` plus the deterministic deployed
linker; the older `mentions` form remains a compatibility input, including `place` → `settlement`.

`npm run news:evals:entity-links:build` uses model/resolver signals only to draw a balanced 100-article
sample. It emits two separate artifacts: a blinded adjudicator manifest containing only article
identity and immutable grounding hashes, and a mode-0600 sampling audit under the gitignored private
eval directory. Predicted surfaces, IDs, candidate lists, resolved targets and per-article strata
never enter the adjudicator manifest. Every required sampling cell must fill; there is no silent
top-up. Benchmark v2 intentionally accepts exactly 100 articles because its seven published cell
counts are fixed; a differently sized revision must publish a new allocation contract.

The immutable original-primary and independent annotation directories each carry a strict
`_manifest.json` with distinct package and adjudicator IDs, the same blinded-run and frozen-registry
hashes, and a canonical record hash. Both adjudicators label every selected article without seeing
model suggestions. References use the exact root schema—extra model output fails validation—and
article grounding freezes URL, title, description and content. At least five labels and three
canonical links per entity kind, plus 100 independently comparable surfaces, are required. A
reconciliation artifact embeds every original disagreement and resolved value, binds both immutable
original and final primary hashes, and the validator independently proves the final primary is
exactly the original with those declared decisions applied. Run:

`npm run news:evals:entity-links:validate -- --supplement PATH --original-primary DIR --primary FINAL_DIR --independent DIR
--reconciliation PATH --target-registry PATH`

`npm run news:evals:entity-links:benchmark -- --supplement PATH --original-primary DIR --primary FINAL_DIR --independent DIR
--reconciliation PATH --target-registry PATH --candidate MODEL=DIR` reports extraction precision/recall, link decisions on matched surfaces,
canonical-target precision/recall, wrong-target and unsafe-link counts, and the same metrics by kind.
There is deliberately no F1 for links and no overall model score: a wrong identity assertion is not
exchangeable with a missing convenience link. Candidate release gates fail closed on missing v2
evidence, missing zero-label articles, unreadable/duplicate candidate records and under-supported
kinds. Thresholds use exact count ratios rather than rounded display values. The command exits
nonzero if any candidate is ineligible and requires zero wrong canonical targets and zero links on
adjudicated-unlinked surfaces.
