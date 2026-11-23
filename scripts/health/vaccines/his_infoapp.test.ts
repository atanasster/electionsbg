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

  it("throws on a page with no payload", () => {
    expect(() => parseImmunizations("<html></html>")).toThrow(/infoObject/);
  });
});
