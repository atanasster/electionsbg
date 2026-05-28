// Per-MP signal badge selector for the My-Area representatives strip.
// Picks ONE badge per MP from the most striking signal we can compute
// without spawning a hook per MP — keeping the strip's network cost flat
// at a single chamber-wide loyalty fetch (~50 KB gz per NS slice).
//
// Priority order per MP (first match wins):
//   1. Attendance < 70%       →  "отсъства {pct}%"
//   2. Loyalty   < 75%        →  "несъгласие {pct}%"
//   3. (no badge)
//
// Net-worth and connected-contracts badges (e.g. "4 имота, 2 коли") are
// deferred to a later phase — they would each require a per-MP shard
// fetch on top of the strip's existing one, which is more weight than
// the badge value justifies. The full scorecard is already accessible
// from each candidate's profile page.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { LoyaltyFile } from "@/data/parliament/votes/types";

export type MpSignal = {
  kind: "absent" | "dissent";
  /** 0..1 — share of votes missed or share of dissenting votes. */
  pctValue: number;
  label_bg: string;
  label_en: string;
};

const ATTENDANCE_BADGE_THRESHOLD = 0.7;
const LOYALTY_BADGE_THRESHOLD = 0.75;

const fetchLoyaltyFile = async (): Promise<LoyaltyFile | undefined> => {
  const r = await fetch(dataUrl("/parliament/votes/derived/loyalty.json"));
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`loyalty fetch failed: ${r.status}`);
  return r.json();
};

export const useMpSignals = (mpIds: number[]): Map<number, MpSignal | null> => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);
  const { data: file } = useQuery({
    queryKey: ["parliament_loyalty"] as const,
    queryFn: fetchLoyaltyFile,
    staleTime: Infinity,
  });

  return useMemo(() => {
    const map = new Map<number, MpSignal | null>();
    const slice = ns ? file?.byNs?.[ns] : undefined;
    if (!slice) {
      for (const id of mpIds) map.set(id, null);
      return map;
    }
    const totalItems = slice.totalVoteItems ?? 0;
    const byId = new Map(slice.entries.map((e) => [e.mpId, e]));
    for (const id of mpIds) {
      const e = byId.get(id);
      if (!e || e.votesCast === 0) {
        map.set(id, null);
        continue;
      }
      const attendance = totalItems > 0 ? e.votesCast / totalItems : null;
      if (attendance !== null && attendance < ATTENDANCE_BADGE_THRESHOLD) {
        const missedPct = Math.round((1 - attendance) * 100);
        map.set(id, {
          kind: "absent",
          pctValue: 1 - attendance,
          label_bg: `отсъства ${missedPct}%`,
          label_en: `absent ${missedPct}%`,
        });
        continue;
      }
      if (e.loyaltyPct < LOYALTY_BADGE_THRESHOLD) {
        const dissentPct = Math.round((1 - e.loyaltyPct) * 100);
        map.set(id, {
          kind: "dissent",
          pctValue: 1 - e.loyaltyPct,
          label_bg: `несъгласие ${dissentPct}%`,
          label_en: `dissent ${dissentPct}%`,
        });
        continue;
      }
      map.set(id, null);
    }
    return map;
  }, [file, ns, mpIds]);
};
