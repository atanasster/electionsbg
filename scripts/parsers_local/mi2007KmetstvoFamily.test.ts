// Which of the 2007 archive's two кметство page families represents a seat.
//
// The archive publishes every кметство twice and the ingest walked both, which is where 2,395
// duplicate entries and ~1,243 phantom village mayors came from. The families are not two
// views of one result — they disagree on the winner in 1,267 of the 2,354 places carrying
// both — so picking the wrong one republishes ~2,300 named people incorrectly.
//
// `results` wins, adjudicated against two independent sources (the ОИК's own decision text:
// 883–2; the round-2 pairing: 897–1). See docs/plans/village-mayor-attribution-v1.md §T3.

import { describe, it, expect } from "vitest";
import {
  foldKmetstvoName,
  kmetstvoPageFamily,
  preferKmetstvoPage,
  type KmetstvoPageFamily,
} from "./ingest_mi2007";

/** The generic's constraint is `{ family: KmetstvoPageFamily }`; widening the literal keeps
 *  both arguments assignable to ONE T instead of inferring T from the first one. */
type Page = { family: KmetstvoPageFamily; tag: string };

describe("kmetstvoPageFamily", () => {
  // The marker sits inside markup — the phrase is split across tags in the real pages, which
  // is why a plain `raw.includes()` on the HTML silently classified everything as `results`.
  it("detects the decision family through the markup", () => {
    expect(
      kmetstvoPageFamily(
        "<h1>Окончателни резултати <b>по решение</b> на\n  ОИК</h1>",
      ),
    ).toBe("decision");
    expect(
      kmetstvoPageFamily("<td>по&nbsp;решение&nbsp;на&nbsp;ОИК</td>"),
    ).toBe("decision");
  });

  it("treats a page without the marker as the results family", () => {
    expect(
      kmetstvoPageFamily(
        "<h1>Окончателни резултати</h1><div>І тур ІІ тур</div>",
      ),
    ).toBe("results");
    expect(kmetstvoPageFamily("")).toBe("results");
  });
});

describe("preferKmetstvoPage", () => {
  const decision: Page = { family: "decision", tag: "A" };
  const results: Page = { family: "results", tag: "B" };

  it("prefers results over decision, in either arrival order", () => {
    expect(preferKmetstvoPage(decision, results).tag).toBe("B");
    expect(preferKmetstvoPage(results, decision).tag).toBe("B");
  });

  it("keeps a decision page when it is the only one", () => {
    // 107 of the 3,013 кметства have no results page at all — dropping the family outright
    // would lose them rather than de-duplicate them.
    expect(preferKmetstvoPage(undefined, decision).tag).toBe("A");
  });

  it("keeps the first page of a repeated family, so the walk is deterministic", () => {
    const first: Page = { family: "results", tag: "first" };
    const second: Page = { family: "results", tag: "second" };
    expect(preferKmetstvoPage(first, second).tag).toBe("first");
  });

  it("takes the newcomer when there is nothing yet", () => {
    expect(preferKmetstvoPage(undefined, results).tag).toBe("B");
  });
});

describe("foldKmetstvoName", () => {
  // Every pair below is ONE seat the two families spell differently — measured on the
  // archive. Folding them apart left duplicate entries, which is what the de-duplication is
  // for; two of them (Гара Бов, Гара Лакатник) additionally published the round-1 leader as
  // кмет because the decision page's path has no round-2 twin.
  it.each([
    ["union form", "Бояново и Стройно", "Бояново"],
    ["union form", "Маломирово и Славейково", "Маломирово"],
    ["union form", "Мелница и Малко Кирилово", "Мелница"],
    ["type prefix", "С. Ваксево", "Ваксево"],
    ["type prefix", "Гара Бов", "Бов"],
    ["separator", "Алеко-Константиново", "Алеко Константиново"],
    ["separator", "Даскал Атанасово", "Даскал-Атанасово"],
    ["separator", "Злато Поле", "Златополе"],
  ])("folds a %s variant to one key (%s == %s)", (_kind, a, b) => {
    expect(foldKmetstvoName(a)).toBe(foldKmetstvoName(b));
  });

  // …and it must not merge two names that are simply different words, or the de-duplication
  // would silently drop a real seat.
  it.each([
    ["Безмер", "Ботево"],
    ["Доситиево", "Черешово"],
    ["Бояново", "Стройно"],
  ])("keeps unrelated names apart (%s vs %s)", (a, b) => {
    expect(foldKmetstvoName(a)).not.toBe(foldKmetstvoName(b));
  });

  it("is case- and whitespace-insensitive", () => {
    expect(foldKmetstvoName("  БЕЗМЕР ")).toBe(foldKmetstvoName("Безмер"));
  });
});
