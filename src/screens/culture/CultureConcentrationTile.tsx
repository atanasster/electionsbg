// "Кой печели най-често" — producer concentration in НФЦ film money. Ranked
// horizontal bars of the top producers by total subsidy, with a top-10-share
// call-out. This is the standing, queryable version of the "банкомат за избрани"
// story (plan §3.1e·4). Bars are a single hue (magnitude), sorted desc.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatPct } from "@/lib/currency";
import type { ProducerBucket } from "@/data/culture/types";

const TOP_N = 10;

export const CultureConcentrationTile: FC<{
  topProducers: ProducerBucket[];
  top10Share: number;
}> = ({ topProducers, top10Share }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = topProducers.slice(0, TOP_N);
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((p) => p.eur));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4" />
          {bg
            ? "Кой печели най-често — продуценти"
            : "Who wins most — producers"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          {bg
            ? `Топ 10 продуценти държат ${formatPct(top10Share, lang)} от цялата държавна субсидия за кино.`
            : `The top 10 producers hold ${formatPct(top10Share, lang)} of all state film subsidy.`}
        </p>
        <ul className="space-y-1.5">
          {rows.map((p, i) => (
            <li key={p.producerFold} className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  {p.eik ? (
                    <Link
                      to={`/company/${p.eik}`}
                      className="min-w-0 truncate text-sm hover:text-primary hover:underline"
                      title={p.producer}
                    >
                      {p.producer}
                    </Link>
                  ) : (
                    <span
                      className="min-w-0 truncate text-sm"
                      title={p.producer}
                    >
                      {p.producer}
                    </span>
                  )}
                  <span className="shrink-0 tabular-nums text-sm font-medium">
                    {formatEurCompact(p.eur, lang)}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {p.count} {bg ? "пр." : "proj."}
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-primary"
                    style={{ width: `${(p.eur / max) * 100}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {bg
            ? "Продуцентите се групират по име (регистърът на НФЦ няма ЕИК). Едно име може да покрива свързани дружества."
            : "Producers are grouped by name (the НФЦ register has no company ID). One name may span related companies."}
        </p>
      </CardContent>
    </Card>
  );
};
