// /prices/map — the price maps, split out of the basket dashboard. One Leaflet
// choropleth driven by a metric switcher (pills, not tabs): basket cost (€),
// change since the euro (%), and the cheapest chain per município (categorical).
// A single map instance is mounted and re-coloured on switch — never three
// Leaflet maps at once. A monitoring basket index, NOT official CPI.

import { FC, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag, ArrowRight } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { Title } from "@/ux/Title";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Card } from "@/components/ui/card";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { usePriceIndex } from "@/data/prices/usePrices";
import {
  PriceChoropleth,
  type PriceMetric,
} from "@/screens/components/prices/PriceChoropleth";

export const PricesMapScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const { data: index } = usePriceIndex();

  const [metric, setMetric] = useState<PriceMetric>("level");
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

  const title = T("Карта на цените", "Price map");
  const description = T(
    "Кошницата по общини — цена, промяна от еврото и коя верига е най-евтина къде.",
    "The basket by municipality — cost, change since the euro, and which chain is cheapest where.",
  );

  const metrics: { key: PriceMetric; label: string }[] = [
    { key: "level", label: T("Цена на кошницата", "Basket cost") },
    { key: "change", label: T("Промяна от еврото", "Change since the euro") },
    { key: "chain", label: T("Най-евтина верига", "Cheapest chain") },
  ];

  return (
    <>
      <SEO
        title={`${title} · ${T("Потребление", "Consumption")}`}
        description={description}
      />
      <ConsumptionBreadcrumb
        section={T("Цени", "Prices")}
        sectionTo="/prices"
        current={title}
        className="mt-4 mb-2"
      />
      <Title description={description}>{title}</Title>

      <Card className="my-4 p-4">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {metrics.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              aria-pressed={metric === m.key}
              className={`rounded border px-3 py-1 text-sm ${
                metric === m.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div ref={ref} className="h-[420px] w-full md:h-[520px]">
          {size && <PriceChoropleth metric={metric} size={size} />}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Tag className="size-3" />
            {t("prices_not_cpi")}
          </span>
          {index?.source?.url ? (
            <a
              href={index.source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              kolkostruva.bg
              <ArrowRight className="size-3" />
            </a>
          ) : null}
        </div>
      </Card>
    </>
  );
};
