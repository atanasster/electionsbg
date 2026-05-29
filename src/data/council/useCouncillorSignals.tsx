// Per-councillor attendance + party-dissent signals — analog of
// useMpSignals for the local-council tier. Fed by
// data/officials/derived/councillor_signals.json which is rebuilt by
// scripts/officials/build_councillor_signals.ts after every council ingest.
//
// Surface points:
//   - MyAreaCouncilVotesTile per-avatar tooltip ("присъствие 84% · несъгласие 12%")
//   - OfficialProfileScreen detail section for councillors
//
// The signals file is keyed by the FRONTEND obshtina code (SFO_CITY, VTR04,
// BGS04, …) so callers pass area.obshtina directly — no councilObshtinaMap
// translation needed.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type CouncillorAttendanceSignal = {
  /** 0..1 — share of named-vote resolutions the councillor appeared in. */
  attendance: number;
  /** True when attendance is below the alarm threshold (rose tint). */
  severe: boolean;
  label_bg: string;
  label_en: string;
};

export type CouncillorDissentSignal = {
  /** 0..1 — share of votes that broke with the party majority on the same resolution. */
  pctValue: number;
  label_bg: string;
  label_en: string;
};

export type CouncillorSignals = {
  attendance: CouncillorAttendanceSignal | null;
  dissent: CouncillorDissentSignal | null;
  votesCast: number;
};

type SignalsFile = {
  generatedAt: string;
  byObshtina: Record<
    string,
    {
      totalResolutions: number;
      byCouncillor: Record<
        string,
        {
          votesCast: number;
          attendance: number;
          forCount: number;
          againstCount: number;
          abstainCount: number;
          dissent: number | null;
          partyCanonicalId?: string;
        }
      >;
    }
  >;
};

// Same thresholds as useMpSignals so the visual language carries across.
const ATTENDANCE_SEVERE_THRESHOLD = 0.7;
const DISSENT_BADGE_THRESHOLD = 0.1; // 10% — anything below this is "loyal", not surfaced

const EMPTY: CouncillorSignals = {
  attendance: null,
  dissent: null,
  votesCast: 0,
};

const fetchSignals = async (): Promise<SignalsFile | undefined> => {
  const r = await fetch(dataUrl("/officials/derived/councillor_signals.json"));
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`councillor signals fetch failed: ${r.status}`);
  if (!(r.headers.get("content-type") ?? "").includes("json")) return undefined;
  return r.json();
};

export const useCouncillorSignals = (
  obshtina: string | null | undefined,
  slugs: string[],
): Map<string, CouncillorSignals> => {
  const { data: file } = useQuery({
    queryKey: ["councillor_signals"] as const,
    queryFn: fetchSignals,
    staleTime: Infinity,
  });

  return useMemo(() => {
    const map = new Map<string, CouncillorSignals>();
    if (!obshtina || !file) {
      for (const slug of slugs) map.set(slug, EMPTY);
      return map;
    }
    const slice = file.byObshtina[obshtina];
    if (!slice) {
      for (const slug of slugs) map.set(slug, EMPTY);
      return map;
    }
    const total = slice.totalResolutions;
    for (const slug of slugs) {
      const e = slice.byCouncillor[slug];
      if (!e) {
        map.set(slug, EMPTY);
        continue;
      }
      const attendancePct = Math.round(e.attendance * 100);
      const attendance: CouncillorAttendanceSignal = {
        attendance: e.attendance,
        severe: e.attendance < ATTENDANCE_SEVERE_THRESHOLD,
        label_bg: `присъствие ${attendancePct}%`,
        label_en: `attendance ${attendancePct}%`,
      };
      let dissent: CouncillorDissentSignal | null = null;
      if (e.dissent != null && e.dissent >= DISSENT_BADGE_THRESHOLD) {
        const pct = Math.round(e.dissent * 100);
        dissent = {
          pctValue: e.dissent,
          label_bg: `несъгласие ${pct}%`,
          label_en: `dissent ${pct}%`,
        };
      }
      map.set(slug, { attendance, dissent, votesCast: e.votesCast });
    }
    // void total — kept in the data file for downstream consumers but the
    // hook surfaces only the per-councillor view.
    void total;
    return map;
  }, [file, obshtina, slugs]);
};
