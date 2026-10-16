// The /sector/transport hub's figures, read from the committed blob that
// `npm run db:gen-transport-hub-stats` derives from Postgres
// (docs/plans/transport-hub-v1.md T2).
//
// WHY A BLOB: the hub must not fetch the group model, the ministry's per-CPV
// split, the funds rollup and the project map to draw four numbers (dashboard-hub
// skill §1). The shape is declared ONCE, here, and imported by the generator.
//
// Numbers only — no prose, no URLs. Pairs a page compares ship UN-DIVIDED so both
// sides are derived the same way. Fields added after the first blob are optional,
// so an older blob still renders.
//
// ⚠️ BASES, NEVER SUMMED: `procurement` is the awarder-side ЗОП Σ over
// TRANSPORT_SECTOR_EIKS at tag='contract' (= sector_stats.json all.transport);
// `inGroup` and `publicContractors` are SUBSETS of it, disclosed, never netted
// (D5); `euFunds` is ИСУН fund_projects on the grant basis (D6), lifetime.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { TransportUniverse } from "@/lib/transportReferenceData";

export interface TransportHubStats {
  generatedAt: string;
  procurement: {
    /** Σ amount_eur at tag='contract' — current value after annexes. Equals
     *  sector_stats.json all.transport; the data gate holds that. */
    eur: number;
    /** Contracts, consortium MEMBER rows excluded (they carry €0) — the basis the
     *  transport browse pack lists (excludeConsortiumMembers). */
    contracts: number;
    /** Ex-member single-bid pair, and its bid-KNOWN coverage over `contracts`. */
    singleBid: number;
    bidKnown: number;
    /** The national pair on the same basis (167's ex-member keys), whole corpus —
     *  the hub is unscoped. */
    nationalSingleBid: number;
    nationalBidKnown: number;
    firstDate: string | null;
    lastDate: string | null;
  };
  /** € per mode with the ministry's PSO (6021*) and rolling stock (346*)
   *  re-attributed to rail (D8), and the raw by-awarder € beside it. */
  modes: { universe: TransportUniverse; eur: number; rawEur: number }[];
  /** Contracts between group members, plus those to the in-group contractors
   *  (ТСВ ЕАД — D4). A subset of `procurement.eur`. */
  inGroup: {
    eur: number;
    contracts: number;
    contractorEur: number;
    /** Of `eur`, the rail PSO estimate МТС → БДЖ-ПП (isPsoAward over in-group
     *  rows): a multi-year „прогнозна стойност", most of the in-group € —
     *  transport-hub-v1 audit 2026-10-17 (T7). Optional for older blobs. */
    psoEur?: number;
  };
  /** Public bodies outside the sector paid by the group (Пощи, НЕК … — D9).
   *  `consortiumEur` is the FULL value of consortia they were members of — a
   *  different basis, never added to `eur`. */
  publicContractors: { eur: number; contracts: number; consortiumEur?: number };
  /** Σ procurement_annexes.value_diff_eur over the set — a FLOOR: annex data
   *  starts in 2020 (G5). */
  annexGrowthEur: number;
  /** The rail PSO awards (МТС + CPV 6021*): multi-year estimates (G2). */
  pso: { eur: number; contracts: number };
  /** Pass-through spend (G9, as narrowed by the audit of 2026-10-17, T6): STAFF
   *  BENEFITS only — food vouchers, food in kind, the pension top-up. Captioned
   *  where it ranks. */
  passThrough: { staffBenefits: number };
  /** The operator's running inputs — traction fuel, electricity (incl. grid
   *  access), insurance. NOT pass-through; disclosed, never captioned as such. */
  operatingInputs: { fuel: number; electricity: number; insurance: number };
  /** „Без обявление" over method-KNOWN € (A4), with the coverage. */
  direct: { directEur: number; knownEur: number };
  /** Top bodies by € (evidence rail). */
  topBodies: { eik: string; name: string; eur: number }[];
  /** Every body's € (the finder). */
  bodyIndex: { eik: string; eur: number }[];
  /** The VERIFY list's bodies (D3) and their awarder €: shown, never summed. */
  verifyIndex?: { eik: string; eur: number }[];
  /** Top map features by € (the finder) and the map's placed share (C3). */
  topSegments: { aTown: string; bTown: string; eur: number }[];
  mapCoverage: { placedEur: number; totalEur: number };
  /** ИСУН, grant basis (D6), WITHOUT the projects TRANSPORT_EU_FUNDS_EXCLUDED
   *  declares out of the sector (the RRP broadband project — audit 2026-10-17, T2).
   *  No total project value: a phased project carries its total once per phase,
   *  so summing it double-counts (T3). */
  euFunds: {
    beneficiaries: number;
    grantEur: number;
    paidEur: number;
    /** The excluded projects' grant — stated in the caption, never added. */
    excludedGrantEur?: number;
  };
}

/** 404 → null: a checkout that has never run the generator renders the hub
 *  without numbers, not an error. null is „no figure" — never 0. */
export const useTransportHubStats = () =>
  useQuery({
    queryKey: ["transport", "hub-stats"] as const,
    queryFn: async (): Promise<TransportHubStats | null> => {
      const r = await fetch(dataUrl("/transport/derived/hub_stats.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return r.json() as Promise<TransportHubStats>;
    },
    staleTime: Infinity,
  });
