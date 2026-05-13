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

export const writeContractorContracts = (
  contractsDir: string,
  outDir: string,
): WriteContractorContractsResult => {
  fs.mkdirSync(outDir, { recursive: true });
  const byContractor = new Map<string, Contract[]>();
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
          const arr = byContractor.get(r.contractorEik) ?? [];
          arr.push(r);
          byContractor.set(r.contractorEik, arr);
        }
      }
    }
  }
  const now = new Date().toISOString();
  const writtenEiks = new Set<string>();
  let totalRows = 0;
  for (const [eik, rows] of byContractor) {
    // Sort newest-first; the SPA's DataTable lets users re-sort but newest
    // is the default journalism view (recent contracts most relevant).
    rows.sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key),
    );
    const name = rows[0]?.contractorName ?? "";
    const file: ContractorContractsFile = {
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
