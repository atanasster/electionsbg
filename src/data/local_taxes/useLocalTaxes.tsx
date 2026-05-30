// Per-município local-tax rates — five ИПИ indicators across all 265 общини
// plus optional naredba blocks (residential ТБО / tourist tax / dog tax)
// for the municípios where Tier B parsers ran.
//
// Storage shape (per-município sharding):
//   - data/local_taxes/index.json — slim global meta (~5-10 KB): indicators
//     catalogue, tboBasisLabels, nationalAverages, rankTotals. Fetched once
//     per session and cached forever.
//   - data/local_taxes/{obshtina}.json — per-município ipi + naredba block
//     (~1-2 KB each). Fetched lazily when a tile reads one município.
//
// Total per-page-view download: ~10 KB instead of 390 KB.

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
  // Single property-tax rate set per município (applies to both
  // individuals and legal entities under ЗМДТ Чл. 22; 0.1-4.5‰ band).
  // Surfaced only when the município's TAX naredba is reachable; absent
  // until then. See scripts/local_taxes/types.ts for the full rationale.
  propertyTaxIndividuals?: {
    rate: number;
    year: number;
    note?: string;
  };
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

/** Slim index — global metadata + per-indicator rank denominators. */
export type LocalTaxesIndex = {
  source: string;
  sourceUrl: string;
  indexName: string;
  latestYear: number;
  indicators: LocalTaxIndicatorMeta[];
  tboBasisLabels: Record<TboBasis, { bg: string; en: string }>;
  nationalAverages: Partial<Record<IpiIndicatorKey, number>>;
  rankTotals: Partial<Record<IpiIndicatorKey, number>>;
  fetchedAt?: string;
};

/** Per-município shard — the actual ipi block + optional naredba block. */
export type LocalTaxesObshtinaShard = {
  obshtina: string;
  ipi?: Partial<Record<IpiIndicatorKey, IpiPerIndicator>>;
  naredba?: NaredbaBlock;
};

const fetchIndex = async (): Promise<LocalTaxesIndex> => {
  const r = await fetch(dataUrl("/local_taxes/index.json"));
  if (!r.ok) throw new Error("local-taxes index fetch failed");
  return r.json();
};

const fetchShard = async (
  obshtina: string,
): Promise<LocalTaxesObshtinaShard | null> => {
  const r = await fetch(dataUrl(`/local_taxes/${obshtina}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`local-taxes shard ${obshtina} fetch failed`);
  return r.json();
};

/** Sofia districts (S2xxx) and the município-shape Sofia code (SOF46)
 *  both inherit Столична община's city-wide rates — the local-tax
 *  naredba is set by Столичен общински съвет and applies regardless of
 *  район. Map them to the SOF00 shard so consumer tiles render
 *  meaningful rates for any Sofia user. All other obshtina codes pass
 *  through unchanged. */
const localTaxesShardKey = (obshtina?: string | null): string | null => {
  if (!obshtina) return null;
  if (/^S2\d{3}$/.test(obshtina)) return "SOF00";
  if (obshtina === "SOF46") return "SOF00";
  return obshtina;
};

/** Returns the local-tax record for an obshtina, or `undefined` if the
 *  município isn't in the index. Fetches the slim index (once per
 *  session) and the per-município shard (once per município). */
export const useLocalTaxes = (obshtina?: string | null) => {
  const shardKey = localTaxesShardKey(obshtina);
  const { data } = useQuery({
    queryKey: ["local_taxes:index"],
    queryFn: fetchIndex,
    staleTime: Infinity,
  });
  const { data: shard } = useQuery({
    queryKey: ["local_taxes:shard", shardKey],
    queryFn: () => fetchShard(shardKey!),
    enabled: !!shardKey,
    staleTime: Infinity,
  });
  const score: ScoreEntry | undefined = shard
    ? { ipi: shard.ipi, naredba: shard.naredba }
    : undefined;
  return { data, score };
};
