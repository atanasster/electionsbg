// "На кого разчита НОИ" — the Tussell-style supplier-dependence bar: НОИ's few
// structural suppliers and the share of contract value they hold. The reason
// this needs a bespoke tile (not the generic top-contractors list) is context:
// НОИ's two biggest — Информационно обслужване (systems integrator by law) and
// Български пощи (pension delivery under an expiring statutory mandate) — have
// no competition BY STATUTE, not by choice. Without that chip their single-bid
// figures read as a red flag when they're the law. Pure from NoiSupplier[].

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users, Gavel, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { NOI_SUPPLIER_CONTEXT } from "@/lib/noiBenchmarks";
import type { NoiSupplier } from "@/lib/noiAttributes";

const TOP_N = 8;

export const NoiStrategicSuppliersTile: FC<{
  suppliers: NoiSupplier[];
  totalEur: number;
}> = ({ suppliers, totalEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  if (suppliers.length < 2 || totalEur <= 0) return null;

  const top = suppliers.slice(0, TOP_N);
  const topShare = top.reduce((s, x) => s + x.totalEur, 0) / totalEur;
  const max = top[0].totalEur;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          {bg ? "На кого разчита НОИ" : "Who НОИ depends on"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-xl font-bold tabular-nums">
            {(topShare * 100).toLocaleString(lang, {
              maximumFractionDigits: 0,
            })}
            %
          </span>
          <span className="text-muted-foreground">
            {bg
              ? `от стойността на договорите отива към тези ${top.length} изпълнителя`
              : `of contract value goes to these ${top.length} suppliers`}
          </span>
        </div>

        <div className="space-y-2.5">
          {top.map((s) => {
            const ctx = NOI_SUPPLIER_CONTEXT[s.eik];
            const sb = s.singleBidShare;
            return (
              <div key={s.eik} className="text-xs">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <Link
                    to={`/company/${s.eik}`}
                    className="min-w-0 truncate font-medium hover:text-primary hover:underline"
                    title={s.name}
                  >
                    {s.name}
                  </Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatEurCompact(s.totalEur, lang)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${ctx ? "bg-amber-500" : "bg-primary"}`}
                    style={{
                      width: `${Math.max(2, (s.totalEur / max) * 100)}%`,
                    }}
                  />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[11px] text-muted-foreground">
                    {s.contractCount} {bg ? "договора" : "contracts"}
                  </span>
                  {sb != null && s.bidKnownN >= 3 && !ctx && (
                    <span
                      className={`text-[11px] ${sb >= 0.5 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}
                    >
                      {(sb * 100).toLocaleString(lang, {
                        maximumFractionDigits: 0,
                      })}
                      % {bg ? "с една оферта" : "single-bid"}
                    </span>
                  )}
                  {ctx && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-100/50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400">
                      {ctx.kind === "statutory" ? (
                        <Gavel className="h-3 w-3" />
                      ) : (
                        <Truck className="h-3 w-3" />
                      )}
                      {bg ? ctx.bg : ctx.en}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Кехлибарените ленти маркират структурни доставчици, чието възлагане е определено със закон, а не от конкуренция — затова висок дял с една оферта при тях е нормативен, не сигнал за нарушение."
            : "Amber bars mark structural suppliers whose award is set by statute, not competition — so a high single-bid share for them is the law, not a red flag."}
        </p>
      </CardContent>
    </Card>
  );
};
