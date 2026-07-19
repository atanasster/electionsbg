// /consumption/electricity — "Ток", household electricity prices in Bulgaria vs
// the EU and the neighbour peers (RO/GR/HU/HR). Euro-super's power twin: Eurostat
// nrg_pc_204 (all taxes, 2500-4999 kWh band, EUR/kWh), bi-annual since 2007.
// Bulgaria has among the LOWEST household electricity prices in the EU.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Title } from "@/ux/Title";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import { useEnergyPrices } from "@/data/energy/useEnergyPrices";
import { latestCommonPrice, type PricePoint } from "@/data/energy/types";
import { fmtEur } from "@/data/prices/usePrices";
import type { PeerGeo } from "@/data/macro/useMacroPeers";
import {
  PriceTrendChart,
  PriceStat,
  gapVsEu,
  type PriceRow,
} from "./PriceTrendChart";

const GEOS: PeerGeo[] = ["BG", "EU27_2020", "RO", "GR", "HU", "HR"];

// "2007-S2" → "2007-07-01" so the cabinet strip can treat a half-year period as a
// date (S1 = first half → Jan, S2 = second half → Jul).
const periodToDate = (p: string): string => {
  const [y, s] = p.split("-");
  return `${y}-${s === "S2" ? "07" : "01"}-01`;
};

export const ConsumptionElectricityScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const { data } = useEnergyPrices();

  // Merge the per-geo arrays into one row per period. EU27/peers can lag, so a
  // value may be missing on the last BG point — `connectNulls` bridges it.
  const rows = useMemo<PriceRow[]>(() => {
    if (!data) return [];
    const map = (arr?: PricePoint[]) =>
      new Map((arr ?? []).map((p) => [p.period, p.value]));
    const eu = map(data.series.EU27);
    const ro = map(data.series.RO);
    const gr = map(data.series.GR);
    const hu = map(data.series.HU);
    const hr = map(data.series.HR);
    return data.series.BG.map((p) => ({
      x: p.period,
      date: periodToDate(p.period),
      BG: p.value,
      EU27_2020: eu.get(p.period) ?? null,
      RO: ro.get(p.period) ?? null,
      GR: gr.get(p.period) ?? null,
      HU: hu.get(p.period) ?? null,
      HR: hr.get(p.period) ?? null,
    }));
  }, [data]);

  // Headline gap anchored to the latest period present in BOTH BG and EU27.
  const cmp = data ? latestCommonPrice(data) : null;
  const gap = cmp ? gapVsEu(cmp.bg, cmp.eu) : null;

  const value = (v: number) => `${fmtEur(v, lang, 3)}/${T("кВтч", "kWh")}`;

  return (
    <>
      <SEO
        title={T("Ток · Потребление", "Electricity · Consumption")}
        description={T(
          "Цената на тока за домакинствата в България спрямо ЕС и съседните държави — с всички данъци (EUR/кВтч), Eurostat. България е сред най-ниските в съюза.",
          "Household electricity prices in Bulgaria vs the EU and neighbours — all taxes (EUR/kWh), Eurostat. Bulgaria is among the lowest in the union.",
        )}
      />
      <ConsumptionBreadcrumb
        section={T("Ток", "Electricity")}
        className="mt-4 mb-2"
      />
      <Title>{T("Ток", "Electricity")}</Title>

      <section aria-label={T("Ток", "Electricity")}>
        <DashboardSection
          id="prices"
          title={T("Ток спрямо ЕС", "Electricity vs the EU")}
          subtitle={
            data?.latest
              ? `${T("домакинства · с всички данъци", "households · all taxes")} · ${data.latest}`
              : T("домакинства · с всички данъци", "households · all taxes")
          }
          icon={Zap}
        >
          {!data || rows.length === 0 ? null : (
            <Card className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap gap-x-10 gap-y-3">
                <PriceStat
                  label={T("Ток за домакинствата", "Household electricity")}
                  valueText={cmp ? value(cmp.bg) : null}
                  gap={gap}
                  lang={lang}
                />
              </div>

              <PriceTrendChart
                rows={rows}
                geos={GEOS}
                lang={lang}
                formatValue={value}
                formatY={(v) => v.toFixed(2)}
              />

              <p className="text-xs text-muted-foreground">
                {T(
                  "Потребителски цени с всички данъци, band 2500-4999 kWh (Eurostat). Токът за българските домакинства е трайно под средното за ЕС — около половината.",
                  "Consumer prices incl. all taxes, 2500-4999 kWh band (Eurostat). Bulgarian household electricity is consistently below the EU average — about half.",
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
