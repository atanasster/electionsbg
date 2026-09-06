// Unit tests for the Layer 2 deed scraper, against real captured fixtures spanning
// EOOD / OOD / AD / EAD / ET / ЮЛНЦ / bankrupt (the entity types §4.1 called for).
// The fixtures are verbatim CR Deeds bodies captured 2026-07-27.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCrDeed,
  parseParty,
  parseCapital,
  parseNace,
  fieldRecords,
  stripHtml,
  decodeEntities,
  crSeatToFeedForm,
} from "./parse_cr_deeds";

const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "cr_deeds",
);
const load = (name: string) =>
  fs.readFileSync(path.join(dir, `${name}.json`), "utf8");

describe("html helpers", () => {
  it("decodes the entities the CR renderer emits", () => {
    expect(decodeEntities("&quot;АБВ&quot; &amp; &#039;x&#039;")).toBe(
      "\"АБВ\" & 'x'",
    );
  });

  it("splits a multi-person field into one record per <p class='field-text'>", () => {
    const html =
      "<div class='record-container'><p class='field-text'>А, Държава: БЪЛГАРИЯ</p></div>" +
      "<hr class='hr--report' />" +
      "<div class='record-container'><p class='field-text'>Б, Държава: ИСПАНИЯ</p></div>";
    expect(fieldRecords(html)).toEqual([
      "А, Държава: БЪЛГАРИЯ",
      "Б, Държава: ИСПАНИЯ",
    ]);
  });

  it("collapses <br/> and nested tags into one line", () => {
    expect(stripHtml("гр. София<br/>р-н Младост")).toBe(
      "гр. София р-н Младост",
    );
  });

  it("never throws on an out-of-range character reference (leaves it verbatim)", () => {
    // String.fromCodePoint would RangeError; parseCrDeed must never throw.
    expect(() => decodeEntities("x&#9999999999;y")).not.toThrow();
    expect(() => decodeEntities("x&#xFFFFFFFF;y")).not.toThrow();
    expect(decodeEntities("x&#9999999999;y")).toContain("x");
  });

  it("decodes an uppercase named entity", () => {
    expect(decodeEntities("&QUOT;x&QUOT;")).toBe('"x"');
  });
});

describe("parseParty", () => {
  it("reads a natural person with country", () => {
    const p = parseParty(
      "ИВЕЛИНА ИВАНОВА НИКОЛОВА, Държава: БЪЛГАРИЯ",
      "manager",
      "00070",
      "2025-09-17",
    );
    expect(p).toMatchObject({
      name: "ИВЕЛИНА ИВАНОВА НИКОЛОВА",
      isLegalEntity: false,
      eik: null,
      country: "БЪЛГАРИЯ",
      role: "manager",
      entryDate: "2025-09-17",
    });
  });

  it("reads a legal-entity owner and extracts its ЕИК (the ownership chain)", () => {
    const p = parseParty(
      "ОБЩИНА РАЗЛОГ, ЕИК/ПИК 000024948",
      "sole_owner",
      "00230",
      "2008-09-04",
    );
    expect(p).toMatchObject({
      name: "ОБЩИНА РАЗЛОГ",
      isLegalEntity: true,
      eik: "000024948",
    });
  });

  it("flags a foreign legal person via 'Идентификация' + 'юридическо лице'", () => {
    const p = parseParty(
      '"ШНАЙДЕР ЕЛЕКТРИК ИНДЪСТРИЗ" С.А.С., Идентификация 954503439, Чуждестранно юридическо лице, Държава: ФРАНЦИЯ',
      "sole_owner",
      "00230",
      null,
    );
    expect(p.isLegalEntity).toBe(true);
    expect(p.eik).toBe("954503439");
    expect(p.country).toBe("ФРАНЦИЯ");
  });

  it("reads a ЮЛНЦ board position label", () => {
    const p = parseParty(
      "ИВАН НИКОЛОВ ЧЕРНОЗЕМСКИ, Държава: БЪЛГАРИЯ, Длъжност: Председател на Управителния съвет",
      "ngo_board",
      "00100",
      null,
    );
    expect(p.positionLabel).toBe("Председател на Управителния съвет");
    expect(p.country).toBe("БЪЛГАРИЯ");
  });

  it("keeps a quoted entity name with an internal comma intact", () => {
    const p = parseParty(
      '"АБВ, ГД" ООД, ЕИК/ПИК 123456789',
      "partner",
      "f",
      null,
    );
    expect(p.eik).toBe("123456789");
    expect(p.name).toContain("ГД"); // not truncated to '"АБВ'
    expect(p.isLegalEntity).toBe(true);
  });

  it("flags a bare company name (legal-form token) as an entity even without an ЕИК", () => {
    const p = parseParty(
      '"ДЕВНЯ ЦИМЕНТ" АД, Държава: БЪЛГАРИЯ',
      "partner",
      "f",
      null,
    );
    expect(p.isLegalEntity).toBe(true);
    expect(p.eik).toBeNull();
  });

  it("does not mistake an едноличен търговец for a legal entity", () => {
    // ЕТ is a natural person trading under a firm name — must stay a person.
    const p = parseParty(
      "ЕТ ИВАН ПЕТРОВ, Държава: БЪЛГАРИЯ",
      "manager",
      "f",
      null,
    );
    expect(p.isLegalEntity).toBe(false);
    expect(p.eik).toBeNull();
  });
});

describe("parseCapital", () => {
  it("reads amount + currency, mapping € to EUR", () => {
    expect(parseCapital("5112918.81 €")).toEqual({
      amount: 5112918.81,
      currency: "EUR",
    });
  });
  it("handles a лв amount with a comma decimal", () => {
    expect(parseCapital("5 000,00 лв.")).toEqual({
      amount: 5000.0,
      currency: "BGN",
    });
  });
  it("reads a comma-thousands amount without losing magnitude", () => {
    expect(parseCapital("1,000,000.00 лв.")).toEqual({
      amount: 1000000,
      currency: "BGN",
    });
  });
  it("returns a null amount for a currency-only field", () => {
    expect(parseCapital("лв.")).toEqual({ amount: null, currency: "BGN" });
  });
});

describe("parseNace — RAW code extraction (provenance only, not the division)", () => {
  it("reads a dotted code", () => {
    expect(
      parseNace("Група по НКИД: 86.10 Клас по НКИД: Дейност на болници"),
    ).toEqual({ code: "86.10" });
  });
  it("reads an undotted 4-digit code", () => {
    expect(parseNace("Група по НКИД: 8690 Клас по НКИД: Други")).toEqual({
      code: "8690",
    });
  });
  it("returns null when the field carries no code (description only / empty)", () => {
    expect(parseNace("Клас по НКИД: Дейност на болници")).toEqual({
      code: null,
    });
    expect(parseNace("")).toEqual({ code: null });
  });
  it("strips a trailing dot from the code", () => {
    expect(parseNace("Група по НКИД: 41.")).toEqual({ code: "41" });
  });
  it("rejects a sub-2-digit head rather than storing a stray digit", () => {
    expect(parseNace("Група по НКИД: 8.10")).toEqual({ code: null });
  });
});

describe("parseCrDeed — against real fixtures", () => {
  it("rejects a non-answer body (never project from it)", () => {
    expect(parseCrDeed(null)).toBeNull();
    expect(parseCrDeed("")).toBeNull();
    expect(parseCrDeed("<html>blocked</html>")).toBeNull();
    expect(parseCrDeed("{}")).toBeNull(); // valid JSON, not a deed tree
  });

  it("skips empty (op-2) and unknown fields without throwing or emitting parties", () => {
    const tree = JSON.stringify({
      uic: "1",
      deedStatus: 2,
      sections: [
        {
          subDeeds: [
            {
              groups: [
                {
                  fields: [
                    { nameCode: "CR_F_23_L", htmlData: "", fieldIdent: "x" }, // op-2 empty
                    {
                      nameCode: "CR_F_9999_L",
                      htmlData: "junk",
                      fieldIdent: "y",
                    }, // unknown
                    { nameCode: "CR_F_31_L", htmlData: "лв.", fieldIdent: "z" }, // no amount
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const d = parseCrDeed(tree);
    expect(d).not.toBeNull();
    expect(d!.parties).toEqual([]);
    // currency must not be set without an amount (FINDING-007)
    expect(d!.capitalAmount).toBeNull();
    expect(d!.capitalCurrency).toBeNull();
  });

  it("EOOD: resolves the sole owner, managers, UBO, capital, founding date", () => {
    const d = parseCrDeed(load("eood1"));
    expect(d).not.toBeNull();
    expect(d!.uic).toBe("121587769");
    expect(d!.legalFormCode).toBe(10);
    // sole owner is the foreign legal person, with its identification
    const owner = d!.parties.find((p) => p.role === "sole_owner");
    expect(owner?.isLegalEntity).toBe(true);
    expect(owner?.eik).toBe("954503439");
    // three managers (natural persons), one Spanish
    const managers = d!.parties.filter((p) => p.role === "manager");
    expect(managers.length).toBe(3);
    expect(managers.some((m) => m.country === "ИСПАНИЯ")).toBe(true);
    expect(d!.parties.some((p) => p.role === "actual_owner")).toBe(true);
    expect(d!.capitalAmount).toBeGreaterThan(5_000_000);
    expect(d!.capitalCurrency).toBe("EUR");
    expect(d!.foundingDate).toBe("2008-08-25");
    // Raw code kept for provenance; the division is classified from the LABEL
    // ("Производство на апарати … за … електрическа енергия" → electrical
    // equipment manufacture, div 27), NOT from the ambiguous code.
    expect(d!.naceCode).toBe("27.12");
    expect(d!.naceDivision).toBe("27");
  });

  it("EOOD (МБАЛ Разлог): the recovered owner is a municipality, not a person", () => {
    const d = parseCrDeed(load("eood2"));
    const owner = d!.parties.find((p) => p.role === "sole_owner");
    expect(owner?.name).toContain("ОБЩИНА РАЗЛОГ");
    expect(owner?.isLegalEntity).toBe(true);
    expect(owner?.eik).toBe("000024948");
  });

  it("OOD: reads съдружници (partners) and a manager", () => {
    const d = parseCrDeed(load("ood"));
    expect(d!.parties.some((p) => p.role === "partner")).toBe(true);
    expect(d!.parties.some((p) => p.role === "manager")).toBe(true);
  });

  it("EAD: sole owner is Столична община (state-owned)", () => {
    const d = parseCrDeed(load("ead"));
    expect(d!.legalFormCode).toBe(11);
    const owner = d!.parties.find((p) => p.role === "sole_owner");
    expect(owner?.isLegalEntity).toBe(true);
    expect(owner?.name).toContain("ОБЩИНА");
  });

  it("AD: reads board members (director role)", () => {
    const d = parseCrDeed(load("ad"));
    expect(d!.legalFormCode).toBe(5);
    expect(
      d!.parties.filter((p) => p.role === "director").length,
    ).toBeGreaterThan(0);
  });

  it("ЮЛНЦ: reads the governing board with position labels", () => {
    const d = parseCrDeed(load("ngofound"));
    const board = d!.parties.filter((p) => p.role === "ngo_board");
    expect(board.length).toBeGreaterThan(0);
    expect(board.some((b) => b.positionLabel?.includes("Председател"))).toBe(
      true,
    );
  });

  it("every fixture parses to a deed with a uic and a founding date", () => {
    for (const name of [
      "eood1",
      "eood2",
      "ead",
      "ad",
      "ood",
      "ngofound",
      "et",
      "bankrupt",
    ]) {
      const d = parseCrDeed(load(name));
      expect(d, name).not.toBeNull();
      expect(d!.uic, name).toBeTruthy();
      expect(d!.foundingDate, name).toMatch(/^\d{4}-\d\d-\d\d$/);
    }
  });

  it("never emits a natural person carrying an eik, nor an entity without one flagged", () => {
    // Guard the person-graph boundary (plan §8.4): eik ⟺ isLegalEntity for every party.
    for (const name of ["eood1", "eood2", "ead", "ad", "ood", "ngofound"]) {
      for (const p of parseCrDeed(load(name))!.parties) {
        if (p.eik) expect(p.isLegalEntity, `${name}:${p.name}`).toBe(true);
        if (!p.isLegalEntity) expect(p.eik, `${name}:${p.name}`).toBeNull();
      }
    }
  });
});

describe("parseCrDeed — ЕТ (физическо лице търговец)", () => {
  const etRaw = load("et");
  const et = parseCrDeed(etRaw);

  it("maps CR_F_18_L to sole_trader, the field VERIFIED against the capture", () => {
    // The mapping was not inferred from the CR_F_<n>_L ↔ 00<n>0 pattern: this fixture
    // carries `{ nameCode: "CR_F_18_L", fieldIdent: "00180" }`, and 00180 is the ident
    // the daily feed's `PhysicalPersonTrader` section rides on. Asserting the pairing
    // here is what keeps the two ingests naming the same field.
    const raw = JSON.parse(etRaw) as unknown;
    const idents: string[] = [];
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === "object") {
        const n = o as Record<string, unknown>;
        if (n.nameCode === "CR_F_18_L") idents.push(String(n.fieldIdent));
        Object.values(n).forEach(walk);
      }
    };
    walk(raw);
    expect(idents).toEqual(["00180"]);
  });

  it("reads the trader out of a POPULATED CR_F_18_L", () => {
    // ⚠️ THE COMMITTED FIXTURE CANNOT TEST THIS, and that is the point of synthesising a
    // body here. Its ЕТ is a заличен търговец whose trader field the register has blanked,
    // so the parser short-circuits on the empty `htmlData` before ever consulting
    // FIELD_TO_ROLE — mutation-verified: with `CR_F_18_L: "sole_trader"` deleted, every
    // other ЕТ assertion in this file still passes. Only a populated field discriminates.
    const populated = JSON.parse(etRaw) as Record<string, unknown>;
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === "object") {
        const n = o as Record<string, unknown>;
        if (n.nameCode === "CR_F_18_L") {
          n.htmlData =
            "<div class='record-container record-container--preview'>" +
            "<p class='field-text'>ИВАН ПЕТРОВ ГЕОРГИЕВ, Държава: БЪЛГАРИЯ</p></div>";
        }
        Object.values(n).forEach(walk);
      }
    };
    walk(populated);

    const parsed = parseCrDeed(JSON.stringify(populated));
    const traders = parsed!.parties.filter((p) => p.role === "sole_trader");
    expect(traders).toHaveLength(1);
    expect(traders[0].name).toBe("ИВАН ПЕТРОВ ГЕОРГИЕВ");
    expect(traders[0].country).toBe("БЪЛГАРИЯ");
    expect(traders[0].fieldIdent).toBe("00180");
  });

  it("invents no trader from a struck-off ЕТ's blanked field", () => {
    // This capture is a заличен търговец (CR_F_27_L says so) and the register BLANKS the
    // trader on strike-off — `htmlData` is "". Mapping the field must not turn that
    // silence into a party: naming somebody as the owner of a business on the strength of
    // an empty cell is the one failure this whole role exists to avoid.
    expect(et).not.toBeNull();
    expect(et!.parties.filter((p) => p.role === "sole_trader")).toHaveLength(0);
  });
});

describe("crSeatToFeedForm", () => {
  // ⚠️ THE POINT IS NOT „it extracts a town" — it is that the output is readable by
  // `parseSeat`, which splits the DAILY FEED's string on commas and takes field 1. Every
  // case below is written as the three-comma-field shape for that reason.
  const RAZLOG =
    "Държава: БЪЛГАРИЯ Област: Благоевград, Община: Разлог Населено място: гр. Разлог, " +
    "п.к. 2760 бул./ул. ул. СВЕТИ СВЕТИ КИРИЛ И МЕТОДИЙ № 2 Телефон: 0898 775088, " +
    "Факс: 0747 80282 Адрес на електронна поща: mbal_razlog@abv.bg";

  it("rewrites a labelled block into the feed's own shape", () => {
    expect(crSeatToFeedForm(RAZLOG)).toBe("БЪЛГАРИЯ, гр. Разлог, 2760");
  });

  it("drops the contact details the seat column has never carried", () => {
    // 7,867 of 29,417 captures carry a non-empty „Адрес на електронна поща:"; `seat` renders
    // on /company/:eik and is a browse column, so keeping them would widen it into a contact
    // field by accident.
    const out = crSeatToFeedForm(RAZLOG)!;
    for (const leak of ["Телефон", "Факс", "abv.bg", "@", "Интернет"])
      expect(out).not.toContain(leak);
  });

  it("stops the locality at the district, not at the street", () => {
    // 8,608 of the captures are Sofia, and every one of them carries „р-н <name>" between
    // the locality and the street. Swallowing it gives „гр. София р-н Оборище", which the
    // resolver's name arm does not know.
    expect(
      crSeatToFeedForm(
        "Държава: БЪЛГАРИЯ Област: София (столица), Община: Столична Населено място: " +
          "гр. София, п.к. 1202 р-н Оборище бул./ул. ул. Струма № 3, вх. Б, ет. 4, ап. 16",
      ),
    ).toBe("БЪЛГАРИЯ, гр. София, 1202");
  });

  it("emits two fields when the block states no postcode", () => {
    // 443 captures carry no п.к. TOKEN at all — but 587 canonical outputs are two-field,
    // because a further 144 carry a token whose value is unusable (see the test below).
    // `parseSeat` accepts a two-field string (the feed itself has 4,059), so this must NOT be
    // refused — the resolver's name arm still places it.
    expect(
      crSeatToFeedForm(
        "Държава: БЪЛГАРИЯ Област: Видин, Община: Димово Населено място: с. Динково",
      ),
    ).toBe("БЪЛГАРИЯ, с. Динково");
  });

  it("keeps the village/town marker, which is what disambiguates a name", () => {
    // `parseSeat`'s own header: normName() strips the marker inside the resolver, and the
    // marker is what separates a town from a village of the same name in the postal arm.
    expect(
      crSeatToFeedForm(
        "Държава: БЪЛГАРИЯ Област: Пловдив, Община: Марица Населено място: с. Труд, " +
          "п.к. 4199 бул./ул. ул. Първа № 1",
      ),
    ).toBe("БЪЛГАРИЯ, с. Труд, 4199");
  });

  it("stops at the neighbourhood when nothing else separates it from the locality", () => {
    // The 40-capture residue: no п.к., no р-н, no бул./ул. — the locality runs straight into
    // the ж.к., and the match would otherwise reach the end of the string. Note the trailing
    // comma too: `parseSeat` splits on commas, so leaving it makes an empty third field.
    expect(
      crSeatToFeedForm(
        "Държава: БЪЛГАРИЯ Област: София (столица), Община: Столична Населено място: " +
          "гр. София ж.к. КВ. МАНАСТИРСКИ ЛИВАДИ-ЗАПАД,",
      ),
    ).toBe("БЪЛГАРИЯ, гр. София");
    expect(
      crSeatToFeedForm(
        "Държава: БЪЛГАРИЯ Област: Ловеч, Община: Луковит Населено място: " +
          "гр. Луковит бл. ПАНАКА",
      ),
    ).toBe("БЪЛГАРИЯ, гр. Луковит");
  });

  it("takes the locality's postcode, not a PO box in the street part", () => {
    // 7 real captures carry a second „п.к." — always a PO box after the street (102865267,
    // 202047189, 204938868). The whole-block match is safe because the locality's comes FIRST
    // and the match is non-global; this asserts THAT, rather than trusting the PO boxes stay
    // short. The fixture's PO box is deliberately 4 digits: with the real „п.к.132" the test
    // would pass even on an implementation that took the LAST match, i.e. it would not
    // discriminate.
    expect(
      crSeatToFeedForm(
        "Държава: БЪЛГАРИЯ Област: Бургас, Община: Айтос Населено място: гр. Айтос, " +
          "п.к. 8500 бул./ул. БУРГАСКО ШОСЕ, ПЕТИ КИЛОМЕТЪР, п.к. 1234",
      ),
    ).toBe("БЪЛГАРИЯ, гр. Айтос, 8500");
  });

  it("refuses an unusable п.к. value rather than emitting a short postcode", () => {
    // 144 captures carry a п.к. TOKEN whose value is unusable: „п.к. .", „п.к. --", and
    // truncated real postcodes („п.к. 900" for 9000). A 3-digit field would be a wrong postal
    // match; two fields send the row to the resolver's NAME arm instead, which places it.
    expect(
      crSeatToFeedForm(
        "Държава: БЪЛГАРИЯ Област: Варна, Община: Варна Населено място: гр. Варна, " +
          "п.к. 900 р-н Приморски бул./ул. бул. КНЯЗ БОРИС I 109",
      ),
    ).toBe("БЪЛГАРИЯ, гр. Варна");
    expect(
      crSeatToFeedForm(
        "Държава: БЪЛГАРИЯ Област: Хасково, Община: Димитровград Населено място: " +
          "с. Сталево, п.к. . бул./ул. ул. Девети Септември № 21",
      ),
    ).toBe("БЪЛГАРИЯ, с. Сталево");
  });

  it("refuses a block that names no locality rather than inventing one", () => {
    expect(
      crSeatToFeedForm("Държава: БЪЛГАРИЯ Област: Бургас, Община: Бургас"),
    ).toBeNull();
    expect(crSeatToFeedForm("")).toBeNull();
    // Non-vacuity: the refusals above must not be how this function usually behaves.
    expect(crSeatToFeedForm(RAZLOG)).not.toBeNull();
  });

  it("does not read a house number as the postcode", () => {
    // „№ 2760" is a street number, not a п.к.; only the labelled one counts.
    expect(
      crSeatToFeedForm(
        "Държава: БЪЛГАРИЯ Област: Русе, Община: Русе Населено място: гр. Русе " +
          "бул./ул. ул. Тулча № 2760",
      ),
    ).toBe("БЪЛГАРИЯ, гр. Русе");
  });
});

describe("the seat field's precedence", () => {
  it("prefers CR_F_5_L over CR_F_5a_L even when 5a comes first in the document", () => {
    // ⚠️ THEY ARE NOT THE SAME ADDRESS. Measured 2026-09-06: 6,735 captures carry both, and
    // 2,198 canonicalise DIFFERENTLY — sometimes to another oblast (010951366 is Девня 9160
    // against Варна 9000). 5a is the correspondence address.
    //
    // Today 5_L is rendered first on all 6,735, so the parser's first-wins guard picks the
    // right one — but that is a property of the register's output, not a rule. Building the
    // tree with 5a FIRST is what makes this test fail on a document-order change AND on a
    // guard change; with 5_L first it would pass on either.
    const field = (nameCode: string, seat: string) => ({
      nameCode,
      fieldIdent: nameCode,
      htmlData: `<p class='field-text'>${seat}</p>`,
    });
    const tree = JSON.stringify({
      uic: "010951366",
      sections: [
        {
          subDeeds: [
            {
              groups: [
                {
                  fields: [
                    field(
                      "CR_F_5a_L",
                      "Държава: БЪЛГАРИЯ Област: Варна, Община: Варна " +
                        "Населено място: гр. Варна, п.к. 9000",
                    ),
                    field(
                      "CR_F_5_L",
                      "Държава: БЪЛГАРИЯ Област: Варна, Община: Девня " +
                        "Населено място: гр. Девня, п.к. 9160",
                    ),
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const d = parseCrDeed(tree);
    expect(d).not.toBeNull();
    expect(d!.seatCanonical).toBe("БЪЛГАРИЯ, гр. Девня, 9160");
    // …and the raw provenance field must be the SAME field, not a mixture of the two.
    expect(d!.seat).toContain("Девня");
    expect(d!.seat).not.toContain("Варна, Община: Варна");
  });
});
