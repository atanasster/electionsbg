// Source-market tile on /sector/tourism: which countries Bulgaria's inbound
// visitors come from, by overnight nights — real Eurostat data (tour_occ_ninraw,
// nights by country of origin). The classic tourism "where do they come from"
// view; the concentration (Romania alone ~1/5 of foreign nights) is itself a
// policy signal. Not ?pscope-scoped — a fixed external annual series.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatCompact } from "@/lib/currency";
import { TOURISM_MARKET_NAMES_BG } from "@/lib/tourismLabels";
import { useTourismVisitors } from "@/data/tourism/useTourismVisitors";

export const TourismSourceMarketsTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const { data, isLoading } = useTourismVisitors();

  if (isLoading)
    return (
      <div className="h-[220px] animate-pulse rounded-xl border bg-card" />
    );
  const markets = data?.sourceMarkets ?? [];
  if (markets.length < 3) return null;

  const rows = markets.slice(0, 8);
  const total = data?.sourceMarketsForeignTotal || rows[0].nights || 1;
  const max = rows[0].nights || 1;
  const lead = rows[0];
  const leadName = bg
    ? (TOURISM_MARKET_NAMES_BG[lead.code] ?? lead.name)
    : lead.name;
  const leadPct = Math.round((lead.nights / total) * 100);

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Пазари на произход" : "Source markets"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {bg
            ? `${leadName} е ${leadPct}% от чуждестранните нощувки. ${data?.sourceMarketsYear}.`
            : `${leadName} is ${leadPct}% of foreign nights. ${data?.sourceMarketsYear}.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-2 p-3 md:p-4">
        {rows.map((m) => {
          const name = bg
            ? (TOURISM_MARKET_NAMES_BG[m.code] ?? m.name)
            : m.name;
          const pct = (m.nights / total) * 100;
          return (
            <div key={m.code} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 truncate" title={name}>
                {name}
              </span>
              <div className="relative h-3 flex-1 overflow-hidden rounded bg-muted/40">
                <div
                  className="absolute inset-y-0 left-0 rounded bg-primary/70"
                  style={{ width: `${Math.max(3, (m.nights / max) * 100)}%` }}
                />
              </div>
              <span className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                {formatCompact(m.nights, locale)} · {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
        <p className="pt-1 text-[11px] text-muted-foreground">
          {bg
            ? "Източник: Евростат · tour_occ_ninraw (нощувки по държава на произход)."
            : "Source: Eurostat · tour_occ_ninraw (nights by country of origin)."}
        </p>
      </CardContent>
    </Card>
  );
};
