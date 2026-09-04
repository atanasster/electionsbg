// The listing-vs-filing role rule. Every fixture below is a VERBATIM value measured in the
// 2025+ Сметна палата corpus on 2026-09-04 — the promotions, and every near-miss the rule has
// to refuse. Plan: docs/plans/officials-roster-missing-mayor-v1.md (T2).

import { describe, it, expect } from "vitest";
import {
  reconcileRole,
  statesPlainMayoralty,
  employerIsMunicipality,
  municipalSlugDisambiguator,
  countRoles,
  emptyByRole,
} from "./role_reconcile";
import type { MunicipalOfficialRole } from "../../src/data/dataTypes";

const run = (
  listingRole: MunicipalOfficialRole,
  filedPosition: string | null,
  filedInstitution: string | null,
  listingMunicipality: string,
): MunicipalOfficialRole =>
  reconcileRole({
    listingRole,
    filedPosition,
    filedInstitution,
    listingMunicipality,
  });

describe("reconcileRole — the four sitting mayors the register mislabelled", () => {
  it("promotes Мъглиж", () => {
    expect(
      run("deputy_mayor", "Кмет на Община Мъглиж", "Община Мъглиж", "Мъглиж"),
    ).toBe("mayor");
  });

  it("promotes Макреш (the register shouts)", () => {
    expect(
      run("deputy_mayor", "КМЕТ НА ОБЩИНА", "ОБЩИНА МАКРЕШ", "Макреш"),
    ).toBe("mayor");
  });

  it("promotes Разград, whose filing says only „Кмет“", () => {
    expect(run("deputy_mayor", "Кмет", "Община Разград", "Разград")).toBe(
      "mayor",
    );
  });

  // Раднево is the one filed under a DIFFERENT wrong bucket, which is why the rule admits
  // `councillor` as well as `deputy_mayor`.
  it("promotes Раднево, listed as a councillor", () => {
    expect(run("councillor", "Кмет", "Община Раднево", "Раднево")).toBe(
      "mayor",
    );
  });
});

describe("reconcileRole — what it must refuse", () => {
  // ⚠️ THE DEFECT CLASS THIS RULE IS MOST LIKELY TO CREATE. Thirteen deputies write their own
  // title in a way no „does it say заместник" test can see — eleven misspellings and two
  // abbreviations — so a rule built on that test would publish every one of them as their
  // município's mayor. All thirteen are verbatim corpus values.
  it.each([
    "заместик кмет",
    "зместник кмет",
    "заестник кмет",
    "замвстник кмет",
    "замесник-кмет",
    "заметник-кмет",
    "земестник кмет",
    "заестник-кмет",
    "замесник - кмет на община",
    "заместни-кмет на община троян",
    "заестник кмет устройство на територията",
    "зам . кмет",
    "зам кмет",
  ])("refuses a misspelt or abbreviated deputy: %s", (filed) => {
    expect(run("deputy_mayor", filed, "Община Троян", "Троян")).toBe(
      "deputy_mayor",
    );
  });

  // The control: the canonical spelling must be refused for the ordinary reason, not because
  // it happens to be in the variant list above.
  it("refuses the correctly spelled deputy label", () => {
    expect(run("deputy_mayor", "Заместник кмет", "Община Троян", "Троян")).toBe(
      "deputy_mayor",
    );
  });

  // A village mayoralty satisfies "starts with кмет" and is a DIFFERENT office. Measured: a
  // kindergarten director filing as „Кмет" of „Кметство Габра".
  it("refuses a village (кметство) mayor", () => {
    expect(run("councillor", "Кмет", "Кметство Габра", "Елин Пелин")).toBe(
      "councillor",
    );
  });

  // ⚠️ These two are the object-side guard, which must hold WITHOUT help from the employer
  // rule — a кметство mayor whose filing names the община as their employer (factually true)
  // satisfies the employer rule and must still be refused.
  it("refuses a кметство mayoralty even when the employer IS the община", () => {
    expect(
      run(
        "councillor",
        "Кмет на кметство Габра",
        "Община Елин Пелин",
        "Елин Пелин",
      ),
    ).toBe("councillor");
  });

  it("refuses a район mayoralty even when the employer IS the община", () => {
    expect(
      run("deputy_mayor", "Кмет на район Люлин", "Община Столична", "Столична"),
    ).toBe("deputy_mayor");
  });

  // ⚠️ THE CONTROL THAT KEEPS THE GUARD FROM OVER-MATCHING: „Ново село" is a real município,
  // so „село" must never join the lower-tier token list.
  it("still promotes a município whose NAME contains село", () => {
    expect(
      run(
        "deputy_mayor",
        "кмет на община ново село",
        "Община Ново село",
        "Ново село",
      ),
    ).toBe("mayor");
  });

  it("refuses a район mayor", () => {
    expect(
      run("deputy_mayor", "кмет на район средец", "Район Средец", "Средец"),
    ).toBe("deputy_mayor");
  });

  // Acting posts: the office is being covered, but the person is not its holder, and the
  // reconcile this feeds asks whether the ELECTED mayor still sits.
  it.each(["временно изпълняващ длъжността кмет", "вр. и. д. кмет на район"])(
    "refuses an acting mayor: %s",
    (filed) => {
      expect(run("deputy_mayor", filed, "Община Криводол", "Криводол")).toBe(
        "deputy_mayor",
      );
    },
  );

  it("refuses when the filed employer is a DIFFERENT município", () => {
    // The corroboration is what makes the leading-„кмет" test safe; without it a mayor who
    // moonlights elsewhere would be published as this município's mayor.
    expect(run("deputy_mayor", "Кмет", "Община Кричим", "Разград")).toBe(
      "deputy_mayor",
    );
  });

  it.each([
    ["общински съветник", "councillor"],
    ["народен представител", "councillor"],
    ["директор музей", "deputy_mayor"],
    ["председател на общински съвет криводол", "deputy_mayor"],
  ] as const)("refuses an unrelated office: %s", (filed, role) => {
    expect(run(role, filed, "Община Криводол", "Криводол")).toBe(role);
  });

  it("leaves a missing filed position alone", () => {
    expect(run("deputy_mayor", null, "Община Мъглиж", "Мъглиж")).toBe(
      "deputy_mayor",
    );
    expect(run("deputy_mayor", "Кмет", null, "Мъглиж")).toBe("deputy_mayor");
  });

  // The rule may only ever ADD a mayor to a município that has none — never relabel one.
  it.each(["mayor", "council_chair", "chief_architect"] as const)(
    "never rewrites the %s bucket",
    (role) => {
      expect(run(role, "общински съветник", "Община Мъглиж", "Мъглиж")).toBe(
        role,
      );
    },
  );
});

describe("the two halves, separately", () => {
  it("statesPlainMayoralty anchors at the start and stops at a word boundary", () => {
    expect(statesPlainMayoralty("Кмет")).toBe(true);
    expect(statesPlainMayoralty("кмет на община")).toBe(true);
    expect(statesPlainMayoralty("кметство габра")).toBe(false);
    expect(statesPlainMayoralty("кмет на кметство габра")).toBe(false);
    expect(statesPlainMayoralty("кмет на район люлин")).toBe(false);
    expect(statesPlainMayoralty("кмет на община ново село")).toBe(true);
    expect(statesPlainMayoralty("кметски наместник")).toBe(false);
    expect(statesPlainMayoralty("заместник кмет")).toBe(false);
    expect(statesPlainMayoralty(null)).toBe(false);
  });

  it("employerIsMunicipality requires the „община“ form and the same name", () => {
    expect(employerIsMunicipality("Община Мъглиж", "Мъглиж")).toBe(true);
    expect(employerIsMunicipality("ОБЩИНА МАКРЕШ", "Макреш")).toBe(true);
    expect(employerIsMunicipality("Кметство Габра", "Габра")).toBe(false);
    expect(employerIsMunicipality("Район Средец", "Средец")).toBe(false);
    expect(employerIsMunicipality("Община Разград", "Раднево")).toBe(false);
    expect(employerIsMunicipality(null, "Мъглиж")).toBe(false);
  });

  it("tolerates the register's own oblast disambiguator on the listing name", () => {
    // The listing writes „Бяла/Варна/" where the name is ambiguous; the filing never does.
    expect(employerIsMunicipality("Община Бяла", "Бяла/Варна/")).toBe(true);
  });
});

// ─── TEST-001 ───────────────────────────────────────────────────────────────────────────
//
// The disambiguator is the highest-risk export here: it feeds `officialSlug`, so a regression
// is a moved /person URL and an orphaned declaration shard rather than a merely wrong value.
// The corpus gate covers it only for shapes that exist on disk today, which is neither the
// empty-`roleRaw` branch nor the fallback branch.
describe("municipalSlugDisambiguator", () => {
  it("is keyed on the LISTING role, so a corrected office does not move the slug", () => {
    // The whole point: same person, same município, published role promoted — same key.
    const before = municipalSlugDisambiguator({
      municipality: "Мъглиж",
      roleRaw: "Заместник кмет",
      role: "deputy_mayor",
    });
    const after = municipalSlugDisambiguator({
      municipality: "Мъглиж",
      roleRaw: "Заместник кмет",
      role: "mayor",
    });
    expect(after).toBe(before);
    expect(after).toBe("Мъглиж|deputy_mayor");
  });

  // ⚠️ PRESENCE, NOT TRUTHINESS. `roleRaw` is "" — never undefined — when the register omits
  // the label, and those rows' slugs were minted with mapRole("") === "other". A truthy guard
  // yields "Мъглиж|" instead, i.e. a different slug for an existing person.
  it("treats an EMPTY roleRaw as the register omitting the label, not as absent", () => {
    expect(
      municipalSlugDisambiguator({ municipality: "Мъглиж", roleRaw: "" }),
    ).toBe("Мъглиж|other");
  });

  it("falls back to the stored role only when roleRaw is genuinely absent", () => {
    // A row minted before the field existed, where the two were equal by construction.
    expect(
      municipalSlugDisambiguator({
        municipality: "Мъглиж",
        role: "council_chair",
      }),
    ).toBe("Мъглиж|council_chair");
  });
});

// ─── TEST-003's sibling: the tally that three writers now share ────────────────────────
describe("countRoles", () => {
  it("keeps every bucket, including the zero ones", () => {
    // Accumulating into `{}` drops zero-count buckets and reorders the keys — which produced
    // an index.json whose byRole disagreed in shape with the shards beside it, under a type
    // that promises a number for all six.
    const tally = countRoles([{ role: "mayor" }, { role: "mayor" }]);
    expect(Object.keys(tally)).toEqual(Object.keys(emptyByRole()));
    expect(tally.mayor).toBe(2);
    expect(tally.other).toBe(0);
  });

  it("an empty input is the seeded record, not an empty object", () => {
    expect(countRoles([])).toEqual(emptyByRole());
  });
});
