// "Обществени поръчки на училището" on /school/:id — the mirror of
// SchoolIdentityTile, which puts the school's matura score on its /company/:eik
// page. The school page used to carry only a link across; a school buying fuel,
// food and repairs is a public spender in its own right, so the headline figures
// belong here and the link stays for the detail.
//
// Every number is labelled with the years it covers. The company dashboard
// applies the shared procurement time-scope (from/to), so its "Общо възложени"
// is a window — on the Nedelino school that read €228.6k, the 2026 slice of a
// €510k corpus going back to 2014, with nothing on screen saying so. This tile
// quotes the whole corpus and prints its span, then the latest year separately.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Landmark, Coins, FileText, Users, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useAwarderProcurement,
  awarderYearSpan,
  latestAwarderYear,
} from "@/data/procurement/useAwarderProcurement";
import { formatEur, formatEurCompact } from "@/lib/currency";

export const SchoolProcurementTile: FC<{ eik?: string | null }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang = i18n.language;
  const { data } = useAwarderProcurement(eik);

  // Self-hides: most schools never appear in the ЗОП register as a buyer.
  if (!eik || !data || !data.contractCount) return null;

  const span = awarderYearSpan(data.byYear);
  const latest = latestAwarderYear(data.byYear);
  const num = new Intl.NumberFormat(bg ? "bg-BG" : "en-US");

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4 text-muted-foreground" />
          {bg
            ? "Обществени поръчки на училището"
            : "The school's public procurement"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 text-sm md:p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">
              {bg ? "Общо възложени" : "Total awarded"}
            </div>
            <div className="flex items-baseline gap-2">
              <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span
                className="text-xl font-bold tabular-nums"
                title={formatEur(data.totalEur, lang)}
              >
                {formatEurCompact(data.totalEur, lang)}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {bg ? "Договори" : "Contracts"}
            </div>
            <div className="flex items-baseline gap-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-xl font-bold tabular-nums">
                {num.format(data.contractCount)}
              </span>
              {data.amendmentCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  + {num.format(data.amendmentCount)}{" "}
                  {bg ? "анекса" : "amendments"}
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {bg ? "Изпълнители" : "Suppliers"}
            </div>
            <div className="flex items-baseline gap-2">
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-xl font-bold tabular-nums">
                {num.format(data.contractorCount ?? 0)}
              </span>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {span
            ? bg
              ? `Всички договори в регистъра на обществените поръчки, ${span.from}–${span.to} г.`
              : `All contracts in the public-procurement register, ${span.from}–${span.to}.`
            : bg
              ? "Всички договори в регистъра на обществените поръчки."
              : "All contracts in the public-procurement register."}
          {latest && Number(latest.year) > (span?.from ?? 0) && (
            <>
              {" "}
              {bg
                ? `През ${latest.year} г.: ${formatEurCompact(latest.totalEur, lang)} по ${num.format(latest.contractCount)} ${latest.contractCount === 1 ? "договор" : "договора"}.`
                : `In ${latest.year}: ${formatEurCompact(latest.totalEur, lang)} across ${num.format(latest.contractCount)} contract${latest.contractCount === 1 ? "" : "s"}.`}
            </>
          )}
        </p>

        <Link
          to={`/company/${eik}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {bg ? "Виж поръчките на училището" : "See the school's procurement"}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
};
