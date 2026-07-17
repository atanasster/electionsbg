// "ГИТ — инспекции и нарушения" — the labour-inspectorate outcome tile (plan §4.10).
// The `inspection` universe of the social group (ИА „Главна инспекция по труда",
// EIK 831545394) is legible not through its ~€10M procurement but through what it
// DOES: ~49k inspections/yr finding ~190k labour-law violations (of which the
// wage-related ones are the sharpest). National/annual, from the ГИТ годишен доклад.
// Paired with the ГИТ procurement so the reader sees the agency's real footprint.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatCount, formatEurCompact } from "@/lib/currency";
import { useGitInspections } from "@/data/social/useSocialBenefits";

export const SocialInspectionTile: FC<{
  /** The ГИТ unit's procurement € in the active scope (from the pack), for pairing. */
  gitProcEur?: number;
}> = ({ gitProcEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data } = useGitInspections();
  if (!data || !data.series.length) return null;

  const series = [...data.series].sort((a, b) => a.year - b.year);
  const latest = series[series.length - 1];
  const maxV = Math.max(...series.map((s) => s.violations), 1);

  return (
    <Card id="social-inspection">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4" />
          {bg
            ? "Инспекция по труда — резултат"
            : "Labour inspectorate — outcome"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {formatCount(latest.violations, loc, 0)}
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? `нарушения при ${formatCount(latest.inspections, loc, 0)} проверки, ${latest.year} г.`
              : `violations across ${formatCount(latest.inspections, loc, 0)} inspections, ${latest.year}`}
          </span>
        </div>

        {/* Violations trend (bars) + inspections count per year. */}
        <div className="space-y-1.5">
          {series.map((s) => {
            const isLast = s.year === latest.year;
            return (
              <div key={s.year} className="flex items-center gap-2">
                <span
                  className={`w-10 shrink-0 text-[11px] tabular-nums ${
                    isLast
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {s.year}
                </span>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
                  <div
                    className={`h-full rounded ${isLast ? "bg-primary" : "bg-primary/35"}`}
                    style={{ width: `${(s.violations / maxV) * 100}%` }}
                  />
                </div>
                <span
                  className={`w-28 shrink-0 text-right text-[11px] tabular-nums ${
                    isLast ? "font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {formatCount(s.violations, loc, 0)} {bg ? "нар." : "viol."} ·{" "}
                  {formatCount(s.inspections, loc, 0)} {bg ? "пров." : "insp."}
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              През {latest.year} г. ГИТ извърши{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(latest.inspections, loc, 0)}
              </span>{" "}
              проверки и установи{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(latest.violations, loc, 0)}
              </span>{" "}
              нарушения на трудовото законодателство
              {latest.wageViolations ? (
                <>
                  {" "}
                  — от които{" "}
                  <span className="font-semibold tabular-nums">
                    {formatCount(latest.wageViolations, loc, 0)}
                  </span>{" "}
                  за заплащане на труда
                </>
              ) : null}
              .{" "}
              {gitProcEur != null && gitProcEur > 0 ? (
                <>
                  Собствените ѝ обществени поръчки са{" "}
                  <span className="font-semibold tabular-nums">
                    {formatEurCompact(gitProcEur, lang)}
                  </span>{" "}
                  — работата ѝ е в проверките, не в поръчките.
                </>
              ) : null}
            </>
          ) : (
            <>
              In {latest.year} ГИТ carried out{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(latest.inspections, loc, 0)}
              </span>{" "}
              inspections and found{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(latest.violations, loc, 0)}
              </span>{" "}
              labour-law violations
              {latest.wageViolations ? (
                <>
                  {" "}
                  — of which{" "}
                  <span className="font-semibold tabular-nums">
                    {formatCount(latest.wageViolations, loc, 0)}
                  </span>{" "}
                  wage-related
                </>
              ) : null}
              .{" "}
              {gitProcEur != null && gitProcEur > 0 ? (
                <>
                  Its own procurement is just{" "}
                  <span className="font-semibold tabular-nums">
                    {formatEurCompact(gitProcEur, lang)}
                  </span>{" "}
                  — its footprint is the inspections, not the contracts.
                </>
              ) : null}
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg ? "Източник: " : "Source: "}
          {bg
            ? "Годишен доклад за дейността на ИА „Главна инспекция по труда“"
            : "Annual activity report of the Labour Inspectorate (ГИТ)"}
        </p>
      </CardContent>
    </Card>
  );
};
