// Gates: the assertions a handler's runbook used to ask a reader to eyeball
// („~5,100 settlements", „28 oblasts, sums to 100 ± 0.05"). Plan §2.4.
//
// A failed gate fails the handler — no stamp, publish held — and its expected
// and observed values go into the report verbatim. Every helper returns an
// observation even when it cannot read its input: "file missing" is a result,
// never a crash that would hide the other gates.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO } from "../state";

export interface GateCtx {
  /** Combined output tails of the handler's steps that ran. */
  output: string;
  readJson: (file: string) => unknown;
  /** The file as it was BEFORE the handler ran (snapshotted by the runner),
   *  falling back to HEAD when no snapshot was taken; undefined when neither
   *  exists. A HEAD-only baseline is not enough: the concurrent auto-committer
   *  can commit the new file before the gates run, and a gate comparing the
   *  file with itself always passes. */
  baselineJson: (file: string) => unknown;
}

export interface GateResult {
  ok: boolean;
  expected: string;
  observed: string;
}

export interface Gate {
  id: string;
  /** A file whose pre-run copy this gate compares against; the runner
   *  snapshots it before the handler's first step. */
  baseline?: string;
  /** Evaluate only when one of these sources moved. Omitted = always. */
  on?: readonly string[];
  check: (ctx: GateCtx) => GateResult;
}

/** A selector that throws (a field the file no longer has) is an observation. */
const safely = <T>(fn: () => T): { value?: T; error?: string } => {
  try {
    return { value: fn() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};

export interface Range {
  min?: number;
  max?: number;
  eq?: number;
}

const describeRange = (r: Range): string =>
  r.eq !== undefined
    ? `= ${r.eq}`
    : [
        r.min !== undefined ? `>= ${r.min}` : "",
        r.max !== undefined ? `<= ${r.max}` : "",
      ]
        .filter(Boolean)
        .join(" and ");

const inRange = (n: number, r: Range): boolean =>
  (r.eq === undefined || n === r.eq) &&
  (r.min === undefined || n >= r.min) &&
  (r.max === undefined || n <= r.max);

/** A number selected from a JSON file falls in a range. */
export const jsonNumber = (
  id: string,
  file: string,
  select: (j: unknown) => number,
  range: Range,
  on?: readonly string[],
): Gate => ({
  id,
  on,
  check: (ctx) => {
    const expected = `${file}: ${describeRange(range)}`;
    const j = safely(() => ctx.readJson(file));
    if (j.error)
      return { ok: false, expected, observed: `cannot read: ${j.error}` };
    const v = safely(() => select(j.value));
    if (v.error || typeof v.value !== "number" || !Number.isFinite(v.value))
      return {
        ok: false,
        expected,
        observed: v.error ?? `not a number: ${JSON.stringify(v.value)}`,
      };
    return { ok: inRange(v.value, range), expected, observed: String(v.value) };
  },
});

/** A count selected from a JSON file did not fall more than `maxDropPct`
 *  below the committed copy — the shrink guard for files with no writer-side
 *  guard of their own. A file new at HEAD passes. */
export const noShrink = (
  id: string,
  file: string,
  select: (j: unknown) => number,
  maxDropPct: number,
  on?: readonly string[],
): Gate => ({
  id,
  on,
  baseline: file,
  check: (ctx) => {
    const expected = `${file}: no more than ${maxDropPct}% below its pre-run copy`;
    const now = safely(() => select(ctx.readJson(file)));
    if (now.error || typeof now.value !== "number")
      return {
        ok: false,
        expected,
        observed: `cannot read now: ${now.error ?? now.value}`,
      };
    const head = safely(() => ctx.baselineJson(file));
    if (head.error || head.value === undefined)
      return {
        ok: true,
        expected,
        observed: `${now.value} (no earlier copy to compare)`,
      };
    const before = safely(() => select(head.value));
    if (before.error || typeof before.value !== "number" || before.value === 0)
      return {
        ok: true,
        expected,
        observed: `${now.value} (HEAD value unusable: ${before.error ?? before.value})`,
      };
    const dropPct = ((before.value - now.value) / before.value) * 100;
    return {
      ok: dropPct <= maxDropPct,
      expected,
      observed: `${before.value} → ${now.value} (${dropPct > 0 ? "-" : "+"}${Math.abs(dropPct).toFixed(1)}%)`,
    };
  },
});

/** The handler's output never printed this (a SKIPPED warning, a disarmed
 *  gate) — the cases where a script exits 0 having not done its job. */
export const outputLacks = (
  id: string,
  re: RegExp,
  why: string,
  on?: readonly string[],
): Gate => ({
  id,
  on,
  check: (ctx) => {
    const hit = ctx.output.split("\n").find((l) => re.test(l));
    return {
      ok: !hit,
      expected: `no output line matching ${re} (${why})`,
      observed: hit ? hit.trim().slice(0, 300) : "none",
    };
  },
});

const readJsonAt = (repo: string, file: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(repo, file), "utf8")) as unknown;

const headJsonAt = (repo: string, file: string): unknown => {
  try {
    return JSON.parse(
      execFileSync("git", ["show", `HEAD:${file}`], {
        cwd: repo,
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ) as unknown;
  } catch {
    return undefined;
  }
};

/** Copy every baseline file the gates name, BEFORE the handler runs. A file
 *  that does not exist yet maps to undefined (the gate then has nothing to
 *  compare against, and says so). */
export const snapshotBaselines = (
  gates: readonly Gate[],
  repo: string = REPO,
): Map<string, unknown> => {
  const out = new Map<string, unknown>();
  for (const g of gates)
    if (g.baseline && !out.has(g.baseline))
      try {
        out.set(g.baseline, readJsonAt(repo, g.baseline));
      } catch {
        out.set(g.baseline, undefined);
      }
  return out;
};

export const makeGateCtx = (
  output: string,
  baselines?: ReadonlyMap<string, unknown>,
  repo: string = REPO,
): GateCtx => ({
  output,
  readJson: (file) => readJsonAt(repo, file),
  baselineJson: (file) =>
    baselines?.has(file) ? baselines.get(file) : headJsonAt(repo, file),
});

export const runGates = (
  gates: readonly Gate[],
  flipped: ReadonlySet<string>,
  ctx: GateCtx,
): (GateResult & { id: string })[] =>
  gates
    .filter((g) => !g.on || g.on.some((s) => flipped.has(s)))
    .map((g) => {
      const r = safely(() => g.check(ctx));
      return {
        id: g.id,
        ...(r.value ?? {
          ok: false,
          expected: "a gate result",
          observed: `gate threw: ${r.error}`,
        }),
      };
    });

/** `j.a.b` lookups that throw a readable error instead of a TypeError. */
export const at = (j: unknown, ...keys: (string | number)[]): unknown =>
  keys.reduce<unknown>((v, k) => {
    if (v === null || typeof v !== "object")
      throw new Error(`no field ${keys.join(".")} (stopped at ${String(k)})`);
    return (v as Record<string | number, unknown>)[k];
  }, j);

export const len = (v: unknown): number => {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object") return Object.keys(v).length;
  throw new Error(`not a list or object: ${typeof v}`);
};
