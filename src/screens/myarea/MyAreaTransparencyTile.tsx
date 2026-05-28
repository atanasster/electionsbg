// Municipal Transparency tile — Transparency International Bulgaria's
// annual Local Integrity System Index (LISI). One composite score + 9
// pillar scores per município. Auto-hides until the
// `update-municipal-transparency` skill populates the data file (see
// scripts/transparency/README.md).
//
// The tile is intentionally compact — composite + national rank + best
// and worst pillar. Power users click through to the TI-BG report for
// the full breakdown.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  useMunicipalTransparency,
  type MunicipalTransparencyPillarKey,
} from "@/data/transparency/useMunicipalTransparency";

type Props = {
  obshtina: string;
};

const colorForScore = (s: number): string => {
  // TI-BG LISI is published on a 0-5 scale. Color ramp picks bands
  // proportional to that: ≥4 → strong, ≥3 → moderate (national average is
  // 3.27 for 2024), ≥2 → weak, <2 → critical.
  if (s >= 4) return "#56A86F";
  if (s >= 3) return "#9BB856";
  if (s >= 2) return "#E0A22C";
  return "#D74A56";
};

export const MyAreaTransparencyTile: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data, score } = useMunicipalTransparency(obshtina);

  // Until the scrape lands, scoresByObshtina is empty and `score` is
  // undefined — render nothing. We don't show a skeleton either; the tile
  // is silent on absence by design.
  if (!data || !score) return null;

  const pillarLabels = data.pillarLabels;
  const pillarEntries = Object.entries(score.pillars) as Array<
    [MunicipalTransparencyPillarKey, number]
  >;
  const sorted = pillarEntries.slice().sort((a, b) => b[1] - a[1]);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Scale className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_transparency_title")}
        </h2>
        {data.year ? (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {data.year}
          </span>
        ) : null}
      </div>
      <div className="flex items-baseline gap-4">
        <div
          className="text-3xl font-bold tabular-nums"
          style={{ color: colorForScore(score.composite) }}
        >
          {score.composite.toFixed(2)}
          <span className="text-base text-muted-foreground">
            {" / "}
            {data.scoreScale?.max ?? 5}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {lang === "bg"
            ? `Място ${score.nationalRank} от ${Object.keys(data.scoresByObshtina).length}`
            : `Rank ${score.nationalRank} of ${Object.keys(data.scoresByObshtina).length}`}
          {data.nationalAverage != null ? (
            <>
              <br />
              {lang === "bg"
                ? `Средно: ${data.nationalAverage.toFixed(2)}`
                : `National avg: ${data.nationalAverage.toFixed(2)}`}
            </>
          ) : null}
        </div>
      </div>
      {best && worst && best[0] !== worst[0] ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded border p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
              {t("my_area_transparency_best")}
            </div>
            <div className="font-medium truncate">
              {pillarLabels[best[0]]?.[lang] ?? best[0]}
            </div>
            <div
              className="text-sm font-bold tabular-nums"
              style={{ color: colorForScore(best[1]) }}
            >
              {best[1].toFixed(2)}
            </div>
          </div>
          <div className="rounded border p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
              {t("my_area_transparency_worst")}
            </div>
            <div className="font-medium truncate">
              {pillarLabels[worst[0]]?.[lang] ?? worst[0]}
            </div>
            <div
              className="text-sm font-bold tabular-nums"
              style={{ color: colorForScore(worst[1]) }}
            >
              {worst[1].toFixed(2)}
            </div>
          </div>
        </div>
      ) : null}
      <a
        href={data.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] text-muted-foreground underline mt-3 inline-block"
      >
        {data.source}
      </a>
    </Card>
  );
};
