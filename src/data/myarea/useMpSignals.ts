// Per-MP signal badges for the My-Area representatives strip. Every MP with
// roll-call data gets an attendance badge (so the strip never has a "missing
// %" gap); a separate dissent badge surfaces only when loyalty falls below
// the alarm threshold. Two chamber-wide fetches (~47 KB gz of loyalty for the
// dissent badge, ~43 KB of attendance for the presence one) feed every MP in
// the strip.
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
import {
  useAttendance,
  ATTENDANCE_MIN_ITEMS,
} from "@/data/parliament/votes/useAttendance";
import type { LoyaltyFile } from "@/data/parliament/votes/types";

export type AttendanceSignal = {
  /** 0..1 — share of the items the MP was SEATED for that they cast a vote on. */
  attendance: number;
  /** True when attendance is below the alarm threshold (rose tint). Never set
   *  on a window too short to judge — see ATTENDANCE_MIN_ITEMS. */
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

export type MpSignalsResult = {
  byMpId: Map<number, MpSignals>;
  /** True while either chamber-wide file is still in flight. The badges are the last
   *  thing to arrive on a row that has already painted, so a consumer that renders
   *  them conditionally must reserve their height against this rather than let the
   *  card grow underneath the reader. */
  isLoading: boolean;
};

const ATTENDANCE_SEVERE_THRESHOLD = 0.7;
const LOYALTY_BADGE_THRESHOLD = 0.75;

// Keyed ["rollcall_loyalty"] — the SAME key useMpLoyalty uses for the same URL. Under the
// old ["parliament_loyalty"] key React Query held two cache entries for one file, so any
// page mounting both hooks downloaded loyalty.json twice.
const fetchLoyaltyFile = async (): Promise<LoyaltyFile | undefined> => {
  const r = await fetch(dataUrl("/parliament/votes/derived/loyalty.json"));
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`loyalty fetch failed: ${r.status}`);
  return r.json();
};

const EMPTY: MpSignals = { attendance: null, dissent: null };

export const useMpSignals = (mpIds: number[]): MpSignalsResult => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);
  const { data: file, isLoading: loyaltyLoading } = useQuery({
    queryKey: ["rollcall_loyalty"] as const,
    queryFn: fetchLoyaltyFile,
    staleTime: Infinity,
  });
  // The presence rate comes from attendance.json, NOT from loyalty's
  // `votesCast / totalVoteItems`. Loyalty carries no per-MP denominator, so that
  // division measures every MP against the whole chamber's item count — which is only
  // their own window if they sat the full term. It is not a small error: a member who
  // left the 52nd's benches for a ministry after 32 items and cast 17 of them was badged
  // "присъствие 1%" instead of 53%, and the rose tint below fired on it.
  const { byMpId: attendanceByMp, isLoading: attendanceLoading } =
    useAttendance();

  const byMpId = useMemo(() => {
    const map = new Map<number, MpSignals>();
    const slice = ns ? file?.byNs?.[ns] : undefined;
    const loyaltyById = new Map((slice?.entries ?? []).map((e) => [e.mpId, e]));
    for (const id of mpIds) {
      const e = loyaltyById.get(id);
      const a = attendanceByMp.get(id);
      let attendanceSignal: AttendanceSignal | null = null;
      if (a && a.totalItems > 0) {
        const attendancePct = Math.round(a.presentPct * 100);
        attendanceSignal = {
          attendance: a.presentPct,
          // A one-item window that the member missed reads 0% — true, and no
          // evidence of anything. Tint only what the window can support.
          severe:
            a.totalItems >= ATTENDANCE_MIN_ITEMS &&
            a.presentPct < ATTENDANCE_SEVERE_THRESHOLD,
          label_bg: `присъствие ${attendancePct}%`,
          label_en: `attendance ${attendancePct}%`,
        };
      }
      let dissentSignal: DissentSignal | null = null;
      if (e && e.votesCast > 0 && e.loyaltyPct < LOYALTY_BADGE_THRESHOLD) {
        const dissentPct = Math.round((1 - e.loyaltyPct) * 100);
        dissentSignal = {
          pctValue: 1 - e.loyaltyPct,
          label_bg: `несъгласие ${dissentPct}%`,
          label_en: `dissent ${dissentPct}%`,
        };
      }
      map.set(
        id,
        attendanceSignal || dissentSignal
          ? { attendance: attendanceSignal, dissent: dissentSignal }
          : EMPTY,
      );
    }
    return map;
  }, [file, ns, mpIds, attendanceByMp]);

  return { byMpId, isLoading: loyaltyLoading || attendanceLoading };
};
