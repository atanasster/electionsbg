// Single source of truth for the A–F procurement-risk-grade palette + the
// percentage formatter shared across the grade surfaces (EntityRiskGradeCard,
// RiskGradeLeaderboardTile, RiskBadges). Previously each surface kept its own
// grade→colour map, which had already drifted (card bg -950/30 vs chip -950/50).
//
// Band → palette: A/B green (low), C amber (mid), D orange, E/F red (high).

export type GradeTone = {
  /** Text colour for the score/letter. */
  text: string;
  /** Card border ring (with dark variant). */
  ring: string;
  /** Soft card background. */
  bg: string;
  /** Compact leaderboard chip (bg + text, with dark variant). */
  chip: string;
};

const green: GradeTone = {
  text: "text-emerald-700 dark:text-emerald-300",
  ring: "border-emerald-400 dark:border-emerald-800/60",
  bg: "bg-emerald-50 dark:bg-emerald-950/30",
  chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
};

export type RiskGradeLetter = "A" | "B" | "C" | "D" | "E" | "F";

export const GRADE_TONE: Record<RiskGradeLetter, GradeTone> = {
  A: green,
  B: green,
  C: {
    text: "text-amber-700 dark:text-amber-300",
    ring: "border-amber-400 dark:border-amber-800/60",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  },
  D: {
    text: "text-orange-700 dark:text-orange-300",
    ring: "border-orange-400 dark:border-orange-800/60",
    bg: "bg-orange-50 dark:bg-orange-950/30",
    chip: "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300",
  },
  E: {
    text: "text-red-700 dark:text-red-300",
    ring: "border-red-400 dark:border-red-800/60",
    bg: "bg-red-50 dark:bg-red-950/30",
    chip: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  },
  F: {
    text: "text-red-700 dark:text-red-300",
    ring: "border-red-400 dark:border-red-800/60",
    bg: "bg-red-50 dark:bg-red-950/30",
    chip: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  },
};

/** Share (0..1 fraction → "42%"), locale-aware, no decimals. Named `formatShare`
 *  (not `formatPct`) to avoid colliding with `@/data/utils`'s `formatPct`, which
 *  takes a 0–100 value + decimals. */
export const formatShare = (frac: number, lang: string): string => {
  // The nullable AwarderRiskTopRow shares (connectionShare/singleShare/…) are
  // prime NaN/undefined leaks — guard so a bad value renders "" not "NaN%".
  if (!Number.isFinite(frac)) return "";
  return new Intl.NumberFormat(lang.startsWith("bg") ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(frac);
};
