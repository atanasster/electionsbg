// The SEDA / "beats its context" scatter — each school a dot at (x = обшина
// socioeconomic context, y = matura score), with the expectation line (the OLS
// fit). A dot ABOVE the line scores higher than its circumstances predict; BELOW,
// lower. This is the whole argument in one picture: wealth buys a high starting
// line, so judge a school by its distance from the line, not its raw height.
//
// Pure inline SVG (no chart vendor) — ~800 dots render fine and stay cheap.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
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

const W = 640;
const H = 400;
const PAD = { l: 44, r: 16, t: 16, b: 40 };

export const ContextScatter: FC<{
  dir: SchoolDirectory;
  highlightId?: string;
}> = ({ dir, highlightId }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const navigate = useNavigate();
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

  const geom = useMemo(() => {
    if (!pts.length || !dir.regression) return null;
    const xs = pts.map((p) => p.ses);
    const ys = pts.map((p) => p.latestScore);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.max(2, Math.floor(Math.min(...ys) * 2) / 2);
    const yMax = Math.min(6, Math.ceil(Math.max(...ys) * 2) / 2);
    const px = (x: number) =>
      PAD.l + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD.l - PAD.r);
    const py = (y: number) =>
      H - PAD.b - ((y - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b);
    const { slope, intercept } = dir.regression;
    return {
      xMin,
      xMax,
      yMin,
      yMax,
      px,
      py,
      lineY1: intercept + slope * xMin,
      lineY2: intercept + slope * xMax,
    };
  }, [pts, dir.regression]);

  if (!geom) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-xl border bg-card text-muted-foreground">
        {bg ? "Няма достатъчно данни" : "Not enough data"}
      </div>
    );
  }

  const highlight = highlightId ? dir.byId(highlightId) : null;

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={
          bg ? "Успех спрямо подобни училища" : "Score versus context"
        }
      >
        {/* y gridlines + labels (whole matura grades) */}
        {Array.from(
          { length: Math.round(geom.yMax - geom.yMin) + 1 },
          (_, i) => geom.yMin + i,
        ).map((g) => (
          <g key={g}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={geom.py(g)}
              y2={geom.py(g)}
              stroke="currentColor"
              className="text-border"
              strokeWidth={0.5}
            />
            <text
              x={PAD.l - 6}
              y={geom.py(g) + 3}
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
            cx={geom.px(p.ses)}
            cy={geom.py(p.latestScore)}
            r={2.2}
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
            onMouseMove={(e) => onMouseMove({ pageX: e.pageX, pageY: e.pageY })}
            onMouseLeave={onMouseLeave}
          />
        ))}

        {/* expectation line */}
        <line
          x1={geom.px(geom.xMin)}
          x2={geom.px(geom.xMax)}
          y1={geom.py(geom.lineY1)}
          y2={geom.py(geom.lineY2)}
          stroke="currentColor"
          className="text-foreground"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />

        {/* highlighted school (when linked from a report card) */}
        {highlight?.ses != null && highlight.latestScore != null && (
          <circle
            cx={geom.px(highlight.ses)}
            cy={geom.py(highlight.latestScore)}
            r={5}
            fill="none"
            stroke="#2563eb"
            strokeWidth={2.5}
          />
        )}

        {/* axis captions */}
        <text
          x={(W + PAD.l - PAD.r) / 2}
          y={H - 6}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {bg
            ? "← по-неблагоприятни условия · по-благоприятни →"
            : "← more disadvantaged context · more advantaged →"}
        </text>
      </svg>
      {/* OUTSIDE the svg — the shared tooltip uses page coords. */}
      {tooltip}
    </>
  );
};
