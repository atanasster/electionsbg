// Gate for the supplier-identity classifier.
//
// The defect this locks: `contracts.contractor_eik` held 98 distinct checksum-valid
// ЕГН, each next to a natural person's full name, because the only question asked of a
// supplier id was `isValidEik` — which accepts 9–13 digits and so accepts an ЕГН. Every
// id below is a REAL token taken from raw_data/procurement/eop/*.json.gz or from the
// live `contracts` table, so this file doubles as the evidence for the plan's numbers.
//
//   npx vitest run scripts/procurement/supplier_identity.test.ts

import { describe, test, expect } from "vitest";
import {
  classifySupplierId,
  isEgn,
  isPersonalSupplier,
  personSupplierKey,
} from "./supplier_identity";

describe("isEgn", () => {
  // Real ЕГН found in contractor_eik (00258-2022-0003, 00299-2020-0011, 00339-2022-0070).
  test.each(["6207316703", "7102238334", "8408115788", "5606035129"])(
    "%s is a valid ЕГН",
    (id) => expect(isEgn(id)).toBe(true),
  );

  // Foreign 10-digit registry ids that must NOT be mistaken for personal numbers —
  // Kapsch (PL) and Argus Media (UK). These belong to deferred defect D-3.
  test.each(["0000340505", "6142046888"])("%s is not an ЕГН", (id) =>
    expect(isEgn(id)).toBe(false),
  );

  // Placeholders: right shape, wrong checksum.
  test.each(["1111111111", "1234567899", "0000000000", "1200351010"])(
    "%s fails the checksum",
    (id) => expect(isEgn(id)).toBe(false),
  );

  test("rejects anything that is not exactly 10 digits", () => {
    for (const id of ["620731670", "62073167034", "", undefined, "62073167a"]) {
      expect(isEgn(id)).toBe(false);
    }
  });

  test("decodes the +40 month convention", () => {
    // `0048076320` — month byte 48, i.e. a 21st-century (2000+) birth in month 8.
    // A validator that only accepted months 1-12 raw would reject this real ЕГН and
    // leave it published. The only such row in the corpus, hence a named case.
    expect(isEgn("0048076320")).toBe(true);
  });

  test("rejects an undecodable month", () => {
    // Month byte 14 is neither a raw month nor a +20/+40 offset. Argus Media's UK
    // registry id happens to have this shape, which is why it is not a false positive.
    expect(isEgn("6142046888")).toBe(false);
  });
});

describe("classifySupplierId", () => {
  test("an ЕГН never becomes the stored key", () => {
    const r = classifySupplierId("6207316703", "Венцеслав Георгиев Делов");
    expect(r.kind).toBe("person");
    expect(r.eik).not.toContain("6207316703");
    expect(r.eik).toMatch(/^np-[0-9a-f]{12}$/);
  });

  test("the personal test runs BEFORE the EIK test", () => {
    // The whole leak: an ЕГН passes isValidEik, so an EIK-first order stores it.
    expect(
      classifySupplierId("7102238334", "Антоанета Николаева Генева").kind,
    ).toBe("person");
  });

  test("a checksum-failing 10-digit id is NOT claimed as personal", () => {
    // Deliberate scope limit. A name-shape heuristic was tried here and removed:
    // "Капш Телематик Сървисис" matched it, so real foreign companies were re-keyed
    // as people. An invalid checksum cannot distinguish a masked ЕГН from a typo or a
    // foreign registry id, so these stay with defect D-3 rather than being guessed at.
    for (const [id, name] of [
      ["1111111111", "Веселин Паунов"],
      ["1200351010", "Борислав Вълчев"],
      ["0000340505", "Капш Телематик Сървисис"],
      ["6142046888", "Argus Media Limited"],
    ] as const) {
      expect(classifySupplierId(id, name).kind).not.toBe("person");
    }
  });

  test("a separator- or prefix-bearing ЕГН does not leak", () => {
    // Regression: `isEgn` tested only the RAW token, and step 3 recognises only exact
    // 9-/13-digit runs, so a separated 10-digit run fell through to the foreign fallback
    // — which strips non-alphanumerics and stored the bare ЕГН, i.e. the pre-fix state.
    // The feed demonstrably publishes space-grouped ids (step 3 exists for "827 184 123").
    for (const id of [
      "620 731 6703",
      "ЕГН 6207316703",
      "6207316703-",
      "BG6207316703",
      "6207-3167-03",
    ]) {
      const r = classifySupplierId(id, "Венцеслав Георгиев Делов");
      expect(r.kind).toBe("person");
      expect(r.eik).toMatch(/^np-[0-9a-f]{12}$/);
      expect(r.eik).not.toContain("6207316703");
    }
  });

  test("an organisation whose id passes mod-11 by chance is NOT a person", () => {
    // The ЕГН checksum is mod-11, so ~1 in 11 arbitrary 10-digit ids passes. This
    // Hungarian company's registry id does, and it was re-keyed as a natural person.
    // The earlier "zero false positives" measurement validated against `tr_companies`,
    // which holds only BG companies and so could not surface this at all.
    const r = classifySupplierId("0109065346", "Evig Mérnök Vállalkozói Kft");
    expect(isEgn("0109065346")).toBe(true); // the checksum really does pass
    expect(r.kind).not.toBe("person");
    expect(
      isPersonalSupplier("0109065346", "Evig Mérnök Vállalkozói Kft"),
    ).toBe(false);
    // …but the same id beside a personal name still is one.
    expect(isPersonalSupplier("0109065346", "Иван Петров Георгиев")).toBe(true);
  });

  test("clean BG EIKs still resolve as bg", () => {
    for (const [id, expected] of [
      ["181339162", "181339162"], // КОНСОРЦИУМ БУЛЕМУ
      ["207661045", "207661045"], // РВП ИНВЕСТ ЕООД
      ["0006952811234", "000695281"], // 13-digit branch → 9-digit parent
    ] as const) {
      const r = classifySupplierId(id, "Някаква фирма ЕООД");
      expect(r.kind).toBe("bg");
      expect(r.eik).toBe(expected);
      expect(r.foreign).toBe(false);
    }
  });

  test("messy BG ids are still recovered", () => {
    for (const id of ["BG104529087", "ЕИК 205994492", "827 184 123"]) {
      expect(classifySupplierId(id, "Фирма ООД").kind).toBe("bg");
    }
  });

  test("letter-bearing foreign ids are kept, not dropped", () => {
    // The Alstom class — these are the members that vanished from 00042-2024-0005.
    for (const [id, name] of [
      ["RO6640696", "ALSTOM TRANSPORT SA"],
      ["IT02791070044", "Alstom Ferroviaria SpA"],
      ["FN278233T", "Hitachi Rail GTS Austria GmbH"],
      ["91320594714112290N", "Хайгър Бус Кампъни Лтд."],
    ] as const) {
      const r = classifySupplierId(id, name);
      expect(r.kind).toBe("foreign");
      expect(r.eik).not.toBe("");
    }
  });

  test("withheld identities carry no key", () => {
    for (const id of ["не се публикува", "—", "n/a", "", undefined]) {
      const r = classifySupplierId(id, "Някой");
      expect(r.kind).toBe("anonymous");
      expect(r.eik).toBe("");
    }
  });
});

describe("personSupplierKey", () => {
  test("is deterministic and case/spacing insensitive", () => {
    const a = personSupplierKey("Венцеслав Георгиев Делов");
    expect(a).toBe(personSupplierKey("  венцеслав   георгиев  делов "));
    expect(a).toMatch(/^np-[0-9a-f]{12}$/);
  });

  test("distinct people get distinct keys", () => {
    // The placeholder-pooling bug: 20 different people shared `1234567899` in
    // 02023-2023-0012. Name-derived keys separate them.
    const keys = new Set(
      ["Божин Илиев Бонев", "Илия Ненчев Илиев", "Георги Тодоров Пеков"].map(
        personSupplierKey,
      ),
    );
    expect(keys.size).toBe(3);
  });

  test("no usable name means no identity", () => {
    expect(personSupplierKey("")).toBe("");
    expect(personSupplierKey(undefined)).toBe("");
  });
});
