import { FC, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { SectionsMap } from "@/screens/components/sections/SectionsMap";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import { StatCard } from "./StatCard";

type Props = {
  ekatte: string;
};

export const SectionsMapTile: FC<Props> = ({ ekatte }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const { settlement } = useSettlementVotes(ekatte);

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

  const hasCoords = settlement?.sections?.some(
    (s) => typeof s.longitude === "number" && typeof s.latitude === "number",
  );
  if (!hasCoords) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <MapIcon className="h-4 w-4" />
            <span>{t("dashboard_settlement_map_sections")}</span>
          </div>
        </div>
      }
      hint={t("dashboard_settlement_map_sections_hint")}
    >
      <div ref={ref} className="w-full h-[360px] md:h-[420px]">
        {size && settlement && (
          <SectionsMap sections={settlement.sections} size={size} />
        )}
      </div>
    </StatCard>
  );
};
