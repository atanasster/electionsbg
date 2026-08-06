// Infographic vignettes for the /parliament (Народно събрание) hub tiles — the same
// drawing contract as governanceScenes.tsx / sectorScenes.tsx (300×116 SceneFrame, ink =
// currentColor, accent = var(--sector), PAPER for under-ink fills; see
// src/ux/infographic/README.md).
//
// One bespoke scene per tile, none reused from another hub. governanceScenes already has
// a connections mark and a persons mark, but they answer a different page's question —
// here the question is what each destination answers about the National Assembly.
//
// Dense marks stay on the RIGHT half and the TOP band: from H1 these tiles carry a
// `metric`, which InfographicTile overlays large at the banner's bottom-left.

/* eslint-disable react-refresh/only-export-components -- PARLIAMENT_SCENES is a lookup
   table of scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

// Гласувания — a roll-call tally: three agenda rows, each a segmented за/против/въздържал
// bar. The one mark on this hub that shows the SHAPE of a vote rather than a metaphor for
// one, which is the point: this tile fronts the records, not an analysis of them.
const Votes: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="2" opacity=".4" strokeLinecap="round">
      <path d="M34 30h96M34 50h74M34 70h88M34 90h60" />
    </g>
    {[
      { y: 30, yes: 62, no: 18, abstain: 10 },
      { y: 58, yes: 40, no: 38, abstain: 12 },
      { y: 86, yes: 74, no: 8, abstain: 8 },
    ].map((row) => (
      <g key={row.y} strokeWidth="9" strokeLinecap="round" fill="none">
        <path d={`M152 ${row.y}h${row.yes}`} stroke="var(--sector)" />
        <path
          d={`M${156 + row.yes} ${row.y}h${row.no}`}
          stroke="currentColor"
          opacity=".55"
        />
        <path
          d={`M${160 + row.yes + row.no} ${row.y}h${row.abstain}`}
          stroke="currentColor"
          opacity=".22"
        />
      </g>
    ))}
  </SceneFrame>
);

// Карта на гласуването — the UMAP: three loose clusters, the accent one pulled away, plus
// a hollow stray sitting between two of them. That stray is the cross-party voter the map
// exists to reveal, so it is drawn as an outline rather than a fill.
const Embedding: FC = () => {
  const clusters = [
    { cx: 208, cy: 34, n: 9, accent: true },
    { cx: 252, cy: 78, n: 8, accent: false },
    { cx: 164, cy: 80, n: 7, accent: false },
  ];
  return (
    <SceneFrame>
      {clusters.map((cluster, ci) => (
        <g key={ci}>
          <circle
            cx={cluster.cx}
            cy={cluster.cy}
            r={26}
            fill={cluster.accent ? "var(--sector)" : "currentColor"}
            opacity=".08"
          />
          {Array.from({ length: cluster.n }).map((_, i) => {
            const angle = (i / cluster.n) * Math.PI * 2 + ci;
            const radius = 6 + ((i * 7) % 15);
            return (
              <circle
                key={i}
                cx={+(cluster.cx + Math.cos(angle) * radius).toFixed(1)}
                cy={+(cluster.cy + Math.sin(angle) * radius * 0.8).toFixed(1)}
                r="3.2"
                fill={cluster.accent ? "var(--sector)" : "currentColor"}
                opacity={cluster.accent ? 0.9 : 0.5}
              />
            );
          })}
        </g>
      ))}
      <circle cx="206" cy="58" r="4.6" fill={PAPER} />
      <circle
        cx="206"
        cy="58"
        r="4.6"
        fill="none"
        stroke="var(--sector)"
        strokeWidth="2"
      />
      <g stroke="currentColor" strokeWidth="1.5" opacity=".3">
        <path d="M42 96h74M42 96V40" />
      </g>
    </SceneFrame>
  );
};

// Единство на групите — the chamber itself: five fanned ranks blocked by group, with ONE
// seat in the accent block drawn hollow. That single seat is the member voting against
// their own, which is exactly what cohesion measures — so the hemicycle earns its place on
// THIS tile rather than as a page hero, where it would be decoration drawn from a second
// dataset (the roster) at a different freshness from everything below it.
const Cohesion: FC = () => {
  const seats: { x: number; y: number; group: number }[] = [];
  for (let rank = 0; rank < 5; rank++) {
    const radius = 30 + rank * 13;
    const count = 11 + rank * 3;
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * (i / (count - 1));
      seats.push({
        x: +(212 - Math.cos(angle) * radius).toFixed(1),
        y: +(104 - Math.sin(angle) * radius).toFixed(1),
        group: Math.floor((i / count) * 3),
      });
    }
  }
  const rebel = seats.findIndex((s) => s.group === 1 && s.y < 70);
  return (
    <SceneFrame>
      {seats.map((seat, i) =>
        i === rebel ? (
          <g key={i}>
            <circle cx={seat.x} cy={seat.y} r="3.6" fill={PAPER} />
            <circle
              cx={seat.x}
              cy={seat.y}
              r="3.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </g>
        ) : (
          <circle
            key={i}
            cx={seat.x}
            cy={seat.y}
            r="3.1"
            fill={seat.group === 1 ? "var(--sector)" : "currentColor"}
            opacity={seat.group === 1 ? 0.95 : seat.group === 0 ? 0.42 : 0.26}
          />
        ),
      )}
      <path
        d="M198 108h28"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity=".5"
      />
    </SceneFrame>
  );
};

// Депутати — the roster: four seated figures in a rank, the accent one forward. Heads and
// shoulders only, because a full figure turns to mush at the mobile thumbnail size.
const Mps: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="1.5" opacity=".3">
      <path d="M36 40h80M36 56h62M36 72h80M36 88h48" />
    </g>
    {[
      { x: 160, scale: 0.82, accent: false },
      { x: 196, scale: 0.82, accent: false },
      { x: 232, scale: 1, accent: true },
      { x: 268, scale: 0.82, accent: false },
    ].map((person) => {
      const base = 104;
      const radius = 9 * person.scale;
      return (
        <g
          key={person.x}
          fill={person.accent ? "var(--sector)" : "currentColor"}
          opacity={person.accent ? 0.95 : 0.4}
        >
          <circle
            cx={person.x}
            cy={base - 34 * person.scale}
            r={+radius.toFixed(1)}
          />
          <path
            d={`M${person.x - 15 * person.scale} ${base} a ${15 * person.scale} ${17 * person.scale} 0 0 1 ${30 * person.scale} 0 z`}
          />
        </g>
      );
    })}
  </SceneFrame>
);

// Присъствие — the attendance register: a grid of seats, filled = present, hollow =
// absent, with the absences clustering to the right the way a register actually reads once
// a sitting thins out.
const Attendance: FC = () => {
  const cols = 9;
  const rows = 4;
  const cells: { x: number; y: number; present: boolean }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      cells.push({
        x: 148 + c * 16,
        y: 30 + r * 20,
        present: !(c >= cols - 2 && (i % 3 === 0 || c === cols - 1)),
      });
    }
  }
  return (
    <SceneFrame>
      <path
        d="M132 20v78"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity=".3"
      />
      {cells.map((cell, i) =>
        cell.present ? (
          <circle
            key={i}
            cx={cell.x}
            cy={cell.y}
            r="5"
            fill="var(--sector)"
            opacity=".85"
          />
        ) : (
          <circle
            key={i}
            cx={cell.x}
            cy={cell.y}
            r="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            opacity=".45"
          />
        ),
      )}
    </SceneFrame>
  );
};

// Сходство между депутати — two voting records laid side by side with the matching rows
// bridged. The bridges ARE the score, drawn rather than stated.
const Similarity: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="1.5" opacity=".3">
      <path d="M40 34h70M40 58h54M40 82h70" />
    </g>
    {[
      { y: 26, match: true },
      { y: 44, match: true },
      { y: 62, match: false },
      { y: 80, match: true },
      { y: 98, match: true },
    ].map((row) => (
      <g key={row.y}>
        <rect
          x={158}
          y={row.y - 5}
          width={26}
          height={10}
          rx={3}
          fill={row.match ? "var(--sector)" : "currentColor"}
          opacity={row.match ? 0.9 : 0.35}
        />
        <rect
          x={248}
          y={row.y - 5}
          width={26}
          height={10}
          rx={3}
          fill={row.match ? "var(--sector)" : "currentColor"}
          opacity={row.match ? 0.9 : 0.35}
        />
        {row.match ? (
          <path
            d={`M186 ${row.y}h60`}
            stroke="var(--sector)"
            strokeWidth="1.8"
            opacity=".55"
          />
        ) : (
          <path
            d={`M186 ${row.y}h20M226 ${row.y}h20`}
            stroke="currentColor"
            strokeWidth="1.8"
            opacity=".25"
          />
        )}
      </g>
    ))}
  </SceneFrame>
);

// Двама депутати един срещу друг — diverging bars either side of a shared axis: the same
// items, two members, votes thrown to opposite sides. The rows where both lean the same
// way are the short ones.
const Pair: FC = () => {
  const axis = 216;
  return (
    <SceneFrame>
      <g stroke="currentColor" strokeWidth="1.5" opacity=".28">
        <path d="M36 44h62M36 66h44" />
      </g>
      {[
        { y: 26, left: 44, right: 12 },
        { y: 44, left: 10, right: 50 },
        { y: 62, left: 52, right: 8 },
        { y: 80, left: 16, right: 40 },
        { y: 98, left: 38, right: 20 },
      ].map((row) => (
        <g key={row.y}>
          <rect
            x={axis - row.left}
            y={row.y - 5}
            width={row.left}
            height={10}
            rx={3}
            fill="var(--sector)"
            opacity=".85"
          />
          <rect
            x={axis + 2}
            y={row.y - 5}
            width={row.right}
            height={10}
            rx={3}
            fill="currentColor"
            opacity=".45"
          />
        </g>
      ))}
      <path
        d={`M${axis} 16v88`}
        stroke="currentColor"
        strokeWidth="2"
        opacity=".55"
      />
    </SceneFrame>
  );
};

// Декларации — a filed declaration: paper under ruled ink with an accent stamp across the
// corner. PAPER rather than white so the sheet reads on both the cream and navy grounds.
const Declarations: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="1.5" opacity=".28">
      <path d="M40 40h72M40 58h54" />
    </g>
    <rect
      x={150}
      y={16}
      width={96}
      height={88}
      rx={5}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="2"
    />
    <g stroke="currentColor" strokeWidth="2" opacity=".4" strokeLinecap="round">
      <path d="M162 34h56M162 48h72M162 62h48M162 76h66" />
    </g>
    <circle
      cx={252}
      cy={84}
      r={19}
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3"
    />
    <path
      d="M243 84l6 7 13-15"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SceneFrame>
);

// Имущество — declared property: a house in ink beside a coin stack in accent. The two
// asset classes that actually dominate the filings, so the mark is a summary rather than
// a generic "money" icon.
const Assets: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="1.5" opacity=".28">
      <path d="M38 44h66M38 62h48" />
    </g>
    <path
      d="M154 62l30-24 30 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <rect
      x={162}
      y={62}
      width={44}
      height={40}
      rx={3}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="2.5"
    />
    <rect
      x={176}
      y={78}
      width={16}
      height={24}
      rx={2}
      fill="currentColor"
      opacity=".35"
    />
    {[0, 1, 2, 3].map((i) => (
      <ellipse
        key={i}
        cx={252}
        cy={96 - i * 13}
        rx={22}
        ry={7}
        fill="var(--sector)"
        opacity={0.45 + i * 0.16}
      />
    ))}
  </SceneFrame>
);

// Фирми — the company block, one storey lit in accent. Deliberately NOT an org chart:
// this tile is about ownership, not corporate structure.
const Companies: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="1.5" opacity=".28">
      <path d="M38 48h70M38 66h50" />
    </g>
    <rect
      x={158}
      y={20}
      width={62}
      height={84}
      rx={4}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="2.5"
    />
    {[0, 1, 2, 3].map((row) =>
      [0, 1, 2].map((col) => (
        <rect
          key={`${row}-${col}`}
          x={168 + col * 16}
          y={30 + row * 18}
          width={10}
          height={11}
          rx={1.5}
          fill={row === 1 ? "var(--sector)" : "currentColor"}
          opacity={row === 1 ? 0.9 : 0.3}
        />
      )),
    )}
    <rect
      x={230}
      y={54}
      width={44}
      height={50}
      rx={4}
      fill="var(--sector)"
      opacity=".22"
    />
    <rect
      x={230}
      y={54}
      width={44}
      height={50}
      rx={4}
      fill="none"
      stroke="var(--sector)"
      strokeWidth="2.5"
    />
  </SceneFrame>
);

// Свързани лица — the ego graph: one MP node in accent, company nodes around it, and two
// edges running off-frame to say the graph does not stop at this page.
const Connections: FC = () => {
  const hub = { x: 210, y: 58 };
  const nodes = [
    { x: 164, y: 30, r: 6 },
    { x: 258, y: 26, r: 7 },
    { x: 270, y: 74, r: 6 },
    { x: 176, y: 92, r: 7 },
    { x: 232, y: 98, r: 5 },
  ];
  return (
    <SceneFrame>
      <g stroke="currentColor" strokeWidth="1.5" opacity=".28">
        <path d="M34 40h58M34 58h42" />
      </g>
      <g stroke="currentColor" strokeWidth="1.8" opacity=".4" fill="none">
        {nodes.map((node, i) => (
          <path key={i} d={`M${hub.x} ${hub.y}L${node.x} ${node.y}`} />
        ))}
        <path d="M258 26L296 12" opacity=".25" />
        <path d="M176 92L142 108" opacity=".25" />
      </g>
      {nodes.map((node, i) => (
        <circle
          key={i}
          cx={node.x}
          cy={node.y}
          r={node.r}
          fill="currentColor"
          opacity=".45"
        />
      ))}
      <circle cx={hub.x} cy={hub.y} r={15} fill="var(--sector)" opacity=".2" />
      <circle cx={hub.x} cy={hub.y} r={10} fill="var(--sector)" />
    </SceneFrame>
  );
};

export const PARLIAMENT_SCENES: Record<string, FC> = {
  votes: Votes,
  embedding: Embedding,
  cohesion: Cohesion,
  mps: Mps,
  attendance: Attendance,
  similarity: Similarity,
  pair: Pair,
  declarations: Declarations,
  assets: Assets,
  companies: Companies,
  connections: Connections,
};
