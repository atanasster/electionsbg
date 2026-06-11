// Tiny inline EU flags (3:2, rendered ~15×10) for the comparator popovers.
// Hand-drawn primitives — no dependency, no runtime fetches, ~constant cost
// per flag. Small-size simplifications: Spain is the civil flag (no crest),
// Slovakia carries a reduced shield (without it the tricolor reads as
// Russia's flag), Greece's cross-and-stripes are coarse.

import { FC, ReactNode } from "react";

const h3 = (a: string, b: string, c: string): ReactNode => (
  <>
    <rect width="3" height="0.667" fill={a} />
    <rect y="0.667" width="3" height="0.667" fill={b} />
    <rect y="1.333" width="3" height="0.667" fill={c} />
  </>
);
const v3 = (a: string, b: string, c: string): ReactNode => (
  <>
    <rect width="1" height="2" fill={a} />
    <rect x="1" width="1" height="2" fill={b} />
    <rect x="2" width="1" height="2" fill={c} />
  </>
);
const nordicCross = (field: string, cross: string): ReactNode => (
  <>
    <rect width="3" height="2" fill={field} />
    <rect x="0.78" width="0.34" height="2" fill={cross} />
    <rect y="0.83" width="3" height="0.34" fill={cross} />
  </>
);

const FLAGS: Record<string, ReactNode> = {
  HU: h3("#CE2939", "#FFFFFF", "#477050"),
  DK: nordicCross("#C8102E", "#FFFFFF"),
  GR: (
    <>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <rect
          key={i}
          y={(i * 2) / 9}
          width="3"
          height={2 / 9}
          fill={i % 2 === 0 ? "#0D5EAF" : "#FFFFFF"}
        />
      ))}
      <rect width="1.1" height="1.1" fill="#0D5EAF" />
      <rect x="0.44" width="0.22" height="1.1" fill="#FFFFFF" />
      <rect y="0.44" width="1.1" height="0.22" fill="#FFFFFF" />
    </>
  ),
  EE: h3("#0072CE", "#000000", "#FFFFFF"),
  IE: v3("#169B62", "#FFFFFF", "#FF883E"),
  DE: h3("#000000", "#DD0000", "#FFCE00"),
  LU: h3("#EF3340", "#FFFFFF", "#00A3E0"),
  ES: (
    <>
      <rect width="3" height="0.5" fill="#AA151B" />
      <rect y="0.5" width="3" height="1" fill="#F1BF00" />
      <rect y="1.5" width="3" height="0.5" fill="#AA151B" />
    </>
  ),
  BE: v3("#000000", "#FDDA24", "#EF3340"),
  SK: (
    <>
      {h3("#FFFFFF", "#0B4EA2", "#EE1C25")}
      <path
        d="M0.55 0.55 h0.7 v0.6 q0 0.35 -0.35 0.5 q-0.35 -0.15 -0.35 -0.5 z"
        fill="#EE1C25"
        stroke="#FFFFFF"
        strokeWidth="0.08"
      />
      <path
        d="M0.84 0.65 h0.12 v0.75 h-0.12 z M0.68 0.78 h0.44 v0.1 h-0.44 z M0.65 0.97 h0.5 v0.1 h-0.5 z"
        fill="#FFFFFF"
      />
    </>
  ),
  CZ: (
    <>
      <rect width="3" height="1" fill="#FFFFFF" />
      <rect y="1" width="3" height="1" fill="#D7141A" />
      <path d="M0 0 L1.3 1 L0 2 z" fill="#11457E" />
    </>
  ),
  FR: v3("#0055A4", "#FFFFFF", "#EF4135"),
  PL: (
    <>
      <rect width="3" height="1" fill="#FFFFFF" />
      <rect y="1" width="3" height="1" fill="#DC143C" />
    </>
  ),
  LT: h3("#FDB913", "#006A44", "#C1272D"),
  IT: v3("#008C45", "#FFFFFF", "#CD212A"),
  SE: nordicCross("#006AA7", "#FECC02"),
};

export const EuFlag: FC<{ cc: string; className?: string }> = ({
  cc,
  className,
}) => (
  <svg
    viewBox="0 0 3 2"
    aria-hidden="true"
    className={
      "h-[10px] w-[15px] shrink-0 rounded-[1.5px] ring-1 ring-border/70 " +
      (className ?? "")
    }
  >
    {FLAGS[cc] ?? <rect width="3" height="2" fill="#cbd5e1" />}
  </svg>
);
