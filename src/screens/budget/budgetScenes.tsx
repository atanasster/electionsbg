// Infographic vignettes for the /budget hub tiles — same drawing contract as
// parliamentScenes.tsx / governanceScenes.tsx (300×116 SceneFrame, ink =
// currentColor, accent = var(--sector), PAPER for under-ink fills; see
// src/ux/infographic/README.md).
//
// One bespoke scene per tile, none reused from another hub. Each draws the
// STRUCTURE its destination is about rather than a generic bar chart: the
// revenue mark is a funnel narrowing into one channel, the execution mark is a
// plan bar with an outturn bar beside it and the gap between them shown, the
// deviations mark is three rows where the middle one overshoots. A reader
// should be able to tell two tiles apart at thumbnail size.
//
// Dense marks stay on the RIGHT half and the TOP band: these tiles carry a
// `metric`, which InfographicTile overlays large at the banner's bottom-left.

/* eslint-disable react-refresh/only-export-components -- BUDGET_SCENES is a lookup
   table of scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

// Приходи — a funnel: many sources narrowing into one channel. Tax is the wide
// mouth, the neck is the treasury.
const Revenue: FC = () => (
  <SceneFrame>
    <g
      stroke="currentColor"
      strokeWidth="2"
      opacity=".35"
      strokeLinecap="round"
    >
      {[26, 42, 58, 74, 90].map((y) => (
        <path key={y} d={`M150 ${y}h${44 - Math.abs(58 - y) * 0.5}`} />
      ))}
    </g>
    <path
      d="M196 20 L262 44 L262 72 L196 96 Z"
      fill="var(--sector)"
      opacity=".22"
    />
    <path
      d="M196 20 L262 44 L262 72 L196 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <rect x="262" y="50" width="18" height="16" rx="3" fill={PAPER} />
    <rect
      x="262"
      y="50"
      width="18"
      height="16"
      rx="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    />
  </SceneFrame>
);

// Разходи — the mirror: one channel fanning out. The widest arm is the
// transfers line, which is 58% of the section.
const Spending: FC = () => (
  <SceneFrame>
    <rect x="150" y="50" width="18" height="16" rx="3" fill={PAPER} />
    <rect
      x="150"
      y="50"
      width="18"
      height="16"
      rx="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    />
    {[
      { y: 26, w: 96 },
      { y: 58, w: 60 },
      { y: 90, w: 42 },
    ].map((a) => (
      <g key={a.y}>
        <path
          d={`M168 58 C 190 58, 190 ${a.y}, 206 ${a.y}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity=".5"
        />
        <rect
          x="206"
          y={a.y - 6}
          width={a.w}
          height="12"
          rx="3"
          fill="var(--sector)"
          opacity={a.w > 80 ? ".5" : ".28"}
        />
      </g>
    ))}
  </SceneFrame>
);

// Изпълнение — plan against outturn: a pale plan bar with the outturn drawn
// inside it and the shortfall left open. The one mark that shows a GAP.
const Execution: FC = () => (
  <SceneFrame>
    {[
      { y: 26, plan: 108, actual: 96 },
      { y: 54, plan: 108, actual: 104 },
      { y: 82, plan: 108, actual: 62 },
    ].map((r) => (
      <g key={r.y}>
        <rect
          x="160"
          y={r.y}
          width={r.plan}
          height="16"
          rx="3"
          fill={PAPER}
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="4 3"
          opacity=".55"
        />
        <rect
          x="160"
          y={r.y}
          width={r.actual}
          height="16"
          rx="3"
          fill="var(--sector)"
          opacity=".45"
        />
      </g>
    ))}
  </SceneFrame>
);

// По функция — a treemap: unequal blocks, the largest one dominant, because
// social protection is 36.8% of the whole sector.
const Functional: FC = () => (
  <SceneFrame>
    {[
      { x: 156, y: 22, w: 62, h: 50 },
      { x: 222, y: 22, w: 40, h: 28 },
      { x: 222, y: 54, w: 40, h: 18 },
      { x: 156, y: 76, w: 34, h: 20 },
      { x: 194, y: 76, w: 26, h: 20 },
      { x: 224, y: 76, w: 38, h: 20 },
    ].map((b, i) => (
      <rect
        key={b.x + "-" + b.y}
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx="3"
        fill="var(--sector)"
        opacity={i === 0 ? ".5" : 0.3 - i * 0.03}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity=".35"
      />
    ))}
  </SceneFrame>
);

// Разпоредители — a roster: rows of institutions, a few carrying the „reported"
// mark, most not. That ratio IS the page's lead sentence.
const Units: FC = () => (
  <SceneFrame>
    {[26, 44, 62, 80].map((y, i) => (
      <g key={y}>
        <rect
          x="152"
          y={y}
          width="14"
          height="12"
          rx="2"
          fill="var(--sector)"
          opacity=".4"
        />
        <path
          d={`M174 ${y + 6}h${86 - i * 8}`}
          stroke="currentColor"
          strokeWidth="2"
          opacity=".4"
          strokeLinecap="round"
        />
        {i === 1 ? (
          <circle cx="270" cy={y + 6} r="4.5" fill="var(--sector)" />
        ) : (
          <circle
            cx="270"
            cy={y + 6}
            r="4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity=".35"
          />
        )}
      </g>
    ))}
  </SceneFrame>
);

// Разгледай — a drill-down: a level, then a level inside it, then a third. The
// nesting is the page.
const Explorer: FC = () => (
  <SceneFrame>
    {[
      { x: 150, y: 22, w: 126, h: 72, o: 0.16 },
      { x: 164, y: 38, w: 98, h: 44, o: 0.28 },
      { x: 178, y: 52, w: 70, h: 18, o: 0.5 },
    ].map((b) => (
      <rect
        key={b.x}
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx="4"
        fill="var(--sector)"
        opacity={b.o}
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity=".4"
      />
    ))}
    <path
      d="M254 61l7-5-7-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SceneFrame>
);

// Отклонения — three units, each a plan tick with the outturn to one side. The
// middle one overshoots, and the sign is the whole point.
const Deviations: FC = () => (
  <SceneFrame>
    <path
      d="M212 18v80"
      stroke="currentColor"
      strokeWidth="2"
      opacity=".45"
      strokeDasharray="3 3"
    />
    {[
      { y: 28, d: -34 },
      { y: 54, d: 46 },
      { y: 80, d: -12 },
    ].map((r) => (
      <rect
        key={r.y}
        x={r.d < 0 ? 212 + r.d : 212}
        y={r.y}
        width={Math.abs(r.d)}
        height="14"
        rx="3"
        fill="var(--sector)"
        opacity={Math.abs(r.d) > 40 ? ".55" : ".3"}
      />
    ))}
  </SceneFrame>
);

// Инвестиции — objects on a site: footprints of differing size with a crane
// hook over the largest. A plan, not a completion.
const Investments: FC = () => (
  <SceneFrame>
    <path
      d="M158 96h116"
      stroke="currentColor"
      strokeWidth="2.5"
      opacity=".5"
      strokeLinecap="round"
    />
    {[
      { x: 164, w: 30, h: 34 },
      { x: 202, w: 42, h: 52 },
      { x: 252, w: 22, h: 22 },
    ].map((b) => (
      <rect
        key={b.x}
        x={b.x}
        y={96 - b.h}
        width={b.w}
        height={b.h}
        rx="2"
        fill="var(--sector)"
        opacity=".35"
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity=".45"
      />
    ))}
    <path
      d="M223 44V24h34"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <circle cx="257" cy="32" r="3.5" fill="currentColor" opacity=".6" />
  </SceneFrame>
);

// Документите — the eight-slot frame, half of them filled. The empty slots are
// the page's argument.
const Law: FC = () => (
  <SceneFrame>
    {Array.from({ length: 8 }, (_, i) => {
      const x = 154 + (i % 4) * 32;
      const y = 32 + Math.floor(i / 4) * 34;
      const filled = [1, 3, 5, 7].includes(i);
      return (
        <g key={i}>
          <rect
            x={x}
            y={y}
            width="24"
            height="28"
            rx="3"
            fill={filled ? "var(--sector)" : PAPER}
            opacity={filled ? ".45" : "1"}
            stroke="currentColor"
            strokeWidth="2"
            strokeOpacity={filled ? ".5" : ".3"}
            strokeDasharray={filled ? undefined : "3 3"}
          />
          {filled ? (
            <path
              d={`M${x + 6} ${y + 10}h12M${x + 6} ${y + 17}h8`}
              stroke="currentColor"
              strokeWidth="1.8"
              opacity=".55"
              strokeLinecap="round"
            />
          ) : null}
        </g>
      );
    })}
  </SceneFrame>
);

// Щатът — an establishment grid: filled posts and empty ones, the vacancy the
// visible minority.
const Personnel: FC = () => (
  <SceneFrame>
    {Array.from({ length: 24 }, (_, i) => {
      const x = 152 + (i % 8) * 17;
      const y = 34 + Math.floor(i / 8) * 20;
      const vacant = [5, 11, 18].includes(i);
      return vacant ? (
        <circle
          key={i}
          cx={x + 5}
          cy={y + 5}
          r="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          opacity=".35"
          strokeDasharray="2 2"
        />
      ) : (
        <circle
          key={i}
          cx={x + 5}
          cy={y + 5}
          r="5"
          fill="var(--sector)"
          opacity=".4"
        />
      );
    })}
  </SceneFrame>
);

// Осигурителните фондове — a vessel that its own inflow does not fill, with a
// second, larger inflow arriving from the side. That IS the identity.
const Funds: FC = () => (
  <SceneFrame>
    <path
      d="M176 34h84v52a8 8 0 0 1-8 8h-68a8 8 0 0 1-8-8z"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <path
      d="M176 66h84v20a8 8 0 0 1-8 8h-68a8 8 0 0 1-8-8z"
      fill="var(--sector)"
      opacity=".4"
    />
    <path
      d="M196 18v12M196 30l-4-4M196 30l4-4"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity=".5"
    />
    <path
      d="M270 46h-14M256 46l5-5M256 46l5 5"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SceneFrame>
);

// Общините — a transfer outward: one source, many recipients of differing size.
const Municipal: FC = () => (
  <SceneFrame>
    <circle
      cx="168"
      cy="58"
      r="13"
      fill="var(--sector)"
      opacity=".45"
      stroke="currentColor"
      strokeWidth="2"
      strokeOpacity=".5"
    />
    {[
      { x: 232, y: 26, r: 9 },
      { x: 262, y: 48, r: 6 },
      { x: 240, y: 74, r: 11 },
      { x: 268, y: 92, r: 5 },
    ].map((n) => (
      <g key={n.x + "-" + n.y}>
        <path
          d={`M182 58 C 206 58, 208 ${n.y}, ${n.x - n.r} ${n.y}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          opacity=".38"
        />
        <circle cx={n.x} cy={n.y} r={n.r} fill="var(--sector)" opacity=".33" />
      </g>
    ))}
  </SceneFrame>
);

// ИПОП — contracted against paid: a long agreed bar with a short paid fill.
// The gap is the page.
const MuniInvestments: FC = () => (
  <SceneFrame>
    {[
      { y: 28, paid: 0.42 },
      { y: 54, paid: 0.11 },
      { y: 80, paid: 0.03 },
    ].map((r) => (
      <g key={r.y}>
        <rect
          x="156"
          y={r.y}
          width="118"
          height="14"
          rx="3"
          fill="currentColor"
          opacity=".12"
        />
        <rect
          x="156"
          y={r.y}
          width={118 * r.paid}
          height="14"
          rx="3"
          fill="var(--sector)"
          opacity=".55"
        />
        <path
          d={`M274 ${r.y}v14`}
          stroke="currentColor"
          strokeWidth="2"
          opacity=".45"
          strokeLinecap="round"
        />
      </g>
    ))}
  </SceneFrame>
);

// Капиталовите програми — a partial map: a few municipalities filled, the rest
// outlined. Coverage IS this page's headline.
const MuniCapital: FC = () => (
  <SceneFrame>
    {Array.from({ length: 15 }, (_, i) => {
      const x = 154 + (i % 5) * 26;
      const y = 30 + Math.floor(i / 5) * 26;
      const has = [2, 6, 11].includes(i);
      return (
        <path
          key={i}
          d={`M${x} ${y + 6}l6-6h8l6 6v8l-6 6h-8l-6-6z`}
          fill={has ? "var(--sector)" : "none"}
          opacity={has ? ".5" : "1"}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeOpacity={has ? ".5" : ".25"}
          strokeDasharray={has ? undefined : "2.5 2.5"}
        />
      );
    })}
  </SceneFrame>
);

export const BUDGET_SCENES: Record<string, FC> = {
  revenue: Revenue,
  spending: Spending,
  execution: Execution,
  functional: Functional,
  units: Units,
  explorer: Explorer,
  deviations: Deviations,
  investments: Investments,
  law: Law,
  personnel: Personnel,
  funds: Funds,
  municipal: Municipal,
  muniInvestments: MuniInvestments,
  muniCapital: MuniCapital,
};
