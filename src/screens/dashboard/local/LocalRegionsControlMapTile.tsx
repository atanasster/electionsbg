// National oblast choropleth for local elections. One tile, two metrics:
//   metric="mayor"   → fill by the party holding the most mayoralties (who governs)
//   metric="council" → fill by the top council party by seats (party support)
// Council votes track party preference better than winner-take-all mayoral
// races, so both maps are shown together. Reuses the parliamentary regions
// GeoJSON; colour comes from the local regions_summary.

import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import { useRegions } from "@/data/regions/useRegions";
import { RegionJSONProps } from "@/screens/components/maps/mapTypes";
import { LocalChoropleth } from "@/screens/components/local/LocalChoropleth";
import { useLocalRegionsSummary } from "@/data/local/useLocalRegionsSummary";
import { LocalRegionsSummaryRow } from "@/data/local/types";
import { StatCard } from "../StatCard";

export type LocalMapMetric = "mayor" | "council";

// Parliamentary splits Sofia city into three constituencies (S23/S24/S25);
// local government treats it as one entity keyed SOF.
const nuts3ToOblast = (nuts3: string): string =>
  /^S2[345]$/.test(nuts3) ? "SOF" : nuts3;

export const LocalRegionsControlMapTile: FC<{
  cycle: string;
  metric: LocalMapMetric;
}> = ({ cycle, metric }) => {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const mapGeo = useRegionsMap();
  const { data: summary } = useLocalRegionsSummary(cycle);
  const { findRegion } = useRegions();
  const isMayor = metric === "mayor";

  const byOblast = useMemo(() => {
    const m = new Map<string, LocalRegionsSummaryRow>();
    for (const r of summary?.regions ?? []) m.set(r.oblast, r);
    return m;
  }, [summary]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize([el.offsetWidth, el.offsetHeight, el.offsetLeft, el.offsetTop]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const regionName = (code: string): string => {
    const info = findRegion(code);
    if (!info) return code === "SOF" ? t("local_region_sofia_city") : code;
    return (
      (i18n.language === "bg"
        ? info.long_name || info.name
        : info.long_name_en || info.name_en) || code
    );
  };

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          <span>
            {isMayor
              ? t("local_national_mayors_map")
              : t("local_national_council_map")}
          </span>
        </div>
      }
      hint={
        isMayor
          ? t("local_national_mayors_map_hint")
          : t("local_national_council_map_hint")
      }
    >
      <div ref={ref} className="w-full h-[360px] md:h-[480px]">
        {size && (
          <LocalChoropleth<RegionJSONProps>
            size={size}
            mapGeo={mapGeo}
            colorOf={(p) => {
              const row = byOblast.get(nuts3ToOblast(p.nuts3));
              return isMayor ? row?.topMayor?.color : row?.topCouncil?.color;
            }}
            tooltipOf={(p) => {
              const oblast = nuts3ToOblast(p.nuts3);
              const row = byOblast.get(oblast);
              const party = isMayor ? row?.topMayor : row?.topCouncil;
              const suffix = isMayor
                ? row?.topMayor
                  ? t("local_region_mayors_count", {
                      count: row.topMayor.count,
                    })
                  : ""
                : row?.topCouncil
                  ? t("local_region_seats_count", {
                      count: row.topCouncil.seats,
                    })
                  : "";
              return (
                <div className="text-left">
                  <div className="text-sm font-semibold pb-1">
                    {regionName(oblast)}
                  </div>
                  {party ? (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-sm shrink-0"
                        style={{ backgroundColor: party.color }}
                      />
                      <span className="font-medium">{party.displayName}</span>
                      <span className="opacity-70 tabular-nums">{suffix}</span>
                    </div>
                  ) : (
                    <div className="text-xs opacity-70">
                      {t("local_election_no_data")}
                    </div>
                  )}
                </div>
              );
            }}
            onClickPath={(p) => {
              const oblast = nuts3ToOblast(p.nuts3);
              return oblast === "SOF"
                ? { pathname: `/local/${cycle}/SOF` }
                : { pathname: `/local/${cycle}/region/${oblast}` };
            }}
          />
        )}
      </div>
    </StatCard>
  );
};
