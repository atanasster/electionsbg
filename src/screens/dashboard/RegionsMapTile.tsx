import { FC, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Link } from "@/ux/Link";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { RegionsMap } from "@/screens/components/regions/RegionsMap";
import { StatCard } from "./StatCard";

export const RegionsMapTile: FC = () => {
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
            <span>{t("dashboard_regional_map")}</span>
          </div>
          <Link
            to="/?view=map"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_open_full_map")} →
          </Link>
        </div>
      }
      hint={t("dashboard_regional_map_hint")}
    >
      <div ref={ref} className="w-full h-[360px] md:h-[420px]">
        {size && <RegionsMap size={size} />}
      </div>
    </StatCard>
  );
};
