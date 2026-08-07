// Grouping guard for companies-index.json. The bug it locks: a political
// party writes its legal form as a PREFIX ("Политическа партия «Движение ДА
// българия»" / "ПП Движение ДА българия"), and the normalizer only ever
// folded the trailing ООД/ЕАД family. Both spellings therefore minted their
// own index entry, each holding a different subset of the years — the ДА
// България filings split 2021 on one page and 2023 on the other, so both
// under-reported the party's declared board with nothing failing.

import { describe, it, expect } from "vitest";
import { normalizeCompanyName, roleLabel } from "./build_company_index";
import type { MpOwnershipStake } from "../../src/data/dataTypes";

describe("normalizeCompanyName — party legal-form prefix", () => {
  it("folds the spelled-out and abbreviated party forms together", () => {
    expect(
      normalizeCompanyName('Политическа партия "Движение ДА българия"'),
    ).toBe(normalizeCompanyName("ПП Движение ДА българия"));
    expect(normalizeCompanyName("Политическа партия «Зелено движение»")).toBe(
      normalizeCompanyName("ПП Зелено движение"),
    );
  });

  it("folds коалиция / КП the same way", () => {
    expect(normalizeCompanyName("Коалиция Продължаваме промяната")).toBe(
      normalizeCompanyName("КП Продължаваме промяната"),
    );
  });

  it("leaves the party's own name intact after the prefix", () => {
    expect(normalizeCompanyName("ПП Движение ДА българия")).toBe(
      "движение да българия",
    );
  });

  // The prefix is anchored and demands a following space precisely so a
  // company whose name merely STARTS with those letters is untouched. Without
  // that, "ПП Сервиз ООД" would fold onto an unrelated "Сервиз ООД" and merge
  // two different companies' declared stakes onto one page.
  it("does not strip a look-alike that is part of the name", () => {
    expect(normalizeCompanyName("ППСервиз ООД")).toBe("ппсервиз");
    expect(normalizeCompanyName("ПП Сервиз ООД")).not.toBe(
      normalizeCompanyName("ППСервиз ООД"),
    );
  });

  it("still folds the trailing legal form it always did", () => {
    expect(normalizeCompanyName("Отзвук ЕООД")).toBe(
      normalizeCompanyName("«Отзвук»"),
    );
  });
});

// `shareSize` holds a QUANTITY on a share row and a JOB TITLE on a role row.
// Declarants type the title in whatever case they please, so one company's
// list mixed "ЧЛЕН НА УПРАВИТЕЛЕН ОРГАН" with "член на Изпълнителния съвет" —
// which, in a column rendered monospace for the quantities, read as two
// different fonts. 159 distinct labels across the corpus were 128 offices.
describe("roleLabel — the declared office", () => {
  const role = (shareSize: string) =>
    roleLabel({ stakeKind: "role", shareSize } as MpOwnershipStake);

  it("de-shouts an all-caps office", () => {
    expect(role("ЧЛЕН НА УПРАВИТЕЛЕН СЪВЕТ")).toBe("Член на управителен съвет");
  });

  it("keeps УС and СД upright — a plain lowercase would not", () => {
    expect(role("ПРЕДСЕДАТЕЛ НА УС")).toBe("Председател на УС");
    expect(role("ЧЛЕН НА СД")).toBe("Член на СД");
  });

  it("capitalises an office the declarant started lower-case", () => {
    expect(role("член на Изпълнителния съвет")).toBe(
      "Член на Изпълнителния съвет",
    );
  });

  // A quantity is not prose. Passing "40лв." through a name normaliser would
  // be harmless today and is exactly the kind of thing that stops being so.
  it("leaves a shareholding's quantity verbatim", () => {
    const share = (shareSize: string) =>
      roleLabel({ stakeKind: "share", shareSize } as MpOwnershipStake);
    expect(share("40лв.")).toBe("40лв.");
    expect(share("100%")).toBe("100%");
  });

  it("passes a null through untouched", () => {
    expect(
      roleLabel({ stakeKind: "role", shareSize: null } as MpOwnershipStake),
    ).toBe(null);
  });
});
