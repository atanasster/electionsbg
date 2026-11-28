import { describe, expect, it } from "vitest";
import { deflateSync } from "zlib";
import {
  LZW_RESET_AT,
  binaryToUtf8,
  decodeInfoApp,
  lzwDecode,
  lzwEncode,
  parseImmunizations,
  repairMojibake,
} from "./his_infoapp";

const toBinary = (s: string) => Buffer.from(s, "utf8").toString("latin1");

/** Build a page the way the info-app ships it: chunked LZW inside zlib JSON. */
const buildPage = (
  strings: unknown[],
  rows: number[][],
  chunk = 7,
  resetAt?: number,
): string => {
  const enc = (v: unknown) => {
    const s = lzwEncode(toBinary(JSON.stringify(v)), resetAt);
    const out: string[] = [];
    for (let i = 0; i < s.length; i += chunk) out.push(s.slice(i, i + chunk));
    return out;
  };
  const fields = [
    ["year", "$m$a"],
    ["month", "$m$b"],
    ["cl015_key", "$m$c"],
    ["region", "$m$e"],
    ["age_group", "$m$j"],
    ["age_order", "$m$k"],
    ["gender", "$m$l"],
    ["vaccine", "$m$f"],
    ["number_of_immunizations", "$m$g"],
    ["unique_patients", "$m$h"],
    ["nsi_numbers", "$m$i"],
    // GUUT's overflow columns, empty except on rows a cut label shifted.
    ["field12", "$m$m"],
    ["field13", "$m$n"],
    ["field14", "$m$o"],
  ];
  const fieldIndex = Object.fromEntries(fields.map(([, m], i) => [m, i]));
  const infoObject = {
    Sheet_1: {
      orgColumns: {
        columns: fields.map(([field, mapindex]) => ({ field, mapindex })),
      },
    },
  };
  const infoData = {
    Sheet_1: {
      fieldIndex,
      compressed: true,
      dataencoded: true,
      stringsencoded: true,
      data: enc(rows),
      strings: enc(strings),
    },
  };
  const b64 = deflateSync(Buffer.from(JSON.stringify(infoData))).toString(
    "base64",
  );
  return `<html><script>var infoObject=${JSON.stringify(infoObject)};
var infoData="${b64}";draw(infoObject, infoData)</script></html>`;
};

describe("lzwDecode", () => {
  it("decodes literals — three base64url chars, low bits first", () => {
    // '[' = 91 = 27 + 1*64 → "b","B","A"
    expect(lzwDecode("bBAbBA")).toBe("[[");
  });

  it("round-trips a repetitive stream (back-references incl. KwKwK)", () => {
    const s = "abababababababab" + "x".repeat(50) + '{"a":[1,2,3]}'.repeat(20);
    expect(lzwDecode(lzwEncode(s))).toBe(s);
  });

  it("round-trips across the dictionary reset", () => {
    // A JSON-ish stream with irregular repetition (a seeded LCG over words),
    // so phrases built after a reset differ from those before it.
    const words = [
      "[2025,",
      '"Sofia",',
      "60 - 79",
      "Female",
      "0,",
      "14626]",
      ":",
    ];
    let seed = 12345;
    let s = "";
    while (s.length < 6000) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      s += words[seed % words.length];
    }
    const resetAt = 300; // tiny, so the stream crosses many resets
    const enc = lzwEncode(s, resetAt);
    expect(lzwDecode(enc, resetAt)).toBe(s);
    // Without the reset the same stream does not come back — it either throws
    // (the measured failure on the real file) or decodes to something else.
    let wrong: string | null;
    try {
      wrong = lzwDecode(enc, 1 << 20);
    } catch {
      wrong = null;
    }
    expect(wrong).not.toBe(s);
  });

  it("uses an 18-bit reset by default", () => {
    expect(LZW_RESET_AT).toBe((1 << 18) - 2);
  });

  it("rejects a stream whose length is not a multiple of 3", () => {
    expect(() => lzwDecode("bBAb")).toThrow(/multiple of 3/);
  });
});

describe("text repair", () => {
  it("re-decodes UTF-8 bytes", () => {
    expect(binaryToUtf8(toBinary("Благоевград"))).toBe("Благоевград");
  });
  it("repairs a doubly-encoded label and leaves clean text alone", () => {
    expect(repairMojibake("Meningococcal vaccine (Ð\u0092)")).toBe(
      "Meningococcal vaccine (В)",
    );
    expect(repairMojibake("Sofia City")).toBe("Sofia City");
    expect(repairMojibake("Café")).toBe("Café");
    // Looks like UTF-8-as-Latin-1 but re-decodes to a replacement character.
    expect(repairMojibake("é»")).toBe("é»");
  });
});

describe("parseImmunizations", () => {
  const strings = [
    2025,
    "2025-10-02T00:00:00",
    1,
    "Blagoevgrad",
    "60 - 79",
    6,
    "Female",
    "Seasonal influenza vaccine",
    120,
    118,
    14626,
    "Male",
    80,
    "Meningococcal vaccine (Ð\u0092)",
  ];
  const rows = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [0, 1, 2, 3, 4, 5, 11, 13, 12, 12, 10],
  ];

  it("decodes chunked sheets that cross chunk boundaries", () => {
    const sheets = decodeInfoApp(buildPage(strings, rows, 5));
    expect(sheets.Sheet_1.rows).toHaveLength(2);
    expect(sheets.Sheet_1.columns.vaccine).toBe(7);
  });

  it("returns typed cells", () => {
    const out = parseImmunizations(buildPage(strings, rows));
    expect(out[0]).toEqual({
      period: "2025-10",
      oblastKey: 1,
      region: "Blagoevgrad",
      ageBand: "60 - 79",
      ageOrder: 6,
      sex: "F",
      vaccine: "Seasonal influenza vaccine",
      n: 120,
      uniquePatients: 118,
      population: 14626,
    });
    expect(out[1].sex).toBe("M");
    expect(out[1].vaccine).toBe("Meningococcal vaccine (В)");
  });

  it("throws when a row references a missing string", () => {
    expect(() =>
      parseImmunizations(
        buildPage(strings, [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 99]]),
      ),
    ).toThrow(/out-of-range/);
  });

  it("throws on a blank count or label rather than publishing a zero", () => {
    const blank = [...strings, null, ""];
    const iNull = strings.length;
    const iEmpty = strings.length + 1;
    expect(() =>
      parseImmunizations(
        buildPage(blank, [[0, 1, 2, 3, 4, 5, 6, 7, iNull, 9, 10]]),
      ),
    ).toThrow(/number_of_immunizations/);
    expect(() =>
      parseImmunizations(
        buildPage(blank, [[0, 1, 2, 3, 4, 5, 6, iEmpty, 8, 9, 10]]),
      ),
    ).toThrow(/vaccine/);
  });

  it("drops a trailing all-null footer row, and only a trailing one", () => {
    const withNull = [...strings, null];
    const iNull = strings.length;
    const footer = [iNull, ...Array(9).fill(null), iNull];
    const out = parseImmunizations(
      buildPage(withNull, [...rows, footer as number[]]),
    );
    expect(out).toHaveLength(2);
    expect(() =>
      parseImmunizations(buildPage(withNull, [footer as number[], ...rows])),
    ).toThrow(/out-of-range/);
  });

  it("translates the Bulgarian labels back to the English join keys", () => {
    const bg = [
      2026,
      "2026-11-02T00:00:00",
      22,
      "София Град",
      "60 - 79",
      6,
      "Жена",
      "Ваксина срещу сезонен грип",
      120,
      118,
      14626,
      "Мъж",
      23,
      "София Област",
      "Ваксина срещу нещо ново",
    ];
    const out = parseImmunizations(
      buildPage(bg, [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        [0, 1, 12, 13, 4, 5, 11, 7, 8, 9, 10],
        // A key whose Bulgarian name is the OTHER Sofia stays untranslated,
        // so oblastCodeFor refuses it downstream; so does an unknown vaccine.
        [0, 1, 12, 3, 4, 5, 6, 14, 8, 9, 10],
      ]),
    );
    expect(out[0]).toMatchObject({
      region: "Sofia City",
      sex: "F",
      vaccine: "Seasonal influenza vaccine",
      n: 120,
    });
    expect(out[1]).toMatchObject({ region: "Sofia", sex: "M" });
    expect(out[2].region).toBe("София Град");
    expect(out[2].vaccine).toBe("Ваксина срещу нещо ново");
  });

  describe("a label the source cut at its first comma", () => {
    const s = [
      2026,
      "2026-11-02T00:00:00",
      1,
      "Благоевград",
      "0 - 4",
      1,
      "Жена",
      "Комбинирана ваксина срещу морбили",
      "Ваксина срещу менингококи (А",
      73,
      6301,
      14,
      5943,
      null,
    ];
    // An empty cell is an index into a null string, as in the real sheet.
    const N = s.length - 1;

    it("reads the counts the lost label pieces pushed right", () => {
      const out = parseImmunizations(
        buildPage(s, [
          // MMR: 2 commas → n, u, nsi sit two slots along the tail.
          [0, 1, 2, 3, 4, 5, 6, 7, N, N, 9, 9, 10, N],
          // A, C, W135, Y: 3 commas → three slots along.
          [0, 1, 2, 3, 4, 5, 6, 8, N, N, N, 11, 11, 12],
        ]),
      );
      expect(out[0]).toMatchObject({
        vaccine: "Measles, Mumps, and Rubella (MMR) combined vaccine",
        n: 73,
        uniquePatients: 73,
        population: 6301,
      });
      expect(out[1]).toMatchObject({
        vaccine: "Meningococcal vaccine (A, C, W135, Y)",
        n: 14,
        uniquePatients: 14,
        population: 5943,
      });
    });

    it("throws when the row does not carry the implied shift", () => {
      // Unshifted counts under a cut label: the leading slots are not empty.
      expect(() =>
        parseImmunizations(
          buildPage(s, [[0, 1, 2, 3, 4, 5, 6, 7, 9, 9, 10, N, N, N]]),
        ),
      ).toThrow(/2-column shift/);
      // A value past the three shifted counts.
      expect(() =>
        parseImmunizations(
          buildPage(s, [[0, 1, 2, 3, 4, 5, 6, 7, N, N, 9, 9, 10, 9]]),
        ),
      ).toThrow(/2-column shift/);
    });
  });

  it("throws on an unknown gender", () => {
    const odd = [...strings, "Друг"];
    expect(() =>
      parseImmunizations(
        buildPage(odd, [[0, 1, 2, 3, 4, 5, strings.length, 7, 8, 9, 10]]),
      ),
    ).toThrow(/unknown gender/);
  });

  it("throws on a page with no payload", () => {
    expect(() => parseImmunizations("<html></html>")).toThrow(/infoObject/);
  });
});
