// Emit one file per contractor with that contractor's full Contract[] list,
// at data/procurement/contractor_contracts/<EIK>.json. The SPA's company
// detail page reads this to render the contracts table (with a link to
// each contract's data.egov.bg source). Without it, the SPA would have to
// fetch every month-shard the contractor appears in (~150 shards × 3MB for
// the largest contractors) just to filter — not workable.
//
// File volume: ~23k contractors × avg ~3KB = ~70MB on disk. The largest
// (СОФАРМА ТРЕЙДИНГ АД, 3,985 contracts) is ~2MB; the median is sub-KB.

import fs from "fs";
import path from "path";
import type { Contract } from "./types";
import { canonicalJson } from "./validate";

export interface ContractorContractsFile {
  eik: string;
  name: string;
  generatedAt: string;
  count: number;
  contracts: Contract[];
}

export interface WriteContractorContractsResult {
  filesWritten: number;
  totalRows: number;
  pruned: number;
}

// Newest-first (date desc), ties broken by key asc — the SPA DataTable's default
// view. Keys are globally unique, so this is a total, reproducible order.
export const byDateDescKeyAsc = (a: Contract, b: Contract): number =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key);

// Source-agnostic: group a Contract stream by contractor EIK into per-entity
// files. Shared by the shard-reading writer below and the SQL generator
// (scripts/db/gen_procurement/contract_lists.ts) so both stay in lock-step.
// `now` is stamped into each file's generatedAt.
export const buildContractorContractsFiles = (
  rows: Iterable<Contract>,
  now: string,
): ContractorContractsFile[] => {
  const byContractor = new Map<string, Contract[]>();
  for (const r of rows) {
    const arr = byContractor.get(r.contractorEik) ?? [];
    arr.push(r);
    byContractor.set(r.contractorEik, arr);
  }
  const out: ContractorContractsFile[] = [];
  for (const [eik, list] of byContractor) {
    list.sort(byDateDescKeyAsc);
    out.push({
      eik,
      name: list[0]?.contractorName ?? "",
      generatedAt: now,
      count: list.length,
      contracts: list,
    });
  }
  return out;
};

export const writeContractorContracts = (
  contractsDir: string,
  outDir: string,
): WriteContractorContractsResult => {
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
  const files = buildContractorContractsFiles(readShards(), now);
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

  // Sweep: remove stale files for EIKs no longer present in the corpus.
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
