// "Целева помощ за отопление" — the heating-aid tile (plan §4.5, reframed NATIONAL
// per §2.1: АСП publishes no per-oblast breakdown, so this is a national headline +
// season-over-season trend, NOT a choropleth). The most concrete, most-covered
// benefit: ~357k households, ~€110M for the 2025/2026 season. Reads the static
// data/social/benefits.json (АСП годишен отчет).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatCount } from "@/lib/currency";
import {
  useSocialBenefits,
  benefitFamily,
} from "@/data/social/useSocialBenefits";

export const SocialHeatingAidTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data } = useSocialBenefits();
  const fam = benefitFamily(data, "heating");
  if (!fam || fam.series.length < 1) return null;

  const series = [...fam.series].sort((a, b) => a.year - b.year);
  const latest = series[series.length - 1];
  const households = latest.households ?? 0;
  const maxHh = Math.max(...series.map((s) => s.households ?? 0), 1);

  return (
    <Card id="social-heating">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Flame className="h-4 w-4" />
          {bg ? "Целева помощ за отопление" : "Targeted heating aid"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {formatCount(households, loc, 0)}
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? `домакинства с помощ за отопление, сезон ${latest.season}`
              : `households on heating aid, ${latest.season} season`}
          </span>
          <span className="text-xs font-medium text-foreground tabular-nums">
            {formatEurCompact(latest.amountEur, lang)}
          </span>
        </div>

        {/* Season-over-season households + amount. */}
        <div className="space-y-1.5">
          {series.map((s) => {
            const isLast = s.season === latest.season;
            return (
              <div key={s.season ?? s.year} className="flex items-center gap-2">
                <span
                  className={`w-20 shrink-0 text-[11px] tabular-nums ${
                    isLast
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {s.season}
                </span>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
                  <div
                    className={`h-full rounded ${isLast ? "bg-primary" : "bg-primary/35"}`}
                    style={{ width: `${((s.households ?? 0) / maxHh) * 100}%` }}
                  />
                </div>
                <span
                  className={`w-24 shrink-0 text-right text-[11px] tabular-nums ${
                    isLast ? "font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {formatCount(s.households ?? 0, loc, 0)} ·{" "}
                  {formatEurCompact(s.amountEur, lang)}
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              Около{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(households, loc, 0)}
              </span>{" "}
              домакинства получиха целева помощ за отопление за сезон{" "}
              {latest.season}
              {latest.perHouseholdMonthlyBgn ? (
                <>
                  {" "}
                  — по{" "}
                  <span className="font-semibold tabular-nums">
                    {formatCount(latest.perHouseholdMonthlyBgn, loc, 2)} лв.
                  </span>{" "}
                  на месец за 5 месеца
                </>
              ) : null}
              . Разбивка по области не се публикува.
            </>
          ) : (
            <>
              About{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(households, loc, 0)}
              </span>{" "}
              households received targeted heating aid for the {latest.season}{" "}
              season
              {latest.perHouseholdMonthlyBgn ? (
                <>
                  {" "}
                  — {formatCount(latest.perHouseholdMonthlyBgn, loc, 2)}{" "}
                  BGN/month for 5 months
                </>
              ) : null}
              . No per-oblast breakdown is published.
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg ? "Източник: " : "Source: "}
          {fam.law} · {bg ? "Годишен отчет на АСП" : "АСП annual report"}
        </p>
      </CardContent>
    </Card>
  );
};
