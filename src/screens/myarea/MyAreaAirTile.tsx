// Air-quality tile — only mounts when at least one monitoring station
// falls inside the município (EEA + ИАОС). Shows current readings per
// station with EU-limit thresholds. Most municipalities have no station
// and the tile auto-hides.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Wind } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useAirQuality, type Pollutant } from "@/data/air/useAirQuality";

type Props = {
  obshtina: string;
};

const colorForLimit = (value: number, limit: number): string => {
  const ratio = value / limit;
  if (ratio < 0.5) return "#56A86F";
  if (ratio < 1.0) return "#E0A22C";
  return "#D74A56";
};

export const MyAreaAirTile: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data, stations } = useAirQuality(obshtina);

  if (!data || stations.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Wind className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_air_title")}
        </h2>
        {data.snapshotAsOf ? (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {data.snapshotAsOf.slice(0, 10)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        {stations.map((station) => {
          const readings = Object.entries(station.latestReadings).filter(
            ([, v]) => typeof v === "number" && Number.isFinite(v),
          ) as Array<[Pollutant, number]>;
          if (readings.length === 0) return null;
          return (
            <div key={station.id}>
              <div className="text-xs font-medium truncate mb-1.5">
                {station.name}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {readings.map(([p, v]) => {
                  const meta = data.pollutants[p];
                  if (!meta) return null;
                  return (
                    <div
                      key={p}
                      className="rounded border px-2 py-1.5 text-[11px]"
                    >
                      <div className="text-muted-foreground">{meta[lang]}</div>
                      <div className="flex items-baseline gap-1">
                        <span
                          className="font-bold tabular-nums"
                          style={{ color: colorForLimit(v, meta.euLimit) }}
                        >
                          {v.toFixed(0)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {meta.unit}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">
        {t("my_area_air_caveat")}
      </p>
    </Card>
  );
};
