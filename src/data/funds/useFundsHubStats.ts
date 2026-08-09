// The /funds hub's ONE stat call (migration 145). Plan: docs/plans/funds-hub-v1.md §4.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// EVERY KEY NAMES ITS BASIS, and that is the whole design of this type rather than a naming
// preference. The plan's §4.2 measured six live basis forks in this corpus, each of which is a
// different TRUE sentence about the same subject:
//
//   absorption          53.8% on grant   ·  41.1% on contracted      12.7 points apart
//   beneficiaries       47 599 by name-or-EIK  ·  46 174 by EIK      1 425 organisations
//   oblasti             28 folded  ·  31 raw (S22/S23/S24/S25)
//   Interreg partners   983 orgs  ·  1 493 partnership rows          52% over-count
//
// A field called `absorptionPct` invites a consumer to pick a denominator by accident, which
// is exactly how six of six figures came out wrong on the parliament hub. So there is no
// `absorptionPct` here — there is `absorptionPctOfGrant` and `absorptionPctOfContracted`, and
// a caller has to say which one it means.
//
// THE TWO ARMS ARE SEPARATE OBJECTS. `isun` and `interreg` never share a key, because
// `fund_projects` holds zero Interreg rows (a system boundary — Interreg runs on Jems, not
// ИСУН) and the money is not even the same quantity: ИСУН publishes a contract value,
// `interreg.bgBudgetEur` is a partner's published budget. Nothing here may be summed across
// the two.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/data/judiciary/fetchJson";

export interface FundsHubIsunStats {
  contractCount: number;
  /** DISTINCT organisation, keyed EIK-or-name. 7 240 of 82 011 rows carry no EIK. */
  beneficiaryCount: number;
  /** The EIK-only count, carried so a surface can state the gap rather than imply there is
   *  none — and so the gate can assert the two have not been swapped. */
  beneficiaryCountEikOnly: number;
  programmeCount: number;
  /** Contract value, INCLUDING the beneficiary's own co-finance. */
  contractedEur: number;
  /** The public contribution alone. */
  grantEur: number;
  paidEur: number;
  /** paid ÷ grant — „усвояване", the public money disbursed against the public money committed. */
  absorptionPctOfGrant: number;
  /** paid ÷ contracted. A different sentence, 12.7 points lower. */
  absorptionPctOfContracted: number;
  /** Contracted value on rows that carry an oblast — what a map can actually plot. */
  placedContractedEur: number;
  /** …as a share of all contracted value. ~50%, because the 4.6% of rows with no oblast are
   *  the national-scope programmes and they hold half the money. A place surface declares
   *  THIS, never row coverage: „4.6% от договорите нямат място" is true and misleading. */
  placedMoneyPct: number;
  /** After `canon_oblast` folding: 28. The raw column has 31 because S22/S23/S24/S25 split
   *  Sofia city four ways. */
  oblastCount: number;
  settlementCount: number;
}

/** Figures that exist only to be a hub tile's metric.
 *
 *  SEPARATE from `isun` on purpose. Each is read from the same payload its DESTINATION page
 *  renders, so a tile cannot announce a number the page it links to disagrees with — and
 *  `registerBeneficiaries` (53 108, ИСУН's beneficiary register) is a different population from
 *  `isun.beneficiaryCount` (47 599, contract-derived). 5 509 organisations apart; folding them
 *  into one object would invite exactly that swap. */
export interface FundsHubTileStats {
  /** /funds/beneficiaries ranks the REGISTER, so the tile quotes the register. */
  registerBeneficiaries: number | null;
  highConcentrationProgrammes: number | null;
  politicalEiks: number | null;
  focusDossiers: number | null;
  dualCorpusCompanies: number | null;
}

export interface FundsHubStats {
  isun: FundsHubIsunStats;
  tiles: FundsHubTileStats;
  rrf: {
    contractCount: number;
    contractedEur: number;
    absorptionPctOfGrant: number;
  };
  interreg: {
    /** Every operation in the corpus, Bulgarian participation or not. */
    operationCount: number;
    /** Operations with at least one Bulgarian partner — 1 115 of 1 954. A surface about
     *  Bulgarian participation wants THIS one; publishing the other beside a tile that filters
     *  gives one page two „operations" counts 800 apart. */
    bgOperationCount: number;
    /** Partnership ENTRIES. An organisation on five operations is five rows. */
    bgPartnerRowCount: number;
    /** DISTINCT organisations — 983 against 1 493 rows. Use this for „партньори". */
    bgPartnerOrgCount: number;
    /** A published partner budget, NOT a contract value. Never added to an ИСУН figure. */
    bgBudgetEur: number;
  };
}

/**
 * `null` is an ANSWER, not a loading state — a database without migration 145, or with the
 * matview created `WITH NO DATA`, degrades to it. The hub renders its tiles without figures
 * rather than a grid of zeroes, per the skill's §1.
 */
export const useFundsHubStats = () =>
  useQuery({
    queryKey: ["funds", "hub-stats"] as const,
    queryFn: async (): Promise<FundsHubStats | null> =>
      await fetchJson<FundsHubStats | null>("/api/db/funds-hub-stats"),
    // Moves only when the funds corpus reloads and the loader REFRESHes the matview.
    staleTime: 60 * 60_000,
  });
