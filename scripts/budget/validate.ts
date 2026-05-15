// Validation + canary for the budget ingest. Mirrors scripts/procurement/
// validate.ts: any failure halts the run before any data is written.

import fs from "fs";
import path from "path";
import { createHash } from "crypto";

// Byte-stable JSON. Keys are sorted recursively so a hand-edited registry (or
// a re-parse that happens to construct objects in a different order) produces
// zero git diff when the data is unchanged.
export const canonicalJson = (data: unknown): string =>
  JSON.stringify(sortKeys(data), null, 2) + "\n";

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
};

// Canary: re-parse a pinned source artifact and compare the sha256 of the
// canonical output to a committed fixture. Drift in the parser, the currency
// conversion, or the classification resolution shows up here before any write.
//
// The fixture is seeded on first run if missing. To deliberately update it
// (after a real upstream format change), delete the fixture file and re-run.
export const runCanary = (fixtureFile: string, produced: unknown): void => {
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
        `Investigate scripts/budget/ parsers before continuing.`,
    );
  }
  console.log(`  canary OK (sha256=${hash.slice(0, 16)})`);
};

// Diff size guard. Blocks if a single ingest substantively touches an
// implausible fraction of the existing tree — the canary for a runaway parser
// or registry change. With writeIfChanged now ignoring `generatedAt`-only
// edits, "touched" is true substantive change; a healthy run that adds a new
// data source legitimately writes a handful of files. Skipped during bootstrap.
const BOOTSTRAP_THRESHOLD = 20;
export const checkDiffSize = (
  baselineCount: number,
  touchedFiles: number,
  maxFraction = 0.15,
): void => {
  if (baselineCount < BOOTSTRAP_THRESHOLD) return;
  const frac = touchedFiles / baselineCount;
  if (frac > maxFraction) {
    throw new Error(
      `diff cap exceeded: touched ${touchedFiles}/${baselineCount} baseline ` +
        `files (${(frac * 100).toFixed(1)}% > ${(maxFraction * 100).toFixed(0)}%). ` +
        `Investigate before committing.`,
    );
  }
};

// Gitignored shard subtrees under data/budget/ — large, fully regenerable, not
// part of the committed tree. The diff cap is about catching unexpected change
// in what would actually land in a commit, so these are excluded from both the
// baseline count and the touched count.
const GITIGNORED_SHARDS = [
  `${path.sep}facts${path.sep}`,
  `${path.sep}reconciliation${path.sep}`,
  `${path.sep}ministries${path.sep}`,
];

export const isCommittedTreePath = (p: string): boolean =>
  !GITIGNORED_SHARDS.some((s) => p.includes(s));

export const countDomainFiles = (domainDir: string): number => {
  if (!fs.existsSync(domainDir)) return 0;
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (isCommittedTreePath(p)) out.push(p);
    }
  };
  walk(domainDir);
  return out.length;
};

// Generation timestamps the ingest stamps onto its output files every run.
// A file whose only diff is one of these carries no new data.
const VOLATILE_KEYS = ["generatedAt", "lastIngest"];

// Re-serialise a canonical-JSON payload with the volatile generation
// timestamps dropped, so two runs that produced identical data compare equal
// even though their `generatedAt` differs. Non-JSON / non-object payloads
// (or ones that fail to parse) fall back to a raw comparison.
const withoutVolatileKeys = (text: string): string => {
  try {
    const obj = JSON.parse(text) as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const rec = obj as Record<string, unknown>;
      for (const k of VOLATILE_KEYS) delete rec[k];
      return JSON.stringify(rec);
    }
  } catch {
    // not JSON — fall through to the raw-text comparison below
  }
  return text;
};

// Write `text` to `file` only when the data actually changes. Returns true
// when a substantive write happened *to a committed-tree file* — that is the
// signal the caller adds to `touched` for the diff cap. Specifically:
//   - A diff confined to the generation timestamps (`generatedAt` /
//     `lastIngest`) is a no-op: nothing is written, returns false.
//   - A write to a gitignored shard (data/budget/{facts,reconciliation,
//     ministries}/) still happens but returns false — those files are bulky
//     and regenerable, not part of the commit, and shouldn't gate the cap.
//   - Otherwise: write the file and return true.
export const writeIfChanged = (file: string, text: string): boolean => {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (prev === text) return false;
  if (
    prev !== null &&
    withoutVolatileKeys(prev) === withoutVolatileKeys(text)
  ) {
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return isCommittedTreePath(file);
};

// Delete *.json files directly in `dir` whose basename is not in `keep` — for
// pruning regenerable shard dirs (a renamed node or a parser change can leave
// orphan files behind). Returns the count pruned.
export const pruneDir = (dir: string, keep: Set<string>): number => {
  if (!fs.existsSync(dir)) return 0;
  let pruned = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json") || keep.has(entry)) continue;
    fs.unlinkSync(path.join(dir, entry));
    pruned++;
  }
  return pruned;
};
