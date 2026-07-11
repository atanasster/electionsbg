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
  /** Real number of legal entities in the group (may exceed `entities.length`,
   *  which is capped at 6 for the drill-down). Use this for the "N фирми" label. */
  entityCount: number;
  /** Euros in the entities beyond the top 6, so the drill-down still reconciles
   *  to the group total (0 when the group has ≤6 entities). */
  restEur: number;
  /** Top 6 legal entities by spend; the tail is folded into `restEur`. */
  entities: {
    eik: string | null;
    name: string;
    eur: number;
    contracts: number;
  }[];
}

export interface TextbookBuyerType {
  type: string;
  eur: number;
  contracts: number;
  buyers: number;
}

export interface TextbookConcentration {
  hhiGroup: number;
  top1Pct: number;
  top2Pct: number;
  cr4Pct: number;
}

/** The scope-able core of the market: full-corpus at the top level, and one of
 *  these per calendar year under `yearly` (so the tile can honour the "Години"
 *  scope pill by swapping the whole view). */
export interface TextbookMarketSlice {
  total: {
    eur: number;
    contracts: number;
    suppliers: number;
    schoolBuyers: number;
  };
  concentration: TextbookConcentration;
  groups: TextbookGroup[];
  byBuyerType: TextbookBuyerType[];
}

export interface TextbookMarketFile extends TextbookMarketSlice {
  source: { publisher: string; cpv: string; note: string };
  /** Latest calendar year with spend — metadata only; the tile derives its
   *  period label from `byYear`, so nothing in the UI reads this today. */
  latestYear: number;
  byYear: { year: number; eur: number; contracts: number }[];
  /** Per-calendar-year slices, keyed by year string. Only years with spend. */
  yearly: Record<string, TextbookMarketSlice>;
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
