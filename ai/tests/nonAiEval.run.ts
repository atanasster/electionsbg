import { createHash } from "node:crypto";
// No model, network, credentials, database, or live tool execution.
import { mkdirSync, writeFileSync } from "node:fs";
import { nonAiResults, NON_AI_CASES } from "./nonAiEval";
const rows = nonAiResults();
const metrics = Object.fromEntries(
  (["en", "bg"] as const).map((lang) => {
    const xs = rows.filter((r) => r.lang === lang),
      annotated = xs.filter((r) => r.argScored);
    return [
      lang,
      {
        n: xs.length,
        toolAccuracy: xs.filter((r) => r.toolOk).length / xs.length,
        callAccuracy: xs.filter((r) => r.callOk).length / xs.length,
        argumentCases: annotated.length,
        argumentAccuracy:
          annotated.filter((r) => r.argsOk).length / annotated.length,
      },
    ];
  }),
);
mkdirSync("data/ai/evals", { recursive: true });
writeFileSync(
  "data/ai/evals/non_ai.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      provider: "Non AI / HeuristicProvider",
      scope:
        "Production deterministic routing stage, including previous-turn handling and election pinning. Argument validation is measured separately; no model normalization, tool execution or narration.",
      suiteHash: createHash("sha256")
        .update(JSON.stringify(NON_AI_CASES))
        .digest("hex"),
      caseCount: NON_AI_CASES.length,
      metrics,
      rows,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    { metrics, failures: rows.filter((r) => !r.callOk).length },
    null,
    2,
  ),
);
