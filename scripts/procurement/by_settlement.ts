// Per-settlement procurement shards — data/procurement/by_settlement/.
//
// Inputs:
//   data/procurement/awarders/<eik>.json   — every awarder rollup
//   data/procurement/awarder_contracts/<eik>.json — full per-buyer
//                                                  contract list, used to
//                                                  pick top contracts per
//                                                  settlement
//   data/ekatte_index.json                 — settlement catalog
//
// Outputs:
//   data/procurement/by_settlement/<ekatte>.json — one file per settlement
//                                                 that has ≥1 local-tier
//                                                 contract
//   data/procurement/by_settlement/_national.json — central/national
//                                                  rollup (Sofia HQ but
//                                                  national footprint)
//   data/procurement/by_settlement/index.json   — landing-page index
//
// Design:
//   - Group awarders by `geo.ekatte`, but only those with `geo.isLocalHQ`.
//   - Awarders without geo (legacy-only, no recent address data) are
//     dropped — not pinning them anywhere is more honest than guessing.
//   - Central tier (geo.isLocalHQ = false but geo.ekatte resolved) goes
//     into _national.json as a single aggregated card.
//   - "Other" tier with no geo is also dropped to keep the map honest.
//   - topContracts per settlement is built by reading awarder_contracts
//     for the local-tier EIKs in that settlement and taking the top 50
//     by amount. Bounded so we don't have to hold the full contract list
//     in memory.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  AwarderRollup,
  Contract,
  RollupContractRow,
  SettlementProcurementFile,
  SettlementProcurementIndex,
} from "./types";
import { canonicalJson } from "./validate";
import { splitBag, toEur } from "@/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const AWARDERS_DIR = path.join(PROCUREMENT_DIR, "awarders");
const AWARDER_CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "awarder_contracts");
const BY_SETTLEMENT_DIR = path.join(PROCUREMENT_DIR, "by_settlement");
const EKATTE_INDEX_FILE = path.resolve(
  __dirname,
  "../../data/ekatte_index.json",
);

// Cap top-contracts per settlement to keep per-file size predictable.
// 50 is enough to render a meaningful "biggest contracts in this town"
// list without bloating the page-load JSON. The full contract list lives
// on /awarder/:eik for drill-down.
const TOP_CONTRACTS_PER_SETTLEMENT = 50;

interface EkatteEntry {
  ekatte: string;
  name: string;
  postal: string | null;
  province: string;
  obshtina: string;
  obshtina_code: string;
  is_village: boolean;
  loc: string | null;
}

const yearOf = (date: string): string => date.slice(0, 4);

const addCurrency = (
  bag: Record<string, number>,
  currency: string | undefined,
  amount: number | undefined,
): void => {
  if (!currency || amount == null || !Number.isFinite(amount)) return;
  bag[currency] = (bag[currency] ?? 0) + amount;
};

// In-memory aggregator per settlement.
interface SettlementAcc {
  ekatte: string;
  awarders: Map<string, AwarderRollup>;
  totalByCurrency: Record<string, number>;
  contractCount: number;
  awardCount: number;
  byYear: Map<
    string,
    { totalByCurrency: Record<string, number>; count: number }
  >;
  topContracts: RollupContractRow[];
}

const insertTopRow = (
  arr: RollupContractRow[],
  row: RollupContractRow,
): void => {
  const amount = row.amountEur ?? -1;
  if (
    arr.length >= TOP_CONTRACTS_PER_SETTLEMENT &&
    amount <= (arr[arr.length - 1].amountEur ?? -1)
  ) {
    return;
  }
  let i = 0;
  while (i < arr.length && (arr[i].amountEur ?? -1) >= amount) i++;
  arr.splice(i, 0, row);
  if (arr.length > TOP_CONTRACTS_PER_SETTLEMENT)
    arr.length = TOP_CONTRACTS_PER_SETTLEMENT;
};

export interface BySettlementResult {
  /** Number of per-settlement files written. */
  settlementFiles: number;
  /** Settlements with at least one local-tier contract. */
  settlementsWithProcurement: number;
  /** Local-tier awarders successfully pinned to a settlement. */
  localAwardersPinned: number;
  /** National-tier awarders aggregated into _national.json. */
  nationalAwarders: number;
  /** Awarders dropped (no geo, e.g. legacy-only awarders without address). */
  awardersWithoutGeo: number;
}

export const buildBySettlement = async (): Promise<BySettlementResult> => {
  if (!fs.existsSync(AWARDERS_DIR)) {
    return {
      settlementFiles: 0,
      settlementsWithProcurement: 0,
      localAwardersPinned: 0,
      nationalAwarders: 0,
      awardersWithoutGeo: 0,
    };
  }

  const ekIndex = JSON.parse(
    fs.readFileSync(EKATTE_INDEX_FILE, "utf8"),
  ) as EkatteEntry[];
  const ekByCode = new Map(ekIndex.map((e) => [e.ekatte, e]));

  fs.mkdirSync(BY_SETTLEMENT_DIR, { recursive: true });

  const settlements = new Map<string, SettlementAcc>();
  const nationalBag: Record<string, number> = {};
  let nationalContracts = 0;
  let nationalAwards = 0;
  const nationalAwarderEiks = new Set<string>();
  let awardersWithoutGeo = 0;
  let localAwardersPinned = 0;

  const awarderFiles = fs
    .readdirSync(AWARDERS_DIR)
    .filter((f) => f.endsWith(".json"));

  for (const file of awarderFiles) {
    const aw = JSON.parse(
      fs.readFileSync(path.join(AWARDERS_DIR, file), "utf8"),
    ) as AwarderRollup;
    if (!aw.geo) {
      awardersWithoutGeo++;
      continue;
    }

    if (!aw.geo.isLocalHQ) {
      // National rollup: just aggregate totals + counts.
      nationalAwarderEiks.add(aw.eik);
      nationalContracts += aw.contractCount;
      nationalAwards += aw.awardCount;
      addCurrency(nationalBag, "EUR", aw.totalEur);
      for (const [cur, amt] of Object.entries(aw.totalOther ?? {})) {
        addCurrency(nationalBag, cur, amt);
      }
      continue;
    }

    // Local-tier — pin to settlement.
    const ekatte = aw.geo.ekatte;
    let acc = settlements.get(ekatte);
    if (!acc) {
      acc = {
        ekatte,
        awarders: new Map(),
        totalByCurrency: {},
        contractCount: 0,
        awardCount: 0,
        byYear: new Map(),
        topContracts: [],
      };
      settlements.set(ekatte, acc);
    }
    acc.awarders.set(aw.eik, aw);
    acc.contractCount += aw.contractCount;
    acc.awardCount += aw.awardCount;
    addCurrency(acc.totalByCurrency, "EUR", aw.totalEur);
    for (const [cur, amt] of Object.entries(aw.totalOther ?? {})) {
      addCurrency(acc.totalByCurrency, cur, amt);
    }
    for (const y of aw.byYear ?? []) {
      const ay = acc.byYear.get(y.year) ?? {
        totalByCurrency: {},
        count: 0,
      };
      addCurrency(ay.totalByCurrency, "EUR", y.totalEur);
      for (const [cur, amt] of Object.entries(y.totalOther ?? {})) {
        addCurrency(ay.totalByCurrency, cur, amt);
      }
      ay.count += y.contractCount;
      acc.byYear.set(y.year, ay);
    }
    localAwardersPinned++;
  }

  // For top-contracts, re-read awarder_contracts for the local-tier
  // awarders in each settlement. Done lazily, settlement-by-settlement, so
  // the memory peak stays small even on a huge settlement (Sofia would
  // otherwise blow up).
  for (const acc of settlements.values()) {
    for (const aw of acc.awarders.values()) {
      const acFile = path.join(AWARDER_CONTRACTS_DIR, `${aw.eik}.json`);
      if (!fs.existsSync(acFile)) continue;
      const payload = JSON.parse(fs.readFileSync(acFile, "utf8")) as {
        contracts?: Contract[];
      };
      const rows = payload.contracts ?? [];
      for (const r of rows) {
        if (r.tag === "award") continue;
        if (!r.amount || !r.amountEur) continue;
        insertTopRow(acc.topContracts, {
          key: r.key,
          ocid: r.ocid,
          date: r.date,
          amount: r.amount,
          currency: r.currency,
          amountEur: r.amountEur,
          partyEik: r.contractorEik,
          partyName: r.contractorName,
          bundleUuid: r.bundleUuid,
          sourceUrl: r.sourceUrl,
        });
      }
    }
  }

  // Materialise per-settlement files.
  const now = new Date().toISOString();
  for (const [ekatte, acc] of settlements) {
    const ek = ekByCode.get(ekatte);
    if (!ek) continue;

    const awardersOut = [...acc.awarders.values()]
      .map((a) => ({
        eik: a.eik,
        name: a.name,
        tier: a.geo!.tier,
        totalEur: a.totalEur,
        totalOther: a.totalOther,
        contractCount: a.contractCount,
        awardCount: a.awardCount,
      }))
      .sort((a, b) => b.totalEur - a.totalEur);

    const split = splitBag(acc.totalByCurrency);
    const file: SettlementProcurementFile = {
      ekatte,
      name: ek.name,
      province: ek.province,
      obshtina: ek.obshtina,
      generatedAt: now,
      contractCount: acc.contractCount,
      awardCount: acc.awardCount,
      totalEur: split.totalEur,
      totalOther: split.totalOther,
      awarders: awardersOut,
      topContracts: acc.topContracts,
      byYear: [...acc.byYear.entries()]
        .map(([year, v]) => ({
          year,
          ...splitBag(v.totalByCurrency),
          contractCount: v.count,
        }))
        .sort((a, b) => a.year.localeCompare(b.year)),
    };

    fs.writeFileSync(
      path.join(BY_SETTLEMENT_DIR, `${ekatte}.json`),
      canonicalJson(file),
    );
  }

  // National rollup.
  const nationalSplit = splitBag(nationalBag);
  const nationalFile = {
    generatedAt: now,
    awarderCount: nationalAwarderEiks.size,
    contractCount: nationalContracts,
    awardCount: nationalAwards,
    totalEur: nationalSplit.totalEur,
    totalOther: nationalSplit.totalOther,
  };
  fs.writeFileSync(
    path.join(BY_SETTLEMENT_DIR, "_national.json"),
    canonicalJson(nationalFile),
  );

  // Landing index.
  const indexFile: SettlementProcurementIndex = {
    generatedAt: now,
    totalContracts: [...settlements.values()].reduce(
      (s, a) => s + a.contractCount,
      0,
    ),
    totalEur: [...settlements.values()].reduce(
      (s, a) => s + (splitBag(a.totalByCurrency).totalEur ?? 0),
      0,
    ),
    settlementCount: settlements.size,
    national: {
      contractCount: nationalContracts,
      awardCount: nationalAwards,
      totalEur: nationalSplit.totalEur,
      totalOther: nationalSplit.totalOther,
      awarderCount: nationalAwarderEiks.size,
    },
    settlements: [...settlements.entries()]
      .map(([ekatte, acc]) => {
        const ek = ekByCode.get(ekatte);
        return {
          ekatte,
          name: ek?.name ?? "?",
          province: ek?.province ?? "?",
          obshtina: ek?.obshtina ?? "?",
          contractCount: acc.contractCount,
          totalEur: splitBag(acc.totalByCurrency).totalEur,
          awarderCount: acc.awarders.size,
        };
      })
      .sort((a, b) => b.totalEur - a.totalEur),
  };
  fs.writeFileSync(
    path.join(BY_SETTLEMENT_DIR, "index.json"),
    canonicalJson(indexFile),
  );

  // Optional: write a list of unclassified-by-tier awarders so the operator
  // can curate the OVERRIDES table in awarder_tier.ts. Cheap to emit
  // and only material on a refresh.
  // (skipped here — generated by enrich_awarders_geo.ts during the one-shot
  //  enrichment, which has the full unclassified list anyway)

  return {
    settlementFiles: settlements.size,
    settlementsWithProcurement: settlements.size,
    localAwardersPinned,
    nationalAwarders: nationalAwarderEiks.size,
    awardersWithoutGeo,
  };
};

// Silence unused-import warnings — these helpers may be added back later
// as the shard schema evolves.
void toEur;
void yearOf;
