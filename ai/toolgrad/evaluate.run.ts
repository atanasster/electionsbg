// node --env-file=.env.local --import tsx ai/toolgrad/evaluate.run.ts development|validation baseline|candidate <new-directory>
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildToolSystemPrompt } from "../orchestrator/prompts";
import { PilotClient, PILOT_MODEL } from "./client";
import { hash, verifyCorpus } from "./corpus";
import { SEEDS } from "./seeds";
import { verifySamples, type Sample } from "./questions";
import {
  generatedTask,
  referenceTasks,
  scoreTask,
  metrics,
  type Row,
} from "./evaluation";
const [phase, variant, dir] = process.argv.slice(2);
if (
  !["development", "validation"].includes(phase) ||
  !["baseline", "candidate"].includes(variant) ||
  !dir
)
  throw new Error("Expected phase, variant and new directory");
const corpus = JSON.parse(readFileSync("data/ai/toolgrad/corpus.json", "utf8"));
const dataset = JSON.parse(
  readFileSync("data/ai/toolgrad/questions.json", "utf8"),
);
verifyCorpus(corpus, SEEDS);
verifySamples(dataset.samples, corpus);
if (dataset.status !== "agent-reviewed")
  throw new Error("Review questions before evaluation");
const tasks = (dataset.samples as Sample[])
  .filter(
    (s) => s.split === (phase === "development" ? "development" : "holdout"),
  )
  .map(generatedTask);
if (phase === "validation") tasks.push(...referenceTasks());
const candidate =
  variant === "candidate"
    ? JSON.parse(readFileSync("data/ai/toolgrad/candidate.json", "utf8"))
    : null;
const prompts = {
  bg: buildToolSystemPrompt("bg") + (candidate ? "\n" + candidate.routing : ""),
  en: buildToolSystemPrompt("en") + (candidate ? "\n" + candidate.routing : ""),
};
const client = new PilotClient(process.env.GEMINI_API_KEY ?? "", tasks.length);
mkdirSync(dir); // never replace a prior result
const meta = {
  version: 1,
  phase,
  variant,
  model: PILOT_MODEL,
  startedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  corpusHash: hash(corpus),
  datasetHash: hash(dataset),
  suiteHash: hash(tasks),
  promptHash: hash(prompts),
  prompts,
  scoringHash: hash(readFileSync("ai/toolgrad/evaluation.ts", "utf8")),
  scope:
    "Isolated production model router/parser; no deterministic fallback, tool execution, or live entity resolution. Masked entities are synthetic. Reference cases retain their existing partial argument annotations. No captured facts transmitted.",
  settings: { tokens: 120, temperature: 0, concurrency: 4 },
};
const rows: Row[] = [];
let next = 0;
const save = () =>
  writeFileSync(
    `${dir}/report.json`,
    JSON.stringify(
      {
        ...meta,
        finishedAt: new Date().toISOString(),
        complete: rows.length === tasks.length,
        calls: client.calls,
        reservationCeilingUSD: client.reservedCeilingUSD,
        metrics: metrics(rows),
        groups: Object.fromEntries(
          [...new Set(rows.map((r) => r.split))].map((split) => [
            split,
            metrics(rows.filter((r) => r.split === split)),
          ]),
        ),
        rows: [...rows].sort((a, b) => a.id.localeCompare(b.id)),
      },
      null,
      2,
    ) + "\n",
  );
async function worker() {
  for (;;) {
    const i = next++;
    if (i >= tasks.length) return;
    const task = tasks[i];
    const started = performance.now();
    let raw = "",
      error: string | undefined,
      usage: Row["usage"];
    try {
      const c = await client.complete(
        [
          { role: "system", content: prompts[task.lang] },
          { role: "user", content: task.question },
        ],
        { json: true, tokens: 120 },
      );
      raw = c.text;
      usage = c.usage;
    } catch (e) {
      error = String(e);
    }
    rows.push({
      ...task,
      ...scoreTask(task, raw, error),
      raw,
      error,
      usage,
      elapsedMs: performance.now() - started,
    });
    save();
    if (rows.length % 20 === 0)
      console.log(`${phase}/${variant}: ${rows.length}/${tasks.length}`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
save();
console.log(JSON.stringify(metrics(rows)));
if (rows.some((r) => r.error)) process.exitCode = 1;
