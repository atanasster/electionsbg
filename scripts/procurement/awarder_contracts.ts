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
import { byDateDescKeyAsc } from "./contractor_contracts";

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

// Source-agnostic: group a Contract stream by awarder EIK into per-entity files.
// Shared by the shard-reading writer below and the SQL generator.
export const buildAwarderContractsFiles = (
  rows: Iterable<Contract>,
  now: string,
): AwarderContractsFile[] => {
  const byAwarder = new Map<string, Contract[]>();
  for (const r of rows) {
    const arr = byAwarder.get(r.awarderEik) ?? [];
    arr.push(r);
    byAwarder.set(r.awarderEik, arr);
  }
  const out: AwarderContractsFile[] = [];
  for (const [eik, list] of byAwarder) {
    list.sort(byDateDescKeyAsc);
    out.push({
      eik,
      name: list[0]?.awarderName ?? "",
      generatedAt: now,
      count: list.length,
      contracts: list,
    });
  }
  return out;
};

export const writeAwarderContracts = (
  contractsDir: string,
  outDir: string,
): WriteAwarderContractsResult => {
  fs.mkdirSync(outDir, { recursive: true });

  function* readShards(): Generator<Contract> {
    if (!fs.existsSync(contractsDir)) return;
    for (const year of fs.readdirSync(contractsDir).sort()) {
      if (!/^\d{4}$/.test(year)) continue;
      const yearDir = path.join(contractsDir, year);
      if (!fs.statSync(yearDir).isDirectory()) continue;
      for (const file of fs.readdirSync(yearDir)) {
        if (!/^\d{4}-\d{2}\.json$/.test(file)) continue;
        yield* JSON.parse(
          fs.readFileSync(path.join(yearDir, file), "utf8"),
        ) as Contract[];
      }
    }
  }

  const now = new Date().toISOString();
  const files = buildAwarderContractsFiles(readShards(), now);
  const writtenEiks = new Set<string>();
  let totalRows = 0;
  for (const file of files) {
    fs.writeFileSync(
      path.join(outDir, `${file.eik}.json`),
      canonicalJson(file),
    );
    writtenEiks.add(file.eik);
    totalRows += file.count;
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
