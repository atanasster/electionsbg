# Fresh routing validation

Fifty new hand-written questions were frozen before API calls: 12 city/province,
12 transfer, 14 control and 12 conversation language variants. The same coding
agent authored them independently of the old generated dataset; this is not
blinded independent authorship or user traffic. The earlier pilot is unchanged.

The baseline uses the retained pre-default prompt; the candidate uses the shared
product defaults. Both are evaluated with the same current tool parser and
conversation resolver. Raw selections are reported separately so the benefit of
deterministic correction is visible. These are not old/new end-to-end runtime scores.

The initial scorer rejected the valid province spelling `Пловдив област`.
`resolveOblast` maps it to PDV, exactly like the expected province code. Scores
were recomputed with that production resolver, retaining original scores, source
hashes and raw responses. No question, expected tool or geographic scope changed.
The scorer also distinguishes PDV from PDV-00; this is not blanket name matching.

| Measurement | Old prompt | Clarified prompt |
| --- | ---: | ---: |
| Raw model call match | 39/50 | 40/50 |
| Current parser + conversation policy | 50/50 | 50/50 |
| Control cases after policy | 14/14 | 14/14 |
| Median request latency | 705 ms | 647 ms |

See `data/ai/toolgrad/defaults/routing-summary.json` for reproducible counts and
latency. The current policy resolves all city/province and transfer views in this
suite; raw model routing is weaker. The control cases and explicit abstentions
are separate from rule-only diagnostics. Rule-only routing is not the cloud
provider: it lacks the model's understanding of unsupported actions and some prose.

Reproduce in new output directories:

```sh
node --env-file=.env.local --import tsx ai/toolgrad/defaults/routing.run.ts baseline /tmp/defaults-base
node --env-file=.env.local --import tsx ai/toolgrad/defaults/routing.run.ts candidate /tmp/defaults-candidate
```

The committed run used 100 requests and a $3.10 reservation ceiling. Actual billed
cost was not returned; usage and timings are in the reports. Only generic civic
questions and public geographic names were transmitted, not captured records.
Single runs and correlated bilingual questions do not establish statistical
significance. Retain misses and use a fresh set before tuning another candidate.
