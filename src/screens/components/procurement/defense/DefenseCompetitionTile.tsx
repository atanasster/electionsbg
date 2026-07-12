// "Къде се къса конкуренцията" — per-unit single-bid share across the МО group's
// ЗОП spend: bar length = € contracted, colour green→amber→red by the share of
// contracts let with a single bidder. The defense analogue of the water pack's
// per-operator competition heatmap. Pure from the DefenseUnitAgg rollup. Units
// with too few bid-known contracts are dropped so the colour isn't noise.
//
// FRAMING: much defense single-bid is legitimately sole-source or classified —
// this is a signpost of where competition is thin, not a verdict.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { DefenseUnitAgg } from "@/data/procurement/useDefense";

const MIN_BID_KNOWN = 3;
const TOP_N = 12;

const shareColor = (s: number): string =>
  s >= 0.6 ? "bg-red-600" : s >= 0.35 ? "bg-amber-500" : "bg-emerald-600";

const shareText = (s: number): string =>
  s >= 0.6
    ? "text-red-600 dark:text-red-400"
    : s >= 0.35
      ? "text-amber-600 dark:text-amber-400"
      : "text-emerald-600 dark:text-emerald-400";

export const DefenseCompetitionTile: FC<{ units: DefenseUnitAgg[] }> = ({
  units,
}) => {
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
    <Card id="competition">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" />
          {bg ? "Къде се къса конкуренцията" : "Where competition breaks down"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        {rows.map((u) => {
          const s = u.singleBidShare ?? 0;
          return (
            <div key={u.eik} className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  to={`/awarder/${u.eik}`}
                  className="min-w-0 truncate hover:text-primary hover:underline"
                >
                  {u.name}
                </Link>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatEurCompact(u.totalEur, lang)}
                  <span className={`ml-1 font-medium ${shareText(s)}`}>
                    {Math.round(s * 100)}%
                  </span>
                </span>
              </div>
              <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${shareColor(s)}`}
                  style={{ width: `${Math.max(2, (u.totalEur / max) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {bg
            ? `Дял на договорите с една оферта, за структури с поне ${MIN_BID_KNOWN} договора с известен брой оферти. Дебелината показва договорената стойност; цветът — конкуренцията (зелено под 35%, червено над 60%). Част от военните поръчки са законно с един източник или класифицирани.`
            : `Single-bidder share, for units with at least ${MIN_BID_KNOWN} bid-known contracts. Bar length is contracted value; colour is competition (green below 35%, red above 60%). Some defense procurement is legitimately sole-source or classified.`}
        </p>
      </CardContent>
    </Card>
  );
};
