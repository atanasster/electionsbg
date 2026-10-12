// The /water hub's figures, read from the committed blob that
// `npm run db:gen-water-hub-stats` derives from Postgres plus the two committed
// water artifacts (docs/plans/water-hub-v1.md T2).
//
// WHY A BLOB: the hub must not fetch the group model, the funds rollup, the НСИ
// series and the 306 KB riverbed file to draw four numbers (dashboard-hub skill
// §1). The shape is declared ONCE, here, and imported by the generator.
//
// Numbers only — no prose, no URLs. Pairs a page compares (single-bid vs the
// national rate) ship UN-DIVIDED so both sides are derived the same way. Fields
// added after the first blob are optional, so an older blob still renders.
//
// ⚠️ FOUR BASES, NEVER SUMMED: `procurement` is the operators' ЗОП spend
// (WATER_SECTOR_EIKS, tag='contract'); `euFunds` is ИСУН contracted/paid over the
// whole programme period; `services` is an НСИ population share; `riverbed` is a
// TOPIC selection over every awarder in the corpus.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { VikCategory } from "@/lib/vikAttributes";

// Every key below is read by the hub (skill rule: a hub blob carries only what
// its head and tiles render). Add a field when a tile needs it, not before.
export interface WaterHubStats {
  procurement: {
    /** Σ amount_eur at tag='contract' over WATER_SECTOR_EIKS. Equals
     *  sector_stats.json all.water; the data gate holds that. */
    eur: number;
    /** Contracts, consortium MEMBER rows excluded (they carry €0) — the basis
     *  the water browse pack lists (excludeConsortiumMembers). */
    contracts: number;
    /** The same pair on the ex-member basis: the water rate and its national
     *  baseline (migration 167's ex-member keys), whole corpus — the hub is
     *  unscoped. */
    singleBid: number;
    bidKnown: number;
    nationalSingleBid: number;
    nationalBidKnown: number;
    firstDate: string | null;
  };
  /** The register's composition: every EIK in the sector, and how many of them
   *  are water OPERATORS (holding_sub, municipal, concession) as opposed to the
   *  holding parent, Напоителни and ДП УСЯ (G11). */
  register: { eiks: number; operators: number; liveOperators: number };
  /** Top water OPERATORS by € (whole corpus; WATER_OPERATOR_TYPES only), for
   *  the evidence rail. */
  topOperators: { eik: string; name: string; eur: number }[];
  /** Every operator's € (whole corpus), for the finder. */
  operatorIndex: { eik: string; eur: number }[];
  /** € by water function (src/lib/vikAttributes.ts categoryOfCpv). No count:
   *  awarder_group_model counts consortium member rows, so a count here would
   *  sit on a different basis from `procurement.contracts`. */
  functions: { id: VikCategory; eur: number }[];
  /** W2: money that stays inside the sector — a water EIK awarding a contract to
   *  another water EIK (loans to the holding) or to itself. IN the headline and
   *  disclosed; the concentration tile labels these suppliers „в групата" rather
   *  than filtering them (W2 as amended at T4). */
  intraGroup: {
    eur: number;
    contracts: number;
    /** Of the above, loans to Български ВиК холдинг (title: заем). */
    loansToHoldingEur: number;
    loansToHoldingContracts: number;
    /** Of the above, an awarder that is its own contractor (D5). */
    selfEur: number;
    selfContracts: number;
  };
  /** Credit facilities bought from outside the sector (title: заем / кредит /
   *  овърдрафт) — disclosed, not excluded: a bank is an external supplier. */
  credits: { eur: number; contracts: number };
  /** ИСУН — fund_beneficiaries over WATER_SECTOR_EIKS, lifetime (W4). */
  euFunds: {
    beneficiaries: number;
    contractedEur: number;
    paidEur: number;
  };
  /** НСИ Ecology_9.8, latest year (data/water/water_stats.json). Percent of
   *  the population; null where НСИ publishes no value for that year. */
  services: {
    year: number;
    rationingPct: number | null;
    wasteTreatmentPct: number | null;
  } | null;
  /** data/water/flood_maintenance.json — the riverbed TOPIC (W5). */
  riverbed: { eur: number; contracts: number; corpusThrough: string | null };
}

/** 404 → null: a checkout that has never run the generator renders the hub
 *  without numbers, not an error. null is „no figure" — never 0. */
export const useWaterHubStats = () =>
  useQuery({
    queryKey: ["water", "hub-stats"] as const,
    queryFn: async (): Promise<WaterHubStats | null> => {
      const r = await fetch(dataUrl("/water/derived/hub_stats.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return r.json() as Promise<WaterHubStats>;
    },
    staleTime: Infinity,
  });
