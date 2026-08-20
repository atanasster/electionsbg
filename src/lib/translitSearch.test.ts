// SEED EXAMPLE — the "pure util" layer. See docs/testing-standards.md.
//
// A pure, deterministic function (Latin/Cyrillic search folding) is the easiest
// and highest-value thing to unit-test: no DOM, no network, no DB — just
// input -> output. Co-located next to the module it tests, named *.test.ts.
// New tests should prefer Vitest's `expect` (as here) over node:assert.
import { describe, expect, it } from "vitest";
import {
  latinSkeleton,
  latinSkeletonCached,
  rankedFilter,
  searchMatches,
  shlyoComputeCount,
  shlyoSkeleton,
  skeletonCacheSize,
  skeletonMatches,
} from "./translitSearch";

describe("latinSkeleton", () => {
  it("transliterates Cyrillic to a Latin skeleton", () => {
    expect(latinSkeleton("Строителни")).toBe("stroitelni");
  });

  it("folds ч and х (and a typed 'ch') to the same 'h'", () => {
    // "Архитектурни", "arhitekturni" and "architekturni" must all collapse.
    expect(latinSkeleton("Архитектурни")).toBe("arhitekturni");
    expect(latinSkeleton("arhitekturni")).toBe("arhitekturni");
    expect(latinSkeleton("architekturni")).toBe("arhitekturni");
  });

  it("strips punctuation and whitespace", () => {
    expect(latinSkeleton("АЕЦ — Козлодуй, бл.5")).toBe("aetskozloduybl5");
  });
});

describe("skeletonMatches", () => {
  it("matches a Latin needle against Cyrillic text (shljokavica input)", () => {
    expect(skeletonMatches("Архитектурни услуги", "arh")).toBe(true);
    expect(skeletonMatches("Архитектурни услуги", "arch")).toBe(true);
  });

  it("is a non-match when the folded needle is absent", () => {
    expect(skeletonMatches("Строителни работи", "arh")).toBe(false);
  });

  it("treats an empty needle as a match (no filter applied)", () => {
    expect(skeletonMatches("каквото и да е", "")).toBe(true);
  });
});

describe("latinSkeletonCached", () => {
  it("returns the same fold as the uncached function, hit or miss", () => {
    const s = "Хюсни Осман Адем";
    expect(latinSkeletonCached(s)).toBe(latinSkeleton(s));
    // Second call comes off the cache — same answer, not a stale/mutated one.
    expect(latinSkeletonCached(s)).toBe(latinSkeleton(s));
  });

  it("actually memoizes — the second call is a hit, not a re-fold", () => {
    // A cache that stored nothing would return the right value forever while
    // costing the full fold on every keystroke, which is invisible to the
    // assertion above. Growth-by-one-then-flat is what "hit" looks like from
    // outside. A fresh string each run keeps this independent of test order.
    const s = "Каргеоргиева-Мострова № 7";
    const before = skeletonCacheSize();
    latinSkeletonCached(s);
    const afterMiss = skeletonCacheSize();
    latinSkeletonCached(s);
    expect(afterMiss).toBe(before + 1);
    expect(skeletonCacheSize()).toBe(afterMiss);
  });
});

describe("searchMatches", () => {
  it("matches Cyrillic names typed in Latin (the table-filter case)", () => {
    // What the /procurement/mps filter boxes could not do before: "iv" / "da"
    // against a Cyrillic roster.
    expect(searchMatches("Иван Георгиев Иванов", "iv")).toBe(true);
    expect(searchMatches("Дарин Величков Матов", "da")).toBe(true);
    expect(searchMatches("Златомира Карагеоргиева-Мострова", "karageorg")).toBe(
      true,
    );
  });

  it("still matches plain Cyrillic and plain Latin input", () => {
    expect(searchMatches("Иван Георгиев", "георги")).toBe(true);
    expect(searchMatches("ИНФОРМАЦИОННО ОБСЛУЖВАНЕ", "обслужв")).toBe(true);
    expect(searchMatches("Alpha Research", "research")).toBe(true);
  });

  it("folds across the space between name parts", () => {
    expect(searchMatches("Иван Георгиев", "ivange")).toBe(true);
  });

  it("does not match an unrelated needle", () => {
    expect(searchMatches("Дарин Величков Матов", "iv")).toBe(false);
  });

  it("does not turn an all-punctuation needle into a match-everything", () => {
    // Folds to "" — that means "nothing to match on" here, not "no filter":
    // TanStack only calls this once the query is non-empty.
    expect(searchMatches("Иван Георгиев", "!!")).toBe(false);
  });

  it("keeps the folds that pay off WITHIN Latin text", () => {
    // The cheap way to make this fast is "only fold when a side has Cyrillic",
    // which silently drops these two. The skeletal guard keeps them: either side
    // being fold-able takes the folded path.
    expect(searchMatches("Ivanov-Petrov", "ivanovpetrov")).toBe(true);
    expect(searchMatches("Church Street", "hur")).toBe(true);
  });

  it("does not fold when folding cannot change the answer", () => {
    // THE PERF CONTRACT. A miss between two already-skeletal strings — the shape
    // of every numeric cell in a wide table, which is most of the cells — must
    // cost the literal check alone. Nothing enters the fold memo.
    const before = skeletonCacheSize();
    expect(searchMatches("987654321", "iv")).toBe(false);
    expect(searchMatches("sofiya2024", "plovdiv")).toBe(false);
    expect(skeletonCacheSize()).toBe(before);
  });

  it("does fold when either side can be changed by folding", () => {
    // The guard must not over-trigger: a Cyrillic haystack, or a needle carrying
    // punctuation/`ch`, still has to take the folded path.
    const before = skeletonCacheSize();
    expect(searchMatches("Пловдив-център", "plovdiv")).toBe(true);
    expect(skeletonCacheSize()).toBeGreaterThan(before);
  });

  it("matches the Latin-side shliokavitsa spellings", () => {
    expect(searchMatches("Шумен", "6umen")).toBe(true);
    expect(searchMatches("Червен бряг", "4erven")).toBe(true);
    expect(searchMatches("Пловдив", "plowdiw")).toBe(true);
    expect(searchMatches("София", "sofiq")).toBe(true);
    expect(searchMatches("железопътен транспорт", "jelezopyten")).toBe(true);
    expect(searchMatches("Търново", "tyrnovo")).toBe(true);
  });

  it("does not let the shlyo needle match something unrelated", () => {
    expect(searchMatches("Пловдив", "6umen")).toBe(false);
    expect(searchMatches("Стара Загора", "4erven")).toBe(false);
  });

  it("keeps the single-character rules from matching across unrelated words", () => {
    // j/w/x/y are the noisy rules — they rewrite ordinary Latin letters, not
    // digits, so their blast radius is worth pinning. The widening they DO
    // cause is intended (that is what shliokavitsa means) and is gated behind a
    // literal-and-fold miss; this fences it so a future rule cannot widen it
    // materially with a green suite.
    expect(searchMatches("Alpha Research", "6umen")).toBe(false);
    expect(searchMatches("Стара Загора", "plowdiw")).toBe(false);
    expect(searchMatches("Abemaciclib", "jelezo")).toBe(false);
  });

  it("keeps the fast exit for a needle whose shlyo rewrite is a no-op", () => {
    // The middle case, and the expensive one: "sofiya" / "yordanov" carry a `y`,
    // but it is followed by a vowel — a real й/ю/я, not ъ — so there is no
    // second needle to try. The guard has to SEE that. If it only asked "does
    // the needle contain a y", every Latin-typed Bulgarian name (sofiya, mariya,
    // boyan, zhelyazkov) would fold the entire table for a rewrite that cannot
    // exist — measured at 3.2x a filter pass.
    expect(shlyoSkeleton("sofiya")).toBe("");
    expect(shlyoSkeleton("yordanov")).toBe("");
    const before = skeletonCacheSize();
    expect(searchMatches("987654321", "sofiya")).toBe(false);
    expect(searchMatches("987654322", "yordanov")).toBe(false);
    expect(skeletonCacheSize()).toBe(before);
  });

  it("computes the alternate needle once per pass, not once per cell", () => {
    // searchMatches runs per CELL (~178k times on a 12.7k-row table), and the
    // alternate needle is constant across the pass. Without the memo this ran
    // nine global replaces per cell to rebuild the same string. A call counter
    // is deterministic where a wall-clock assertion would be flaky.
    searchMatches("Пловдив", "6umen"); // prime the memo for this needle
    const before = shlyoComputeCount();
    for (let i = 0; i < 500; i++) searchMatches(`Ред №${i} Пловдив`, "6umen");
    expect(shlyoComputeCount()).toBe(before);
  });
});

describe("shlyoSkeleton", () => {
  it("rewrites the Latin-side spellings onto the canonical fold", () => {
    expect(shlyoSkeleton("6umen")).toBe(latinSkeleton("Шумен"));
    expect(shlyoSkeleton("4erven")).toBe(latinSkeleton("Червен"));
    expect(shlyoSkeleton("plowdiw")).toBe(latinSkeleton("Пловдив"));
    expect(shlyoSkeleton("sofiq")).toBe(latinSkeleton("София"));
    expect(shlyoSkeleton("jelezopyten")).toBe(latinSkeleton("железопътен"));
  });

  it("applies 6t before 6 so 'ще' survives", () => {
    expect(shlyoSkeleton("6te")).toBe(latinSkeleton("ще"));
  });

  it("keeps a real й/ю/я vowel rather than reading its y as ъ", () => {
    // "y" only becomes ъ when NOT followed by a vowel, so "Йордан" and "София"
    // must round-trip unchanged.
    expect(shlyoSkeleton("yordan")).toBe("");
    expect(shlyoSkeleton("sofiya")).toBe("");
  });

  it("returns '' when the rewrite would be a no-op", () => {
    // "" is the callers' signal that no second needle is needed — a rewrite
    // equal to the plain fold would just cost a redundant includes().
    expect(shlyoSkeleton("plovdiv")).toBe("");
    expect(shlyoSkeleton("Иван")).toBe("");
    expect(shlyoSkeleton("")).toBe("");
  });

  it("leaves ц alone — the deliberate omission", () => {
    // c→ts would refold every Latin drug name away from what was typed. The
    // НЗОК molecule/pack groups are majority-Latin, so this must NOT change.
    expect(shlyoSkeleton("abemaciclib")).toBe("");
    expect(searchMatches("Abemaciclib", "abemacic")).toBe(true);
  });
});

describe("rankedFilter", () => {
  // ъ folds to "a", so a Cyrillic query starting "въ" also folds-matches every
  // Иванов/Василев. With a plain one-pass filter + cap those alphabetically
  // earlier fold-matches ate the whole budget and pushed the real Вълчев rows
  // out of view — measured at 17 lost on the 4,755-name roster for "въл".
  const ROSTER = [
    "Атанас Иванов",
    "Ваня Василева",
    "Веселин Атанасов",
    "Михаил Вълчев",
    "Недялка Вълчева",
  ];

  it("keeps literal matches when the cap binds", () => {
    const got = rankedFilter(ROSTER, "въ", (s) => s, 3);
    expect(got).toContain("Михаил Вълчев");
    expect(got).toContain("Недялка Вълчева");
  });

  it("ranks every literal match above every fold-only match", () => {
    const got = rankedFilter(ROSTER, "въ", (s) => s, 5);
    expect(got.slice(0, 2)).toEqual(["Михаил Вълчев", "Недялка Вълчева"]);
  });

  it("still returns the fold-only matches once the literals fit", () => {
    // The shliokavitsa win must survive the ranking — these are additions, they
    // just sort last. ъ→"a" makes "въ" fold to "va", which reaches Иванов and
    // Василева but not Атанасов (no "va" in "veselinatanasov").
    expect(rankedFilter(ROSTER, "въ", (s) => s, 5)).toEqual([
      "Михаил Вълчев",
      "Недялка Вълчева",
      "Атанас Иванов",
      "Ваня Василева",
    ]);
  });

  it("finds a Latin-typed query with no literal matches at all", () => {
    expect(rankedFilter(ROSTER, "valchev", (s) => s, 5)).toContain(
      "Михаил Вълчев",
    );
  });

  it("returns the first `limit` items for an empty query", () => {
    expect(rankedFilter(ROSTER, "", (s) => s, 2)).toEqual(ROSTER.slice(0, 2));
  });

  it("never returns more than the limit, and nothing at limit 0", () => {
    expect(rankedFilter(ROSTER, "в", (s) => s, 2)).toHaveLength(2);
    expect(rankedFilter(ROSTER, "в", (s) => s, 0)).toEqual([]);
  });

  it("preserves source order within a tier", () => {
    expect(rankedFilter(ROSTER, "а", (s) => s, 10)[0]).toBe("Атанас Иванов");
  });

  it("stops scanning once the literal tier fills the cap", () => {
    // The break must be on the LITERAL count. Breaking on the combined count
    // would let fold matches end the scan early and re-introduce the eviction.
    let reads = 0;
    const many = Array.from({ length: 1000 }, (_, i) => `Вълчев ${i}`);
    rankedFilter(
      many,
      "вълчев",
      (s) => {
        reads++;
        return s;
      },
      10,
    );
    expect(reads).toBe(10);
  });
});

describe("shlyo is strictly additive", () => {
  it("never removes a match that worked before the rules existed", () => {
    // The property the whole design rests on: the shlyo needle is only ever
    // tried AFTER the plain one misses, so every pre-existing pair still
    // matches. These are the cases from the suites above, re-asserted as one
    // regression fence.
    const pairs: [string, string][] = [
      ["Иван Георгиев Иванов", "iv"],
      ["Дарин Величков Матов", "da"],
      ["Златомира Карагеоргиева-Мострова", "karageorg"],
      ["Иван Георгиев", "георги"],
      ["ИНФОРМАЦИОННО ОБСЛУЖВАНЕ", "обслужв"],
      ["Alpha Research", "research"],
      ["Иван Георгиев", "ivange"],
      ["Ivanov-Petrov", "ivanovpetrov"],
      ["Church Street", "hur"],
      ["Архитектурни услуги", "arh"],
      ["Архитектурни услуги", "arch"],
    ];
    for (const [hay, needle] of pairs) {
      expect(searchMatches(hay, needle), `${needle} in ${hay}`).toBe(true);
      expect(skeletonMatches(hay, needle), `${needle} in ${hay}`).toBe(true);
    }
  });
});

// Cyrillic homoglyphs — the client half of the fold hole documented in
// docs/plans/search-fold-homoglyphs-v1.md. Without a CYR_TO_LATIN entry these fall
// through unchanged and are then stripped by the `[^a-z0-9]` filter, so the word loses a
// letter and matches nothing — the failure is a MISSING character, not a wrong one,
// which is why it never looked like mojibake to anyone.
describe("Cyrillic homoglyphs fold to their Latin lookalike", () => {
  it("keeps the letter instead of dropping it", () => {
    // ЦАИС writes „Раздел І" with a Cyrillic І (U+0406) — 2.16M occurrences corpus-wide.
    expect(latinSkeleton("Раздел І")).toBe("razdeli");
    // Hörmann GmbH, spelled with a Cyrillic ӧ (U+04E7).
    expect(latinSkeleton("Hӧrmann")).toBe("hormann");
    // Bulgarian's own grave-accented и (U+045D).
    expect(latinSkeleton("нѝва")).toBe("niva");
  });

  it("maps every homoglyph the server maps", () => {
    // One assertion per character. A table with only the common cases would still pass
    // if an entry were dropped from CYR_TO_LATIN, and the failure mode is a DELETED
    // letter (the `[^a-z0-9]` filter eats anything unmapped), which reads as a shorter
    // word rather than a wrong one.
    const pairs: [string, string][] = [
      ["і", "i"],
      ["ї", "i"],
      ["ѝ", "i"],
      ["ѵ", "i"],
      ["ѐ", "e"],
      ["ё", "e"],
      ["э", "e"],
      ["є", "e"],
      ["ы", "y"],
      ["ј", "j"],
      ["ѕ", "s"],
      ["ӧ", "o"],
      ["ӓ", "a"],
    ];
    for (const [cyr, latin] of pairs) expect(latinSkeleton(cyr)).toBe(latin);
    // Uppercase rides on the lowercase pass, never on its own entry.
    for (const [cyr, latin] of pairs)
      expect(latinSkeleton(cyr.toUpperCase())).toBe(latin);
  });

  it("folds the Latin letters NFD cannot decompose", () => {
    // ł ø ß æ œ ð đ þ ħ ŋ ı ŧ ŀ ſ are single indivisible code points: the diacritic strip
    // does not touch them, so without LATIN_EXTRA the [^a-z0-9] filter deletes them and
    // the word loses a letter. Real corpus rows (Polish contractors) depend on this.
    expect(latinSkeleton("Wojskowe Zakłady Lotnicze")).toBe(
      "wojskowezakladylotnicze",
    );
    expect(latinSkeleton("Nørrebro")).toBe("norrebro");
    expect(latinSkeleton("Straße")).toBe("strasse");
    expect(latinSkeleton("Æther")).toBe("aether");
    // And the search path a reader actually takes.
    expect(searchMatches("Wojskowe Zakłady Lotnicze Nr2 S.A.", "zaklady")).toBe(
      true,
    );
  });

  it("strips Latin diacritics instead of deleting the letter", () => {
    // The same defect one alphabet over: an accented Latin letter is in neither
    // CYR_TO_LATIN nor [a-z0-9], so without the NFD pass it is DELETED — „Hörmann"
    // became `hrmann` and „Cañón" became `can`. This is also what makes the client
    // agree with the server, which gets it from unaccent().
    expect(latinSkeleton("Hörmann")).toBe("hormann");
    expect(latinSkeleton("Cañón")).toBe("canon");
    expect(latinSkeleton("Škoda")).toBe("skoda");
    // The Cyrillic-ӧ and Latin-ö spellings of the same company now fold alike, which is
    // the whole point — the corpus contains both.
    expect(latinSkeleton("Hӧrmann")).toBe(latinSkeleton("Hörmann"));
  });
});
