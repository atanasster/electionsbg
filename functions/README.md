# Наясно AI proxy

The public chat offers **No AI** and one hosted **AI assistant**. Historical browser
models remain in development evaluations only. Tools compute the numbers; the
model selects a tool and narrates its returned facts. Missing verification,
quota exhaustion and provider failures fall back to deterministic answers.

## Security and spending

`llm_http.js` is the public boundary; `llm_security.js` owns shared Firestore
transactions. POST actions are `session` (Turnstile Siteverify), `start` (reserve
a question), `complete` (consume one call), and `finish` (refund proven savings).
CORS is supplementary; calling the function directly does not bypass verification.
Siteverify validates hostname, action `ai_chat`, challenge age and replay. Signed
sessions expire after one hour and bind to a keyed hash of the platform client IP.
Tokens stay in browser memory. The database stores counters and hashes, not prompts.

Defaults: 20 questions/session/day, 60/IP/day, 3/session/minute, one active question
per session, 3 upstream calls/question, 120-second question lifetime. Session issuance
is limited to 5/IP/minute and 30/IP/day. Each call allows at most 96,000 UTF-8 bytes
of text messages and 512 output tokens; it has a 30-second timeout and no automatic
retry. The large input cap accommodates the actual Bulgarian tool catalog (~58 KB).

Before a question starts, transactions reserve $0.093 against **$5/day and $50/month**
UTC limits across all instances. Successful usage refunds savings against conservative
provider ceilings ($0.30/M input, $2.50/M output); failed/abandoned requests retain
uncertain costs. The reservation assumes at most one token per UTF-8 byte plus framing.
This is an application safeguard, not a cap on Firebase/Firestore charges or an
absolute billing guarantee. Use a dedicated Gemini API key from the paid elections-bg AI Studio project
(gen-lang-client-0866766809). Its billing account owns any eligible credits; the
Firebase function runs in elections-bg. Provider pricing changes require
reviewing bounds. Credit eligibility and expiry must be checked in AI Studio billing;
the application accounts for list-price usage even when credits cover the bill.

The browser cannot choose a different model, paid plugin, token budget or provider
price. The allowlisted model in `llm_security.js` must match `ai/llm/models.ts`.
Missing secrets, database failure, or `AI_ENABLED=false` fail closed for paid calls.

## Production setup (not performed by committing code)

Use the `elections-bg` Firebase project, on Blaze. Create its default Firestore
database in a suitable region if absent. Deploy the deny-all client rules using the
main-functions config; Admin SDK access uses IAM and bypasses those rules.

```bash
firebase functions:secrets:set GEMINI_API_KEY -P default
firebase functions:secrets:set AI_TURNSTILE_SECRET -P default
firebase functions:secrets:set AI_SESSION_SECRET -P default
```

Generate a random session secret of at least 32 bytes; never use a human password.
Create a Cloudflare Turnstile widget for the actual AI hostnames. Put its public
site key in the AI build environment as `VITE_AI_TURNSTILE_SITE_KEY`. Set these
nonsecret values in `functions/.env.elections-bg` (ignored):

```dotenv
AI_ENABLED=true
AI_DAILY_BUDGET_USD=5
AI_MONTHLY_BUDGET_USD=50
# Omit AI_TURNSTILE_HOSTNAMES to use the reviewed first-party list in llm_origins.js
```

```bash
firebase --config firebase.main-functions.json deploy --only firestore:rules -P default
gcloud firestore fields ttls update expiresAt --collection-group=ai_usage --database='(default)' --enable-ttl --project=elections-bg
npm run functions:test
npm run deploy:llm

```

Deploy backend protection before the matching frontend. Old open-proxy clients will
then stop making paid calls. Smoke-test valid verification, blocked direct calls,
expiry, allowance exhaustion and No AI fallback before announcing availability.
Configure Google billing alerts separately; alerts are not hard spending caps. Rotating
`AI_SESSION_SECRET` invalidates existing sessions and changes IP hashes; do not use
rotation to reset budget documents. Global day/month budgets remain unchanged.

## Local development and tests

`npm run dev:ai` works in No AI mode without configuration. For cloud development,
run `npm run emulator` (functions and Firestore), set `VITE_LLM_PROXY_URL` to
`http://127.0.0.1:5001/elections-bg/us-central1/llm`, and use a development
Turnstile widget permitting localhost plus `AI_TURNSTILE_HOSTNAMES=localhost`.
Keep local secrets in ignored `functions/.secret.local` using the three secret
names above. Never configure a test Turnstile secret on the production function.

`node --test functions/llm_security.test.js` tests verification, replay, quotas,
atomic reservations, refunds and the HTTP boundary using a transactional test store.
`node --import tsx ai/llm/openrouter.harness.ts` tests routing, context and fallback
with a mocked provider. These do not prove production IAM or widget configuration.

The backend calls Google directly through its OpenAI-compatible endpoint, with
`gemini-3.5-flash-lite` and `reasoning_effort: minimal`. The browser keeps its
existing `google/gemini-3.5-flash-lite` ID for compatibility with deployed clients.
No OpenRouter credits or key are used.

Gemini API compatibility: https://ai.google.dev/gemini-api/docs/openai
Turnstile validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

## Main-project migration

The main Hosting `/api/llm` rewrite targets `llm` in elections-bg. The legacy API uses a method-preserving temporary redirect to the stable main-project endpoint. See `docs/plans/llm-main-project-migration.md` for ledger-preserving cutover and rollback rules. Do not re-enable the old function or deploy an independent quota ledger.
