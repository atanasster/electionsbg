// Infographic vignettes for the /sector/health hub tiles — the drawing contract
// of eduScenes.tsx (300×116 SceneFrame, ink = currentColor, accent =
// var(--sector), PAPER for under-ink fills). One scene per tile, keyed by the
// tile id in healthRegistry.ts.
//
// DENSE MARKS STAY OUT OF THE BOTTOM-LEFT: the tile's metric is overlaid there.
// `healthScenes.test.tsx` fails any `var(--sector)`-filled mark overlapping
// x < 132 AND y > 72.

/* eslint-disable react-refresh/only-export-components -- HEALTH_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { type FC } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

const ACCENT = "var(--sector)";

// A cross — the shared hospital mark.
const Cross: FC<{ cx: number; cy: number; s: number; opacity?: number }> = ({
  cx,
  cy,
  s,
  opacity = 1,
}) => (
  <>
    <rect
      x={cx - s / 6}
      y={cy - s / 2}
      width={s / 3}
      height={s}
      fill={ACCENT}
      opacity={opacity}
    />
    <rect
      x={cx - s / 2}
      y={cy - s / 6}
      width={s}
      height={s / 3}
      fill={ACCENT}
      opacity={opacity}
    />
  </>
);

// Картата — an outline and pins of different sizes.
const MapScene: FC = () => (
  <SceneFrame>
    <path
      d="M150 40 L176 22 L214 26 L248 16 L282 30 L276 62 L284 86 L240 94 L196 88 L160 92 L148 66 Z"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.2}
    />
    {[
      [176, 44, 7],
      [214, 58, 10],
      [250, 40, 6],
      [262, 74, 5],
      [192, 76, 4],
      [232, 30, 4],
    ].map(([cx, cy, r]) => (
      <circle
        key={`${cx}-${cy}`}
        cx={cx}
        cy={cy}
        r={r}
        fill={ACCENT}
        opacity={0.85}
      />
    ))}
  </SceneFrame>
);

// Плащанията — a hospital with coins flowing in.
const PaymentsScene: FC = () => (
  <SceneFrame>
    <rect
      x={200}
      y={30}
      width={72}
      height={60}
      rx={2}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.2}
    />
    <Cross cx={236} cy={56} s={24} />
    {[0, 1, 2].map((i) => (
      <circle
        key={i}
        cx={150 + i * 16}
        cy={40 + i * 8}
        r={6}
        fill={ACCENT}
        opacity={0.5 + i * 0.15}
      />
    ))}
    <path d="M190 66 H198" stroke="currentColor" strokeWidth={1.2} />
    <path
      d="M196 62 L200 66 L196 70"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
    />
  </SceneFrame>
);

// Кой расте — bars, one shooting up, one falling.
const MomentumScene: FC = () => (
  <SceneFrame>
    {[30, 34, 28, 52, 20].map((h, i) => (
      <rect
        key={i}
        x={160 + i * 24}
        y={92 - h}
        width={14}
        height={h}
        rx={1}
        fill={i === 3 ? ACCENT : PAPER}
        stroke="currentColor"
        strokeWidth={0.8}
      />
    ))}
    <path d="M222 30 L250 14" stroke="currentColor" strokeWidth={1.4} />
    <path
      d="M244 13 L251 13 L249 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
    />
    <path d="M154 92 H282" stroke="currentColor" strokeWidth={1.4} />
  </SceneFrame>
);

// Държавни и частни — one split bar.
const OwnershipScene: FC = () => (
  <SceneFrame>
    <rect x={150} y={44} width={84} height={24} fill={ACCENT} opacity={0.9} />
    <rect x={234} y={44} width={22} height={24} fill={ACCENT} opacity={0.5} />
    <rect
      x={256}
      y={44}
      width={28}
      height={24}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1}
    />
    <path
      d="M150 78 V84 M234 78 V84 M256 78 V84 M284 78 V84"
      stroke="currentColor"
      strokeWidth={1}
    />
  </SceneFrame>
);

// Лекарствата — capsules.
const PharmacyScene: FC = () => (
  <SceneFrame>
    {[
      [160, 30, 0],
      [210, 48, 30],
      [182, 66, -20],
      [244, 26, 60],
      [250, 70, 10],
    ].map(([x, y, a], i) => (
      <g key={i} transform={`rotate(${a} ${x + 16} ${y + 6})`}>
        <rect
          x={x}
          y={y}
          width={32}
          height={12}
          rx={6}
          fill={PAPER}
          stroke="currentColor"
          strokeWidth={1}
        />
        <rect
          x={x}
          y={y}
          width={16}
          height={12}
          rx={6}
          fill={ACCENT}
          opacity={0.85}
        />
      </g>
    ))}
  </SceneFrame>
);

// По тримесечия — a stepped line.
const TrendScene: FC = () => (
  <SceneFrame>
    <path
      d="M152 80 H172 V72 H192 V68 H212 V56 H232 V58 H252 V40 H272 V30 H284"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
    />
    {[
      [212, 56],
      [252, 40],
      [272, 30],
    ].map(([cx, cy]) => (
      <circle key={cx} cx={cx} cy={cy} r={4} fill={ACCENT} />
    ))}
    <path
      d="M150 92 H284"
      stroke="currentColor"
      strokeWidth={1}
      opacity={0.5}
    />
  </SceneFrame>
);

// Над медианата — dots around a line, a few lifted above it.
const OverpayScene: FC = () => (
  <SceneFrame>
    <path
      d="M150 64 H284"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeDasharray="4 3"
    />
    {[
      [160, 70, false],
      [176, 60, false],
      [192, 68, false],
      [208, 30, true],
      [224, 66, false],
      [240, 58, false],
      [256, 22, true],
      [272, 62, false],
    ].map(([cx, cy, hi]) => (
      <circle
        key={String(cx)}
        cx={cx as number}
        cy={cy as number}
        r={hi ? 6 : 4}
        fill={hi ? ACCENT : PAPER}
        stroke="currentColor"
        strokeWidth={hi ? 0 : 1}
      />
    ))}
  </SceneFrame>
);

// Лекарствата в болниците — a drip.
const HospitalDrugsScene: FC = () => (
  <SceneFrame>
    <path
      d="M220 12 V100 M196 100 H244"
      stroke="currentColor"
      strokeWidth={1.4}
    />
    <path d="M200 16 H240" stroke="currentColor" strokeWidth={1.4} />
    <rect
      x={204}
      y={20}
      width={22}
      height={36}
      rx={5}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.1}
    />
    <rect
      x={206}
      y={34}
      width={18}
      height={20}
      rx={4}
      fill={ACCENT}
      opacity={0.8}
    />
    <path
      d="M215 56 V70 Q215 84 252 80"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
    />
    <circle cx={215} cy={64} r={2.5} fill={ACCENT} />
    <Cross cx={262} cy={40} s={18} opacity={0.7} />
  </SceneFrame>
);

// Поръчките по години — stacked columns.
const SpineScene: FC = () => (
  <SceneFrame>
    {[22, 30, 26, 44, 36, 52].map((h, i) => (
      <g key={i}>
        <rect
          x={150 + i * 22}
          y={92 - h}
          width={14}
          height={h}
          fill={ACCENT}
          opacity={0.75}
        />
        <rect
          x={150 + i * 22}
          y={92 - h - 10}
          width={14}
          height={10}
          fill={PAPER}
          stroke="currentColor"
          strokeWidth={0.8}
        />
      </g>
    ))}
    <path d="M146 92 H284" stroke="currentColor" strokeWidth={1.4} />
  </SceneFrame>
);

// Рамковите споразумения — a dashed ceiling over the spend actually drawn.
const FrameworksScene: FC = () => (
  <SceneFrame>
    <rect
      x={160}
      y={22}
      width={110}
      height={70}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeDasharray="5 4"
    />
    <rect x={160} y={62} width={110} height={30} fill={ACCENT} opacity={0.8} />
    <path d="M276 22 V92" stroke="currentColor" strokeWidth={1} />
    <path d="M272 22 H280 M272 92 H280" stroke="currentColor" strokeWidth={1} />
  </SceneFrame>
);

// Бюджетът на касата — a ledger: two columns of lines.
const BudgetScene: FC = () => (
  <SceneFrame>
    <rect
      x={170}
      y={16}
      width={100}
      height={84}
      rx={3}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.2}
    />
    <path
      d="M220 24 V92"
      stroke="currentColor"
      strokeWidth={0.8}
      opacity={0.6}
    />
    {[0, 1, 2, 3].map((i) => (
      <g key={i}>
        <rect
          x={178}
          y={28 + i * 16}
          width={34 - i * 5}
          height={6}
          fill={ACCENT}
          opacity={0.85}
        />
        <rect
          x={228}
          y={28 + i * 16}
          width={30 - i * 3}
          height={6}
          fill={ACCENT}
          opacity={0.45}
        />
      </g>
    ))}
  </SceneFrame>
);

// Еврофондове — a ring of stars around a cross.
const FundsScene: FC = () => (
  <SceneFrame>
    {Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return (
        <circle
          key={i}
          cx={Math.round((216 + Math.cos(a) * 38) * 10) / 10}
          cy={Math.round((56 + Math.sin(a) * 38) * 10) / 10}
          r={3.5}
          fill={ACCENT}
        />
      );
    })}
    <Cross cx={216} cy={56} s={22} opacity={0.6} />
  </SceneFrame>
);

export const HEALTH_SCENES: Record<string, FC> = {
  map: MapScene,
  payments: PaymentsScene,
  momentum: MomentumScene,
  ownership: OwnershipScene,
  pharmacy: PharmacyScene,
  trend: TrendScene,
  overpay: OverpayScene,
  "hospital-drugs": HospitalDrugsScene,
  spine: SpineScene,
  frameworks: FrameworksScene,
  "nzok-budget": BudgetScene,
  funds: FundsScene,
};
