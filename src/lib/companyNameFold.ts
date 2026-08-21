// Fold a DECLARED company name to a grouping key.
//
// A declarant retypes their holdings on every filing and spells them differently each time —
// „Отзвук ЕООД", „«Отзвук»", „ФИЛ - КОМЕРС ООД", „ФИЛ-КОМЕРС ООД". `consolidateStakes` groups a
// person's stakes across years to render one holding with a year range, so an unfolded key
// renders the same company two or three times, each holding a different subset of the years.
//
// ⚠️ THIS REPLACES A FIELD, NOT A GUESS. Until 2026-08-20 the grouping key preferred
// `MpOwnershipStake.companySlug` — a slug of the group's display name, stamped into the shards
// by a pipeline phase that read `companies-index.json`. Both are retired
// (docs/plans/company-page-consolidation-v1.md Tier 5.2), so the fold has to happen at read
// time. It is deliberately a REFINEMENT of what that field did rather than a fresh design:
// measured over all 18,569 stake rows, this key SPLITS **0** of the groups the slug produced
// and MERGES 538 — the slug was MP-only (6,114 of 18,569 rows were ever stamped), so the same
// holding grouped under a slug in one filing and a bare name in another.
//
// The rule is `normalizeCompanyName` from the deleted `build_company_index.ts`, plus one
// addition. Each clause earns its place:
//
//   quotes      — „«Отзвук»" and „Отзвук" are one company. Six quote families occur.
//   whitespace  — free-text fields carry doubled and non-breaking spaces.
//   party prefix— a party's legal form is a PREFIX („Политическа партия «Движение ДА
//                 България»" / „ПП Движение ДА България"), which the suffix stripper cannot
//                 see. Left unfolded, the party splits one entry per spelling and each holds
//                 a different subset of the years.
//   legal form  — a SUFFIX („Отзвук" / „Отзвук ЕООД"). 93 of the corpus's groups differ only
//                 by whether the declarant typed it.
//   hyphens     — ⚠️ THE ADDITION, and it is what takes the split count to zero. The retired
//                 slug replaced whitespace with `-` and collapsed runs, so it folded
//                 „ФИЛ - КОМЕРС" and „ФИЛ-КОМЕРС" together as a side effect;
//                 `normalizeCompanyName` never did, and without it 14 groups the site
//                 currently shows as one would split.
//
// ⚠️ IT IS A GROUPING KEY AND NEVER A DISPLAY VALUE. It strips the legal form, so rendering it
// would publish „Отзвук" for a company registered as „Отзвук ЕООД". The renderer keeps the raw
// `companyName`.
//
// ⚠️ AND IT IS NOT AN IDENTITY. Two unrelated companies can share a folded name; that is why
// the key it feeds is scoped to (person, table, holder) rather than used corpus-wide, and why
// nothing here resolves an EIK. `declaration_stake_company` (096) is what turns a declared name
// into a registry identity, and it refuses far more than it accepts.

/** Straight, curly, French, low-double and full-width quote characters, plus the apostrophe. */
const QUOTES = /["“”„«»‟″〞〟＂']/g;

/** Longest-first so a glued suffix strips the right amount (ЕООД before ООД, АДСИЦ before АД). */
const LEGAL_FORM_SUFFIXES = [
  "адсиц",
  "еоод",
  "дззд",
  "кда",
  "еад",
  "оод",
  "ад",
  "ет",
  "кд",
  "сд",
];

/** Anchored and requiring a following space, so a company whose name merely BEGINS with those
 *  letters („ПП Сервиз ООД") is untouched. */
const PARTY_FORM_PREFIX = /^(политическа партия|коалиция|пп|кп)\s+/;

// A space-separated trailing token is an unambiguous word boundary. A GLUED suffix is stripped
// only when the character before it is a non-letter (`"МИД 2000"ООД` — a digit precedes ООД),
// which is what stops „ПОЛЕТ" losing its „ЕТ".
const stripLegalFormSuffix = (lowered: string): string => {
  for (const f of LEGAL_FORM_SUFFIXES) {
    if (lowered.endsWith(" " + f))
      return lowered.slice(0, -(f.length + 1)).trim();
    if (lowered.endsWith(f) && lowered.length > f.length + 2) {
      const before = lowered[lowered.length - f.length - 1];
      if (before && !/\p{L}/u.test(before))
        return lowered.slice(0, -f.length).trim();
    }
  }
  return lowered;
};

export const foldCompanyName = (raw: string | null | undefined): string =>
  stripLegalFormSuffix(
    (raw ?? "")
      .replace(QUOTES, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(PARTY_FORM_PREFIX, ""),
  )
    // Last, and after the suffix strip: „ФИЛ-КОМЕРС ООД" must lose its ООД while it is still a
    // trailing token, and only then may the hyphen inside the name fold to a space.
    .replace(/[-\s]+/g, " ")
    .trim();
