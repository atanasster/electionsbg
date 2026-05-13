// Validation + canary for the procurement ingest. Mirrors the rollcall
// pattern: any failure halts the run before any data is written or uploaded.

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import type { Contract } from "./types";

export const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";

// Canary: re-normalize a pinned bundle and compare the sha256 of the
// canonical Contract[] to a fixture. Drift in the OCDS extension set, party
// resolution, or supplier filtering shows up here before any write.
//
// Fixture is created on first run if missing — bootstraps the canary.
// To deliberately update (e.g. after a real format change), delete the
// fixture file and re-run.
export const runCanary = (fixtureFile: string, produced: Contract[]): void => {
  const stable = canonicalJson(produced);
  const hash = createHash("sha256").update(stable).digest("hex");
  if (!fs.existsSync(fixtureFile)) {
    fs.mkdirSync(path.dirname(fixtureFile), { recursive: true });
    fs.writeFileSync(fixtureFile, stable);
    console.log(
      `  canary fixture seeded at ${fixtureFile} (sha256=${hash.slice(0, 16)}, ${produced.length} rows)`,
    );
    return;
  }
  const expected = fs.readFileSync(fixtureFile, "utf8");
  if (stable !== expected) {
    const expHash = createHash("sha256").update(expected).digest("hex");
    throw new Error(
      `canary mismatch: parser output differs from fixture\n` +
        `  fixture: ${fixtureFile}\n` +
        `  expected sha256: ${expHash.slice(0, 16)}\n` +
        `  produced sha256: ${hash.slice(0, 16)}\n` +
        `Investigate scripts/procurement/normalize.ts before continuing.`,
    );
  }
  console.log(
    `  canary OK (sha256=${hash.slice(0, 16)}, ${produced.length} rows)`,
  );
};

// Per-contract sanity. Throws on rows that would corrupt downstream metrics.
// Currently only checks the negative-amount case; >1B amounts are flagged as
// warnings (PRD says "individually flagged for review", not blocked).
export const validateContract = (c: Contract): void => {
  if (c.amount != null && c.amount < 0) {
    throw new Error(
      `contract ${c.releaseId}: negative amount ${c.amount} ${c.currency}`,
    );
  }
};

// Flag oddly large amounts (PRD: >1B BGN). Same rule for EUR — eurozone
// transition aside, a single contract over 1B in either currency warrants a
// human glance. Returns the list; caller prints.
const HUGE_THRESHOLD = 1_000_000_000;
export const findHugeContracts = (rows: Contract[]): Contract[] =>
  rows.filter((r) => r.amount != null && r.amount >= HUGE_THRESHOLD);

// Diff size guard. PRD: if an ingest touches >5% of existing files in the
// domain, block. Skipped during bootstrap (<20 baseline files).
const BOOTSTRAP_THRESHOLD = 20;
export const checkDiffSize = (
  baselineCount: number,
  newFiles: number,
  modifiedFiles: number,
  maxFraction = 0.05,
): void => {
  if (baselineCount < BOOTSTRAP_THRESHOLD) return;
  const touched = newFiles + modifiedFiles;
  const frac = touched / baselineCount;
  if (frac > maxFraction) {
    throw new Error(
      `diff cap exceeded: touched ${touched}/${baselineCount} baseline files (${(frac * 100).toFixed(1)}% > ${(maxFraction * 100).toFixed(0)}%). Investigate before committing.`,
    );
  }
};

export const countDomainFiles = (domainDir: string): number => {
  if (!fs.existsSync(domainDir)) return 0;
  return listFilesRecursive(domainDir).length;
};

const listFilesRecursive = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
};
