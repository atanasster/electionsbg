import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type DebtMarket = "international" | "domestic";
export type DebtInstrumentType =
  | "eurobond"
  | "treasury_bond"
  | "treasury_bill"
  | "loan";

export type DebtEmission = {
  id: string;
  market: DebtMarket;
  type: DebtInstrumentType;
  isin?: string;
  bnbEmissionNumber?: string;
  issueDate: string;
  maturityDate?: string;
  termYears?: number;
  currency: string;
  principalMillion: number;
  couponPct?: number;
  settlementYieldPct?: number;
  arrangers?: string[];
  listingVenue?: string;
  titleEn: string;
  titleBg: string;
  notes?: string;
};

// Two underlying payloads, one per origin. International Eurobonds are
// hand-curated; domestic ДЦК auctions are scraped from BNB. We merge them
// at the hook layer so callers see a single flat array sorted newest first.
type CuratedPayload = {
  fetchedAt: string;
  country: string;
  sources: Record<string, string>;
  emissions: DebtEmission[];
};

type ScrapedDomesticPayload = {
  fetchedAt: string;
  country: string;
  source: Record<string, string>;
  emissions: DebtEmission[];
  issues?: { url: string; reason: string }[];
};

export type DebtEmissionsPayload = {
  fetchedAt: string;
  country: string;
  sources: Record<string, string>;
  emissions: DebtEmission[];
};

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(dataUrl(path));
  if (!res.ok) return undefined;
  return (await res.json()) as T;
};

const mergePayloads = (
  curated: CuratedPayload | undefined,
  domestic: ScrapedDomesticPayload | undefined,
): DebtEmissionsPayload | undefined => {
  if (!curated && !domestic) return undefined;
  // Drop any hand-curated domestic entries when scraped data is present —
  // the BNB scraper is authoritative. Curated international entries pass
  // through unchanged.
  const curatedInternational =
    curated?.emissions.filter((e) => e.market === "international") ?? [];
  const domesticAuctions = domestic?.emissions ?? [];
  const all = [...curatedInternational, ...domesticAuctions].sort((a, b) =>
    a.issueDate < b.issueDate ? 1 : -1,
  );
  const sources: Record<string, string> = {
    ...(curated?.sources ?? {}),
    ...(domestic?.source ?? {}),
  };
  return {
    fetchedAt: domestic?.fetchedAt ?? curated?.fetchedAt ?? "",
    country: curated?.country ?? domestic?.country ?? "BG",
    sources,
    emissions: all,
  };
};

export const useDebtEmissions = () =>
  useQuery({
    queryKey: ["debt-emissions"],
    queryFn: async () => {
      const [curated, domestic] = await Promise.all([
        fetchJson<CuratedPayload>("/debt-emissions.json"),
        fetchJson<ScrapedDomesticPayload>("/debt-emissions-domestic.json"),
      ]);
      return mergePayloads(curated, domestic);
    },
  });
