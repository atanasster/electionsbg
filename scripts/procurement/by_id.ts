// Emit per-contract JSON files for a bounded subset of rows.
//
// Why a subset? At ~50k contracts/year × ~3 years, an unconstrained per-row
// file tree would hit ~150k tiny files — slow to rsync, slow to walk, and
// the SPA only deep-links a small fraction (whatever's listed on the
// /procurement page or surfaced via the per-MP tile).
//
// Selection rule:
//   1. Every MP-tied contract (the journalism payload — every row that
//      mentions a contractor in mp_connected.json's EIK set).
//   2. Top-N by amount across the corpus.
//
// Re-built from scratch on every ingest (so a row that falls out of top-N
// also has its file removed). The directory is gitignored in CI but kept
// committed locally — bucket sync is the source of truth for the SPA.

import fs from "fs";
import path from "path";
import type { Contract, MpConnectedFile } from "./types";
import { canonicalJson, strCmp } from "./validate";

const TOP_BY_AMOUNT = 500;

const sumAmount = (r: Contract): number => r.amount ?? 0;

// Walk every month-shard once + the MP-connected file once. Returns the set
// of keys to emit, plus a quick stats summary.
const selectKeys = (
  contractsDir: string,
  mpConnected: MpConnectedFile,
): {
  rowsByKey: Map<string, Contract>;
  mpTiedKeys: Set<string>;
  topKeys: Set<string>;
} => {
  const mpTiedEiks = new Set(mpConnected.entries.map((e) => e.contractorEik));
  // Walk every Contract row once. Keep top-N by amount in a bounded array,
  // and stash every MP-tied row in full.
  const rowsByKey = new Map<string, Contract>();
  const mpTiedKeys = new Set<string>();
  // Bounded min-heap-ish: keep a sorted array of [amount, key]. Cheap with
  // top-N small. Replace the head when a higher row appears.
  const topPairs: Array<{ amount: number; key: string }> = [];

  if (!fs.existsSync(contractsDir)) {
    return { rowsByKey, mpTiedKeys, topKeys: new Set<string>() };
  }
  for (const year of fs.readdirSync(contractsDir)) {
    // Skip the sibling `by-id/` tree (individual single-row files).
    if (!/^\d{4}$/.test(year)) continue;
    const yearDir = path.join(contractsDir, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;
    for (const file of fs.readdirSync(yearDir)) {
      if (!/^\d{4}-\d{2}\.json$/.test(file)) continue;
      const rows = JSON.parse(
        fs.readFileSync(path.join(yearDir, file), "utf8"),
      ) as Contract[];
      for (const r of rows) {
        const isMpTied = mpTiedEiks.has(r.contractorEik);
        const amt = sumAmount(r);
        const wouldEnterTop =
          topPairs.length < TOP_BY_AMOUNT ||
          amt > topPairs[topPairs.length - 1].amount;
        if (!isMpTied && !wouldEnterTop) continue;
        rowsByKey.set(r.key, r);
        if (isMpTied) mpTiedKeys.add(r.key);
        if (wouldEnterTop) {
          // Insert and keep sorted desc by amount; trim to top-N.
          topPairs.push({ amount: amt, key: r.key });
          // amount desc, ties broken by contract key so the trim cutoff keeps a
          // reproducible set when several contracts share an amount.
          topPairs.sort((a, b) => b.amount - a.amount || strCmp(a.key, b.key));
          if (topPairs.length > TOP_BY_AMOUNT) {
            const dropped = topPairs.splice(TOP_BY_AMOUNT);
            // A dropped key may still be MP-tied — only forget the row if it's
            // not in the MP-tied set.
            for (const d of dropped) {
              if (!mpTiedKeys.has(d.key)) rowsByKey.delete(d.key);
            }
          }
        }
      }
    }
  }
  const topKeys = new Set(topPairs.map((p) => p.key));
  return { rowsByKey, mpTiedKeys, topKeys };
};

export interface ByIdResult {
  byIdDir: string;
  emitted: number;
  mpTied: number;
  topByAmount: number;
  removed: number;
}

export const writeByIdContracts = (
  procurementDir: string,
  contractsDir: string,
  mpConnected: MpConnectedFile,
): ByIdResult => {
  const byIdDir = path.join(procurementDir, "contracts", "by-id");
  fs.mkdirSync(byIdDir, { recursive: true });

  const { rowsByKey, mpTiedKeys, topKeys } = selectKeys(
    contractsDir,
    mpConnected,
  );

  // Write the selected rows. Each file is a single Contract (the row), no
  // wrapper — keeps the by-id file tiny and consumable directly by the SPA's
  // useContract hook.
  for (const [key, row] of rowsByKey) {
    fs.writeFileSync(path.join(byIdDir, `${key}.json`), canonicalJson(row));
  }

  // Sweep: remove any prior by-id files that aren't in the current selection.
  let removed = 0;
  for (const file of fs.readdirSync(byIdDir)) {
    if (!file.endsWith(".json")) continue;
    const key = file.replace(/\.json$/, "");
    if (!rowsByKey.has(key)) {
      fs.unlinkSync(path.join(byIdDir, file));
      removed++;
    }
  }

  return {
    byIdDir,
    emitted: rowsByKey.size,
    mpTied: mpTiedKeys.size,
    topByAmount: topKeys.size,
    removed,
  };
};
