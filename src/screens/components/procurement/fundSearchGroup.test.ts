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

  it("routes each row to its beneficiary", () => {
    const g = fundSearchGroup([row()], true);
    expect(g?.items[0].to).toBe("/company/123456789");
  });

  it("returns null rather than an empty header", () => {
    expect(fundSearchGroup([row({ beneficiaryEik: null })], true)).toBe(null);
    expect(fundSearchGroup([], true)).toBe(null);
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
