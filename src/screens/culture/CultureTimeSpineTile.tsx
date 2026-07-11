// Субсидия по години — how much НФЦ film money was awarded each year, as a
// hand-rolled column chart (no chart lib needed for a single series). The dip in
// 2021 (blocked funding sessions) reads straight off the bars. A plain-language
// lede + the peak/trough call-outs are the narrative-annotation the best foreign
// tools omit (plan §3.1e·5).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useTooltip } from "@/ux/useTooltip";
import type { YearBucket } from "@/data/culture/types";

export const CultureTimeSpineTile: FC<{ byYear: YearBucket[] }> = ({
  byYear,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip();
  if (byYear.length === 0) return null;

  const max = Math.max(1, ...byYear.map((y) => y.eur));
  const peak = [...byYear].sort((a, b) => b.eur - a.eur)[0];
  const trough = [...byYear].sort((a, b) => a.eur - b.eur)[0];
  // The "blocked funding sessions" cause is specific to 2021 — only attach it when
  // the low year actually is 2021, so a shifting minimum can't misattribute it.
  const troughNote =
    trough.year === 2021
      ? bg
        ? " — блокираните сесии"
        : " — the blocked sessions"
      : "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          {bg ? "Субсидия по години" : "Subsidy by year"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div
          className="flex items-stretch gap-1.5 h-40"
          role="img"
          aria-label={byYear
            .map(
              (y) =>
                `${y.year}: ${formatEurCompact(y.eur, lang)}, ${y.count} ${bg ? "проекта" : "projects"}`,
            )
            .join("; ")}
        >
          {byYear.map((y) => (
            <div
              key={y.year}
              className="flex min-w-0 flex-1 cursor-default flex-col items-center gap-1"
              onMouseEnter={(e) =>
                onMouseEnter(
                  { pageX: e.pageX, pageY: e.pageY },
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{y.year}</span>
                    <span className="tabular-nums">
                      {formatEurCompact(y.eur, lang)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {y.count} {bg ? "проекта" : "projects"}
                    </span>
                  </div>,
                )
              }
              onMouseMove={(e) =>
                onMouseMove({ pageX: e.pageX, pageY: e.pageY })
              }
              onMouseLeave={onMouseLeave}
            >
              {/* Bar track fills the column so the bar's % height resolves
                  against a definite box; the year label sits below. */}
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t bg-primary/80 hover:bg-primary transition-colors"
                  style={{ height: `${Math.max(2, (y.eur / max) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {String(y.year).slice(2)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {bg
            ? `Най-силна година: ${peak.year} (${formatEurCompact(peak.eur, lang)}). Най-слаба: ${trough.year} (${formatEurCompact(trough.eur, lang)})${troughNote}.`
            : `Peak: ${peak.year} (${formatEurCompact(peak.eur, lang)}). Lowest: ${trough.year} (${formatEurCompact(trough.eur, lang)})${troughNote}.`}
        </p>
      </CardContent>
      {tooltip}
    </Card>
  );
};
