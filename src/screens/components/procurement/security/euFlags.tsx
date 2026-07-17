// Tiny inline SVG flags for the sector "vs the EU" tiles (МВР public order GF03,
// social protection GF10, …). The shared euCompare Flag.tsx only covers the 6
// EU-compare-dashboard geos (BG/EU/RO/GR/HU/HR); these tiles also chart whichever
// member state ranks #1 on the relevant COFOG function, which is dynamic (Latvia on
// GF03, Finland on GF10 social spending). So we keep a small self-contained set here
// covering the fixed peers + the likely top spenders (Nordics, FR/AT/IT/DE), with a
// 2-letter code badge fallback for anything unmapped — the tile never breaks on a
// new #1 country.

import { FC } from "react";

// 24×16 viewBox; simplified (no coats of arms) — enough to read at ~14px.
const H = (bands: [string, number][]) => {
  let y = 0;
  return (
    <>
      {bands.map(([fill, h], i) => {
        const rect = (
          <rect key={i} x="0" y={y} width="24" height={h} fill={fill} />
        );
        y += h;
        return rect;
      })}
    </>
  );
};

const V = (bands: string[]) => (
  <>
    {bands.map((fill, i) => (
      <rect
        key={i}
        x={(24 / bands.length) * i}
        y="0"
        width={24 / bands.length}
        height="16"
        fill={fill}
      />
    ))}
  </>
);

const FLAGS: Record<string, FC> = {
  BG: () =>
    H([
      ["#FFFFFF", 5.33],
      ["#00966E", 5.34],
      ["#D62612", 5.33],
    ]),
  RO: () => V(["#002B7F", "#FCD116", "#CE1126"]),
  HR: () =>
    H([
      ["#FF0000", 5.33],
      ["#FFFFFF", 5.34],
      ["#171796", 5.33],
    ]),
  HU: () =>
    H([
      ["#CD2A3E", 5.33],
      ["#FFFFFF", 5.34],
      ["#436F4D", 5.33],
    ]),
  LV: () =>
    H([
      ["#9E3039", 6.4],
      ["#FFFFFF", 3.2],
      ["#9E3039", 6.4],
    ]),
  GR: () =>
    H([
      ["#0D5EAF", 3.2],
      ["#FFFFFF", 3.2],
      ["#0D5EAF", 3.2],
      ["#FFFFFF", 3.2],
      ["#0D5EAF", 3.2],
    ]),
  EE: () =>
    H([
      ["#0072CE", 5.33],
      ["#000000", 5.34],
      ["#FFFFFF", 5.33],
    ]),
  LT: () =>
    H([
      ["#FDB913", 5.33],
      ["#006A44", 5.34],
      ["#C1272D", 5.33],
    ]),
  PL: () =>
    H([
      ["#FFFFFF", 8],
      ["#DC143C", 8],
    ]),
  SI: () =>
    H([
      ["#FFFFFF", 5.33],
      ["#005CE6", 5.34],
      ["#ED1C24", 5.33],
    ]),
  CY: () => H([["#FFFFFF", 16]]),
  CZ: () =>
    H([
      ["#FFFFFF", 8],
      ["#D7141A", 8],
    ]),
  SK: () =>
    H([
      ["#FFFFFF", 5.33],
      ["#0B4EA2", 5.34],
      ["#EE1C25", 5.33],
    ]),
  // Nordic-cross flags (white/red field + an off-centre cross toward the hoist).
  FI: () => (
    <>
      <rect x="0" y="0" width="24" height="16" fill="#FFFFFF" />
      <rect x="0" y="6.25" width="24" height="3.5" fill="#003580" />
      <rect x="6" y="0" width="3.5" height="16" fill="#003580" />
    </>
  ),
  DK: () => (
    <>
      <rect x="0" y="0" width="24" height="16" fill="#C8102E" />
      <rect x="0" y="6.25" width="24" height="3.5" fill="#FFFFFF" />
      <rect x="6" y="0" width="3.5" height="16" fill="#FFFFFF" />
    </>
  ),
  FR: () => V(["#002395", "#FFFFFF", "#ED2939"]),
  IT: () => V(["#008C45", "#F4F5F0", "#CD212A"]),
  AT: () =>
    H([
      ["#ED2939", 5.33],
      ["#FFFFFF", 5.34],
      ["#ED2939", 5.33],
    ]),
  DE: () =>
    H([
      ["#000000", 5.33],
      ["#DD0000", 5.34],
      ["#FFCE00", 5.33],
    ]),
  EU27_2020: () => (
    <>
      <rect x="0" y="0" width="24" height="16" fill="#003399" />
      {[
        [12, 3],
        [18.5, 6],
        [18.5, 10],
        [12, 13],
        [5.5, 10],
        [5.5, 6],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="0.9" fill="#FFCC00" />
      ))}
    </>
  ),
};

export const EuFlag: FC<{ geo: string; size?: number; title?: string }> = ({
  geo,
  size = 12,
  title,
}) => {
  const Body = FLAGS[geo];
  if (!Body) {
    // Unmapped geo → a neutral 2-letter code badge, so a future #1 country
    // still renders something legible.
    return (
      <span
        title={title ?? geo}
        className="inline-flex items-center justify-center rounded-[2px] border bg-muted px-1 text-[8px] font-semibold leading-none text-muted-foreground"
        style={{ height: size, minWidth: size * 1.5 }}
      >
        {geo.slice(0, 2)}
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 24 16"
      width={size * 1.5}
      height={size}
      className="shrink-0 rounded-[2px]"
      style={{ boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)" }}
      role="img"
      aria-label={title ?? geo}
    >
      <Body />
    </svg>
  );
};
