// /water/services — what people get from the water system: rationing (воден
// режим) and access to public water supply and wastewater treatment, from the
// НСИ Ecology_9.8 series (data/water/water_stats.json). National and
// whole-history, so the page carries NO scope control (W4). The hub's
// „Водоснабдяване и пречистване" tile links #access.

import { FC } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useWaterStats } from "@/data/water/useWaterStats";
import { WaterStatsTile } from "./WaterStatsTile";
import { WaterPageFrame } from "./WaterPageFrame";

const fmtPct = (v: number | null, bg: boolean): string =>
  v == null
    ? "—"
    : new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
        maximumFractionDigits: 1,
      }).format(v) + "%";

export const WaterServicesScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const { data, isLoading, isError } = useWaterStats();
  // Newest first: the reader's question is „how is it now".
  const years = [...(data?.years ?? [])].sort((a, b) => b.year - a.year);
  return (
    <WaterPageFrame
      title={{
        bg: "Воден режим и достъп до водни услуги",
        en: "Water rationing and access to water services",
      }}
      description={{
        bg: "Делът на населението с режим на водоподаване, свързано с обществено водоснабдяване и с пречистване на отпадъчните води, по години — по данни на НСИ.",
        en: "The share of the population under water rationing, connected to public water supply and to wastewater treatment, by year — from NSI.",
      }}
      scoped={false}
      ready={[years.length]}
      status={{ isLoading, isError }}
    >
      <WaterStatsTile />
      <section id="access" className="scroll-mt-20">
        {years.length ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {bg
                  ? "Водоснабдяване и пречистване по години"
                  : "Water supply and treatment by year"}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-3 md:p-4">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left font-normal">
                      {bg ? "Година" : "Year"}
                    </th>
                    <th className="py-1 text-right font-normal">
                      {bg ? "Обществено водоснабдяване" : "Public water supply"}
                    </th>
                    <th className="py-1 text-right font-normal">
                      {bg
                        ? "Пречистване на отпадъчни води"
                        : "Wastewater treatment"}
                    </th>
                    <th className="py-1 text-right font-normal">
                      {bg ? "Воден режим" : "Rationing"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => (
                    <tr key={y.year} className="border-t border-border/60">
                      <td className="py-1">{y.year}</td>
                      <td className="py-1 text-right">
                        {fmtPct(y.connectedWaterPct, bg)}
                      </td>
                      <td className="py-1 text-right">
                        {fmtPct(y.wasteTreatmentPct, bg)}
                      </td>
                      <td className="py-1 text-right">
                        {fmtPct(y.rationingPct, bg)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground/80">
                {bg
                  ? "Процент от населението на страната. Източник: НСИ, Статистика на водите (Ecology_9.8)."
                  : "Percent of the national population. Source: NSI, water statistics (Ecology_9.8)."}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </section>
    </WaterPageFrame>
  );
};
