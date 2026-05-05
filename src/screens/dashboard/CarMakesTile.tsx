import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Car, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useCarMakes } from "@/data/parliament/useCarMakes";
import { useDataProvenance } from "@/data/parliament/useDataProvenance";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";
import {
  provenanceText,
  provenanceTooltip,
} from "./MpDeclarationsProvenance";
import type { CarMakeEntry } from "@/data/dataTypes";

type Props = {
  /** When true, the tile suppresses its own provenance footer — the parent
   * (typically a DashboardSection subtitle) is showing it instead. */
  hideProvenance?: boolean;
  className?: string;
};

const ROWS = 5;

export const CarMakesTile: FC<Props> = ({
  hideProvenance = false,
  className,
}) => {
  const { t, i18n } = useTranslation();
  const { carMakes } = useCarMakes();
  const { provenance } = useDataProvenance();
  const { selected } = useElectionContext();

  const selectedFolder = useMemo(
    () => electionToNsFolder(selected),
    [selected],
  );

  const topCars: CarMakeEntry[] = useMemo(() => {
    if (!carMakes) return [];
    if (selectedFolder && carMakes.byNs[selectedFolder]) {
      return carMakes.byNs[selectedFolder].topMakes.slice(0, ROWS);
    }
    return carMakes.all.topMakes.slice(0, ROWS);
  }, [carMakes, selectedFolder]);

  const provenanceScope = useMemo(() => {
    if (!provenance) return undefined;
    if (selectedFolder && provenance.byNs[selectedFolder]) {
      return provenance.byNs[selectedFolder];
    }
    return provenance.all;
  }, [provenance, selectedFolder]);

  if (!carMakes) return null;

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Car className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("dashboard_car_makes_title") || "MPs' car makes"}
            </span>
          </div>
          <Link
            to="/mp-cars"
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
      {!hideProvenance && provenanceScope && (
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
