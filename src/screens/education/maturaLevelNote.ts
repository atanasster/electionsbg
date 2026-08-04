// What to say under the ДЗИ БЕЛ average on /school/:id.
//
// The line used to be one ternary: "сред най-добрите" at pct >= 99, otherwise
// "По-добре от {pct}% от училищата". At the BOTTOM of the scale that produced
// "По-добре от 0% от училищата с матура по БЕЛ" — not a ranking but an artefact
// of counting schools STRICTLY BELOW a bounded scale's floor. Слаб 2 is that
// floor, so nothing can ever be below it and the number is 0 by construction.
//
// The floor also carries an exact fact the percentile buries: a mean of 2.00
// can only mean every examinee scored 2. That is arithmetic, not an inference
// from a small sample, so it holds at any cohort size — including the schools
// too small to be ranked at all. 16 schools landed here in 2026, 17 in 2025.

/** Слаб 2 — the minimum grade on the Bulgarian scale. */
export const MATURA_FLOOR = 2;

export type MaturaLevelNote =
  /** Mean is at the floor: every examinee failed. */
  | { kind: "floor"; n: number | null }
  | { kind: "top" }
  | { kind: "bottom" }
  | { kind: "percentile"; pct: number }
  /** Too few examinees to rank — the average is noise. */
  | { kind: "smallCohort"; n: number | null }
  | null;

/**
 * `pct` is the school's percentile among rankable schools, or null when the
 * cohort is under the ranking floor. The floor verdict is independent of both.
 */
export const maturaLevelNote = (
  score: number | null,
  n: number | null,
  pct: number | null,
): { floor: MaturaLevelNote; rank: MaturaLevelNote } => {
  if (score == null) return { floor: null, rank: null };
  const floor: MaturaLevelNote =
    score <= MATURA_FLOOR ? { kind: "floor", n } : null;
  const rank: MaturaLevelNote =
    pct == null
      ? { kind: "smallCohort", n }
      : pct >= 99
        ? { kind: "top" }
        : pct <= 1
          ? { kind: "bottom" }
          : { kind: "percentile", pct };
  return { floor, rank };
};

export const maturaLevelNoteText = (
  note: MaturaLevelNote,
  bg: boolean,
): string | null => {
  if (!note) return null;
  switch (note.kind) {
    case "floor":
      return bg
        ? `Всички ${note.n ?? "?"} зрелостници са с оценка Слаб 2 — никой не е издържал матурата по БЕЛ на сесия май–юни. Поправителна сесия август–септември не се отразява в тези данни.`
        : `All ${note.n ?? "?"} graduates scored a failing 2 — none passed the Bulgarian matura in the May–June session. The August–September retake is not covered by this data.`;
    case "top":
      return bg
        ? "Сред най-добрите в страната по успех на матурата по БЕЛ."
        : "Among the country's top schools on the Bulgarian-language matura.";
    case "bottom":
      return bg
        ? "Сред най-ниските в страната по успех на матурата по БЕЛ."
        : "Among the country's lowest schools on the Bulgarian-language matura.";
    case "percentile":
      return bg
        ? `По-добре от ${note.pct}% от училищата с матура по БЕЛ.`
        : `Above ${note.pct}% of schools with a Bulgarian-language matura.`;
    case "smallCohort":
      return bg
        ? `Малка група (${note.n ?? "?"} зрелостници) — средният успех е несигурен и училището не се класира.`
        : `Small cohort (${note.n ?? "?"} graduates) — the average is noisy, so the school is not ranked.`;
  }
};
