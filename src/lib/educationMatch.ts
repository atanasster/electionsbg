// The education NAME matcher — the candidate finder the register sweep runs over
// contracts and tenders (scripts/db/tests/edu_register.data.test.ts).
// One module, imported by every consumer (sector-dashboard §2
// rule 1).
//
// WHAT IT CAN AND CANNOT FIND. It covers the populations a NAME identifies:
// universities and higher schools, academies, МОН itself, the ЦСОП / РЦПППО
// support centres and the two named МОН second-level units the D2 sweep found.
// It does NOT cover the БАН and ССА institutes — they are named plainly
// „Институт по …" (measured 2026-11-20: 8 of 47 БАН and 1 of 28 ССА bodies carry
// a БАН/академия marker in their awarder name), and „институт" alone would match
// the НСИ, the метрология institute and every other state institute. Those two
// universes are held by the curated register, not by this sweep.
//
// The stems, and what each was checked against (§2 rule 2):
//   академи[яи]  — NOT „академи": that is also „Академик …", a person's title in
//                  dozens of school names (2-ро СУ „Академик Емилиян Станев").
//   университет  — also „Университетска … болница", the teaching hospitals (health
//                  sector, €5bn+), which EDU_NAME_GUARD removes as a population.
//   приобщаващ\S* — РЦПППО names write both „приобщаващо" and „приобщаващото".

/** Postgres ARE (case-insensitive `~*`). `\m`/`\M` are word boundaries. */
export const EDU_NAME_PATTERN = [
  "университет",
  "висш[ае]\\s+.*училищ",
  "академи[яи]",
  "\\mБАН\\M",
  "министерство на образованието",
  "ЦСОП",
  "РЦПППО",
  "специална образователна подкрепа",
  "приобщаващ\\S* образование",
  "дворец на децата",
  "развитие на човешките ресурси",
  "колеж",
].join("|");

/** A POPULATION removed by rule, not by EIK: the university hospitals. */
export const EDU_NAME_GUARD = "болниц";

/** `col` matches an education-like name and is not a hospital. */
export const eduNameSql = (col: string, guard = true): string =>
  guard
    ? `(${col} ~* '${EDU_NAME_PATTERN}' AND ${col} !~* '${EDU_NAME_GUARD}')`
    : `(${col} ~* '${EDU_NAME_PATTERN}')`;
