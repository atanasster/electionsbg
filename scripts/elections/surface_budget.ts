// Re-measure §5.0's emit column against the corpus on disk.
//
// The plan makes this Phase 1's exit criterion rather than a nicety: "every `no` row is
// confirmed still inside its budget, and every `yes` row shows the reduction that justified it.
// A level that generates an artifact no smaller than the file it replaces is dropped from the
// generator rather than shipped."
//
// ⚠ THE MEAN IS NOT THE MEASUREMENT. A level is inside its budget only when its LARGEST place
// is, because the largest place is a real page a real reader opens — and in this corpus the
// largest is usually Sofia, i.e. the most-read one. `local/region` is the worked example: 12.5
// KB mean over 29 oblasts reads as comfortably inside a 16 KiB budget, and SFO is 28.7 KB. So
// both are reported, and `surface_budget.test.ts` gates on the max.
//
// Usage:
//   npm run elections:budget                    # every cycle the policy covers
//   npm run elections:budget -- --json          # machine-readable, for the gate
//
// Reads only; writes nothing.

import fs from "node:fs";
import path from "node:path";
import {
  SURFACE_BUDGET_BYTES,
  SURFACE_POLICY,
  type SurfaceLevelPolicy,
} from "../../src/data/elections/surfacePath";
import type {
  ElectionKind,
  ElectionPlaceLevel,
} from "../../src/data/elections/surfaceTypes";

export const DATA_ROOT = path.join(process.cwd(), "data");

/** Bytes of every `*.json` at EXACTLY `depth` levels below `dir` (0 = directly inside).
 *
 *  ⚠ DEPTH, NEVER A SIZE FILTER. The local sections tree holds both `sections/<obshtina>.json`
 *  aggregates (289, mean 51.8 KB) and `sections/<obshtina>/<code>.json` details (12,302, mean
 *  4.9 KB) — and a walk that returns both, then drops "the big ones" by a threshold, is a magic
 *  number pretending to be a rule. It measured this corpus's section max at 39.9 KB, five times
 *  over budget, which was an aggregate that happened to sit under the cutoff. The real max is
 *  10.1 KB. A tree's shape is what distinguishes the two files, so the shape is what selects. */
const sizesAtDepth = (dir: string, depth: number): number[] => {
  if (!fs.existsSync(dir)) return [];
  const out: number[] = [];
  const walk = (d: string, cur: number) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (cur < depth) walk(p, cur + 1);
        continue;
      }
      if (cur === depth && e.name.endsWith(".json"))
        out.push(fs.statSync(p).size);
    }
  };
  walk(dir, 0);
  return out;
};

const sizesIn = (dir: string): number[] => sizesAtDepth(dir, 0);

const fileSize = (p: string): number[] =>
  fs.existsSync(p) ? [fs.statSync(p).size] : [];

export type LevelMeasurement = {
  kind: ElectionKind;
  level: ElectionPlaceLevel;
  cycle: string;
  policy: SurfaceLevelPolicy;
  budget: number;
  files: number;
  meanBytes: number;
  /** ⚠ The number the decision rests on — see the header. */
  maxBytes: number;
  /** What was measured, so a reader can reproduce it without reading this source. */
  measured: string;
};

/** Where a level's FIRST SCREEN comes from today, before any generator runs. This is the
 *  quantity §5.0 compares against the budget — never the surface we intend to emit. */
const canonicalSizes = (
  kind: ElectionKind,
  level: ElectionPlaceLevel,
  cycleDir: string,
): { sizes: number[]; measured: string } => {
  const j = (...p: string[]) => path.join(cycleDir, ...p);
  if (kind === "parliamentary") {
    switch (level) {
      case "country":
        return {
          sizes: fileSize(j("national_summary.json")),
          measured: "national_summary.json",
        };
      case "municipality":
        return {
          sizes: sizesIn(j("municipalities")),
          measured: "municipalities/*.json",
        };
      case "settlement":
        return {
          sizes: sizesIn(j("settlements")),
          measured: "settlements/*.json",
        };
      case "section":
        return {
          sizes: sizesIn(j("sections", "by-oblast")),
          measured: "sections/by-oblast/*.json",
        };
      case "region":
      case "abroad":
        // No canonical file exists — the headline is a client-side fan-out, which is precisely
        // why the level emits. Reported as 0 rather than omitted, so the row stays in the table.
        return { sizes: [], measured: "(client-side fan-out, no single file)" };
    }
  }
  switch (level) {
    case "country":
      return {
        sizes: fileSize(j("index.json")),
        measured: "index.json (of a 4-file fan-out)",
      };
    case "region":
      return { sizes: sizesIn(j("region")), measured: "region/*.json" };
    case "municipality":
    case "settlement":
      // A settlement reader downloads the parent municipality bundle; there is no settlement file.
      return {
        sizes: sizesIn(j("municipalities")),
        measured: "municipalities/*.json",
      };
    case "section":
      return {
        sizes: sizesAtDepth(j("sections"), 1),
        measured: "sections/<obshtina>/*.json",
      };
    case "abroad":
      return { sizes: [], measured: "(not held abroad)" };
  }
};

export const measureCycle = (
  kind: ElectionKind,
  cycle: string,
): LevelMeasurement[] => {
  const cycleDir = path.join(DATA_ROOT, cycle);
  const levels = Object.keys(SURFACE_POLICY[kind]) as ElectionPlaceLevel[];
  return levels.map((level) => {
    const { sizes, measured } = canonicalSizes(kind, level, cycleDir);
    const relevant = sizes;
    const total = relevant.reduce((a, b) => a + b, 0);
    return {
      kind,
      level,
      cycle,
      policy: SURFACE_POLICY[kind][level],
      budget: SURFACE_BUDGET_BYTES[level],
      files: relevant.length,
      meanBytes: relevant.length ? Math.round(total / relevant.length) : 0,
      maxBytes: relevant.length ? Math.max(...relevant) : 0,
      measured,
    };
  });
};

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

export const renderTable = (rows: LevelMeasurement[]): string => {
  const head =
    "| kind × level | canonical today | files | mean | max | budget | policy | verdict |";
  const sep = "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |";
  const body = rows.map((r) => {
    // ⚠ THE RENDERER AND THE GATE MUST APPLY THE SAME RULE. They did not: the gate exempted
    // `embedded` while this printed "⚠ OVER — flip to artifact" for it on every run, so
    // `npm run elections:budget` permanently instructed the operator to reverse a decision the
    // test suite was defending. A tool that contradicts its own gate teaches people to ignore it.
    const verdict =
      r.policy.source === "artifact"
        ? "emits"
        : r.policy.source === "none"
          ? "n/a — kind × level does not exist"
          : r.maxBytes === 0
            ? "n/a"
            : r.maxBytes <= r.budget
              ? "inside"
              : r.policy.budgetWaiver
                ? `over by ${(r.maxBytes / r.budget).toFixed(2)}x — waived (${r.policy.budgetWaiver.objectCost.toLocaleString("en")} objects to fix)`
                : "⚠ OVER — flip to artifact";
    return `| ${r.kind}/${r.level} | ${r.measured} | ${r.files} | ${kb(r.meanBytes)} | ${kb(
      r.maxBytes,
    )} | ${kb(r.budget)} | ${r.policy.source} | ${verdict} |`;
  });
  return [head, sep, ...body].join("\n");
};

const main = () => {
  const asJson = process.argv.includes("--json");
  const cycles: [ElectionKind, string][] = [];
  const dirs = fs.existsSync(DATA_ROOT) ? fs.readdirSync(DATA_ROOT) : [];
  const parl = dirs
    .filter((d) => /^\d{4}_\d{2}_\d{2}$/.test(d))
    .sort()
    .at(-1);
  const locals = dirs
    .filter((d) => /^\d{4}_\d{2}_\d{2}_mi$/.test(d))
    .sort()
    .slice(-2);
  if (parl) cycles.push(["parliamentary", parl]);
  for (const l of locals) cycles.push(["local", l]);

  const rows = cycles.flatMap(([k, c]) => measureCycle(k, c));
  if (asJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return;
  }
  for (const [k, c] of cycles) {
    process.stdout.write(`\n### ${k} — ${c}\n\n`);
    process.stdout.write(
      renderTable(rows.filter((r) => r.kind === k && r.cycle === c)) + "\n",
    );
  }
  const over = rows.filter(
    (r) =>
      (r.policy.source === "canonical" || r.policy.source === "embedded") &&
      r.maxBytes > r.budget &&
      !r.policy.budgetWaiver,
  );
  if (over.length) {
    process.stdout.write(
      `\n⚠ ${over.length} level(s) serve a first screen from a file that is over budget,\n` +
        `  with no declared waiver — flip them to "artifact" or record the arithmetic:\n` +
        over
          .map(
            (r) =>
              `  ${r.kind}/${r.level} @ ${r.cycle}: ${kb(r.maxBytes)} > ${kb(r.budget)}`,
          )
          .join("\n") +
        "\n",
    );
  }
  const waived = rows.filter(
    (r) => r.policy.budgetWaiver && r.maxBytes > r.budget,
  );
  if (waived.length) {
    process.stdout.write(
      `\nAccepted overages (declared, with arithmetic):\n` +
        waived
          .map(
            (r) =>
              `  ${r.kind}/${r.level} @ ${r.cycle}: ${kb(r.maxBytes)} vs ` +
              `${kb(r.budget)} — ${r.policy.budgetWaiver!.note}`,
          )
          .join("\n") +
        "\n",
    );
  }
};

// `tsx scripts/elections/surface_budget.ts` runs it; importing it for the gate does not.
if (process.argv[1]?.endsWith("surface_budget.ts")) main();
