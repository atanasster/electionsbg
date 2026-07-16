import { useCallback, useMemo } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMps } from "@/data/parliament/useMps";

// Predicate for keeping only currently-seated MPs in the chamber-level
// "highlight" lists (voting twins, voting-space bridges). An MP who left the
// chamber mid-term — e.g. resigned to take a government post — has
// isCurrent=false on the roster even though their early roll-call votes are
// still in the session data, so without this filter they surface in these
// highlights (Rumen Radev showing up in Гласово пространство after becoming PM).
//
// Gated to the current parliament: isCurrent is a chamber-wide "seated right
// now" flag, so for a historical NS every MP is non-current and applying the
// filter would empty the list. We only filter when the selected election maps
// to the currently sitting NS.
export const useActiveMps = () => {
  const { selected } = useElectionContext();
  const { mps, findMpById, findMpByName } = useMps();

  // The current NS folder is the latest folder shared by every seated MP
  // (all isCurrent MPs end their nsFolders on the sitting parliament).
  const currentNsFolder = useMemo(() => {
    const cur = mps?.find((m) => m.isCurrent);
    return cur?.nsFolders[cur.nsFolders.length - 1] ?? null;
  }, [mps]);

  const selectedNs = electionToNsFolder(selected);
  const filterActive = !!selectedNs && selectedNs === currentNsFolder;

  // Resolve a vote-record id to a roster entry. The CSV vote ids and the
  // parliament.bg roster ids only partly overlap (e.g. Rumen Radev votes under
  // CSV id 4057 but sits in the roster as id 5142), so an id miss falls back to
  // a normalized-name lookup — the same reconciliation every MP-row surface
  // already relies on. Callers pass the display name they've already resolved.
  const isActiveMp = useCallback(
    (id: number, name?: string | null): boolean => {
      if (!filterActive) return true;
      const mp = findMpById(id) ?? (name ? findMpByName(name) : undefined);
      // Keep genuinely unresolvable ids (no roster match at all) rather than
      // over-filter; drop only members we can positively identify as departed.
      return !mp || mp.isCurrent;
    },
    [filterActive, findMpById, findMpByName],
  );

  return { filterActive, isActiveMp };
};
