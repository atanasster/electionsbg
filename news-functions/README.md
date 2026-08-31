# News evaluation Functions

This is the isolated Firebase Functions codebase for the public, no-login news evaluator on the
`electionsbg-news` project. It intentionally has no Cloud SQL or private-archive dependency.
Firestore access is Admin-SDK-only; `../firestore.rules` denies every direct client read and
write.

`newsEvals` recognizes only `POST /api/news-evals/submit` and
`GET /api/news-evals/aggregate/:domain/:articleId`. It enforces exact production/emulator origins,
JSON media type, a 64 KiB request limit and the shared submission schema. Aggregate requests reject
all bodies. A configured runtime writes schema- and task-valid submissions in one Firestore
transaction; tests may omit the store adapter deliberately and then receive a fail-closed `503`.

The submit boundary now verifies every schema-valid request with Cloudflare Siteverify on the
server. A successful response must carry the exact `news.electionsbg.com` hostname,
`news-evaluation-submit` action and a fresh challenge timestamp. Tokens are never logged or stored.
The Function binds two Secret Manager values only to this codebase:

- `NEWS_EVAL_TURNSTILE_SECRET` — the private Siteverify secret;
- `NEWS_EVAL_HMAC_KEYRING` — a JSON object such as
  `{"active":"v2","keys":{"v2":"<32+ random bytes>","v1":"<previous key>"}}`, used for
  domain-separated anonymous abuse keys.

The Function deliberately does not trust `request.ip` or forwarding headers and omits Siteverify's
optional `remoteip`. Firebase Hosting's exact proxy chain must be proven by a P1.5 integration test
before any IP-derived control can be proposed. A fixed per-instance minute window protects the
Siteverify dependency itself; the persistent browser/global counters in the transaction layer are
the anonymous submission controls. This is rate-limit friction, not authentication.

Browser-day keys rotate by UTC day. Browser/article/task tombstones and idempotency records remain
durable across days so a retry or revisit cannot mint a second effective vote for the same task
revision. Their request fingerprint excludes the one-use Turnstile token and disposable retry keys,
but binds every semantic evaluation field. HMAC lookup uses the active key plus retained previous
keys. Add a new active version during normal rotation; do not drop an old version until every
durable record using it has been migrated or intentionally retired. No raw browser nonce,
idempotency key, evidence text or request body appears in derived keys or security metrics.

The transaction writes one append-only raw submission, durable opaque dedupe records, short-lived
rate/abuse sidecars and bounded materialized counters. The per-article aggregate contains only the
two scalar-axis maps and numeric totals. Party-tone counters live in separate
`news_eval_party_aggregates` documents keyed by article, task revision and a SHA-256 digest of the
canonical party key; each shard can therefore contain only one party identity and four tone
counters. Only parties already present in the trusted task snapshot receive online counter shards;
visitor-added identities remain in the bounded raw submission for offline review. This prevents an
anonymous client from minting durable shard IDs. Task model labels are projected through an exact
field/vocabulary allowlist before they enter either a submission or its public receipt, so extra
private task fields cannot leak through a malformed sync document. A task revision change starts a
fresh current aggregate instead of mixing labels from different article or analysis snapshots.
Exact idempotent retries return the original receipt and do not increment any counter. Persistent
daily-limit responses use the actual seconds until the next UTC-day bucket, while the separate
per-instance Siteverify-attempt limit retains its one-minute retry window.

```bash
npm run news:evals:test
npm run emulator:news:evals
npm run news:evals:test:emulator
```

The interactive command and integration gate use `firebase.news-evals-emulator.json`, a demo-only
Hosting → Function → Firestore stack. Its separate `news-functions/emulator-package` wrapper binds
deterministic fake Turnstile, clock and HMAC adapters only when all three guards hold:
`NEWS_EVAL_EMULATOR_ADAPTERS=true`, `FUNCTIONS_EMULATOR=true`, and a `demo-*` project ID. The
wrapper declares no production secrets. Production deploys continue to use
`firebase.news-evals.json` and `news-functions/src/index.ts`, where both Secret Manager values are
mandatory. Never deploy with the emulator config.

All news-eval Firebase scripts invoke the exactly pinned `firebase-tools@15.18.0`; CI installs that
same version and the isolated `news-functions/package-lock.json` before running them. This keeps
the debug CORS and body-parser behavior exercised locally identical to the CI gate.

Firebase does not filter emulator sources by a `functions:codebase` suffix, so do not substitute
the shared root `firebase.json`. The main and AI emulators have their own isolated configs for the
same reason.

The integration gate seeds Firestore through the Admin SDK, sends real requests through Hosting,
and verifies route near-misses, exact request-size limits, challenge failure, stale revisions,
accepted/idempotent/duplicate submissions, stored-data privacy, withheld aggregates and deny-all
browser rules. Two emulator framework behaviors sit outside the handler:

- the Firebase CLI's debug CORS wrapper answers a true foreign `OPTIONS` request with a reflected
  origin; the gate therefore proves that the corresponding foreign `POST` still reaches the
  application's origin check and is rejected. Pure handler tests pin the intended production
  preflight response: `403` with no allow-origin header;
- malformed JSON is rejected by Firebase's Express body parser before the handler runs. The
  integration gate pins the platform-level `400`, while pure handler tests own the stable JSON
  errors for requests that reach application code.

These are emulator observations, not permission to widen CORS or expose parser details. The gate
also deliberately keeps IP-derived controls disabled: local forwarding behavior does not prove
the production Hosting proxy's trusted client-address source.

## One-time Firestore provisioning

The selected database is Firestore Native/Standard in `europe-west3`, colocated with the Function,
with delete protection and point-in-time recovery enabled. Creation is an explicit, non-idempotent
operator action and is intentionally separate from routine deployment:

```bash
npm run news:evals:firestore:list
# Only when (default) is absent:
npm run provision:news:evals:firestore
npm run deploy:news:evals:rules
npm run provision:news:evals:ttl
npm run news:evals:ttl:list
npm run news:evals:firestore:list
```

The rules deploy requires the database to exist. Confirm the project shown by the CLI is
`electionsbg-news` before creation; a database location cannot be changed later.
The two TTL policies target the timestamp field `expires_at` in the `news_eval_abuse` and
`news_eval_rate` collection groups. The 72-hour value is the logical online expiry; Firestore TTL
deletion is asynchronous and typically occurs within another 24 hours, so code must stop using an
expired document immediately. Point-in-time recovery can retain recoverable versions for up to
seven days after deletion. Restrict PITR/restore and export IAM to operators, and make every export
tool omit live and recovered abuse collections. Durable opaque idempotency records and
browser/article/task tombstones live in `news_eval_dedupe` without TTL and remain excluded from
all datasets. The provisioning command exempts TTL timestamps from single-field indexing; rate
decisions address documents by exact key and never query by expiry.

Public aggregate distributions are explicitly disabled while the only diversity hint is a
client-resettable browser nonce. The backend may collect and aggregate for offline review, but the
GET route returns only a “more evaluations needed” state—without counts—until the contract enables
release after a trustworthy independent diversity control is proven. Enabling that future path
also requires an explicit, bounded read design for the revision-scoped party shards.

Before the first Function deploy, create the two project-scoped secrets interactively:

```bash
npm run configure:news:evals:secrets
```

Enter the keyring as valid JSON. Do not put either value in `.env`, emulator output, test fixtures
or deployment logs. Emulator tests inject fake verifier/HMAC adapters and do not need the
production values.

Routine backend deployment is explicit:

```bash
npm run deploy:news:evals # Functions + deny-all rules on -P news
```

The same-origin public path additionally depends on the Hosting rewrite in the root
`firebase.json`. For the first rollout, or whenever that rewrite changes, deploy the Function and
rules first and Hosting second:

```bash
npm run deploy:news:evals:public-route # backend first, then npm run deploy:news
```

The order is load-bearing: Hosting must not route public traffic to a Function that is not present.
Neither deployment command is part of the automated test/build path.

Preflight responses remain ordinary HTTP `no-store`, while `Access-Control-Max-Age: 600` permits
browsers to cache the fixed, uncredentialed CORS permission for ten minutes. This does not cache an
API response or widen the exact origin allowlist.

The P1.5 emulator gate exercises actual requests through Firebase Hosting—not only the pure
handler—including malformed JSON, route near-misses, a foreign-origin preflight and rejected
actual request, the 65,536/65,537 byte boundary, forwarded paths, final
cache/CORS/content-type headers, persistence and Firestore rules. It must remain green before any
public rollout.

Never run bare `firebase deploy --only functions` from the shared root configuration. It includes
multiple codebases and can deploy them to the wrong project. Use only the project- and
codebase-qualified scripts committed in the root `package.json`.

## Offline operator workflow

Review and promotion are local Admin-SDK operations, never HTTP routes. Use Application Default
Credentials for a dedicated news-eval service account with the minimum Firestore permissions; do
not reuse the public Function runtime identity. The commands are deliberately fixed to
`electionsbg-news` (a `demo-*` project is accepted only when `FIRESTORE_EMULATOR_HOST` is set).

```bash
npm run news:evals:export
npm run news:evals:review-bundle
npm run news:evals:apply-review -- --file /absolute/path/to/review-command.json
```

The export reads only `news_eval_submissions`, strips `abuse_ref` and every non-allowlisted field,
sorts by article key/time/submission ID, hashes the canonical record array and writes JSONL with
the Firestore read time. An unavailable, malformed or empty read never replaces the prior file.
Both the export and review bundle are atomically written with mode `0600` under gitignored
`news/data/evals/`. The review bundle groups individual evidence and community distributions with
the full locally archived article; it marks content-hash drift rather than hiding stale feedback.
Community counts are context and never preselect an answer.

A submission review command uses `submission_reviewed` or `submission_quarantined` and exactly one
source ID. An acceptance command uses `adjudication_accepted`, one or more non-quarantined source
IDs, the reviewed task revision and analysis/content hashes, the expected current adjudication
revision (`0` for the first), and a complete evaluation object. Example shape:

```json
{
  "schema_version": 1,
  "operation_id": "accept-20260831-article-0001",
  "occurred_at": "2026-08-31T12:00:00Z",
  "actor": { "kind": "maintainer", "id": "editor@example.com" },
  "action": "adjudication_accepted",
  "article_key": "example.bg/article-1",
  "content_sha256": "sha256:<64 lowercase hex characters>",
  "source_submission_ids": ["<submission UUID>"],
  "expected_task_revision": 4,
  "analysis_sha256": "sha256:<64 lowercase hex characters>",
  "expected_adjudication_revision": 0,
  "evaluation": { "schema_version": 1 },
  "public_explanation": "Editorial explanation after full-text review.",
  "reason": "Accepted after local editorial review."
}
```

The abbreviated `evaluation` above is only a shape illustration; the command validator requires
the complete shared article-evaluation schema. Acceptance rechecks the current task/content,
vocabularies, dispositions, party completeness, source states and revision, then atomically writes
the adjudication, promotion status and immutable audit event. Reusing an operation ID is allowed
only for an exact idempotent retry. Replacing an accepted adjudication also appends a supersession
event in the same transaction. Deferring requires no write: leave the item in the private review
bundle until a maintainer makes an explicit reviewed, quarantined or accepted decision.

Do not grant this runtime access to `news/data`, the private article archive, Cloud SQL, or the
main Functions project's secrets. Public submissions are untrusted observations; later operator
tools export and adjudicate them locally.
