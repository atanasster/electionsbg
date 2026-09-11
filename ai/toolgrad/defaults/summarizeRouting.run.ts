import { readFileSync, writeFileSync } from "node:fs";
import { matchesExpected, explicitAbstention } from "./routingEval";
import { hash } from "../corpus";
import type { FreshCase } from "./routingCases";
import type { Route } from "../../orchestrator/router";
type Score = { rawOk: boolean; policyOk: boolean; rulesOk: boolean };
type Row = Score & {
  id: string;
  lang: string;
  group: string;
  raw: string;
  error?: string;
  rawParsed: Route;
  policy: Route;
  rules: Route;
  elapsedMs: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  originalScores?: Score;
};
type Report = {
  complete: boolean;
  cases: FreshCase[];
  rows: Row[];
  model: string;
  suiteHash: string;
  scoringHash: string;
  originalScoringHash?: string;
  rescoreReason?: string;
  calls: number;
  reservationCeilingUSD: number;
};
const root = "data/ai/toolgrad/defaults/";
const b: Report = JSON.parse(
    readFileSync(root + "routing-baseline/report.json", "utf8"),
  ),
  c: Report = JSON.parse(
    readFileSync(root + "routing-candidate/report.json", "utf8"),
  );
if (
  !b.complete ||
  !c.complete ||
  b.suiteHash !== c.suiteHash ||
  b.scoringHash !== c.scoringHash ||
  b.model !== c.model ||
  [...b.rows, ...c.rows].some((r) => r.error)
)
  throw new Error("Incomplete or incomparable run");
// Semantic scoring correction only: the production oblast resolver accepts
// Bulgarian qualifier suffixes. Preserve original scores and code hash.
for (const [variant, report] of [
  ["baseline", b],
  ["candidate", c],
] as const) {
  report.originalScoringHash ??= report.scoringHash;
  report.scoringHash = hash(
    readFileSync("ai/toolgrad/defaults/routingEval.ts", "utf8"),
  );
  report.rescoreReason =
    "Use production resolveOblast for equivalent province spellings; labels and raw responses unchanged.";
  for (const row of report.rows) {
    const expected = report.cases.find(
      (c: FreshCase) => row.id === `${c.id}:${row.lang}`,
    )!;
    row.originalScores ??= {
      rawOk: row.rawOk,
      policyOk: row.policyOk,
      rulesOk: row.rulesOk,
    };
    row.rawOk =
      !row.error &&
      (expected.tool === null
        ? explicitAbstention(row.raw)
        : matchesExpected(expected, row.rawParsed));
    row.policyOk =
      !row.error &&
      (expected.tool === null
        ? explicitAbstention(row.raw)
        : matchesExpected(expected, row.policy));
    row.rulesOk = matchesExpected(expected, row.rules);
  }
  writeFileSync(
    `${root}routing-${variant}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
}
const summary = (r: typeof b) =>
  Object.fromEntries(
    ["all", "city", "transfers", "control", "conversation"].map((g) => {
      const rows = r.rows.filter((x) => g === "all" || x.group === g);
      const times = rows.map((x) => x.elapsedMs).sort((a, b) => a - b);
      return [
        g,
        {
          n: rows.length,
          rawCorrect: rows.filter((x) => x.rawOk).length,
          policyCorrect: rows.filter((x) => x.policyOk).length,
          ruleCorrect: rows.filter((x) => x.rulesOk).length,
          medianMs: times[Math.floor(times.length / 2)],
          p95Ms: times[Math.ceil(times.length * 0.95) - 1],
          promptTokens: rows.reduce(
            (s, x) => s + (x.usage?.prompt_tokens ?? 0),
            0,
          ),
          completionTokens: rows.reduce(
            (s, x) => s + (x.usage?.completion_tokens ?? 0),
            0,
          ),
        },
      ];
    }),
  );
const result = {
  version: 1,
  suiteHash: b.suiteHash,
  baseline: summary(b),
  candidate: summary(c),
  calls: b.calls + c.calls,
  reservationCeilingUSD: b.reservationCeilingUSD + c.reservationCeilingUSD,
  billedUSD: null,
  scope:
    "Raw model selection and current parser/follow-on scores are separate. Both policy columns use current code; do not interpret them as an old/new runtime comparison. Rule-only failures include unsupported actions and are not claims that an action executes.",
  limitations: [
    "Fifty new hand-written questions, not real traffic or statistically independent task families.",
    "Same coding agent authored the suite; independent of the old synthetic dataset, not independent blinded authorship.",
    "Single run per prompt; no claims of statistical significance or end-to-end answer accuracy.",
    "Labels frozen before calls and unchanged after seeing outputs. Misses are retained.",
  ],
};
writeFileSync(
  root + "routing-summary.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
