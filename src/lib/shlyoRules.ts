// SHLIOKAVITSA — the Latin-side spellings a Bulgarian actually types, declared ONCE.
//
// „6umen" (Шумен), „4erven" (Червен), „jelezopyten" (железопътен), „plowdiw" (Пловдив),
// „sofiq" (София). None of these is Streamlined-System transliteration and none of them
// folds to anything a Cyrillic→Latin fold can match, so each returns nothing without these
// rules.
//
// ===========================================================================
// THE TABLE TARGETS THE **STREAMLINED** ALPHABET, AND THAT IS THE WHOLE REASON IT LIVES IN
// ITS OWN FILE.
//
// Two consumers fold to two different alphabets:
//
//   translit_bg_latin()      (pg/000_search_fns.sql) — Streamlined: ч→"ch", х→"h", distinct
//   latinSkeleton()          (translitSearch.ts)     — Streamlined THEN ch→h collapsed, so
//                                                      "арх" / "arh" / "arch" all meet
//
// Written against the client's alphabet, the ч rule is `4 → "h"`. Copied verbatim into SQL
// — the obvious move — it folds „4erven" to `herven` against a stored `cherven` and matches
// NOTHING. The rule is not wrong; it is relative to an alphabet the server does not use.
//
// So the table below is declared in the Streamlined form (`4 → "ch"`), which is what the
// server wants unmodified, and the client applies its own ch→h collapse AFTER the rules —
// which it already does to both sides of every comparison, so the collapse is not a new
// step, only a reordered one. „4erven" → `cherven` → `herven`, and the haystack „Червен"
// → `cherven` → `herven`. Same answer as before, from a table SQL can also use.
// ===========================================================================
//
// THREE PROPERTIES ARE CONTRACTS, not implementation details. All three are inherited by
// every consumer, including the SQL one:
//
//   1. QUERY SIDE ONLY. Applied to stored data these rules are simply WRONG: a Latin trade
//      name "Wow Ltd" folds to `wowltd` and would be indexed as `vovltd`. Nothing may write
//      a `*_fold_shlyo` column.
//   2. STRICTLY ADDITIVE. The rewritten needle is tried only after the plain one misses, so
//      it can add matches and never remove one. Every existing caller is un-regressible by
//      construction.
//   3. ORDER MATTERS. "6t"→"sht" must precede "6"→"sh", and the two "ya" producers must
//      precede the `y` rule (their `y` is followed by `a`, so the negative lookahead then
//      protects it).

/** One rewrite. `find` is a POSIX-ARE-compatible source string — Postgres supports the
 *  `(?!…)` lookahead constraint, so the same pattern text drives both implementations and
 *  the SQL generator can emit it without translation. */
export interface ShlyoRule {
  find: string;
  to: string;
  /** Which Cyrillic letter this recovers — for the generated SQL's comments. */
  why: string;
}

// `c → ts` (ц) is DELIBERATELY ABSENT. It would refold every Latin trade name carrying a
// "c" — Keytruda, Abemaciclib, "concentrate for solution" — away from what the reader
// typed, and the НЗОК molecule/pack universes are majority Latin. Bulgarians type "ts" for
// ц anyway. Do not "complete" this table.
export const SHLYO_RULES: readonly ShlyoRule[] = [
  { find: "6t", to: "sht", why: "щ" },
  { find: "6", to: "sh", why: "ш" },
  // "ch", not "h" — see the alphabet note above. The client collapses it afterwards.
  { find: "4", to: "ch", why: "ч" },
  { find: "9", to: "ya", why: "я" },
  { find: "q", to: "ya", why: "я" },
  { find: "j", to: "zh", why: "ж" },
  { find: "w", to: "v", why: "в" },
  { find: "x", to: "h", why: "х" },
  {
    find: "y(?![aeiou])",
    to: "a",
    why: "ъ typed as y; a real й/ю/я keeps its vowel",
  },
];

/** What the rules can actually rewrite — the union of their left-hand SIDES, not merely of
 *  the characters they mention. `y` rewrites only when NOT followed by a vowel, so
 *  "sofiya" / "yordanov" / "mariya" — a real й/ю/я, and the way every Latin-typed Bulgarian
 *  name is spelled — must test FALSE. A plain `[…y]` class costs a measured 3.2x on a
 *  filter pass, folding the whole table for a rewrite that provably cannot exist.
 *
 *  Sound as a pre-test because no rule can CREATE a trigger a rule-free string lacked: the
 *  only rules that emit `y` are 9→"ya" and q→"ya", whose `y` is always immediately followed
 *  by `a`. Non-global, so `.test()` is stateless. */
export const SHLYO_TRIGGER = /[469qjwx]|y(?![aeiou])/;

const COMPILED = SHLYO_RULES.map(
  (r) => [new RegExp(r.find, "g"), r.to] as const,
);

/** Apply every rule, in order, to an already-folded string. Returns the STREAMLINED-alphabet
 *  result — the form `translit_bg_latin()` produces, and what the SQL generator emits. */
export const applyShlyoRules = (base: string): string => {
  let out = base;
  for (const [re, to] of COMPILED) out = out.replace(re, to);
  return out;
};

// The same table re-expressed in `latinSkeleton`'s collapsed alphabet, by collapsing each
// rule's REPLACEMENT — not, as a first draft did, the finished string.
//
// THE DIFFERENCE IS NOT COSMETIC AND IT LOSES MATCHES. Collapsing the output eats every
// `ch` in it, including ones no rule produced, and because the collapse DELETES a character
// the result is a subsequence rather than a substring of the un-collapsed needle — so the
// rewrite stops being additive and starts removing hits. Two reachable sources, both
// measured:
//
//   1. `x → "h"` after a literal c: "cx" → "ch" (old) vs "h" (output-collapsed).
//   2. `latinSkeleton` ITSELF emits `ch`. It collapses BEFORE stripping non-alphanumerics,
//      so a `c` and an `h` separated by anything punctuational survive as an uncollapsed
//      pair: latinSkeleton("Basic Holding") === "basicholding".
//
// Measured on the real corpus the blast radius was ~1 name in 19,189 — small, and exactly
// the kind of thing that ships green because every existing test still passes.
//
// Only the ч rule's `to` contains "ch", so this derivation IS the old hand-written table.
// `shlyoRules.test.ts` asserts that byte-for-byte over an exhaustive corpus rather than
// leaving it as a claim.
const COMPILED_COLLAPSED = SHLYO_RULES.map(
  (r) => [new RegExp(r.find, "g"), r.to.replace(/ch/g, "h")] as const,
);

/** Apply every rule to an already-folded string, in `latinSkeleton`'s alphabet — where ч
 *  and х have both collapsed to `h`. For CLIENT-side matching only; the server folds with
 *  `translit_bg_latin()`, which keeps them apart, and must use `applyShlyoRules`. */
export const applyShlyoRulesCollapsed = (base: string): string => {
  let out = base;
  for (const [re, to] of COMPILED_COLLAPSED) out = out.replace(re, to);
  return out;
};
