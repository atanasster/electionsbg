// Loads the precomputed textbook-publisher concentration payload
// (data/education/textbook_market.json, built by
// scripts/education/gen_textbook_market.ts from the CPV-22112 procurement slice).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { PublisherGroupId } from "@/lib/textbookPublishers";

export interface TextbookGroup {
  id: PublisherGroupId;
  eur: number;
  pct: number;
  contracts: number;
  entities: {
    eik: string | null;
    name: string;
    eur: number;
    contracts: number;
  }[];
}

export interface TextbookMarketFile {
  source: { publisher: string; cpv: string; note: string };
  latestYear: number;
  total: {
    eur: number;
    contracts: number;
    suppliers: number;
    schoolBuyers: number;
  };
  concentration: {
    hhiGroup: number;
    top1Pct: number;
    top2Pct: number;
    cr4Pct: number;
  };
  groups: TextbookGroup[];
  byYear: { year: number; eur: number; contracts: number }[];
  byBuyerType: {
    type: string;
    eur: number;
    contracts: number;
    buyers: number;
  }[];
}

const fetchTextbookMarket = async (): Promise<TextbookMarketFile> => {
  const r = await fetch(dataUrl("/education/textbook_market.json"));
  if (!r.ok) throw new Error("textbook market fetch failed");
  return r.json();
};

export const useTextbookMarket = () =>
  useQuery({
    queryKey: ["textbook-market"],
    queryFn: fetchTextbookMarket,
    staleTime: Infinity,
  });
