// Table 1's row labels are stored in personnel.json and rendered VERBATIM in the
// „Административни структури" tile on /sector/administration, so a strip rule
// that eats one word too many publishes a sentence fragment as the name of a
// public body — at a 200, with the count beside it perfectly correct.
//
// ⚠ THE FIXTURES BELOW COPY THE REAL `pdftotext -layout` SHAPE, INDENTATION AND
// ALL. That is the point of them. pdftotext wraps Table 1's left-gutter cell
// across two lines whose words share lines with DIFFERENT data rows:
//
//   „   Централна        Администрация на Министерския съвет   1    1"
//   „   администрация    Министерства                        19   19"
//
// A synthetic fixture that puts „Централна" on a line of its own tests a layout
// the register does not produce, and passes under a rule that is wrong on the
// real one — which is how the first version of this file certified a change that
// both failed to fix the bug and corrupted ten more labels.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStructureCounts } from "./doklad";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Table 1's real shape: a „Вид администрация Брой" header, a wrapped gutter
 *  cell down the left, and `<label> <prevYear> <thisYear>` rows. */
const REAL_TABLE = [
  "                      Вид администрация                       Брой      Брой",
  "                                                             2024 г.   2025 г.",
  "    Централна          Администрация на Министерския съвет       1         1",
  "    администрация      Министерства                             19        19",
  "                       Държавни агенции                          7         7",
  "    Териториална       Областни администрации                   28        28",
  "    администрация      Общински администрации                  265       260",
  "                       Общински администрации на райони         35        35",
  "  Поради спецификата на своята дейност",
].join("\n");

describe("parseStructureCounts — the wrapped left gutter", () => {
  const out = parseStructureCounts(REAL_TABLE);

  // The bug. A case-INSENSITIVE `Централна\s+администрация` matches the LABEL's
  // own capitalised „Администрация" on the gutter's first line.
  it("does not eat the label's own first word", () => {
    expect(out.central).toHaveProperty(
      "Администрация на Министерския съвет",
      1,
    );
    expect(out.central).not.toHaveProperty("на Министерския съвет");
  });

  // The other half. The lowercase continuation is the ONLY thing prefixing the
  // gutter's second line, so a rule that skips it stores „администрация
  // Министерства" — and that line is a different data row every time.
  it("strips the lowercase gutter continuation", () => {
    expect(out.central).toHaveProperty("Министерства", 19);
    expect(out.territorial).toHaveProperty("Общински администрации", 260);
    for (const side of [out.central, out.territorial])
      for (const key of Object.keys(side))
        expect(key.startsWith("администрация")).toBe(false);
  });

  it("leaves an ungutter-ed row alone", () => {
    expect(out.central).toHaveProperty("Държавни агенции", 7);
    expect(out.territorial).toHaveProperty(
      "Общински администрации на райони",
      35,
    );
  });

  it("reads this year's column, not last year's", () => {
    expect(out.territorial["Общински администрации"]).toBe(260);
  });

  it("splits central from territorial at the section word", () => {
    expect(Object.keys(out.central).sort()).toEqual([
      "Администрация на Министерския съвет",
      "Държавни агенции",
      "Министерства",
    ]);
  });

  it("returns empty rather than throwing when Table 1 is not detectable", () => {
    expect(parseStructureCounts("no table here")).toEqual({
      central: {},
      territorial: {},
    });
  });
});

// The golden arm: the fixture above is hand-written, so it can only ever agree
// with whatever the author believed the layout to be. This one parses the real
// cached Доклад text and requires the result to equal the committed artifact —
// with ONE sanctioned difference, the label this change fixes. Skips where the
// gitignored cache is absent (a fresh clone), which is why the fixture arm
// exists as well.
const CACHE = path.join(REPO_ROOT, "raw_data/budget");
const PERSONNEL = path.join(REPO_ROOT, "data/budget/personnel.json");
const YEARS = [2021, 2022, 2023, 2024, 2025];
const cached = YEARS.filter((y) =>
  fs.existsSync(path.join(CACHE, `doklad-${y}.txt`)),
);

describe.skipIf(cached.length === 0 || !fs.existsSync(PERSONNEL))(
  "parseStructureCounts — against the real Доклади",
  () => {
    const stored = JSON.parse(fs.readFileSync(PERSONNEL, "utf8"))
      .national as Record<
      string,
      { structureCounts: Record<string, Record<string, number>> }
    >;

    it.each(cached)("%i reproduces the committed labels", (y) => {
      const txt = fs.readFileSync(path.join(CACHE, `doklad-${y}.txt`), "utf8");
      const out = parseStructureCounts(txt) as unknown as Record<
        string,
        Record<string, number>
      >;
      const old = stored[String(y)]?.structureCounts;
      expect(old).toBeDefined();

      for (const side of ["central", "territorial"]) {
        const fixed = { ...old[side] };
        // The one sanctioned change: the fragment becomes the whole name. Both
        // carry count 1, so nothing about the numbers moves.
        if ("на Министерския съвет" in fixed) {
          fixed["Администрация на Министерския съвет"] =
            fixed["на Министерския съвет"];
          delete fixed["на Министерския съвет"];
        }
        expect(out[side]).toEqual(fixed);
      }
    });

    it("actually fixed something — the fragment is gone everywhere", () => {
      for (const y of cached) {
        const txt = fs.readFileSync(
          path.join(CACHE, `doklad-${y}.txt`),
          "utf8",
        );
        const out = parseStructureCounts(txt);
        expect(Object.keys(out.central)).not.toContain("на Министерския съвет");
      }
      // Non-vacuity: the committed artifact must still carry the old fragment,
      // otherwise this whole arm is comparing a fix against itself.
      expect(
        cached.some(
          (y) =>
            "на Министерския съвет" in
            stored[String(y)].structureCounts.central,
        ),
      ).toBe(true);
    });
  },
);
