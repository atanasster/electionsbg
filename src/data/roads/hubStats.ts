// The /sector/roads hub's figures, read from the committed blob that
// `npm run db:gen-roads-hub-stats` derives from Postgres.
//
// WHY A BLOB: the hub must not download the ~3k-row contract corpus and run the
// roads engine to draw four numbers (dashboard-hub skill §1). The generator runs
// the SAME engine (buildRoadsModel, src/lib/roadAttributes.ts) in Node over the
// roll-up's rows (ROADS_SECTOR_EIKS — АПИ + НКСИП), so the hub's corridor/€/km
// figures and the sub-pages' cannot disagree about a rule. They agree about the
// BUYER SET only once the sub-pages model the roll-up too (plan T4); until then
// a sub-page shows АПИ alone and the hub's Струма includes НКСИП's €220.7M.
//
// The shape is declared ONCE, here, and imported by the generator.
//
// Every field is a number or a source string — no prose, no URLs. Money is €,
// counts are rows. Pairs a page compares (single-bid vs national) ship
// UN-DIVIDED so both sides are derived the same way.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { AnnexReasonCode } from "@/lib/annexReasons";

export interface RoadsHubStats {
  generatedAt: string;
  /** Earliest / latest contract date in the roll-up (ISO date). */
  firstDate: string | null;
  lastDate: string | null;
  procurement: {
    /** Contracts, consortium MEMBER rows excluded (they carry €0). */
    contracts: number;
    /** Σ amount_eur at tag='contract' — current value after annexes. Equals
     *  sector_stats.json all.roads; the data gate holds that. */
    eur: number;
    /** Distinct contractor keys holding money, member rows excluded. */
    contractors: number;
    singleBid: number;
    bidKnown: number;
    /** The national pair on the SAME basis (no member rows, migration 167's
     *  ex-member keys), whole corpus — the hub is unscoped. */
    nationalSingleBid: number;
    nationalBidKnown: number;
    /** € through direct / no-notice procedures (procedureBucket = "direct"). */
    directEur: number;
    /** Of `eur`, what annexes added (current − signing value). */
    growthEur: number;
  };
  /** The state in-house contractor (ROADS_INHOUSE_CONTRACTORS) as a SUPPLIER
   *  to the roll-up — never part of the buyer total. */
  inhouse: { eik: string; eur: number; contracts: number };
  /** Contract risk grades (contract_risk_cache), roll-up buyers, member rows
   *  and ungraded rows excluded — sums to at most `procurement.contracts`. */
  riskGrades: Record<string, number>;
  /** Top named corridors by € (engine roadRefOf), for the evidence rail. */
  topCorridors: { corridor: string; eur: number; contracts: number }[];
  /** Every corridor with ≥ €10M, for the finder (≈40 entries — the long tail
   *  of numbered roads would double the blob for rows nobody searches). */
  corridorIndex: { corridor: string; eur: number }[];
  /** ОПУ oblasts (engine regionOf), for the finder. MULTI_REGION included. */
  regionIndex: { region: string; eur: number }[];
  /** The year with the most €, and how much of it is annex growth. */
  peakYear: { year: string; eur: number; growthEur: number } | null;
  coverage: {
    /** € share the engine places on a named road (0..1). */
    refCoverageEur: number;
    /** Rows that carry a defensible €/km (eurPerKmOf). */
    perKmRows: number;
  };
  /** Contracts at exactly +50% (current = 1.5 × signing), the pre-set option
   *  cluster (plan R9). Grouped by the annex's own change_reason. */
  annexOptions: {
    contracts: number;
    currentEur: number;
    growthEur: number;
    byReason: {
      reason: AnnexReasonCode;
      contracts: number;
      growthEur: number;
    }[];
    nationalContracts: number;
    nationalGrowthEur: number;
  };
  /** ИСУН projects whose beneficiary is a roll-up EIK — a DIFFERENT corpus and
   *  basis (project total), never summed with procurement. */
  euFunds: { projects: number; totalEur: number; paidEur: number };
}

/** 404 → null: a checkout that has never run the generator renders the hub
 *  without numbers, not an error. null is „no figure" — never 0. */
export const useRoadsHubStats = () =>
  useQuery({
    queryKey: ["roads", "hub-stats"] as const,
    queryFn: async (): Promise<RoadsHubStats | null> => {
      const r = await fetch(dataUrl("/roads/derived/hub_stats.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return r.json() as Promise<RoadsHubStats>;
    },
    staleTime: Infinity,
  });
