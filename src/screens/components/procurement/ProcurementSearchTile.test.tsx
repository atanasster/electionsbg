// Unit coverage for the ЕВРОФОНДОВЕ (ИСУН) dropdown group builder (§4.1). The
// group must link each fund project to its beneficiary's /company/:eik and must
// NOT render a stray empty header when no match carries a beneficiaryEik.

import { describe, it, expect } from "vitest";
import { fundSearchGroup } from "./fundSearchGroup";

const row = (over: Record<string, unknown> = {}) => ({
  contractNumber: "BG-1",
  title: "Саниране на блок 46",
  beneficiaryEik: "104055066",
  beneficiaryName: "Община X",
  programName: "Околна среда",
  totalEur: 1000,
  ...over,
});

describe("fundSearchGroup — the ЕВРОФОНДОВЕ dropdown group (§4.1)", () => {
  it("links a fund match to its beneficiary /company/:eik", () => {
    const g = fundSearchGroup([row()], true);
    expect(g?.label).toBe("Еврофондове (ИСУН)");
    expect(g?.items[0].to).toBe("/company/104055066");
    expect(g?.items[0].primary).toContain("Саниране");
    expect(g?.items[0].secondary).toContain("Околна среда");
  });

  it("uses the English label when not Bulgarian", () => {
    expect(fundSearchGroup([row()], false)?.label).toBe("EU funds (ISUN)");
  });

  it("returns null (no empty header) when no match has a beneficiaryEik", () => {
    expect(fundSearchGroup([row({ beneficiaryEik: null })], true)).toBeNull();
    expect(fundSearchGroup([], true)).toBeNull();
  });

  it("drops only the EIK-less rows, keeping the linkable ones", () => {
    const g = fundSearchGroup(
      [row({ beneficiaryEik: null }), row({ contractNumber: "BG-2" })],
      true,
    );
    expect(g?.items).toHaveLength(1);
    expect(g?.items[0].id).toBe("fund-BG-2");
  });
});
