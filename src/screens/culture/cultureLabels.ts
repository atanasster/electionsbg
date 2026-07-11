// Bilingual labels + fixed category colours for the culture-film disciplines.
// Colour follows the category id, never its rank (dataviz non-negotiable), so a
// discipline keeps the same swatch across every tile. HSL-token / Tailwind
// classes so both light and dark modes are covered.

import type { FilmDiscipline } from "@/data/culture/types";

export const DISCIPLINE_LABEL: Record<
  FilmDiscipline,
  { bg: string; en: string }
> = {
  feature: { bg: "Игрални филми", en: "Feature film" },
  documentary: { bg: "Документални филми", en: "Documentary" },
  animation: { bg: "Анимационни филми", en: "Animation" },
  other: { bg: "Други", en: "Other" },
};

export const disciplineLabel = (d: FilmDiscipline, lang: string): string =>
  lang === "bg" ? DISCIPLINE_LABEL[d].bg : DISCIPLINE_LABEL[d].en;

/** Fixed hue per discipline (fill class), assigned by id not by rank. */
export const DISCIPLINE_COLOR: Record<FilmDiscipline, string> = {
  feature: "bg-primary",
  documentary: "bg-sky-500",
  animation: "bg-violet-500",
  other: "bg-muted-foreground/50",
};

/** The fixed render order for legends / bars. */
export const DISCIPLINE_ORDER: FilmDiscipline[] = [
  "feature",
  "documentary",
  "animation",
  "other",
];
