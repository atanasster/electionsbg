# News evaluation Functions

This is the isolated Firebase Functions codebase for the public, no-login news evaluator on the
`electionsbg-news` project. It intentionally has no Cloud SQL or private-archive dependency.
Firestore access is Admin-SDK-only; `../firestore.rules` denies every direct client read and
write.

The initial `newsEvals` export is closed with a `503`/`no-store` response. Exact public routing,
validation and abuse controls are added in the following Phase 1 steps, so this scaffold cannot
accidentally expose a partial submission API.

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

Routine deployment is also explicit:

```bash
npm run deploy:news:evals # Functions + deny-all rules on -P news
```

Never run bare `firebase deploy --only functions` from the shared root configuration. It includes
multiple codebases and can deploy them to the wrong project. Use only the project- and
codebase-qualified scripts committed in the root `package.json`.

Do not grant this runtime access to `news/data`, the private article archive, Cloud SQL, or the
main Functions project's secrets. Public submissions are untrusted observations; later operator
tools export and adjudicate them locally.
