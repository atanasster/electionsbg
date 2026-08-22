// Per-MP attendance — items where a member appears in the roll call against items where
// they were recorded absent.
//
// SERVED FROM POSTGRES since json-retirement-v2 Tier 3a: /api/db/mp-attendance
// (mp_attendance, 135). It used to fetch data/parliament/votes/derived/attendance.json — the
// whole byNs envelope, of which one slice was used.
//
// ⚠️ `partyShort` COMES FROM THE SEAT, and that is a MEASURED equivalence rather than an
// approximation. The retired builder kept "the most-recently-seen party" per member, and the
// route joins mp_seat -> party_dim. Measured 2026-08-21 across every parliament:
// `mp_seat.party_id` equals each member's latest cast-time party for 2,366 of 2,366 seats —
// zero drift — so the two rules pick the same label.
//
// That equivalence is an accident of how the loader builds mp_seat, not a constraint, and
// reload_visibility_map's sibling gate pins it. It does NOT extend to per-ITEM grouping:
// 179 of 2,366 seats change party mid-term, so any aggregate over individual votes must
// group on vote_cast.party_id instead.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMps } from "@/data/parliament/useMps";
import { useMpProfile } from "./useMpProfile";
import type { AttendanceEntry, AttendanceSlice } from "./types";

interface Body {
  rows: Row[];
  windowFrom: string | null;
  windowTo: string | null;
  totalVoteItems: number;
  /** OUR clock (vote_day.refreshed_at via rollcall_refreshed_at()), not parliament.bg's —
   *  the screen renders it as "computed at", which is what the retired attendance.json
   *  carried in its own `computedAt` field. */
  computedAt: string | null;
}

interface Row {
  mp_id: number;
  items: string | number;
  present: string | number;
  absent: string | number;
  name: string | null;
  party: string | null;
}

const queryFn = async ({
  queryKey,
}: {
  queryKey: readonly [string, string | null];
}): Promise<{ slice: AttendanceSlice; computedAt?: string } | undefined> => {
  const ns = queryKey[1];
  if (!ns) return undefined;
  const r = await fetch(`/api/db/mp-attendance?ns=${encodeURIComponent(ns)}`);
  if (!r.ok) throw new Error(`mp-attendance fetch failed: ${r.status}`);
  const body = (await r.json()) as Body | null;
  const rows = body?.rows;
  if (!rows?.length) return undefined;
  const entries: AttendanceEntry[] = rows.map((e) => {
    const totalItems = Number(e.items ?? 0);
    const presentCount = Number(e.present ?? 0);
    return {
      mpId: e.mp_id,
      partyShort: e.party ?? "",
      totalItems,
      presentCount,
      absentCount: Number(e.absent ?? 0),
      // Derived here rather than in SQL: the matview stores the two counts, and a stored
      // ratio would be a third value that can disagree with them.
      presentPct: totalItems > 0 ? presentCount / totalItems : 0,
    };
  });
  return {
    slice: {
      windowFrom: body?.windowFrom ?? "",
      windowTo: body?.windowTo ?? "",
      totalVoteItems: body?.totalVoteItems ?? 0,
      entries,
    },
    computedAt: body?.computedAt ?? undefined,
  };
};

export const ATTENDANCE_MIN_ITEMS = 30;

// Stable identity for the empty case, so a consumer's useMemo is not defeated by
// a fresh `[]` on every render. The disabled-query state (the MP scorecard's
// normal one, since it reads attendance out of the shard) has no data, and
// `entries` is a dependency of that hook's memo.
const NO_ENTRIES: AttendanceEntry[] = [];

// Both the most-absent and most-present tiles consume this hook; React Query dedupes the
// request.
//
// `enabled` exists for the callers that only need it as a FALLBACK — the MP
// scorecard reads its attendance out of the per-MP shard it already has, and
// reaches for this aggregate only when that shard missed. Defaults true so the
// chamber-wide screens are unchanged.
export const useAttendance = (enabled = true) => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);
  // KEYED ON ns. The retired file was one whole-corpus fetch a single cache entry could
  // hold; this is per-parliament, so an unkeyed query would serve one parliament's members
  // under another after a switch — the wrong-people failure pickSlice() guarded against by
  // being STRICT about the slice.
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_attendance", ns] as [string, string | null],
    queryFn,
    staleTime: Infinity,
    enabled: enabled && !!ns,
  });

  const slice = data?.slice;

  const byMpId = useMemo(() => {
    const m = new Map<number, AttendanceEntry>();
    for (const e of slice?.entries ?? []) m.set(e.mpId, e);
    return m;
  }, [slice]);

  return {
    file: slice,
    slice,
    computedAt: data?.computedAt,
    ns,
    entries: slice?.entries ?? NO_ENTRIES,
    byMpId,
    isLoading: enabled && isLoading,
  };
};

// Resolve a per-NS CSV id to the deduped roster entry. parliament.bg
// recycles CSV ids across NSes, so a direct id lookup will frequently miss
// when the same person carries a different id in each NS. The name fallback
// joins via the latest session's mpNames map — same two-step bridge as
// `useCandidateUrlForVote`.
//
// For the current NS we trust the roster's `isCurrent` flag (parliament.bg
// removes departed MPs even when our session ingest still carries them in
// the latest mpNames map). For historical NSes the flag is meaningless —
// no NS44 MP is "currently seated" — so we fall back to "appeared in the
// latest ingested session of that NS".
export const isSeatedNow = (
  csvMpId: number,
  selectedNs: string | null,
  isCurrentNs: boolean,
  mpNames: Record<string, string>,
  findMpById: ReturnType<typeof useMps>["findMpById"],
  findMpByName: ReturnType<typeof useMps>["findMpByName"],
): boolean => {
  if (!isCurrentNs) return mpNames[String(csvMpId)] !== undefined;
  const direct = findMpById(csvMpId);
  if (direct && direct.nsFolders.includes(selectedNs ?? "")) {
    return direct.isCurrent;
  }
  const byName = findMpByName(mpNames[String(csvMpId)]);
  if (byName) return byName.isCurrent;
  return false;
};

// Returns the top-N most-present and most-absent MPs in the selected NS.
// A small static floor (default 30 items) keeps an MP sworn in on the
// last day out of the ranking; the roster check above is what catches
// departed MPs.
export const useAttendanceRanking = (
  topN = 5,
  bottomN = 5,
  minItems = ATTENDANCE_MIN_ITEMS,
) => {
  const { entries, ns: selectedNs, isLoading } = useAttendance();
  const { mpNames } = useMpProfile();
  const { findMpById, findMpByName, currentNs } = useMps();
  // `currentNs` from /parliament/index.json is a display label
  // ("52-ро Народно събрание"), not a folder code. Extract the leading
  // digits to compare against `selectedNs` (always a numeric folder).
  const currentNsCode = currentNs?.match(/^\d+/)?.[0] ?? null;
  const isCurrentNs = !!selectedNs && selectedNs === currentNsCode;

  const { mostPresent, mostAbsent } = useMemo(() => {
    const eligible = entries.filter(
      (e) =>
        e.totalItems >= minItems &&
        isSeatedNow(
          e.mpId,
          selectedNs,
          isCurrentNs,
          mpNames,
          findMpById,
          findMpByName,
        ),
    );
    const sorted = [...eligible].sort((a, b) => b.presentPct - a.presentPct);
    return {
      mostPresent: sorted.slice(0, topN),
      mostAbsent: sorted.slice(-bottomN).reverse(),
    };
  }, [
    entries,
    mpNames,
    selectedNs,
    isCurrentNs,
    findMpById,
    findMpByName,
    topN,
    bottomN,
    minItems,
  ]);
  return { mostPresent, mostAbsent, isLoading };
};
