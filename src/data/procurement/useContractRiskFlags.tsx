// Per-contract red-flag evaluation hooks: they load the corpus-wide index files
// (debarred suppliers, awarder→contractor concentration, MP-connected
// contractors, CPV competition baseline) and feed them to the pure, React-free
// scorer in computeProcurementRisk.ts.
//
// ⚠️ NOT the path the CONTRACT screens take any more. Since T1.2 they decode the
// server's per-row masks (src/lib/contractRiskMask.ts) — same 12 checks, computed
// once in Postgres, no 1.29 MB download. What still routes through here is the
// TENDER side (TenderDetailScreen, ProjectFileScreen), which has no per-row index
// to decode. See docs/plans/db-payload-diet-v1.md.
//
// The previous version of this header claimed the scorer was shared with "the
// flow link-colouring, the My-Area alerts builder, and the AI tools". None of the
// three imports it — the AI tools import the risk-indexes PAYLOAD
// (ai/tools/fiscal.ts), not the scorer — and chasing those phantom consumers cost
// an audit pass.

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
import { useNgoForeignFundedByEik } from "./usePepConnectedByEik";
import { useCompanyFoundedByEik } from "./useCompanyFoundedByEik";
import { useSplitPurchase } from "./useSplitPurchase";

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
 *  `useContractRiskScorer()` to amortise the lookups.
 *
 *  ⚠️ NO CALLERS as of T1.2. The contract screens now decode the server's masks
 *  (src/lib/contractRiskMask.ts) instead of scoring in the browser, so this and
 *  `useContractRiskScorer` survive only for the two TENDER-side screens
 *  (TenderDetailScreen, ProjectFileScreen) that have no per-row index to decode.
 *  Kept rather than deleted because T2 revisits both; if that lands and they are
 *  still unused, delete them along with the seven index hooks. */
export const useContractRiskFlags = (
  contract: ProcurementContract | null | undefined,
): { result: ContractRiskResult | null; isLoading: boolean } => {
  const { debarred, isLoading: debarredLoading } = useDebarred();
  const { index: concentration, isLoading: concLoading } =
    useAwarderConcentration();
  const { index: mpConn, isLoading: mpLoading } = useMpConnectedContractors();
  const { index: cpv, isLoading: cpvLoading } = useCpvCompetition();
  const { set: pepSet, isLoaded: pepLoaded } = usePepConnectedEikSet();
  const { byEik: foundedByEik, isLoaded: foundedLoaded } =
    useCompanyFoundedByEik();
  const { byKey: splitPurchaseByKey } = useSplitPurchase();
  const { byEik: ngoForeignFundedByEik } = useNgoForeignFundedByEik();

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
      foundedByEik: foundedLoaded ? foundedByEik : undefined,
      splitPurchaseByKey,
      ngoForeignFundedByEik,
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
    foundedByEik,
    foundedLoaded,
    splitPurchaseByKey,
    ngoForeignFundedByEik,
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
  const { byEik: foundedByEik, isLoaded: foundedLoaded } =
    useCompanyFoundedByEik();
  const { byKey: splitPurchaseByKey } = useSplitPurchase();
  const { byEik: ngoForeignFundedByEik } = useNgoForeignFundedByEik();

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
        foundedByEik: foundedLoaded ? foundedByEik : undefined,
        splitPurchaseByKey,
        ngoForeignFundedByEik,
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
    foundedByEik,
    ngoForeignFundedByEik,
    foundedLoaded,
    splitPurchaseByKey,
  ]);

  return {
    scoreRow,
    isLoading: debarredLoading || concLoading || mpLoading || cpvLoading,
  };
};
