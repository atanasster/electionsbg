// Development replay of retained completions through repaired code; zero API calls.
import { readFileSync, writeFileSync } from "node:fs";
import { RELEASE_CASES } from "./cases";
import { GUARD_CASES } from "./guardCases";
import { evaluateQuestion } from "./harness";
import { semanticGrounded } from "../../llm/semanticGrounding";
import { hash } from "../corpus";
import { verifyFrozenSources } from "./preflight";
const dir = "data/ai/toolgrad/release";
const split = process.argv[2] ?? "primary";
if (!["primary", "confirmation"].includes(split))
  throw new Error("Invalid replay split");
const m = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
verifyFrozenSources(m.sourceHashes);
const old = JSON.parse(readFileSync(`${dir}/${split}/report.json`, "utf8"));
if (
  hash(old) !==
  (split === "primary"
    ? "77cd01d8df9d3737f0e17d314f3b0db64e1f1dbf0bce6f54e3fd26b1ba79fe9b"
    : "03e3c0c9cd7961c5bebeadf12d57e2f32779f7fca454627f3b4bdee78bdd0801")
)
  throw new Error("Unexpected replay source");
const rows = [];
for (const c of RELEASE_CASES.filter((c) => c.split === split))
  for (const lang of ["bg", "en"] as const) {
    const prior = old.rows.find(
      (r: { id: string }) => r.id === `${c.id}:${lang}`,
    );
    let missingRetainedNarration = false;
    const r = await evaluateQuestion(c, lang, async (_messages, o) => {
      const found = prior.calls.find(
        (x: { options: { json?: boolean }; sample?: unknown }) =>
          !!x.options.json === !!o.json && x.sample,
      )?.sample;
      if (!found) {
        missingRetainedNarration = true;
        throw new Error("No retained completion: deterministic fallback only");
      }
      return { ...found, elapsedMs: 0 };
    });
    rows.push({ ...r, missingRetainedNarration });
  }
writeFileSync(
  `${dir}/${split === "primary" ? "replay" : "confirmation-replay"}.json`,
  JSON.stringify(
    {
      version: 1,
      networkCalls: 0,
      sourceReportHash: hash(old),
      method:
        "Development replay after inspecting primary failures. Old model completions reused with current provider/tools/guard; originally withheld narrations have no model text and use templates. No claim of unseen validation or latency from replay.",
      sourceHashes: Object.fromEntries(
        [
          "ai/llm/semanticGrounding.ts",
          "ai/llm/factBindings.ts",
          "ai/tools/place.ts",
          "ai/tools/areaResults.ts",
          "ai/tools/budgetServing.ts",
          "ai/tools/placesGov.ts",
          "ai/orchestrator/narrate.ts",
          "ai/orchestrator/productDefaults.ts",
          "ai/orchestrator/prompts.ts",
          "ai/orchestrator/router.ts",
        ].map((p) => [p, hash(readFileSync(p, "utf8"))]),
      ),
      rows,
      guardProbes: GUARD_CASES.map((c) => ({
        ...c,
        actual: semanticGrounded(c.text, c.facts),
      })),
    },
    null,
    2,
  ) + "\n",
);
