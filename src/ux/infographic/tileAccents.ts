// Named accent palette for infographic tiles (see InfographicTile / SceneFrame).
//
// One hex per accent, each chosen to hold on BOTH grounds the app renders on —
// the cream light theme (#F1ECE0) and the navy dark theme (#0B1224). That means
// mid lightness (~48–58%) and moderate chroma: too dark and it vanishes on navy,
// too pale and it washes out on cream.
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
} as const;

export type TileAccent = (typeof TILE_ACCENTS)[keyof typeof TILE_ACCENTS];
