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

// Правителства — a classic columned building (the executive / cabinets).
const Governments: FC = () => (
  <SceneFrame>
    <path d="M112 44 L150 24 L188 44 Z" fill="var(--sector)" opacity=".85" />
    <rect
      x={110}
      y={44}
      width={80}
      height={8}
      fill="var(--sector)"
      opacity=".7"
    />
    <g fill="currentColor" opacity=".55">
      {[116, 132, 148, 164, 176].map((x) => (
        <rect key={x} x={x} y={54} width={8} height={40} />
      ))}
    </g>
    <rect
      x={106}
      y={96}
      width={88}
      height={7}
      rx={2}
      fill="var(--sector)"
      opacity=".7"
    />
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

// ── Индикатори domain scenes (the Показатели cluster) ─────────────────────────

// Икономика — a rising trend line over faint bars (growth, inflation, income).
const IndEconomy: FC = () => (
  <SceneFrame>
    <Bars
      x={40}
      baseline={100}
      heights={[26, 34, 30, 44, 52, 64]}
      barWidth={12}
      gap={10}
    />
    <TrendLine
      points={[
        [46, 80],
        [104, 72],
        [150, 76],
        [206, 52],
        [264, 36],
      ]}
      arrow
    />
  </SceneFrame>
);

// Фискални — columns straddling a zero line: surplus above, deficit below.
const IndFiscal: FC = () => (
  <SceneFrame>
    <line
      x1={64}
      y1={58}
      x2={236}
      y2={58}
      stroke="currentColor"
      strokeWidth="2"
      opacity=".5"
    />
    <g fill="var(--sector)">
      <rect x={80} y={38} width={16} height={20} rx={2} opacity=".85" />
      <rect x={104} y={30} width={16} height={28} rx={2} opacity=".9" />
      <rect x={140} y={58} width={16} height={22} rx={2} opacity=".7" />
      <rect x={164} y={58} width={16} height={34} rx={2} opacity=".8" />
      <rect x={188} y={58} width={16} height={26} rx={2} opacity=".75" />
    </g>
  </SceneFrame>
);

// Бюджети по кабинети — spend bars beside a stack of euro coins.
const IndBudgets: FC = () => (
  <SceneFrame>
    <Bars
      x={38}
      baseline={100}
      heights={[34, 46, 40, 56]}
      barWidth={16}
      gap={12}
    />
    <g>
      {[0, 1, 2].map((i) => (
        <ellipse
          key={i}
          cx={230}
          cy={92 - i * 20}
          rx={26}
          ry={9}
          fill="var(--sector)"
          opacity={0.7 + i * 0.12}
        />
      ))}
      <text
        x={230}
        y={57}
        textAnchor="middle"
        fontSize="15"
        fontWeight="700"
        fill={PAPER}
      >
        €
      </text>
    </g>
  </SceneFrame>
);

// Управление — a quality/trust gauge with a check (CPI, WGI, институции).
const IndGovernance: FC = () => (
  <SceneFrame>
    <Donut cx={150} cy={58} r={30} pct={0.62} thickness={11} />
    <path
      d="M137 58 l9 9 l17 -19"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SceneFrame>
);

// Общество — a row of figures, opacity ramping (заетост, неравенство, бедност).
const IndSociety: FC = () => (
  <SceneFrame>
    <g fill="var(--sector)">
      {Array.from({ length: 5 }).map((_, i) => {
        const x = 78 + i * 38;
        return (
          <g key={i} opacity={0.42 + i * 0.12}>
            <circle cx={x} cy={42} r={10} />
            <rect x={x - 11} y={58} width={22} height={32} rx={11} />
          </g>
        );
      })}
    </g>
  </SceneFrame>
);

// Сравни — paired bars (BG accent vs EU ink) under a small star cluster.
const IndCompare: FC = () => (
  <SceneFrame>
    {[0, 1, 2].map((g) => {
      const x = 84 + g * 54;
      const bg = 30 + g * 8;
      const eu = 44 - g * 6;
      return (
        <g key={g}>
          <rect
            x={x}
            y={100 - bg}
            width={16}
            height={bg}
            rx={2}
            fill="var(--sector)"
          />
          <rect
            x={x + 20}
            y={100 - eu}
            width={16}
            height={eu}
            rx={2}
            fill="currentColor"
            opacity=".38"
          />
        </g>
      );
    })}
    <g fill="var(--sector)">
      {Array.from({ length: 5 }).map((_, i) => {
        const a = -Math.PI / 2 + (i - 2) * 0.55;
        return (
          <circle
            key={i}
            cx={252 + Math.cos(a) * 15}
            cy={28 + Math.sin(a) * 15}
            r={2.6}
          />
        );
      })}
    </g>
  </SceneFrame>
);

// Данъчен калкулатор — a pocket calculator with a euro readout + keypad.
const TaxCalculator: FC = () => (
  <SceneFrame>
    <rect
      x={112}
      y={16}
      width={76}
      height={84}
      rx={8}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="2"
    />
    <rect
      x={122}
      y={26}
      width={56}
      height={18}
      rx={3}
      fill="var(--sector)"
      opacity=".85"
    />
    <text
      x={150}
      y={40}
      textAnchor="middle"
      fontSize="13"
      fontWeight="700"
      fill={PAPER}
    >
      €
    </text>
    <g fill="currentColor" opacity=".5">
      {Array.from({ length: 9 }).map((_, i) => (
        <circle
          key={i}
          cx={128 + (i % 3) * 22}
          cy={58 + Math.floor(i / 3) * 16}
          r={4.5}
        />
      ))}
    </g>
  </SceneFrame>
);

// Бюджетен симулатор — three policy levers (sliders) set at different marks.
const Simulator: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".4">
      <path d="M70 40 H230" />
      <path d="M70 62 H230" />
      <path d="M70 84 H230" />
    </g>
    <g fill="var(--sector)">
      <circle cx={122} cy={40} r={9} />
      <circle cx={190} cy={62} r={9} />
      <circle cx={96} cy={84} r={9} />
    </g>
  </SceneFrame>
);

export const GOV_HUB_SCENES: Record<string, FC> = {
  budget: Budget,
  procurement: Procurement,
  funds: Funds,
  sectors: Sectors,
  tax_calculator: TaxCalculator,
  simulator: Simulator,
  parliament: Parliament,
  governments: Governments,
  declarations: Declarations,
  indicators: Indicators,
  overview: Overview,
  ind_economy: IndEconomy,
  ind_fiscal: IndFiscal,
  ind_budgets: IndBudgets,
  ind_governance: IndGovernance,
  ind_society: IndSociety,
  ind_compare: IndCompare,
};
