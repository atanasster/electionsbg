// Per-município simulated alerts feed. Materialized by
// scripts/myarea/build_alerts.ts from already-ingested data — no separate
// scrape. The feed is the V1 substitute for real email alerts (no auth
// yet); each event has both BG and EN headlines plus an inferred date
// for chronological ordering.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type MyAreaAlertKind =
  | "procurement"
  | "eu_funds"
  | "local_election"
  | "capital_program"
  | "plenary_keyword";

export type MyAreaAlertEvent = {
  date: string;
  kind: MyAreaAlertKind;
  headline_bg: string;
  headline_en: string;
  amountEur?: number;
  link?: string;
  detail?: string;
};

export type MyAreaAlertsFile = {
  obshtina: string;
  generatedAt: string;
  events: MyAreaAlertEvent[];
};

const fetchAlerts = async (
  obshtina: string,
): Promise<MyAreaAlertsFile | null> => {
  const r = await fetch(dataUrl(`/myarea/alerts/${obshtina}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`alerts fetch failed: ${r.status}`);
  return r.json();
};

export const useMyAreaAlerts = (obshtina?: string | null) =>
  useQuery({
    queryKey: ["myarea", "alerts", obshtina ?? ""],
    queryFn: () => (obshtina ? fetchAlerts(obshtina) : Promise.resolve(null)),
    enabled: !!obshtina,
    staleTime: Infinity,
  });
