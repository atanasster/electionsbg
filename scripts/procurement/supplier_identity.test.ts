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
  placeholderSupplierKey,
} from "./supplier_identity";
import { isPlaceholderId, isValidEik } from "./eik";

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

  test("the four suppliers of УНП 00042-2024-0005 all resolve to a key", () => {
    // The award that started this: МТС, €451.5m, 35 electric multiple units. The raw
    // ЦАИС release (raw_data/procurement/eop/2025-05-02.json.gz, noticeId 686114) names
    // four suppliers; the corpus held two, because a non-BG member of a MIXED consortium
    // was dropped. Verbatim from `supplierRegisterNumber` / `supplierName`:
    const suppliers: [string, string][] = [
      ["181339162", "КОНСОРЦИУМ БУЛЕМУ"],
      ["RO6640696", "ALSTOM TRANSPORT SA"],
      ["IT02791070044", "Alstom Ferroviaria SpA"],
      ["207661045", "РВП ИНВЕСТ ЕООД"],
    ];
    const resolved = suppliers.map(([id, name]) =>
      classifySupplierId(id, name),
    );
    // Every one keyed, and four DISTINCT keys — the split denominator is the distinct
    // key count, so a collision here would silently multiply the award's value.
    expect(resolved.every((r) => r.eik !== "")).toBe(true);
    expect(new Set(resolved.map((r) => r.eik)).size).toBe(4);
    expect(resolved.map((r) => r.kind)).toEqual([
      "bg",
      "foreign",
      "foreign",
      "bg",
    ]);
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

describe("placeholder supplier ids", () => {
  // ⚠ THE TEST DIRECTLY ABOVE ALREADY NAMED THIS BUG AND DID NOT GATE IT. Its comment
  // says "20 different people shared `1234567899`", but it exercises
  // `personSupplierKey` directly — and `1234567899` is not an ЕГН (month 34), so
  // `classifySupplierId` never reached the personal branch. It fell through to
  // `isValidEik`, which accepted ten digits, and the id became a company key.
  // Measured on the live corpus before this fix: 22 distinct people under that one
  // key, and nine unrelated suppliers under `000000001` — Elsevier's €32.8M and
  // Clarivate's €11.2M rendered as ONE contractor on every leaderboard.
  //
  // Every id below is a real token from the `contracts` table.

  test.each([
    ["000000001", "9 unrelated suppliers, Elsevier B.V. the largest"],
    ["000000002", "2 natural persons"],
    ["000000003", "same family as its two siblings"],
    ["999999999", "7 names"],
    ["9999999999", "€13.6M under one filler"],
    ["1234567899", "22 natural persons"],
    ["123456789", "2 names"],
    ["0000", "13 rows"],
    ["1111111111", "4 names"],
    ["00", "single row, still not an identity"],
  ])("%s is filler, not an identity", (id) => {
    expect(isPlaceholderId(id)).toBe(true);
    expect(isValidEik(id)).toBe(false);
    expect(classifySupplierId(id, "Някаква фирма ООД").kind).toBe(
      "placeholder",
    );
  });

  // The rule that is NOT "the number is small" — these are real, and a value
  // threshold (the obvious implementation) would re-key every one of them.
  test.each([
    ["000000210", "ДГС Гърмен — a live AWARDER"],
    ["000000281", "ДЛС Дикчан — a live awarder"],
    ["000000491", "ТПК Нов свят — lowest uic in tr_companies"],
    ["000000726", "ТПК Георги Андрия"],
    ["000003270", "Автотехника Пирин ЕООД"],
    ["131468980", "А1 България ЕАД"],
    ["000695114", "МОН"],
  ])("%s is a REAL id and must survive", (id) => {
    expect(isPlaceholderId(id)).toBe(false);
    expect(isValidEik(id)).toBe(true);
    expect(classifySupplierId(id, "Каквото и да е ООД")).toMatchObject({
      kind: "bg",
      eik: id,
    });
  });

  test("pooled suppliers come apart into distinct keys", () => {
    // The whole point. Same filler id, different companies → different keys.
    const keys = [
      "Elsevier B. V.",
      "„Кларивейт Аналитикс” ЕООД",
      "Vier Gas Transport GmbH",
      "Plagiat-Sistem Antiplagiat prin Internet SRL",
    ].map((n) => classifySupplierId("000000001", n).eik);
    expect(new Set(keys).size).toBe(4);
    for (const k of keys) expect(k).toMatch(/^ph-[0-9a-f]{12}$/);
  });

  test("the key is stable and whitespace-insensitive", () => {
    expect(placeholderSupplierKey("Elsevier B. V.")).toBe(
      placeholderSupplierKey("  elsevier   b. v. "),
    );
  });

  test("no usable name means no identity", () => {
    expect(placeholderSupplierKey("")).toBe("");
    expect(classifySupplierId("000000001", "").eik).toBe("");
  });

  test("the two rule sets are disjoint, so the branch order is defensive", () => {
    // An earlier version of this test asserted `1111111111` passes the ЕГН checksum
    // and therefore that the branch order was load-bearing. Both halves were wrong:
    // it fails the checksum, and NO filler value passes it. Pin the real property
    // instead — if a future denylist entry ever overlapped the ЕГН space, the two
    // branches would disagree about what the key means and this fails first.
    // DERIVED, not hand-listed: the previous list carried `1234567890`, which is
    // not a placeholder at all (9→0 breaks the run, so `isValidEik` accepts it),
    // and omitted genuine members — so it tested a set that was neither.
    const fillers = Array.from({ length: 10_000 }, (_, n) =>
      String(n).padStart(10, "0"),
    )
      .concat(Array.from({ length: 10 }, (_, d) => String(d).repeat(10)))
      .filter(isPlaceholderId);
    expect(fillers.length).toBeGreaterThan(10); // else the filter is vacuous
    expect(fillers.filter(isEgn)).toEqual([]);

    // Order still checked, because the disjointness above is a property of today's
    // rules rather than of the design.
    const r = classifySupplierId("1111111111", "Иван Петров Иванов");
    expect(r.kind).toBe("placeholder");
    expect(r.eik).toMatch(/^ph-/);
  });

  test("a real ЕГН still classifies as a person", () => {
    // Guards the branch order in the other direction: adding the filler check
    // first must not swallow the personal case this module exists for.
    const r = classifySupplierId("6207316703", "Венцеслав Георгиев Делов");
    expect(r.kind).toBe("person");
    expect(r.eik).toMatch(/^np-/);
  });
});

describe("isPlaceholderId — the boundaries that survived mutation", () => {
  // Review found the `>= 8` floor in isAscendingRun survived mutation in BOTH
  // directions: nothing in the suite moved when it became 7 or 9. These pin it.

  test("a run shorter than 8 is NOT filler", () => {
    // `1234567` is 7 digits. canonicalEik zero-pads 5-8 digit ids to nine, so a
    // short ascending run is a plausible recovered EIK and must survive.
    expect(isPlaceholderId("1234567")).toBe(false);
    expect(isPlaceholderId("123456")).toBe(false);
  });

  test("a run of exactly 8 IS filler", () => {
    expect(isPlaceholderId("12345678")).toBe(true);
  });

  test("the trailing-repeat strip only shortens, never widens", () => {
    // `1234567899` is the live case: strip the trailing `9` run to `123456789`.
    expect(isPlaceholderId("1234567899")).toBe(true);
    // …but stripping must not manufacture a run out of an unrelated id. A real
    // EIK ending in repeated digits stays real.
    expect(isPlaceholderId("131468980")).toBe(false);
    expect(isPlaceholderId("175905700")).toBe(false);
  });

  test("a single digit is filler — the `\\1+` vs `\\1*` gap", () => {
    // `/^(\d)\1+$/` needs two characters, so a bare "0" escaped every rule while
    // the docstring claimed it was covered. Live corpus: `contractor_eik = '0'`
    // pooled 5 unrelated suppliers and €693,796. All 48 tests passed either way.
    for (const d of "0123456789") expect(isPlaceholderId(d)).toBe(true);
  });

  test("separator-grouped filler is still filler", () => {
    // The feed publishes space-grouped numbers, so the classifier tests the
    // digits-only form too. Without it these reach the foreign fallback, which
    // stores the token verbatim and re-pools the suppliers.
    for (const raw of ["000 000 001", "000-000-001", "999 999 999"]) {
      const r = classifySupplierId(raw, "Elsevier B. V.");
      expect(r.kind, raw).toBe("placeholder");
      expect(r.eik, raw).toMatch(/^ph-/);
    }
  });

  test("non-numeric ids are untouched", () => {
    // Foreign registry ids keep the `foreign` path — the filler rules are
    // digits-only by construction.
    expect(isPlaceholderId("ATU14715405")).toBe(false);
    expect(classifySupplierId("RO6640696", "Ceva SRL").kind).toBe("foreign");
  });
});
