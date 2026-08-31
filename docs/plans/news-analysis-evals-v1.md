# Naiasno News — article-analysis evaluations v1

**Status:** proposed implementation plan, revised for public no-login evaluations, 2026-08-31.

## 1. Outcome

Build a public experimental evaluation system for the three article-level judgments that are
already central to the product, with an offline promotion gate for trusted changes:

- political framing (`leaning`);
- position toward Russia (`russia_stance`);
- treatment of each political party (`party_tones`).

Any visitor can open an experimental evaluation form, follow the original-source link,
explicitly confirm or change the three judgments, explain the decision, and submit it without
creating an account. A local editorial review step can promote useful public submissions into
an accepted decision. One accepted decision then has three deliberately separate uses:

1. **Publication correction:** the accepted human value overrides the model value in the next
   atomic news-data build, without destroying the model's original answer.
2. **Evaluation reference:** complete, adjudicated examples can be promoted into a versioned
   gold dataset used by the existing field-by-field benchmark tools.
3. **Model improvement evidence:** disagreement slices guide prompt, routing, model and
   calibration changes, which must still clear a held-out test set before release.

The v1 editor is a **public experimental contribution tool**, not a vote that directly rewrites
the site's analysis. Raw submissions form a community-feedback dataset and disagreement queue.
They do not become a published classification or gold label until a maintainer promotes them
through the offline review/export workflow. The existing `ReportIssueLink` remains the route for
broader factual corrections and rights-of-reply requests.

## 2. The recommendation in one diagram

```text
public article page + source link         model analyses (immutable originals)
                 |                                      |
                 +-----------> public eval API <--------+
                                      |
                       Firestore raw submissions
                         + community aggregates
                                      |
                       offline review / promotion
                                      |
                         accepted-snapshot exporter
                                      |
                    versioned adjudication JSON snapshot
                                      |
                effective-analysis resolver (build time)
                    /                               \
        public article/story JSON             eval benchmark input
        (human override wins)              (train/dev/sealed test)
```

The public React app remains a static reader. It never fetches an override independently at
render time: doing so could show a corrected article beside stale story aggregates. The hourly
pipeline applies one frozen adjudication snapshot before rebuilding all affected projections,
then advances the existing immutable public manifest only after reconciliation passes.

## 3. Current-state audit

Repository snapshot on 2026-08-31:

- `news/scripts/analyze_articles.py` validates and saves one JSON analysis per article and
  already computes review reasons after model validation.
- `news/scripts/analyze_local.py` records prompt/schema/model/request provenance for new runs.
- `news/scripts/build_app_data.py` turns the private corpus and analyses into public static JSON;
  it intentionally omits full article bodies.
- `newsapp/app/screens/ArticleScreen.tsx` already shows leaning and Russia labels, evidence,
  model confidence, model and analysis date.
- `newsapp/app/screens/StoryScreen.tsx` derives the two story distributions from member labels.
- `newsapp/app/corrections.ts` is a public GitHub reporting link and a hand-authored public log;
  it is not a structured write path.
- The repository has 5,853 stored articles and 1,826 analysis records. Of those, 1,461 carry
  current model provenance and party-tone v2; 465 already carry at least one deterministic
  `review` reason. There are 303 stored article-party tone pairs.
- The gold and scoring foundation exists: a 240-article reference set, a 100-political-article
  slice, party-tone supplement builders/validators, per-axis macro-F1 and ordinal kappa, and
  party-pair/tone metrics.
- The standalone pipeline archives full articles and analyses to private versioned GCS while
  publishing only derived app JSON. Evaluation and gold directories are intentionally excluded
  from that general archive flow today.
- The news Firebase project has hosting but no news-specific function or Authentication client.
  The existing Firestore rules deny all client access, which is the right default to preserve.

The missing layer is therefore not another classifier. It is a public, low-friction annotation
path plus a strict promotion boundary between untrusted community feedback and the existing
publication/evaluation tools.

## 4. Decisions and invariants

### 4.1 Public contributions, trusted promotion

No evaluator login is required. Anyone may submit one structured evaluation through the public
form after passing the abuse controls in section 9. The backend treats every such record as an
untrusted observation, even when several visitors agree.

Only an offline maintainer command using service-account credentials may:

- mark submissions as reviewed/quarantined;
- record an accepted adjudication;
- promote complete examples into a frozen gold revision;
- produce the accepted snapshot consumed by the public build.

This keeps participation public while preventing a party campaign, coordinated Russia-position
brigade or simple script from redefining the site's judgment. Firestore remains Admin-SDK-only;
browser rules stay deny-all and the public browser talks only to the narrowly validated Function.

### 4.2 Preserve the canonical vocabularies

Do not rename stored `progressive` to `liberal`. The existing prompt, validator, gold data,
scorer, public bars and historical records all use this ordered leaning vocabulary:

```text
strong_progressive, progressive, neutral,
conservative, strong_conservative, not_applicable
```

The Bulgarian editor copy may say “либерално/прогресивно рамкиране” if user testing prefers
that wording, but it maps to `progressive`. Russia labels likewise reuse the existing six-value
contract. A schema rename would invalidate comparisons without improving the judgment.

Party tone is not ordinal. It remains `favorable | unfavorable | neutral | mixed` on the
**article-party pair**.

### 4.3 Explicit confirmation is data

The system must record whether the public label:

- confirmed the model label;
- changed it;
- could not judge it;
- considered the axis not applicable.

The backend derives `confirmed` versus `changed` after submission; the pre-submit UI need not
reveal the model answer. Saving only disagreements creates a biased dataset containing mostly
hard model failures. A gold task is complete only when both scalar axes and the full party set
have been explicitly assessed, including “no meaningful party is present.” A later offline
editorial correction may be partial, but it is not gold until completed through adjudication.

### 4.4 Original, annotation and effective value are different facts

- **Original analysis:** immutable model output under `news/data/analysis/articles/**`, including
  model/prompt provenance.
- **Annotation:** what one evaluator submitted.
- **Adjudication:** the accepted reference decision.
- **Effective analysis:** a build-time projection in which accepted human fields override the
  original for public display and aggregate computation.

Never edit a model JSON file in place from the UI. Never copy the human label into a model block
while retaining the model confidence. Human-reviewed public fields set model confidence to
`null` and carry explicit review provenance instead.

### 4.5 Do not expose the private article archive

The public evaluator receives only material that the news app already publishes: title, outlet,
excerpt/summary, model evidence where appropriate, and a prominent link to the original source.
The private stored article body is not returned by the API. A visitor must read the publisher's
article in a separate tab before evaluating it.

This preserves the current copyright boundary: the corpus archives full text privately, while
the public product publishes short excerpts, analysis and links out. Full text is never copied
into Firestore, logs, analytics, public bundles or error payloads.

### 4.6 Hash every boundary

Each task and annotation binds to:

- `article_key = <domain>/<article_id>`;
- exact URL;
- `content_sha256` of the stored article body;
- `analysis_sha256` of the original analysis at annotation time;
- prompt/schema/model provenance when available;
- annotation schema version.

An accepted human label remains valid across a model re-run when the article content hash is
unchanged. If the source text changes, the adjudication becomes `needs_revalidation` and is not
silently applied to the new text. The public projection marks the affected axis “under review”
rather than reverting invisibly to the new model answer.

## 5. Backend architecture

### 5.1 Separate Firebase functions codebase

Create `news-functions/` as a second Firebase functions codebase, for example
`codebase: "news-evals"`, instead of adding the endpoint to `functions/index.js`.

This avoids deploying the main Cloud SQL `db` function and its secrets into the
`electionsbg-news` project. The new codebase needs only:

- `firebase-admin` for Firestore;
- `firebase-functions` v2 HTTP;
- a Firebase secret containing the Turnstile server key;
- small pure validation modules shared with tests.

Add a news-hosting rewrite from `/api/news-evals/**` to the `newsEvals` function and a specific
`no-store` header rule. Add dedicated scripts such as:

```json
{
  "deploy:news:evals": "firebase deploy --only functions:news-evals -P news",
  "emulator:news:evals": "firebase emulators:start --only functions,firestore -P news"
}
```

The function receives no private-archive permission. It validates submissions against compact
task documents and never needs the stored full article text.

### 5.2 Firestore collections

Use small index/state documents and append-only events; do not store full articles.

```text
news_eval_tasks/{articleKeyEncoded}
  article_key, domain, article_id, url, title, published
  story_id, primary_topic, outlet
  content_sha256, public_data_revision
  analysis_sha256, model, analyzed_at, prompt hashes
  model_labels (compact; no article text)
  review_reasons[]
  dataset_ids[]
  accepts_public_evals, revision, updated_at

news_eval_submissions/{submissionId}
  schema_version, mode: community
  task identity + hashes
  abuse_ref, submitted_at, base_task_revision
  field decisions, reason codes, optional public note
  status: raw | quarantined | reviewed | promoted

news_eval_abuse/{abuseRef}
  submission_id, created_at, expires_at

news_eval_dedupe/{opaqueLookupKey}
  kind: idempotency | browser_article_revision
  key_version, submission_id; request_fingerprint only for idempotency
  article_key + task_revision only on the article-scoped tombstone
  created_at; deliberately no expires_at / TTL

news_eval_aggregates/{articleKeyEncoded}
  valid_submission_count, distinct_browser_count
  per-axis label counts, party_pair_count
  model_disagreement_count, updated_at
  public_distribution_enabled: false until an independent diversity signal is proven

news_eval_party_aggregates/{articleKeyEncoded--taskRevision--partyKeyHash}
  article_key, task_revision, task-backed canonical party key + display snapshot
  four-value tone_counts, updated_at

news_eval_rate/{rotatingAbuseKey}
  scope: global | browser, day, submission_count, expires_at

news_eval_adjudications/{articleKeyEncoded}
  schema_version, task identity + content hash
  source_submission_ids[]
  operator_actor, adjudicated_at, revision
  effective field decisions
  public explanation/evidence
  status: accepted | needs_revalidation | superseded

news_eval_events/{eventId}
  immutable operator event envelope: actor, action, target, before/after hashes, timestamp

news_eval_datasets/{datasetId}
  purpose, rubric_version, selection_manifest_hash
  required fields, answer_visibility, status, current_revision
```

The backend never stores or trusts IP addresses, forwarding headers, Turnstile tokens or raw
browser IDs. IP bucketing stays disabled until the Firebase Hosting proxy topology is proven by an
integration test. Abuse keys are secret-keyed, versioned HMACs and are excluded from every public,
research and gold export. A browser ID is a disposable anti-duplication hint, not a person
identifier. Browser/article/task and idempotency tombstones are durable; only browser-day/global
rate sidecars use the 72-hour logical TTL. PITR can retain deleted sidecars for seven days, so
restore/export IAM stays operator-only and exporters omit both live and recovered abuse data.
The public aggregate endpoint withholds distributions and “strong community agreement” claims while
the only diversity hint is a client-resettable browser nonce; collection and offline adjudication
continue without presenting that hint as independent people.

### 5.3 Annotation shape

```ts
type ScalarDecision<L extends string> = {
  label: L | null;
  disposition: "confirmed" | "changed" | "unable_to_judge";
  evidence: string | null;
  reason_codes: string[];
};

type PartyDecision = {
  party: string; // snapshot of article wording
  party_id: string | null; // chosen only from canonical search results
  tone: "favorable" | "unfavorable" | "neutral" | "mixed";
  evidence: string;
  disposition: "confirmed" | "changed" | "added";
  reason_codes: string[];
};

type ArticleEvaluation = {
  leaning: ScalarDecision<Leaning>;
  russia_stance: ScalarDecision<RussiaStance>;
  parties_confirmed_complete: boolean;
  party_tones: PartyDecision[];
  removed_model_parties: {
    party: string;
    party_id: string | null;
    reason_code: "wrong_party_identity" | "party_not_meaningful" | "other";
  }[];
  public_note: string | null;
};
```

This is the normalized stored annotation. The public submission request omits all
model-relative `disposition` fields; the backend derives them from the hidden task snapshot and
does not trust a visitor to assert that a value confirmed or changed the model.

The party list and its tones are one atomic decision. Adding a party requires a tone; removing a
party removes its tone; duplicate canonical IDs are rejected. An ambiguous name may remain with
`party_id: null`, but the UI cannot guess an identity.

Human certainty, if collected, is a separate ordinal field and is never written into model
`confidence` or used as if calibrated probability.

### 5.4 HTTP contract

The browser reads the public task queue and article metadata from the same immutable app-data
version as the rest of the site. The Function exposes only two public-safe endpoints:

```text
POST /api/news-evals/submit
GET  /api/news-evals/aggregate/:domain/:articleId
```

`submit` requires JSON, an active task revision, a one-use Turnstile token, an idempotency key and
the structured evaluation. Server-side Turnstile validation is mandatory; checking the widget in
the browser is not protection. The function verifies hostname/action, exact article identifiers,
payload limits, task/content revision, label schema and abuse limits before writing anything.

The submission transaction reads the active task and rotating rate documents, refuses duplicates,
appends one raw submission and increments bounded aggregate counters. Party counters are stored in
fixed-size, task-revision-scoped party documents so user-supplied party surfaces cannot grow the
single per-article aggregate toward Firestore's document limit. Only identities already present in
the trusted task snapshot get an online shard; visitor-added parties remain in the bounded raw
submission for offline review. Model labels are projected through an explicit vocabulary/field
allowlist before storage or a public receipt. A changed task revision returns `409` so the visitor
reloads the current article rather than evaluating an old analysis; a newly active revision starts
a fresh current aggregate materialization. Persistent daily-limit responses identify the actual
next UTC-day reset rather than advertising the one-minute Siteverify-attempt window.

`aggregate` currently returns only a generic “more evaluations needed” state. Public counts and
distributions remain contract-disabled even above the numeric threshold because a resettable
browser nonce is not evidence of independent evaluators. A future release requires both an
explicit contract flag and a trustworthy independent diversity signal, plus bounded reads for the
party shards. It never returns individual notes, abuse hashes or submission IDs. Operator review
and adjudication use local Admin-SDK scripts, not a public HTTP endpoint.

The API applies the same label, party-coverage and evidence validation as the Python pipeline.
Put shared JSON Schema fixtures under a language-neutral directory and run parity tests against
both implementations so TypeScript cannot accept a record Python later rejects.

### 5.5 Task synchronization

Add `news/scripts/sync_eval_tasks.py` to run after a successful private archive upload. It scans
the local corpus/analyses and upserts compact task metadata for:

- explicit dataset selections;
- deterministic `review` reasons;
- strong labels and `likely_ai` if later added to the editor;
- model disagreements or stale adjudications;
- optionally a reproducible random quality-control sample.

It never uploads article text to Firestore. A task becomes active only when its article route and
analysis revision exist in the public immutable app-data version, so the form cannot collect
labels for a page readers cannot inspect.

The first rollout should sync one new reproducible community sampling batch plus selected current
review-router cases. Do not expose the sealed gold or party benchmark selections as public tasks.
There is no need to create 5,853 Firestore documents before the UI has proven useful.

### 5.6 Standalone hourly ordering

Wire the feature into the actual Mac-mini runtime, not only the repository build:

1. acquire and analyze articles;
2. export the latest accepted adjudication snapshot (or retain the last known-good one);
3. resolve effective analyses, recompute stories and build public bundles;
4. archive private corpus/analysis and publish the immutable public version as today;
5. only after the public manifest advances, sync new/changed eval task metadata whose article
   routes and analysis revisions are now live;
6. report eval-export age, accepted/stale counts and task-sync status in the combined hourly
   report.

This touches `news/scripts/run_nightly.sh`, `news/standalone/run_hourly.sh`,
`news/scripts/build_standalone_bundle.py`, bundle verification and the standalone env examples.
Use a dedicated news-eval service account for Firestore sync/export rather than extending the
public-uploader credential by accident. Missing eval credentials may disable task sync during the
initial rollout, but once promoted human overrides are enabled an expired accepted snapshot
beyond its SLA must alert and stop advancing the public manifest.

## 6. User interface

### 6.1 Public routes

Add public, no-login utility routes:

- `/evals` — queue/dashboard;
- `/evals/article/:domain/:id` — evaluator workspace.

They are noindex and excluded from the sitemap because they are a contribution tool rather than
editorial content. Prerender a purpose-built noindex shell so a direct URL never inherits the
homepage SEO head. Add a small “Help evaluate” entry point to article pages and, during the
experiment, an optional masthead/footer link; no account or profile surface is needed.

### 6.2 Queue

The queue is generated into public static app data and contains only already-public metadata.
It is for making the next useful contribution, not browsing internal review state. Provide:

- filters for political framing, Russia stance, party coverage, outlet, topic and date;
- public experiment/sampling-batch selector;
- optional filters for model review reason and current label;
- counts with denominators but no private submission status;
- deterministic ordering, client-side pagination and “evaluate a random article”;
- local “already evaluated on this browser” state and keyboard navigation.

Default priority:

1. strong labels and deterministic review-router failures;
2. model/community disagreement after the public threshold is met;
3. party-bearing and multi-party articles;
4. underrepresented label/topic/outlet strata;
5. a reproducible quality-control sample.

Do not rank by raw low confidence alone; `review_routing.py` already documents why that sends the
safe classes to review and misses consequential ones.

### 6.3 Article workspace

Use a calm public workspace that remains usable on mobile:

```text
+--------------------------------------+-------------------------------+
| public article context               | Your evaluation               |
| title / outlet / dates / excerpt     | Political framing: 6 choices |
| prominent “Read original” link       | Russia stance: 6 choices      |
| reminder to read source first        | Parties                       |
| model answer hidden until submit     |   GERB: 4 tone choices        |
|                                      |   + add / remove party        |
|                                      | Evidence + reason codes       |
+--------------------------------------+-------------------------------+
| Unable to judge | Submit evaluation | Submit and next                |
+----------------------------------------------------------------------+
```

The public mode visually hides model labels/evidence until submission to reduce anchoring, while
being honest that this is not a sealed blind experiment: the same model answer is public on the
ordinary article page and can be discovered. Community submissions are therefore never promoted
to sealed-test gold merely because the UI hid the answer.

A valid submission explicitly covers both scalar axes and the complete party set. “Unable to
judge” is available per field so a visitor is not forced to invent an answer. This records
confirmations as well as disagreements and avoids a corrections-only dataset.

For each scalar axis use an accessible radio group/segmented control, not a slider. Every choice
has its Bulgarian label plus a short rubric reminder; color is secondary. `not_applicable` and
`neutral` must be visually and textually distinct.

The party editor starts from detected/canonical parties, supports canonical search, and requires
one tone and evidence per retained party. The visitor may paste a short quote or write a concrete
paraphrase after reading the source; cap evidence length so this form cannot become a republishing
channel. `mixed` prompts for both directions; `neutral` prompts for the factual/balanced basis.

Autosave drafts only in local storage, show explicit offline/error states, warn before navigation
with unsaved changes, and support keyboard shortcuts without overriding browser or screen-reader
commands. Do not create server-side anonymous drafts.

### 6.4 Integration with the current article screen

For every eligible article, add “Help improve this analysis — experimental” near
`ReportIssueLink` on `ArticleScreen`. It opens the public workspace; do not turn the public
`AxisCard` itself into an in-place form.

After submission, reveal a field-by-field comparison with the model and explain that one public
response does not change the published analysis. During anonymous experimental collection, withhold
community distributions and “strong community agreement” because the disposable browser nonce is
client-resettable and no independent diversity signal is proven. The contract retains conservative
sample floors for a future release gate, but `public_distribution_enabled: false` is authoritative.
Collection may report only that more evaluations are needed. These controls deter casual
duplication; they do not prove independent people and cannot create gold truth.

After acceptance and the next data build, public axis cards show:

- human-reviewed label;
- reviewed evidence/explanation;
- “Reviewed by the editorial team” and review date;
- no model confidence on the overridden field;
- methodology/correction-history link.

Unchanged model fields retain existing model/date/confidence provenance. Party-tone presentation
continues under `news-party-tone-integration-v1.md`; this plan supplies the correction and gold
path it requires.

## 7. Applying adjudications to publication

### 7.1 Deterministic raw export and offline promotion

Add operator commands, for example:

```bash
python3 news/scripts/export_public_evals.py \
  --project electionsbg-news \
  --out news/data/evals/public-submissions/current.jsonl

python3 news/scripts/review_public_evals.py \
  --submissions news/data/evals/public-submissions/current.jsonl \
  --out news/data/evals/accepted/current.json
```

The raw export is deterministic: sort by article key/submission time, strip abuse-control fields,
include Firestore read time, schema/rubric versions, source hashes, record count and a SHA-256 of
the record set. Write to a temporary file, validate completely, then atomically replace the local
snapshot. If Firestore is unavailable or validation fails, retain the last known-good snapshot
and report staleness; do not emit an empty file.

The local review tool groups submissions by article, shows model labels, community distributions,
individual evidence and the full locally stored article, and lets the maintainer accept, revise,
defer or quarantine each field. Acceptance creates a separate adjudication record with source
submission IDs and hashes. Community majority is context, never an automatic default.

Accepted operational snapshots remain private pipeline state. Frozen dataset revisions promoted
for benchmarking are reviewed and committed under `news/data/gold/` with a manifest and hashes.

### 7.2 One effective-analysis resolver

Add one Python module used by both story recomputation and app-data generation:

```py
effective_analysis(base_analysis, article, accepted_adjudication)
```

It must:

1. verify article key, URL and `content_sha256`;
2. validate every adjudicated field with the production vocabulary/rules;
3. overlay only accepted fields;
4. attach `human_review` provenance and retain original model provenance separately;
5. mark content-hash mismatches as stale/withheld;
6. return a new value without mutating the on-disk model record.

Use it before `recompute_story()` and inside `build_app_data.py`. Rebuild every story touched by
an accepted or stale adjudication. Add an exact reconciliation gate:

- each public article value equals its effective source;
- every story leaning/Russia/party count equals its current effective members;
- no stale decision is counted;
- no model confidence survives on a human-overridden field;
- the accepted snapshot hash is recorded in build/release metadata.

Never patch `news/app-data/*.json` after generation.

### 7.3 Public correction history

Not every eval needs a public correction-log entry: a blind confirmation changes nothing. When
an accepted adjudication changes a value that was already public, generate a proposed public
entry containing page, field, old/new label, date and concise explanation. A maintainer must
approve the public wording before it enters `CORRECTIONS`; raw visitor notes never publish.

## 8. Turning annotations into a real eval dataset

### 8.1 Promotion, not automatic reuse

Keep three explicitly named layers:

1. **community submissions/aggregates** — untrusted observations used for disagreement and
   sampling;
2. **community weak labels** — optional high-agreement training candidates, never accuracy truth;
3. **adjudicated gold** — a maintainer/independent reviewer reads the frozen source and owns the
   reference decision.

Operational corrections and gold labels are different populations. A correction-only set is
selected because the model looked suspicious and will overstate the real error rate. Promote a
record into a named gold dataset only when it has:

- complete labels for leaning, Russia and party coverage;
- a matching frozen article content hash;
- rubric/schema version;
- an accepted offline adjudication independent of the public vote count;
- no unresolved conflict;
- selection provenance (random/stratum/review queue/etc.).

### 8.2 Dataset manifest and splits

Each frozen revision records:

```text
dataset_id, revision, purpose, created_at
selection manifest + hash
ordered frozen label records + hash
rubric/schema version
article keys + content hashes
label distributions and explicit missing/unjudgeable counts
community submission count/agreement (selection context only)
adjudicator overlap and agreement
train/dev/test membership
allowed uses and known selection bias
```

Every split-bearing entry requires a `group_id` for its `story_id` or near-duplicate/syndication
cluster; never split individual articles alone. Reports of the same event or copied wire text in
train and test would leak the answer. Stratify across
leaning/Russia labels, party tones, outlets and time after grouping.

Keep the test split sealed and never source it from the public evaluation form: visitors can see
the production answer elsewhere on the site, so the public workflow cannot provide a blind test.
Prompt examples and routing thresholds may use adjudicated train; model/prompt selection uses
dev; the sealed test is opened only for a release candidate. A used test revision is reported and
then superseded for future tuning.

### 8.3 Improvement loop

Use the dataset in this order:

1. export the frozen reference revision;
2. run the configured production model and candidates on the exact stored inputs;
3. score fields separately with the existing metrics:
   - leaning/Russia macro-F1, per-label recall, confusion and ordinal weighted kappa;
   - party-pair precision/recall, tone macro-F1/per-tone recall, identity and evidence gates;
4. inspect error slices by outlet, topic, quote/attack pattern, article length, provider and
   prompt/model version;
5. change one of prompt, few-shot examples, review routing or model;
6. rerun train/dev, then the sealed test only for the candidate to release;
7. stamp prompt/schema/model hashes in the next analysis run.

Do **not** automatically fine-tune on raw public submissions, community consensus or every
accepted correction, and do not inject them all into the prompt. That would mix coordinated or
noisy operational decisions with gold, leak test cases into tuning, and make regressions
impossible to attribute. If community weak labels are trialled, train on them as a separately
weighted source and measure the candidate only against adjudicated dev/test.

The first useful optimization is likely targeted few-shot/rubric repair using train-set
confusions, because the current pipeline already supports deterministic prompt hashes and model
benchmarks. Fine-tuning is a later decision only after the dataset is large, independently
adjudicated and license/privacy reviewed.

## 9. Security, privacy and abuse cases

- Require a fresh Turnstile token for every submission and validate it server-side. Tokens are
  single-use and expire after five minutes; verify expected hostname and action as well as
  `success`. Never log or store the token.
- Keep Firestore client access denied. The public Function is the only browser write path.
- Exact allowlist for news production origins and localhost test configuration; reject a present
  foreign origin and non-JSON form posts.
- Protect Siteverify with a per-instance fixed-minute attempt cap, and submission writes with a
  secret-keyed rotating browser-day HMAC plus a global emergency cap and one effective submission
  per article/browser/task revision. The browser hint is not identity and a determined visitor can
  replace it; this is abuse friction, not trust. Do not use an IP bucket until Hosting establishes a
  trustworthy address source.
- Require an idempotency key so a retry cannot create a second vote after the Turnstile token has
  already been consumed.
- Cap request size, evidence length, party count, note length and submissions per day. Reject
  unexpected fields before any Firestore write.
- App Check may be monitored or added as a second app-attestation layer, but it does not prove
  independent people and must not raise a community aggregate to gold status.
- Do not log request bodies, excerpts, evidence text, browser IDs, raw IPs or public notes.
- Keep rate metadata in a sidecar with a 72-hour logical expiry and exclude it from every export.
  TTL physical deletion may lag by about 24 hours and PITR can retain recoverable versions for up
  to seven days. Preserve durable opaque idempotency and article/browser/task tombstones outside
  TTL, never in a dataset export.
- `no-store` on submit responses; no analytics on form contents. Public thresholded aggregate
  responses may use a short cache tied to the task revision.
- Audit every offline promotion, rejection and supersession. Raw anonymous submissions remain
  append-only apart from documented abuse-metadata expiry.
- Back up Firestore/export snapshots independently. Append-only events are the recovery source;
  current-state documents are rebuildable materializations.

Turnstile's client widget alone is insufficient; server validation is mandatory. See Cloudflare's
[Siteverify documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
Firebase App Check can protect a custom backend without sign-in, but remains supplementary
attestation rather than evaluator identity; see the
[Firebase custom-resource guide](https://firebase.google.com/docs/app-check/web/custom-resource).

## 10. Implementation sequence

Each step ends with focused tests and a reviewable commit; no public rendering flag is enabled
until the effective-analysis reconciliation gate exists.

### Phase 0 — contracts and fixtures

1. Define vocabularies, annotation schema, event envelope, reason-code registry and dataset
   manifest under a shared `news/eval_contract/` directory.
2. Add cross-language fixtures: valid complete gold, partial correction, confirm unchanged,
   unable-to-judge, no-party, multi-party, ambiguous party, stale content and conflict.
3. Add Python and TypeScript validators and a parity test over the same fixture corpus.
4. Add `content_sha256` and `analysis_sha256` helpers with canonical JSON serialization tests.

### Phase 1 — public backend and abuse boundary

1. Scaffold `news-functions/` as the isolated Firebase codebase and provision Firestore in the
   `electionsbg-news` project with deny-all client rules.
2. Implement exact routing, schema validation, errors and no-store/CORS behavior.
3. Implement server-side Turnstile verification, versioned-HMAC rate limits, idempotency and
   abuse-metadata retention.
4. Implement transactional submission/dedupe/aggregate writes and thresholded aggregate reads.
5. Add Firestore/functions emulator tests with fake Turnstile and clock/HMAC adapters. Use a
   separate `demo-*` Hosting → Function → Firestore configuration whose wrapper has no production
   secret declarations, and gate route, byte-limit, persistence/privacy, idempotency, aggregate
   withholding and deny-all browser-rule behavior. Keep pure-handler CORS assertions because the
   Firebase CLI debug wrapper reflects foreign preflights before application code; require the
   corresponding foreign actual request to fail at the application origin gate. Treat malformed
   JSON as a platform-level `400` because Firebase's parser runs before the handler.
6. Add local Admin-SDK export/review/promotion commands; expose no adjudication HTTP endpoint.
   The raw JSONL export is allowlisted, sorted and record-set hashed, refuses an empty/invalid read
   so the last-known-good file survives, and is replaced atomically with mode `0600`. Build the
   review bundle only from that validated snapshot plus the full local article archive. Apply
   strict maintainer command manifests in one transaction with the immutable event: stale content,
   revision conflicts, quarantined sources and operation-ID reuse all write nothing.

### Phase 2 — task sync and public UI

1. Implement `sync_eval_tasks.py`, the static public queue projection and dry-run/report modes.
   Intersect every requested task with one coherent public app-data revision, refuse sealed/gold
   selections and empty/oversized manifests, derive a stable task revision from content, analysis
   and compact labels, then write the private hashed manifest and public queue without activating
   anything. The queue is written first and the private manifest last as its local commit marker;
   the manifest binds the queue's canonical hash. Only after that exact public app-data revision is
   live, verify the stable public release pointer, immutable queue byte inventory and canonical
   queue hash, then send the manifest through an Admin-SDK transaction that activates the desired
   set and deactivates stale tasks without deleting history. Refuse rollback to an older or
   conflicting public revision, derive the task revision independently on both sides, and exclude
   membership from the authoritative sealed gold/party-benchmark artifacts on every selection
   path.
2. Add noindex public eval routes with no Auth dependency. The queue hub is always prerendered,
   while one purpose-built article shell is derived for each task in the coherent public
   `evals/queue.json`; both families set `noindex,follow` and `sitemap: false` so a direct task URL
   cannot inherit the homepage head. A present queue is validated fail-closed against its schema,
   rubric, count, task identities and current public-data revision. Hosting routes any unqueued or
   deployment-skewed `/evals/article/**` URL to a generic prerendered noindex fallback before the
   homepage catch-all. The React route layer renders without an Auth provider, login/profile
   surface or private article fetch. Route analytics collapse both paths to one low-cardinality
   `evals` value and never include article identity.
3. Build queue filters, random sampling and the responsive article workspace. The browser reads
   only the strict public queue projection, orders review/strong-label/party-bearing tasks
   deterministically, and supports combined axis, party-presence, date, outlet, topic, dataset and
   review-field filters with client pagination plus random choice from the filtered result. The
   article workspace uses only the public article excerpt and original/public-analysis links,
   stacks on mobile and splits context from a sticky evaluation panel on desktop. All scalar and
   party controls start unselected, support an explicit unable/no-party answer and local party
   add/remove, and remain local-only until the submission step is wired.
4. Add visually hidden-until-submit model comparison, local-only draft autosave, Turnstile and
   keyboard/accessibility support.
5. Add the public experimental link on eligible `ArticleScreen` pages.

### Phase 3 — export and publication overlay

1. Implement deterministic raw export, offline review/promotion, accepted-snapshot export and
   last-known-good behavior.
2. Implement the shared effective-analysis resolver.
3. Apply it to story recomputation and `build_app_data.py`.
4. Add public human-review provenance and stale/under-review rendering.
5. Add article/story/party aggregate reconciliation and release-manifest hash.
6. Generate proposed public correction-log entries for already-published changes.
7. Wire export/task-sync ordering, credentials, reports and failure policy into the standalone
   bundle/runtime.

### Phase 4 — eval promotion and feedback loop

1. Build a new reproducible public sampling batch; do not expose or relabel the sealed existing
   gold selections as community tasks.
2. Run a public pilot, export raw submissions and report completion, disagreement, duplication,
   quarantine and per-stratum coverage without calling agreement accuracy.
3. Review/promote a subset offline using the locally stored full articles, then complete at least
   the already-planned 50 independent party-pair overlap for gold use.
4. Export a versioned adjudicated dataset, group-aware splits and agreement report; keep raw
   community and weak-label artifacts separately named.
5. Extend benchmark commands to select fields and frozen dataset revision explicitly.
6. Produce the current-model baseline, trial prompt/routing changes on train/dev and run one
   sealed release evaluation.

### Phase 5 — rollout

1. Deploy the public Function with no UI entry point; test production Turnstile, origin, rate,
   idempotency and Firestore-deny behavior.
2. Deploy `/evals` to a Firebase preview and complete a small real anonymous submission batch.
3. Audit Firestore records, abuse-metadata retention, deterministic export, stale-task behavior
   and private-text non-leakage.
4. Enable accepted-overlay generation in dry-run and compare affected article/story JSON.
5. Enable the overlay in a preview public data version; reconcile every changed label/count.
6. Promote the exact verified news hosting version and initially enable the CTA only for one
   reproducible article sample before expanding it.

## 11. Test and release gates

### Backend

- missing/invalid/expired/replayed Turnstile token -> rejected before Firestore write;
- wrong Turnstile hostname/action or present foreign origin -> rejected;
- invalid domain/ID/path traversal -> 400/404 without private storage lookup;
- direct Firestore browser access -> denied;
- Siteverify attempt, browser/global limits and duplicate article submission -> 429/duplicate
  response;
- idempotent retry returns the original result without incrementing aggregates twice;
- low-sample aggregate remains private and public response says only “more needed”;
- raw public submissions cannot call or manufacture an accepted adjudication;
- local promotion refuses a stale content hash;
- revision conflict -> 409 and no partial event/state write;
- event append and current-state update are atomic;
- full text absent from Firestore, logs and response errors;
- submit responses are `no-store`; aggregate cache varies by task revision.

### Data and pipeline

- TypeScript/Python schema parity;
- explicit confirmations exported, not only changes;
- partial correction excluded from gold promotion;
- exact party/entity coverage and no duplicate party IDs;
- content change marks accepted decision stale;
- model rerun with unchanged content does not erase accepted decision;
- original model JSON remains byte-for-byte unchanged;
- article/story/topic/outlet aggregates reconcile to effective values;
- failed eval sync/export retains last good public manifest and snapshot;
- train/dev/test have no shared story or near-duplicate cluster;
- benchmark output names dataset revision and prompt/model hashes.

### UI and accessibility

- public evaluation works without an account, cookies from an identity provider or profile setup;
- the form does not visually reveal model labels before submission and does not claim sealed
  blindness;
- keyboard-only completion of both axes and party tones;
- radio-group names and descriptions communicate labels without color;
- neutral versus not-applicable and no-party versus unassessed are distinct;
- local autosave, offline/error, Turnstile expiry, 409 reload and unsaved-navigation states;
- short evidence/paraphrase and multi-party add/remove behavior;
- light/dark contrast and layouts at 390, 768 and 1440 px;
- eval route is noindex and absent from the sitemap.

Run the existing news gates plus the new function/emulator suite:

```bash
npm run news:test
npm run typecheck:news
npm run build:news
npm run news:perf:gate
npm run news:release:gate
npm --prefix news-functions test
npm run news:evals:test:emulator
```

## 12. Definition of done

- Any visitor can complete a structured evaluation without an account, using only already-public
  context and the publisher's original-source link; the private archived body is never exposed.
- Every raw submission is anonymous, versioned, deduplicated as far as the abuse controls permit,
  conflict-safe and bound to an exact task/content revision.
- Community distributions remain separately labelled, thresholded and incapable of automatically
  changing publication or gold truth.
- Accepted decisions override only selected public fields in the next atomic build; original
  model output and provenance remain intact.
- All affected article and aggregate JSON reconciles exactly, and stale decisions are visible
  rather than silently reverted or counted.
- Offline-reviewed complete adjudications can be frozen into a hashed, group-split gold revision
  with explicit selection provenance and independent-review agreement.
- Prompt/model changes are chosen on train/dev and pass a named sealed test revision before they
  replace production analysis.
- Public issue reporting and public evaluations remain open, while only offline promotion can
  alter publication or eval truth.

## 13. Why this backend, not the tempting alternatives

- **Not direct edits to analysis JSON:** loses concurrent-write protection and blurs model versus
  human provenance.
- **Not evaluator login in v1:** account creation would suppress participation during the public
  experiment; the trust boundary belongs at offline promotion rather than form access.
- **Not browser-to-Firestore writes:** duplicates validation in security rules and exposes a much
  larger client data surface; the function is the one authority.
- **Not the main Postgres/`db` function:** couples a small editorial workflow to Cloud SQL,
  cross-project secrets and the public read API without needing relational query scale.
- **Not GitHub issues as the dataset:** good public intake, poor structured annotation, identity,
  conflicts and reproducible export.
- **Not a runtime override API on public pages:** produces article/story inconsistency and makes
  the static release manifest cease to describe what readers see.

Firestore fits the small, append-heavy, transactional contribution workload; the private GCS
archive is available only to the local pipeline/reviewer, while the public Function sees no full
text; the existing static builder remains publication authority. Firebase documents the supported
multiple-functions-codebase and serializable-transaction pieces; Turnstile supplies the no-login,
single-use submission challenge. None of those mechanisms turns anonymous visitors into trusted
adjudicators, which is why promotion stays offline.
