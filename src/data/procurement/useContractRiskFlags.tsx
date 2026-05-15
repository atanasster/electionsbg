// Per-contract red-flag evaluation. Composes three already-loaded indexes
// (debarred suppliers, awarder→contractor concentration, MP-connected
// contractors) plus the contract row itself (for amendment detection) and
// emits a small flag set + a 0..100 risk score. The score is intentionally
// blunt — meant to drive sorting and a visual badge, not legal evidence.
//
// Future signals not wired here because the upstream ingest drops them
// (number of bidders, tender deadline, procurement-method rationale):
// extending the OCDS normalizer to keep those is a separate change.

import { useMemo } from "react";
import type {
  AwarderConcentrationEntry,
  DebarredEntry,
  ProcurementContract,
} from "@/data/dataTypes";
import { useDebarred, normalizeContractorName } from "./useDebarred";
import { useAwarderConcentration } from "./useAwarderConcentration";
import { useMpConnectedContractors } from "./useMpConnectedContractors";

export type ContractRiskFlags = {
  /** Contractor's declared officers / owners include a sitting or former MP. */
  mpConnected: boolean;
  /** Contractor appears on the АОП "Стопански субекти с нарушения" register. */
  debarred: DebarredEntry | null;
  /** ≥ thresholdPct of the awarder's lifetime spending goes to this
   *  contractor — i.e., a single supplier dominates the buyer's procurement. */
  awarderConcentration: AwarderConcentrationEntry | null;
  /** Row is a post-award contract amendment (often used to inflate the value
   *  beyond the original procedure's award). */
  isAmendment: boolean;
};

export type ContractRiskResult = {
  flags: ContractRiskFlags;
  /** 0–100 composite score. Each signal adds a weight; capped at 100. */
  score: number;
  /** True when any flag is set. Drives "show the badge column" decisions. */
  hasFlag: boolean;
};

// Weights chosen to make MP-connection the heaviest single signal (it's the
// most editorially loaded), debarred next, awarder concentration moderate,
// amendment alone the lightest. Multiple signals stack additively up to 100.
const WEIGHT_MP_CONNECTED = 50;
const WEIGHT_DEBARRED = 80;
const WEIGHT_HIGH_CONCENTRATION = 30;
const WEIGHT_AMENDMENT = 10;

export const computeRiskFlags = (
  contract: ProcurementContract,
  args: {
    debarredByName: Map<string, DebarredEntry>;
    concentrationByPair: Map<string, AwarderConcentrationEntry>;
    mpConnectedEiks: Map<string, unknown>;
  },
): ContractRiskResult => {
  const mpConnected = args.mpConnectedEiks.has(contract.contractorEik);
  const debarred =
    args.debarredByName.get(normalizeContractorName(contract.contractorName)) ??
    null;
  const concentration =
    args.concentrationByPair.get(
      `${contract.awarderEik}|${contract.contractorEik}`,
    ) ?? null;
  const isAmendment = contract.tag === "contractAmendment";

  let score = 0;
  if (mpConnected) score += WEIGHT_MP_CONNECTED;
  if (debarred) score += WEIGHT_DEBARRED;
  if (concentration) score += WEIGHT_HIGH_CONCENTRATION;
  if (isAmendment) score += WEIGHT_AMENDMENT;
  score = Math.min(100, score);

  return {
    flags: {
      mpConnected,
      debarred,
      awarderConcentration: concentration,
      isAmendment,
    },
    score,
    hasFlag: mpConnected || !!debarred || !!concentration || isAmendment,
  };
};

/** Hook variant — for use inside a single contract detail row. Internally
 *  loads the three index files; consumers in tables should use
 *  `useContractRiskFlagsFor(contracts)` to amortise the lookups. */
export const useContractRiskFlags = (
  contract: ProcurementContract | null | undefined,
): { result: ContractRiskResult | null; isLoading: boolean } => {
  const { debarred, isLoading: debarredLoading } = useDebarred();
  const { index: concentration, isLoading: concLoading } =
    useAwarderConcentration();
  const { index: mpConn, isLoading: mpLoading } = useMpConnectedContractors();

  const result = useMemo(() => {
    if (!contract) return null;
    return computeRiskFlags(contract, {
      debarredByName: debarred.byName,
      concentrationByPair: concentration.byPair,
      mpConnectedEiks: mpConn.byContractorEik,
    });
  }, [contract, debarred.byName, concentration.byPair, mpConn.byContractorEik]);

  return {
    result,
    isLoading: debarredLoading || concLoading || mpLoading,
  };
};

/** Table-friendly variant — load the three indexes once, return a function
 *  that scores any row. Use this from a column accessor to avoid running
 *  three useMemo subscriptions per row. */
export const useContractRiskScorer = (): {
  scoreRow: (contract: ProcurementContract) => ContractRiskResult;
  isLoading: boolean;
} => {
  const { debarred, isLoading: debarredLoading } = useDebarred();
  const { index: concentration, isLoading: concLoading } =
    useAwarderConcentration();
  const { index: mpConn, isLoading: mpLoading } = useMpConnectedContractors();

  const scoreRow = useMemo(() => {
    return (contract: ProcurementContract) =>
      computeRiskFlags(contract, {
        debarredByName: debarred.byName,
        concentrationByPair: concentration.byPair,
        mpConnectedEiks: mpConn.byContractorEik,
      });
  }, [debarred.byName, concentration.byPair, mpConn.byContractorEik]);

  return {
    scoreRow,
    isLoading: debarredLoading || concLoading || mpLoading,
  };
};
