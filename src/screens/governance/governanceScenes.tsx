// Infographic vignettes for the top-level /governance hub tiles — the same
// drawing contract as sectorScenes.tsx (300×116 SceneFrame, ink = currentColor,
// accent = var(--sector), PAPER for under-ink fills). Each hints at what the
// sub-hub is about. Decorative — the frame is aria-hidden; the tile title labels.

/* eslint-disable react-refresh/only-export-components -- GOV_HUB_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { SceneFrame, PAPER, Bars, TrendLine, Donut } from "@/ux/infographic";

// Бюджет — a coin over rising spend bars.
const Budget: FC = () => (
  <SceneFrame>
    <Bars
      x={30}
      baseline={100}
      heights={[28, 44, 60, 52]}
      barWidth={16}
      gap={10}
    />
    <circle cx={240} cy={44} r={22} fill="var(--sector)" opacity=".85" />
    <text
      x={240}
      y={52}
      textAnchor="middle"
      fontSize="24"
      fontWeight="700"
      fill={PAPER}
    >
      €
    </text>
  </SceneFrame>
);

// Обществени поръчки — a contract sheet with signature lines + a stamp.
const Procurement: FC = () => (
  <SceneFrame>
    <rect
      x={92}
      y={20}
      width={116}
      height={80}
      rx={6}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="2"
    />
    <g stroke="var(--sector)" strokeWidth="3" strokeLinecap="round">
      <path d="M108 42 H176" opacity=".8" />
      <path d="M108 58 H176" opacity=".6" />
      <path d="M108 74 H150" opacity=".4" />
    </g>
    <circle
      cx={186}
      cy={80}
      r={16}
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3"
      opacity=".9"
    />
  </SceneFrame>
);

// Европейски средства — the EU ring of twelve stars.
const Funds: FC = () => (
  <SceneFrame>
    {Array.from({ length: 12 }).map((_, i) => {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      return (
        <circle
          key={i}
          cx={150 + Math.cos(a) * 42}
          cy={58 + Math.sin(a) * 42}
          r={5}
          fill="var(--sector)"
        />
      );
    })}
    <circle
      cx={150}
      cy={58}
      r={18}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      opacity=".5"
    />
  </SceneFrame>
);

// Държавни сектори — a grid of sector cells.
const Sectors: FC = () => (
  <SceneFrame>
    <g fill="var(--sector)">
      {Array.from({ length: 12 }).map((_, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        return (
          <rect
            key={i}
            x={96 + col * 30}
            y={26 + row * 26}
            width={22}
            height={18}
            rx={3}
            opacity={0.35 + 0.14 * ((i % 4) + 1)}
          />
        );
      })}
    </g>
  </SceneFrame>
);

// Парламент — a three-row hemicycle of seats.
const Parliament: FC = () => (
  <SceneFrame>
    {[0, 1, 2].flatMap((row) =>
      Array.from({ length: 9 }).map((_, i) => {
        const a = Math.PI * (i / 8);
        const r = 30 + row * 18;
        return (
          <circle
            key={`${row}-${i}`}
            cx={150 - Math.cos(a) * r}
            cy={104 - Math.sin(a) * r}
            r={4.5}
            fill="var(--sector)"
            opacity={0.45 + row * 0.2}
          />
        );
      }),
    )}
  </SceneFrame>
);

// Декларации — a small ownership network (a person node linked to assets).
const Declarations: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="2" opacity=".55">
      <path d="M150 58 L96 34 M150 58 L204 34 M150 58 L96 90 M150 58 L204 90" />
    </g>
    <circle cx={150} cy={58} r={13} fill="var(--sector)" />
    <g fill="var(--sector)" opacity=".85">
      <rect x={84} y={24} width={22} height={18} rx={3} />
      <rect x={194} y={24} width={22} height={18} rx={3} />
      <rect x={84} y={80} width={22} height={18} rx={3} />
      <rect x={194} y={80} width={22} height={18} rx={3} />
    </g>
  </SceneFrame>
);

// Показатели — a trend line rising over faint bars.
const Indicators: FC = () => (
  <SceneFrame>
    <Bars
      x={34}
      baseline={100}
      heights={[22, 30, 26, 40, 46, 58]}
      barWidth={12}
      gap={10}
      opacityRamp={false}
    />
    <g opacity=".9">
      <TrendLine
        points={[
          [40, 84],
          [96, 74],
          [150, 78],
          [204, 54],
          [262, 40],
        ]}
        arrow
      />
    </g>
  </SceneFrame>
);

// Национален преглед — a dashboard gauge beside compact bars.
const Overview: FC = () => (
  <SceneFrame>
    <Donut cx={92} cy={58} r={30} pct={0.68} thickness={11} />
    <Bars
      x={158}
      baseline={92}
      heights={[26, 40, 34, 52]}
      barWidth={16}
      gap={12}
    />
  </SceneFrame>
);

export const GOV_HUB_SCENES: Record<string, FC> = {
  budget: Budget,
  procurement: Procurement,
  funds: Funds,
  sectors: Sectors,
  parliament: Parliament,
  declarations: Declarations,
  indicators: Indicators,
  overview: Overview,
};
