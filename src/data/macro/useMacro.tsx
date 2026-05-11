import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type MacroIndicatorKey =
  // Eurostat — economy
  | "gdpGrowth"
  | "inflation"
  | "unemployment"
  | "gdpPerCapita"
  // World Bank — governance (WGI, -2.5 to +2.5)
  | "wgiRuleOfLaw"
  | "wgiControlOfCorruption"
  | "wgiGovEffectiveness"
  // Curated
  | "cpi"
  | "trustParliament"
  | "trustGovernment"
  | "trustEu"
  | "euFunds"
  | "euContribution";

export type MacroPoint = {
  year: number;
  value: number;
};

export type MacroIndicatorMeta = {
  titleEn: string;
  titleBg: string;
  unitLabelEn: string;
  unitLabelBg: string;
  attributionEn?: string;
  attributionBg?: string;
};

export type MacroPayload = {
  sources: Record<string, string>;
  fetchedAt: string;
  country: string;
  indicators: Record<MacroIndicatorKey, MacroIndicatorMeta>;
  series: Record<MacroIndicatorKey, MacroPoint[]>;
};

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(dataUrl(path));
  if (!res.ok) return undefined;
  return (await res.json()) as T;
};

export const useMacro = () =>
  useQuery({
    queryKey: ["macro"],
    queryFn: () => fetchJson<MacroPayload>("/macro.json"),
  });
