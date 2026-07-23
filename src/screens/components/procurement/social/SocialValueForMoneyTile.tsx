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
import { useMeasuredWidth } from "@/ux/useMeasuredWidth";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
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

// SVG geometry — drawn at the MEASURED width, in CSS pixels, like ContextScatter.
// It used to stretch a 460-unit viewBox to the container: in the two-up grid on a
// phone that squeezed it to ~0.72×, so the 9px tick and caption type landed at
// ~6.5px. Real pixels keep the labels legible at every width.
const PAD = { l: 42, r: 16, t: 14, b: 40 };
// Known before the first measurement, so the reserved box is the final box and
// the measure-then-draw pass costs no layout shift.
const H_SMALL = 260;
const H_WIDE = 300;
// The plot width the dot radii were tuned against (the old 460-unit viewBox).
const REF_PLOT_W = 460 - PAD.l - PAD.r;
// Below this the 58px of axis gutters leave no usable plot and sx() would start
// mapping points right-to-left.
const MIN_PLOT_W = 140;

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
  const isSmall = useMediaQueryMatch("sm");
  const [setPlotEl, plotWidth] = useMeasuredWidth();
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

  // Draw ONLY at a measured width — never at a guessed fallback. The tile is a
  // grid item, so an SVG wider than the column stretches the track, which makes
  // the host measure that inflated width: the guess latches instead of
  // correcting. An empty host always measures the true column width.
  const W = plotWidth;
  const H = isSmall ? H_SMALL : H_WIDE;
  const plotW = W - PAD.l - PAD.r;
  // Dot area still scales with the plot — only the text is pinned to real px.
  const rScale = Math.max(0.7, Math.min(1.2, plotW / REF_PLOT_W));

  const sx = (x: number) => PAD.l + ((x - xs.lo) / (xs.hi - xs.lo)) * plotW;
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

  // Label placement. RO/HU/HR cluster within ~1.5 points of GDP in the crowded
  // bottom-left, and their labels printed on top of one another (a uniform
  // viewBox scale preserved the overlap — it was just too small to read).
  // Greedy pass: take each label above its dot, and if that box overlaps one
  // already placed, step to the next slot. Five points, so O(n²) is free.
  const LABEL_LH = 12;
  const boxes: { x0: number; x1: number; y: number }[] = [];
  const labels = pts
    .map((p) => {
      const cx = sx(p.x);
      const cy = sy(p.y);
      const fs = p.geo === "BG" ? 11 : 10;
      const text = geoName(p.geo, bg);
      // No text metrics available mid-render; 0.55em per character is a close
      // enough box for both Cyrillic and Latin at these sizes.
      const w = text.length * fs * 0.55;
      const nearRight = cx + w / 2 > W - PAD.r;
      const nearLeft = cx - w / 2 < PAD.l;
      // `as const` so the union survives the object literal — without it the
      // inferred type widens to `string` and no longer satisfies SVG's
      // textAnchor.
      const anchor = (nearRight ? "end" : nearLeft ? "start" : "middle") as
        | "end"
        | "start"
        | "middle";
      const lx = cx + (nearRight ? -9 : nearLeft ? 9 : 0);
      const x0 =
        anchor === "end" ? lx - w : anchor === "start" ? lx : lx - w / 2;
      return { p, cx, cy, lx, x0, w, anchor, fs, text };
    })
    // Top-most first, so the cluster underneath works around what is already down.
    .sort((a, b) => a.cy - b.cy)
    .map((l) => {
      // Above the dot by default; below when that would leave the plot.
      const slots =
        l.cy < PAD.t + 20
          ? [l.cy + 17, l.cy - 10, l.cy + 29, l.cy - 22]
          : [l.cy - 10, l.cy + 17, l.cy - 22, l.cy + 29];
      const ly =
        slots.find(
          (y) =>
            y > PAD.t + 8 &&
            y < H - PAD.b - 2 &&
            !boxes.some(
              (b) =>
                b.x1 > l.x0 &&
                b.x0 < l.x0 + l.w &&
                Math.abs(b.y - y) < LABEL_LH,
            ),
        ) ?? slots[0];
      boxes.push({ x0: l.x0, x1: l.x0 + l.w, y: ly });
      return { ...l, ly };
    });

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
          {/* Height reserved so the measure-then-draw pass costs no layout shift. */}
          <div
            ref={setPlotEl}
            className="overflow-hidden"
            style={{ height: H }}
          >
            {plotW > MIN_PLOT_W && (
              <svg
                width={W}
                height={H}
                viewBox={`0 0 ${W} ${H}`}
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
                      className="fill-muted-foreground text-[10px]"
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
                    y={H - PAD.b + 14}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[10px]"
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
                {labels.map(({ p, cx, cy, lx, ly, anchor, fs, text }) => {
                  const isBg = p.geo === "BG";
                  const isEu = p.geo === "EU27_2020";
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
                        {bg
                          ? "Намаление на бедността: "
                          : "Poverty reduction: "}
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
                        onMouseEnter(
                          { pageX: e.pageX, pageY: e.pageY },
                          content,
                        )
                      }
                      onMouseMove={(e) =>
                        onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                      }
                      onMouseLeave={onMouseLeave}
                    >
                      {/* generous invisible hit area */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={11 * rScale}
                        fill="transparent"
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={(isBg ? 6 : 5) * rScale}
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
                        style={{ fontSize: fs, fontWeight: isBg ? 700 : 400 }}
                      >
                        {text}
                      </text>
                    </g>
                  );
                })}

                {/* axis captions */}
                <text
                  x={(PAD.l + W - PAD.r) / 2}
                  y={H - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px]"
                >
                  {bg
                    ? "Разход за соц. защита, % от БВП →"
                    : "Social-protection spend, % of GDP →"}
                </text>
                <text
                  x={11}
                  y={(PAD.t + H - PAD.b) / 2}
                  textAnchor="middle"
                  transform={`rotate(-90 11 ${(PAD.t + H - PAD.b) / 2})`}
                  className="fill-muted-foreground text-[11px]"
                >
                  {bg ? "Намаление на бедността →" : "Poverty reduction →"}
                </text>
              </svg>
            )}
          </div>

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
