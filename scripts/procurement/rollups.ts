// Build per-contractor and per-awarder rollups from the flat Contract[].
// Run after all month-shards have been written so the rollups reflect the
// full corpus, not just the latest batch.

import fs from "fs";
import path from "path";
import type {
  AwarderRollup,
  Contract,
  ContractorRollup,
  ProcurementIndex,
  RollupContractRow,
} from "./types";
import { canonicalJson } from "./validate";
import { splitBag } from "@/lib/currency";

// How many contracts to embed per-entity for the dashboard "top contracts"
// tile. 20 keeps the rollup small (~5 KB extra) while giving the tile
// headroom over the 10 rows it actually renders.
const TOP_CONTRACTS_PER_ENTITY = 20;

const yearOf = (date: string): string => date.slice(0, 4);

const addCurrency = (
  bag: Record<string, number>,
  currency: string | undefined,
  amount: number | undefined,
): void => {
  if (!currency || amount == null || !Number.isFinite(amount)) return;
  bag[currency] = (bag[currency] ?? 0) + amount;
};

// In-memory accumulators keyed by EIK.
interface ContractorAcc {
  eik: string;
  name: string;
  totalByCurrency: Record<string, number>;
  contractCount: number;
  awardCount: number;
  byAwarder: Map<
    string,
    {
      eik: string;
      name: string;
      totalByCurrency: Record<string, number>;
      contractCount: number;
    }
  >;
  byYear: Map<
    string,
    {
      year: string;
      totalByCurrency: Record<string, number>;
      contractCount: number;
    }
  >;
  // Sorted top-N preview, descending by amount. Maintained in place to avoid
  // holding every Contract row per entity (the worst-case entity has
  // thousands of rows; we only need the top ~20).
  topContracts: RollupContractRow[];
  refsByMonth: Map<string, number[]>;
}

interface AwarderAcc {
  eik: string;
  name: string;
  region?: string;
  totalByCurrency: Record<string, number>;
  contractCount: number;
  awardCount: number;
  byContractor: Map<
    string,
    {
      eik: string;
      name: string;
      totalByCurrency: Record<string, number>;
      contractCount: number;
    }
  >;
  byYear: Map<
    string,
    {
      year: string;
      totalByCurrency: Record<string, number>;
      contractCount: number;
    }
  >;
  topContracts: RollupContractRow[];
}

// Maintain a descending top-N preview in place. Cheap O(N) insert+shift —
// at N=20 this is trivial vs. the per-row work already happening.
const insertTopRow = (
  arr: RollupContractRow[],
  row: RollupContractRow,
): void => {
  const amount = row.amount ?? -1;
  if (
    arr.length >= TOP_CONTRACTS_PER_ENTITY &&
    amount <= (arr[arr.length - 1].amount ?? -1)
  ) {
    return;
  }
  let i = 0;
  while (i < arr.length && (arr[i].amount ?? -1) >= amount) i++;
  arr.splice(i, 0, row);
  if (arr.length > TOP_CONTRACTS_PER_ENTITY)
    arr.length = TOP_CONTRACTS_PER_ENTITY;
};

export interface RollupResult {
  contractors: ContractorRollup[];
  awarders: AwarderRollup[];
  totals: ProcurementIndex["totals"];
}

// Build rollups by re-reading every month-shard. This is the simplest correct
// approach — incremental update would need to know which contractors were
// touched, which fights with the "single fortnight may amend a year-old
// contract" reality. At ~50k rows/year × 3 years = 150k rows, full rebuild
// is ~1-2s.
export const buildRollups = (contractsDir: string): RollupResult => {
  const contractors = new Map<string, ContractorAcc>();
  const awarders = new Map<string, AwarderAcc>();
  const totals: ProcurementIndex["totals"] = {
    contracts: 0,
    awards: 0,
    amendments: 0,
    contractorCount: 0,
    awarderCount: 0,
    totalEur: 0,
    totalOther: {},
  };
  // In-memory per-currency accumulator; collapsed to totalEur / totalOther
  // via splitBag once the full corpus has been walked.
  const totalsBag: Record<string, number> = {};

  if (!fs.existsSync(contractsDir)) {
    return { contractors: [], awarders: [], totals };
  }

  // Walk contracts/<YYYY>/<YYYY-MM>.json shards. Skip the sibling `by-id/`
  // tree (per-contract single-row files used by the SPA detail page) — its
  // entries are individual objects, not arrays, and would crash forEach.
  for (const year of fs.readdirSync(contractsDir).sort()) {
    if (!/^\d{4}$/.test(year)) continue;
    const yearDir = path.join(contractsDir, year);
    const stat = fs.statSync(yearDir);
    if (!stat.isDirectory()) continue;
    for (const file of fs.readdirSync(yearDir).sort()) {
      if (!/^\d{4}-\d{2}\.json$/.test(file)) continue;
      const fullPath = path.join(yearDir, file);
      const monthFile = `contracts/${year}/${file}`;
      const rows = JSON.parse(fs.readFileSync(fullPath, "utf8")) as Contract[];

      rows.forEach((row, idx) => {
        if (row.tag === "contract") totals.contracts++;
        else if (row.tag === "award") totals.awards++;
        else if (row.tag === "contractAmendment") totals.amendments++;
        addCurrency(totalsBag, row.currency, row.amount);

        // Contractor.
        const ca =
          contractors.get(row.contractorEik) ??
          ({
            eik: row.contractorEik,
            name: row.contractorName,
            totalByCurrency: {},
            contractCount: 0,
            awardCount: 0,
            byAwarder: new Map(),
            byYear: new Map(),
            topContracts: [],
            refsByMonth: new Map(),
          } satisfies ContractorAcc);
        // Prefer the most recent name observed. Rows are walked in YYYY-MM
        // order (sorted), so the last assignment is the newest.
        ca.name = row.contractorName || ca.name;
        addCurrency(ca.totalByCurrency, row.currency, row.amount);
        if (row.tag === "award") ca.awardCount++;
        else ca.contractCount++;

        const ay = ca.byYear.get(yearOf(row.date)) ?? {
          year: yearOf(row.date),
          totalByCurrency: {},
          contractCount: 0,
        };
        addCurrency(ay.totalByCurrency, row.currency, row.amount);
        ay.contractCount++;
        ca.byYear.set(ay.year, ay);

        const aw = ca.byAwarder.get(row.awarderEik) ?? {
          eik: row.awarderEik,
          name: row.awarderName,
          totalByCurrency: {},
          contractCount: 0,
        };
        aw.name = row.awarderName || aw.name;
        addCurrency(aw.totalByCurrency, row.currency, row.amount);
        aw.contractCount++;
        ca.byAwarder.set(aw.eik, aw);

        const refs = ca.refsByMonth.get(monthFile) ?? [];
        refs.push(idx);
        ca.refsByMonth.set(monthFile, refs);

        contractors.set(row.contractorEik, ca);

        // Awarder.
        const aa =
          awarders.get(row.awarderEik) ??
          ({
            eik: row.awarderEik,
            name: row.awarderName,
            region: row.awarderRegion,
            totalByCurrency: {},
            contractCount: 0,
            awardCount: 0,
            byContractor: new Map(),
            byYear: new Map(),
            topContracts: [],
          } satisfies AwarderAcc);
        aa.name = row.awarderName || aa.name;
        if (row.awarderRegion) aa.region = row.awarderRegion;
        addCurrency(aa.totalByCurrency, row.currency, row.amount);
        if (row.tag === "award") aa.awardCount++;
        else aa.contractCount++;

        const ay2 = aa.byYear.get(yearOf(row.date)) ?? {
          year: yearOf(row.date),
          totalByCurrency: {},
          contractCount: 0,
        };
        addCurrency(ay2.totalByCurrency, row.currency, row.amount);
        ay2.contractCount++;
        aa.byYear.set(ay2.year, ay2);

        const bc = aa.byContractor.get(row.contractorEik) ?? {
          eik: row.contractorEik,
          name: row.contractorName,
          totalByCurrency: {},
          contractCount: 0,
        };
        bc.name = row.contractorName || bc.name;
        addCurrency(bc.totalByCurrency, row.currency, row.amount);
        bc.contractCount++;
        aa.byContractor.set(bc.eik, bc);

        awarders.set(row.awarderEik, aa);

        // Top-N preview rows. We embed two slim copies — one in the
        // contractor bucket pointing at the awarder, one in the awarder
        // bucket pointing at the contractor. Award-only rows have no signed
        // amount and would always lose the ranking; skip them so the tile
        // doesn't render placeholder dashes.
        if (row.tag !== "award" && (row.amount ?? 0) > 0) {
          insertTopRow(ca.topContracts, {
            key: row.key,
            ocid: row.ocid,
            date: row.date,
            amount: row.amount,
            currency: row.currency,
            amountEur: row.amountEur,
            partyEik: row.awarderEik,
            partyName: row.awarderName,
            bundleUuid: row.bundleUuid,
            sourceUrl: row.sourceUrl,
          });
          insertTopRow(aa.topContracts, {
            key: row.key,
            ocid: row.ocid,
            date: row.date,
            amount: row.amount,
            currency: row.currency,
            amountEur: row.amountEur,
            partyEik: row.contractorEik,
            partyName: row.contractorName,
            bundleUuid: row.bundleUuid,
            sourceUrl: row.sourceUrl,
          });
        }
      });
    }
  }

  const totalsSplit = splitBag(totalsBag);
  totals.totalEur = totalsSplit.totalEur;
  totals.totalOther = totalsSplit.totalOther;
  totals.contractorCount = contractors.size;
  totals.awarderCount = awarders.size;

  const now = new Date().toISOString();

  // Materialise: the in-memory accumulators carry per-currency bags; the
  // output shape carries totalEur + totalOther (see src/lib/currency.ts).
  // Cap nested lists at a top-N to keep per-EIK files small.
  const TOP_LIMIT = 50;

  // Collapse a nested entry's currency bag, sort the list by euro total desc.
  const finalizeEntries = <
    T extends { totalByCurrency: Record<string, number> },
  >(
    arr: T[],
  ): Array<
    Omit<T, "totalByCurrency"> & {
      totalEur: number;
      totalOther: Record<string, number>;
    }
  > =>
    arr
      .map(({ totalByCurrency, ...rest }) => ({
        ...rest,
        ...splitBag(totalByCurrency),
      }))
      .sort((a, b) => b.totalEur - a.totalEur);

  // byYear keeps chronological order; only the currency bag is collapsed.
  const finalizeByYear = (
    arr: Array<{
      year: string;
      totalByCurrency: Record<string, number>;
      contractCount: number;
    }>,
  ) =>
    arr
      .map(({ totalByCurrency, ...rest }) => ({
        ...rest,
        ...splitBag(totalByCurrency),
      }))
      .sort((a, b) => a.year.localeCompare(b.year));

  const contractorOut: ContractorRollup[] = [...contractors.values()].map(
    (c) => ({
      eik: c.eik,
      name: c.name,
      ...splitBag(c.totalByCurrency),
      contractCount: c.contractCount,
      awardCount: c.awardCount,
      byAwarder: finalizeEntries([...c.byAwarder.values()]).slice(0, TOP_LIMIT),
      byYear: finalizeByYear([...c.byYear.values()]),
      topContracts: c.topContracts,
      contractRefs: [...c.refsByMonth.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([monthFile, indexes]) => ({ monthFile, indexes })),
      generatedAt: now,
    }),
  );

  const awarderOut: AwarderRollup[] = [...awarders.values()].map((a) => ({
    eik: a.eik,
    name: a.name,
    region: a.region,
    ...splitBag(a.totalByCurrency),
    contractCount: a.contractCount,
    awardCount: a.awardCount,
    byContractor: finalizeEntries([...a.byContractor.values()]).slice(
      0,
      TOP_LIMIT,
    ),
    byYear: finalizeByYear([...a.byYear.values()]),
    topContracts: a.topContracts,
    generatedAt: now,
  }));

  return { contractors: contractorOut, awarders: awarderOut, totals };
};

export const writeRollups = (
  outDir: string,
  rollups: RollupResult,
): { contractorFiles: number; awarderFiles: number } => {
  const contractorDir = path.join(outDir, "contractors");
  const awarderDir = path.join(outDir, "awarders");
  fs.mkdirSync(contractorDir, { recursive: true });
  fs.mkdirSync(awarderDir, { recursive: true });

  for (const c of rollups.contractors) {
    fs.writeFileSync(
      path.join(contractorDir, `${c.eik}.json`),
      canonicalJson(c),
    );
  }
  for (const a of rollups.awarders) {
    fs.writeFileSync(path.join(awarderDir, `${a.eik}.json`), canonicalJson(a));
  }
  return {
    contractorFiles: rollups.contractors.length,
    awarderFiles: rollups.awarders.length,
  };
};
