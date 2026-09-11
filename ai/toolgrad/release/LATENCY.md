# Latency assessment

The 48-question primary run measured the production provider orchestration with
in-memory fictional data and a direct operator connection to the same upstream
model. The provider's timer excludes harness preparation. These are local
integration timings, not measurements of the public chat website.

| Group | Samples | Median | p95 |
| --- | ---: | ---: | ---: |
| All questions | 48 | 1,390 ms | 1,593 ms |
| Correctly scoped data answers | 34 | 1,411 ms | 1,616 ms |
| Safe clarifications | 10 | 654 ms | 737 ms |
| Withheld failures | 4 | 729 ms | 784 ms |
| Accepted narration: completion-to-callback tail | 33 | 0.13 ms | 1.02 ms |

Correctly scoped data answers include prose-quality failures; that label does not
mean they passed the full-answer rubric. Withheld failures are shown separately
and are not credited as fast successful answers. The one narration rejection
falls back to a template and has no accepted-prose callback.

The cloud payload policy explicitly sets `stream:false`. All 82 requests in this
run were therefore non-streaming, even though the provider asks for streaming.
There is no observed first-token latency and no production token-stream baseline
to compare. The measured tail includes guard checks plus local promise/callback
overhead; it is not isolated CPU profiling. Its maximum was 6.19 ms. Requests,
not this tail, dominated time in this sample.

`data/ai/toolgrad/release/latency.json` contains the exact figures and source report
hash. `latency.run.ts` regenerates them locally. Median averages the middle pair;
p95 uses nearest rank. No new model calls were needed for this analysis.

This does not measure Firebase proxy overhead, public authentication, browser
rendering, live-source access or concurrent load. No latency SLO was specified.
The result supports retaining validation-before-display in this implementation;
it does not establish production performance or predict the effect of enabling
streaming later. The measurements precede the upcoming correctness repairs.
