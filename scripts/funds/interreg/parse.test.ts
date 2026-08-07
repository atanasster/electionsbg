import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseOperation,
  eikFromBeneficiaryId,
  budgetBasisOf,
  bulgarianPartners,
  OperationParseError,
  type KeepProjectRaw,
} from "./parse";
import { __resetProgrammeWarnings } from "./programmes";
import { isBulgarianPartner } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FETCHED = "2026-08-07T00:00:00.000Z";

const fixture = (keepId: number): KeepProjectRaw =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", `${keepId}.json`), "utf8"),
  );

const parsed = (keepId: number) => {
  const p = parseOperation(fixture(keepId), FETCHED);
  if (!p) throw new Error(`fixture ${keepId} was not admitted`);
  return p;
};

const bgNamed = (keepId: number, name: RegExp) => {
  const hit = bulgarianPartners(parsed(keepId)).find((p) =>
    name.test(p.partnerName),
  );
  if (!hit) throw new Error(`no BG partner matching ${name} in ${keepId}`);
  return hit;
};

beforeEach(() => __resetProgrammeWarnings());

describe("the four Малко Търново operations — plan §3.1, against the real payload", () => {
  // These are the rows that started the whole investigation: real operations the
  // municipality's own register lists and `fund_projects` does not have.
  it.each([
    [33607, "BSB00963", /Малко Търново/, 357183.12, "000057086", 321464.8],
    [32348, "BGTR0200037", /Малко Търново/, 178814.72, "000057086", 151992.51],
    [32344, "BGTR0200044", /Александър Фол/, 261847.74, "102826129", 222570.57],
    [32324, "BGTR0200100", /Александър Фол/, 204236.48, "102826129", 173601.0],
  ])(
    "%s (%s) attributes exactly €%s to the right EIK",
    (keepId, operationId, name, budget, eik, coFinancing) => {
      const op = parsed(keepId as number).operation;
      expect(op.operationId).toBe(operationId);
      const p = bgNamed(keepId as number, name as RegExp);
      expect(p.budgetEur).toBe(budget);
      expect(p.eik).toBe(eik);
      // §3.1's fifth column. 2021-2027 carries it; 2014-2020 does not, which
      // the older-template block below asserts from the other side.
      expect(p.euFundingEur).toBe(coFinancing);
    },
  );

  // The inversion this whole design exists to prevent: `total_budget` appears at
  // BOTH levels with the same name. BSB00963's operation total is €1,419,207.76
  // and Малко Търново's share is €357,183.12 — storing the former would put ~4x
  // the true money on a 2,628-person municipality.
  it("never lets an operation total reach a partner row", () => {
    const { operation, partners } = parsed(33607);
    expect(operation.totalBudgetEur).toBe(1419207.76);
    for (const p of partners)
      expect(p.budgetEur, p.partnerName).not.toBe(operation.totalBudgetEur);
    const bg = bgNamed(33607, /Малко Търново/);
    expect(bg.budgetEur).toBeLessThan(operation.totalBudgetEur! / 3);
  });

  it("records the lead partner, which is not always the Bulgarian one", () => {
    // BGTR0200100's lead IS the Малко Търново museum; BGTR0200037's is Средец.
    expect(bgNamed(32324, /Александър Фол/).isLead).toBe(true);
    expect(bgNamed(32348, /Малко Търново/).isLead).toBe(false);
    expect(bgNamed(32348, /Средец/).isLead).toBe(true);
  });

  it("keeps every partner, not only the Bulgarian ones", () => {
    const { operation, partners } = parsed(33607);
    // A literal count, not `operation.partnerCount` — that is assigned from
    // the same array this maps, so comparing them cannot fail.
    expect(partners.length).toBe(5);
    expect(operation.partnerCount).toBe(5);
    expect(bulgarianPartners(parsed(33607)).length).toBe(1);
    expect(operation.countries).toContain("Bulgaria");
    expect(operation.countries.length).toBeGreaterThan(1);
    // Verbatim names, sorted — never ISO2 minted from a curated map.
    expect(operation.countries).toEqual([...operation.countries].sort());
  });

  it("carries the department country on a parsed row", () => {
    const { partners } = parsed(33607);
    expect(partners.map((p) => p.countryDepartment)).toContain("Bulgaria");
    for (const p of partners) expect(p.country).not.toBe("BG");
  });

  it("orders partnerSeq by keep.eu's stable partnership id, not array order", () => {
    const { partners } = parsed(33607);
    const ids = partners.map((p) => p.keepPartnershipId!);
    expect(ids.every((n) => Number.isInteger(n))).toBe(true);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(partners.map((p) => p.partnerSeq)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("the 2014-2020 shape — what the older template does not carry", () => {
  const OP = 17853; // INTERREG V-A Romania-Bulgaria, Община Никопол leading

  it("accepts a NULL project_id and keys the row on keepId", () => {
    const { operation } = parsed(OP);
    expect(operation.operationId).toBeNull();
    expect(operation.keepId).toBe(OP);
    expect(operation.period).toBe("2014-2020");
    expect(operation.programmeCode).toBe("INTERREG-ROBG-1420");
  });

  // The audit's central finding, pinned: the identity columns are 2021-2027
  // only. Asserting their ABSENCE means a future keep.eu change that starts
  // supplying them is noticed rather than silently absorbed.
  it("carries no EIK, no PIC and no partner-level EU funding", () => {
    const bg = bgNamed(OP, /Никопол/);
    expect(bg.eik).toBeNull();
    expect(bg.pic).toBeNull();
    expect(bg.euFundingEur).toBeNull();
    expect(bg.orgType).toBeNull();
  });

  it("still carries the money and the place — which is what Tier P needs", () => {
    const bg = bgNamed(OP, /Никопол/);
    expect(bg.budgetEur).toBe(3376920.46);
    expect(bg.budgetBasis).toBe("published");
    expect(bg.postcode).toBe("5940");
    expect(bg.lat).toBeCloseTo(43.7, 1);
    expect(bg.lng).toBeCloseTo(24.89, 1);
    expect(bg.partnerName).toBe("Община Никопол");
    expect(bg.partnerNameEn).toBe("Nikopol Municipality");
  });
});

describe("eikFromBeneficiaryId", () => {
  it.each([
    ["BG000057086 | 000057086 | Registry number (EN)", "000057086"],
    ["BG102826129 | 102826129 | BULSTAT (EN)", "102826129"],
    ["BG000903939 | 000903939 | N/A (EN)", "000903939"],
    ["BG202710983 | 202710983", "202710983"],
    ["000044783", "000044783"],
    ["BG000056878", "000056878"],
    ["BG 129010723", "129010723"],
    ["4200781540009", "420078154"], // 13-digit branch form → 9-digit parent
  ])("reads %o as %o", (raw, eik) => {
    expect(eikFromBeneficiaryId(raw)).toBe(eik);
  });

  it.each<[string | null | undefined, string]>([
    ["N.a.", "the programme published no id"],
    ["N/A | 17590372", "an 8-digit foreign id is not an EIK"],
    ["", "empty"],
    [null, "absent"],
    [undefined, "absent"],
    ["02760517", "8 digits"],
    [
      "1234567890",
      "10 digits — could be a legacy BULSTAT or an \u0415\u0413\u041d",
    ],
  ])("returns null for %o (%s)", (raw) => {
    expect(eikFromBeneficiaryId(raw)).toBeNull();
  });

  // The trap. `BG120000002` is keep.eu's own partner code and is shaped exactly
  // like a BG-prefixed EIK; accepting it would attribute a real company's money
  // to an id that identifies nobody.
  it("refuses keep.eu's internal partner code even though it looks like an EIK", () => {
    expect(eikFromBeneficiaryId("BG120000002")).toBeNull();
    expect(eikFromBeneficiaryId("BG220000001")).toBeNull();
    // …and does not let it win when a real id sits beside it.
    expect(
      eikFromBeneficiaryId("BG000093442 | BG120000002 | - (FR), - (EN)"),
    ).toBe("000093442");
    // …nor when the first token is unparseable, which is the case that would
    // otherwise fall through to it.
    expect(eikFromBeneficiaryId("- | BG120000003 | - (EN)")).toBeNull();
  });

  // The sequence is SIX digits. The first rule covered 00-99 only, which is
  // why this band was invisible: BG is at 18 today while PT/FR/ES/IT are past
  // 100 in the same corpus. `120000560` is tr_companies.uic for СЛЕЙ.
  it("refuses a keep code whose sequence has run past 99", () => {
    expect(eikFromBeneficiaryId("BG120000560")).toBeNull();
    expect(eikFromBeneficiaryId("BG120000973")).toBeNull();
    expect(
      eikFromBeneficiaryId("n/a | BG120000100 | National ID (EN)"),
    ).toBeNull();
    // …while the real EIK in the same triple still wins.
    expect(
      eikFromBeneficiaryId("BG000615118 | BG120000012 | - (FR), - (EN)"),
    ).toBe("000615118");
  });

  // 35 rows in the corpus resolve from a LATER slot because slot 0 holds a
  // free-text marker. These are the real markers, verbatim.
  it.each([
    [
      "Not applicable | 176765096 | Identification code according to BG legislation (EN)",
      "176765096",
    ],
    ["No | 117082309", "117082309"],
    ["NA | 102230428", "102230428"],
    ["- | 000057086", "000057086"],
  ])("falls through an unparseable first slot: %o", (raw, eik) => {
    expect(eikFromBeneficiaryId(raw)).toBe(eik);
  });

  it("does not mistake another country's keep code for an EIK", () => {
    expect(eikFromBeneficiaryId("FR590000005")).toBeNull();
    expect(eikFromBeneficiaryId("IT404000002 | - (FR), - (EN)")).toBeNull();
  });
});

describe("budgetBasisOf — three states, none inferred", () => {
  it("distinguishes a published zero from an unpublished budget", () => {
    expect(budgetBasisOf(1)).toBe("published");
    expect(budgetBasisOf(357183.12)).toBe("published");
    expect(budgetBasisOf(0)).toBe("published_zero");
    expect(budgetBasisOf(null)).toBe("unpublished");
  });

  it("never equal-splits an operation total to fill an unpublished budget", () => {
    const raw = fixture(33607);
    // Identify the row by keep.eu's partnership id, not by array index —
    // `partnerSeq` is now ordered by that id, so raw[0] need not be parsed[0].
    const id = raw.partnerships![0].id;
    raw.partnerships![0].total_budget = null;
    const p = parseOperation(raw, FETCHED)!;
    const row = p.partners.find((q) => q.keepPartnershipId === id)!;
    expect(row.budgetEur).toBeNull();
    expect(row.budgetBasis).toBe("unpublished");
  });
});

describe("what parseOperation refuses", () => {
  it("skips an unadmitted programme with one warning, rather than throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = fixture(33607);
    raw.programme = {
      id: 339,
      title: "Romania - Rep.Moldova",
      period: { title: "2021-2027" },
    };
    expect(parseOperation(raw, FETCHED)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("throws when keep.eu's period disagrees with the curated register", () => {
    const raw = fixture(33607);
    raw.programme!.period = { title: "2014-2020" };
    expect(() => parseOperation(raw, FETCHED)).toThrow(/register says/);
  });

  it("fences out a period we do not ingest", () => {
    const raw = fixture(33607);
    raw.programme!.period = { title: "2007-2013" };
    expect(() => parseOperation(raw, FETCHED)).toThrow(/outside/);
  });

  it("throws only when NO language carries a title", () => {
    const raw = fixture(33607);
    raw.translations = { en: { name: null } };
    expect(() => parseOperation(raw, FETCHED)).toThrow(
      /no title in any language/,
    );
  });

  // keep.eu files two plainly-English titles under `mt` and `it`. Refusing them
  // would drop real operations over a language-detection slip.
  it("falls back to another language and records which one it used", () => {
    const raw = fixture(33607);
    const name = raw.translations!.en!.name;
    raw.translations = { it: { name, description: null } };
    const op = parseOperation(raw, FETCHED)!.operation;
    expect(op.titleEn).toBe(name);
    expect(op.titleLang).toBe("it");
  });

  it("reports titleLang as en for the normal case", () => {
    expect(parsed(33607).operation.titleLang).toBe("en");
  });

  it("throws rather than dropping a project with no programme", () => {
    const raw = fixture(33607);
    raw.programme = null;
    expect(() => parseOperation(raw, FETCHED)).toThrow(/no programme/);
  });
});

describe("the two budget levels", () => {
  // keep.eu does not guarantee they reconcile: 68 of 1,954 operations exceed
  // their total by 2%-66%, concentrated in the transnational programmes.
  // Refusing them dropped 64 Bulgarian rows and €9.47m at exit 0.
  it("KEEPS an operation whose partner budgets exceed its total, recording the sum", () => {
    const raw = fixture(33607);
    raw.total_budget = "1000.00";
    const { operation } = parseOperation(raw, FETCHED)!;
    expect(operation.totalBudgetEur).toBe(1000);
    expect(operation.partnerBudgetSumEur).toBeGreaterThan(1000);
  });

  it("records a null partner sum when no partner publishes a budget", () => {
    const raw = fixture(33607);
    for (const p of raw.partnerships!) p.total_budget = null;
    expect(
      parseOperation(raw, FETCHED)!.operation.partnerBudgetSumEur,
    ).toBeNull();
  });

  // The one budget shape that IS refused: a structural impossibility rather
  // than a reconciliation gap. Measured clean across all 1,954 operations, so
  // this is a tripwire and not a filter.
  it("throws when one partner carries the whole operation total beside a funded sibling", () => {
    const raw = fixture(33607);
    raw.partnerships![0].total_budget = raw.total_budget;
    expect(() => parseOperation(raw, FETCHED)).toThrow(OperationParseError);
    expect(() => parseOperation(raw, FETCHED)).toThrow(
      /entire operation total/,
    );
  });

  it("allows a sole funded partner to equal the total when the others are zero", () => {
    const raw = fixture(33607);
    raw.partnerships = raw.partnerships!.slice(0, 2);
    raw.partnerships[0].total_budget = raw.total_budget;
    raw.partnerships[1].total_budget = "0.00";
    expect(() => parseOperation(raw, FETCHED)).not.toThrow();
  });

  it("throws on a negative partner budget", () => {
    const raw = fixture(33607);
    raw.partnerships![0].total_budget = "-1.00";
    expect(() => parseOperation(raw, FETCHED)).toThrow(/negative budget/);
  });
});

describe("isBulgarianPartner", () => {
  it("counts a Bulgarian department of a foreign organisation", () => {
    expect(
      isBulgarianPartner({ country: "Greece", countryDepartment: "Bulgaria" }),
    ).toBe(true);
    expect(
      isBulgarianPartner({ country: "Bulgaria", countryDepartment: null }),
    ).toBe(true);
    expect(
      isBulgarianPartner({ country: "Greece", countryDepartment: "Greece" }),
    ).toBe(false);
  });
});

describe("published_zero, end to end — operation 25693", () => {
  // The two rows plan §3.1 names by hand as the published_zero example.
  const OP = 25693;

  it("keeps a literal 0.00 as published_zero, never as unpublished", () => {
    const zero = parsed(OP).partners.filter((p) => p.budgetEur === 0);
    expect(zero.length).toBeGreaterThanOrEqual(2);
    for (const p of zero) expect(p.budgetBasis).toBe("published_zero");
    const names = zero.map((p) => p.partnerName).join(" | ");
    expect(names).toMatch(/Клуб на инвалидите/);
    expect(names).toMatch(/Регионална библиотека Хасково/);
  });

  it("counts a published zero as covered by the partner-budget sum", () => {
    const { operation, partners } = parsed(OP);
    // published_zero contributes 0 to the money and 1 to the coverage count —
    // that is the whole point of not folding it into `unpublished`.
    expect(operation.partnerBudgetPublishedCount).toBe(
      partners.filter((p) => p.budgetEur !== null).length,
    );
    expect(operation.partnerBudgetPublishedCount).toBeGreaterThan(
      partners.filter((p) => p.budgetBasis === "published").length,
    );
  });
});

describe("the shapes a consumer must not assume", () => {
  // 7 of 1,954 operations carry TWO lead partners. Anything written to "the
  // lead partner" is wrong on those, so pin the shape before T3 builds a page.
  it("permits more than one lead on an operation", () => {
    const leads = parsed(33607).partners.filter((p) => p.isLead);
    expect(leads.length).toBeGreaterThanOrEqual(1);
  });

  it("throws on a present-but-unparseable number rather than calling it unpublished", () => {
    const raw = fixture(33607);
    raw.partnerships![0].total_budget = "n/a";
    expect(() => parseOperation(raw, FETCHED)).toThrow(/is not a number/);
  });

  it("throws when a partner has no country", () => {
    const raw = fixture(33607);
    raw.partnerships![0].partner!.country = null;
    expect(() => parseOperation(raw, FETCHED)).toThrow(/has no country/);
  });

  it("throws when a partner has no name in any language", () => {
    const raw = fixture(33607);
    raw.partnerships![0].partner!.name = null;
    raw.partnerships![0].partner!.translations = {
      en: { name_translated: null },
    };
    expect(() => parseOperation(raw, FETCHED)).toThrow(/has no name/);
  });
});
