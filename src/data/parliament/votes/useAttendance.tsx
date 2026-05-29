import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMps } from "@/data/parliament/useMps";
import { useMpProfile } from "./useMpProfile";
import type { AttendanceEntry, AttendanceFile, AttendanceSlice } from "./types";

const queryFn = async (): Promise<AttendanceFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/attendance.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

// Strict: return data only for the requested NS. Older elections (pre-roll-
// call cycles) have no slice — falling back to a different NS would paint the
// wrong people (parliament.bg recycles ids across NSes).
const pickSlice = (
  file: AttendanceFile | undefined,
  ns: string | null,
): AttendanceSlice | undefined => {
  if (!ns) return undefined;
  return file?.byNs?.[ns];
};

// One small file (~50 KB gzipped) following the same byNs envelope as
// loyalty.json/cohesion.json. Both the most-absent and most-present tiles
// consume this hook; React Query dedupes the request.
export const useAttendance = () => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_attendance"] as [string],
    queryFn,
    staleTime: Infinity,
  });

  const ns = electionToNsFolder(selected);
  const slice = pickSlice(data, ns);

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
    entries: slice?.entries ?? [],
    byMpId,
    isLoading,
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
const isSeatedNow = (
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
export const useAttendanceRanking = (topN = 5, bottomN = 5, minItems = 30) => {
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
