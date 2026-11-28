// The health NAME matcher — the candidate finder the register sweep runs over
// contracts and tenders (scripts/db/tests/health_register.data.test.ts).
// One module, imported by every consumer (sector-dashboard §2
// rule 1).
//
// It finds the populations a NAME identifies: НЗОК and МЗ themselves, the ЦСМП,
// РЗИ (and their РИОКОЗ / ХЕИ predecessors), НЦОЗА and every other „здрав…"
// body — and, deliberately, the лечебни заведения too (hospitals, ДКЦ, centres
// for mental health, medical centres). Those are NOT sector members; they are
// the EXCLUDED class (`HEALTH_EXCLUDED`), and the sweep subtracts them by that
// class. Finding them here is what lets the gate notice when the class stops
// covering a renamed family — the 2026-11-21 sweep found ~40 ДКЦ and „Център за
// психично здраве" ЕООД (the old dispensaries, renamed) outside it.
//
// The stems, and what each was checked against (§2 rule 2), measured 2026-11-21:
//   здрав(?!ец)  — „Здравец" is a kindergarten name (5 детски градини over
//                  €0.5M); HEALTH_NAME_GUARD removes it. Survives the singular:
//                  здраве / здравна / здравеопазване / здравноосигурителна.
//   спешна медицинска — the ЦСМП spell their family out; „медицинска" alone
//                  would catch every medical university.
//   \mРЗИ\M      — anchored: three letters inside a word otherwise.

/** Postgres ARE (case-insensitive `~*`). `\m`/`\M` are word boundaries. */
export const HEALTH_NAME_PATTERN = [
  "здрав",
  "\\mЦСМП\\M",
  "спешна медицинска",
  "\\mРЗИ\\M",
  "РИОКОЗ",
  "хигиенно[- ]*епидемиолог",
  "медицински център",
  "лечебн",
  "диагностично[- ]*консултативен",
  "\\mДКЦ\\M",
].join("|");

/** A POPULATION removed by rule: kindergartens named „Здравец". */
export const HEALTH_NAME_GUARD = "здравец";

/** `col` matches a health-like name and is not a „Здравец" namesake. */
export const healthNameSql = (col: string, guard = true): string =>
  guard
    ? `(${col} ~* '${HEALTH_NAME_PATTERN}' AND ${col} !~* '${HEALTH_NAME_GUARD}')`
    : `(${col} ~* '${HEALTH_NAME_PATTERN}')`;
