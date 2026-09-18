// Run the Jev (TypeSafe) regression suite and write its artifact.
//
//   TYPESAFE_API_KEY=… npx tsx ai/llm/jevRegression.run.ts            # both suites
//   TYPESAFE_API_KEY=… npx tsx ai/llm/jevRegression.run.ts --args     # closed-vocab only
//   TYPESAFE_API_KEY=… npx tsx ai/llm/jevRegression.run.ts --disambig # fixture only
//
// Writes data/ai/evals/jev_regression.json and EXITS NON-ZERO when a headline
// metric falls below its floor — that is what makes this a regression suite
// rather than another measurement script.
//
// THE FLOORS ARE RATCHETS, NOT TARGETS. They are set below the measured
// baseline with deliberate slack (the corpora are ~100-300 cases, so a couple
// of flips is noise, not a regression). Raise a floor only after a measured
// improvement holds; never lower one to make a red run green without recording
// why in docs/plans/jev-typesafe-eval-v1.md.
//
// Scoring keeps the two disambiguation classes SEPARATE — `present` (the right
// entity was retrievable) and `absent` (it was not, so the only correct answer
// is a refusal). Averaging them hides the safety-critical case: a confident
// wrong pick when the intended person is not on the list.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { callSystemOne, INPUT_PRICE_PER_TOKEN, MODEL } from "./fcEval.jev";
import {
  closedVocabCases,
  loadDisambigFixture,
  type ArgCase,
  type DisambigCase,
  type Lang,
} from "./jevRegression.cases";

const ROOT = process.cwd();
const OUT = join(ROOT, "data/ai/evals/jev_regression.json");

/** Regression floors. See the header: ratchets, with slack for corpus noise. */
export const FLOORS = {
  argAccuracy: 0.85,
  /** Guarded separately — a confident wrong pick here names the wrong human. */
  disambigPresent: 0.75,
  disambigAbsent: 0.75,
  /** Of the cases Jev got WRONG, the share it flagged below this confidence.
   *  Calibration is the property the whole architecture leans on, so it is
   *  gated too, not merely reported. */
  confidenceGate: 0.7,
  wrongAnswersFlagged: 0.5,
};

type Row = {
  id: string;
  suite: "args" | "disambig";
  lang: Lang;
  group: string; // param name, or `${kind}:${klass}`
  expected: string;
  got: string | null;
  ok: boolean;
  confidence: number | null;
  probOfExpected: number | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
};

const pool = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> => {
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length || 1) },
      async () => {
        for (;;) {
          const i = next++;
          if (i >= items.length) return;
          await worker(items[i], i);
        }
      },
    ),
  );
};

const askChoice = async (
  apiKey: string,
  state: string,
  instructions: string,
  criteria: Record<string, string | null>,
  expected: string,
): Promise<Omit<Row, "id" | "suite" | "lang" | "group" | "expected">> => {
  const { res, latencyMs, error } = await callSystemOne(apiKey, {
    state,
    model: MODEL,
    questions: { pick: { type: "choice", instructions, criteria } },
  });
  const a = res?.answers?.pick;
  return {
    got: a?.choice ?? null,
    ok: a?.choice === expected,
    confidence: a?.confidence ?? null,
    probOfExpected: a?.probabilities?.[expected] ?? null,
    inputTokens: res?.usage?.input_tokens ?? 0,
    outputTokens: res?.usage?.output_tokens ?? 0,
    latencyMs,
    error,
  };
};

const runArgs = async (apiKey: string, concurrency: number): Promise<Row[]> => {
  const cases = closedVocabCases();
  const tasks: { c: ArgCase; lang: Lang }[] = [];
  for (const c of cases)
    for (const lang of ["en", "bg"] as const) tasks.push({ c, lang });
  const rows: Row[] = new Array(tasks.length);
  console.error(
    `args: ${cases.length} cases × 2 langs = ${tasks.length} calls…`,
  );
  await pool(tasks, concurrency, async ({ c, lang }, i) => {
    const r = await askChoice(
      apiKey,
      c.question[lang],
      c.instructions[lang],
      c.candidates,
      c.expected,
    );
    rows[i] = {
      id: c.id,
      suite: "args",
      lang,
      group: c.param,
      expected: c.expected,
      ...r,
    };
  });
  return rows;
};

const runDisambig = async (
  apiKey: string,
  concurrency: number,
): Promise<Row[]> => {
  const fixture = loadDisambigFixture();
  if (!fixture) {
    console.error(
      "no disambiguation fixture — run `npx tsx ai/llm/jevRegression.capture.ts` first (skipping suite)",
    );
    return [];
  }
  const tasks: { c: DisambigCase; lang: Lang }[] = [];
  for (const c of fixture.cases)
    for (const lang of ["en", "bg"] as const) tasks.push({ c, lang });
  const rows: Row[] = new Array(tasks.length);
  console.error(
    `disambig: ${fixture.cases.length} frozen cases (captured ${fixture.capturedAt.slice(0, 10)}) × 2 langs = ${tasks.length} calls…`,
  );
  await pool(tasks, concurrency, async ({ c, lang }, i) => {
    const r = await askChoice(
      apiKey,
      c.question[lang],
      "These candidates came from a fuzzy/trigram search against a possibly misspelled name in the message. Which one (if any) does the message actually mean? Use the sentence's context, not just spelling similarity.",
      c.candidates,
      c.expected,
    );
    rows[i] = {
      id: c.id,
      suite: "disambig",
      lang,
      group: `${c.kind}:${c.klass}`,
      expected: c.expected,
      ...r,
    };
  });
  return rows;
};

// ---- scoring ---------------------------------------------------------------

const pct = (x: number | null) =>
  x == null ? " n/a" : `${(100 * x).toFixed(1)}%`;
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const summarize = (rows: Row[]) => {
  const ok = rows.filter((r) => !r.error);
  const acc = ok.length ? ok.filter((r) => r.ok).length / ok.length : 0;
  const wrong = ok.filter((r) => !r.ok && r.confidence != null);
  const flagged = wrong.filter(
    (r) => r.confidence! < FLOORS.confidenceGate,
  ).length;
  return {
    n: ok.length,
    errors: rows.length - ok.length,
    accuracy: acc,
    meanConfidenceCorrect: mean(
      ok.filter((r) => r.ok && r.confidence != null).map((r) => r.confidence!),
    ),
    meanConfidenceWrong: mean(wrong.map((r) => r.confidence!)),
    wrongAnswersFlagged: wrong.length ? flagged / wrong.length : null,
    meanLatencyMs: mean(ok.map((r) => r.latencyMs)),
    meanInputTokens: mean(ok.map((r) => r.inputTokens)),
    costPerCallUsd: mean(ok.map((r) => r.inputTokens)) * INPUT_PRICE_PER_TOKEN,
  };
};

const byGroup = (rows: Row[]) => {
  const out: Record<string, ReturnType<typeof summarize>> = {};
  for (const g of [...new Set(rows.map((r) => r.group))].sort())
    out[g] = summarize(rows.filter((r) => r.group === g));
  return out;
};

const byLang = (rows: Row[]) => ({
  en: summarize(rows.filter((r) => r.lang === "en")),
  bg: summarize(rows.filter((r) => r.lang === "bg")),
});

const main = async () => {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error("TYPESAFE_API_KEY is required.");
    process.exit(1);
  }
  const only = process.argv.find((a) => a === "--args" || a === "--disambig");
  const concurrency = Number(process.env.JEV_CONCURRENCY) || 8;

  const argRows =
    only === "--disambig" ? [] : await runArgs(apiKey, concurrency);
  const disRows =
    only === "--args" ? [] : await runDisambig(apiKey, concurrency);

  const failures: string[] = [];
  console.log("\n=== closed-vocabulary arguments ===");
  if (argRows.length) {
    const all = summarize(argRows);
    const lang = byLang(argRows);
    console.log(
      `  overall ${pct(all.accuracy)} (n=${all.n})   EN ${pct(lang.en.accuracy)}  BG ${pct(lang.bg.accuracy)}` +
        `   latency ${all.meanLatencyMs.toFixed(0)}ms   $${all.costPerCallUsd.toFixed(6)}/call`,
    );
    for (const [g, s] of Object.entries(byGroup(argRows)))
      console.log(
        `    ${g.padEnd(12)} ${pct(s.accuracy).padStart(6)} (n=${s.n})`,
      );
    console.log(
      `  confidence — correct ${all.meanConfidenceCorrect.toFixed(3)} / wrong ${all.meanConfidenceWrong.toFixed(3)}` +
        `   wrong answers flagged below ${FLOORS.confidenceGate}: ${pct(all.wrongAnswersFlagged)}`,
    );
    if (all.accuracy < FLOORS.argAccuracy)
      failures.push(
        `arg accuracy ${pct(all.accuracy)} < floor ${pct(FLOORS.argAccuracy)}`,
      );
    if (
      all.wrongAnswersFlagged != null &&
      all.wrongAnswersFlagged < FLOORS.wrongAnswersFlagged
    )
      failures.push(
        `arg wrong-answers-flagged ${pct(all.wrongAnswersFlagged)} < floor ${pct(FLOORS.wrongAnswersFlagged)}`,
      );
  } else console.log("  (skipped)");

  console.log("\n=== name disambiguation (frozen candidates) ===");
  if (disRows.length) {
    const all = summarize(disRows);
    const lang = byLang(disRows);
    const present = summarize(
      disRows.filter((r) => r.group.endsWith(":present")),
    );
    const absent = summarize(
      disRows.filter((r) => r.group.endsWith(":absent")),
    );
    console.log(
      `  overall ${pct(all.accuracy)} (n=${all.n})   EN ${pct(lang.en.accuracy)}  BG ${pct(lang.bg.accuracy)}` +
        `   latency ${all.meanLatencyMs.toFixed(0)}ms   $${all.costPerCallUsd.toFixed(6)}/call`,
    );
    console.log(
      `  PRESENT (right entity retrievable) ${pct(present.accuracy)} (n=${present.n})`,
    );
    console.log(
      `  ABSENT  (must refuse)              ${pct(absent.accuracy)} (n=${absent.n})`,
    );
    for (const [g, s] of Object.entries(byGroup(disRows)))
      console.log(
        `    ${g.padEnd(18)} ${pct(s.accuracy).padStart(6)} (n=${s.n})`,
      );
    console.log(
      `  confidence — correct ${all.meanConfidenceCorrect.toFixed(3)} / wrong ${all.meanConfidenceWrong.toFixed(3)}` +
        `   wrong answers flagged below ${FLOORS.confidenceGate}: ${pct(all.wrongAnswersFlagged)}`,
    );
    if (present.n && present.accuracy < FLOORS.disambigPresent)
      failures.push(
        `disambig present ${pct(present.accuracy)} < floor ${pct(FLOORS.disambigPresent)}`,
      );
    if (absent.n && absent.accuracy < FLOORS.disambigAbsent)
      failures.push(
        `disambig absent ${pct(absent.accuracy)} < floor ${pct(FLOORS.disambigAbsent)}`,
      );
  } else console.log("  (skipped)");

  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    model: MODEL,
    harness: "ai/llm/jevRegression.run.ts",
    floors: FLOORS,
    suites: {
      args: argRows.length
        ? {
            overall: summarize(argRows),
            perLang: byLang(argRows),
            perGroup: byGroup(argRows),
          }
        : null,
      disambig: disRows.length
        ? {
            overall: summarize(disRows),
            perLang: byLang(disRows),
            perGroup: byGroup(disRows),
          }
        : null,
    },
    rows: [...argRows, ...disRows],
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n");
  console.log(`\nwrote ${OUT}`);

  if (failures.length) {
    console.error(`\nREGRESSION — ${failures.length} floor(s) breached:`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("\nall floors held.");
};

main();
