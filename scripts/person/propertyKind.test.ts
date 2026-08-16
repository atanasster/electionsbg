import { describe, expect, it } from "vitest";
import {
  propertyKind,
  summariseProperties,
  PROPERTY_KIND_LABEL,
  PROPERTY_KIND_ORDER,
} from "./propertyKind";

describe("propertyKind", () => {
  it("buckets the corpus's twenty commonest spellings", () => {
    // The head of the distribution, verbatim from the register (2026-08-16) with their row
    // counts — these twenty are 87% of all 133,240 real-estate rows.
    const cases: [string, string][] = [
      ["апартамент", "apartment"],
      ["нива", "farmland"],
      ["къща с двор", "house"],
      ["парцел", "plot"],
      ["гараж", "garage"],
      ["ливада", "farmland"],
      ["къща", "house"],
      ["гори", "farmland"],
      ["лозя", "farmland"],
      ["вила с вилно място", "house"],
      ["магазин", "commercial"],
      ["трайни насаждения", "farmland"],
      ["други", "other"],
      ["ателие", "commercial"],
      ["офис", "commercial"],
      ["складови помещения", "commercial"],
      ["право на строеж", "other"],
      ["вила", "house"],
      ["дворно място", "plot"],
      ["паркомясто", "garage"],
    ];
    for (const [input, expected] of cases)
      expect(propertyKind(input), input).toBe(expected);
  });

  it("puts a compound where a reader would put it, not where the last word falls", () => {
    // Rule ORDER carries these — a naive per-word match sends „къща с двор" to `plot` and
    // „апартамент с гараж" to `garage`.
    expect(propertyKind("къща с двор")).toBe("house");
    expect(propertyKind("апартамент с гараж")).toBe("apartment");
    expect(propertyKind("апартамент и гараж")).toBe("apartment");
    expect(propertyKind("Жилище,част от къща")).toBe("apartment");
    expect(propertyKind("УПИ с постройка")).toBe("plot");
    expect(propertyKind("вила с вилно място")).toBe("house");
  });

  it("classifies on the HEAD noun, so a garage in a house is a garage", () => {
    // The whole-string form matched „къща" and published a garage as a house. Every one of
    // these is a real spelling from Рашков's 2023 filing, which came out as 11 къщи.
    expect(propertyKind("Гараж част от къща")).toBe("garage");
    expect(propertyKind("Склад,част от къща")).toBe("commercial");
    expect(propertyKind("Жилище,част от къща")).toBe("apartment");
  });

  it("counts an ancillary space as `other`, not as a house", () => {
    // A terrace, a basement and a gym are parts of a building, not buildings. They have no
    // head-noun rule of their own, so without this they fell through to the whole-string
    // pass, matched „част от къща" and took one man's house count from 2 to 5.
    expect(propertyKind("Тераса,част от къща")).toBe("other");
    expect(propertyKind("Сутерен,част от къща")).toBe("other");
    expect(propertyKind("Фитнес,част от къща")).toBe("other");
    expect(propertyKind("мазе")).toBe("other");
    expect(propertyKind("таванско помещение")).toBe("other");
    // …but a plain house is still a house.
    expect(propertyKind("Къща")).toBe("house");
  });

  it("keeps rights out of the dwelling buckets", () => {
    // 1,138 rows in the corpus are `право на строеж` / `право на ползване` — a right is not
    // a property, and calling one a plot would inflate a published count.
    expect(propertyKind("право на строеж")).toBe("other");
    expect(propertyKind("право на ползване")).toBe("other");
  });

  it("is case- and whitespace-insensitive, as the register is not", () => {
    // The same property is filed both ways by different declarants.
    expect(propertyKind("Апартамент")).toBe("apartment");
    expect(propertyKind("  АПАРТАМЕНТ  ")).toBe("apartment");
    expect(propertyKind("апартамент")).toBe("apartment");
  });

  it("does not read `паркомясто` as a plot", () => {
    // `място` is a plot word and `паркомясто` contains it; the plot rule excludes the
    // parking prefix so a parking space cannot be published as land.
    expect(propertyKind("паркомясто")).toBe("garage");
    expect(propertyKind("парко място")).toBe("garage");
    expect(propertyKind("вилно място")).toBe("plot");
  });

  it("treats an absent description as `other` rather than throwing", () => {
    expect(propertyKind(null)).toBe("other");
    expect(propertyKind(undefined)).toBe("other");
    expect(propertyKind("   ")).toBe("other");
  });

  it("every kind has both a singular and a counting form, and they differ where BG does", () => {
    // „2 апартамента", never „2 апартаменти" — the бройна форма is not the plural, and
    // getting it wrong is the kind of thing a reader notices before the number.
    for (const kind of PROPERTY_KIND_ORDER) {
      const l = PROPERTY_KIND_LABEL[kind];
      expect(l.one.length, kind).toBeGreaterThan(0);
      expect(l.many.length, kind).toBeGreaterThan(0);
    }
    expect(PROPERTY_KIND_LABEL.apartment.many).toBe("апартамента");
    expect(PROPERTY_KIND_LABEL.house.many).toBe("къщи");
  });
});

describe("summariseProperties", () => {
  it("counts by kind, largest first, with the right grammatical form", () => {
    const s = summariseProperties([
      "Апартамент",
      "Апартамент",
      "Апартамент",
      "нива",
      "нива",
      "Гараж",
    ]);
    expect(s.total).toBe(6);
    expect(s.parts.map((p) => `${p.n} ${p.label}`)).toEqual([
      "3 апартамента",
      "2 земеделски имота",
      "1 гараж",
    ]);
  });

  it("orders a tie by the display order, not by insertion", () => {
    // Two kinds with the same count must not swap between two runs over the same filing.
    const a = summariseProperties(["гараж", "апартамент"]);
    const b = summariseProperties(["апартамент", "гараж"]);
    expect(a.parts.map((p) => p.kind)).toEqual(b.parts.map((p) => p.kind));
    expect(a.parts[0].kind).toBe("apartment");
  });

  it("returns an empty summary rather than a zero row", () => {
    // A side with no declared property must render nothing, not „0 имота" — which would
    // read as a claim, and on an annual filing it is one that is wrong half the time.
    expect(summariseProperties([])).toEqual({ total: 0, parts: [] });
  });

  it("keeps the singular form for a single property", () => {
    expect(summariseProperties(["къща"]).parts[0].label).toBe("къща");
    expect(summariseProperties(["къща", "къща"]).parts[0].label).toBe("къщи");
  });
});
