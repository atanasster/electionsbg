import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { FOLLOWUP_CASES } from "./followupCases";
import { hash } from "../corpus";
import { verifyFrozenSources } from "./preflight";
import { ReleaseClient } from "./client";
import { evaluateQuestion } from "./harness";
const dir = "data/ai/toolgrad/release/followup";
const manifest = JSON.parse(
  readFileSync("data/ai/toolgrad/release/followup-manifest.json", "utf8"),
);
const original = JSON.parse(
  readFileSync("data/ai/toolgrad/release/manifest.json", "utf8"),
);
verifyFrozenSources(original.sourceHashes);
if (
  hash(manifest.cases) !== hash(FOLLOWUP_CASES) ||
  manifest.sourceHash !==
    hash(readFileSync("ai/toolgrad/release/followupCases.ts", "utf8"))
)
  throw new Error("Frozen follow-up cases changed");
mkdirSync(dir);
const client = new ReleaseClient(process.env.GEMINI_API_KEY ?? "", 8);
const meta = {
  ...manifest,
  sourceHashes: Object.fromEntries(
    [
      "ai/orchestrator/router.ts",
      "ai/orchestrator/prompts.ts",
      "ai/llm/semanticGrounding.ts",
      "ai/llm/factBindings.ts",
      "ai/toolgrad/release/harness.ts",
    ].map((p) => [p, hash(readFileSync(p, "utf8"))]),
  ),
};
writeFileSync(`${dir}/manifest.json`, JSON.stringify(meta, null, 2) + "\n");
const rows = [];
for (const c of FOLLOWUP_CASES)
  for (const lang of ["bg", "en"] as const) {
    rows.push(await evaluateQuestion(c, lang, (m, o) => client.complete(m, o)));
    writeFileSync(
      `${dir}/report.json`,
      JSON.stringify(
        {
          ...meta,
          complete: rows.length === 4,
          calls: client.calls,
          reservationCeilingUSD: client.reservationCeilingUSD,
          rows,
        },
        null,
        2,
      ) + "\n",
    );
  }
if (rows.some((r) => r.calls.some((c) => c.error))) process.exitCode = 1;
