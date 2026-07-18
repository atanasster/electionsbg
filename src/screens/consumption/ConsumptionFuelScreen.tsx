// /consumption/fuel — "Горива", consumer fuel prices in Bulgaria vs the EU.
// Euro-super 95 + automotive diesel (EUR/L, VAT-inclusive) from the EU Weekly Oil
// Bulletin, with a since-2023 trend line and the BG-vs-EU-average gap. The one
// clean cost-of-living indicator beyond groceries.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Fuel } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { SEO } from "@/ux/SEO";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import { useFuel } from "@/data/prices/useFuel";
import { fmtEur, fmtPct, priceChangeColor } from "@/data/prices/usePrices";
import { ChartCabinetStrip } from "@/screens/components/governments/ChartCabinetStrip";

const AMBER = "#b07d2f";
const STEEL = "#4a7a8f";

export const ConsumptionFuelScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const { data } = useFuel();

  const series = useMemo(() => data?.series ?? [], [data]);
  const latest = series[series.length - 1];
  // BG vs EU average gap (negative = BG cheaper).
  const gap = (bgV: number | null, euV: number | null): number | null =>
    bgV != null && euV != null && euV !== 0 ? bgV / euV - 1 : null;
  const gap95 = latest ? gap(latest.bg95, latest.eu95) : null;
  const gapDsl = latest ? gap(latest.bgDiesel, latest.euDiesel) : null;

  // Explicit yearly ticks (first data point of each year) — dense quarterly
  // labels smear at chart width, so we label years only. With a long history
  // (14 years) even the year labels crowd on a phone, so thin them to ~7 on
  // small screens.
  const isSmall = useMediaQueryMatch("sm");
  const yearTicks = useMemo(() => {
    const seen = new Set<string>();
    const firstOfYear: string[] = [];
    for (const p of series) {
      const y = p.date.slice(0, 4);
      if (!seen.has(y)) {
        seen.add(y);
        firstOfYear.push(p.date);
      }
    }
    const maxLabels = isSmall ? 7 : 16;
    const step = Math.max(1, Math.ceil(firstOfYear.length / maxLabels));
    return firstOfYear.filter((_, i) => i % step === 0);
  }, [series, isSmall]);

  const stat = (label: string, price: number | null, g: number | null) => (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-3xl font-bold tabular-nums">
        {price != null ? `${fmtEur(price, lang)}/${T("л", "L")}` : "—"}
      </div>
      {g != null ? (
        <div className={`text-xs tabular-nums ${priceChangeColor(g)}`}>
          {fmtPct(g)} {T("спрямо ЕС", "vs the EU")}
        </div>
      ) : null}
    </div>
  );

  const legend = useMemo(
    () => [
      {
        key: "bg95",
        name: T("Бензин А95 (BG)", "Petrol 95 (BG)"),
        color: AMBER,
      },
      {
        key: "eu95",
        name: T("Бензин А95 (ЕС)", "Petrol 95 (EU)"),
        color: AMBER,
        dash: true,
      },
      { key: "bgDiesel", name: T("Дизел (BG)", "Diesel (BG)"), color: STEEL },
      {
        key: "euDiesel",
        name: T("Дизел (ЕС)", "Diesel (EU)"),
        color: STEEL,
        dash: true,
      },
    ],
    [bg], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <>
      <SEO
        title={T("Горива · Потребление", "Fuel · Consumption")}
        description={T(
          "Цените на горивата в България спрямо средното за ЕС — бензин А95 и дизел (EUR/л, с ДДС), Седмичен нефтен бюлетин на ЕК.",
          "Fuel prices in Bulgaria vs the EU average — petrol 95 and diesel (EUR/L, incl. VAT), EU Weekly Oil Bulletin.",
        )}
      />
      <PlaceHeader active="consumption" level="country" className="my-4" />

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
                {stat(
                  T("Бензин А95", "Petrol 95"),
                  latest?.bg95 ?? null,
                  gap95,
                )}
                {stat(T("Дизел", "Diesel"), latest?.bgDiesel ?? null, gapDsl)}
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={series}
                    margin={{ top: 8, right: 8, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      opacity={0.2}
                    />
                    <XAxis
                      dataKey="date"
                      ticks={yearTicks}
                      tickFormatter={(d: string) => d.slice(0, 4)}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      domain={["auto", "auto"]}
                      tickFormatter={(v: number) => `${v.toFixed(1)}`}
                    />
                    <Tooltip
                      formatter={(v: number) =>
                        `${fmtEur(v, lang)}/${T("л", "L")}`
                      }
                      labelStyle={{ fontSize: 11 }}
                      contentStyle={{ fontSize: 11 }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                      formatter={(value) =>
                        legend.find((l) => l.key === value)?.name ?? value
                      }
                    />
                    {legend.map((l) => (
                      <Line
                        key={l.key}
                        type="monotone"
                        dataKey={l.key}
                        name={l.key}
                        stroke={l.color}
                        strokeWidth={2}
                        strokeDasharray={l.dash ? "4 3" : undefined}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {series.length > 0 ? (
                <div>
                  <div
                    className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
                    style={{ paddingLeft: 44 }}
                  >
                    {T("Правителства", "Governments")}
                  </div>
                  <ChartCabinetStrip
                    fromDate={series[0].date}
                    toDate={series[series.length - 1].date}
                    padLeft={44}
                    padRight={8}
                  />
                </div>
              ) : null}

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
