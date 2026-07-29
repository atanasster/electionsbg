// The analysis block above the /persons table: four KPI cards and the clickable
// "Основна принадлежност" mix bar. Mirrors ContractsAnalysisStrip's role on the contracts
// browser, and the same reactive/static split it documents:
//
//   • the row COUNT rides the table's own server-side aggregate (via onData), so it is free
//     and it reacts to the free-text search;
//   • the PERCENTAGES ride /api/db/facets and do NOT move with the search box — they
//     describe the filtered corpus, not the query.
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
import { useTranslation } from "react-i18next";
import { Users, FileText, Briefcase, MapPin } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
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

const pct = (part: number | undefined, whole: number | undefined): string =>
  part == null || !whole ? "—" : `${Math.round((part / whole) * 100)}%`;

export const PersonsAnalysisStrip: FC<{
  /** Reactive row count from the table's aggregates. */
  count?: number;
  /** Facet-derived denominators; undefined until the facets resolve. */
  withDeclaration?: number;
  withCompanies?: number;
  facetTotal?: number;
  /** Distinct municipalities represented in the filtered set. */
  obshtinaCount?: number;
  /** The primary_facet partition + its selection. */
  facetMix: FacetOption[];
  selectedFacet: string | null;
  onSelectFacet: (v: string | null) => void;
}> = ({
  count,
  withDeclaration,
  withCompanies,
  facetTotal,
  obshtinaCount,
  facetMix,
  selectedFacet,
  onSelectFacet,
}) => {
  const { t, i18n } = useTranslation();
  const { facetLabel } = usePersonLabels();
  const dark = useIsDark();
  const locale = i18n.language?.startsWith("bg") ? "bg-BG" : "en-GB";

  const segments = useMemo<MixSegment[]>(
    () =>
      facetMix.map((f) => ({
        key: f.value,
        label: facetLabel(f.value) || f.value,
        count: f.count,
        color:
          (dark ? FACET_DARK : FACET_LIGHT)[f.value] ??
          (dark ? FALLBACK_DARK : FALLBACK_LIGHT),
      })),
    [facetMix, facetLabel, dark],
  );

  return (
    <div className="mb-4 space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("persons_kpi_people", { defaultValue: "Лица" })}>
          <div className="flex items-baseline gap-2">
            <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="text-lg font-bold tabular-nums md:text-xl">
              {count != null ? count.toLocaleString(locale) : "—"}
            </span>
          </div>
        </StatCard>
        <StatCard
          label={t("persons_kpi_declared", { defaultValue: "С декларация" })}
          hint={t("persons_kpi_declared_hint", {
            defaultValue:
              "Дял от показаните лица с подадена декларация пред Сметната палата.",
          })}
        >
          <div className="flex items-baseline gap-2">
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="text-lg font-bold tabular-nums md:text-xl">
              {pct(withDeclaration, facetTotal)}
            </span>
          </div>
        </StatCard>
        <StatCard
          label={t("persons_kpi_companies", { defaultValue: "С фирми в ТР" })}
          hint={t("persons_kpi_companies_hint", {
            defaultValue:
              "Дял от показаните лица със свързана фирма в Търговския регистър.",
          })}
        >
          <div className="flex items-baseline gap-2">
            <Briefcase className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="text-lg font-bold tabular-nums md:text-xl">
              {pct(withCompanies, facetTotal)}
            </span>
          </div>
        </StatCard>
        <StatCard label={t("persons_kpi_obshtini", { defaultValue: "Общини" })}>
          <div className="flex items-baseline gap-2">
            <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="text-lg font-bold tabular-nums md:text-xl">
              {obshtinaCount != null
                ? obshtinaCount.toLocaleString(locale)
                : "—"}
            </span>
          </div>
        </StatCard>
      </div>

      <MixBar
        segments={segments}
        selected={selectedFacet}
        onSelect={onSelectFacet}
        title={t("persons_mix_title", {
          defaultValue: "Основна принадлежност",
        })}
        note={t("persons_mix_note", {
          defaultValue:
            "Групата на най-високата заемана длъжност. Един човек често е в няколко групи — за „също така е…“ използвайте филтъра Група.",
        })}
      />
    </div>
  );
};
