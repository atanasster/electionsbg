// node --env-file=.env.local --import tsx ai/toolgrad/defaults/narration.run.ts baseline|candidate <new-directory>
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PilotClient, PILOT_MODEL } from "../client";
import { hash } from "../corpus";
import { NARRATION_CASES } from "./narrationCases";
import { buildNarrationPrompt } from "../../orchestrator/prompts";
import { narrate } from "../../orchestrator/narrate";
import { numbersGrounded } from "../../llm/grounding";
import { semanticGrounded } from "../../llm/semanticGrounding";
import { matchesLang } from "../../llm/lang";
import type { Envelope } from "../../tools/types";
const [variant, dir] = process.argv.slice(2);
if (!["baseline", "candidate"].includes(variant) || !dir)
  throw new Error("Expected variant and new directory");
const old = JSON.parse(
  readFileSync("data/ai/toolgrad/narration/report.json", "utf8"),
);
const client = new PilotClient(
  process.env.GEMINI_API_KEY ?? "",
  NARRATION_CASES.length * 2,
);
mkdirSync(dir);
const meta = {
  version: 1,
  variant,
  model: PILOT_MODEL,
  synthetic: true,
  startedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  cases: NARRATION_CASES,
  suiteHash: hash(NARRATION_CASES),
  guardSourceHash: hash(readFileSync("ai/llm/semanticGrounding.ts", "utf8")),
  settings: { temperature: 0.3, tokens: 420 },
  scope:
    "Baseline retained prompt and numeric/script guards versus revised prompt, conservative semantic guard and tax fact coverage. Local semantic review is separate; synthetic data only.",
};
writeFileSync(`${dir}/manifest.json`, JSON.stringify(meta, null, 2) + "\n");
const rows: unknown[] = [];
let errors = 0;
for (const c of NARRATION_CASES)
  for (const lang of ["bg", "en"] as const) {
    const facts = variant === "baseline" ? (c.baseFacts ?? c.facts) : c.facts;
    const env: Envelope = {
      tool: "syntheticFixture",
      kind: "scalar",
      viz: "none",
      title: lang === "bg" ? "Измислен пример" : "Fictional example",
      facts,
      provenance: ["invented evaluation fixture"],
    };
    const prompt = buildNarrationPrompt(env, lang);
    if (variant === "baseline")
      prompt.system = old.rows.find(
        (r: { lang: string }) => r.lang === lang,
      ).prompt.system;
    let text = "",
      error: string | undefined,
      completion;
    try {
      completion = await client.complete(
        [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        { tokens: 420, temperature: 0.3 },
      );
      text = completion.text;
    } catch (e) {
      error = String(e);
      errors++;
    }
    const numeric = !error && numbersGrounded(text, facts, env.title);
    const language = !error && matchesLang(text, lang);
    const semantic = !error && semanticGrounded(text, facts, env.title);
    const accepted = language && (variant === "baseline" ? numeric : semantic);
    rows.push({
      id: `${c.id}:${lang}`,
      split: c.split,
      lang,
      env,
      prompt,
      ...completion,
      text,
      error,
      numeric,
      language,
      semantic,
      accepted,
      finalText: accepted ? text : narrate(env, lang),
    });
    writeFileSync(
      `${dir}/report.json`,
      JSON.stringify(
        {
          ...meta,
          finishedAt: new Date().toISOString(),
          complete: rows.length === NARRATION_CASES.length * 2,
          errors,
          calls: client.calls,
          reservationCeilingUSD: client.reservedCeilingUSD,
          rows,
        },
        null,
        2,
      ) + "\n",
    );
  }
console.log(
  `${variant}: ${rows.length} synthetic outputs ready for semantic review`,
);

if (errors) process.exitCode = 1;
