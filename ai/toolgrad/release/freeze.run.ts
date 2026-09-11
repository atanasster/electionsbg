// Local only. Creates an immutable manifest before model requests.
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { RELEASE_CASES } from "./cases";
import { GUARD_CASES } from "./guardCases";
import {
  FIXTURE_INPUTS,
  installFixtures,
  verifyFixtureAnswer,
} from "./fixtures";
import { runTool } from "../../tools/registry";
import { hash } from "../corpus";
const captures = [];
for (const c of RELEASE_CASES)
  for (const lang of ["bg", "en"] as const) {
    if (!c.tool) continue;
    installFixtures();
    const args = Object.fromEntries(
      Object.entries(c.args).map(([k, v]) => [k, v[0]]),
    );
    const env = await runTool(c.tool, args, { lang, election: "2024_10_27" });
    verifyFixtureAnswer(env, c.tool);
    captures.push({ id: `${c.id}:${lang}`, env });
  }
const sourcePaths = [
  "ai/toolgrad/release/cases.ts",
  "ai/toolgrad/release/guardCases.ts",
  "ai/toolgrad/release/fixtures.ts",
];
writeFileSync(
  "data/ai/toolgrad/release/manifest.json",
  JSON.stringify(
    {
      version: 1,
      frozenAt: new Date().toISOString(),
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      cases: RELEASE_CASES,
      guardCases: GUARD_CASES,
      inputs: FIXTURE_INPUTS,
      sourceHashes: Object.fromEntries(
        sourcePaths.map((p) => [p, hash(readFileSync(p, "utf8"))]),
      ),
      captures,
      limits: { maxCalls: 128 },
      scope:
        "Invented numerical source fixtures through production tools/provider; operator Gemini transport replaces public authentication and proxy. Does not validate live data, browser rendering or public auth. 48 primary questions and 8 reserved confirmation questions; coding-agent authored, not blinded.",
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
