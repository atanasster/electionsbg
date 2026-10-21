// НТР register parsing, against a REST page captured 2026-10-21.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkNtrCompleteness,
  lastPositionOf,
  municipalityIndex,
  parseNtrPage,
  summariseNtr,
  totalOfContentRange,
} from "./ntr";

const page = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "__fixtures__/ntr_mn_page.json",
    ),
    "utf8",
  ),
) as unknown;

describe("parseNtrPage", () => {
  it("reads the REST rows", () => {
    const [o] = parseNtrPage(page);
    expect(o).toMatchObject({
      certificate: "В1-0ГЦ-1ШЕ-А0",
      kind: "Апартаменти за гости",
      municipality: "Варна",
      rooms: 2,
      beds: 4,
      category: "",
    });
  });
  it("throws on the error object a too-large page returns, never reading it as empty", () => {
    expect(() => parseNtrPage({ code: 400, text: "Bad Request" })).toThrow(
      /not a row array/,
    );
  });
  it("throws on a row with no document id", () => {
    expect(() => parseNtrPage([{ TOName: "x" }])).toThrow(/document id/);
  });
});

describe("totalOfContentRange", () => {
  it("reads the view total", () => {
    expect(totalOfContentRange("items 0-99/41457")).toBe(41457);
    expect(totalOfContentRange(null)).toBeNull();
  });
});

describe("municipalityIndex", () => {
  const idx = municipalityIndex([
    { name: "Бяла", obshtina: "VAR05" },
    { name: "Бяла", obshtina: "RSE04" },
    { name: "Искър", obshtina: "PVN23" },
    { name: "Искър", obshtina: "S2414" },
    { name: "Варна", obshtina: "VAR06" },
  ]);
  it("resolves a unique name and refuses an ambiguous one", () => {
    expect(idx.get("Варна")).toBe("VAR06");
    expect(idx.get("Бяла")).toBeNull();
  });
  it("resolves a name НТР disambiguates by oblast, and Sofia to the city-wide code", () => {
    const idx2 = municipalityIndex(
      [
        { name: "Бяла", obshtina: "VAR05", oblast: "VAR" },
        { name: "Бяла", obshtina: "RSE04", oblast: "RSE" },
      ],
      { VAR: "Варна", RSE: "Русе" },
    );
    expect(idx2.get("Бяла - Русе")).toBe("RSE04");
    expect(idx2.get("Бяла - Варна")).toBe("VAR05");
    expect(idx2.get("Бяла")).toBeNull();
    expect(idx2.get("Столична")).toBe("SOF");
  });

  it("ignores Sofia's districts, which are not municipalities", () => {
    expect(idx.get("Искър")).toBe("PVN23");
  });
});

describe("summariseNtr", () => {
  it("counts objects, rooms and beds per municipality, and the unresolved", () => {
    const objs = parseNtrPage(page);
    const s = summariseNtr(
      [...objs, { ...objs[0], unid: "F".repeat(32), municipality: "Бяла" }],
      new Map<string, string | null>([
        ...objs.map((o) => [o.municipality, "XXX01"] as [string, string]),
        ["Бяла", null],
      ]),
      "t",
    );
    expect(s.objects).toBe(objs.length + 1);
    expect(s.unresolvedObjects).toBe(1);
    expect(
      s.municipalities.find((m) => m.municipality === "Бяла")?.obshtina,
    ).toBeNull();
    expect(s.beds).toBe(s.municipalities.reduce((t, m) => t + m.beds, 0));
    expect(s.objectsWithoutBeds).toBe(0);
  });
});

describe("checkNtrCompleteness — positional, because the view total counts hidden entries", () => {
  // The 2026-10-21 shape: 414 full pages and a 22-row last page ending at position 41,463.
  const real = [
    ...Array.from({ length: 414 }, () => ({ rows: 100, lastPosition: 0 })),
    { rows: 22, lastPosition: 41463 },
  ];
  it("accepts a crawl that reached the view's end, and reports the hidden entries", () => {
    expect(checkNtrCompleteness(real, 41463, 100)).toEqual({
      readable: 41422,
      hidden: 41,
    });
  });
  it("ignores empty pages requested past the readable end — the total counts hidden entries", () => {
    const pastEnd = [...real, { rows: 0, lastPosition: null }];
    expect(checkNtrCompleteness(pastEnd, 41463, 100)).toEqual({
      readable: 41422,
      hidden: 41,
    });
  });

  it("refuses a short page before the last", () => {
    const bad = real.map((p, i) => (i === 7 ? { ...p, rows: 99 } : p));
    expect(() => checkNtrCompleteness(bad, 41463, 100)).toThrow(/page 7/);
  });
  it("refuses a crawl that stopped before the view's end", () => {
    expect(() => checkNtrCompleteness(real.slice(0, 300), 41463, 100)).toThrow(
      /stopped short/,
    );
  });
  it("reads the last row's position", () => {
    expect(lastPositionOf(page)).toBe(3);
    expect(lastPositionOf([])).toBeNull();
  });
});
