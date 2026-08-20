// The two Cyrillic character classes the fold gates measure against.
//
// They live here rather than in a test file because BOTH residue gates need them
// (`translit_fold_residue.data.test.ts` and the narrower arm in
// `tender_search_text.data.test.ts`), and a 60-character class copied into two files
// is a class that will be edited in one of them.
//
// ⚠️ ENUMERATED, never a range. `[а-я]` in a Postgres regex is interpreted against the
// database COLLATION rather than against Unicode, so the same pattern matches a
// different set of characters per server — which is why the original gate spelled its
// class out, and why the wide class below is GENERATED into an enumeration instead of
// being written as `[Ѐ-ӿ]`.

/** The 30-letter Bulgarian alphabet, both cases. A fold still carrying one of these has
 *  the worse of the two defects: `unaccent` re-introduced a Bulgarian letter AFTER the
 *  transliteration had already run (`translit_bg_latin('ё')` → `е`). */
export const BG_LETTERS =
  "абвгдежзийклмнопрстуфхцчшщъьюяАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ";

/** Every other character in the Cyrillic block (U+0400–U+04FF) — the HOMOGLYPHS, which
 *  never reached `translate()` because the mapping is the Bulgarian alphabet only.
 *
 *  Generated rather than hand-listed, for the same reason the fold-column list is
 *  derived from the catalog: a hand-list is invisible to the next homoglyph. It already
 *  was — the first cut of this class named fourteen characters and missed `ѕ ј ӓ ӧ`,
 *  one of which is `hӧrmann gmbh` (Hörmann GmbH with a Cyrillic ӧ) sitting in
 *  `contracts.title_fold`, unreachable by anyone typing `hormann`. */
export const CYR_EXTRA = Array.from({ length: 0x0500 - 0x0400 }, (_, i) =>
  String.fromCodePoint(0x0400 + i),
)
  .filter((ch) => !BG_LETTERS.includes(ch))
  .join("");

/** A Postgres bracket expression for one of the classes above.
 *
 *  `]`, `^` and `\` would need escaping inside a bracket expression; none of them is in
 *  the Cyrillic block, so this is a plain wrap — asserted rather than assumed, because a
 *  future caller passing arbitrary text here would otherwise build a silently broken
 *  pattern that matches nothing and reports a clean corpus. */
export const charClass = (chars: string): string => {
  if (/[\]^\\-]/.test(chars))
    throw new Error(
      "charClass() received a character that changes bracket-expression meaning " +
        "(] ^ \\ or -); escape it before building the pattern",
    );
  return `[${chars}]`;
};
