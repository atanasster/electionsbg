// Tier 3 (Postgres-native) — the fold function itself.
//
//   npm run test:data
//
// `translit_bg_latin()` (000_search_fns.sql) is the ONE Cyrillic→Latin fold: it produces
// the stored `*_fold` columns on eleven tables and folds the query on every search that
// reads them. `translit_fold_residue.data.test.ts` measures what survives it IN THE
// CORPUS; this file asserts what the function DOES, case by case, so a body change fails
// here with a named character rather than as a row count somewhere downstream.
//
// Plan: docs/plans/search-fold-homoglyphs-v1.md.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { BG_LETTERS, CYR_EXTRA, charClass } from "../lib/cyrillic";

const haveDb = await dbReachable();
const skip = haveDb ? false : "Postgres unreachable";

afterAll(async () => {
  if (haveDb) await end();
});

const fold = async (s: string): Promise<string> => {
  const [row] = await allRows<{ f: string }>(
    "SELECT translit_bg_latin($1) AS f",
    [s],
  );
  return row.f;
};

// IDEMPOTENCE — the cheapest possible gate for the ordering defect, and the one that
// would have caught it years earlier.
//
// `unaccent` used to run AFTER the Cyrillic→Latin translate, so anything it folded INTO
// a Bulgarian letter re-entered the output as Cyrillic: `translit_bg_latin('ё')` returned
// a Cyrillic `е`, and folding that result again produced the Latin `e` it should have
// produced the first time. A function whose output is not a fixed point of itself is a
// fold that did not finish.
test.skipIf(skip)("folding twice changes nothing", async () => {
  const cases = [
    "ё",
    "Ё",
    "Раздел І, част ІV",
    "Цар Фердинанд І",
    "Hӧrmann GmbH",
    "Асиова - Диамант",
    "Желязков",
    "Щърбов",
    "Юлия Ячкова",
    "ѝ ѐ э ы ј ѕ є ӓ ѵ",
  ];
  for (const c of cases) {
    const once = await fold(c);
    const twice = await fold(once);
    assert.equal(twice, once, `not a fixed point: ${c} → ${once} → ${twice}`);
  }
});

// The output must be a LATIN skeleton. This is the function-level twin of the corpus
// gate: if a character class survives here, every row folded after this point carries it.
test.skipIf(skip)("no Cyrillic survives the fold", async () => {
  const [row] = await allRows<{ bg: string; extra: string; out: string }>(
    `WITH f AS (SELECT translit_bg_latin($3) AS v)
     SELECT (v ~ $1)::text AS bg, (v ~ $2)::text AS extra, v AS out FROM f`,
    [
      charClass(BG_LETTERS),
      charClass(CYR_EXTRA),
      // Every Bulgarian letter, then every homoglyph measured in the corpus.
      `${BG_LETTERS} іІѝЍэЭыЫјЈѕЅӧӦӓӒѵѴєЄїЇѐЀёЁ`,
    ],
  );
  assert.equal(
    row.bg,
    "false",
    `a Bulgarian letter survived the fold: ${row.out}`,
  );
  assert.equal(
    row.extra,
    "false",
    `a Cyrillic homoglyph survived the fold: ${row.out}`,
  );
});

// The case table. Each row is a property somebody could plausibly break, with the reason
// it matters — a bare expected-string table invites "just update the expectation".
test.skipIf(skip)("folds each documented case", async () => {
  const cases: [input: string, expected: string, why: string][] = [
    // The homoglyphs, which is what this change added.
    [
      "Раздел І, част ІV",
      "razdel i, chast iv",
      "ЦАИС's own notice-template numerals",
    ],
    [
      "Цар Фердинанд І",
      "tsar ferdinand i",
      "a hospital name carrying the same І",
    ],
    ["Hӧrmann GmbH", "hormann gmbh", "a Cyrillic ӧ inside a German name"],
    ["ё", "e", "unaccent must run BEFORE the translate, not after"],
    ["Ё", "e", "the uppercase twin — translate runs before lower()"],
    ["ѝ", "i", "Bulgarian's own grave-accented и, 8,227 occurrences"],
    ["э", "e", "Russian-language specifications"],
    ["ы", "y", "ditto"],
    // Pre-existing behaviour that must NOT move. These are the reason a body change is
    // dangerous: they are load-bearing for the exact-key person↔TR bridge.
    [
      "Асиова - Диамант",
      "asiova diamant",
      "hyphen/space collapse (099's whole point)",
    ],
    [
      "Асиова-Диамант",
      "asiova diamant",
      "same key however the source spaced it",
    ],
    ["Желязков", "zhelyazkov", "ж→zh and я→ya digraphs"],
    ["Щърбов", "shtarbov", "щ→sht and ъ→a"],
    ["Юлия Ячкова", "yuliya yachkova", "ю→yu at the start of a word"],
    ["Чучулига", "chuchuliga", "ч→ch"],
    ["Цецо", "tsetso", "ц→ts, on both of them"],
    ["", "", "NULL/empty must not throw — coalesce(txt,'')"],
    // EVERY mapped homoglyph, one row each. `translate()` DELETES a character whose
    // FROM position has no TO counterpart, so a length mismatch between the two strings
    // silently drops letters from that point on — and the common cases above would all
    // still pass. These are what make that edit fail.
    ["і", "i", "U+0456"],
    ["ї", "i", "U+0457"],
    ["ѝ", "i", "U+045D"],
    ["ѵ", "i", "U+0475"],
    ["ѐ", "e", "U+0450"],
    ["є", "e", "U+0454"],
    ["ј", "j", "U+0458"],
    ["ѕ", "s", "U+0455"],
    ["ӧ", "o", "U+04E7"],
    ["ӓ", "a", "U+04D3"],
    ["І", "i", "uppercase twin — translate runs before lower()"],
    ["Ї", "i", "uppercase twin"],
    ["Ѝ", "i", "uppercase twin"],
    ["Ѵ", "i", "uppercase twin"],
    ["Ѐ", "e", "uppercase twin"],
    ["Є", "e", "uppercase twin"],
    ["Э", "e", "uppercase twin"],
    ["Ы", "y", "uppercase twin"],
    ["Ј", "j", "uppercase twin"],
    ["Ѕ", "s", "uppercase twin"],
    ["Ӧ", "o", "uppercase twin"],
    ["Ӓ", "a", "uppercase twin"],
    // ⚠️ These four are pinned because the reorder put them DOWNSTREAM of the server's
    // `unaccent.rules` for the first time. Before it, `translate` had already consumed
    // them; now a rules file that mapped й or ъ would change the fold of a large part of
    // the corpus, and nothing else in this repo would notice.
    ["й", "y", "must survive unaccent unchanged, then translate to y"],
    ["Й", "y", "ditto, uppercase"],
    ["ъ", "a", "must survive unaccent unchanged, then translate to a"],
    ["Ъ", "a", "ditto, uppercase"],
    // Latin diacritics — the reorder must not have changed these either.
    ["Hörmann GmbH", "hormann gmbh", "unaccent still folds Latin diacritics"],
    ["Cañón", "canon", "ditto"],
  ];
  for (const [input, expected, why] of cases) {
    const got = await fold(input);
    assert.equal(got, expected, `${why}: translit_bg_latin(${input}) = ${got}`);
  }
});

// NULL is not the empty string to every caller, and this function is used inside
// generated columns where a NULL input is ordinary.
test.skipIf(skip)("NULL folds to the empty string, never NULL", async () => {
  const [row] = await allRows<{ f: string | null }>(
    "SELECT translit_bg_latin(NULL) AS f",
  );
  assert.equal(row.f, "");
});
