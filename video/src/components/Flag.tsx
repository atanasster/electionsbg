import React from "react";

/**
 * The six EU-compare flags, ported from `src/screens/components/euCompare/Flag.tsx`.
 *
 * PORTED RATHER THAN IMPORTED because `video/` sits outside the app's module graph
 * on purpose (no `@/*` alias, its own tsconfig), and the original pulls in `cn()`
 * and a `PeerGeo` type from `src/`. Wiring the alias through Remotion's bundler to
 * reuse ~60 lines of static geometry would trade the isolation for nothing.
 *
 * These are inline SVG, NOT emoji — which is the property that matters here. A 🇧🇬
 * flag emoji depends on the render host having an emoji font, and headless Chromium
 * frequently does not; it would render as tofu or as the bare letters "BG", silently.
 *
 * The geometry is deliberately simplified (6-star EU ring, schematic Croatian arms)
 * — it reads at chip size, which is all it has to do.
 */

export type PeerGeo = "BG" | "EU27_2020" | "RO" | "GR" | "HU" | "HR";

const Bulgaria = () => (
  <>
    <rect x="0" y="0" width="24" height="5.33" fill="#FFFFFF" />
    <rect x="0" y="5.33" width="24" height="5.34" fill="#00966E" />
    <rect x="0" y="10.67" width="24" height="5.33" fill="#D62612" />
  </>
);

const Eu = () => (
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
);

const Romania = () => (
  <>
    <rect x="0" y="0" width="8" height="16" fill="#002B7F" />
    <rect x="8" y="0" width="8" height="16" fill="#FCD116" />
    <rect x="16" y="0" width="8" height="16" fill="#CE1126" />
  </>
);

const Greece = () => (
  <>
    <rect x="0" y="0" width="24" height="16" fill="#FFFFFF" />
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
    <rect x="0" y="0" width="9" height="9" fill="#0D5EAF" />
    <rect x="3.7" y="0" width="1.6" height="9" fill="#FFFFFF" />
    <rect x="0" y="3.7" width="9" height="1.6" fill="#FFFFFF" />
    <rect x="0" y="8.9" width="24" height="1.78" fill="#0D5EAF" />
    <rect x="0" y="12.46" width="24" height="1.78" fill="#0D5EAF" />
  </>
);

const Hungary = () => (
  <>
    <rect x="0" y="0" width="24" height="5.33" fill="#CE2939" />
    <rect x="0" y="5.33" width="24" height="5.34" fill="#FFFFFF" />
    <rect x="0" y="10.67" width="24" height="5.33" fill="#477050" />
  </>
);

const Croatia = () => (
  <>
    <rect x="0" y="0" width="24" height="5.33" fill="#FF0000" />
    <rect x="0" y="5.33" width="24" height="5.34" fill="#FFFFFF" />
    <rect x="0" y="10.67" width="24" height="5.33" fill="#171796" />
    <rect x="10.5" y="4" width="3" height="3.5" fill="#FF0000" />
    <rect x="10.5" y="4" width="1.5" height="1.5" fill="#FFFFFF" />
    <rect x="12" y="5.5" width="1.5" height="1.5" fill="#FFFFFF" />
  </>
);

const RENDERERS: Record<PeerGeo, () => React.JSX.Element> = {
  BG: Bulgaria,
  EU27_2020: Eu,
  RO: Romania,
  GR: Greece,
  HU: Hungary,
  HR: Croatia,
};

export const Flag: React.FC<{ geo: PeerGeo; size?: number }> = ({
  geo,
  size = 32,
}) => {
  const Body = RENDERERS[geo];
  return (
    <svg
      viewBox="0 0 24 16"
      width={Math.round((size * 24) / 16)}
      height={size}
      style={{ flexShrink: 0, borderRadius: size * 0.06, display: "block" }}
    >
      <Body />
      <rect
        x="0.25"
        y="0.25"
        width="23.5"
        height="15.5"
        fill="none"
        stroke="rgba(0,0,0,0.15)"
        strokeWidth="0.5"
      />
    </svg>
  );
};
