// "Планирани поръчки" — АПИ's announced tender procedures (the pipeline of what
// is planned to be built), from the tender-STAGE corpus. Every value here is the
// прогнозна (estimated) value — a forecast set before contracting, NOT money
// spent — so it's labelled as such and never mixed with the signed-contract
// totals elsewhere on the page.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useAwarderTenders } from "@/data/procurement/useAwarderTenders";
import { API_EIK } from "@/data/procurement/useRoads";
import { formatEurCompact } from "@/lib/currency";
import {
  roadRefOf,
  workTypeOf,
  workGroupOf,
  workComponentOf,
} from "@/lib/roadAttributes";
import { GROUP_META, COMPONENT_LABEL } from "./roadLabels";

// Classify a planned procedure from its subject (tender records carry no CPV):
// work group + a distinctive component + the corridor, when the title names one.
const tenderKind = (subject: string, lang: string): string => {
  const wt = workTypeOf(subject);
  const comp = workComponentOf(subject, undefined, wt);
  const ref = roadRefOf(subject);
  const distinctive = !["roadway", "design_supervision", "other"].includes(
    comp,
  );
  const grp = workGroupOf(wt);
  return [
    lang === "bg" ? GROUP_META[grp].bg : GROUP_META[grp].en,
    distinctive
      ? lang === "bg"
        ? COMPONENT_LABEL[comp].bg
        : COMPONENT_LABEL[comp].en
      : null,
    ref ? ref.corridor : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

export const RoadPlannedTendersTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const { data } = useAwarderTenders(API_EIK, 12, "value");
  if (!data) return null;

  const summary = data.summary;
  const planned = data.recent.filter((t) => !t.is_cancelled).slice(0, 8);
  if (planned.length === 0) return null;

  const numFmt = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardList className="h-4 w-4" />
          {lang === "bg" ? "Планирани поръчки" : "Planned procurements"}
          <span className="text-xs text-muted-foreground font-normal">
            {lang === "bg"
              ? "обявени процедури · прогнозна стойност"
              : "announced procedures · estimated value"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {summary ? (
          <div className="mb-2 text-xs text-muted-foreground tabular-nums">
            {numFmt.format(summary.procedures)}{" "}
            {lang === "bg" ? "процедури" : "procedures"}
            {summary.cancelled > 0 ? (
              <>
                {" · "}
                {numFmt.format(summary.cancelled)}{" "}
                {lang === "bg" ? "прекратени" : "cancelled"}
              </>
            ) : null}
            {" · ~"}
            {formatEurCompact(summary.forecast_eur ?? 0, lang)}{" "}
            {lang === "bg" ? "прогнозни" : "estimated"}
          </div>
        ) : null}
        <ul className="divide-y divide-border text-sm">
          {planned.map((t) => (
            <li key={t.unp} className="py-2">
              <Link
                to={`/tenders/${t.unp}`}
                className="font-medium hover:underline line-clamp-1"
                title={t.subject}
              >
                {t.subject}
              </Link>
              <div className="text-[10px] text-muted-foreground truncate">
                {tenderKind(t.subject, lang)}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t.publication_date}</span>
                {t.lots_count && t.lots_count > 1 ? (
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    {t.lots_count} {lang === "bg" ? "об. позиции" : "lots"}
                  </span>
                ) : null}
                <span className="ml-auto tabular-nums font-medium text-foreground">
                  ~{formatEurCompact(t.forecast_eur ?? 0, lang)}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground/80 pt-2">
          {lang === "bg"
            ? "Прогнозната стойност е ориентир от обявлението, преди договаряне — не е реален разход. Виж детайла на всяка процедура."
            : "Estimated value is the announced forecast, before contracting — not actual spend. Click a procedure for details."}
        </p>
      </CardContent>
    </Card>
  );
};
