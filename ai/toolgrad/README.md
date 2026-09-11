# ToolGrad-inspired civic chat pilot

This is an offline, answer-first dataset pilot for the existing one-tool chat.
It adapts ToolGrad's execution-before-question idea; it does not reproduce its
API-search algorithm or fine-tune the hosted model.

## Capture

```sh
node --import tsx ai/toolgrad/capture.run.ts data/ai/toolgrad/corpus.json
```

The 24 explicit workflows cover elections, procurement, people and municipal
data. Each runs in Bulgarian and English against real tool implementations,
local JSON files and the real DB route handlers on local PostgreSQL. DB queries
run in read-only transactions. PostgreSQL must already be populated. No ingest,
database migration or production write is performed.

Capture fails on invalid arguments, clarification, missing required facts or an
empty table/series. A genuine scalar zero remains valid. It writes only after all
48 executions pass, refuses to overwrite an existing artifact, and stores the
capture time, code commit, seed hash and input fingerprints. Per-capture `evidence`
lists fresh reads only. The shared `inputs` inventory includes all observed reads
across the run, including inputs reused by resolver/module caches on later calls;
it is deliberately not an exact per-call dependency graph. Re-capture to a new
path when code/data changes. Input hashes identify what was read; they do not
preserve the source bytes or make the multi-source capture atomic.

**Execution-verified is not independently fact-checked.** These checks establish
that the specified tool produces an answer with the required fields. A plausible
but incorrect source or aggregation still needs the existing data gates and
human interpretation review. Seed scope notes explicitly preserve distinctions
such as declared versus audited wealth, contracted versus paid money, and a
screening signal versus a finding of wrongdoing.

The captured corpus is a dated research artifact, not a source for live answers.
All runtime figures continue to come from tools.

Reference: [ToolGrad paper](https://arxiv.org/html/2508.04086v3) and
[official implementation](https://github.com/zhongyi-zhou/toolgrad).
