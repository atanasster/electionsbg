// Shared page body for the /consumption household-energy price trends (electricity,
// natural gas). Both are Eurostat bi-annual EUR/kWh series with the identical shape
// (BG vs the EU average vs the RO/GR/HU/HR peers), a single KPI tile + the shared
// PriceTrendChart — so this owns the period→row merge, the KPI gap, and the layout;
// the two screens are thin config wrappers.

import { FC, ReactNode, useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Title } from "@/ux/Title";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import {
  latestCommonPrice,
  type EnergyPrices,
  type PricePoint,
} from "@/data/energy/types";
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

export interface EnergyPriceScreenConfig {
  data: EnergyPrices | undefined;
  lang: "bg" | "en";
  icon: LucideIcon;
  seoTitle: string;
  seoDescription: string;
  breadcrumb: string;
  title: string;
  sectionTitle: string;
  /** Section subtitle without the trailing "· <period>" (this adds it). */
  subtitleBase: string;
  statLabel: string;
  /** Unit shown after the price, e.g. "кВтч"/"kWh". */
  unitLabel: string;
  /** Decimal places for the €/kWh price (electricity & gas differ in magnitude). */
  valueDp: number;
  formatY: (v: number) => string;
  note: ReactNode;
}

export const EnergyPriceTrendScreen: FC<EnergyPriceScreenConfig> = ({
  data,
  lang,
  icon,
  seoTitle,
  seoDescription,
  breadcrumb,
  title,
  sectionTitle,
  subtitleBase,
  statLabel,
  unitLabel,
  valueDp,
  formatY,
  note,
}) => {
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
  const value = (v: number) => `${fmtEur(v, lang, valueDp)}/${unitLabel}`;

  return (
    <>
      <SEO title={seoTitle} description={seoDescription} />
      <ConsumptionBreadcrumb section={breadcrumb} className="mt-4 mb-2" />
      <Title>{title}</Title>

      <section aria-label={breadcrumb}>
        <DashboardSection
          id="prices"
          title={sectionTitle}
          subtitle={
            data?.latest ? `${subtitleBase} · ${data.latest}` : subtitleBase
          }
          icon={icon}
        >
          {!data || rows.length === 0 ? null : (
            <Card className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap gap-x-10 gap-y-3">
                <PriceStat
                  label={statLabel}
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
                formatY={formatY}
              />

              <p className="text-xs text-muted-foreground">{note}</p>
            </Card>
          )}
        </DashboardSection>
      </section>
    </>
  );
};
