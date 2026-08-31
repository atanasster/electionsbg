# News evaluation Functions

This is the isolated Firebase Functions codebase for the public, no-login news evaluator on the
`electionsbg-news` project. It intentionally has no Cloud SQL or private-archive dependency.
Firestore access is Admin-SDK-only; `../firestore.rules` denies every direct client read and
write.

`newsEvals` recognizes only `POST /api/news-evals/submit` and
`GET /api/news-evals/aggregate/:domain/:articleId`. It enforces exact production/emulator origins,
JSON media type, a 64 KiB request limit and the shared submission schema. Aggregate requests reject
all bodies. Schema-valid submissions and aggregate reads still return `503` without touching
storage until the following abuse and transaction steps are complete.

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
npm run news:evals:firestore:list
```

The rules deploy requires the database to exist. Confirm the project shown by the CLI is
`electionsbg-news` before creation; a database location cannot be changed later.

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
