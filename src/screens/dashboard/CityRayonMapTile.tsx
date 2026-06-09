// Main-map slot for Plovdiv-city / Varna-city: shows the районы as a Leaflet
// choropleth (same as the Sofia МИР map) instead of the single-blob settlements
// map. Mounted by MunicipalityDashboardCards in place of
// MunicipalitySettlementsMapTile when hasCityRayons(municipalityCode).

import { FC, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { CityRayonMap } from "@/screens/components/rayon/CityRayonMap";
import { StatCard } from "./StatCard";

export const CityRayonMapTile: FC<{ municipalityCode: string }> = ({
  municipalityCode,
}) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();

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
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <MapIcon className="h-4 w-4" />
            <span>{t("dashboard_regional_map_rayoni")}</span>
          </div>
        </div>
      }
      hint={t("city_rayon_breakdown_hint")}
    >
      <div ref={ref} className="w-full h-[360px] md:h-[420px]">
        {size && (
          <CityRayonMap municipalityCode={municipalityCode} size={size} />
        )}
      </div>
    </StatCard>
  );
};
