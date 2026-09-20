# Phase 3.1 — the Jev contract, measured (2026-09-20)

Plan: `docs/plans/news-jev-realtime-cloud-worker-v1.md` Phase 3.1. Every
interface fact in the plan came from a **third-party** examples repo and the
model is absent from OpenRouter's public `/api/v1/models`, so nothing was
assumed. Probe: `news/scripts/probe_jev_contract.py`.

**Every figure below is derived from the committed fixture**
(`news/scripts/tests/fixtures/jev_contract.json`), which holds all three
probe sessions keyed by UTC stamp. 19 calls, 13 of them 200, **$0.00049942
in total**.

⚠️ An earlier draft of this file quoted latencies from one session's stdout
while the fixture held another's, and derived a tokens-per-character figure
that made the existing 24,000-character cap look like an exact match when it
is merely conservative. Both are corrected below. The rule this file now
follows: a number that cannot be recomputed from the fixture does not appear
in it.

## Confirmed as documented

| claim | verdict |
| --- | --- |
| `POST https://openrouter.ai/api/alpha/decisions` | ✅ |
| body `{model, state, questions}` posted as-is | ✅ |
| model `typesafe/jev-1.13` | ✅ |
| pinnable as `typesafe/jev-1.13-20260917` | ✅ **probed, not assumed** — the dated id is accepted and answers identically |
| $0.042/M input, output free | ✅ **exactly** — `usage.cost` equals `input_tokens × 0.042/1e6` to 8 dp on all 13 successful calls, with `output_tokens` billed at nothing |
| the existing `functions/jev_payload.js` request shape | ✅ accepted verbatim |

The response carries `answers`, `id`, `provider` (`TypeSafe`) and — usefully
— **`model`, the resolved id**. The alias currently resolves to the same
`…-20260917` the pin names, so a client can *verify which version answered*
rather than trusting the request. That matters because thresholds tuned on
one version need not hold on the next.

## Findings the plan does not have

**1. The three primitives return three DIFFERENT answer shapes, and `noul` is
the odd one.**

```
choice → {type, choice, probabilities{…}, confidence}
score  → {type, score,  legend{…}, probabilities{…}, confidence}
noul   → {type, noul: 0.99}            ← no confidence, no probabilities
```

⚠️ A client reading `answer["confidence"]` uniformly gets nothing on every
`noul` — and `noul`'s value **is** its probability, so treating a missing
confidence as "low confidence" would discard the answer exactly when it is
most certain. The confidence gate has to be per-type.

**2. Batching is a 56% cost saving, not a convenience.** The state is billed
once:

| | input tokens | cost |
| --- | ---: | ---: |
| three separate calls | 869 + 881 + 808 = **2,558** | $0.00010744 |
| one batched call | **1,116** | $0.00004687 |

So the pipeline should send one request per article carrying every question,
not one per question. It is also one round trip instead of three.

**3. Latency: 339–1,614 ms across 13 successful calls, median 405 ms.** Only
two exceeded a second — **the first two calls of the first session**
(1,614 and 1,286 ms), after which that session settled to 394 and 339 ms.
The advertised 70–500 ms is therefore the warm case only. Budget ~400 ms
warm, and expect a slow first call per session.

**4. Bulgarian costs ~0.92 tokens per character of JSON payload** (0.824–0.934
across the four shapes; the batched call is the cheapest per character
because the state is amortised). So the 32,000-token context is roughly
**32,000–39,000 characters** of this payload shape.

⚠️ The `stateChars: 24000` cap in `functions/jev_payload.js` is therefore
**conservative, with real headroom — not an exact fit.** An earlier draft
claimed it matched "to the character"; that was arithmetic error dressed as a
coincidence. Keep the cap, but keep it for its own reason (a bounded paid
payload), not because it equals the context window.

**5. A 400 is not "Jev is down", and the classes are distinguishable.** All
errors return `{error: {message, code}}`:

| probe | HTTP | ms | body |
| --- | --- | ---: | --- |
| unknown question type | 400 | 62 | Zod-style validation array naming the discriminator and the path |
| no questions | 400 | 65 | `"At least one question is required"` |
| state too large | 400 | 811 | `max_tokens_exceeded` — note it **tokenizes first**, so this one costs most of a second |

⚠️ This is the design constraint for 3.2. The plan says the client must treat
a schema change as "Jev unavailable" and fall through to GLM — but a 400 on a
*malformed payload of ours* is a bug, and falling through silently would hide
it for ever while paying GLM. The client must separate:

- **400 with a validation body** → our bug. Fall through to GLM **and report**.
- **404 / 410 / an unrecognised shape** → the alpha endpoint moved. Fall
  through quietly, as planned.
- **`max_tokens_exceeded`** → a third case: neither a bug nor an outage, but
  an article to trim or skip. It is also the slowest to discover.

## Accuracy on the one real article (not a benchmark)

The state was a real Bulgarian municipal-budget article. `choice` → `budget`
(correct, confidence 1.0); `score` → 3 of 0–4, "both sides presented"
(correct — the piece quotes the opposition and the committee chair, 0.98);
`noul` → 0.99 for "contains a specific monetary sum" (correct). Stable across
all three sessions. One article is an anecdote; 3.3's gold-set run is the
measurement.

## What this settles for 3.2

- Endpoint, model id, pinning, request shape and billing need no further
  verification.
- Send **one batched request per article**.
- Gate confidence **per answer type**; `noul` has none.
- Treat `max_tokens_exceeded` as its own class.
- Keep the endpoint and model id in config — the probe already reads
  `NEWS_JEV_URL` / `NEWS_JEV_MODEL` / `NEWS_JEV_MODEL_PINNED`, so the
  TypeSafe-direct fallback is a config change as the plan requires.
