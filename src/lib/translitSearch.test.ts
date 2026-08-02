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
  searchMatches,
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
});
