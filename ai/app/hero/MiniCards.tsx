/**
 * Decorative "mini answer-card" facsimiles for the empty-state hero collage
 * (concept C: Gemini backdrop + floating cards). These mirror the real
 * AnswerView card chrome (rounded-xl border bg-card) but are hand-rolled SVG so
 * the landing page stays light — no Recharts / Leaflet / GeoJSON at runtime. All
 * colours come from theme CSS vars (--chart-N, --border, …) so they swap with
 * light/dark automatically. Each card is a button that fires a representative
 * query, turning the collage into real chat answers on click.
 */
import type { ReactNode } from "react";
import { BG_MAP_VIEWBOX, BG_OBLASTS } from "./bgOblastPaths";

const chart = (n: number) => `hsl(var(--chart-${n}))`;

/** Shared card chrome — mirrors AnswerView's wrapper, compacted for a thumbnail. */
const HeroCard = ({
  title,
  source,
  accent,
  onClick,
  ariaLabel,
  rotate,
  className = "",
  children,
}: {
  title: string;
  source: string;
  accent: string;
  onClick: () => void;
  ariaLabel: string;
  rotate: number;
  className?: string;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    style={{ rotate: `${rotate}deg` }}
    className={`group w-[148px] shrink-0 rounded-xl border border-border bg-card/90 p-3 text-left shadow-lg backdrop-blur-sm transition-transform duration-200 hover:rotate-0 hover:-translate-y-1 hover:shadow-xl focus-visible:rotate-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-[176px] ${className}`}
  >
    <div className="mb-2 flex items-center gap-1.5">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: accent }}
      />
      <span className="truncate text-xs font-medium text-foreground">
        {title}
      </span>
    </div>
    {children}
    <div className="mt-1.5 truncate text-[10px] text-muted-foreground">
      {source}
    </div>
  </button>
);

/** Party-results bar chart. */
export const MiniBarCard = (p: {
  title: string;
  source: string;
  ariaLabel: string;
  onClick: () => void;
  rotate: number;
  className?: string;
}) => {
  const bars = [0.92, 0.66, 0.47, 0.31, 0.19];
  const bw = 18;
  const gap = 8;
  const base = 70;
  return (
    <HeroCard {...p} accent={chart(1)}>
      <svg viewBox="0 0 140 78" className="h-auto w-full">
        <line
          x1="6"
          y1={base}
          x2="134"
          y2={base}
          stroke="hsl(var(--border))"
          strokeWidth="1"
        />
        {bars.map((h, i) => {
          const x = 12 + i * (bw + gap);
          const bh = h * 58;
          return (
            <rect
              key={i}
              x={x}
              y={base - bh}
              width={bw}
              height={bh}
              rx="3"
              fill={chart((i % 5) + 1)}
            />
          );
        })}
      </svg>
    </HeroCard>
  );
};

/** Turnout-over-time line chart with a peak marker. */
export const MiniLineCard = (p: {
  title: string;
  source: string;
  ariaLabel: string;
  onClick: () => void;
  rotate: number;
  className?: string;
}) => {
  const ys = [0.46, 0.6, 0.5, 0.72, 0.4, 0.55, 0.34, 0.28];
  const W = 140;
  const Hh = 70;
  const pad = 8;
  const pts = ys.map((y, i) => {
    const x = pad + (i * (W - 2 * pad)) / (ys.length - 1);
    const yy = Hh - pad - y * (Hh - 2 * pad);
    return [x, yy] as const;
  });
  const peak = pts.reduce((a, b) => (b[1] < a[1] ? b : a), pts[0]);
  const line = pts.map((q) => `${q[0]},${q[1]}`).join(" ");
  const area = `${pad},${Hh - pad} ${line} ${W - pad},${Hh - pad}`;
  return (
    <HeroCard {...p} accent={chart(2)}>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="h-auto w-full">
        <polygon points={area} fill={chart(2)} opacity="0.12" />
        <polyline
          points={line}
          fill="none"
          stroke={chart(2)}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {pts.map((q, i) => (
          <circle key={i} cx={q[0]} cy={q[1]} r="2" fill={chart(2)} />
        ))}
        <circle
          cx={peak[0]}
          cy={peak[1]}
          r="3.5"
          fill="hsl(var(--accent))"
          stroke="hsl(var(--card))"
          strokeWidth="1.5"
        />
      </svg>
    </HeroCard>
  );
};

// Parliament hemicycle seats, grouped by party (computed once at module load).
const HEMI_DOTS = (() => {
  const cx = 70;
  const cy = 66;
  const inner = 22;
  const outer = 60;
  const rows = 5;
  const dots: { x: number; y: number; a: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const rad = inner + ((outer - inner) * r) / (rows - 1);
    const n = Math.round(7 + r * 3.5);
    for (let i = 0; i < n; i++) {
      const a = Math.PI - (Math.PI * i) / (n - 1);
      dots.push({ x: cx + rad * Math.cos(a), y: cy - rad * Math.sin(a), a });
    }
  }
  dots.sort((p, q) => q.a - p.a); // left (π) → right (0), like a real seating chart
  const shares = [0.32, 0.24, 0.18, 0.15, 0.11];
  const total = dots.length;
  let cut = 0;
  const bounds = shares.map((s) => (cut += Math.round(s * total)));
  return dots.map((d, idx) => {
    const g = bounds.findIndex((b) => idx < b);
    return { ...d, c: g === -1 ? 5 : g + 1 };
  });
})();

/** Parliament-seat hemicycle. */
export const MiniHemicycleCard = (p: {
  title: string;
  source: string;
  ariaLabel: string;
  onClick: () => void;
  rotate: number;
  className?: string;
}) => (
  <HeroCard {...p} accent={chart(4)}>
    <svg viewBox="0 0 140 74" className="h-auto w-full">
      {HEMI_DOTS.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="2.6" fill={chart(d.c)} />
      ))}
    </svg>
  </HeroCard>
);

// Deterministic per-oblast fill so the choropleth reads as graded data.
const RAMP = [1, 3, 2, 4, 5];
const oblastFill = (i: number) => chart(RAMP[i % RAMP.length]);
const oblastOpacity = (i: number) => 0.35 + ((i * 37) % 60) / 100;

/** Regional choropleth of Bulgaria (pre-baked oblast paths). */
export const MiniMapCard = (p: {
  title: string;
  source: string;
  ariaLabel: string;
  onClick: () => void;
  rotate: number;
  className?: string;
}) => (
  <HeroCard {...p} accent={chart(1)}>
    <svg viewBox={BG_MAP_VIEWBOX} className="h-auto w-full">
      <g stroke="hsl(var(--card))" strokeWidth="0.8" strokeLinejoin="round">
        {BG_OBLASTS.map((o, i) => (
          <path
            key={o.code || i}
            d={o.d}
            fill={oblastFill(i)}
            opacity={oblastOpacity(i)}
          />
        ))}
      </g>
    </svg>
  </HeroCard>
);

// Budget-composition donut. Abstract on purpose — no claimed figure, so it reads
// as an illustration (like the other cards) rather than an unverified fact.
const DONUT_R = 24;
const DONUT_C = 2 * Math.PI * DONUT_R;
const DONUT_SEG = (() => {
  const shares = [0.34, 0.24, 0.18, 0.14, 0.1];
  let acc = 0;
  return shares.map((s, i) => {
    const seg = {
      len: s * DONUT_C,
      offset: -acc * DONUT_C,
      c: ((i % 5) + 1) as number,
    };
    acc += s;
    return seg;
  });
})();

/** Budget-spending composition donut. */
export const MiniDonutCard = (p: {
  title: string;
  source: string;
  ariaLabel: string;
  onClick: () => void;
  rotate: number;
  className?: string;
}) => (
  <HeroCard {...p} accent={chart(3)}>
    <svg viewBox="0 0 140 74" className="h-auto w-full">
      <g transform="rotate(-90 70 37)" fill="none" strokeWidth="11">
        {DONUT_SEG.map((s, i) => (
          <circle
            key={i}
            cx="70"
            cy="37"
            r={DONUT_R}
            stroke={chart(s.c)}
            strokeDasharray={`${s.len} ${DONUT_C - s.len}`}
            strokeDashoffset={s.offset}
          />
        ))}
      </g>
    </svg>
  </HeroCard>
);
