// Per-município simulated alerts feed. Composed by scripts/myarea/build_alerts.ts from
// already-ingested data — no separate scrape. The feed is the V1 substitute for real email
// alerts (no auth yet); each event has both BG and EN headlines plus an inferred date for
// chronological ordering.
//
// SERVED FROM POSTGRES since json-retirement-v2 Tier 4b (/api/db/myarea-alerts,
// myarea_alerts in 184). It used to read data/myarea/alerts/<obshtina>.json — 290 files
// rebuilt and re-uploaded to the bucket EVERY DAY, the highest churn-per-byte tree in the
// repo at 14,746 file-touches over 300 commits.
//
// ⚠️ ONLY THE STORAGE MOVED. The ten builders behind this feed compose BILINGUAL HEADLINES,
// and translated prose does not belong in a migration — 184's header carries that reasoning.
// The events arrive exactly as the builder wrote them.

import { useQuery } from "@tanstack/react-query";

export type MyAreaAlertKind =
  | "procurement"
  | "tender"
  | "eu_funds"
  | "local_election"
  | "capital_program"
  | "plenary_keyword"
  | "council_resolution";

/** Procurement notice type — announced (обявена) / awarded (възложена) /
 * annex (анекс). Lets the feed + watchlist distinguish the three. */
export type MyAreaNoticeType = "announced" | "awarded" | "annex";

/** EU-funds change type from the snapshot-diff — a brand-new project or a
 * value/status change to an existing one. */
export type MyAreaChangeType = "new" | "modified";

export type MyAreaAlertEvent = {
  date: string;
  kind: MyAreaAlertKind;
  headline_bg: string;
  headline_en: string;
  amountEur?: number;
  link?: string;
  detail?: string;
  /** EU-funds rows only — "2014-2020", "2021-2027", "2021-RRP". When set,
   * the tile renders this in place of the (programme-period midpoint) date. */
  programPeriod?: string;
  /** Procurement rows only — the OCDS notice type. */
  noticeType?: MyAreaNoticeType;
  /** EU-funds rows only — set on snapshot-diff new/modified contracts. */
  changeType?: MyAreaChangeType;
};

export type MyAreaAlertsFile = {
  obshtina: string;
  /** When the LOADER last wrote this feed — our clock, not an event date. The file this
   *  replaced carried the same field under the same name. */
  generatedAt: string;
  events: MyAreaAlertEvent[];
};

const fetchAlerts = async (
  obshtina: string,
): Promise<MyAreaAlertsFile | null> => {
  const r = await fetch(
    `/api/db/myarea-alerts?obshtina=${encodeURIComponent(obshtina)}`,
  );
  if (!r.ok) throw new Error(`alerts fetch failed: ${r.status}`);
  // null = this município has no feed. The route returns it explicitly, where the file
  // family expressed the same thing as a 404 — the tile's absent state is unchanged.
  const body = (await r.json()) as {
    obshtina: string;
    events: MyAreaAlertEvent[];
    refreshedAt: string;
  } | null;
  if (!body) return null;
  return {
    obshtina: body.obshtina,
    generatedAt: body.refreshedAt,
    events: body.events ?? [],
  };
};

export const useMyAreaAlerts = (obshtina?: string | null) =>
  useQuery({
    queryKey: ["myarea", "alerts", obshtina ?? ""],
    queryFn: () => (obshtina ? fetchAlerts(obshtina) : Promise.resolve(null)),
    enabled: !!obshtina,
    staleTime: Infinity,
  });
