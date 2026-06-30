// Volatile-insensitive canonicalization + hashing for the regression net.
//
// Nearly every generated rollup carries a `generatedAt` (61k+ files) and the
// index carries `lastIngest`. Those are stamped fresh on every rebuild and
// carry no data signal, so a raw byte hash would flag every regeneration — and
// the entire SQL migration — as a 60k-file "change". We strip them before
// hashing so the baseline reflects DATA, not run time.
//
// See docs/plans/sql-migration-v1.md (Phase 1).

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Run-stamp fields the generators write on every rebuild. Stripped (recursively
 *  — `crossReference.generatedAt` is nested) before any comparison. */
export const VOLATILE_KEYS = new Set(["generatedAt", "lastIngest"]);

const MARKERS = ['"generatedAt"', '"lastIngest"'];

export const stripVolatile = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(k)) continue;
      out[k] = stripVolatile(v);
    }
    return out;
  }
  return value;
};

export const sha256 = (s: string | Buffer): string =>
  createHash("sha256").update(s).digest("hex");

/** Parse a JSON file and return it with run-stamp fields stripped. Used by the
 *  golden comparison (deep-equal) and the index-totals read. */
export const canonicalObject = (absPath: string): unknown =>
  stripVolatile(JSON.parse(readFileSync(absPath, "utf8")));

/** Volatile-insensitive content hash of one output file. Files with no run-stamp
 *  (month shards / by-id shards are bare arrays) hash as raw bytes — the fast
 *  path for the bulk of the corpus; the rest are parsed, stripped, re-serialized
 *  compactly, then hashed. */
export const hashJsonFile = (
  absPath: string,
): { hash: string; bytes: number } => {
  const buf = readFileSync(absPath);
  const bytes = buf.byteLength;
  const hasVolatile = MARKERS.some((m) => buf.includes(m));
  if (!hasVolatile) return { hash: sha256(buf), bytes };
  const canonical = JSON.stringify(
    stripVolatile(JSON.parse(buf.toString("utf8"))),
  );
  return { hash: sha256(canonical), bytes };
};

/** Deterministic, sorted list of every *.json under `root` (absolute paths).
 *  Skips `.DS_Store` and `_cache/` to mirror what ships to the data bucket. */
export const walkJsonFiles = (root: string): string[] => {
  const out: string[] = [];
  const rec = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const e of entries) {
      if (e.name === ".DS_Store" || e.name === "_cache") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.name.endsWith(".json")) out.push(p);
    }
  };
  rec(root);
  return out;
};
