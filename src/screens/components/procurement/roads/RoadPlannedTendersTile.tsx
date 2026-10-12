// "Процедури без договор" — АПИ's most recent announced tender procedures that
// carry no signed contract yet (the pipeline), from the tender-STAGE corpus.
// Every value here is the прогнозна (estimated) value — a forecast set before
// contracting, NOT money spent — so it's labelled as such and never mixed with
// the signed-contract totals elsewhere on the page.
//
// АПИ ONLY, and it says so: the tender route is per buyer and НКСИП's handful of
// procedures are all awarded. CURRENT, not windowed: it sits on a scoped page,
// so the header says „текущо, без период" (plan O3).
//
// It used to list АПИ's 12 LARGEST procedures of all time under „Планирани" —
// already-awarded ones included. A row with a contract is not planned.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useAwarderTenders } from "@/data/procurement/useAwarderTenders";
import { API_EIK } from "@/lib/roadsAwarder";
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
  const bg = lang === "bg";
  // Newest first, wide enough that the not-yet-awarded slice survives the filter.
  const { data, isPending } = useAwarderTenders(API_EIK, 60, "date");
  if (isPending) return null;
  const planned = (data?.recent ?? [])
    .filter(
      (t) =>
        !t.is_cancelled && t.awarded_eur == null && !(t.award_contracts ?? 0),
    )
    .slice(0, 8);
  // Absent route, failed fetch, or nothing open: say which, keep the section.
  if (!data || planned.length === 0)
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        {!data
          ? bg
            ? "Обявените процедури на АПИ не можаха да се заредят."
            : "АПИ's announced procedures could not be loaded."
          : bg
            ? "Няма обявени процедури на АПИ без сключен договор."
            : "АПИ has no announced procedures without a signed contract."}
      </p>
    );
  const summary = data.summary;
  const est = (v: number | null | undefined) =>
    v == null ? "—" : `~${formatEurCompact(v, lang)}`;

  const numFmt = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardList className="h-4 w-4" />
          {bg
            ? "Процедури на АПИ без сключен договор"
            : "АПИ procedures without a signed contract"}
          <span className="text-xs text-muted-foreground font-normal">
            {bg
              ? "текущо, без период · прогнозна стойност"
              : "current, not windowed · estimated value"}
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
            {summary.forecast_eur != null ? (
              <>
                {" · "}
                {est(summary.forecast_eur)}{" "}
                {bg
                  ? "прогнозни, всички процедури"
                  : "estimated, all procedures"}
              </>
            ) : null}
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
                  {est(t.forecast_eur)}
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
