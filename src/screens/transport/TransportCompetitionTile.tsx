// "Къде се къса конкуренцията" — per-unit single-bid share across the transport
// group's ЗОП spend: bar length = € contracted, colour green→amber→red by the share
// of contracts let with a single bidder. The transport analogue of the МВР/defense
// per-unit competition heatmap. Pure from the EX-MEMBER rollup
// (awarder-group-rollup?exMembers=1) — the counts the hub's KPI 3 and the browse
// pack use, never the member-inclusive group-model byUnit (A2 / C1).
//
// COLOUR IS RELATIVE TO THE SAME-WINDOW NATIONAL RATE (transport-hub-v1 A10), never a
// fixed threshold: a fixed 35%/60% band painted bodies amber in a window where the
// whole country sat at 48.8%, i.e. a typical rate read as a warning. With no matched
// baseline (an older deployed function) the bars stay neutral — no verdict at all.
//
// FRAMING: single-bid is a RISK SIGNAL, not a verdict — some transport procurement is
// legitimately sole-source (proprietary rolling-stock parts, safety-critical). Labelled
// as "worth a look".

import { FC } from "react";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { TransportBodyAgg } from "@/data/transport/useTransportSector";
import { bandOf, WELL_ABOVE, type Band } from "./competitionBand";

const MIN_BID_KNOWN = 3;
const TOP_N = 12;

const pct1 = (v: number, lang: string) =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 1,
  }).format(v * 100) + "%";

const BAR: Record<Band, string> = {
  below: "bg-emerald-600",
  above: "bg-amber-500",
  wellAbove: "bg-red-600",
  neutral: "bg-slate-500",
};
const TEXT: Record<Band, string> = {
  below: "text-emerald-600 dark:text-emerald-400",
  above: "text-amber-600 dark:text-amber-400",
  wellAbove: "text-red-600 dark:text-red-400",
  neutral: "text-foreground",
};

export const TransportCompetitionTile: FC<{
  units: TransportBodyAgg[];
  /** The national ex-member single-bid share for the SAME window (0..1), or null. */
  national: number | null;
}> = ({ units, national }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = units
    .filter((u) => u.singleBidShare != null && u.bidKnownN >= MIN_BID_KNOWN)
    .sort(
      (a, b) =>
        (b.singleBidShare ?? 0) - (a.singleBidShare ?? 0) ||
        b.totalEur - a.totalEur,
    )
    .slice(0, TOP_N);
  if (rows.length < 2) return null;
  const max = Math.max(...rows.map((u) => u.totalEur), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" />
          {bg ? "Къде се къса конкуренцията" : "Where competition breaks down"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        {rows.map((u) => {
          const s = u.singleBidShare ?? 0;
          const band = bandOf(s, national);
          return (
            <div key={u.eik} className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <AwarderLink
                  eik={u.eik}
                  className="min-w-0 truncate hover:text-primary hover:underline"
                >
                  {u.name}
                </AwarderLink>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatEurCompact(u.totalEur, lang)}
                  <span className={`ml-1 font-medium ${TEXT[band]}`}>
                    {pct1(s, lang)}
                  </span>
                </span>
              </div>
              <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${BAR[band]}`}
                  style={{ width: `${Math.max(2, (u.totalEur / max) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {bg
            ? `Дял на договорите с една оферта, за структури с поне ${MIN_BID_KNOWN} договора с известен брой оферти. Дължината показва договорената стойност. ${
                national != null
                  ? `Цветът сравнява с ${pct1(national, lang)} за всички възложители в същия период: зелено — до средното, жълто — до ${Math.round(WELL_ABOVE * 100)} пункта над него, червено — повече.`
                  : "Средното за страната за този период не е налично, затова лентите не са оцветени."
              } Сигнал за проверка, не присъда — част от поръчките законно имат един източник.`
            : `Single-bidder share, for units with at least ${MIN_BID_KNOWN} bid-known contracts. Bar length is contracted value. ${
                national != null
                  ? `Colour compares with ${pct1(national, lang)} for all buyers in the same window: green — at or below it, amber — up to ${Math.round(WELL_ABOVE * 100)} points above, red — further.`
                  : "The national rate for this window is unavailable, so the bars are not coloured."
              } A flag for review, not a verdict — some procurement is legitimately sole-source.`}
        </p>
      </CardContent>
    </Card>
  );
};
