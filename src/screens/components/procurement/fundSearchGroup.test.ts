// The two EU-money dropdown groups — ЕВРОФОНДОВЕ (ИСУН) and Interreg.
//
// ⚠️ AN ИСУН ROW ROUTES TO THE PROJECT'S OWN PAGE AND NO ROW IS DROPPED. It used to route to
// `/company/:beneficiaryEik` and filter out any project the corpus cannot key to a
// beneficiary — so a reader searching for a project landed on a company page, and real
// projects the search HAD found were silently absent, which a reader cannot tell from "no
// such project". `contract_number` is non-empty on all 82,283 `fund_projects` rows, so
// `/funds/contract/:number` always exists. See docs/plans/home-search-expansion-v1.md §2.4.
//
// Interreg is its OWN group. The two corpora share no key — `fund_projects` holds zero
// Interreg operations because Interreg runs on Jems, and an operation's `operationId` is NULL
// for every 2014-2020 row — so folding them would force a NULL key on one side. Its money is
// the BULGARIAN partners' share, never the cross-border total.

import { describe, it, expect } from "vitest";
import {
  fundSearchGroup,
  interregSearchGroup,
  type FundRow,
  type InterregRow,
} from "./fundSearchGroup";

// The ИСУН group drops rows with no beneficiaryEik because each row routes to
// /company/:eik — a row without one has nowhere to go, and a group header with
// no items is worse than no group.
describe("fundSearchGroup", () => {
  const row = (over: Partial<FundRow> = {}): FundRow => ({
    contractNumber: "BG16RFOP002-2.089-3686-C01",
    title: "Проект",
    beneficiaryEik: "123456789",
    beneficiaryName: "Фирма",
    programName: "ОПИК",
    totalEur: 1000,
    ...over,
  });

  it("routes each row to its OWN project page, not to its beneficiary", () => {
    // A reader searching for a project wants the project. The older builder sent every hit
    // to `/company/:beneficiaryEik`, which answers a different question and loses the row's
    // own grant, dates and programme.
    const g = fundSearchGroup([row()], true);
    expect(g?.items[0].to).toBe(
      `/funds/contract/${encodeURIComponent("BG16RFOP002-2.089-3686-C01")}`,
    );
  });

  it("encodes the contract number, which carries dots and dashes", () => {
    const g = fundSearchGroup([row({ contractNumber: "BG16 RFOP/2.0" })], true);
    expect(g?.items[0].to).toBe(
      `/funds/contract/${encodeURIComponent("BG16 RFOP/2.0")}`,
    );
    expect(g?.items[0].to).not.toContain("RFOP/2.0");
  });

  it("KEEPS a project whose beneficiary EIK the corpus cannot key", () => {
    // The older builder filtered these out, so a real project the search had found was
    // silently absent from the result — an absence indistinguishable from "no such project".
    // `contract_number` is present on every row, so the project page always exists.
    const g = fundSearchGroup([row({ beneficiaryEik: null })], true);
    expect(g?.items).toHaveLength(1);
    expect(g?.items[0].to).toContain("/funds/contract/");
  });

  it("returns null only when there are no rows at all", () => {
    expect(fundSearchGroup([], true)).toBe(null);
  });

  it("labels the group in the reader's language", () => {
    expect(fundSearchGroup([row()], true)?.label).toBe("Еврофондове (ИСУН)");
    expect(fundSearchGroup([row()], false)?.label).toBe("EU funds (ISUN)");
  });

  it("keeps input order and namespaces every id", () => {
    // The id namespace is load-bearing in `EntitySearchTile`, which — unlike `HubSearch` —
    // does NOT re-namespace per group: two groups emitting the same id would mark both
    // aria-selected while arrow keys land on one.
    const g = fundSearchGroup(
      [row({ contractNumber: "BG-1" }), row({ contractNumber: "BG-2" })],
      true,
    );
    expect(g?.items.map((i) => i.id)).toEqual(["fund-BG-1", "fund-BG-2"]);
  });
});

// Interreg is its OWN group. The two corpora share no key — fund_projects holds
// zero Interreg operations because Interreg runs on Jems, and an operation's
// operationId is NULL for every 2014-2020 row — so folding them would force a
// NULL key on one side.
describe("interregSearchGroup", () => {
  const row = (over: Partial<InterregRow> = {}): InterregRow => ({
    keepId: 33607,
    title: "Cross-Border Cooperation for Promoting Bio-diversity",
    programmeBg: "Черноморски басейн",
    period: "2014-2020",
    bgBudgetEur: 357183.12,
    partnerHit: "Община Малко Търново",
    ...over,
  });

  it("routes to the operation page, not to a company", () => {
    // There is no single beneficiary: the money is the Bulgarian partners'
    // combined share of a cross-border project.
    const g = interregSearchGroup([row()], true);
    expect(g?.key).toBe("interreg");
    expect(g?.items[0].to).toBe("/funds/interreg/33607");
  });

  // THE invariant. bgBudgetEur is the Bulgarian share; the operation total
  // (€1,419,207.76 here) includes the foreign partners and would overstate the
  // Bulgarian side fourfold on this very row.
  it("shows the Bulgarian share, never the operation total", () => {
    const g = interregSearchGroup([row()], true);
    expect(g?.items[0].amountEur).toBe(357183.12);
  });

  it("surfaces the matched partner name so a Cyrillic hit is explicable", () => {
    // The title is English — keep.eu publishes no Bulgarian one — so without
    // the partner name a Cyrillic search returns rows with no visible reason.
    const g = interregSearchGroup([row()], true);
    expect(g?.items[0].secondary).toContain("Община Малко Търново");
    const noHit = interregSearchGroup([row({ partnerHit: null })], true);
    expect(noHit?.items[0].secondary).not.toContain("null");
  });

  it("returns null rather than an empty header", () => {
    expect(interregSearchGroup([], true)).toBe(null);
    // The route degrades a database without 138 to no key at all, so the tile
    // can hand this `undefined`.
    expect(
      interregSearchGroup(undefined as unknown as InterregRow[], true),
    ).toBe(null);
  });

  it("decodes HTML entities in both lines", () => {
    // keep.eu titles carry &amp; and &#39; verbatim; rendered raw they read as
    // markup in a dropdown.
    const g = interregSearchGroup(
      [row({ title: "Trade &amp; Tourism", partnerHit: "Иван&#39;s" })],
      true,
    );
    expect(g?.items[0].primary).toBe("Trade & Tourism");
    expect(g?.items[0].secondary).toContain("Иван's");
  });

  it("omits a missing programme rather than printing a gap", () => {
    // programmeBg is nullable — the route aliases programme_bg and 138 LEFT
    // JOINs the catalogue — so the join must not leave a dangling separator.
    const g = interregSearchGroup([row({ programmeBg: null })], true);
    expect(g?.items[0].secondary).toBe("2014-2020 · Община Малко Търново");
    const bare = interregSearchGroup(
      [row({ programmeBg: null, partnerHit: null })],
      true,
    );
    expect(bare?.items[0].secondary).toBe("2014-2020");
  });

  it("keeps a row whose budget is unpublished", () => {
    // 21 of 1,493 partner rows carry no published budget. They are real
    // projects and must remain findable; only the amount is absent.
    const g = interregSearchGroup([row({ bgBudgetEur: null })], true);
    expect(g?.items).toHaveLength(1);
    expect(g?.items[0].amountEur).toBe(null);
  });
});
