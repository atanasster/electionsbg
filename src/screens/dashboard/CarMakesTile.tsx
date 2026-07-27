import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Car, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useCarMakesAgg } from "@/data/parliament/useCarMakes";
import { toScopedMpIds } from "@/data/parliament/useAssetsRankings";
import { useDataProvenance } from "@/data/parliament/useDataProvenance";
import { useMps } from "@/data/parliament/useMps";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder, oblastToMir } from "@/data/parliament/nsFolders";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";
import { provenanceText, provenanceTooltip } from "./provenanceUtils";
import type { CarMakeEntry } from "@/data/dataTypes";

type Props = {
  /** Optional region code (e.g. "S23"). When provided, the tile aggregates
   * only cars declared by MPs from that region. Mutually exclusive with
   * `regionCodes`. */
  regionCode?: string;
  /** Optional set of region codes (e.g. Sofia's three MIRs). */
  regionCodes?: string[];
  /** When true, the tile suppresses its own provenance footer — the parent
   * (typically a DashboardSection subtitle) is showing it instead. */
  hideProvenance?: boolean;
  className?: string;
};

const ROWS = 5;

export const CarMakesTile: FC<Props> = ({
  regionCode,
  regionCodes,
  hideProvenance = false,
  className,
}) => {
  const { t, i18n } = useTranslation();
  const { provenance } = useDataProvenance();
  const { selected } = useElectionContext();
  const { findMpsByRegion } = useMps();

  const selectedFolder = useMemo(
    () => electionToNsFolder(selected),
    [selected],
  );

  const regionMpIds = useMemo(() => {
    const codes = regionCodes ?? (regionCode ? [regionCode] : null);
    if (!codes || codes.length === 0) return null;
    if (!selectedFolder) return null;
    const ids = new Set<number>();
    for (const code of codes) {
      const mir = oblastToMir(code);
      if (!mir) continue;
      for (const m of findMpsByRegion(mir, selectedFolder)) ids.add(m.id);
    }
    return ids;
  }, [regionCode, regionCodes, selectedFolder, findMpsByRegion]);

  const isRegional = regionMpIds != null;

  // Distinct-MP-per-make from the car-makes route. National → the selected parliament's ns
  // bucket, lifetime ('all') fallback when it has none; regional → the lifetime bucket filtered
  // to the region's mp-ids (the old regional rollup ran over the flat, un-ns-filtered car list).
  const mpIds = useMemo(
    () => (regionMpIds ? toScopedMpIds([...regionMpIds]) : null),
    [regionMpIds],
  );
  const primary = useCarMakesAgg({
    ns: isRegional ? "all" : (selectedFolder ?? "all"),
    mpIds,
  });
  const doFallback =
    !isRegional &&
    selectedFolder != null &&
    !primary.isLoading &&
    primary.makes.length === 0;
  const fallback = useCarMakesAgg({
    ns: "all",
    mpIds: null,
    enabled: doFallback,
  });
  const topCars: CarMakeEntry[] = (
    primary.makes.length ? primary.makes : fallback.makes
  ).slice(0, ROWS);

  const provenanceScope = useMemo(() => {
    if (!provenance) return undefined;
    if (selectedFolder && provenance.byNs[selectedFolder]) {
      return provenance.byNs[selectedFolder];
    }
    return provenance.all;
  }, [provenance, selectedFolder]);

  const detailsTo = useMemo(() => {
    if (regionCodes && regionCodes.length > 0) {
      const params = new URLSearchParams({ regions: regionCodes.join(",") });
      return `/mp-cars?${params.toString()}`;
    }
    if (regionCode) {
      const params = new URLSearchParams({ region: regionCode });
      return `/mp-cars?${params.toString()}`;
    }
    return "/mp-cars";
  }, [regionCode, regionCodes]);

  // Hidden while the aggregate is still resolving. A car-less REGION hides entirely (as before
  // — the parliament-wide empty-state copy doesn't fit a region, and useRegionDeclarationsHasContent
  // decides the surrounding section); the national tile keeps its empty-state below.
  const isLoading = primary.isLoading || (doFallback && fallback.isLoading);
  if (isLoading) return null;
  if (isRegional && topCars.length === 0) return null;

  const titleKey = isRegional
    ? "dashboard_car_makes_region_title"
    : "dashboard_car_makes_title";
  const titleFallback = isRegional ? "Region MPs' car makes" : "MPs' car makes";

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Car className="h-4 w-4 shrink-0" />
            <span className="truncate">{t(titleKey) || titleFallback}</span>
          </div>
          <Link
            to={detailsTo}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("dashboard_car_makes_open_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="mt-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          {t("dashboard_mp_connections_top_cars_label") || "Top car makes"}
        </div>
        {topCars.length === 0 ? (
          <div className="text-xs text-muted-foreground py-0.5">
            {t("dashboard_mp_connections_no_cars") ||
              "No vehicle declarations on file for this parliament yet"}
          </div>
        ) : (
          topCars.map((row, i) => (
            <div
              key={row.make}
              className="text-xs flex items-baseline gap-2 py-0.5"
            >
              <span className="text-muted-foreground w-4 shrink-0 text-right tabular-nums">
                {i + 1}.
              </span>
              <span className="truncate flex-1">{row.make}</span>
              <span className="text-muted-foreground tabular-nums shrink-0">
                {row.mpCount}
              </span>
            </div>
          ))
        )}
      </div>
      {!isRegional && !hideProvenance && provenanceScope && (
        <div className="mt-2 pt-2 border-t flex items-center justify-end text-[11px] text-muted-foreground gap-2">
          <Hint
            text={provenanceTooltip(provenanceScope)}
            underline={false}
            className="truncate text-right"
          >
            <span className="truncate">
              {provenanceText(
                provenanceScope,
                provenance?.generatedAt,
                i18n.language,
                (key, fallback, opts) => t(key, fallback ?? key, opts),
              )}
            </span>
          </Hint>
        </div>
      )}
    </StatCard>
  );
};
