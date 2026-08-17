// Named accent palette for infographic tiles (see InfographicTile / SceneFrame).
//
// One hex per accent, each chosen to hold on BOTH grounds the app renders on —
// the cream light theme (#F1ECE0) and the navy dark theme (#0B1224). In
// practice that means mid lightness and moderate chroma: too dark and it
// vanishes on navy, too pale and it washes out on cream. The tokens actually
// span ~38–56% — the „~48–58%" this note used to claim is met by only 5 of 21,
// so treat it as a direction rather than a rule and eyeball a new one.
//
// These are the ONLY place a raw hex should live. Tiles reference a token
// (`TILE_ACCENTS.teal`), never a literal. The tile then derives its text, badge
// and CTA colours by mixing the accent toward the theme foreground
// (`color-mix(... hsl(var(--foreground)))`), so those stay legible as the theme
// flips — the accent is the constant, the neutral half does the adapting.
//
// Contrast note: the accent is used for decorative fills (banner tint, scene
// marks) and for text ONLY after the foreground-mix, which keeps the CTA/badge
// near the theme's own text colour. If you add an accent, eyeball it on both
// grounds (toggle the theme on /governance/sectors) before shipping.

export const TILE_ACCENTS = {
  clay: "#c9702f",
  teal: "#2f8fb0",
  steel: "#4a7a8f",
  amber: "#b07d2f",
  olive: "#9c8636",
  rose: "#c14b57",
  green: "#3a7a5e",
  emerald: "#43886a",
  brass: "#8a7734",
  azure: "#3f6a8a",
  indigo: "#7f85a3",
  moss: "#6e845d",
  plum: "#7a5a8f",
  gold: "#8a7a2a",
  terracotta: "#b5573f",
  copper: "#b85c26",
  aqua: "#1f9e94",
  slate: "#48587a",
  leaf: "#5a9e3d", // nature/environment (МОСВ) — a brighter yellow-green, distinct from
  // edu's `green` (#3a7a5e), defense's `moss` (#6e845d) and water's `teal`.
  iris: "#6f5a9c", // regional development (МРРБ) — a blue-violet. The infra cluster is
  // otherwise orange/cyan/green (clay, copper, teal, steel + МОСВ's `leaf`), and
  // regional sits directly BESIDE environment there, so a green reads as the same
  // tile at a glance — violet is the only clearly distinct hue left in that grid.
  // Distinct from justice's `plum` (#7a5a8f, pinker) and `indigo` (#7f85a3, greyer),
  // which live in other clusters.
  ochre: "#a8862b", // municipal councils — the 22nd token, minted because the
  // accountability cluster grew a tile and the governance hub had used all 21
  // (the gate in hubRegistry.test.ts requires one accent per tile per page).
  // A deep yellow-ochre. Its nearest neighbours are `gold` (#8a7a2a) and
  // `brass` (#8a7734), both of which sit in OTHER clusters on that page —
  // `amber` (#b07d2f) is the closest same-page hue at Δh ~7°, still wider than
  // green/emerald (0.2°) and olive/brass (0.3°) already shipping.
  wine: "#96455f", // municipal finances — the 21st token, minted because the money
  // cluster grew a 21st tile and the palette had exactly 20. A desaturated
  // red-violet. Its nearest neighbour in hue is `rose` (#c14b57) at Δh 13°,
  // which is far wider than pairs already shipping (green/emerald 0.2°,
  // olive/brass 0.3°); `plum` (#7a5a8f) is bluer again. All four clusters
  // render on ONE page — which is why the uniqueness gate exists — so
  // „different cluster" is not separation and the hue distance is what counts.
  // Note this is the second-lowest contrast on navy of the 21 (2.94:1); it
  // carries decorative fills only, never text before the foreground-mix.
} as const;

export type TileAccent = (typeof TILE_ACCENTS)[keyof typeof TILE_ACCENTS];
