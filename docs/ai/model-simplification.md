# AI chat simplification — 2026-09-10

The public picker now offers **No AI** and **AI assistant (Gemini 3.5 Flash-Lite)**.
Gemma, BgGPT and FunctionGemma remain development experiments, not public choices.
Saved 3.1 selections migrate to the new assistant; retired browser selections
return to No AI. Flash 3.8 is deferred until a representative evaluation demonstrates
an improvement that justifies another capability tier and its cost.

## Model decision and measured cost

`ai/llm/modelUpgrade.eval.ts` compared 3.1 and 3.5 through OpenRouter with the
production tool catalog, parser, JSON mode, output limits and provider price caps.
It used eight explicit routing questions in each language and two synthetic
narration fixtures in each language, including an irrelevant number in prior context.
No real user conversations were used. Raw responses and usage are retained in
`ai/llm/modelUpgrade.results.json`; they are evaluation evidence, not real civic data.

| Model          | BG routes + arguments | EN routes + arguments | Narration gates | Reported cost, 20 calls | Median call latency |
| -------------- | --------------------- | --------------------- | --------------- | ----------------------- | ------------------- |
| 3.1 Flash-Lite | 8/8                   | 8/8                   | 4/4             | $0.04101                | 945 ms              |
| 3.5 Flash-Lite | 8/8                   | 8/8                   | 4/4             | $0.04953                | 900 ms              |

These are small smoke tests, several close to prompt examples, **not a general
accuracy benchmark**. The narration gates test language and numerical grounding;
they do not establish full factual entailment. Human inspection found both models
expressed the supplied decline and avoided the distracting numbers. The English
responses sometimes added turnout/period framing beyond the minimal fixture;
keep deterministic computed facts and the existing narration rejection gates.

3.5 showed no regression in this sample, supporting the requested upgrade. This is
not evidence that it is materially more accurate. The recorded provider cost covers
model calls only, not infrastructure, verification, or payment fees. Bulgarian
routing prompts are about 58 KB; do not use a tiny generic prompt estimate to budget
this app. Production reserves a conservative maximum before admitting each question.

The operator context evaluator was adapted to use a local key directly and report
failure when no model was reached. Its additional live run was blocked by automatic
approval review because it would transmit local data-derived facts/context. It has
not been counted as passing. Existing mocked context/fallback checks passed.

## Reproduce

```bash
node --env-file=.env.local --import tsx ai/llm/modelUpgrade.eval.ts
```

This operator-only command sends public tool descriptions and synthetic questions
to OpenRouter using `OPENROUTER_API_KEY`, capped at 40 requests (conservative
reservation $1.24). It aborts on provider failure instead of scoring a fallback as
model success. It overwrites only the named result artifact. Historical
`fcEval.cloud.ts` also requires the local operator key; public chat authentication
has no operator bypass. The live context evaluator additionally sends local tool
results, so obtain authorization for that payload before running it.

## Enablement

The code is committed but not deployed. Follow `functions/README.md` to configure
Turnstile public/secret keys, a random signing secret, Firestore rules and TTL,
shared daily/monthly limits, and an independent provider-key spending limit.
Deploy the backend before the frontend and verify the actual widget and IP behavior
on the hosting path. No AI remains available when configuration is absent or usage
is exhausted. Turnstile alone is not a spending limit.

Sources checked 2026-09-10:

- https://openrouter.ai/google/gemini-3.5-flash-lite ($0.30/M input, $2.50/M output standard endpoints)
- https://openrouter.ai/docs/guides/routing/provider-selection (provider price caps)
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ (server verification)
