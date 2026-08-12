// The artifact parser, unit-tested without a database.
//
// This is the one place a malformed line could become a wrong COUNT rather than an error, and
// the wrong count that matters is 1: Bridge B mints on `people_n = 1`, so a line mis-parsed
// down to 1 hands a public figure their namesake's companies. Everything here is about
// refusing rather than guessing.
//
//   npm run test:unit

import { describe, it, expect } from "vitest";
import { parseTsv } from "./load_tr_name_fold_people_pg";

describe("parseTsv", () => {
  it("reads (fold, count) pairs", () => {
    const { rows, bad } = parseTsv(
      "ivan georgiev takuchev\t1\npetar petrov\t3\n",
    );
    expect(rows).toEqual([
      ["ivan georgiev takuchev", 1],
      ["petar petrov", 3],
    ]);
    expect(bad).toEqual([]);
  });

  it("rejects a count that is not a positive integer, rather than coercing it", () => {
    // Number("") is 0 and Number("1.5") is 1.5 — both would sail through a naive parse, and
    // a 0 or a fraction in this column is a fold the guard would then mis-answer.
    const { rows, bad } = parseTsv(
      ["a\t0", "b\t-2", "c\t1.5", "d\t", "e\tx", "f\t01"].join("\n"),
    );
    expect(rows).toEqual([]);
    expect(bad).toHaveLength(6);
  });

  it("rejects a line with no tab instead of treating the whole line as a fold", () => {
    const { rows, bad } = parseTsv("no-tab-here\n");
    expect(rows).toEqual([]);
    expect(bad).toEqual(["no-tab-here"]);
  });

  it("keeps a fold that CONTAINS a tab out of the good rows", () => {
    // Split-on-tab would make this a 3-column line and read the count off the wrong field —
    // "a" / "b" / "2" parses to ("a", NaN) at best and ("a", 2) at worst, which is a fold
    // claiming a count that belongs to a different string.
    const { rows, bad } = parseTsv("a\tb\t2\n");
    expect(rows).toEqual([]);
    expect(bad).toEqual(["a\tb\t2"]);
  });

  it("ignores blank lines, including the trailing newline", () => {
    expect(parseTsv("a\t1\n\n").rows).toEqual([["a", 1]]);
    expect(parseTsv("a\t1\n\n").bad).toEqual([]);
  });
});
