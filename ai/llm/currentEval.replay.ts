// Re-score saved responses with today's production normalizer. No model calls.
// Keep the original run immutable; output a separate current baseline artifact.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  scoreProduction,
  summarize,
  type EvalCase,
  type EvalScore,
} from "./currentEval";
const source = process.argv[2];
if (
  !source ||
  !/^data\/ai\/evals\/runs\/[a-zA-Z0-9.-]+\/report.json$/.test(source)
)
  throw new Error("Provide an archived run report");
const run = JSON.parse(readFileSync(source, "utf8"));
if (!["baseline", "revised"].includes(run.label))
  throw new Error("Unknown evaluation variant");
const cases = new Map<string, EvalCase>(
  run.cases.map((c: EvalCase) => [c.id, c]),
);
const rows = run.rows.map((r: EvalScore) => ({
  ...r,
  ...scoreProduction(cases.get(r.id)!, r.lang, r.raw, r.error),
}));
if (rows.some((r: EvalScore) => r.error))
  throw new Error("Incomplete baseline cannot be published");
const artifact = {
  ...run,
  rows,
  metrics: summarize(rows),
  scoringVersion: "v2-production-normalization",
  scoringHash: createHash("sha256")
    .update(
      JSON.stringify(
        [
          "ai/llm/currentEval.ts",
          "ai/orchestrator/routeScope.ts",
          "ai/orchestrator/validateArguments.ts",
          "ai/tools/argumentCompatibility.ts",
        ].map((p) => readFileSync(p, "utf8")),
      ),
    )
    .digest("hex"),
  replayedAt: new Date().toISOString(),
  replaySource: source,
  groups: Object.fromEntries(
    [...new Set<string>(run.cases.map((c: EvalCase) => c.group))].map((g) => [
      g,
      summarize(rows.filter((r: EvalScore) => r.group === g)),
    ]),
  ),
  scope:
    run.scope +
    " Saved responses replayed through the current production normalizer; no new API calls. Raw selection remains scored separately from repaired usable calls.",
};
// A published artifact is a before/after record, so a replay must not replace one:
// re-scoring the SAME raw outputs under a newer normalizer is a DIFFERENT measurement
// (it is exactly how a scorer change shows up as a score change). The suffix keeps
// both, so the old record and the re-scored one can be compared.
const suffix = process.env.EVAL_REPLAY_SUFFIX ?? "";
const out = `data/ai/evals/current_${run.label}${suffix}.json`;
if (existsSync(out) && process.env.EVAL_ALLOW_OVERWRITE !== "1") {
  console.error(
    `REFUSING to overwrite ${out}. Set EVAL_ALLOW_OVERWRITE=1, or pass a different EVAL_REPLAY_SUFFIX.`,
  );
  process.exit(1);
}
writeFileSync(out, JSON.stringify(artifact, null, 2) + "\n");
console.log(`wrote ${out}`);
console.log(JSON.stringify(artifact.metrics, null, 2));
