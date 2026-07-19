// /consumption/fuel — "Горива", consumer fuel prices in Bulgaria vs the EU and
// the neighbour peers (RO/GR/HU/HR). Euro-super 95 + automotive diesel (EUR/L,
// VAT-inclusive) from the EU Weekly Oil Bulletin, one trend per fuel with the
// BG-vs-EU gap. The one clean cost-of-living indicator beyond groceries.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Fuel } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Title } from "@/ux/Title";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import { useFuel, type FuelGeo, type FuelPoint } from "@/data/prices/useFuel";
import { fmtEur } from "@/data/prices/usePrices";
import type { PeerGeo } from "@/data/macro/useMacroPeers";
import {
  PriceTrendChart,
  PriceStat,
  gapVsEu,
  type PriceRow,
} from "./PriceTrendChart";

const GEOS: PeerGeo[] = ["BG", "EU27_2020", "RO", "GR", "HU", "HR"];

const toRows = (series: FuelPoint[], fuel: "petrol" | "diesel"): PriceRow[] =>
  series.map((s) => {
    const vals = s[fuel] as Partial<Record<FuelGeo, number | null>>;
    return { x: s.date, date: s.date, ...vals } as PriceRow;
  });

export const ConsumptionFuelScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const { data } = useFuel();

  const series = useMemo(() => data?.series ?? [], [data]);
  const petrolRows = useMemo(() => toRows(series, "petrol"), [series]);
  const dieselRows = useMemo(() => toRows(series, "diesel"), [series]);
  const latest = series[series.length - 1];
  const gap95 = latest
    ? gapVsEu(latest.petrol.BG, latest.petrol.EU27_2020)
    : null;
  const gapDsl = latest
    ? gapVsEu(latest.diesel.BG, latest.diesel.EU27_2020)
    : null;

  const value = (v: number) => `${fmtEur(v, lang, 2)}/${T("л", "L")}`;
  const formatY = (v: number) => v.toFixed(1);

  const subheading = (label: string) => (
    <div className="text-sm font-semibold">{label}</div>
  );

  return (
    <>
      <SEO
        title={T("Горива · Потребление", "Fuel · Consumption")}
        description={T(
          "Цените на горивата в България спрямо ЕС и съседните държави — бензин А95 и дизел (EUR/л, с ДДС), Седмичен нефтен бюлетин на ЕК.",
          "Fuel prices in Bulgaria vs the EU and neighbours — petrol 95 and diesel (EUR/L, incl. VAT), EU Weekly Oil Bulletin.",
        )}
      />
      <ConsumptionBreadcrumb
        section={T("Горива", "Fuel")}
        className="mt-4 mb-2"
      />
      <Title>{T("Горива", "Fuel")}</Title>

      <section aria-label={T("Горива", "Fuel")}>
        <DashboardSection
          id="prices"
          title={T("Горива спрямо ЕС", "Fuel vs the EU")}
          subtitle={
            data?.latestDate
              ? `${T("бензин А95 и дизел · с ДДС", "petrol 95 & diesel · incl. VAT")} · ${data.latestDate}`
              : T(
                  "бензин А95 и дизел · с ДДС",
                  "petrol 95 & diesel · incl. VAT",
                )
          }
          icon={Fuel}
        >
          {!data || series.length === 0 ? null : (
            <Card className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap gap-x-10 gap-y-3">
                <PriceStat
                  label={T("Бензин А95", "Petrol 95")}
                  valueText={
                    latest?.petrol.BG != null ? value(latest.petrol.BG) : null
                  }
                  gap={gap95}
                  lang={lang}
                />
                <PriceStat
                  label={T("Дизел", "Diesel")}
                  valueText={
                    latest?.diesel.BG != null ? value(latest.diesel.BG) : null
                  }
                  gap={gapDsl}
                  lang={lang}
                />
              </div>

              {subheading(T("Бензин А95", "Petrol 95"))}
              <PriceTrendChart
                rows={petrolRows}
                geos={GEOS}
                lang={lang}
                formatValue={value}
                formatY={formatY}
                showCabinet={false}
              />

              {subheading(T("Дизел", "Diesel"))}
              <PriceTrendChart
                rows={dieselRows}
                geos={GEOS}
                lang={lang}
                formatValue={value}
                formatY={formatY}
              />

              <p className="text-xs text-muted-foreground">
                {T(
                  "Потребителски цени с всички данъци (Седмичен нефтен бюлетин на Европейската комисия). Българските горива са трайно под средното за ЕС.",
                  "Consumer prices incl. all taxes (European Commission Weekly Oil Bulletin). Bulgarian fuel is consistently below the EU average.",
                )}{" "}
                <a
                  href={data.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {data.source}
                </a>
              </p>
            </Card>
          )}
        </DashboardSection>
      </section>
    </>
  );
};
