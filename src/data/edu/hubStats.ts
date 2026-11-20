// The /sector/edu hub's figures, read from the committed blob that
// `pnpm run db:gen-edu-hub-stats` derives from Postgres (docs/plans/edu-hub-v1.md
// T2). The shape is declared ONCE, here, and imported by the generator.
//
// Numbers only — no prose, no URLs. Rate pairs ship UN-DIVIDED so both sides of a
// comparison are derived the same way. Fields added after the first blob are
// optional, so an older blob still renders.
//
// ⚠️ BASES, NEVER SUMMED: `procurement` is the awarder-side ЗОП Σ over
// EDU_SECTOR_EIKS at tag='contract' (current value after annexes); `inGroup` and
// `stateTransfers` are SUBSETS of it, disclosed, never netted (A10/A11);
// `euFunds` is ИСУН fund_projects on the GRANT basis, lifetime — a different
// corpus and a different basis from procurement.

import type { FundsByProgrammeRow } from "@/lib/fundProgrammes";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { EducationUniverse } from "@/lib/educationReferenceData";

/** A competition pair on the ex-consortium-member basis (167's ex-member keys). */
export interface CompetitionPair {
  singleBid: number;
  bidKnown: number;
}

export interface EduHubStats {
  generatedAt: string;
  procurement: {
    /** Σ amount_eur at tag='contract' over the roster. */
    eur: number;
    /** Contracts, consortium MEMBER rows excluded (they carry €0). */
    contracts: number;
    singleBid: number;
    bidKnown: number;
    /** The whole corpus on the same basis and window (unscoped: all years). The
     *  „other buyers" baseline is national − sector, derived by the consumer. */
    nationalSingleBid: number;
    nationalBidKnown: number;
    /** Contracts with no amount (A9) — excluded from every € and every ranking. */
    nullAmountContracts: number;
    firstDate: string | null;
    lastDate: string | null;
    /** Distinct institutions (retired EIKs folded) that awarded anything. */
    institutions: number;
  };
  /** Per universe, ranked by €, with its own competition pair (T4). */
  universes: ({ universe: EducationUniverse; eur: number; contracts: number } & CompetitionPair)[]; // prettier-ignore
  /** € and contracts per calendar year (the 2020 corpus hole is A8). */
  byYear: { year: string; eur: number; contracts: number }[];
  /** Contracts from one roster body to another (A11). A subset of `procurement`. */
  inGroup: { eur: number; contracts: number };
  /** Financing agreements to state bodies booked as contracts (A10). A subset. */
  stateTransfers: { eur: number; contracts: number };
  /** Top contractors; `utilityShare` is the share of their € from this sector in
   *  regulated network-supply CPVs (0931 electricity, 0932 heat, 09123
   *  gas, 65 utilities, 642 telecoms — not 091x motor fuel) — a regulated supply, not a
   *  market win (A12). */
  topContractors: { eik: string; name: string; eur: number; contracts: number; buyers: number; utilityShare: number }[]; // prettier-ignore
  /** МОН's school-bus purchases, CPV 3410x and 3412x (A13). */
  buses: {
    eur: number;
    contracts: number;
    singleBid: number;
    bidKnown: number;
    firstDate: string | null;
    lastDate: string | null;
    suppliers: { eik: string; name: string; eur: number; contracts: number }[];
  };
  /** Biggest PROCUREMENTS: the lots of one УНП folded into one row (A14). */
  topProcurements: { key: string; awarderEik: string; title: string; date: string; contractorName: string; eur: number; lots: number }[]; // prettier-ignore
  /** Top bodies by € (evidence rail), retired EIKs folded into their successor. */
  topBodies: { eik: string; name: string; eur: number }[];
  /** Every institution's € (the finder; retired EIKs folded). */
  bodyIndex: { eik: string; eur: number }[];
  /** VERIFY and ADJACENT bodies' own awarder €: shown, never summed. */
  verifyIndex: { eik: string; eur: number }[];
  adjacentIndex: { eik: string; eur: number }[];
  /** ИСУН, grant basis, lifetime, beneficiaries in the roster. */
  euFunds: { beneficiaries: number; projects: number; grantEur: number; paidEur: number }; // prettier-ignore
  /** `euFunds` per ИСУН programme, ranked by grant (T5). The corpus also holds
   *  the national Science Fund (BNSF) and EEA/Norway/Swiss programmes: see
   *  `fundProgrammeKind`. Optional — absent from blobs before T5. */
  fundsByProgramme?: FundsByProgrammeRow[];
  /** БАН and ССА on three corpora, three bases, NEVER summed (T5): awarder-side
   *  procurement, ИСУН grant, ДФЗ payout. `agri*` null = agri_subsidies was not
   *  loaded where the blob was generated — „not answerable", never 0. */
  research?: {
    universe: "research_ban" | "research_ssa";
    procurementEur: number;
    procurementContracts: number;
    grantEur: number;
    grantProjects: number;
    agriEur: number | null;
    agriPayments: number | null;
    agriFirstYear: number | null;
    agriLastYear: number | null;
  }[];
}

/** 404 → null: a checkout that has never run the generator renders the hub
 *  without numbers, not an error. null is „no figure" — never 0. */
export const useEduHubStats = () =>
  useQuery({
    queryKey: ["edu", "hub-stats"] as const,
    queryFn: async (): Promise<EduHubStats | null> => {
      const r = await fetch(dataUrl("/education/derived/hub_stats.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return r.json() as Promise<EduHubStats>;
    },
    staleTime: Infinity,
  });
