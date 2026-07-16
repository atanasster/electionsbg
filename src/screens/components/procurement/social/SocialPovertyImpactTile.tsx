// "Социалните трансфери и бедността" — the flagship outcome tile (plan §4.4). A
// before/after-transfers DUMBBELL: for each country a dot at the at-risk-of-poverty
// rate BEFORE social transfers and a dot AFTER — the bar between them IS the poverty
// reduction. Bulgaria's transfers cut poverty by ~27% vs the EU's ~33%: BG spends a
// near-EU-average share of GDP on social protection but buys LESS poverty reduction
// per euro. Reads the static data/social/poverty_impact.json (Eurostat ilc_li10 vs
// ilc_li02). Positional / non-judgmental framing (the education report-card precedent).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { HeartHandshake } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatCount } from "@/lib/currency";
import {
  usePovertyImpact,
  type PovertyGeo,
} from "@/data/social/usePovertyImpact";

const GEO_NAME: Record<string, { bg: string; en: string }> = {
  BG: { bg: "България", en: "Bulgaria" },
  EU27_2020: { bg: "ЕС средно", en: "EU average" },
  RO: { bg: "Румъния", en: "Romania" },
  GR: { bg: "Гърция", en: "Greece" },
  HU: { bg: "Унгария", en: "Hungary" },
  HR: { bg: "Хърватия", en: "Croatia" },
};
const geoName = (geo: string, bg: boolean): string =>
  GEO_NAME[geo]?.[bg ? "bg" : "en"] ?? geo;

// Fixed display order (BG first, EU second, then the regional peers).
const ORDER: PovertyGeo[] = ["BG", "EU27_2020", "RO", "GR", "HU", "HR"];

export const SocialPovertyImpactTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data } = usePovertyImpact();
  if (!data) return null;

  const rows = ORDER.map((geo) => ({ geo, ...data.latest[geo] })).filter(
    (r) => r.before != null && r.after != null,
  );
  if (!rows.length) return null;

  const max = Math.max(...rows.map((r) => r.before), 1);
  const b = data.latest.BG;
  const eu = data.latest.EU27_2020;

  return (
    <Card id="social-poverty-impact">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <HeartHandshake className="h-4 w-4" />
          {bg
            ? "Социалните трансфери и бедността"
            : "Social transfers and poverty"}
        </CardTitle>
      </CardHeader>
      <CardContent data-og="social-poverty" className="p-3 md:p-4 space-y-3">
        {b && eu && (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-bold tabular-nums">
              −{formatCount(b.pct, loc, 0)}%
            </span>
            <span className="text-xs text-muted-foreground">
              {bg
                ? `намаление на бедността от трансферите (без пенсии), ${b.year} г. — срещу −${formatCount(eu.pct, loc, 0)}% средно за ЕС`
                : `poverty cut by transfers (excl. pensions), ${b.year} — vs −${formatCount(eu.pct, loc, 0)}% EU average`}
            </span>
          </div>
        )}

        {/* Dumbbell: after (left dot) → before (right dot); the bar = the reduction.
            The % reduction (the real metric) is printed at the right. */}
        <div className="space-y-2">
          {rows.map((r) => {
            const afterX = (r.after / max) * 100;
            const beforeX = (r.before / max) * 100;
            const isBg = r.geo === "BG";
            const isEu = r.geo === "EU27_2020";
            return (
              <div key={r.geo} className="flex items-center gap-2">
                <span
                  className={`w-20 shrink-0 truncate text-[11px] ${
                    isBg
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {geoName(r.geo, bg)}
                </span>
                <div className="relative h-4 flex-1">
                  {/* connecting bar = the reduction */}
                  <div
                    className={`absolute top-1/2 h-1 -translate-y-1/2 rounded-full ${
                      isBg
                        ? "bg-primary/40"
                        : isEu
                          ? "bg-muted-foreground/30"
                          : "bg-primary/20"
                    }`}
                    style={{
                      left: `${afterX}%`,
                      width: `${Math.max(0, beforeX - afterX)}%`,
                    }}
                  />
                  {/* after dot (lower rate = the outcome) */}
                  <div
                    className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                      isBg ? "bg-primary" : "bg-foreground/70"
                    }`}
                    style={{ left: `${afterX}%` }}
                    title={`${bg ? "след трансфери" : "after transfers"}: ${formatCount(r.after, loc, 1)}%`}
                  />
                  {/* before dot (higher rate = pre-transfer) */}
                  <div
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted-foreground/60 bg-background"
                    style={{ left: `${beforeX}%` }}
                    title={`${bg ? "преди трансфери" : "before transfers"}: ${formatCount(r.before, loc, 1)}%`}
                  />
                </div>
                <span
                  className={`w-16 shrink-0 text-right text-[11px] tabular-nums ${
                    isBg ? "font-semibold" : "text-muted-foreground"
                  }`}
                >
                  −{formatCount(r.pct, loc, 0)}%
                </span>
              </div>
            );
          })}
        </div>

        {/* Legend for the two dots. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-muted-foreground/60 bg-background" />
            {bg ? "Преди трансфери" : "Before transfers"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-foreground/70" />
            {bg ? "След трансфери" : "After transfers"}
          </span>
          <span>
            {bg
              ? "→ дължината на лентата = намалението на бедността"
              : "→ bar length = the poverty reduction"}
          </span>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg ? "Източник: " : "Source: "}
          Eurostat ilc_li10 / ilc_li02 (
          {bg
            ? "риск от бедност преди/след социални трансфери, без пенсии"
            : "at-risk-of-poverty before/after social transfers, pensions excluded"}
          )
        </p>
      </CardContent>
    </Card>
  );
};
