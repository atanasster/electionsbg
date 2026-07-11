// „Общинска и читалищна култура" — the two culture-money streams the scale tile
// only shows as single lines, broken out: (1) Столична програма „Култура" — who
// gets Sofia's municipal culture money, per направление, from the Творчески-съвет
// класиране; and (2) читалища — the national subsidised-staffing figure and the
// 2026 announced-vs-actual cut. Plan §5.1 tile 15. Municipal money is labelled
// "извън държавния бюджет" so it never reads as state spending.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatPct } from "@/lib/currency";
import { useCultureMunicipal } from "@/data/culture/useCulture";

export const CultureMunicipalTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useCultureMunicipal();
  if (!data) return null;
  const { sofia, chitalishta: ch } = data;

  const rate = sofia.appliedCount ? sofia.fundedCount / sofia.appliedCount : 0;
  const maxDir = Math.max(1, ...sofia.directions.map((d) => d.eur));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          {bg
            ? "Общинска и читалищна култура"
            : "Municipal & community-centre culture"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {/* --- Sofia Програма „Култура" ------------------------------------ */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">
            {bg ? "Столична програма „Култура“" : "Sofia „Култура“ programme"}
          </span>
          <span className="shrink-0 rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {bg ? "общинско, извън държавния бюджет" : "municipal, off-budget"}
          </span>
        </div>
        <p className="mb-3 mt-1 text-sm text-muted-foreground">
          {bg
            ? `Финансирани ${sofia.fundedCount} от ${sofia.appliedCount} кандидатствали проекта (${formatPct(rate, lang)}) — ${formatEurCompact(sofia.totalEur, lang)} през ${sofia.council} за ${sofia.year} г.`
            : `${sofia.fundedCount} of ${sofia.appliedCount} applications funded (${formatPct(rate, lang)}) — ${formatEurCompact(sofia.totalEur, lang)} via the ${sofia.council} for ${sofia.year}.`}
        </p>
        <ul className="space-y-1.5">
          {sofia.directions.map((d) => (
            <li key={d.n} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm" title={d.bg}>
                    {d.bg}
                  </span>
                  <span className="shrink-0 tabular-nums text-sm font-medium">
                    {formatEurCompact(d.eur, lang)}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {d.count} {bg ? "пр." : "proj."}
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-primary"
                    style={{ width: `${(d.eur / maxDir) * 100}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {bg ? sofia.note.bg : sofia.note.en}
        </p>

        {/* --- читалища national context ----------------------------------- */}
        <div className="mt-4 border-t border-border/60 pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {bg ? "Читалища (национално)" : "Community centres (national)"}
            </span>
            <span className="shrink-0 tabular-nums text-sm font-semibold">
              {formatEurCompact(ch.totalEur, lang)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {ch.subsidizedPositions.toLocaleString(bg ? "bg-BG" : "en-US")}{" "}
              {bg ? "субсидирани бройки" : "subsidised positions"}
              <span className="text-emerald-600 dark:text-emerald-400">
                {" "}
                +{ch.positionsYoY}
              </span>
            </span>
            <span className="text-amber-600 dark:text-amber-500">
              {bg
                ? `~${formatEurCompact(ch.cutEur, lang)} под обявеното`
                : `~${formatEurCompact(ch.cutEur, lang)} below announced`}
            </span>
          </div>
          {/* announced vs actual — the 2026 cut, as a two-segment bar */}
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            title={
              bg
                ? `Обявено: ${formatEurCompact(ch.announcedEur, lang)} · Реално: ${formatEurCompact(ch.totalEur, lang)}`
                : `Announced: ${formatEurCompact(ch.announcedEur, lang)} · Actual: ${formatEurCompact(ch.totalEur, lang)}`
            }
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(ch.totalEur / ch.announcedEur) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/80">
            {bg ? ch.note.bg : ch.note.en}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
