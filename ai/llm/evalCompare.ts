// Compare a NEW eval run against the PUBLISHED baseline, on the case ids both runs
// share. No API calls.
//
//   npx tsx ai/llm/evalCompare.ts data/ai/evals/current_narrowed.json
//
// WHY THE INTERSECTION: the registry grew between the two runs (the baseline has 471
// cases, a current run has 474), so comparing the two corpora whole would mix a
// corpus change into what is supposed to be a behaviour change. Only ids present in
// BOTH runs are scored, which makes the delta attributable to the change under test.
//
// The gate is the plan's G1a threshold: neither language more than 1.0 point below the
// baseline's tool accuracy, and no regression in the `realistic` group. The
// gold-in-candidates rate is reported alongside, because a miss there is a retrieval
// failure rather than a model failure — the two need different fixes.

import { readFileSync } from "node:fs";

type Row = {
  id: string;
  lang: "en" | "bg";
  group: string;
  toolOk: boolean;
  callOk: boolean;
  argScored: boolean;
  argsOk: boolean | null;
  candidatesKept?: number | null;
  goldInCandidates?: boolean;
};
type Artifact = {
  label?: string;
  caseCount: number;
  model?: string;
  routingBudget?: number;
  forcedBudget?: boolean;
  caseGroups?: string[];
  rows: Row[];
};

const [, , newPath, refPath] = process.argv;
if (!newPath)
  throw new Error(
    "Usage: tsx ai/llm/evalCompare.ts <new-artifact.json> [reference-artifact.json]",
  );
// The reference defaults to the published baseline, but a RE-SCORED baseline
// (`current_baseline_rescored.json`, produced by currentEval.replay.ts with no API
// calls) is the like-for-like reference whenever the normalizer has moved: scoring the
// same raw outputs under a newer normalizer changes argument results, and comparing
// against the older scores would report that as a regression of the change under test.
const REFERENCE = refPath ?? "data/ai/evals/current_baseline.json";
const load = (p: string): Artifact =>
  JSON.parse(readFileSync(p, "utf8")) as Artifact;

const base = load(REFERENCE);
const next = load(newPath);
const baseIds = new Set(base.rows.map((r) => `${r.id}:${r.lang}`));
const shared = next.rows.filter((r) => baseIds.has(`${r.id}:${r.lang}`));
if (!shared.length)
  throw new Error("the two runs share no cases — nothing to compare");

const byKey = new Map(base.rows.map((r) => [`${r.id}:${r.lang}`, r]));
const rate = (rows: Row[], key: "toolOk" | "callOk") =>
  rows.length ? rows.filter((r) => r[key]).length / rows.length : null;
const pct = (x: number | null) =>
  x === null ? "  n/a" : `${(100 * x).toFixed(1)}%`;
const delta = (a: number | null, b: number | null, n: number) =>
  a === null || b === null
    ? "   n/a"
    : `${((b - a) * 100 >= 0 ? "+" : "") + ((b - a) * 100).toFixed(1)}pt (n=${n})`;

let failed = false;
const LANGUAGES = ["en", "bg"] as const;
console.log(
  `reference (${REFERENCE}): ${base.caseCount} cases, ${base.model ?? "?"}  →  new: ${next.caseCount} cases, ` +
    `${next.model ?? "?"}${next.forcedBudget ? ` (FORCED budget ${next.routingBudget})` : ""}`,
);
console.log(`compared on the ${shared.length} case-langs both runs contain\n`);

const groups = [...new Set(next.rows.map((r) => r.group))];
console.log(
  "group            lang    n   tool(base→new)            call(base→new)",
);
for (const group of groups) {
  for (const lang of LANGUAGES) {
    const rows = shared.filter((r) => r.group === group && r.lang === lang);
    if (!rows.length) continue;
    const pairs = rows.map((r) => byKey.get(`${r.id}:${r.lang}`)!);
    const toolFrom = rate(pairs, "toolOk");
    const toolTo = rate(rows, "toolOk");
    const callFrom = rate(pairs, "callOk");
    const callTo = rate(rows, "callOk");
    console.log(
      `${group.padEnd(16)} ${lang}  ${String(rows.length).padStart(4)}   ` +
        `${pct(toolFrom)} → ${pct(toolTo)} ${delta(toolFrom, toolTo, rows.length).padEnd(20)}` +
        `${pct(callFrom)} → ${pct(callTo)}`,
    );
    if (
      group === "realistic" &&
      toolTo !== null &&
      toolFrom !== null &&
      toolTo < toolFrom
    ) {
      console.log(`  ⚠ REGRESSION in the realistic group (${lang})`);
      failed = true;
    }
  }
}

console.log();
for (const lang of LANGUAGES) {
  const rows = shared.filter((r) => r.lang === lang);
  const pairs = rows.map((r) => byKey.get(`${r.id}:${r.lang}`)!);
  const from = rate(pairs, "toolOk");
  const to = rate(rows, "toolOk");
  const drop = from !== null && to !== null ? (from - to) * 100 : 0;
  const annotated = rows.filter((r) => r.argScored);
  console.log(
    `${lang}: tool ${pct(from)} → ${pct(to)} (${delta(from, to, rows.length)}), ` +
      `args ${pct(
        rate(
          pairs.filter((p) => p.argScored),
          "argsOk" as never,
        ),
      )} → ` +
      `${pct(rate(annotated, "argsOk" as never))} over ${annotated.length}`,
  );
  // THE PRE-REGISTERED THRESHOLD.
  if (drop > 1.0) {
    console.log(
      `  ✗ DEGRADATION: ${drop.toFixed(1)}pt is beyond the 1.0pt threshold`,
    );
    failed = true;
  }
}

// The retrieval half: whether the gold tool was even offered. Reported because a miss
// here is not a model failure and cannot be fixed by prompt tuning.
const withFlag = next.rows.filter((r) => r.goldInCandidates !== undefined);
if (withFlag.length) {
  const gold = withFlag.filter((r) => r.goldInCandidates).length;
  const sizes = withFlag
    .map((r) => r.candidatesKept)
    .filter((n): n is number => typeof n === "number");
  console.log(
    `\ngold-in-candidates: ${gold}/${withFlag.length} = ${((100 * gold) / withFlag.length).toFixed(1)}%` +
      (sizes.length
        ? ` · mean candidates kept ${(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1)}`
        : ""),
  );
  const missed = withFlag.filter((r) => !r.goldInCandidates);
  if (missed.length)
    console.log(
      `  retrieval misses (model cannot answer these): ${missed
        .slice(0, 10)
        .map((r) => `${r.id}:${r.lang}`)
        .join(", ")}`,
    );
}

console.log(
  failed
    ? "\nFAILED — a threshold was breached"
    : "\nPASSED — within thresholds",
);
process.exit(failed ? 1 : 0);
