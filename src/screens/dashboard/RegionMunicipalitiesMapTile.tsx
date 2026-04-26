import { FC, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { MunicipalitiesMap } from "@/screens/components/municipalities/MunicipalitiesMap";
import { StatCard } from "./StatCard";

type Props = {
  regionCode: string;
};

export const RegionMunicipalitiesMapTile: FC<Props> = ({ regionCode }) => {
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
            <span>{t("dashboard_regional_map_municipalities")}</span>
          </div>
        </div>
      }
      hint={t("dashboard_regional_map_municipalities_hint")}
    >
      <div ref={ref} className="w-full h-[360px] md:h-[420px]">
        {size && <MunicipalitiesMap region={regionCode} size={size} />}
      </div>
    </StatCard>
  );
};
