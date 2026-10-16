// Fixture tests for the project-map link rules (plan transport-hub-v1 A5–A7, C3, C4).
// The titles are the real corpus titles each rule was written against.

import { describe, it, expect } from "vitest";
import {
  facilityOf,
  namesRailSection,
  sectionPair,
  linkForContract,
  namesAWorkSite,
  pickSectionEnds,
  placeCandidatesIndex,
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
// Section-end candidates: the fixture places are all at one spot, so a pair of
// them is 0 km apart — give each name its own offset so pickSectionEnds sees
// adjacent, distinct places.
const at = (name: string, i: number, village: boolean): Place => ({
  name,
  loc: [23 + i * 0.05, 42],
  village,
});
const ALL = [...TOWNS, ...VILLAGES];
const lookupEnd = (n: string): Place[] =>
  ALL.includes(n) ? [at(n, ALL.indexOf(n), VILLAGES.has(n))] : [];

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
    const far = (n: string): Place[] =>
      n === "Медковец"
        ? [{ name: n, loc: [23.18, 43.63], village: true }]
        : n === "Срацимир"
          ? [{ name: n, loc: [27.35, 44.04], village: true }]
          : lookupEnd(n);
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

  it("refuses an over-distance section between two towns outright — no fallback line (FINDING-001)", () => {
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
      (n) => {
        const p = far(n);
        return p ? [p] : [];
      },
      6,
    );
    // Mezdra–Burgas is 340 km: refused as a section, and — the same two places —
    // not redrawn as an undistanced "line" either.
    expect(d.link).toBeNull();
    expect(d.sectionRefused).toBe("none-within");
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

// The real register's coordinates (data/ekatte_index.json), so the distance rule
// is tested on the shapes that went wrong — audit 2026-10-17, T4.
const REG = placeCandidatesIndex([
  { name: "Стражица", loc: "25.9667,43.2333", is_village: false }, // town, В. Търново
  { name: "Стражица", loc: "28.100807,43.444906", is_village: true }, // Балчик
  { name: "Славяново", loc: "26.1833,43.2667", is_village: true }, // Попово
  { name: "Славяново", loc: "25.9117,41.8467", is_village: true }, // Харманли
  { name: "Славяново", loc: "24.871502,43.465035", is_village: false }, // town, Плевен
  { name: "Лозарево", loc: "26.877908,42.770804", is_village: true },
  { name: "Завет", loc: "26.678979,43.763349", is_village: false }, // town, Разград
  { name: "Завет", loc: "27.065322,42.834866", is_village: true }, // Сунгурларе
  { name: "Медковец", loc: "23.17,43.62", is_village: true },
  { name: "Срацимир", loc: "27.35,44.04", is_village: true },
]);
const reg = (n: string) => REG.get(n) ?? [];

describe("pickSectionEnds — every end is checked against the other (T4)", () => {
  it("takes the village near the other end, not the same-named town 100 km away (Стражица–Славяново)", () => {
    const p = pickSectionEnds(reg("Стражица"), reg("Славяново"));
    expect("a" in p).toBe(true);
    if ("a" in p) {
      expect(p.a.loc).toEqual([25.9667, 43.2333]); // the town
      expect(p.b.loc).toEqual([26.1833, 43.2667]); // the Попово village
    }
  });

  it("places Лозарево–Завет on the Сунгурларе village, not the Разград town", () => {
    const p = pickSectionEnds(reg("Лозарево"), reg("Завет"));
    expect("b" in p && p.b.loc).toEqual([27.065322, 42.834866]);
  });

  it("refuses when no candidate pair is within MAX_SECTION_KM (Медковец–Срацимир, 340 km)", () => {
    expect(pickSectionEnds(reg("Медковец"), reg("Срацимир"))).toEqual({
      refused: "none-within",
    });
  });

  it("refuses an unknown end and a pair too close to call", () => {
    expect(pickSectionEnds(reg("Нищо"), reg("Завет"))).toEqual({
      refused: "unknown",
    });
    const twin = (n: string, lng: number): Place => ({
      name: n,
      loc: [lng, 42],
      village: true,
    });
    expect(
      pickSectionEnds([twin("А", 23)], [twin("Б", 23.1), twin("Б", 22.9)]),
    ).toEqual({ refused: "ambiguous" });
  });
});

describe("a refused named section is not redrawn as a line between the same towns (FINDING-001)", () => {
  it("leaves „участък Стражица – Славяново“ unplaced when both ends are towns and the pick is refused", () => {
    // Both ends are gazetteer towns 100 km apart and no candidate pair is close:
    // the section is refused, and the dash pair must NOT come back as a line.
    const towns: Record<string, Place> = {
      Стражица: { name: "Стражица", loc: [25.9667, 43.2333], village: false },
      Славяново: { name: "Славяново", loc: [24.8715, 43.465], village: false },
    };
    const d = linkForContract(
      "Подновяване на железния път в участък Стражица – Славяново",
      ["Стражица", "Славяново"],
      "rail",
      (n) => towns[n] ?? null,
      // Two Славяново candidates at near-equal distance: the pick is ambiguous.
      (n) =>
        n === "Стражица"
          ? [towns.Стражица]
          : [
              { ...towns.Славяново, loc: [26.6, 43.5] },
              { ...towns.Славяново, loc: [25.3, 43.0] },
            ],
      6,
    );
    expect(d.sectionRefused).toBe("ambiguous");
    expect(d.link).toBeNull();
  });
});

describe("a named section never falls back to a single-town point (T4b)", () => {
  it("leaves „участъка Лозарево – Прилеп … Карнобат“ unplaced when the section is refused", () => {
    const d = linkForContract(
      "„Удвояване и електрификация на железния път в участъка Лозарево – Прилеп – част от проект „… Карнобат – Синдел“",
      ["Карнобат"],
      "rail",
      () => ({ name: "Карнобат", loc: [27.0, 42.65], village: false }),
      () => [],
      6,
    );
    expect(d.link).toBeNull();
    expect(d.skipped).toBe("section-unresolved");
    expect(d.sectionRefused).toBe("unknown");
  });
});

describe("titles that name a place but no work site stay off the map (T5)", () => {
  it.each([
    "Доставка на питейна вода за сградата на ДП НКЖИ в Пловдив",
    "Доставка на природен газ за отопление на гара Русе",
    "Осигуряване на интернет за поделението в Бургас",
    "Пране на спално бельо за спалните вагони, Варна",
    "Денонощна охрана на обекти в Горна Оряховица",
    "Хотелско настаняване в Банско",
    "Обучение на машинисти в София",
    "Абонаментна поддръжка на климатизация в Мездра",
    "Ремонт на локомотиви серия 44 в Русе",
    "Ремонт на пътнически вагони във Видин",
  ])("%s", (t) => {
    expect(namesAWorkSite(t, true)).toBe(false);
    expect(linkForContract(t, ["Банско"], "rail", lookupTown, lookupEnd, 6).link).toBeNull(); // prettier-ignore
  });

  it("keeps a depot or a works on the map — they are fixed rail facilities (FINDING-003)", () => {
    expect(namesAWorkSite("Ремонт на покрива на локомотивно депо Горна Оряховица", true)).toBe(true); // prettier-ignore
    expect(namesAWorkSite("Реконструкция на вагонно депо Подуяне", true)).toBe(true); // prettier-ignore
    expect(namesAWorkSite("Изграждане на ограда на вагоноремонтен завод Дряново", true)).toBe(true); // prettier-ignore
    expect(namesAWorkSite("Ремонт на локомотиви серия 44 в Русе", true)).toBe(false); // prettier-ignore
  });

  it("keeps cleaning and a district only off POINTS — on a section they are track work", () => {
    expect(namesAWorkSite("Почистване на гарата в Банско", true)).toBe(false);
    expect(namesAWorkSite("Избор на изпълнител за територията на Югоизточен район, с административни центрове на области: Бургас, Сливен", true)).toBe(false); // prettier-ignore
    // „в района на" LOCATES a site — it must not unplace one.
    expect(namesAWorkSite("Укрепване и рехабилитация на кейова стена в района на 4 к.м., Пристанище Бургас", true)).toBe(true); // prettier-ignore
    expect(namesAWorkSite("Реконструкция на телефонна кабелна мрежа в участъка Горна Оряховица – Бяла", false)).toBe(true); // prettier-ignore
    expect(namesAWorkSite("Почистване на растителност в участък Мездра – София", false)).toBe(true); // prettier-ignore
  });

  it("does not trip on words that only contain a listed stem", () => {
    // газ ⊂ газопровод? the boundary keeps „газ" a word; гара ≠ охрана.
    expect(namesAWorkSite("Ремонт на гара Мездра", true)).toBe(true);
    expect(namesAWorkSite("Реконструкция на газопровод при гара Мездра", true)).toBe(true); // prettier-ignore
    expect(namesAWorkSite("Рехабилитация на пристанище Видин", true)).toBe(
      true,
    );
    // Real corpus titles that the first cut of these rules took off the map.
    expect(namesAWorkSite("Модернизация на тягова подстанция Червена вода", true)).toBe(true); // prettier-ignore
    expect(namesAWorkSite("Изграждане на интермодален терминал Пловдив в Южен централен район на планиране", true)).toBe(true); // prettier-ignore
    expect(namesAWorkSite("Рехабилитация на контактната мрежа и захранване с електроенергия на гара Мездра", true)).toBe(true); // prettier-ignore
    // …while the SUPPLY of the same utilities stays off.
    expect(namesAWorkSite("Доставка на 28 925 000 литра дизелово моторно гориво, Русе", true)).toBe(false); // prettier-ignore
    expect(namesAWorkSite("Избор на доставчик на електрическа енергия за поделението в Пловдив", true)).toBe(false); // prettier-ignore
  });
});
