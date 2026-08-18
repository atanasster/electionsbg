// Infographic vignettes for the /subsidies hub tiles — the same drawing contract as
// fundsScenes.tsx / governanceScenes.tsx (300×116 SceneFrame, ink = currentColor,
// accent = var(--sector), PAPER for under-ink fills; see src/ux/infographic/README.md).
//
// One bespoke scene per tile, none reused from another hub. The rule that makes these worth
// drawing at all: a scene shows the STRUCTURE its destination is about — the gap in the year
// row, the two overlapping registers, the three columns that must not be added — not a generic
// bar chart with a different accent. With the labels covered a reader should still be able to
// tell two tiles apart.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// DENSE ACCENT MARKS STAY OUT OF THE BOTTOM-LEFT. `InfographicTile` overlays a `metric` large
// at the banner's bottom-left behind a radial scrim (`72% 72% at 6% 100%`), and its own source
// calls that glow „a safety net, not a licence to draw behind the number". Anything solid drawn
// there is either hidden by the figure or fighting it.
//
// SAFE BOX, enforced by `subsidiesScenes.test.tsx`: no `var(--sector)`-FILLED mark may overlap
// x < 132 AND y > 72. Strokes and PAPER fills may — they sit under the scrim quietly. Every
// scene here therefore puts its saturated mass right of centre or above the midline, and the
// eight tiles that carry a metric (all of band 1 and 2, plus browse) were drawn to that rule
// from the start rather than retro-fitted: fundsScenes broke it in eight of ten because the
// metrics had not been wired yet, and nothing could see it.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/* eslint-disable react-refresh/only-export-components -- SUBSIDIES_SCENES is a lookup table of
   scene components, not a fast-refresh boundary. */
import { type FC, useId } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";
import { AGRI_FINANCIAL_YEARS } from "@/data/agri/constants";

// ── Band 1 ─────────────────────────────────────────────────────────────────────────────────

// Топ получатели — a ranked column, longest first. The mark IS the ranking, because that is
// what the page is: who received the most. Bars grow rightward from a fixed gutter so the
// accent mass sits right of the safe box.
const Recipients: FC = () => (
  <SceneFrame>
    {[
      { y: 16, w: 148 },
      { y: 36, w: 118 },
      { y: 56, w: 92 },
      { y: 76, w: 64 },
      { y: 96, w: 40 },
    ].map((r, i) => (
      <g key={r.y}>
        <rect
          x={136}
          y={r.y}
          width={r.w}
          height={11}
          rx={2}
          fill="var(--sector)"
          opacity={1 - i * 0.15}
        />
        {/* the label stub — ink, so it flips with the theme */}
        <rect
          x={104}
          y={r.y + 3}
          width={24}
          height={5}
          rx={2.5}
          fill="currentColor"
          opacity={0.35}
        />
      </g>
    ))}
  </SceneFrame>
);

// По схема — one envelope split into named measures. A SEGMENTED bar rather than a ranked
// column: the page's subject is how the whole divides, not who is biggest.
const Schemes: FC = () => {
  const seg = [
    { x: 136, w: 62 },
    { x: 200, w: 38 },
    { x: 240, w: 24 },
    { x: 266, w: 14 },
    { x: 282, w: 10 },
  ];
  return (
    <SceneFrame>
      {seg.map((s, i) => (
        <rect
          key={s.x}
          x={s.x}
          y={30}
          width={s.w}
          height={26}
          rx={2}
          fill="var(--sector)"
          opacity={1 - i * 0.16}
        />
      ))}
      {/* the same envelope again, split differently — a second financial year */}
      {[
        { x: 136, w: 44 },
        { x: 182, w: 46 },
        { x: 230, w: 30 },
        { x: 262, w: 18 },
        { x: 282, w: 10 },
      ].map((s, i) => (
        <rect
          key={`b${s.x}`}
          x={s.x}
          y={64}
          width={s.w}
          height={26}
          rx={2}
          fill="var(--sector)"
          opacity={0.75 - i * 0.12}
        />
      ))}
      <rect
        x={104}
        y={40}
        width={22}
        height={5}
        rx={2.5}
        fill="currentColor"
        opacity={0.35}
      />
      <rect
        x={104}
        y={74}
        width={22}
        height={5}
        rx={2.5}
        fill="currentColor"
        opacity={0.35}
      />
    </SceneFrame>
  );
};

// По област — a coarse map-ish lattice of regions at different intensities. Not a bar chart:
// the destination is a choropleth, and the scene should read as territory.
const Places: FC = () => {
  const cells = [
    [0.9, 0.35, 0.5, 0.7],
    [0.45, 1, 0.3, 0.55],
    [0.6, 0.4, 0.8, 0.25],
  ];
  return (
    <SceneFrame>
      {cells.map((row, r) =>
        row.map((v, c) => (
          <rect
            key={`${r}-${c}`}
            x={150 + c * 34}
            y={18 + r * 28}
            width={30}
            height={24}
            rx={3}
            fill="var(--sector)"
            opacity={v}
          />
        )),
      )}
      {/* a legend ramp in ink, left of the lattice and above the scrim */}
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={100}
          y={22 + i * 12}
          width={30}
          height={7}
          rx={2}
          fill="currentColor"
          opacity={0.15 + i * 0.14}
        />
      ))}
    </SceneFrame>
  );
};

// Непроследими получатели — rows that HAVE an identifier beside rows that do not. The dashed
// stubs are the whole subject: the register published a name and a province and no ЕИК, so
// those rows cannot be attributed to anyone.
const Untraceable: FC = () => (
  <SceneFrame>
    {[16, 36, 56, 76, 96].map((y, i) => {
      const known = i === 0 || i === 2;
      return (
        <g key={y}>
          {/* the identifier slot: solid when present, an empty outline when not */}
          {known ? (
            <rect
              x={140}
              y={y}
              width={34}
              height={11}
              rx={2}
              fill="var(--sector)"
            />
          ) : (
            <rect
              x={140}
              y={y}
              width={34}
              height={11}
              rx={2}
              fill={PAPER}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeDasharray="3 3"
            />
          )}
          {/* the money, which is there either way — that is the point */}
          <rect
            x={182}
            y={y}
            width={i % 2 ? 78 : 104}
            height={11}
            rx={2}
            fill="currentColor"
            opacity={0.22}
          />
        </g>
      );
    })}
  </SceneFrame>
);

// ── Band 2 ─────────────────────────────────────────────────────────────────────────────────

// Концентрация — a Lorenz curve, which is literally what the destination renders. The diagonal
// is equality; the gap between it and the curve is the finding.
const Concentration: FC = () => (
  <SceneFrame>
    {/* equality */}
    <line
      x1={140}
      y1={104}
      x2={288}
      y2={16}
      stroke="currentColor"
      strokeOpacity={0.3}
      strokeDasharray="4 4"
      strokeWidth={1.5}
    />
    {/* the actual distribution, bowed hard toward the bottom-right */}
    <path
      d="M140 104 C 200 102, 244 92, 268 62 C 280 46, 285 28, 288 16"
      fill="none"
      stroke="var(--sector)"
      strokeWidth={3}
      strokeLinecap="round"
    />
    {/* axes in ink */}
    <line
      x1={140}
      y1={104}
      x2={288}
      y2={104}
      stroke="currentColor"
      strokeOpacity={0.45}
      strokeWidth={1.5}
    />
    <line
      x1={140}
      y1={104}
      x2={140}
      y2={16}
      stroke="currentColor"
      strokeOpacity={0.45}
      strokeWidth={1.5}
    />
  </SceneFrame>
);

// Политически свързани — two registers overlapping. The intersection is the page: recipients
// that are ALSO a company or association where a public figure holds a recorded role.
const Political: FC = () => {
  const clip = useId();
  return (
    <SceneFrame>
      <defs>
        <clipPath id={clip}>
          <circle cx={238} cy={58} r={38} />
        </clipPath>
      </defs>
      <circle cx={186} cy={58} r={38} fill="currentColor" opacity={0.16} />
      <circle
        cx={186}
        cy={58}
        r={38}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.45}
        strokeWidth={1.5}
      />
      <circle
        cx={238}
        cy={58}
        r={38}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.45}
        strokeWidth={1.5}
      />
      {/* The intersection, as one circle CLIPPED by the other rather than a hand-written
          arc path. Three reasons, all found by review: an accent-filled <path> is invisible
          to the safe-box detector (so its position would be luck, not a gate); the hand-drawn
          lens overshot both circles by ~3px at every extreme, showing as tips poking out of
          the outlines; and an arc path's `A rx ry rot large sweep x y` parameters defeat any
          coarse x/y reader, which is what made the frame gate report this scene at y=212. A
          clip is exact, and both shapes are circles the detector understands. */}
      <circle
        cx={186}
        cy={58}
        r={38}
        fill="var(--sector)"
        opacity={0.9}
        clipPath={`url(#${clip})`}
      />
    </SceneFrame>
  );
};

// И по други програми — THREE separate columns, deliberately not stacked and not touching.
// The destination's central rule is that its three money columns are on different bases and
// are never summed; a stacked bar would draw the exact claim the page refuses to make.
const CrossProgramme: FC = () => (
  <SceneFrame>
    {[
      { x: 148, h: 62 },
      { x: 200, h: 44 },
      { x: 252, h: 30 },
    ].map((b, i) => (
      <g key={b.x}>
        <rect
          x={b.x}
          y={96 - b.h}
          width={34}
          height={b.h}
          rx={2}
          fill="var(--sector)"
          opacity={1 - i * 0.2}
        />
        {/* each column stands on its own baseline stub — no shared axis, because there is no
            shared basis */}
        <rect
          x={b.x}
          y={100}
          width={34}
          height={3}
          rx={1.5}
          fill="currentColor"
          opacity={0.4}
        />
      </g>
    ))}
  </SceneFrame>
);

// ── Band 3 ─────────────────────────────────────────────────────────────────────────────────

// Общински трансфери — one central envelope fanning out to many municipalities.
const Municipal: FC = () => (
  <SceneFrame>
    <rect
      x={136}
      y={44}
      width={26}
      height={28}
      rx={3}
      fill="currentColor"
      opacity={0.4}
    />
    {[14, 34, 54, 74, 94].map((y, i) => (
      <g key={y}>
        <path
          d={`M164 58 C 190 58, 196 ${y + 5}, 214 ${y + 5}`}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeWidth={1.5}
        />
        <rect
          x={216}
          y={y}
          width={62 - i * 6}
          height={10}
          rx={2}
          fill="var(--sector)"
          opacity={0.95 - i * 0.13}
        />
      </g>
    ))}
  </SceneFrame>
);

// Кой плаща за влака — a rail line with sleepers, and the subsidy stacked above it.
const Rail: FC = () => (
  <SceneFrame>
    {/* the two rails */}
    <line
      x1={136}
      y1={88}
      x2={292}
      y2={88}
      stroke="currentColor"
      strokeOpacity={0.5}
      strokeWidth={2}
    />
    <line
      x1={136}
      y1={98}
      x2={292}
      y2={98}
      stroke="currentColor"
      strokeOpacity={0.5}
      strokeWidth={2}
    />
    {[142, 164, 186, 208, 230, 252, 274].map((x) => (
      <line
        key={x}
        x1={x}
        y1={84}
        x2={x}
        y2={102}
        stroke="currentColor"
        strokeOpacity={0.28}
        strokeWidth={2}
      />
    ))}
    {/* what the state puts on top of the fare, rising year by year */}
    {[
      { x: 150, h: 24 },
      { x: 180, h: 32 },
      { x: 210, h: 40 },
      { x: 240, h: 50 },
      { x: 270, h: 60 },
    ].map((b, i) => (
      <rect
        key={b.x}
        x={b.x}
        y={72 - b.h}
        width={18}
        height={b.h}
        rx={2}
        fill="var(--sector)"
        opacity={0.6 + i * 0.1}
      />
    ))}
  </SceneFrame>
);

// Филмови субсидии — a strip of frames with perforations.
const Film: FC = () => (
  <SceneFrame>
    <rect
      x={136}
      y={26}
      width={156}
      height={64}
      rx={4}
      fill="currentColor"
      opacity={0.14}
    />
    {[0, 1, 2, 3].map((i) => (
      <rect
        key={i}
        x={146 + i * 38}
        y={40}
        width={30}
        height={36}
        rx={2}
        fill="var(--sector)"
        opacity={0.95 - i * 0.16}
      />
    ))}
    {/* sprocket holes, top and bottom */}
    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
      <g key={`s${i}`}>
        <rect
          x={142 + i * 19}
          y={30}
          width={8}
          height={5}
          rx={1}
          fill={PAPER}
        />
        <rect
          x={142 + i * 19}
          y={81}
          width={8}
          height={5}
          rx={1}
          fill={PAPER}
        />
      </g>
    ))}
  </SceneFrame>
);

// Партийни субсидии — votes converted to money at a fixed per-vote rate. The scene is the
// CONVERSION, because that is the whole of the ЗПП rule: valid party-list votes × €3.00.
const Party: FC = () => (
  <SceneFrame>
    {/* the ballot column */}
    {[22, 40, 58, 76].map((y) => (
      <rect
        key={y}
        x={140}
        y={y}
        width={40}
        height={12}
        rx={2}
        fill="currentColor"
        opacity={0.3}
      />
    ))}
    {/* the rate, as the arrow between them */}
    <path
      d="M188 58 L 214 58"
      stroke="currentColor"
      strokeOpacity={0.5}
      strokeWidth={2}
    />
    <path d="M208 52 L 216 58 L 208 64 Z" fill="currentColor" opacity={0.5} />
    {/* the envelope, sized by vote share */}
    {[
      { y: 20, w: 68 },
      { y: 40, w: 46 },
      { y: 60, w: 32 },
      { y: 80, w: 20 },
    ].map((b, i) => (
      <rect
        key={b.y}
        x={224}
        y={b.y}
        width={b.w}
        height={13}
        rx={2}
        fill="var(--sector)"
        opacity={1 - i * 0.18}
      />
    ))}
  </SceneFrame>
);

// ── Band 4 ─────────────────────────────────────────────────────────────────────────────────

// Всички плащания — a table. Header row in ink, body rows ruled, one accent column so it reads
// as data rather than as a paragraph.
const Browse: FC = () => (
  <SceneFrame>
    <rect
      x={136}
      y={16}
      width={156}
      height={12}
      rx={2}
      fill="currentColor"
      opacity={0.38}
    />
    {[34, 50, 66, 82, 98].map((y) => (
      <g key={y}>
        <rect
          x={136}
          y={y}
          width={70}
          height={9}
          rx={2}
          fill="currentColor"
          opacity={0.16}
        />
        <rect
          x={212}
          y={y}
          width={34}
          height={9}
          rx={2}
          fill="currentColor"
          opacity={0.16}
        />
        <rect
          x={252}
          y={y}
          width={40}
          height={9}
          rx={2}
          fill="var(--sector)"
          opacity={0.85}
        />
      </g>
    ))}
  </SceneFrame>
);

// Обхват и източници — the year row WITH ITS HOLES. This is the one scene that is a literal
// picture of its page: ДФЗ publishes 2015-2017 and 2021-2025, and 2014 plus 2018-2020 are
// simply absent. The gaps are drawn as empty outlines rather than omitted, because a missing
// year you cannot see is exactly the thing the page exists to make visible.
const Coverage: FC = () => {
  // DERIVED, not a hand-written 12-entry array. It is the same fact the tile's own metric
  // states, drawn instead of written, and a literal would go stale in the same place: the day
  // ДФЗ publishes 2026 the picture would still show twelve bars with four holes.
  const FIRST = 2014;
  const span = AGRI_FINANCIAL_YEARS[0] - FIRST + 1;
  const years = Array.from({ length: span }, (_, i) =>
    AGRI_FINANCIAL_YEARS.includes(FIRST + i),
  );
  // The bars fill a fixed 156px run whatever the span is, so a new year narrows the pitch
  // rather than running off the frame.
  const pitch = 156 / span;
  const w = Math.max(4, pitch - 4);
  return (
    <SceneFrame>
      {years.map((on, i) =>
        on ? (
          <rect
            key={i}
            x={140 + i * pitch}
            y={38}
            width={w}
            height={40}
            rx={2}
            fill="var(--sector)"
          />
        ) : (
          <rect
            key={i}
            x={140 + i * pitch}
            y={38}
            width={w}
            height={40}
            rx={2}
            fill={PAPER}
            stroke="currentColor"
            strokeOpacity={0.4}
            strokeDasharray="3 3"
          />
        ),
      )}
      <line
        x1={136}
        y1={86}
        x2={296}
        y2={86}
        stroke="currentColor"
        strokeOpacity={0.4}
        strokeWidth={1.5}
      />
    </SceneFrame>
  );
};

export const SUBSIDIES_SCENES: Record<string, FC> = {
  recipients: Recipients,
  schemes: Schemes,
  places: Places,
  untraceable: Untraceable,
  concentration: Concentration,
  political: Political,
  crossProgramme: CrossProgramme,
  municipal: Municipal,
  rail: Rail,
  film: Film,
  party: Party,
  browse: Browse,
  coverage: Coverage,
};
