// "Стойност за парите — разход спрямо ефект" — the value-for-money scatter (plan
// §4b). x = social-protection spend (% GDP, COFOG GF10); y = poverty-reduction
// effect (%, ilc_li10−ilc_li02 over li10). One dot per country, BG highlighted, with
// an OLS trend line (more spend → more reduction) and gridded axes with tick values
// (the ContextScatter house pattern). Reads data/cofog.json (x) +
// data/social/poverty_impact.json (y).
//
// HONEST framing (verified against the data): Bulgaria is bottom-left — it spends
// BELOW the EU (14.4% vs 19.6% of GDP) and cuts poverty less (27% vs 33%). For what
// it spends the result is about on the line, so the lever is the SIZE of the spend,
// not per-euro efficiency. (The earlier "below what the spend predicts" claim was
// wrong — BG actually sits slightly above the fit.)

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ScatterChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatCount } from "@/lib/currency";
import { useCofog } from "@/data/macro/useCofog";
import { usePovertyImpact } from "@/data/social/usePovertyImpact";
import { useTooltip } from "@/ux/useTooltip";

const GEO_NAME: Record<string, { bg: string; en: string }> = {
  BG: { bg: "България", en: "Bulgaria" },
  EU27_2020: { bg: "ЕС средно", en: "EU average" },
  RO: { bg: "Румъния", en: "Romania" },
  HU: { bg: "Унгария", en: "Hungary" },
  HR: { bg: "Хърватия", en: "Croatia" },
};
const geoName = (geo: string, bg: boolean): string =>
  GEO_NAME[geo]?.[bg ? "bg" : "en"] ?? geo;

const GEOS = ["BG", "EU27_2020", "RO", "HU", "HR"] as const;

// SVG geometry (ContextScatter proportions: fixed viewBox, fluid width).
const W = 460;
const H = 300;
const PAD = { l: 42, r: 16, t: 14, b: 40 };

/** A "nice" axis: round lo/hi + evenly-spaced tick values covering the data. */
const niceScale = (
  min: number,
  max: number,
  target = 4,
): { lo: number; hi: number; ticks: number[] } => {
  const span = max - min || 1;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step * 1e-6; t += step)
    ticks.push(Math.round(t * 1e6) / 1e6);
  return { lo, hi, ticks };
};

export const SocialValueForMoneyTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data: cofog } = useCofog();
  const { data: poverty } = usePovertyImpact();
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip({
    maxHeight: 220,
    maxWidth: 240,
  });
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

  const xs = niceScale(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))); // prettier-ignore
  const ys = niceScale(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)), 3); // prettier-ignore
  const sx = (x: number) =>
    PAD.l + ((x - xs.lo) / (xs.hi - xs.lo)) * (W - PAD.l - PAD.r);
  const sy = (y: number) =>
    H - PAD.b - ((y - ys.lo) / (ys.hi - ys.lo)) * (H - PAD.t - PAD.b);

  // OLS fit y~x over all points — the "more spend → more reduction" trend line.
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const lineY = (x: number) => intercept + slope * x;

  const bgPt = pts.find((p) => p.geo === "BG");
  const euPt = pts.find((p) => p.geo === "EU27_2020");

  return (
    <>
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
            {/* Y gridlines + tick labels */}
            {ys.ticks.map((g) => (
              <g key={`y${g}`}>
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={sy(g)}
                  y2={sy(g)}
                  className="stroke-border"
                  strokeWidth={0.5}
                />
                <text
                  x={PAD.l - 6}
                  y={sy(g) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  style={{ fontSize: 9 }}
                >
                  {formatCount(g, loc, 0)}%
                </text>
              </g>
            ))}
            {/* X tick labels (on the baseline) */}
            {xs.ticks.map((g) => (
              <text
                key={`x${g}`}
                x={sx(g)}
                y={H - PAD.b + 13}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 9 }}
              >
                {formatCount(g, loc, 0)}%
              </text>
            ))}

            {/* trend line (more spend → more reduction) */}
            <line
              x1={sx(xs.lo)}
              y1={sy(lineY(xs.lo))}
              x2={sx(xs.hi)}
              y2={sy(lineY(xs.hi))}
              className="stroke-muted-foreground/50"
              strokeWidth={1.25}
              strokeDasharray="5 4"
            />

            {/* points */}
            {pts.map((p) => {
              const isBg = p.geo === "BG";
              const isEu = p.geo === "EU27_2020";
              const cx = sx(p.x);
              const cy = sy(p.y);
              const nearTop = cy < PAD.t + 20;
              const nearRight = cx > W - PAD.r - 46;
              const nearLeft = cx < PAD.l + 46;
              const anchor = nearRight ? "end" : nearLeft ? "start" : "middle";
              const lx = cx + (nearRight ? -9 : nearLeft ? 9 : 0);
              const ly = cy + (nearTop ? 17 : -10);
              const content = (
                <div className="space-y-0.5">
                  <div className="font-semibold">{geoName(p.geo, bg)}</div>
                  <div className="text-[11px]">
                    {bg ? "Разход: " : "Spend: "}
                    <span className="tabular-nums">
                      {formatCount(p.x, loc, 1)}% {bg ? "от БВП" : "of GDP"}
                    </span>
                  </div>
                  <div className="text-[11px]">
                    {bg ? "Намаление на бедността: " : "Poverty reduction: "}
                    <span className="tabular-nums">
                      {formatCount(p.y, loc, 0)}%
                    </span>
                  </div>
                </div>
              );
              return (
                <g
                  key={p.geo}
                  className="cursor-default"
                  onMouseEnter={(e) =>
                    onMouseEnter({ pageX: e.pageX, pageY: e.pageY }, content)
                  }
                  onMouseMove={(e) =>
                    onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                  }
                  onMouseLeave={onMouseLeave}
                >
                  {/* generous invisible hit area */}
                  <circle cx={cx} cy={cy} r={11} fill="transparent" />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isBg ? 6 : 5}
                    className={
                      isBg
                        ? "fill-primary"
                        : isEu
                          ? "fill-none stroke-muted-foreground"
                          : "fill-primary/35"
                    }
                    strokeWidth={isEu ? 2 : 0}
                  />
                  <text
                    x={lx}
                    y={ly}
                    textAnchor={anchor}
                    className={
                      isBg ? "fill-foreground" : "fill-muted-foreground"
                    }
                    style={{
                      fontSize: isBg ? 11 : 10,
                      fontWeight: isBg ? 700 : 400,
                    }}
                  >
                    {geoName(p.geo, bg)}
                  </text>
                </g>
              );
            })}

            {/* axis captions */}
            <text
              x={(PAD.l + W - PAD.r) / 2}
              y={H - 3}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 9 }}
            >
              {bg
                ? "Разход за соц. защита, % от БВП →"
                : "Social-protection spend, % of GDP →"}{" "}
              {/* prettier-ignore */}
            </text>
            <text
              x={11}
              y={(PAD.t + H - PAD.b) / 2}
              textAnchor="middle"
              transform={`rotate(-90 11 ${(PAD.t + H - PAD.b) / 2})`}
              className="fill-muted-foreground"
              style={{ fontSize: 9 }}
            >
              {bg ? "Намаление на бедността →" : "Poverty reduction →"}
            </text>
          </svg>

          <p className="text-sm leading-snug">
            {bg ? (
              <>
                Повече разход, повече намаление на бедността — държавите се
                подреждат по възходяща линия. България е{" "}
                <span className="font-semibold">долу вляво</span>: харчи{" "}
                <span className="font-semibold tabular-nums">
                  {formatCount(bgPt?.x ?? 0, loc, 1)}%
                </span>{" "}
                от БВП (под{" "}
                <span className="tabular-nums">
                  {formatCount(euPt?.x ?? 0, loc, 1)}%
                </span>{" "}
                за ЕС) и сваля бедността с{" "}
                <span className="font-semibold tabular-nums">
                  {formatCount(bgPt?.y ?? 0, loc, 0)}%
                </span>{" "}
                (под{" "}
                <span className="tabular-nums">
                  {formatCount(euPt?.y ?? 0, loc, 0)}%
                </span>{" "}
                за ЕС). За похарченото резултатът е около очаквания — лостът е
                размерът на разхода, не ефективността.
              </>
            ) : (
              <>
                More spending, more poverty reduction — countries line up along
                an upward trend. Bulgaria is{" "}
                <span className="font-semibold">bottom-left</span>: it spends{" "}
                <span className="font-semibold tabular-nums">
                  {formatCount(bgPt?.x ?? 0, loc, 1)}%
                </span>{" "}
                of GDP (below the EU's{" "}
                <span className="tabular-nums">
                  {formatCount(euPt?.x ?? 0, loc, 1)}%
                </span>
                ) and cuts poverty by{" "}
                <span className="font-semibold tabular-nums">
                  {formatCount(bgPt?.y ?? 0, loc, 0)}%
                </span>{" "}
                (below the EU's{" "}
                <span className="tabular-nums">
                  {formatCount(euPt?.y ?? 0, loc, 0)}%
                </span>
                ). For what it spends the result is about as expected — the
                lever is the size of the spend, not efficiency.
              </>
            )}
          </p>

          <p className="text-[11px] text-muted-foreground/80">
            {bg ? "Източник: " : "Source: "}
            Eurostat gov_10a_exp (GF10) · ilc_li10 / ilc_li02 ({year})
          </p>
        </CardContent>
      </Card>
      {tooltip}
    </>
  );
};
