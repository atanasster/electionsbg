# Release validation plan (frozen before requests)

1. Freeze 48 primary and eight confirmation BG/EN questions, expected tool/scope,
   fictional numerical inputs, expected tool envelopes and narration rubrics.
   Include 20 separate guard probes with positive and negative expectations.
2. Run complete answers through the production cloud provider and tool registry,
   replacing only the data fetchers and authenticated operator transport. Review
   tool selection, source quantities, final prose, usefulness and language. Keep
   raw completions and guard rejection separate from final-answer correctness.
3. Report request-to-answer latency and post-completion validation overhead.
   Production payload policy forces non-streaming upstream responses: no
   first-token latency or streaming comparison will be manufactured. Public auth,
   Firebase proxy, browser rendering and live data-source latency are excluded.
4. Fix confirmed failures, rerun relevant regressions, evaluate the eight held-out
   confirmation questions, and issue a deployment recommendation. A repaired
   primary-set replay is development evidence, not unseen validation.

No deployment is authorized by this plan. No actual financial or personal records
are sent to the model. Geographic names identify scope, and all numerical values
are invented. The operator client uses the production payload policy and a maximum
of 128 requests per run; expected primary and confirmation use at most 112 total.
There are no automatic retries. Actual billed cost is unknown unless returned.

The coding agent authored these cases after inspecting earlier work. Their wording
is new; they are not blinded independent authorship or random samples of user
traffic. BG/EN pairs are correlated. Treat all model outputs as evaluation data.

Predeclared release criteria: no wrong-scope or unsupported-action answers; no
unsupported factual claims in final prose; useful requested values available in
the table or prose; no internal field identifiers in prose; correct requested
language. Record valid-prose rejection and invalid-prose acceptance separately.
Latency is descriptive: no user-specified SLO exists, and a small operator sample
cannot establish production performance. Failure counts are not silently removed.

Commands:

```sh
node --import tsx ai/toolgrad/release/freeze.run.ts
node --env-file=.env.local --import tsx ai/toolgrad/release/run.ts primary <new-directory>
node --env-file=.env.local --import tsx ai/toolgrad/release/run.ts confirmation <another-new-directory>
```

`freeze.run.ts` creates the manifest once and refuses replacement. `run.ts`
checks the frozen case/fixture objects before any request, records source hashes,
and refuses existing output directories. Prior ToolGrad artifacts remain intact.
The fixture integration verifies tool transformations, not the live database or
upstream collection. Unsupported fixture access fails closed rather than reading
real records or silently fetching the internet.
