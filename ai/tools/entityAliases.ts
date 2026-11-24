// Curated identities for organisations that have NO ЕИК of their own.
//
// INSAIT is a unit of Sofia University (ЕИК 000670680): every contract it buys is
// filed under the university's ЕИК, so the only trace of it in our corpora is its
// name inside titles. Name search cannot be its identity, in either direction:
//   - „INSAIT" whole-word also matches ДАТА ИНСАИТ И БИЗНЕС and ИНСАИТ ИН — two
//     "insight" firms with nothing to do with the institute;
//   - „ИНСАЙТ" (its foundation's spelling) is the ordinary Bulgarian word for
//     "insight", and romanizes to `insayt`, so it misses every INSAIT title and
//     matches ~20 unrelated firms and two farm-subsidy recipients instead.
// So the mentions tool resolves these names to an entry here and asks narrower
// questions: the title must name the institute AND the buyer must be the parent.
//
// Rules for adding an entry (docs/plans/insait-gap-v1.md §2):
//   - the organisation genuinely has no ЕИК of its own;
//   - `parentEik` and every `organisations` ЕИК are checked against the
//     Commerce Registry BY HAND — never inferred from a name match;
//   - keep it small. This is a curated list, not a fuzzy resolver.

export type EntityAlias = {
  id: string;
  name: { bg: string; en: string };
  /** What a reader may type. Compared as whole romanized words, exactly. */
  triggers: string[];
  /** What we send to the search routes — one request per entry. */
  searchTerms: string[];
  /** A record belongs to the entity when its text names one of these (whole
   *  words, the usual ≤3-letter inflection allowance on long words). */
  matchTerms: string[];
  /** Procurement rows count only when this body is the buyer. Matched on the
   *  buyer NAME (the search routes return no buyer ЕИК); each entry is a
   *  whole-word phrase the parent's registered spellings all contain. */
  parent: { eik: string; names: string[] };
  /** Legal entities that ARE the organisation or act for it, verified by ЕИК. */
  organisations: {
    eik: string;
    name: string;
    role: { bg: string; en: string };
  }[];
  /** Firms whose names collide with a trigger and are known to be unrelated.
   *  Listed so they are NAMED as excluded rather than silently dropped. */
  excludeEiks: string[];
};

export const ENTITY_ALIASES: EntityAlias[] = [
  {
    id: "insait",
    name: {
      bg: "INSAIT — Институт за компютърни науки, изкуствен интелект и технологии (към СУ)",
      en: "INSAIT — Institute for Computer Science, Artificial Intelligence and Technology (Sofia University)",
    },
    triggers: [
      "INSAIT",
      "ИНСАЙТ",
      "ИНИОКН",
      "Институт за компютърни науки, изкуствен интелект и технологии",
      "Институт за научни изследвания в областта на компютърните науки",
    ],
    searchTerms: [
      "INSAIT",
      "ИНИОКН",
      "изследвания в областта на компютърните науки",
    ],
    matchTerms: [
      "INSAIT",
      "ИНИОКН",
      "Институт за научни изследвания в областта на компютърните науки",
      "Институт за компютърни науки, изкуствен интелект и технологии",
    ],
    parent: { eik: "000670680", names: ["Софийски университет"] },
    organisations: [
      {
        eik: "207211849",
        name: "ИНСАЙТ изследвания и образование",
        role: { bg: "фондация на INSAIT", en: "INSAIT's foundation" },
      },
    ],
    // ДАТА ИНСАИТ И БИЗНЕС, ИНСАИТ ИН — "insight" firms, unrelated.
    excludeEiks: ["203637591", "131231159"],
  },
];
