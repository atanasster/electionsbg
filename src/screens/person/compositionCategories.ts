// The asset categories the portfolio-composition stack draws, in a fixed order so a band
// keeps its position and colour as the reader moves between people.
//
// This must stay EXACTLY 089's asset-category CHECK minus `debt`. Debt is a liability:
// stacking it with holdings would make the bands sum to something that is not the
// portfolio, and the trajectory chart already plots it as its own line. An UNLISTED
// category is the silent failure — it would contribute to the assets line above but to no
// band here, with nothing failing. PersonPortfolioComposition.test.tsx pins this list
// against the CHECK's vocabulary; declarations_schema.data.test.ts pins the CHECK itself.
//
// Lives in its own module so the component file exports only components (react-refresh).

export const COMPOSITION_CATEGORIES = [
  { key: "real_estate", color: "hsl(217 60% 50%)" },
  { key: "vehicle", color: "hsl(160 55% 42%)" },
  { key: "bank", color: "hsl(190 60% 45%)" },
  { key: "cash", color: "hsl(45 75% 50%)" },
  { key: "investment", color: "hsl(280 45% 55%)" },
  { key: "security", color: "hsl(330 50% 55%)" },
  { key: "receivable", color: "hsl(20 60% 55%)" },
] as const;
