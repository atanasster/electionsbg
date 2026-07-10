// Кога подават декларациите си магистратите — the filing calendar of the ИВСС
// asset-declaration register.
//
// Two thirds of every annual declaration land in May, and the daily peak is the
// 14th and 15th — the statutory deadline itself. That is a fact about deadlines,
// not about integrity, and the caption says so: filing on the last day is
// perfectly lawful. It is shown because nobody has ever measured it — the ИВСС
// publishes 46k PDFs and no index.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatInt, formatPct } from "@/lib/currency";
import type { DeclarationsFile } from "@/data/judiciary/useDeclarations";

const MONTHS_BG = [
  "яну",
  "фев",
  "мар",
  "апр",
  "май",
  "юни",
  "юли",
  "авг",
  "сеп",
  "окт",
  "ное",
  "дек",
];
const MONTHS_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const DeclarationsTile: FC<{ data: DeclarationsFile }> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const cal = data.filingCalendar;
  const months = bg ? MONTHS_BG : MONTHS_EN;
  // Don't assume the histogram is a full, month-ordered 12-slot array, and never
  // divide by a zero max — a NaN would reach the bar's `height` style.
  const max = Math.max(1, ...cal.byMonth.map((m) => m.count));
  const mayCount = cal.byMonth.find((m) => m.month === 5)?.count ?? 0;
  const mayShare = cal.total > 0 ? mayCount / cal.total : 0;
  const int = (v: number) => formatInt(v, lang);
  const pct = (v: number) => formatPct(v, lang);

  // The two heaviest days in May — the deadline itself. Pick by count, then print
  // in calendar order: "15 и 14 май" reads like a mistake. Today day 14 happens to
  // outweigh day 15, so the caption is already ascending; the re-sort keeps it that
  // way the year that flips.
  const peak = [...cal.byDayOfMay]
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .sort((a, b) => a.day - b.day);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />
          {bg
            ? "Кога магистратите подават декларациите си"
            : "When magistrates file their declarations"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums">
            {pct(mayShare)}
          </span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? `от годишните декларации се подават през май — срокът е ${cal.deadline}`
              : `of annual declarations are filed in May — the deadline is ${cal.deadline}`}
          </span>
        </div>

        {/* Month histogram */}
        <div>
          {/* h-28 gives the columns a definite height, so the bars' percentage
              heights resolve. Without h-full on the column, they collapse.

              The per-bar `title` is a mouse affordance only — screen readers do
              not reliably announce it, and the counts appear nowhere else in the
              tile. So the histogram is one labelled image whose label carries
              every month's figure. */}
          <div
            className="flex h-28 items-end gap-1"
            role="img"
            aria-label={`${
              bg
                ? "Декларации по месец на подаване"
                : "Declarations by month filed"
            }: ${cal.byMonth
              .map((m) => `${months[m.month - 1]} ${int(m.count)}`)
              .join(", ")}`}
          >
            {cal.byMonth.map((m) => (
              <div
                key={m.month}
                className="flex h-full flex-1 flex-col items-center gap-1"
                title={`${months[m.month - 1]}: ${int(m.count)}`}
              >
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={`w-full rounded-t ${
                      m.month === 5 ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                    style={{
                      height: `${Math.max(2, (m.count / max) * 100)}%`,
                    }}
                  />
                </div>
                <span
                  className={`text-[10px] ${
                    m.month === 5
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {months[m.month - 1]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {peak.length === 2 && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <span className="text-muted-foreground">
              {bg
                ? `Най-натоварените дни са ${peak[0].day} и ${peak[1].day} май — ${int(peak[0].count + peak[1].count)} декларации за два дни. Подаването в последния момент е напълно законно; графиката показва само как работи един краен срок.`
                : `The busiest days are ${peak[0].day} and ${peak[1].day} May — ${int(peak[0].count + peak[1].count)} declarations in two days. Filing on the last day is entirely lawful; the chart only shows how a deadline behaves.`}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          {[
            [bg ? "Декларации" : "Declarations", int(data.totals.declarations)],
            [bg ? "Магистрати" : "Magistrates", int(data.totals.magistrates)],
            [
              bg ? "Период" : "Period",
              `${data.totals.firstYear}–${data.totals.lastYear}`,
            ],
            [
              bg ? "Последна година" : "Latest year",
              int(data.years[0]?.declarations ?? 0),
            ],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-md border bg-muted/20 p-2"
            >
              <div className="text-muted-foreground">{label}</div>
              <div className="font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Индекс на регистъра на имуществените декларации по чл. 175а, ал. 1 ЗСВ, публикуван от Инспектората към ВСС. Показва кой е подал декларация и кога — не съдържанието на декларациите. Годишната декларация се подава до 15 май; декларациите за промяна се подават през цялата година и не са включени в графиката."
            : "An index of the asset-declaration register (art. 175a ЗСВ) published by the Inspectorate to the Supreme Judicial Council. It records who filed and when — not what the declarations contain. The annual declaration is due by 15 May; change declarations are filed year-round and are excluded from the chart."}
        </p>
      </CardContent>
    </Card>
  );
};
