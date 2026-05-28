// Classify the currently selected election cycle by kind. The parliamentary
// `elections` array (src/data/json/elections.json) is the default; the
// `localElections` array carries the regular-local (`*_mi`) and
// partial-local (`*_chmi`) cycles, each tagged with a `kind`.
//
// The My-Area dashboard uses this so its tiles can react to cycle type:
//   - "parliament" → standard layout
//   - "mi"         → Mayor & council bumps to headliner position
//   - "chmi"       → partial-election banner on the mayor card
//   - "eu" / "pres"→ reserved; not yet present in the data tables
//
// When the catalogue files grow new types we map them here; everything not
// classified falls back to "parliament" since that's what ElectionContext
// defaults to.

import { useMemo } from "react";
import { useElectionContext } from "../ElectionContext";

export type CycleKind = "parliament" | "mi" | "chmi" | "eu" | "pres";

export type CycleInfo = {
  kind: CycleKind;
  /** Canonical date of the cycle (YYYY-MM-DD). For local cycles this is
   *  round-1; round-2 lives separately on the LocalElectionEntry record. */
  date: string;
  /** The original cycle slug ("2023_10_29_mi", "2026_04_19", …). */
  slug: string;
};

const slugToParliamentDate = (slug: string): string => {
  // Parliamentary cycles are slugs of the form "2024_10_27". Convert to ISO.
  const [y, m, d] = slug.split("_");
  if (y && m && d && /^\d{4}$/.test(y)) {
    return `${y}-${m}-${d}`;
  }
  return slug;
};

export const useCycleKind = (): CycleInfo => {
  const { selected, localElections } = useElectionContext();

  return useMemo<CycleInfo>(() => {
    // Local-elections catalogue wins over the parliamentary default —
    // both arrays use the same slug shape so a direct .find is enough.
    const local = localElections.find((e) => e.name === selected);
    if (local) {
      const kind: CycleKind = local.kind === "partial" ? "chmi" : "mi";
      return { kind, date: local.round1Date, slug: selected };
    }
    // Parliamentary fallback.
    return {
      kind: "parliament",
      date: slugToParliamentDate(selected),
      slug: selected,
    };
  }, [selected, localElections]);
};
