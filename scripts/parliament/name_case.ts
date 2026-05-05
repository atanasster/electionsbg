/**
 * Title-case a Bulgarian person/MP name.
 *
 * Bulgarian source data (parliament.bg) stores names ALL UPPERCASE; election
 * results data (cik.bg → candidates.json) uses Title-case. The site mixes
 * both, which produces inconsistent display when the same person is shown on
 * the connections graph (uppercase) and the candidate page (title-case).
 *
 * This helper normalizes to Title-case while preserving compound surnames
 * such as "БЪЧВАРОВА-ПИРАЛКОВА" → "Бъчварова-Пиралкова" and double-given
 * names like "ИВАН-АСЕН" → "Иван-Асен".
 *
 * The matching key (`normalizedName` everywhere in the pipeline) stays
 * uppercase — only the display name is title-cased.
 */
export const titleCaseBgName = (s: string): string =>
  s
    .toLocaleLowerCase("bg-BG")
    .replace(
      /(^|[\s\-'"`])(\p{L})/gu,
      (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase("bg-BG"),
    );
