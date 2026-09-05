import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeBundleText,
  decodeCp1251,
  decodeMik,
  parseSemicolonRows,
  stripBom,
} from "./encoding";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (rel: string): Uint8Array | null => {
  const f = path.join(PROJECT_ROOT, rel);
  return fs.existsSync(f) ? fs.readFileSync(f) : null;
};

describe("decodeMik", () => {
  it("maps 0x80–0xBF onto the whole Cyrillic alphabet", () => {
    const bytes = new Uint8Array(
      Array.from({ length: 0x40 }, (_, i) => 0x80 + i),
    );
    expect(decodeMik(bytes)).toBe(
      "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя",
    );
  });

  // ⚠ The whole reason this function exists rather than an `iconv` call. cp866 agrees
  // with MIK on 0x80–0xAF and diverges exactly at 0xB0, where it puts box-drawing —
  // so a cp866 read yields „Избо░и за п░езиден▓", which is 75% right and therefore
  // survives review.
  it("is NOT cp866 — 0xB0 is `р`, not `░`", () => {
    expect(decodeMik(new Uint8Array([0xb0]))).toBe("р");
    expect(decodeMik(new Uint8Array([0xb0]))).not.toBe("░");
    // The word „Избори", byte for byte.
    const izbori = new Uint8Array([0x88, 0xa7, 0xa1, 0xae, 0xb0, 0xa8]);
    expect(decodeMik(izbori)).toBe("Избори");
  });

  it("passes ASCII through unchanged", () => {
    expect(decodeMik(new TextEncoder().encode("01;6;11.11.2001;537"))).toBe(
      "01;6;11.11.2001;537",
    );
  });

  // A byte above 0xBF means the file is not MIK. Decoding it anyway is the silent
  // mojibake this module exists to prevent, so the default refuses.
  it("throws on a byte above 0xBF, and can be asked to replace instead", () => {
    const bad = new Uint8Array([0x88, 0xf0]);
    expect(() => decodeMik(bad)).toThrow(/above 0xBF/);
    expect(decodeMik(bad, { onUnmapped: "replace" })).toBe("И�");
  });

  it("decodes the real 2001 archive", (ctx) => {
    const bytes = read("raw_data/2001_11_11_pvr/ТУР1/COMMON.201");
    if (!bytes) return ctx.skip("2001 tree absent");
    const text = decodeMik(bytes);
    // The election's own name, and the six 2001 tickets by their presidents.
    expect(text).toContain("Президент и Вицепрезидент");
    expect(text).toContain("Георги Седефчов Първанов");
    expect(text).toContain("Петър Стефанов Стоянов");
    expect(text).toContain("Ренета Иванова Инджова");
    // Mojibake control: a UTF-8 read of the same bytes must NOT produce this.
    expect(new TextDecoder("utf-8").decode(bytes)).not.toContain("Президент");
  });

  // Both rounds, and an EXACT count: `> 30` would pass with three oblast files
  // silently missing, and round 2 was never touched at all.
  it.each([
    ["ТУР1", ".201"],
    ["ТУР2", ".301"],
  ])(
    "decodes every 2001 %s file without an unmapped byte",
    (round, ext, ctx) => {
      const dir = path.join(PROJECT_ROOT, "raw_data/2001_11_11_pvr", round);
      if (!fs.existsSync(dir)) return ctx.skip("2001 tree absent");
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(ext));
      // 31 МИР + `32` abroad + COMMON — the whole country, once per round.
      expect(files.length, `${round}: 32 oblast files + COMMON${ext}`).toBe(34);
      for (const f of files) {
        expect(
          () => decodeMik(fs.readFileSync(path.join(dir, f))),
          `${round}/${f}`,
        ).not.toThrow();
      }
    },
  );
});

describe("decodeCp1251", () => {
  it("decodes the real 2011 candidates file", (ctx) => {
    const bytes = read(
      "raw_data/2011_10_23_pvr/ТУР1/el2011_president_candidates.txt",
    );
    if (!bytes) return ctx.skip("2011 tree absent");
    const text = decodeCp1251(bytes);
    expect(text).toContain("Меглена Щилиянова Кунева");
    expect(text).toContain("Росен Асенов Плевнелиев");
    // Mojibake control.
    expect(new TextDecoder("utf-8").decode(bytes)).not.toContain("Кунева");
  });

  it("decodes the real 2006 readme, whose ticket names live only there", (ctx) => {
    const bytes = read("raw_data/2006_10_22_pvr/ТУР1/Readme.txt");
    if (!bytes) return ctx.skip("2006 tree absent");
    const text = decodeCp1251(bytes);
    expect(text).toContain("Георги Първанов");
    expect(text).toContain("Волен Сидеров");
  });
});

describe("stripBom", () => {
  it("removes a leading BOM and leaves other text alone", () => {
    expect(stripBom("﻿13;ИК")).toBe("13;ИК");
    expect(stripBom("13;ИК")).toBe("13;ИК");
  });

  // ⚠ THE HAZARD IS STRING IDENTITY, NOT NUMERIC PARSING — and getting that backwards
  // is easy, because `Number("\uFEFF13")` is 13, not NaN: U+FEFF is JS whitespace, so
  // every numeric coercion tolerates it. What does NOT tolerate it is equality, and a
  // ticket number is a JOIN KEY: the candidates file's "\uFEFF13" never matches the
  // votes file's "13", so ticket 13 — Радев in 2016 — silently drops out of the join
  // with every count still reconciling.
  //
  // `new TextDecoder("utf-8")` already strips the BOM, so the bundle path is safe on
  // its own; `stripBom` covers readers that do not (`ignoreBOM: true`, a
  // `Buffer.toString()`, a hand-concatenated string) and the two non-UTF-8 paths.
  it("keeps the first field usable as a join key", (ctx) => {
    const bytes = read(
      "raw_data/2016_11_06_pvr/ТУР2/cik_candidates_13.11.2016.txt",
    );
    if (!bytes) return ctx.skip("2016 tree absent");
    // This file genuinely starts with one, and its round-1 sibling does not.
    // Array.from, because readFileSync hands back a Buffer and `toEqual` treats
    // Buffer and Uint8Array as different shapes even with identical bytes.
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);

    const kept = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    const keptField = kept.split(";")[0];
    // The trap: it still looks like a number …
    expect(Number(keptField)).toBe(13);
    // … and is not the string anything joins on.
    expect(keptField).not.toBe("13");
    expect(keptField).toHaveLength(3);
    expect(stripBom(keptField)).toBe("13");

    // The bundle path is safe either way.
    expect(decodeBundleText(bytes, "utf8").split(";")[0]).toBe("13");
  });
});

describe("decodeBundleText", () => {
  it("dispatches on the era's declared encoding", () => {
    const cyrillic = new Uint8Array([0x88, 0xa7, 0xa1, 0xae, 0xb0, 0xa8]);
    expect(decodeBundleText(cyrillic, "mik")).toBe("Избори");
    expect(decodeBundleText(new Uint8Array([0xcc, 0xe5]), "cp1251")).toBe("Ме");
    expect(decodeBundleText(new TextEncoder().encode("Из"), "utf8")).toBe("Из");
  });
});

describe("parseSemicolonRows", () => {
  // ⚠ Both line endings occur for the SAME file: published CRLF, committed LF by
  // `core.autocrlf = input`. A reader that handles one leaves a trailing \r on the
  // last field (breaking Number()) or returns a single giant row.
  it("handles CRLF, LF and a mix", () => {
    expect(parseSemicolonRows("a;1\r\nb;2\r\n")).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(parseSemicolonRows("a;1\nb;2\n")).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(parseSemicolonRows("a;1\r\nb;2\n")).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
  });

  it("leaves no carriage return on the last field", () => {
    const [row] = parseSemicolonRows("010100001;256;6;99;0\r\n");
    expect(row[4]).toBe("0");
    expect(Number(row[4])).toBe(0);
  });

  it("drops blank lines rather than emitting empty rows", () => {
    expect(parseSemicolonRows("a;1\n\n\nb;2\n")).toHaveLength(2);
  });
});

// ⚠ Every test above feeds `parseSemicolonRows` a literal, and the real files carry
// two shapes nobody writes by hand: the 2011 sections rows begin with an EMPTY first
// field (the section-type flag, blank for an ordinary section) and the 2006 protocol
// rows end with a trailing empty one. Both are handled today; this is what pins it,
// because a `.filter(Boolean)` added to the splitter would silently shift every
// column in both files.
describe("parseSemicolonRows on the real bundles", () => {
  it("keeps the 2011 sections' empty LEADING field", (ctx) => {
    const bytes = read(
      "raw_data/2011_10_23_pvr/ТУР1/el2011_president_sections.txt",
    );
    if (!bytes) return ctx.skip("2011 tree absent");
    const rows = parseSemicolonRows(decodeBundleText(bytes, "cp1251"));
    expect(rows.length).toBe(11784);
    // `;290100001;ЧУЖБИНА;…` — field 0 is the section-type flag and is blank here, so
    // the section CODE is field 1. Dropping it moves every column left by one.
    expect(rows[0][0]).toBe("");
    expect(rows[0][1]).toMatch(/^\d{9}$/);
    expect(new Set(rows.map((r) => r.length)).size, "uniform width").toBe(1);
  });

  it("keeps the 2006 protocols' trailing empty field", (ctx) => {
    const bytes = read(
      "raw_data/2006_10_22_pvr/ТУР1/izbori2006_T1_protocols.txt",
    );
    if (!bytes) return ctx.skip("2006 tree absent");
    const rows = parseSemicolonRows(decodeBundleText(bytes, "cp1251"));
    expect(rows.length).toBe(11809);
    expect(rows[0][0]).toMatch(/^\d{9}$/);
    expect(new Set(rows.map((r) => r.length)).size, "uniform width").toBe(1);
    expect(rows[0][rows[0].length - 1]).toBe("");
  });

  it("reads a whole 2021 votes file, CRLF or LF", (ctx) => {
    const bytes = read("raw_data/2021_11_14_pvr/ТУР1/votes_14.11.2021.txt");
    if (!bytes) return ctx.skip("2021 tree absent");
    const rows = parseSemicolonRows(decodeBundleText(bytes, "utf8"));
    expect(rows.length).toBe(15616);
    // No row may end in a stray carriage return, whichever ending the checkout has.
    expect(rows.every((r) => !r[r.length - 1].includes("\r"))).toBe(true);
    expect(rows[0][0]).toBe("32");
  });
});
