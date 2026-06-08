// "Where is the basket cheapest?" — two national municipality choropleths
// stacked: basket cost (€) and change since the euro. Centerpiece of /prices.

import { FC, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { StatCard } from "@/screens/dashboard/StatCard";
import { PriceChoropleth, type PriceMetric } from "./PriceChoropleth";

// One labelled, self-measuring choropleth block.
const MapBlock: FC<{ metric: PriceMetric; label: string }> = ({
  metric,
  label,
}) => {
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
    <div className="flex flex-col gap-1.5">
      <div className="text-sm font-medium">{label}</div>
      <div ref={ref} className="w-full h-[340px] md:h-[400px]">
        {size && <PriceChoropleth metric={metric} size={size} />}
      </div>
    </div>
  );
};

export const PriceHeatmapTile: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          <span>{T("Карта на цените", "Price map")}</span>
        </div>
      }
      hint={t("prices_not_cpi")}
    >
      <div className="flex flex-col gap-6">
        <MapBlock
          metric="level"
          label={T("Цена на кошницата", "Basket cost")}
        />
        <MapBlock
          metric="change"
          label={T("Промяна от въвеждането на еврото", "Change since the euro")}
        />
      </div>
    </StatCard>
  );
};
