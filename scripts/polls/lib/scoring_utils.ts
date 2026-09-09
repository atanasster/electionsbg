// Small pure helpers shared by both accuracy analyzers
// (scripts/polls/analyze_accuracy.ts, scripts/polls/presidential/analyze_accuracy.ts)
// — extracted rather than left as two byte-identical private copies, per
// decision 14's "one home" rule.

import fs from "node:fs";

export const readJson = <T>(file: string): T | null => {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
};

export const round = (n: number, dp = 2): number =>
  Math.round(n * 10 ** dp) / 10 ** dp;

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
