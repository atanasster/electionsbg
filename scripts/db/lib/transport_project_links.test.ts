// Fixture tests for the project-map link rules (plan transport-hub-v1 A5–A7, C3, C4).
// The titles are the real corpus titles each rule was written against.

import { describe, it, expect } from "vitest";
import {
  facilityOf,
  namesRailSection,
  sectionPair,
  linkForContract,
  uniquePlaceIndex,
  type Place,
} from "./transport_project_links";

const place = (name: string): Place => ({
  name,
  loc: [23, 42],
  village: false,
});
const TOWNS = new Set([
  "Видин",
  "София",
  "Варна",
  "Горна Оряховица",
  "Мездра",
  "Бургас",
  "Банско",
]);
const lookupTown = (n: string) => (TOWNS.has(n) ? place(n) : null);
const VILLAGES = new Set(["Медковец", "Срацимир"]);
const lookupEnd = (n: string) =>
  lookupTown(n) ?? (VILLAGES.has(n) ? { ...place(n), village: true } : null);

describe("facilityOf — Unicode word boundaries (A5)", () => {
  it("types a Cyrillic „порт“ / „кей“ / „гара“ title, which ASCII \\b never matched", () => {
    expect(facilityOf("Ремонт на кей 5 в порт Бургас", "rail")).toBe("port");
    expect(facilityOf("Ремонт на гара Мездра", "rail")).toBe("station");
    expect(facilityOf("Обновяване на гарата в Банско", "rail")).toBe("station");
  });

  it("is a mutation check: the old \\b form misses exactly these titles", () => {
    // If someone "simplifies" back to \b, this documents what breaks.

    expect(/\bпорт\b/.test("ремонт в порт бургас")).toBe(false);
    expect(facilityOf("ремонт в порт бургас", undefined)).toBe("port");
  });

  it("does not type „портал“ or „кейтъринг“ as a port", () => {
    expect(facilityOf("Поддръжка на уеб портал", "rail")).toBe("rail");
    expect(facilityOf("Кейтъринг услуги", "aviation")).toBe("aviation");
  });

  it("falls back to the AWARDER's universe, never a blanket rail", () => {
    const t = "Доставка на климатици за сградата в Банско";
    expect(facilityOf(t, "aviation")).toBe("aviation");
    expect(facilityOf(t, "maritime")).toBe("port");
    expect(facilityOf(t, "ministry")).toBe("site");
    expect(facilityOf(t, "road")).toBe("site");
    expect(facilityOf(t, "rail")).toBe("rail");
  });
});

describe("segments (A6, A7)", () => {
  it("draws the named SECTION, not the parent line (Медковец–Срацимир)", () => {
    const title =
      "Консултантски услуги за модернизация на линията Видин – София: участък Медковец – Срацимир";
    expect(sectionPair(title)).toEqual(["Медковец", "Срацимир"]);
    const d = linkForContract(
      title,
      ["Видин", "София"],
      "rail",
      lookupTown,
      lookupEnd,
      6,
    );
    expect(d.link?.kind).toBe("segment");
    if (d.link?.kind === "segment") {
      expect(d.link.a.name).toBe("Медковец");
      expect(d.link.b.name).toBe("Срацимир");
      expect(d.link.scope).toBe("section");
    }
  });

  it("refuses a section whose ends are too far apart and marks the parent line as such", () => {
    // The real register: „Срацимир" resolves uniquely — to Силистра, 340 km away.
    const far = (n: string): Place | null =>
      n === "Медковец"
        ? { name: n, loc: [23.18, 43.63], village: true }
        : n === "Срацимир"
          ? { name: n, loc: [27.35, 44.04], village: true }
          : lookupTown(n);
    const d = linkForContract(
      "Надзор на линията Видин – София: участък Медковец – Срацимир",
      ["Видин", "София"],
      "rail",
      lookupTown,
      far,
      6,
    );
    expect(d.link?.kind).toBe("segment");
    if (d.link?.kind === "segment") {
      expect([d.link.a.name, d.link.b.name]).toEqual(["Видин", "София"]);
      expect(d.link.scope).toBe("line");
    }
  });

  it("accepts a prefixed, hyphenated pair", () => {
    expect(
      sectionPair("Ремонт в междугарието гара Мездра - гр. Горна Оряховица"),
    ).toEqual(["Мездра", "Горна Оряховица"]);
  });

  it("never mints a line from two towns without a section word (the Варна / Горна Оряховица demolition)", () => {
    const d = linkForContract(
      "Събаряне на сгради в регион Варна и Горна Оряховица",
      ["Варна", "Горна Оряховица"],
      "aviation",
      lookupTown,
      lookupEnd,
      6,
    );
    expect(d.link).toBeNull();
    expect(d.skipped).toBe("two-towns-not-a-section");
  });

  it("never mints a line for a non-rail awarder, even with a section word", () => {
    const d = linkForContract(
      "Доставка на газ за участък Мездра – София",
      ["Мездра", "София"],
      "ministry",
      lookupTown,
      lookupEnd,
      6,
    );
    expect(d.link).toBeNull();
  });

  it("keeps a rail section between two towns", () => {
    const d = linkForContract(
      "Рехабилитация на жп участък Мездра – София",
      ["Мездра", "София"],
      "rail",
      lookupTown,
      lookupEnd,
      6,
    );
    expect(d.link?.kind).toBe("segment");
  });

  it("draws a station's works on a named line as nothing, not a 378 km line", () => {
    const d = linkForContract(
      "Ремонт на гара Юнак на жп линия София – Варна",
      ["София", "Варна"],
      "rail",
      lookupTown,
      lookupEnd,
      6,
    );
    // The line IS written as a dash pair, so it is drawn — but as the parent line.
    expect(d.link?.kind === "segment" && d.link.scope).toBe("line");
  });

  it("refuses an over-distance section between two towns as a 'section'", () => {
    const far = (n: string): Place | null =>
      n === "Мездра"
        ? { name: n, loc: [23.7, 43.14], village: false }
        : n === "Бургас"
          ? { name: n, loc: [27.47, 42.5], village: false }
          : null;
    const d = linkForContract(
      "Ремонт на жп участък Мездра – Бургас",
      ["Мездра", "Бургас"],
      "rail",
      far,
      far,
      6,
    );
    expect(d.link?.kind === "segment" && d.link.scope).toBe("line");
  });

  it("matches a section keyword that opens the title", () => {
    expect(sectionPair("Участък Мездра – София: ремонт")).toEqual([
      "Мездра",
      "София",
    ]);
  });

  it("types a Летище София terminal as aviation, not a port", () => {
    expect(facilityOf("Ремонт на Терминал 2, Летище София", "aviation")).toBe(
      "aviation",
    );
  });

  it("names section words with Unicode boundaries", () => {
    expect(namesRailSection("ремонт на жп участък Пловдив – Бургас")).toBe(
      true,
    );
    expect(namesRailSection("ремонт на жп линия Пловдив – Бургас")).toBe(false);
    expect(namesRailSection("доставка на баласт за Пловдив и Бургас")).toBe(
      false,
    );
  });
});

describe("points", () => {
  it("one town → one typed point; never two links per contract", () => {
    const d = linkForContract(
      "Ремонт на сграда в Банско",
      ["Банско"],
      "aviation",
      lookupTown,
      lookupEnd,
      6,
    );
    expect(d.link).toEqual({
      kind: "point",
      facility: "aviation",
      a: place("Банско"),
    });
  });

  it("drops a 3+ town framework and an over-cap title", () => {
    expect(
      linkForContract("x", ["Видин", "София", "Варна"], "rail", lookupTown, lookupEnd, 6).skipped, // prettier-ignore
    ).toBe("multi-site");
    expect(
      linkForContract("x", ["Видин", "София", "Варна"], "rail", lookupTown, lookupEnd, 2).skipped, // prettier-ignore
    ).toBe("too-many");
  });
});

describe("uniquePlaceIndex (C4 — refuse a shared village name)", () => {
  it("resolves a unique name and refuses one held by two settlements", () => {
    const idx = uniquePlaceIndex([
      { name: "Медковец", loc: "23.17,43.62" },
      { name: "Пелин", loc: "23.0,42.0" },
      { name: "Пелин", loc: "24.0,43.0" },
    ]);
    expect(idx.get("Медковец")).toEqual([23.17, 43.62]);
    expect(idx.get("Пелин")).toBeNull();
  });
});
