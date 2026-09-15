import { createHash } from "node:crypto";
// No model, network, credentials, database, or live tool execution.
import { mkdirSync, writeFileSync } from "node:fs";
import { nonAiResults, NON_AI_CASES, LEGACY_GROUPS } from "./nonAiEval";
const rows = nonAiResults();
type Row = (typeof rows)[number];
const summarize = (xs: Row[]) =>
  Object.fromEntries(
    (["en", "bg"] as const).map((lang) => {
      const l = xs.filter((r) => r.lang === lang),
        annotated = l.filter((r) => r.argScored);
      return [
        lang,
        {
          n: l.length,
          toolAccuracy: l.length
            ? l.filter((r) => r.toolOk).length / l.length
            : null,
          callAccuracy: l.length
            ? l.filter((r) => r.callOk).length / l.length
            : null,
          argumentCases: annotated.length,
          // `argsOk` is null on an unannotated row, so the explicit `=== true`
          // is what makes this a measurement rather than a truthiness accident.
          argumentAccuracy: annotated.length
            ? annotated.filter((r) => r.argsOk === true).length /
              annotated.length
            : null,
        },
      ];
    }),
  );
const metrics = summarize(rows);
// The floor denominator: the seven groups the suite shipped with. Reported beside
// the whole-suite numbers so adding the starter bank cannot silently restate the
// pre-registered floor on a different corpus.
const legacy = rows.filter((r) =>
  (LEGACY_GROUPS as readonly string[]).includes(r.group),
);
const legacyMetrics = summarize(legacy);
const caseGroups = [...new Set(NON_AI_CASES.map((c) => c.group))];
mkdirSync("data/ai/evals", { recursive: true });
writeFileSync(
  "data/ai/evals/non_ai.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      provider: "Non AI / HeuristicProvider",
      scope:
        "Production deterministic routing stage, including previous-turn handling and election pinning. Argument validation is measured separately; no model normalization, tool execution or narration. `argsOk` is null — not true — on a row with no annotated arguments, so argument accuracy is a ratio over `argScored` rows only. The `starter` group is a recall-tainted set (204 of 284 raw bank entries are verbatim registry examples) and is scored for TOOL and ARGUMENT accuracy only — never as a retriever-recall measurement.",
      suiteHash: createHash("sha256")
        .update(JSON.stringify(NON_AI_CASES))
        .digest("hex"),
      caseCount: NON_AI_CASES.length,
      caseGroups,
      metrics,
      legacyGroups: [...LEGACY_GROUPS],
      legacyMetrics,
      groups: Object.fromEntries(
        caseGroups.map((g) => [
          g,
          summarize(rows.filter((r) => r.group === g)),
        ]),
      ),
      rows,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      metrics,
      legacyMetrics,
      groups: caseGroups,
      failures: rows.filter((r) => !r.callOk).length,
    },
    null,
    2,
  ),
);
