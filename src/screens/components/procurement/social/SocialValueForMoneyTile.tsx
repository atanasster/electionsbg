// "Стойност за парите — разход спрямо ефект" — the value-for-money scatter (plan
// §4b). x = social-protection spend (% GDP, COFOG GF10); y = poverty-reduction
// effect (%, ilc_li10−ilc_li02 over li10). One dot per country, BG highlighted. The
// sharpest single visual behind the thesis: BG spends a middling share of GDP but
// gets a below-average poverty reduction — it sits low-and-left of where its spend
// would predict. Reads data/cofog.json (x) + data/social/poverty_impact.json (y).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ScatterChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatCount } from "@/lib/currency";
import { useCofog } from "@/data/macro/useCofog";
import { usePovertyImpact } from "@/data/social/usePovertyImpact";

const GEO_NAME: Record<string, { bg: string; en: string }> = {
  BG: { bg: "България", en: "Bulgaria" },
  EU27_2020: { bg: "ЕС", en: "EU" },
  RO: { bg: "Румъния", en: "Romania" },
  HU: { bg: "Унгария", en: "Hungary" },
  HR: { bg: "Хърватия", en: "Croatia" },
};
const geoName = (geo: string, bg: boolean): string =>
  GEO_NAME[geo]?.[bg ? "bg" : "en"] ?? geo;

const GEOS = ["BG", "EU27_2020", "RO", "HU", "HR"] as const;

// SVG geometry.
const W = 320;
const H = 210;
const PAD = { l: 38, r: 12, t: 12, b: 30 };

const niceBounds = (
  vals: number[],
  padFrac = 0.15,
): { lo: number; hi: number } => {
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  return { lo: lo - span * padFrac, hi: hi + span * padFrac };
};

export const SocialValueForMoneyTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data: cofog } = useCofog();
  const { data: poverty } = usePovertyImpact();
  if (!cofog || !poverty) return null;

  const year = cofog.peers?.GF10?.year ?? cofog.peerSeriesLatestYear;
  const composition =
    year != null ? cofog.peerSeriesByYear?.[String(year)] : undefined;
  if (!composition) return null;

  // Pair each geo's spend (x) with its poverty-reduction effect (y).
  const pts = GEOS.map((geo) => {
    const x = composition[geo]?.GF10;
    const y = poverty.latest[geo]?.pct;
    return x != null && y != null ? { geo: geo as string, x, y } : null;
  }).filter((p): p is { geo: string; x: number; y: number } => p != null);
  if (pts.length < 3) return null;

  const xb = niceBounds(pts.map((p) => p.x));
  const yb = niceBounds(pts.map((p) => p.y));
  const sx = (x: number) =>
    PAD.l + ((x - xb.lo) / (xb.hi - xb.lo)) * (W - PAD.l - PAD.r);
  const sy = (y: number) =>
    H - PAD.b - ((y - yb.lo) / (yb.hi - yb.lo)) * (H - PAD.t - PAD.b);

  return (
    <Card id="social-value-for-money">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ScatterChart className="h-4 w-4" />
          {bg ? "Стойност за парите" : "Value for money"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={
            bg
              ? "Разход за социална защита (% от БВП) спрямо намалението на бедността от трансферите, по държави"
              : "Social-protection spend (% of GDP) vs the poverty-reduction effect of transfers, by country"
          }
        >
          {/* axes */}
          <line
            x1={PAD.l}
            y1={H - PAD.b}
            x2={W - PAD.r}
            y2={H - PAD.b}
            className="stroke-border"
            strokeWidth={1}
          />
          <line
            x1={PAD.l}
            y1={PAD.t}
            x2={PAD.l}
            y2={H - PAD.b}
            className="stroke-border"
            strokeWidth={1}
          />
          {/* axis titles */}
          <text
            x={(PAD.l + W - PAD.r) / 2}
            y={H - 4}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {bg ? "Разход, % от БВП →" : "Spend, % of GDP →"}
          </text>
          <text
            x={10}
            y={(PAD.t + H - PAD.b) / 2}
            textAnchor="middle"
            transform={`rotate(-90 10 ${(PAD.t + H - PAD.b) / 2})`}
            className="fill-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {bg ? "Намаление на бедността, % →" : "Poverty reduction, % →"}
          </text>
          {/* points */}
          {pts.map((p) => {
            const isBg = p.geo === "BG";
            const isEu = p.geo === "EU27_2020";
            return (
              <g key={p.geo}>
                <circle
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r={isBg ? 6 : 4.5}
                  className={
                    isBg
                      ? "fill-primary"
                      : isEu
                        ? "fill-muted-foreground/60"
                        : "fill-primary/30"
                  }
                />
                <text
                  x={sx(p.x)}
                  y={sy(p.y) - 8}
                  textAnchor="middle"
                  className={isBg ? "fill-foreground" : "fill-muted-foreground"}
                  style={{
                    fontSize: isBg ? 10 : 9,
                    fontWeight: isBg ? 700 : 400,
                  }}
                >
                  {geoName(p.geo, bg)}
                </text>
              </g>
            );
          })}
        </svg>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              България отделя{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(composition.BG?.GF10 ?? 0, loc, 1)}%
              </span>{" "}
              от БВП, но трансферите свалят бедността само с{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(poverty.latest.BG?.pct ?? 0, loc, 0)}%
              </span>{" "}
              — под линията, която разходът би предвидил. Харчи средно, постига
              малко.
            </>
          ) : (
            <>
              Bulgaria spends{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(composition.BG?.GF10 ?? 0, loc, 1)}%
              </span>{" "}
              of GDP but its transfers cut poverty by only{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(poverty.latest.BG?.pct ?? 0, loc, 0)}%
              </span>{" "}
              — below what the spend would predict. Average effort, little
              effect.
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg ? "Източник: " : "Source: "}
          Eurostat gov_10a_exp (GF10) · ilc_li10 / ilc_li02 ({year})
        </p>
      </CardContent>
    </Card>
  );
};
