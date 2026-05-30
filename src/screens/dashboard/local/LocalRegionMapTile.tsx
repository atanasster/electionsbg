// Region municipalities choropleth. One tile, two metrics:
//   metric="mayor"   → each município filled by its elected mayor's party
//   metric="council" → each município filled by its leading council party
// Reuses the parliamentary municipality GeoJSON for the region; colour comes
// from the local region rollup.

import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useMunicipalitiesMap } from "@/data/municipalities/useMunicipalitiesMap";
import { MunicipalityJSONProps } from "@/screens/components/maps/mapTypes";
import { LocalChoropleth } from "@/screens/components/local/LocalChoropleth";
import { useLocalRegion } from "@/data/local/useLocalRegion";
import { LocalRegionMunicipalityRow } from "@/data/local/types";
import { StatCard } from "../StatCard";
import { LocalMapMetric } from "./LocalRegionsControlMapTile";

export const LocalRegionMapTile: FC<{
  cycle: string;
  oblast: string;
  metric: LocalMapMetric;
}> = ({ cycle, oblast, metric }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const mapGeo = useMunicipalitiesMap(oblast);
  const { data: region } = useLocalRegion(oblast, cycle);
  const isMayor = metric === "mayor";

  const byMuni = useMemo(() => {
    const m = new Map<string, LocalRegionMunicipalityRow>();
    for (const r of region?.municipalities ?? []) m.set(r.obshtinaCode, r);
    return m;
  }, [region]);

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

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          <span>
            {isMayor ? t("local_region_map") : t("local_region_council_map")}
          </span>
        </div>
      }
      hint={
        isMayor
          ? t("local_region_map_hint")
          : t("local_region_council_map_hint")
      }
    >
      <div ref={ref} className="w-full h-[360px] md:h-[440px]">
        {size && (
          <LocalChoropleth<MunicipalityJSONProps>
            size={size}
            mapGeo={mapGeo}
            colorOf={(p) => {
              const row = byMuni.get(p.nuts4);
              return isMayor
                ? row?.electedMayor?.color
                : row?.topCouncil?.color;
            }}
            tooltipOf={(p) => {
              const row = byMuni.get(p.nuts4);
              const mayor = row?.electedMayor;
              const council = row?.topCouncil;
              return (
                <div className="text-left">
                  <div className="text-sm font-semibold pb-1">
                    {row?.name ?? p.nuts4}
                  </div>
                  {isMayor ? (
                    mayor ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span
                          aria-hidden
                          className="inline-block size-2 rounded-sm shrink-0"
                          style={{ backgroundColor: mayor.color }}
                        />
                        <span className="font-medium">
                          {mayor.candidateName}
                        </span>
                        <span className="opacity-70">{mayor.displayName}</span>
                      </div>
                    ) : (
                      <div className="text-xs opacity-70">
                        {t("local_election_no_winner")}
                      </div>
                    )
                  ) : council ? (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-sm shrink-0"
                        style={{ backgroundColor: council.color }}
                      />
                      <span className="font-medium">{council.displayName}</span>
                      <span className="opacity-70 tabular-nums">
                        {t("local_region_seats_count", {
                          count: council.seats,
                        })}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs opacity-70">
                      {t("local_election_no_data")}
                    </div>
                  )}
                </div>
              );
            }}
            onClickPath={(p) => ({
              pathname: `/local/${cycle}/${p.nuts4}`,
            })}
          />
        )}
      </div>
    </StatCard>
  );
};
