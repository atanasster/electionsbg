// Region municipalities choropleth. One tile, two metrics:
//   metric="mayor"   → each município filled by its elected mayor's party
//   metric="council" → each município filled by its leading council party
// Reuses the parliamentary municipality GeoJSON for the region; colour comes
// from the local region rollup.
//
// ⚠ THE MAP ITSELF LIVES IN `LocalRegionChoropleth` and this is its `StatCard` frame. The
// election shell's `local/region/winner` adapter draws the same component bare, so the two
// copies of this map on the region page cannot disagree.

import { FC, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { StatCard } from "../StatCard";
import { LocalRegionChoropleth } from "./LocalRegionChoropleth";
import { LocalMapMetric } from "./LocalRegionsControlMapTile";

export const LocalRegionMapTile: FC<{
  cycle: string;
  oblast: string;
  metric: LocalMapMetric;
}> = ({ cycle, oblast, metric }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const isMayor = metric === "mayor";

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
          <LocalRegionChoropleth
            size={size}
            cycle={cycle}
            oblast={oblast}
            metric={metric}
          />
        )}
      </div>
    </StatCard>
  );
};
