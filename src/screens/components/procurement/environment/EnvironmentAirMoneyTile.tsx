// ★ The differentiator of the whole view: „Парите за чист въздух срещу въздуха" — put
// the MONEY for air monitoring next to the MEASURED air. No Bulgarian portal ties
// environmental spend to a measured environmental outcome; this tile is why /sector/
// environment exists.
//
// Two honest panels (never a twinned axis, never implied causation):
//   (a) MONEY — the group's „Мониторинг и измерване" procurement (ИАОС's instruments
//       lead this) + the ЕИП/Норвежки MODAIRN air-quality grant (contracted).
//   (b) OUTCOME — the current national station-mean ФПЧ10 / ФПЧ2.5 vs the EU limits,
//       and how many stations sit over the ФПЧ10 limit. A SNAPSHOT (air/index.json has
//       no time series — §0.5), so the framing is "here is where the air stands", not a
//       trend and not "the spend moved the number".

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Wind } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useAirQuality } from "@/data/air/useAirQuality";
import type { EnvModel } from "@/lib/environmentAttributes";
import type { EnvFundProgramme } from "@/data/procurement/useEnvironment";

const PM10_LIMIT = 50;
const PM25_LIMIT = 25;

const outcomeColor = (v: number, limit: number): string =>
  v < limit / 2 ? "#15803d" : v < limit ? "#d97706" : "#b91c1c";

export const EnvironmentAirMoneyTile: FC<{
  model: EnvModel;
  funds: EnvFundProgramme[];
}> = ({ model, funds }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data: air } = useAirQuality();

  const monitoringEur = useMemo(
    () => model.categories.find((c) => c.id === "monitoring")?.totalEur ?? 0,
    [model],
  );
  const modairn = useMemo(
    () => funds.find((f) => f.programCode === "MODAIRN")?.contractedEur ?? 0,
    [funds],
  );

  const airStats = useMemo(() => {
    const st = air?.stations ?? [];
    const pm10 = st
      .map((s) => s.latestReadings?.pm10)
      .filter((v): v is number => v != null);
    const pm25 = st
      .map((s) => s.latestReadings?.pm25)
      .filter((v): v is number => v != null);
    const meanOf = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    return {
      meanPm10: meanOf(pm10),
      meanPm25: meanOf(pm25),
      nPm10: pm10.length,
      overPm10: pm10.filter((v) => v >= PM10_LIMIT).length,
    };
  }, [air]);

  if (monitoringEur <= 0 && modairn <= 0) return null;

  const OutcomeStat: FC<{
    value: number | null;
    limit: number;
    label: string;
  }> = ({ value, limit, label }) => (
    <div>
      <div className="flex items-baseline gap-1">
        <span
          className="text-2xl font-bold tabular-nums"
          style={{
            color: value != null ? outcomeColor(value, limit) : undefined,
          }}
        >
          {value != null
            ? value.toLocaleString(loc, { maximumFractionDigits: 0 })
            : "—"}
        </span>
        <span className="text-[11px] text-muted-foreground">/ {limit}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );

  return (
    <Card id="air-money">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wind className="h-4 w-4" />
          {bg
            ? "Парите за чист въздух срещу въздуха"
            : "The money for clean air vs the air"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Panel A — money */}
          <div className="space-y-2 md:border-r md:pr-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {bg ? "Парите" : "The money"}
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">
                {formatEurCompact(monitoringEur, lang)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {bg
                  ? "поръчки за мониторинг и измерване (ЗОП)"
                  : "monitoring & measurement procurement"}
              </div>
            </div>
            {modairn > 0 && (
              <div>
                <div className="text-lg font-semibold tabular-nums">
                  {formatEurCompact(modairn, lang)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {bg
                    ? "грант „ModAIRn“ за качество на въздуха (ЕИП/Норвежки, договорено)"
                    : "„ModAIRn“ air-quality grant (EEA/Norway, contracted)"}
                </div>
              </div>
            )}
          </div>

          {/* Panel B — outcome */}
          <div className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {bg ? "Въздухът (последно)" : "The air (latest)"}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <OutcomeStat
                value={airStats.meanPm10}
                limit={PM10_LIMIT}
                label={bg ? "ФПЧ10 средно, µg/m³" : "PM10 mean, µg/m³"}
              />
              <OutcomeStat
                value={airStats.meanPm25}
                limit={PM25_LIMIT}
                label={bg ? "ФПЧ2.5 средно, µg/m³" : "PM2.5 mean, µg/m³"}
              />
            </div>
            {airStats.nPm10 > 0 && (
              <div className="text-xs text-muted-foreground">
                {bg
                  ? `${airStats.overPm10} от ${airStats.nPm10} станции над нормата за ФПЧ10`
                  : `${airStats.overPm10} of ${airStats.nPm10} stations over the PM10 limit`}
              </div>
            )}
          </div>
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {bg
            ? "Парите за мониторинг (ИАОС води) и грантът за въздух до измереното качество на въздуха от същата агенция. Показва контекст, не причинно-следствена връзка — нивата са моментна снимка (без исторически ред), не тренд."
            : "The money for monitoring (ИАОС leads) and the air grant next to the measured air quality from the same agency. Context, not causation — the levels are a snapshot (no historical series), not a trend."}
        </p>
      </CardContent>
    </Card>
  );
};
