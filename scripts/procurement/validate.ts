// Validation + canary for the procurement ingest. Mirrors the rollcall
// pattern: any failure halts the run before any data is written or uploaded.

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import type { Contract, FlowFile } from "./types";

export const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";

// Sankey-flow integrity: every contractor node that feeds a person
// (contractor → mp/official) must itself be fed by at least one awarder edge
// (awarder → contractor). A contractor with an outgoing person edge but no
// incoming awarder edge renders orphaned — d3-sankey pushes it into the
// leftmost column, so it reads as "Изпълнител → Депутат" with no Възложител.
// That happened because the awarder rollups cap byContractor at the top ~50
// clients (buildFlow now backfills the gap from topAwarders) and because a
// value/threshold cut can drop the smaller awarder edge while keeping the
// larger person edge (trimFlow / the client filter now restore it). This guard
// fails the ingest loudly if any future change reintroduces the gap. Node ids
// are prefixed (`awarder:` / `contractor:` / `mp:` / `official:`).
export const assertFlowIntegrity = (flow: FlowFile, context: string): void => {
  const fedByAwarder = new Set<string>();
  const feedsPerson = new Set<string>();
  for (const l of flow.links) {
    if (l.source.startsWith("awarder:")) fedByAwarder.add(l.target);
    else if (l.source.startsWith("contractor:")) feedsPerson.add(l.source);
  }
  const orphans = flow.nodes.filter(
    (n) =>
      n.type === "contractor" &&
      feedsPerson.has(n.id) &&
      !fedByAwarder.has(n.id),
  );
  if (orphans.length > 0) {
    const sample = orphans
      .slice(0, 5)
      .map((n) => n.label)
      .join(", ");
    throw new Error(
      `flow integrity (${context}): ${orphans.length} contractor(s) feed a ` +
        `person but have no awarder edge — they would render orphaned in the ` +
        `sankey (Изпълнител → Депутат with no Възложител). Sample: ${sample}. ` +
        `Check the topAwarders backfill in buildFlow / restoreAwarderProvenance ` +
        `in scripts/procurement/derived.ts.`,
    );
  }
};

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

// Drop synthetic legacy "twin" rows. The legacy CSV ingester falls back to an
// "x" document-id token when a row has no document number, producing an ocid
// like `aop-legacy-2019-x`. An earlier ingest run (with a less complete column
// map) emitted such blank-document-id rows for contracts that a later run then
// re-ingested correctly with their real document number — leaving the corpus
// with duplicate pairs (one real `…-939804`, one synthetic `…-x`) that share
// (date, awarderEik, contractorEik, amount, title) but differ on `key`, so the
// shard merge never collapsed them. They double-count spend (~€11bn across
// 2016/2017/2019/2021).
//
// This drops a `-x` row ONLY when a non-`-x` twin with the same
// (date, awarderEik, contractorEik, amount, title) exists in the same set — a
// `-x` row with no real twin (a genuinely document-id-less contract) is kept.
// Idempotent: re-running over already-clean rows is a no-op. Wired into both
// writeMonthShards paths so future ingests self-heal.
const isSyntheticXTwin = (c: Contract): boolean => /-x$/.test(c.ocid);

const twinKey = (c: Contract): string =>
  [c.date, c.awarderEik, c.contractorEik, c.amount, c.title].join(" ");

export const dropSyntheticLegacyTwins = (
  rows: Contract[],
): { rows: Contract[]; dropped: number } => {
  const realTwinKeys = new Set<string>();
  for (const r of rows) {
    if (!isSyntheticXTwin(r)) realTwinKeys.add(twinKey(r));
  }
  if (realTwinKeys.size === 0) return { rows, dropped: 0 };
  let dropped = 0;
  const kept = rows.filter((r) => {
    if (isSyntheticXTwin(r) && realTwinKeys.has(twinKey(r))) {
      dropped++;
      return false;
    }
    return true;
  });
  return dropped > 0 ? { rows: kept, dropped } : { rows, dropped: 0 };
};

// Key-uniqueness guard. The contract `key` is the SPA's row identity — it
// indexes /contract/:key, every per-entity contracts list keys its React rows
// on it, and the shard merge dedups on it. Two distinct rows sharing a key
// silently conflate (the by-id store keeps only one) and trigger React's
// "two children with the same key" warning. disambiguateContractKeys (in
// contract_key.ts) is supposed to make every key unique; this asserts it held,
// so a future regression in the generators or the merge fails loudly instead of
// shipping conflated contracts. Returns the offending keys (capped) for the
// thrown message.
export const findDuplicateKeys = (rows: Contract[]): string[] => {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.key)) dupes.add(r.key);
    else seen.add(r.key);
  }
  return [...dupes];
};

export const assertUniqueKeys = (rows: Contract[], context: string): void => {
  const dupes = findDuplicateKeys(rows);
  if (dupes.length > 0) {
    throw new Error(
      `duplicate contract key(s) in ${context}: ${dupes.length} key(s) shared ` +
        `by >1 row (e.g. ${dupes.slice(0, 5).join(", ")}). Distinct contracts ` +
        `would conflate on /contract/:key and warn in React. Check ` +
        `disambiguateContractKeys in scripts/procurement/contract_key.ts.`,
    );
  }
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
