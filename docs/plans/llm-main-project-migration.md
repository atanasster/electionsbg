# LLM API migration to elections-bg

The main project owns the `llm` function, three Secret Manager secrets and default Firestore `ai_usage` collection. The frontend defaults to `https://elections-bg.web.app/api/llm`, the stable main-project Hosting URL. `naiasno.bg` currently redirects to electionsbg.com and must not be used as the API transport while that redirect changes POST to GET. The main Hosting config adds that rewrite without changing article publication flags.

Cutover procedure: deploy the new function disabled; freeze the old Cloud Run revision with `AI_ENABLED=false`, wait for existing requests to finish, copy every usage document with typed Firestore fields intact into an empty target collection, and verify equality. Preserve the signing secret, counters, reservations, replay records and session records. Enable the main function only after copy verification. Never run independent active quota ledgers.

For production Hosting, clone the current live version and change only its API routing configuration; preserve all static files and existing rules. The article preview is not eligible for production. Route legacy `/api/llm` clients with a method-preserving temporary redirect to the main endpoint after verification. Keep the old function disabled. A rollback must stop new traffic and reconcile the authoritative ledger; do not reactivate an old snapshot.

Secrets are transferred in memory and verified without printing values. Quota backups stay in a restricted temporary directory, outside Hosting assets. Existing main Firestore client rules deny all access. Configure `ai_usage.expiresAt` TTL in the target project. Retain current budgets and existing Turnstile hostnames.

Validation and actual deployment identifiers are recorded below. No project deletion, domain change or article publication is part of this operation.

## Cutover evidence

Copied and verified all 30 `ai_usage` documents with typed fields preserved, after freezing the old service and draining its requests. Three secret values were transferred in memory and compared exactly. Main Firestore TTL on `expiresAt` is ACTIVE. The old service is disabled; there was no interval with two active ledgers.

Main Hosting retained all 162,584 paths with identical hashes: `ee3224614d0809ab` → `7b562cd3deaae777`. Legacy Hosting retained all 49 paths with identical hashes: `8454e01f222a333e` → `280c0222f11f68a2`. Only API routing changed; no draft article or new static page was published to production.

The stable endpoint returns OPTIONS 204 for the preview, 401 for an invalid session, 403 for an invalid real Turnstile token, and 403 for an untrusted origin. A real browser on the legacy site completed automatic Turnstile verification and a Gemini 3.5 Flash-Lite budget question in 4.8 seconds through the redirect; the response showed the 2026-07-31 reporting period. This verifies backend use, not every model answer's factual accuracy.

The legacy redirect is transitional, not a reason to keep the old endpoint in new bundles. Cached cross-origin callers may need a reload to use the new direct URL; null origins remain rejected. Do not weaken the origin policy for redirect compatibility.

Final Firebase deployment: `projects/elections-bg/locations/us-central1/functions/llm`, revision `llm-00003-baz`, ACTIVE with `AI_ENABLED=true`; all three secret references target elections-bg. The full functions suite and cloud-provider harness pass. The compiled chat chunk contains the stable main API URL and no `ai.electionsbg.com/api/llm` URL.

The final direct-API preview build/postbuild passed and the isolated channel was refreshed. The production main entry inspected at cutover had no ChatScreen chunk; production integration/announcement remains a separate release. After the API-only live routing changes and preview refresh had completed, the user instructed that no further Hosting deployments be made. No Hosting deployment was performed after that instruction.

Integrated direct-API verification passed after normal automatic Turnstile renewal: a real Bulgarian budget question returned Gemini 3.5 Flash-Lite narration in 4.6 seconds with the 2026-07-31 period and sourced table. Before renewal, the UI explicitly labelled its response No AI and requested verification, confirming fail-closed fallback. A direct probe of the old function still returned 503 `ai_unavailable`. Review has zero outstanding findings after one stale documentation sentence was repaired.
