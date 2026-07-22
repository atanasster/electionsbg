// Consolidated risk-scorer indexes — ONE DB fetch (/api/db/
// procurement-risk-indexes → procurement_risk_indexes()) replacing the four
// static JSON index files the client-side risk scorer used to load
// (debarred.json, derived/awarder_concentration.json, the
// derived/mp_connected.json presence set and the pep-by-eik manifest, and
// derived/cpv_competition.json). The per-domain hooks (useDebarred,
// useAwarderConcentration, useCpvCompetition, useMpConnectedContractors,
// usePepConnectedEikSet) all read slices of this shared query, so any page
// showing contract rows costs exactly one indexes request.

import { useQuery } from "@tanstack/react-query";
import type {
  AwarderConcentrationEntry,
  CpvCompetitionDivision,
  SplitPurchaseEntry,
} from "@/data/dataTypes";

export type RiskIndexesPayload = {
  debarred: {
    entries: Array<{
      name: string;
      publishedAt: string | null;
      debarredUntil: string | null;
      detailsUrl: string | null;
    }>;
  };
  concentration: {
    thresholdPct: number;
    minAwarderTotalEur: number;
    entries: AwarderConcentrationEntry[];
  };
  mpConnected: Array<{ eik: string; mpId: number; mpName: string }>;
  pepConnectedEiks: string[];
  /** Contractor EIKs that are / are tied to a foreign-funded NGO. NEUTRAL
   *  disclosure surfaced on the contract page — not a scored risk flag. */
  ngoForeignFunded?: Array<{
    eik: string;
    kind: "direct" | "connected";
    ngoName: string;
    ngoEik: string;
    person: string | null;
    funder: string | null;
    eur: number | null;
  }>;
  cpvCompetition: {
    structuralSingleBidShare: number;
    divisions: CpvCompetitionDivision[];
  };
  /** 5-digit CPV prefix → median bidder count, competitive markets only
   *  (median ≥ 3). Baseline for the graded weak-competition flag. */
  cpvBidderMedians?: Record<string, number>;
  /** Contractor EIK → incorporation date (ISO), for firms founded 2018+ that
   *  appear as a contractor. Backs the newFirmWinner flag. */
  foundedByEik?: Record<string, string>;
  /** (buyer, supplier, CPV-div, year) groups matching the split-purchase
   *  pattern. Backs the splitPurchase flag. */
  splitPurchase?: SplitPurchaseEntry[];
};

const fetchRiskIndexes = async (): Promise<RiskIndexesPayload | null> => {
  const r = await fetch("/api/db/procurement-risk-indexes");
  if (!r.ok) return null;
  return (await r.json()) as RiskIndexesPayload;
};

export const useRiskIndexes = () =>
  useQuery({
    queryKey: ["db", "procurement-risk-indexes"] as const,
    queryFn: fetchRiskIndexes,
    staleTime: Infinity,
    retry: false,
  });
