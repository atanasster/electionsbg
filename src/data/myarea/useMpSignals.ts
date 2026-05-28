// Per-MP signal badges for the My-Area representatives strip. Every MP with
// roll-call data gets an attendance badge (so the strip never has a "missing
// %" gap); a separate dissent badge surfaces only when loyalty falls below
// the alarm threshold. One chamber-wide loyalty fetch (~50 KB gz per NS
// slice) feeds every MP in the strip.
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

export type AttendanceSignal = {
  /** 0..1 — share of vote items the MP cast a vote on. */
  attendance: number;
  /** True when attendance is below the alarm threshold (rose tint). */
  severe: boolean;
  label_bg: string;
  label_en: string;
};

export type DissentSignal = {
  /** 0..1 — share of votes that broke with the party majority. */
  pctValue: number;
  label_bg: string;
  label_en: string;
};

export type MpSignals = {
  attendance: AttendanceSignal | null;
  dissent: DissentSignal | null;
};

const ATTENDANCE_SEVERE_THRESHOLD = 0.7;
const LOYALTY_BADGE_THRESHOLD = 0.75;

const fetchLoyaltyFile = async (): Promise<LoyaltyFile | undefined> => {
  const r = await fetch(dataUrl("/parliament/votes/derived/loyalty.json"));
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`loyalty fetch failed: ${r.status}`);
  return r.json();
};

const EMPTY: MpSignals = { attendance: null, dissent: null };

export const useMpSignals = (mpIds: number[]): Map<number, MpSignals> => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);
  const { data: file } = useQuery({
    queryKey: ["parliament_loyalty"] as const,
    queryFn: fetchLoyaltyFile,
    staleTime: Infinity,
  });

  return useMemo(() => {
    const map = new Map<number, MpSignals>();
    const slice = ns ? file?.byNs?.[ns] : undefined;
    if (!slice) {
      for (const id of mpIds) map.set(id, EMPTY);
      return map;
    }
    const totalItems = slice.totalVoteItems ?? 0;
    const byId = new Map(slice.entries.map((e) => [e.mpId, e]));
    for (const id of mpIds) {
      const e = byId.get(id);
      if (!e || totalItems <= 0) {
        map.set(id, EMPTY);
        continue;
      }
      const attendance = e.votesCast / totalItems;
      const attendancePct = Math.round(attendance * 100);
      const attendanceSignal: AttendanceSignal = {
        attendance,
        severe: attendance < ATTENDANCE_SEVERE_THRESHOLD,
        label_bg: `присъствие ${attendancePct}%`,
        label_en: `attendance ${attendancePct}%`,
      };
      let dissentSignal: DissentSignal | null = null;
      if (e.votesCast > 0 && e.loyaltyPct < LOYALTY_BADGE_THRESHOLD) {
        const dissentPct = Math.round((1 - e.loyaltyPct) * 100);
        dissentSignal = {
          pctValue: 1 - e.loyaltyPct,
          label_bg: `несъгласие ${dissentPct}%`,
          label_en: `dissent ${dissentPct}%`,
        };
      }
      map.set(id, { attendance: attendanceSignal, dissent: dissentSignal });
    }
    return map;
  }, [file, ns, mpIds]);
};
