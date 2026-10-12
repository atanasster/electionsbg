// Chainage coverage strip — per major motorway, a kilometre axis heat-mapped by
// contracted spend density, so the reader sees which stretches have been worked
// and where the gaps are (the classic "Хемус missing middle"). Scoped to the
// named motorways only: contracts whose title carries an absolute "от км A до км
// B" chainage (~a third of the corpus) are placed on their motorway's axis; the
// rest can't be located and are intentionally not shown here.
//

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Waypoints } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  buildChainageStrips,
  CHAINAGE_COVER_EUR_PER_KM,
  type RoadContract,
} from "@/lib/roadAttributes";

// The axes (one per motorway, two for Струма), the bin rule and the coverage
// floor live in the engine (buildChainageStrips) so the hub blob and this tile
// cannot disagree about what „покритие" means.

export const RoadChainageStripTile: FC<{ rows: RoadContract[] }> = ({
  rows,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  const strips = useMemo(() => buildChainageStrips(rows), [rows]);

  if (strips.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Waypoints className="h-4 w-4" />
          {lang === "bg"
            ? "Покритие по километри"
            : "Coverage along the kilometre axis"}
          <span className="text-xs font-normal text-muted-foreground">
            {lang === "bg" ? "магистрали" : "motorways"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        {strips.map((s) => (
          <div key={s.axis.axisKey}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">
                {s.axis.corridor}
                {s.axis.suffix && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {lang === "bg" ? s.axis.suffix.bg : s.axis.suffix.en}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatEurCompact(s.totalEur, lang)} · {s.contracts}{" "}
                {lang === "bg" ? "договора" : "contracts"} ·{" "}
                {Math.round(s.coveredPct * 100)}%{" "}
                {lang === "bg" ? "от дължината" : "of the length"}
              </span>
            </div>
            <div className="mt-1 flex gap-px h-3 rounded overflow-hidden bg-muted">
              {s.bins.map((v, i) => (
                <span
                  key={i}
                  className="flex-1"
                  style={
                    v > 0
                      ? {
                          backgroundColor: "hsl(var(--primary))",
                          opacity: 0.2 + 0.8 * (v / s.maxBin),
                        }
                      : undefined
                  }
                  title={
                    v > 0
                      ? `${(s.axis.lo + (i / s.bins.length) * (s.axis.hi - s.axis.lo)).toFixed(0)} км · ${formatEurCompact(v, lang)}`
                      : undefined
                  }
                />
              ))}
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>км {s.axis.lo}</span>
              <span>км {s.axis.hi}</span>
            </div>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground/80">
          {lang === "bg"
            ? `Само договори с абсолютна километрична референция по именувана магистрала и поне 3 локализирани договора на ос. Оста е цялата дължина на магистралата; процентът е делът ѝ с договорени работи над ${formatEurCompact(CHAINAGE_COVER_EUR_PER_KM, lang)}/км. По-тъмното означава повече вложени средства; празното — липса на такива договори (не непременно липса на път).`
            : `Only contracts with an absolute km reference on a named motorway, and at least 3 locatable contracts per axis. The axis is the motorway's whole length; the percentage is the share of it carrying contracted works above ${formatEurCompact(CHAINAGE_COVER_EUR_PER_KM, lang)}/km. Darker = more € spent; empty = no such contracts (not necessarily no road).`}
        </p>
      </CardContent>
    </Card>
  );
};
