// Derive timings locally from retained requests, without new model calls.
import { readFileSync, writeFileSync } from "node:fs";
import type { evaluateQuestion } from "./harness";
import { distribution } from "./latency";
import { hash } from "../corpus";
type Row = Awaited<ReturnType<typeof evaluateQuestion>>;
const r = JSON.parse(
  readFileSync("data/ai/toolgrad/release/primary/report.json", "utf8"),
) as { complete: boolean; rows: Row[] };
if (!r.complete || r.rows.length !== 48)
  throw new Error("Incomplete primary run");
const answers = r.rows.filter((x) => x.routePass && x.response.env);
const accepted = answers.filter(
  (x) => x.deltas.length === 1 && x.calls.at(-1)?.sample,
);
const overhead = accepted.map((x) => {
  const c = x.calls.at(-1)!;
  return x.deltas[0].atMs - c.startedMs - c.sample!.elapsedMs;
});
const samples = r.rows.flatMap((x) =>
  x.calls.flatMap((c) => (c.sample ? [c.sample] : [])),
);
if (samples.some((s) => s.stream || s.firstTokenMs !== null))
  throw new Error("Unexpected streaming transport: review timing assumptions");
writeFileSync(
  "data/ai/toolgrad/release/latency.json",
  JSON.stringify(
    {
      version: 1,
      reportHash: hash(r),
      method:
        "Median averages the middle two samples; p95 uses nearest rank. No new requests. Provider duration starts after harness preparation; data fetches use in-memory fictional fixtures.",
      allQuestions: distribution(r.rows.map((x) => x.elapsedMs)),
      usableDataAnswers: distribution(answers.map((x) => x.elapsedMs)),
      clarifications: distribution(
        r.rows
          .filter((x) => !x.response.env && !x.blockedNarration)
          .map((x) => x.elapsedMs),
      ),
      withheldFailures: distribution(
        r.rows.filter((x) => x.blockedNarration).map((x) => x.elapsedMs),
      ),
      acceptedNarrationValidationTail: distribution(overhead),
      upstreamRequests: distribution(samples.map((s) => s.elapsedMs)),
      streamingRequests: 0,
      firstTokenLatency: null,
      limits: [
        "Operator direct-to-model requests exclude Firebase proxy, public authentication, browser rendering and live-data latency.",
        "Validation tail includes local promise/callback overhead, not isolated CPU profiling.",
        "Withheld failures are separated, not counted as fast successful answers.",
        "Single sequential sample; no SLO or production latency claim.",
      ],
    },
    null,
    2,
  ) + "\n",
);
