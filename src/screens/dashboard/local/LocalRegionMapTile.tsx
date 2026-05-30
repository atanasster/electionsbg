// Region municipalities choropleth: each município in the oblast filled by its
// elected mayor's party. Reuses the parliamentary municipality GeoJSON for the
// region; colour comes from the local region rollup.

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

export const LocalRegionMapTile: FC<{ cycle: string; oblast: string }> = ({
  cycle,
  oblast,
}) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const mapGeo = useMunicipalitiesMap(oblast);
  const { data: region } = useLocalRegion(oblast, cycle);

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
          <span>{t("local_region_map")}</span>
        </div>
      }
      hint={t("local_region_map_hint")}
    >
      <div ref={ref} className="w-full h-[360px] md:h-[440px]">
        {size && (
          <LocalChoropleth<MunicipalityJSONProps>
            size={size}
            mapGeo={mapGeo}
            colorOf={(p) => byMuni.get(p.nuts4)?.electedMayor?.color}
            tooltipOf={(p) => {
              const row = byMuni.get(p.nuts4);
              return (
                <div className="text-left">
                  <div className="text-sm font-semibold pb-1">
                    {row?.name ?? p.nuts4}
                  </div>
                  {row?.electedMayor ? (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-sm shrink-0"
                        style={{ backgroundColor: row.electedMayor.color }}
                      />
                      <span className="font-medium">
                        {row.electedMayor.candidateName}
                      </span>
                      <span className="opacity-70">
                        {row.electedMayor.displayName}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs opacity-70">
                      {t("local_election_no_winner")}
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
