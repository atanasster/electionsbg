// Unit + property tests for canonicalize(). Pure — no database.
//
// Lives in scripts/db/tests/ because that is the ONLY directory globbed by
// `npm run test:data` and `npm run db:verify` (package.json). A test under
// scripts/prices/tests/ would exist and never execute.
//
// Every case below traces to a defect found by running the algorithm against
// the real 2026-07-08 corpus. See consumption-pg-v1-implementation.md §3.0.

import { test } from "vitest";
import assert from "node:assert/strict";
import { canonicalize, mayMergeAcrossChains } from "../../prices/lib/canon";

const key = (n: string, pid = 6, up = false) =>
  canonicalize(n, pid, up).canonKey;

test("size: Cyrillic units parse (the \\b bug)", () => {
  // /Л\b/u never matches "1Л" — \b is ASCII-word-based.
  assert.deepEqual(
    [
      canonicalize("ПРЯСНО МЛЯКО ВЕРЕЯ 1Л 3%", 6).netQty,
      canonicalize("ПРЯСНО МЛЯКО ВЕРЕЯ 1Л 3%", 6).netUnit,
    ],
    [1000, "ml"],
  );
  assert.equal(canonicalize("СИРЕНЕ САЯНА 500Г", 9).netQty, 500);
  assert.equal(canonicalize("БРАШНО 1КГ", 40).netQty, 1000); // kg -> g
  assert.equal(canonicalize("СОК 0,5Л", 73).netQty, 500); // comma decimal
  assert.equal(canonicalize("ВОДА 1.5 Л.", 73).netQty, 1500); // space + trailing dot
});

test("size: Latin units survive homoglyph folding (parse pre-fold)", () => {
  // Folding rewrites K→К and M→М, so a Latin "1KG" would fold to mixed-script
  // "1КG" and lose its size. Size must be parsed before folding.
  assert.equal(canonicalize("КАФЕ 1KG", 71).netQty, 1000);
  assert.equal(canonicalize("МЛЯКО 700ML", 6).netQty, 700);
  assert.equal(canonicalize("ЗАХАР 500G", 38).netQty, 500);
  assert.equal(canonicalize("БРАШНО 500GR", 40).netQty, 500); // Latin GR
  assert.equal(canonicalize("СОК 1L", 73).netQty, 1000);
});

test("size: the (?![\\p{L}]) guard holds", () => {
  assert.equal(canonicalize("ЛЕПИЛО 1КГМ", 39).netQty, null);
});

test("size: unit equivalence 1Л == 1000МЛ, 0.5КГ == 500Г", () => {
  assert.equal(
    canonicalize("СОК ФРЕШ 1Л", 73).netQty,
    canonicalize("СОК ФРЕШ 1000МЛ", 73).netQty,
  );
  assert.equal(
    canonicalize("СИРЕНЕ Х 0.5КГ", 9).netQty,
    canonicalize("СИРЕНЕ Х 500Г", 9).netQty,
  );
});

test("multipack: 6х1.5Л != 1.5Л, and count becomes an attr", () => {
  const six = canonicalize("МИНЕРАЛНА ВОДА 6х1.5Л", 73);
  const one = canonicalize("МИНЕРАЛНА ВОДА 1.5Л", 73);
  assert.equal(six.netQty, 9000);
  assert.equal(six.attrs.count, "6");
  assert.notEqual(six.canonKey, one.canonKey);
  // Latin x and Cyrillic х must behave identically (rule 4 folds neither, the
  // multipack regex accepts both after folding).
  assert.equal(canonicalize("МИНЕРАЛНА ВОДА 6x1.5L", 73).netQty, 9000);
});

test("percent is identity, not noise (the ВЕРЕЯ 59-chain blob)", () => {
  const a = key("ПРЯСНО МЛЯКО ВЕРЕЯ 1Л 3%");
  const b = key("ПРЯСНО МЛЯКО ВЕРЕЯ 1Л 2%");
  const c = key("ПРЯСНО МЛЯКО ВЕРЕЯ 1Л 1,5%");
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(b, c);
});

test("quality class is an attr, and Latin II folds onto Cyrillic ІІ", () => {
  // БАНАНИ and БАНАНИ II are different goods at different prices.
  assert.notEqual(key("БАНАНИ", 52), key("БАНАНИ II", 52));
  // The corpus spells the class both ways. They are the SAME product.
  assert.equal(key("МОРКОВИ II", 56), key("МОРКОВИ ІІ", 56));
  assert.equal(canonicalize("БАНАНИ II", 52).attrs.class, "ІІ");
});

test("word-order invariance merges the real Lavazza and Sayana variants", () => {
  const lav = [
    "КАФЕ ЛАВАЦА 1КГ КУАЛИТА РОСА ЗЪРНА",
    "КАФЕ ЛАВАЦА КУАЛИТА РОСА НА ЗЪРНА 1КГ",
    "КАФЕ ЛАВАЦА ЗЪРНА КУАЛИТА РОСА 1кг",
  ].map((n) => key(n, 71));
  assert.equal(new Set(lav).size, 1);

  const say = [
    "СИРЕНЕ КРАВЕ САЯНА 400ГР ВАКУУМ",
    "СИРЕНЕ КРАВЕ САЯНА 400ГР",
    "Краве сирене САЯНА 400гр",
    "Саяна Краве Сирене 400гр",
  ].map((n) => key(n, 9));
  assert.equal(new Set(say).size, 1);
});

test("leading junk is stripped", () => {
  const base = key("ЧАЙ БИОПРОГРАМА ШИПКА", 72);
  assert.equal(key("= ЧАЙ БИОПРОГРАМА ШИПКА", 72), base);
  assert.equal(key("*Чай Биопрограма Шипка", 72), base);
  assert.equal(key("НЕ ЧАЙ БИОПРОГРАМА ШИПКА", 72), base);
});

test("stray internal codes are dropped (the 2755 in the Plazmon puree)", () => {
  assert.equal(
    key("ПЮРЕ ПЛАЗМОН 2755 ЗЕЛЕНЧУЦИ С ПИЛЕ 7М+ 200ГР", 64),
    key("ПЛАЗМОН ПЮРЕ 200ГР ЗЕЛЕНЧУЦИ С ПИЛЕ", 64),
  );
});

test("attrs key order is deterministic, not insertion order", () => {
  // Two names producing the same attribute SET must produce the same key,
  // whatever order the attributes were discovered in.
  const a = canonicalize("РАКИЯ 700МЛ 40% II", 77);
  const b = canonicalize("РАКИЯ II 40% 700МЛ", 77);
  assert.equal(a.canonKey, b.canonKey);
});

test("determinism: same input, same key", () => {
  const n = "ПРЯСНО МЛЯКО ВЕРЕЯ 1Л 3%";
  const first = key(n);
  for (let i = 0; i < 50; i++) assert.equal(key(n), first);
});

test("permutation invariance over shuffled words", () => {
  const words = "КАФЕ ЛАВАЦА 1КГ КУАЛИТА РОСА ЗЪРНА".split(" ");
  const base = key(words.join(" "), 71);
  // Seeded Fisher–Yates so the 20 iterations are genuinely different orderings,
  // not just identity/reverse (a `() => i % 2 ? 1 : -1` comparator is constant).
  let seed = 12345;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 20; i++) {
    const s = [...words];
    for (let j = s.length - 1; j > 0; j--) {
      const k2 = Math.floor(rnd() * (j + 1));
      [s[j], s[k2]] = [s[k2], s[j]];
    }
    assert.equal(key(s.join(" "), 71), base);
  }
});

test("unit-priced goods ignore any size in the name", () => {
  // "БАНАНИ", "БАНАНИ 1 КГ" and "БАНАНИ КГ" are one product sold per kilogram.
  // Letting the parsed size into the key split them 53 chains vs 3.
  const a = key("БАНАНИ", 52, true);
  assert.equal(key("БАНАНИ 1 КГ", 52, true), a);
  assert.equal(key("БАНАНИ КГ", 52, true), a);
  // …but the quality class still separates them.
  assert.notEqual(key("БАНАНИ II", 52, true), a);
  // A packaged good is NOT collapsed this way.
  assert.notEqual(key("МЛЯКО ВЕРЕЯ 1Л", 6), key("МЛЯКО ВЕРЕЯ 2Л", 6));
});

test("MERGE RULE: no parsed size => no cross-chain merge, unless unit-priced", () => {
  // Packaged good with no size: must NOT merge across chains.
  assert.equal(
    mayMergeAcrossChains(canonicalize("ОБИКНОВЕНИ БИСКВИТИ", 66)),
    false,
  );
  // Loose produce: no size by nature, but MUST still merge (2,811 groups).
  assert.equal(mayMergeAcrossChains(canonicalize("БАНАНИ", 52, true)), true);
  assert.equal(mayMergeAcrossChains(canonicalize("МОРКОВИ", 56, true)), true);
  // Packaged good with a size: merges.
  assert.equal(
    mayMergeAcrossChains(canonicalize("МЛЯКО ВЕРЕЯ 1Л 3%", 6)),
    true,
  );
});
