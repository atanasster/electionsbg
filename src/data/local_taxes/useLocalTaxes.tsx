// Per-município local-tax rates — five ИПИ indicators across all 265 общини
// plus optional naredba blocks (residential ТБО / tourist tax / dog tax)
// for the oblast capitals.
//
// File ships with all 265 ipi blocks populated by
// `update-local-taxes` (Tier A). naredba blocks fill in as Tier B parsers
// land. The hook returns `undefined` for any município not in the index —
// the consuming tile renders nothing in that case (silent absence).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type IpiIndicatorKey =
  | "property_tax_legal"
  | "transfer_tax"
  | "vehicle_tax_74_110kw"
  | "patent_tax_retail"
  | "patent_tax_taxi";

export type TboBasis = "promil" | "users" | "area" | "volume";

export type IpiPerIndicator = {
  values: Record<string, number>;
  latestYear: number;
  latestValue: number;
  nationalRank: number;
};

export type NaredbaBlock = {
  year: number;
  url?: string;
  tboResidential?: {
    basis: TboBasis;
    rate?: number;
    unit?: string;
    zone?: string;
    note?: string;
  };
  touristTax?: { value: number; unit: string };
  dogTax?: { value: number; unit: string };
};

export type ScoreEntry = {
  ipi?: Partial<Record<IpiIndicatorKey, IpiPerIndicator>>;
  naredba?: NaredbaBlock;
};

export type LocalTaxIndicatorMeta = {
  key: IpiIndicatorKey;
  ipiId: number;
  unit: string;
  direction: "lower-better";
  label: { bg: string; en: string };
};

export type LocalTaxesFile = {
  source: string;
  sourceUrl: string;
  indexName: string;
  latestYear: number;
  indicators: LocalTaxIndicatorMeta[];
  tboBasisLabels: Record<TboBasis, { bg: string; en: string }>;
  nationalAverages: Partial<Record<IpiIndicatorKey, number>>;
  scoresByObshtina: Record<string, ScoreEntry>;
  fetchedAt?: string;
};

const fetchLocalTaxes = async (): Promise<LocalTaxesFile> => {
  const r = await fetch(dataUrl("/local_taxes/index.json"));
  if (!r.ok) throw new Error("local taxes fetch failed");
  return r.json();
};

/** Returns the local-tax record for an obshtina, or `undefined` if the
 *  município isn't in the index (or the data isn't ingested yet). The
 *  consuming tile checks `ipi` for presence — `naredba` is optional. */
export const useLocalTaxes = (obshtina?: string | null) => {
  const { data } = useQuery({
    queryKey: ["local_taxes"],
    queryFn: fetchLocalTaxes,
    staleTime: Infinity,
  });
  const score = obshtina ? data?.scoresByObshtina[obshtina] : undefined;
  return { data, score };
};
