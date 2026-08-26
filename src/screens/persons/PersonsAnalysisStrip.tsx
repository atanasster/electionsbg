// The clickable "Основна принадлежност" mix bar above the /persons table.
//
// ⚠️ IT USED TO CARRY FOUR KPI CARDS TOO, AND THEY ARE GONE RATHER THAN SWITCHED OFF. The head
// band publishes the same four figures WITH a declared basis each, and the same number twice on
// one page reads as two different facts. The sibling `ContractsAnalysisStrip` keeps its cards
// behind a `showKpis` flag because it has three consumers and two of them have no head; this
// component has exactly ONE consumer, so a flag here would have been a permanently-false branch
// keeping `StatCard`, four lucide icons and two long strings — one ~330 characters — alive in
// the CORE i18n chunk that every page on the site downloads.
//
// The caveat those cards carried did NOT die with them: „не е мярка за спазване на закона" now
// rides in the declaration cell's own `basis`, because `HubKpi` has no hint slot and a rate
// promoted to the largest type on the page without it reads as an accusation against ~10.7k
// village mayors. See `personsKpiBasis.ts`.
//
// THE MIX BAR PARTITIONS `primary_facet`, NOT THE GROUP FLAGS. A person belongs to several
// groups at once (routinely both муниципален and бизнес), so stacking the flags would
// produce widths summing past 100% — proportions of a whole that does not exist. The
// representative facet is single-valued and total (person_browse.data.test.ts asserts its
// counts sum to the table), which is exactly what a 100%-stacked bar requires.
//
// That also makes it a DIFFERENT question from the group dropdown, and the note under the
// bar says so: the bar answers "what is this person primarily", the dropdown answers "is
// this person also a …". They filter different columns and are deliberately not merged.

import { FC, useMemo } from "react";
import { facetKey } from "@/data/registry/useRegistryFacets";
import { useTranslation } from "react-i18next";
import { MixBar, type MixSegment } from "@/ux/MixBar";
import { usePersonLabels } from "@/lib/personLabels";
import { useIsDark } from "@/screens/components/procurement/chartColors";
import type { FacetOption } from "@/data/persons/usePersonFacets";

// One hue per representative facet, brightened for dark mode so each segment clears
// non-text contrast against the navy background (same rule as ProcedureMixBar).
const FACET_LIGHT: Record<string, string> = {
  politician: "#2563eb",
  executive: "#0d9488",
  public_sector: "#7c3aed",
  magistrate: "#d97706",
  regulator: "#dc2626",
  company: "#64748b",
  ngo: "#059669",
  donor: "#db2777",
};
const FACET_DARK: Record<string, string> = {
  politician: "#60a5fa",
  executive: "#2dd4bf",
  public_sector: "#a78bfa",
  magistrate: "#fbbf24",
  regulator: "#f87171",
  company: "#94a3b8",
  ngo: "#34d399",
  donor: "#f472b6",
};
const FALLBACK_LIGHT = "#94a3b8";
const FALLBACK_DARK = "#cbd5e1";

export const PersonsAnalysisStrip: FC<{
  /** The primary_facet partition + its selection. */
  facetMix: FacetOption[];
  selectedFacet: string | null;
  onSelectFacet: (v: string | null) => void;
  /** One line under the bar, in addition to the standing note. /persons uses it to say that
   *  under `?sector=all` the „Бизнес" segment IS the private-sector scope. */
  extraNote?: string;
}> = ({ facetMix, selectedFacet, onSelectFacet, extraNote }) => {
  const { t } = useTranslation();
  const { facetLabel } = usePersonLabels();
  const dark = useIsDark();

  const segments = useMemo<MixSegment[]>(
    () =>
      facetMix.map((f) => {
        // A facet value is not always a string — see FacetOption. Narrowed ONCE per bucket so
        // the key, the label lookup and the colour index cannot disagree about it.
        const key = facetKey(f.value);
        return {
          key,
          label: facetLabel(key) || key,
          count: f.count,
          color:
            (dark ? FACET_DARK : FACET_LIGHT)[key] ??
            (dark ? FALLBACK_DARK : FALLBACK_LIGHT),
        };
      }),
    [facetMix, facetLabel, dark],
  );

  return (
    <div className="mb-4 space-y-3">
      <MixBar
        segments={segments}
        selected={selectedFacet}
        onSelect={onSelectFacet}
        title={t("persons_mix_title", {
          defaultValue: "Основна принадлежност",
        })}
        note={[
          t("persons_mix_note", {
            defaultValue:
              "Групата на най-високата заемана длъжност. Един човек често е в няколко групи — за „също така е…“ използвайте филтъра Група.",
          }),
          extraNote,
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </div>
  );
};
