// node --env-file=.env.local --import tsx ai/toolgrad/release/run.ts primary|confirmation <new-directory>
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { RELEASE_CASES } from "./cases";
import { GUARD_CASES } from "./guardCases";
import { FIXTURE_INPUTS } from "./fixtures";
import { evaluateQuestion } from "./harness";
import { ReleaseClient } from "./client";
import { hash } from "../corpus";
import { verifyFrozenSources } from "./preflight";
import { semanticGrounded } from "../../llm/semanticGrounding";
const [split, dir] = process.argv.slice(2);
if (!["primary", "confirmation"].includes(split) || !dir)
  throw new Error("Expected split and new directory");
const manifest = JSON.parse(
  readFileSync("data/ai/toolgrad/release/manifest.json", "utf8"),
);
if (
  hash(manifest.cases) !== hash(RELEASE_CASES) ||
  hash(manifest.guardCases) !== hash(GUARD_CASES) ||
  hash(manifest.inputs) !== hash(FIXTURE_INPUTS)
)
  throw new Error("Frozen evaluation changed");
verifyFrozenSources(manifest.sourceHashes);
const client = new ReleaseClient(process.env.GEMINI_API_KEY ?? "", 128);
mkdirSync(dir);
const meta = {
  version: 1,
  synthetic: true,
  split,
  startedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  manifestHash: hash(manifest),
  sourceHashes: Object.fromEntries(
    [
      "ai/llm/semanticGrounding.ts",
      "ai/llm/openrouter.ts",
      "ai/orchestrator/prompts.ts",
      "ai/orchestrator/router.ts",
      "ai/toolgrad/release/harness.ts",
      "ai/toolgrad/release/client.ts",
    ].map((p) => [p, hash(readFileSync(p, "utf8"))]),
  ),
};
writeFileSync(`${dir}/manifest.json`, JSON.stringify(meta, null, 2) + "\n");
const rows = [];
for (const c of RELEASE_CASES.filter((c) => c.split === split))
  for (const lang of ["bg", "en"] as const) {
    rows.push(await evaluateQuestion(c, lang, (m, o) => client.complete(m, o)));
    writeFileSync(
      `${dir}/report.json`,
      JSON.stringify(
        {
          ...meta,
          complete:
            rows.length ===
            RELEASE_CASES.filter((c) => c.split === split).length * 2,
          calls: client.calls,
          reservationCeilingUSD: client.reservationCeilingUSD,
          rows,
          guardProbes: GUARD_CASES.map((c) => ({
            ...c,
            actual: !!c.text.trim() && semanticGrounded(c.text, c.facts),
          })),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`${c.id}:${lang} captured`);
  }
if (rows.some((r) => r.calls.some((c) => c.error))) process.exitCode = 1;
