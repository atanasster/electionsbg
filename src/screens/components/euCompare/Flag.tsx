// Tiny inline SVG flag set for the EU compare dashboard. Six flags, each a
// 24×16 viewBox — enough to read at 12-16px in chips, legends, and bar
// labels. No external library; the whole set is ~60 lines so the cost is
// well under what a npm dep would add.
//
// EU27 is the European Union flag — a stylized 12-star ring on dark blue.
// We render six "+" stars to keep the SVG compact while staying recognizable.

import { FC } from "react";
import type { PeerGeo } from "@/data/macro/useMacroPeers";
import { cn } from "@/lib/utils";

type FlagProps = {
  geo: PeerGeo;
  /** Height in pixels; width auto-scales 3:2. Default 12. */
  size?: number;
  className?: string;
  title?: string;
};

const STROKE = "rgba(0,0,0,0.15)";

const Bulgaria: FC = () => (
  <>
    <rect x="0" y="0" width="24" height="5.33" fill="#FFFFFF" />
    <rect x="0" y="5.33" width="24" height="5.34" fill="#00966E" />
    <rect x="0" y="10.67" width="24" height="5.33" fill="#D62612" />
  </>
);

const Eu: FC = () => (
  <>
    <rect x="0" y="0" width="24" height="16" fill="#003399" />
    {/* simplified 6-star ring — enough to read as the EU flag at this size */}
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
);

const Romania: FC = () => (
  <>
    <rect x="0" y="0" width="8" height="16" fill="#002B7F" />
    <rect x="8" y="0" width="8" height="16" fill="#FCD116" />
    <rect x="16" y="0" width="8" height="16" fill="#CE1126" />
  </>
);

const Greece: FC = () => (
  <>
    <rect x="0" y="0" width="24" height="16" fill="#FFFFFF" />
    {/* 5 blue stripes alternating with 4 white, starting from y=1.78 */}
    {[1, 3, 5, 7].map((i) => (
      <rect
        key={i}
        x="0"
        y={i * 1.78}
        width="24"
        height="1.78"
        fill="#0D5EAF"
      />
    ))}
    {/* canton */}
    <rect x="0" y="0" width="9" height="9" fill="#0D5EAF" />
    {/* white cross */}
    <rect x="3.7" y="0" width="1.6" height="9" fill="#FFFFFF" />
    <rect x="0" y="3.7" width="9" height="1.6" fill="#FFFFFF" />
    {/* bottom stripes after canton ends */}
    <rect x="0" y="8.9" width="24" height="1.78" fill="#0D5EAF" />
    <rect x="0" y="12.46" width="24" height="1.78" fill="#0D5EAF" />
  </>
);

const Hungary: FC = () => (
  <>
    <rect x="0" y="0" width="24" height="5.33" fill="#CE2939" />
    <rect x="0" y="5.33" width="24" height="5.34" fill="#FFFFFF" />
    <rect x="0" y="10.67" width="24" height="5.33" fill="#477050" />
  </>
);

const Croatia: FC = () => (
  <>
    <rect x="0" y="0" width="24" height="5.33" fill="#FF0000" />
    <rect x="0" y="5.33" width="24" height="5.34" fill="#FFFFFF" />
    <rect x="0" y="10.67" width="24" height="5.33" fill="#171796" />
    {/* simplified coat-of-arms — a single red shield with two white checks
        on top, enough to read as Croatia at this size */}
    <rect x="10.5" y="4" width="3" height="3.5" fill="#FF0000" />
    <rect x="10.5" y="4" width="1.5" height="1.5" fill="#FFFFFF" />
    <rect x="12" y="5.5" width="1.5" height="1.5" fill="#FFFFFF" />
  </>
);

const RENDERERS: Record<PeerGeo, FC> = {
  BG: Bulgaria,
  EU27_2020: Eu,
  RO: Romania,
  GR: Greece,
  HU: Hungary,
  HR: Croatia,
};

export const Flag: FC<FlagProps> = ({ geo, size = 12, className, title }) => {
  const Body = RENDERERS[geo];
  const w = Math.round((size * 24) / 16);
  return (
    <svg
      viewBox="0 0 24 16"
      width={w}
      height={size}
      role="img"
      aria-label={title ?? geo}
      className={cn("inline-block rounded-[1px]", className)}
      style={{ flexShrink: 0 }}
    >
      <Body />
      <rect
        x="0.25"
        y="0.25"
        width="23.5"
        height="15.5"
        fill="none"
        stroke={STROKE}
        strokeWidth="0.5"
      />
    </svg>
  );
};
