// Gates for the ONE councillor identity fold.
//
// The defect these close attached votes to the wrong person and lost 4,899 of
// 28,214 attributions. The fold existed twice — `normaliseCouncillorName` +
// first+last in TypeScript on the vote side, and an inline
// `lower(split_part(...))` in SQL on the roster side — and the two computed
// different equivalence classes. The safety guard ("refuse a name held by two
// people in this município") was evaluated on one and the join used the other,
// so the guard could pass a pair it should refuse.

import { describe, expect, it } from "vitest";
import { councilNameKey, normaliseCouncillorName } from "./tally";

/** The naive fold the SQL side used. Kept here ONLY as the negative control:
 *  every case below where it disagrees is a real defect it caused. */
const naive = (raw: string): string => {
  const p = raw.toLowerCase().split(/\s+/).filter(Boolean);
  return p.length < 2 ? (p[0] ?? "") : `${p[0]} ${p[p.length - 1]}`;
};

describe("councilNameKey", () => {
  it("reduces a three-part name to first+last", () => {
    expect(councilNameKey("Александра Тодорова Тодорова")).toBe(
      "александра тодорова",
    );
  });

  it("is idempotent on an already-folded protocol key", () => {
    // The vote side feeds it `normKey`, which the parser already folded.
    expect(councilNameKey("александра тодорова")).toBe("александра тодорова");
  });

  it("strips й to и, as the parser's NFD normalisation does", () => {
    // 4,448 of the 4,899 lost votes. `Йордан` -> `иордан` on the vote side, and
    // the roster's lower() kept `йордан`, so these could never match.
    expect(councilNameKey("Йордан Найденов Иванов")).toBe("иордан иванов");
    expect(naive("Йордан Найденов Иванов")).not.toBe(
      councilNameKey("Йордан Найденов Иванов"),
    );
  });

  it("collapses a hyphenated surname into its last token", () => {
    // 451 votes across 29 hyphenated members. The parser turns the hyphen into
    // a space BEFORE first+last, so the family name is the part after it.
    expect(councilNameKey("Мариета Ангелова Тимнева-Рохова")).toBe(
      "мариета рохова",
    );
    expect(councilNameKey("Валерия-Тереза Тошкова Дончева")).toBe(
      "валерия дончева",
    );
  });

  it("keeps the officials layer's disambiguation suffix distinct", () => {
    // `…василев1` is how the officials layer separates two people with an
    // identical three-part name. The two must NOT fold together silently —
    // they fold to different keys here, and where a município holds both under
    // one key the loader refuses rather than picking one.
    expect(councilNameKey("Валери Иванов Василев")).toBe("валери василев");
    expect(councilNameKey("Валери Иванов Василев1")).toBe("валери василев1");
  });

  it("handles single-token and empty input without inventing a key", () => {
    expect(councilNameKey("Иван")).toBe("иван");
    expect(councilNameKey("   ")).toBe("");
    // The naive SQL form produced `иван иван` for a single token — a third way
    // for the two equivalence classes to diverge.
    expect(councilNameKey("Иван")).not.toBe("иван иван");
  });

  it("normalises repeated whitespace and tabs", () => {
    expect(councilNameKey("Иван\t\tПетров   Георгиев")).toBe("иван георгиев");
  });

  it("is built on normaliseCouncillorName, not beside it", () => {
    // If someone reimplements the reduction without the normalisation, this
    // fails — which is the drift that caused FINDING-001/002.
    const raw = "Йордан Найденов Тимнева-Рохова";
    const parts = normaliseCouncillorName(raw).split(/\s+/);
    expect(councilNameKey(raw)).toBe(`${parts[0]} ${parts[parts.length - 1]}`);
  });
});
