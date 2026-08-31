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
```

The emulator command uses `firebase.news-evals.json`, which contains only this source. Firebase
does not filter emulator sources by a `functions:codebase` suffix, so do not substitute the shared
root `firebase.json`. The main and AI emulators have their own isolated configs for the same
reason.

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

The P1.5 emulator gate must exercise actual requests through Firebase Hosting—not only the pure
handler—including malformed JSON, route near-misses, rejected preflight origins, the 65,536/65,537
byte boundary, forwarded paths, and final cache/CORS/content-type headers. Storage must remain
closed until that integration gate passes.

Never run bare `firebase deploy --only functions` from the shared root configuration. It includes
multiple codebases and can deploy them to the wrong project. Use only the project- and
codebase-qualified scripts committed in the root `package.json`.

Do not grant this runtime access to `news/data`, the private article archive, Cloud SQL, or the
main Functions project's secrets. Public submissions are untrusted observations; later operator
tools export and adjudicate them locally.
