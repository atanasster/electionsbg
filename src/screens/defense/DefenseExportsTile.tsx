// "България като износител на оръжие" — the counter-narrative tile. After Feb 2022
// Bulgaria's defence-product exports jumped to a record €2.83bn (2024). The bars
// show the total; the highlighted sliver is DIRECT exports to Ukraine (most of the
// trade reaches Ukraine indirectly via Poland/Romania/Czechia). Note in-tile that
// SIPRI TIV undercounts this because it excludes ammunition — the Ministry of
// Economy euro figures are used instead.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PackageOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { ExportsFile } from "@/data/defense/useDefenseData";

export const DefenseExportsTile: FC<{ data: ExportsFile }> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const max = Math.max(...data.series.map((r) => r.totalEur), 1);

  return (
    <Card id="defense-exports">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PackageOpen className="h-4 w-4" />
          {bg
            ? "България като износител на оръжие"
            : "Bulgaria as an arms exporter"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <p className="max-w-[64ch] text-xs text-muted-foreground">
          {bg
            ? `След февруари 2022 износът на отбранителна продукция скача до рекорд. Общо от началото на войната — ${formatEurCompact(data.cumulativeSinceInvasionEur, lang)}.`
            : `After February 2022 defence-product exports jumped to a record. Cumulative since the invasion — ${formatEurCompact(data.cumulativeSinceInvasionEur, lang)}.`}
        </p>
        <div className="space-y-2.5">
          {data.series.map((r) => {
            const ukrPct =
              r.totalEur > 0 ? (r.toUkraineEur / r.totalEur) * 100 : 0;
            return (
              <div key={r.year} className="text-xs">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="font-medium tabular-nums">
                    {r.year}
                    {r.record && (
                      <span className="ml-1.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                        {bg ? "рекорд" : "record"}
                      </span>
                    )}
                    {r.approx && (
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        ~
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatEurCompact(r.totalEur, lang)}
                    {r.toUkraineEur > 0 && (
                      <span className="ml-1.5 text-[10px] text-primary">
                        {bg ? "Украйна " : "Ukraine "}
                        {formatEurCompact(r.toUkraineEur, lang)}
                      </span>
                    )}
                  </span>
                </div>
                <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-[hsl(var(--primary))]"
                    style={{ width: `${(r.totalEur / max) * 100}%` }}
                  />
                  {ukrPct > 0 && (
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-primary"
                      style={{ width: `${(r.toUkraineEur / max) * 100}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--primary))]" />
            {bg ? "Общ износ" : "Total exports"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-sm bg-primary" />
            {bg ? "Пряко за Украйна" : "Direct to Ukraine"}
          </span>
        </div>
        {data.topDestinations2024?.length > 0 && (
          <div className="border-t pt-2 text-xs">
            <span className="text-muted-foreground">
              {bg ? "Най-големи пазари (2024): " : "Largest markets (2024): "}
            </span>
            {data.topDestinations2024.map((d, i) => (
              <span key={d}>
                {i > 0 && ", "}
                <span className="font-medium">{d}</span>
              </span>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground/80">{data.note}</p>
      </CardContent>
    </Card>
  );
};
