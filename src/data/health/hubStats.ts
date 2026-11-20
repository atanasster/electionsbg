// The /sector/health hub's figures, read from the committed blob that
// `pnpm run db:gen-health-hub-stats` derives from Postgres and the committed B1
// history (docs/plans/health-hub-v1.md T2). The shape is declared ONCE, here,
// and imported by the generator.
//
// Numbers only — no prose, no URLs. Rate pairs ship UN-DIVIDED so both sides of a
// comparison are derived the same way. Fields added after the first blob are
// optional, so an older blob still renders.
//
// ⚠️ FOUR BASES, NEVER SUMMED:
//   · `nzok`        — НЗОК's B1 cash expenditure for `year` (KPI 1). The whole.
//   · `payments`    — what НЗОК paid hospitals under contract that year. KPI 2 is
//                     its `careEur`: hospital care + devices, WITHOUT the `drugs`
//                     stream, because those drugs are also in `medicines`.
//   · `medicines`   — every reimbursed medicine that year, by INN (KPI 3) — the
//                     pharmacy AND the hospital-administered ones (the per-INN
//                     file carries pembrolizumab, an infusion). KPI 2 and KPI 3
//                     are DISJOINT PARTS of KPI 1, paid out of it, and their SUM
//                     must stay below it (the generator asserts it).
//   · `procurement` — awarder-side ЗОП Σ over HEALTH_SECTOR_EIKS (KPI 4), a
//                     different corpus and basis, all years. Framework CEILINGS
//                     (087's joint_kind='framework', ceiling/N shares) are never
//                     in `eur`: they are `frameworkCeilingEur`, on their own line
//                     (D3).
// ⚠️ revenueEur is ЕБК section А, OWN revenue only — the state transfer is
// `transfersEur` (section В). revenue − expenditure is NOT a balance; render
// `balanceEur` (A3).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { HealthUniverse } from "@/lib/healthReferenceData";

/** A competition pair on the ex-consortium-member basis (167's ex-member keys). */
export interface CompetitionPair {
  singleBid: number;
  bidKnown: number;
}

export type HealthPaymentStream = "bmp" | "drugs" | "devices";

export interface HealthHubStats {
  generatedAt: string;
  /** The one year KPIs 1–3 are stated for: the latest year COMPLETE in all
   *  three corpora (B1 has December, payments have 12 months in EVERY stream,
   *  medicines have 4 quarters), so the two parts can be read against their
   *  whole. */
  year: number;
  /** KPI 1 — НЗОК B1 for `year`, December YTD. */
  nzok: {
    expenditureEur: number;
    revenueEur: number | null;
    transfersEur: number | null;
    balanceEur: number | null;
  };
  /** Every year with a December B1 point, ascending (the money page). */
  nzokByYear: {
    year: number;
    expenditureEur: number;
    revenueEur: number | null;
    transfersEur: number | null;
    balanceEur: number | null;
  }[];
  /** Hospital payments for `year`, all three streams. `facilities` are distinct
   *  registration numbers with a NON-ZERO month (A2: the corpus carries
   *  placeholder €0 rows); `placeholderRows` counts what that filter dropped.
   *  KPI 2 is `careEur`/`careFacilities` — the same without the `drugs` stream,
   *  which `medicines` already holds. */
  payments: {
    eur: number;
    facilities: number;
    careEur: number;
    careFacilities: number;
    byStream: {
      stream: HealthPaymentStream;
      eur: number;
      facilities: number;
    }[];
    placeholderRows: number;
    lastPeriod: string;
  };
  /** KPI 3 — every reimbursed medicine for `year` (pharmacy + hospital), by INN. */
  medicines: { eur: number; inns: number };
  /** KPI 4 — the roster's procurement, all years, framework ceilings excluded. */
  procurement: {
    eur: number;
    /** Contracts, consortium MEMBER rows and framework rows excluded. */
    contracts: number;
    singleBid: number;
    bidKnown: number;
    /** The whole corpus, ex-members, same (all-years) window. It still holds the
     *  corpus's 475 bid-known framework rows (0.18% of the denominator) — 167
     *  has no framework switch, and the sector side excludes them. */
    nationalSingleBid: number;
    nationalBidKnown: number;
    frameworkCeilingEur: number;
    frameworkCeilingContracts: number;
    nullAmountContracts: number;
    firstDate: string | null;
    lastDate: string | null;
    /** Distinct roster institutions (retired EIKs folded) that awarded anything. */
    institutions: number;
  };
  /** Per universe, ranked by €, each with its own pair (A7: never blended). */
  universes: ({
    universe: HealthUniverse;
    eur: number;
    contracts: number;
    frameworkCeilingEur: number;
  } & CompetitionPair)[];
  /** Per calendar year: contracts € and the ceilings, side by side (D3). */
  byYear: { year: string; eur: number; frameworkCeilingEur: number; contracts: number }[]; // prettier-ignore
  /** Top contractors, grouped by EIK, named by their LATEST spelling (A4). */
  topContractors: { eik: string; name: string; eur: number; contracts: number }[]; // prettier-ignore
  /** The evidence rail: top hospitals by `year` payments (legal entity). */
  topHospitals: { eik: string; name: string; eur: number }[];
  /** Every roster institution's € (the finder; retired EIKs folded). */
  bodyIndex: { eik: string; eur: number }[];
  /** ИСУН, grant basis, lifetime, beneficiaries in the roster. */
  euFunds: { beneficiaries: number; projects: number; grantEur: number; paidEur: number }; // prettier-ignore
}

/** 404 → null: a checkout that has never run the generator renders the hub
 *  without numbers, not an error. null is „no figure" — never 0. */
export const useHealthHubStats = () =>
  useQuery({
    queryKey: ["health", "hub-stats"] as const,
    queryFn: async (): Promise<HealthHubStats | null> => {
      const r = await fetch(dataUrl("/health/derived/hub_stats.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return r.json() as Promise<HealthHubStats>;
    },
    staleTime: Infinity,
  });
