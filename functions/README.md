# Наясно AI — cloud-LLM proxy (`functions/`)

A single Firebase Function (`llm`) that lets the chat use **hosted** models
(Gemini 3.1 Flash-Lite, Gemma 4 31B) via OpenRouter without putting the API key
in the browser. The chat is a static SPA, so the key must live server-side.

The model still only picks `{tool, args}` and writes prose from the tool's
**computed** facts — the numbers never come from the model. Rules (offline) and
the in-browser WebGPU models are unchanged; cloud is just extra options in the
picker. If the function is missing/unreachable, the chat falls back to the
deterministic router (proven in `ai/llm/openrouter.harness.ts`).

## How it's wired

- `functions/index.js` — the `llm` HTTPS function: origin allowlist, **model
  allowlist** (`ALLOWED_MODELS`), `max_tokens` cap, POST-only. Forwards to
  `https://openrouter.ai/api/v1/chat/completions` with the key.
- `firebase.json` — the `ai` hosting target rewrites `/api/llm` → the `llm`
  function, so the browser calls it **same-origin** (no CORS in prod).
- `ai/llm/openrouter.ts` — the browser provider; POSTs to `/api/llm`.
- `ai/llm/models.ts` — the two cloud entries (`runtime: "cloud"`). **Keep their
  ids in sync with `ALLOWED_MODELS` in `index.js`.**

## One-time enablement (operator)

The `electionsbg-ai` project must be on the **Blaze** plan (functions require it).

```bash
cd functions && npm install && cd ..

# 1. set the OpenRouter key as a secret (paste the key when prompted)
firebase functions:secrets:set OPENROUTER_API_KEY -P ai

# 2. deploy the function (+ the /api/llm hosting rewrite)
npm run deploy:ai:functions                  # = firebase deploy --only functions:llm -P ai
npm run deploy:ai                            # = firebase deploy --only hosting:ai -P ai
```

> The sibling `scenarios` function lives in the **same codebase** but deploys to
> the **`elections-bg`** project (the project gate in `index.js` exports exactly
> one function per target). Deploy it with `npm run deploy:functions`
> (= `firebase deploy --only functions:scenarios -P default`, gated behind the
> `functions/` unit tests).

Then in the chat, open the model picker and choose **Gemini 3.1 Flash-Lite** or
**Gemma 4 31B (free)**.

### Cost & abuse

The endpoint is public (it's behind a public SPA), so it can spend your
OpenRouter credits. Mitigations already in `index.js`: origin allowlist, model
allowlist, `max_tokens` cap (512), POST-only. **Strongly recommended on top:**

- Set a **hard monthly spend cap** on the OpenRouter key (or use a dedicated
  low-limit key just for this proxy).
- Enable **Firebase App Check** and verify the token in `index.js` — the real
  defence against scripted abuse.

Routing is ~1.5K input + ~30 output tokens; narration ~200. On Flash-Lite
(~$0.10/M in, $0.40/M out) that's ≈ $0.0002/question. Gemma 4 31B free is $0.

### Local dev

`npm run dev:ai` serves on :5180 with no function, so cloud models gracefully
fall back to rules. To exercise the live cloud path locally, set
`VITE_LLM_PROXY_URL` to the deployed function URL (its CORS allowlist includes
`localhost`), or run the Firebase emulator.

**Emulator scripts** (the project gate means each one loads exactly one
function — run them in separate terminals if you need both):

```bash
npm run emulator        # scenarios + Firestore, elections-bg project
                        #   → http://127.0.0.1:5001/elections-bg/us-central1/scenarios
                        #   emulator UI on http://127.0.0.1:4000
npm run emulator:ai     # llm only, electionsbg-ai project
                        #   → http://127.0.0.1:5001/electionsbg-ai/us-central1/llm
```

Ports (in `firebase.json` → `emulators`): functions `5001`, Firestore `8080`,
UI `4000`, hosting `5002`.

For `emulator:ai`, the `llm` function needs the OpenRouter key at call time.
The emulator reads it from **`functions/.secret.local`** (git-ignored), one
`KEY=value` per line:

```
OPENROUTER_API_KEY=sk-or-...
```

Without it the function still loads, but a request fails when it reads the
secret. To point the AI SPA at the emulator instead of prod, set
`VITE_LLM_PROXY_URL=http://127.0.0.1:5001/electionsbg-ai/us-central1/llm`.

The `scenarios` emulator writes to the **local** Firestore emulator (no prod
data touched); state resets on each restart. Unit-test the pure helpers with
`npm run functions:test`.

### Adding a cloud model

1. Add an entry to `ALLOWED_MODELS` in `index.js` (the OpenRouter model id).
2. Add a `{ runtime: "cloud", id: "<same id>", ... }` entry to
   `ai/llm/models.ts`.
3. Redeploy the function.
