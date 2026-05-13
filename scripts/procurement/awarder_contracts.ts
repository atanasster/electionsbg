// Per-awarder contracts file emitter — mirror of contractor_contracts.ts but
// keyed on the buyer (awarder) side of each contract. Output:
//   data/procurement/awarder_contracts/<EIK>.json
//
// Drives the SPA's /awarder/:eik detail page, which renders awarder info +
// the contracts they signed + top contractors they paid + MP-tied subset.

import fs from "fs";
import path from "path";
import type { Contract } from "./types";
import { canonicalJson } from "./validate";

export interface AwarderContractsFile {
  eik: string;
  name: string;
  generatedAt: string;
  count: number;
  contracts: Contract[];
}

export interface WriteAwarderContractsResult {
  filesWritten: number;
  totalRows: number;
  pruned: number;
}

export const writeAwarderContracts = (
  contractsDir: string,
  outDir: string,
): WriteAwarderContractsResult => {
  fs.mkdirSync(outDir, { recursive: true });
  const byAwarder = new Map<string, Contract[]>();
  if (fs.existsSync(contractsDir)) {
    for (const year of fs.readdirSync(contractsDir).sort()) {
      if (!/^\d{4}$/.test(year)) continue;
      const yearDir = path.join(contractsDir, year);
      if (!fs.statSync(yearDir).isDirectory()) continue;
      for (const file of fs.readdirSync(yearDir)) {
        if (!/^\d{4}-\d{2}\.json$/.test(file)) continue;
        const rows = JSON.parse(
          fs.readFileSync(path.join(yearDir, file), "utf8"),
        ) as Contract[];
        for (const r of rows) {
          const arr = byAwarder.get(r.awarderEik) ?? [];
          arr.push(r);
          byAwarder.set(r.awarderEik, arr);
        }
      }
    }
  }
  const now = new Date().toISOString();
  const writtenEiks = new Set<string>();
  let totalRows = 0;
  for (const [eik, rows] of byAwarder) {
    rows.sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key),
    );
    const name = rows[0]?.awarderName ?? "";
    const file: AwarderContractsFile = {
      eik,
      name,
      generatedAt: now,
      count: rows.length,
      contracts: rows,
    };
    fs.writeFileSync(path.join(outDir, `${eik}.json`), canonicalJson(file));
    writtenEiks.add(eik);
    totalRows += rows.length;
  }
  let pruned = 0;
  for (const f of fs.readdirSync(outDir)) {
    if (!f.endsWith(".json")) continue;
    const eik = f.replace(/\.json$/, "");
    if (!writtenEiks.has(eik)) {
      fs.unlinkSync(path.join(outDir, f));
      pruned++;
    }
  }
  return { filesWritten: writtenEiks.size, totalRows, pruned };
};
