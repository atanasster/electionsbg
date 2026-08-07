// Grouping guard for companies-index.json. The bug it locks: a political
// party writes its legal form as a PREFIX ("Политическа партия «Движение ДА
// българия»" / "ПП Движение ДА българия"), and the normalizer only ever
// folded the trailing ООД/ЕАД family. Both spellings therefore minted their
// own index entry, each holding a different subset of the years — the ДА
// България filings split 2021 on one page and 2023 on the other, so both
// under-reported the party's declared board with nothing failing.

import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  normalizeCompanyName,
  roleLabel,
  looksLikeParty,
  enrichWithFinancing,
  type CompanyIndexEntry,
} from "./build_company_index";
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

// A political party carries no EIK in any registry we ingest — parties
// register with the Sofia City Court and draw their БУЛСТАТ elsewhere, while
// tr_companies is companies and ngos_list is ЮЛНЦ — so linking a party to its
// Court-of-Audit filing record can only be done by NAME. That makes this gate
// the whole safety story: a bare name match pairs the joint-stock company
// "Величие АД" with the party "Величие" and publishes a party's financing
// record on a private firm's page.
describe("looksLikeParty — is this entry a party at all?", () => {
  it("accepts either spelling of the party legal form", () => {
    expect(looksLikeParty(['Политическа партия "Движение ДА БЪЛГАРИЯ"'])).toBe(
      true,
    );
    expect(looksLikeParty(["ПП Възраждане"])).toBe(true);
    expect(
      looksLikeParty(["Коалиция Демократична България - Обединение"]),
    ).toBe(true);
  });

  it("a commercial legal form vetoes, even alongside a party spelling", () => {
    expect(looksLikeParty(["Величие АД"])).toBe(false);
    expect(looksLikeParty(["ВЕЛИЧИЕ АД"])).toBe(false);
    // The veto must win however the names are ordered across filings.
    expect(looksLikeParty(["ПП Величие", "Величие АД"])).toBe(false);
  });

  it("rejects a plain company and an entry with no declared name at all", () => {
    expect(looksLikeParty(["Отзвук ЕООД"])).toBe(false);
    expect(looksLikeParty(["Ние идваме"])).toBe(false);
    // TR-only entries carry no declared raw names; they are companies.
    expect(looksLikeParty([])).toBe(false);
  });
});

describe("enrichWithFinancing — the party↔gfopp link", () => {
  const withReports = (
    companies: CompanyIndexEntry[],
    parties: { name: string; slug: string }[],
  ) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fin-"));
    const p = path.join(dir, "reports.json");
    fs.writeFileSync(p, JSON.stringify({ years: [{ parties }] }));
    const n = enrichWithFinancing(companies, p);
    fs.rmSync(dir, { recursive: true, force: true });
    return n;
  };
  const entry = (over: Partial<CompanyIndexEntry>): CompanyIndexEntry => ({
    slug: "x",
    displayName: "x",
    registeredOffices: [],
    stakes: [],
    ...over,
  });

  it("links a party to its register entry across spelling differences", () => {
    const c = [
      entry({
        displayName: 'Политическа партия "Движение ДА българия"',
        isParty: true,
      }),
    ];
    expect(
      withReports(c, [
        { name: "Движение да българия", slug: "dvizhenie-da-balgariya" },
      ]),
    ).toBe(1);
    expect(c[0].financing?.slug).toBe("dvizhenie-da-balgariya");
  });

  // The defect the gate exists to prevent, end to end.
  it("never links a company that merely shares a party's name", () => {
    const c = [entry({ displayName: "Величие АД" })];
    expect(withReports(c, [{ name: "Величие", slug: "velichie" }])).toBe(0);
    expect(c[0].financing).toBeUndefined();
  });

  it("leaves a party the register does not carry unlinked", () => {
    // A coalition files nothing of its own; a pre-2011 party predates the
    // register. Both must render no panel rather than borrow someone's.
    const c = [
      entry({ displayName: "Коалиция Демократична България", isParty: true }),
    ];
    expect(withReports(c, [{ name: "Възраждане", slug: "vazrazhdane" }])).toBe(
      0,
    );
    expect(c[0].financing).toBeUndefined();
  });

  it("clears a stale link when the entry stops matching", () => {
    const c = [
      entry({
        displayName: "ПП Възраждане",
        isParty: true,
        financing: { slug: "gone", name: "Изчезнала" },
      }),
    ];
    expect(withReports(c, [])).toBe(0);
    expect(c[0].financing).toBeUndefined();
  });

  it("no-ops without reports.json so a fresh checkout still builds", () => {
    const c = [entry({ displayName: "ПП Възраждане", isParty: true })];
    expect(enrichWithFinancing(c, "/nonexistent/reports.json")).toBe(0);
    expect(c[0].financing).toBeUndefined();
  });
});
