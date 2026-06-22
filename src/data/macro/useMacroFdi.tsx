import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// БНБ monthly foreign-direct-investment flows (balance of payments, BPM6).
// Written by scripts/macro/fetch_bnb_fdi.ts → data/macro_fdi.json. Separate
// from macro.json because the cadence (monthly) and the equity/reinvested/debt
// decomposition don't fit the annual+quarterly GovernmentTimeline shape.

export type FdiComponentKey = "total" | "equity" | "reinvested" | "debt";

export type FdiPoint = { period: string; value: number };

export type FdiYtdSide = {
  year: number;
  total: number;
  equity: number;
  reinvested: number;
  debt: number;
};

export type FdiLatestMonth = {
  period: string;
  total: number;
  equity: number;
  reinvested: number;
  debt: number;
  priorYearTotal: number | null;
};

export type MacroFdiPayload = {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  unit: "EUR million";
  frequency: "monthly";
  latestPeriod: string;
  labels: Record<FdiComponentKey, { bg: string; en: string }>;
  series: Record<FdiComponentKey, FdiPoint[]>;
  latest: FdiLatestMonth;
  ytd: {
    month: number;
    rangeBg: string;
    rangeEn: string;
    current: FdiYtdSide;
    prior: FdiYtdSide;
    totalRatio: number | null;
    reinvestedGrowthPct: number | null;
  };
};

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(dataUrl(path));
  if (!res.ok) return undefined;
  return (await res.json()) as T;
};

export const useMacroFdi = () =>
  useQuery({
    queryKey: ["macro_fdi"],
    queryFn: () => fetchJson<MacroFdiPayload>("/macro_fdi.json"),
  });
