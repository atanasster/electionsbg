// The SEDA / "beats its context" scatter — each school a dot at (x = обшина
// socioeconomic context, y = matura score), with the expectation line (the OLS
// fit). A dot ABOVE the line scores higher than its circumstances predict; BELOW,
// lower. This is the whole argument in one picture: wealth buys a high starting
// line, so judge a school by its distance from the line, not its raw height.
//
// Pure inline SVG (no chart vendor) — ~800 dots render fine and stay cheap —
// drawn at the MEASURED width, in CSS pixels. A fixed viewBox stretched to the
// container scales the axis and tick type along with the geometry: the caption
// came out oversized on a wide viewport and below legibility on a phone.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useMeasuredWidth } from "@/ux/useMeasuredWidth";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { useTooltip } from "@/ux/useTooltip";
import type {
  DirectorySchool,
  SchoolDirectory,
} from "@/data/schools/useSchoolDirectory";

const VERDICT_COLOR = {
  above: "#16a34a", // green-600
  expected: "#94a3b8", // slate-400
  under: "#dc2626", // red-600
} as const;

const PAD = { l: 44, r: 16, t: 16, b: 40 };
// Height is picked off the breakpoint, not off the measured width: it has to be
// known before the first measurement so the reserved box is the final box and
// the measure-then-draw pass costs no layout shift. A phone gets a near-square
// plot, which is more vertical room for the cloud than the stretched viewBox
// used to give it (~206px).
const H_SMALL = 300;
const H_WIDE = 400;
// The plot width the dot radii were tuned against (the old 640-unit viewBox).
const REF_PLOT_W = 640 - PAD.l - PAD.r;
// Below this the 60px of axis gutters leave no usable plot and px() would start
// mapping points right-to-left. Nothing narrower is worth drawing.
const MIN_PLOT_W = 140;
// Narrower than this and the full axis caption no longer fits on one line.
const CAPTION_MIN_W = 300;

export const ContextScatter: FC<{
  dir: SchoolDirectory;
  highlightId?: string;
}> = ({ dir, highlightId }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const navigate = useNavigate();
  const isSmall = useMediaQueryMatch("sm");
  const [setPlotEl, plotWidth] = useMeasuredWidth();
  // Shared tooltip, never the native <title> (house rule). {tooltip} renders OUTSIDE
  // the svg — it positions with page coordinates + position:absolute.
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip();

  const pts = useMemo(
    () =>
      dir.schools.filter(
        (s): s is DirectorySchool & { ses: number; latestScore: number } =>
          s.ses != null && s.latestScore != null && s.verdict != null,
      ),
    [dir.schools],
  );

  // Domain only — the pixel scales live in the render body because they depend
  // on the measured width, which changes on every resize.
  const domain = useMemo(() => {
    if (!pts.length || !dir.regression) return null;
    const xs = pts.map((p) => p.ses);
    const ys = pts.map((p) => p.latestScore);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.max(2, Math.floor(Math.min(...ys) * 2) / 2);
    const yMax = Math.min(6, Math.ceil(Math.max(...ys) * 2) / 2);
    const { slope, intercept } = dir.regression;
    return {
      xMin,
      xMax,
      yMin,
      yMax,
      lineY1: intercept + slope * xMin,
      lineY2: intercept + slope * xMax,
    };
  }, [pts, dir.regression]);

  if (!domain) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-xl border bg-card text-muted-foreground">
        {bg ? "Няма достатъчно данни" : "Not enough data"}
      </div>
    );
  }

  const highlight = highlightId ? dir.byId(highlightId) : null;

  // Draw ONLY at a measured width — never at a guessed fallback. The card is a
  // grid item on /education (min-width:auto), so an SVG wider than the column
  // stretches the track, which makes the host measure that inflated width,
  // which keeps the SVG wide: the guess latches instead of correcting. That is
  // exactly how the old 640-unit viewBox blew the phone layout out to 713px. An
  // empty host always measures the true column width, so the first measurement
  // is right.
  const W = plotWidth;
  const H = isSmall ? H_SMALL : H_WIDE;
  const plotW = W - PAD.l - PAD.r;
  // Dot area still scales with the plot so a wide chart doesn't read as a field
  // of specks — only the text is pinned to real pixels. The floor keeps a dot
  // visible on a phone, where the plot is under half the reference width.
  const rScale = plotW / REF_PLOT_W;
  const dotR = Math.max(1.6, 2.2 * rScale);
  const ringR = Math.max(4, 5 * rScale);

  // Now that the caption renders at a true 11px it no longer shrinks with the
  // chart, so on a small phone the full sentence would run past the edge and be
  // clipped. It measures ~280px (BG) / ~275px (EN); below that, drop to the two
  // words that carry the direction.
  const caption =
    W < CAPTION_MIN_W
      ? bg
        ? "← неблагоприятни · благоприятни →"
        : "← disadvantaged · advantaged →"
      : bg
        ? "← по-неблагоприятни условия · по-благоприятни →"
        : "← more disadvantaged context · more advantaged →";

  const px = (x: number) =>
    PAD.l + ((x - domain.xMin) / (domain.xMax - domain.xMin || 1)) * plotW;
  const py = (y: number) =>
    H -
    PAD.b -
    ((y - domain.yMin) / (domain.yMax - domain.yMin || 1)) *
      (H - PAD.t - PAD.b);

  return (
    <>
      {/* Height reserved so the measure-then-draw pass costs no layout shift. */}
      <div ref={setPlotEl} className="overflow-hidden" style={{ height: H }}>
        {plotW > MIN_PLOT_W && (
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={
              bg ? "Успех спрямо подобни училища" : "Score versus context"
            }
          >
            {/* y gridlines + labels (whole matura grades) */}
            {Array.from(
              { length: Math.round(domain.yMax - domain.yMin) + 1 },
              (_, i) => domain.yMin + i,
            ).map((g) => (
              <g key={g}>
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={py(g)}
                  y2={py(g)}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={0.5}
                />
                <text
                  x={PAD.l - 6}
                  y={py(g) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {g.toFixed(0)}
                </text>
              </g>
            ))}

            {/* dots */}
            {pts.map((p) => (
              <circle
                key={p.id}
                cx={px(p.ses)}
                cy={py(p.latestScore)}
                r={dotR}
                fill={VERDICT_COLOR[p.verdict!]}
                fillOpacity={0.6}
                className="cursor-pointer"
                onClick={() => navigate(`/school/${p.id}`)}
                onMouseEnter={(e) =>
                  onMouseEnter(
                    { pageX: e.pageX, pageY: e.pageY },
                    <span className="block">
                      <span className="block font-medium">{p.name}</span>
                      <span className="block">{p.obshtinaName}</span>
                      <span className="block tabular-nums">
                        {p.latestScore?.toFixed(2)}
                      </span>
                    </span>,
                  )
                }
                onMouseMove={(e) =>
                  onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                }
                onMouseLeave={onMouseLeave}
              />
            ))}

            {/* expectation line */}
            <line
              x1={px(domain.xMin)}
              x2={px(domain.xMax)}
              y1={py(domain.lineY1)}
              y2={py(domain.lineY2)}
              stroke="currentColor"
              className="text-foreground"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />

            {/* highlighted school (when linked from a report card) */}
            {highlight?.ses != null && highlight.latestScore != null && (
              <circle
                cx={px(highlight.ses)}
                cy={py(highlight.latestScore)}
                r={ringR}
                fill="none"
                stroke="#2563eb"
                strokeWidth={2.5}
              />
            )}

            {/* axis caption */}
            <text
              x={(W + PAD.l - PAD.r) / 2}
              y={H - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {caption}
            </text>
          </svg>
        )}
      </div>
      {/* OUTSIDE the svg — the shared tooltip uses page coords. */}
      {tooltip}
    </>
  );
};
