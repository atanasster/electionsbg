// Per-contract red-flag evaluation hooks. The scoring logic lives in the pure,
// React-free module computeProcurementRisk.ts (shared with the flow
// link-colouring, the My-Area alerts builder, and the AI tools). These hooks
// just load the index files (debarred suppliers, awarder→contractor
// concentration, MP-connected contractors, CPV competition baseline) and feed
// them to the scorer.

import { useMemo } from "react";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  computeProcurementRisk,
  type ContractRiskResult,
} from "./computeProcurementRisk";
import { useDebarred, normalizeContractorName } from "./useDebarred";
import { useAwarderConcentration } from "./useAwarderConcentration";
import { useMpConnectedContractors } from "./useMpConnectedContractors";
import { useCpvCompetition } from "./useCpvCompetition";
import { usePepConnectedEikSet } from "./usePepConnectedByEik";

// Re-export the scorer types + function so existing import sites
// (`@/data/procurement/useContractRiskFlags`) keep resolving.
export type {
  ContractRiskFlags,
  ContractRiskResult,
  RiskComponent,
  RiskComponentKey,
} from "./computeProcurementRisk";
export { computeProcurementRisk } from "./computeProcurementRisk";

/** Backwards-compatible alias for the pre-refactor pure entry point. */
export const computeRiskFlags = computeProcurementRisk;

/** Hook variant — for use inside a single contract detail row. Internally
 *  loads the index files; consumers in tables should use
 *  `useContractRiskScorer()` to amortise the lookups. */
export const useContractRiskFlags = (
  contract: ProcurementContract | null | undefined,
): { result: ContractRiskResult | null; isLoading: boolean } => {
  const { debarred, isLoading: debarredLoading } = useDebarred();
  const { index: concentration, isLoading: concLoading } =
    useAwarderConcentration();
  const { index: mpConn, isLoading: mpLoading } = useMpConnectedContractors();
  const { index: cpv, isLoading: cpvLoading } = useCpvCompetition();
  const { set: pepSet, isLoaded: pepLoaded } = usePepConnectedEikSet();

  const result = useMemo(() => {
    if (!contract) return null;
    return computeProcurementRisk(contract, {
      debarredByName: debarred.byName,
      concentrationByPair: concentration.byPair,
      mpConnectedEiks: mpConn.byContractorEik,
      pepConnectedEiks: pepLoaded ? pepSet : undefined,
      cpvSingleBidShare: cpv.byDivision,
      structuralSingleBidShare: cpv.structuralSingleBidShare,
      cpvBidderMedian: cpv.bidderMedianByCpv5,
      normalizeName: normalizeContractorName,
    });
  }, [
    contract,
    debarred.byName,
    concentration.byPair,
    mpConn.byContractorEik,
    pepSet,
    pepLoaded,
    cpv.byDivision,
    cpv.bidderMedianByCpv5,
    cpv.structuralSingleBidShare,
  ]);

  return {
    result,
    isLoading: debarredLoading || concLoading || mpLoading || cpvLoading,
  };
};

/** Table-friendly variant — load the indexes once, return a function that
 *  scores any row. Use this from a column accessor to avoid running multiple
 *  useMemo subscriptions per row. */
export const useContractRiskScorer = (): {
  scoreRow: (contract: ProcurementContract) => ContractRiskResult;
  isLoading: boolean;
} => {
  const { debarred, isLoading: debarredLoading } = useDebarred();
  const { index: concentration, isLoading: concLoading } =
    useAwarderConcentration();
  const { index: mpConn, isLoading: mpLoading } = useMpConnectedContractors();
  const { index: cpv, isLoading: cpvLoading } = useCpvCompetition();
  const { set: pepSet, isLoaded: pepLoaded } = usePepConnectedEikSet();

  const scoreRow = useMemo(() => {
    return (contract: ProcurementContract) =>
      computeProcurementRisk(contract, {
        debarredByName: debarred.byName,
        concentrationByPair: concentration.byPair,
        mpConnectedEiks: mpConn.byContractorEik,
        pepConnectedEiks: pepLoaded ? pepSet : undefined,
        cpvSingleBidShare: cpv.byDivision,
        structuralSingleBidShare: cpv.structuralSingleBidShare,
        cpvBidderMedian: cpv.bidderMedianByCpv5,
        normalizeName: normalizeContractorName,
      });
  }, [
    debarred.byName,
    concentration.byPair,
    mpConn.byContractorEik,
    pepSet,
    pepLoaded,
    cpv.byDivision,
    cpv.bidderMedianByCpv5,
    cpv.structuralSingleBidShare,
  ]);

  return {
    scoreRow,
    isLoading: debarredLoading || concLoading || mpLoading || cpvLoading,
  };
};
