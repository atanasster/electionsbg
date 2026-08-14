// SEED EXAMPLE — the "scripts pure function" layer. See docs/testing-standards.md.
//
// Data-pipeline code is mostly pure transforms (parse, normalize, derive an id).
// Test them the same way as frontend utils — input -> output, no I/O — but they
// run in the `node` Vitest project (no jsdom). Co-located *.test.ts, run with
// `npm run test:unit` (or the whole scripts subtree via a namespaced runner).
import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("transliterates Bulgarian and prefixes the result", () => {
    expect(slugify("Данъчни приходи", "eco")).toBe("eco-danachni-prihodi");
  });

  it("is deterministic — same input, same id", () => {
    expect(slugify("Общински съвет", "vote")).toBe(
      slugify("Общински съвет", "vote"),
    );
  });

  it("collapses punctuation/whitespace runs to single hyphens, trimmed", () => {
    expect(slugify("  А, Б  —  В  ", "x")).toBe("x-a-b-v");
  });

  it("caps the slug body at 60 chars", () => {
    const body = slugify("а".repeat(100), "p").slice("p-".length);
    expect(body.length).toBe(60);
  });

  it("falls back to the bare prefix when nothing survives folding", () => {
    expect(slugify("!!!", "p")).toBe("p");
    expect(slugify("", "p")).toBe("p");
  });

  // The slug IS the node identity, so an invisible character does not produce an
  // ugly id — it produces a SECOND node holding whatever years it appeared in,
  // with nothing visible in a diff, a row count or the rendered name.
  describe("invisible formatting characters", () => {
    const SHY = "­"; // soft hyphen
    const ZWSP = "​";
    const ZWNJ = "‌";
    const ZWJ = "‍";
    const WJ = "⁠"; // word joiner
    const BOM = "﻿";

    it("strips a soft hyphen instead of breaking the word on it", () => {
      // The live case: the 2019 budget law spelled МРРБ with a soft hyphen and
      // minted `admin-…-blago-ustroystvoto`, orphaning FY2019 away from the
      // canonical node — /governance/sectors then had no 2019 for регионално
      // развитие while the €264,181,243 sat in the repo.
      expect(
        slugify(
          `Министерство на регионалното развитие и благо${SHY}устройството`,
          "admin",
        ),
      ).toBe("admin-ministerstvo-na-regionalnoto-razvitie-i-blagoustroystvoto");
    });

    it("makes the marked and unmarked spellings the SAME id", () => {
      // This is the property that matters — not the exact string above. Two
      // spellings of one name must not be two nodes.
      const plain = "Бюджетна програма „Администрация“";
      const marked = `Бюджетна програма „Администра${SHY}ция“`;
      expect(slugify(marked, "prog")).toBe(slugify(plain, "prog"));
    });

    it("strips the zero-width family and the BOM too", () => {
      for (const ch of [ZWSP, ZWNJ, ZWJ, WJ, BOM]) {
        expect(slugify(`Админи${ch}страция`, "x")).toBe("x-administratsiya");
      }
      expect(slugify(`${BOM}Приходи`, "x")).toBe("x-prihodi");
    });

    it("strips every invisible mark, not an enumerated handful", () => {
      // The rule is the Unicode FORMAT property plus the two invisible marks
      // outside it, precisely so this list never has to be edited again. The
      // bidi marks are not exotic here: U+200E/U+200F travel with the same
      // HTML-export and DTP-conversion provenance that put the soft hyphen in
      // the 2019 budget law, so the next occurrence is likelier to be one of
      // these than another U+00AD.
      const marks = [
        0x00ad, 0x061c, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a,
        0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064,
        0x2066, 0x2067, 0x2068, 0x2069, 0x034f, 0xfe00, 0xfe0f, 0xfeff,
      ];
      const split = marks.filter(
        (cp) =>
          slugify(`Админи${String.fromCodePoint(cp)}страция`, "x") !==
          "x-administratsiya",
      );
      expect(
        split.map(
          (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
        ),
      ).toEqual([]);
    });

    it("still breaks on a REAL hyphen, which is part of the name", () => {
      // The strip must not overreach: U+002D is written by the author and
      // carries meaning, unlike U+00AD.
      expect(slugify("Стара-Загора", "x")).toBe("x-stara-zagora");
    });

    it("does not let an invisible run rescue an otherwise empty name", () => {
      expect(slugify(`${SHY}${ZWSP}`, "p")).toBe("p");
    });

    it("strips before the 60-char cap, so the cap counts real letters", () => {
      // Order matters: stripping after the slice would let invisible marks eat
      // into the budget and shorten the id.
      const name = "а".repeat(30).split("").join(SHY);
      expect(slugify(name, "p").slice("p-".length)).toBe("a".repeat(30));
    });
  });
});
