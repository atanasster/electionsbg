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
import { useTendersIndex } from "@/data/procurement/useTendersIndex";
import { API_EIK } from "@/data/procurement/useRoads";
import { formatEurCompact } from "@/lib/currency";

export const RoadPlannedTendersTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const { data: idx } = useTendersIndex();
  if (!idx) return null;

  const buyer = idx.buyers.find((b) => b.eik === API_EIK);
  const planned = idx.topByValue
    .filter((t) => t.buyerEik === API_EIK && !t.isCancelled)
    .sort((a, b) => (b.estimatedValueEur ?? 0) - (a.estimatedValueEur ?? 0))
    .slice(0, 8);
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
        {buyer ? (
          <div className="mb-2 text-xs text-muted-foreground tabular-nums">
            {numFmt.format(buyer.procedures)}{" "}
            {lang === "bg" ? "процедури" : "procedures"}
            {buyer.cancelled > 0 ? (
              <>
                {" · "}
                {numFmt.format(buyer.cancelled)}{" "}
                {lang === "bg" ? "прекратени" : "cancelled"}
              </>
            ) : null}
            {" · ~"}
            {formatEurCompact(buyer.estimatedValueEur, lang)}{" "}
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
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t.publicationDate}</span>
                {t.lotsCount && t.lotsCount > 1 ? (
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    {t.lotsCount} {lang === "bg" ? "об. позиции" : "lots"}
                  </span>
                ) : null}
                <span className="ml-auto tabular-nums font-medium text-foreground">
                  ~{formatEurCompact(t.estimatedValueEur ?? 0, lang)}
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
