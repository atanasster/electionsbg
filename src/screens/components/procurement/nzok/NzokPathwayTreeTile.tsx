// "Кой лекува по коя пътека" — pathway navigation on the НЗОК awarder page
// (migration 059). Pick a clinical pathway (КП/АПр/КПр) and see which hospitals
// bill it and how many cases each — the NHSU (Ukraine) "who delivers this service
// package" view, applied to Bulgaria's pathway-based payment model. It is the
// inverse of a hospital's own case-mix (NzokActivityByEikTile).
//
// VOLUME, NOT SPEND. The activity corpus carries case counts only — no per-pathway
// euros (the НРД tariff join is a documented follow-up). So this ranks by CASES,
// and the tile says so. ЗОЛ (insured persons) sums monthly counts and is shown as
// a rough scale only, never as a distinct-patient count.

import { FC, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useNzokActivities,
  useNzokActivityByProcedure,
  useNzokProcedureNames,
} from "@/data/budget/useBudget";
import { resolveProcedureName, procedureHref } from "@/lib/nzokProcedures";
import { formatEurCompact } from "@/lib/currency";
import { FacilityLink } from "./FacilityLink";

export const NzokPathwayTreeTile: FC<{ hideTitle?: boolean }> = ({
  hideTitle,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data: activities } = useNzokActivities();
  const { data: names } = useNzokProcedureNames();
  const [procedure, setProcedure] = useState<string | null>(null);

  const options = activities?.topProcedures ?? [];
  const selected = procedure ?? options[0]?.procedure ?? null;
  const { data } = useNzokActivityByProcedure(selected);

  if (!options.length) return null;

  const label = (code: string): string => {
    const name = resolveProcedureName(names, code);
    return name ? `${name} (${code})` : code;
  };

  const nf = new Intl.NumberFormat(bg ? "bg-BG" : "en-US");

  return (
    <Card>
      {!hideTitle && (
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            {bg ? "Кой лекува по коя пътека" : "Who treats which pathway"}
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className="space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {bg ? "Клинична пътека:" : "Clinical pathway:"}
          </span>
          <Select
            value={selected ?? undefined}
            onValueChange={(v) => setProcedure(v)}
          >
            <SelectTrigger className="h-7 w-auto min-w-[240px] max-w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((p) => (
                <SelectItem
                  key={p.procedure}
                  value={p.procedure}
                  className="text-xs"
                >
                  {label(p.procedure)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <Link
              to={procedureHref(selected)}
              className="text-xs text-accent hover:underline"
            >
              {bg ? "самостоятелна страница →" : "standalone page →"}
            </Link>
          )}
        </div>

        {data && (
          <>
            <p className="text-xs text-muted-foreground">
              {bg
                ? `${nf.format(data.totalCases)} случая за ${data.year} г. в ${data.facilityCount} лечебни заведения`
                : `${nf.format(data.totalCases)} cases in ${data.year} across ${data.facilityCount} facilities`}
              {data.totalSpendEur != null && (
                <>
                  {bg ? " · ~" : " · ~"}
                  {formatEurCompact(data.totalSpendEur, i18n.language)}
                  {bg ? " по НРД цена" : " at НРД list price"}
                </>
              )}
              .
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-2 text-left font-normal">
                      {bg ? "Болница" : "Hospital"}
                    </th>
                    <th className="py-1.5 pr-2 text-right font-normal">
                      {bg ? "Случаи" : "Cases"}
                    </th>
                    {data.totalSpendEur != null && (
                      <th className="py-1.5 pr-2 text-right font-normal">
                        {bg ? "Стойност" : "Value"}
                      </th>
                    )}
                    <th className="py-1.5 text-right font-normal">
                      {bg ? "Дял" : "Share"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.hospitals.slice(0, 25).map((h) => (
                    <tr
                      key={(h.eik ?? h.facility) + h.rzok}
                      className="hover:bg-muted/40"
                    >
                      <td className="py-1.5 pr-2">
                        <FacilityLink eik={h.eik} name={h.facility} />
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          {h.rzok}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums font-medium">
                        {nf.format(h.cases)}
                      </td>
                      {data.totalSpendEur != null && (
                        <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                          {h.spendEur != null
                            ? formatEurCompact(h.spendEur, i18n.language)
                            : "—"}
                        </td>
                      )}
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {h.sharePct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {data?.totalSpendEur != null
            ? bg
              ? "Стойността е случаи × цена по НРД (лимитна стойност), не непременно платената сума. Източник: НЗОК „Брой случаи и брой ЗОЛ по КП/АПр/КПр“ + цени по НРД, годишно."
              : "Value is cases × the НРД list price, not necessarily the amount paid. Source: НЗОК cases-by-pathway + НРД tariffs, annual."
            : bg
              ? "Броят на случаите е обем, не стойност. Източник: НЗОК, „Брой случаи и брой ЗОЛ по КП/АПр/КПр“, годишно."
              : "Case counts are volume, not value. Source: НЗОК, “cases & insured persons by pathway”, annual."}
        </p>
      </CardContent>
    </Card>
  );
};
