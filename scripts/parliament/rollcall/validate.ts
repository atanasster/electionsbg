// Validation + canary checks for the roll-call ingest. Per PRD section
// "Guardrails": any failure here halts the run before any data is written or
// uploaded. Better to fail loud than to ship corrupt data to the bucket.

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import type { SessionItem } from "./parse";

export interface ValidationContext {
  // Set of MP ids known to our local roster (data/parliament/profiles/*.json).
  // Unknown ids are NOT a hard fail — parliament.bg's vote CSVs contain ids
  // its own mp-profile API doesn't serve, so blocking on this would reject
  // legitimate roll-call data. Unknown ids are collected and reported.
  knownMpIds: Set<number>;
  // Seated count for the parliament whose stenogram we're parsing. The roll
  // call must list (seated ± seatedTolerance) MPs per item.
  seatedCount: number;
  seatedTolerance: number;
}

export interface ValidationResult {
  unknownMpIds: Set<number>;
}

// Parliament.bg assigns a fresh MP id every time someone is seated in a new
// NS, so a single person (e.g. Хасан Адемов, in parliament since the 39th NS)
// has multiple ids — 3587, 4112, … . The deduped `index.json` keeps only one
// per person (the latest), but the roll-call CSV references the per-NS id at
// the time of the vote. So we validate against the *profiles/* directory,
// which has one file per parliament.bg id (un-deduped, ~4270 files).
export const loadMpIndex = (): Set<number> => {
  const profilesDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../data/parliament/profiles",
  );
  if (!fs.existsSync(profilesDir)) {
    throw new Error(
      `data/parliament/profiles/ not found — run /update-mps first (parliament-scrape skill).`,
    );
  }
  const ids = new Set<number>();
  for (const file of fs.readdirSync(profilesDir)) {
    const m = file.match(/^(\d+)\.json$/);
    if (m) ids.add(parseInt(m[1], 10));
  }
  if (ids.size === 0) {
    throw new Error(
      `data/parliament/profiles/ is empty — run /update-mps first (parliament-scrape skill).`,
    );
  }
  return ids;
};

export const validateSessionItems = (
  items: SessionItem[],
  ctx: ValidationContext,
): ValidationResult => {
  if (items.length === 0) throw new Error("session has zero vote items");
  const unknownMpIds = new Set<number>();
  for (const item of items) {
    // Collect — don't throw on — unknown MP ids. The vote CSV uses
    // parliament.bg's per-NS mpId, which sometimes refers to MPs whose
    // mp-profile API record returns empty. We surface the gap so the
    // frontend can render an "unknown MP" placeholder, but the vote itself
    // is real and must be preserved.
    for (const v of item.votes) {
      if (!ctx.knownMpIds.has(v.mpId)) unknownMpIds.add(v.mpId);
    }
    // Tallies must sum to votes.length. Mismatch means parser dropped rows.
    const sum =
      item.tallies.yes +
      item.tallies.no +
      item.tallies.abstain +
      item.tallies.absent;
    if (sum !== item.votes.length) {
      throw new Error(
        `item ${item.item}: tally sum ${sum} ≠ vote count ${item.votes.length}`,
      );
    }
    // Roll-call rows are emitted for every seated MP whether they voted or
    // not, so the count is the seated total. Allow ±tolerance for swearing-in
    // days and resignations mid-term.
    const diff = Math.abs(item.votes.length - ctx.seatedCount);
    if (diff > ctx.seatedTolerance) {
      throw new Error(
        `item ${item.item}: vote count ${item.votes.length} differs from seated ${ctx.seatedCount} by ${diff} (tolerance ${ctx.seatedTolerance})`,
      );
    }
  }
  return { unknownMpIds };
};

// Canary: re-parse a pinned historical stenogram CSV and compare bytes of the
// canonical SessionItem[] output to a fixture. If the parser drifts (vote
// code mapping, CSV column layout, etc.) this fails before any write.
//
// Fixture is created on first run if missing — that bootstraps the canary.
// To deliberately update it (e.g. after a real format change), delete the
// fixture file and re-run.
export const runCanary = (
  fixtureFile: string,
  produced: SessionItem[],
): void => {
  const stable = canonicalJson(produced);
  const hash = createHash("sha256").update(stable).digest("hex");
  if (!fs.existsSync(fixtureFile)) {
    fs.mkdirSync(path.dirname(fixtureFile), { recursive: true });
    fs.writeFileSync(fixtureFile, stable);
    console.log(
      `  canary fixture seeded at ${fixtureFile} (sha256=${hash.slice(0, 16)})`,
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
        `Investigate scripts/parliament/rollcall/parse.ts before continuing.`,
    );
  }
  console.log(`  canary OK (sha256=${hash.slice(0, 16)})`);
};

export const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";

// Diff size guard. PRD: if an ingest touches >5% of existing files in the
// domain, block the commit. Pass `baselineCount` from BEFORE any writes ran —
// otherwise the freshly-written sessions inflate the denominator and the cap
// never trips. During bootstrap (baselineCount < BOOTSTRAP_THRESHOLD) the cap
// is skipped — the cap only protects established trees from catastrophic
// re-ingest, not first-time loads.
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

// Count files in a domain dir (for the diff-cap baseline). Returns 0 if the
// dir doesn't exist yet.
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
