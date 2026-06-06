# Наясно AI — cloud-LLM proxy (`functions/`)

A single Firebase Function (`llm`) that lets the chat use **hosted** models
(Gemini 2.5 Flash-Lite, Gemma 4 31B) via OpenRouter without putting the API key
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
firebase deploy --only functions -P ai
firebase deploy --only hosting:ai -P ai      # or: npm run deploy:ai
```

Then in the chat, open the model picker and choose **Gemini 2.5 Flash-Lite** or
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

### Adding a cloud model

1. Add an entry to `ALLOWED_MODELS` in `index.js` (the OpenRouter model id).
2. Add a `{ runtime: "cloud", id: "<same id>", ... }` entry to
   `ai/llm/models.ts`.
3. Redeploy the function.
