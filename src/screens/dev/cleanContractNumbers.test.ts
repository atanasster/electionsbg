// The one thing this derivation must get right is the distinction between „the
// register named nothing" and „the register was not consulted" — see the module's
// header. Both render zero badges, so no visual check can tell them apart; only the
// caveat's gate can, and it reads `size`.

import { describe, expect, it } from "vitest";
import { cleanContractNumbersOf } from "./cleanContractNumbers";
import type { CleanContractRow } from "../components/procurement/CompanyCleanDeliveryTile";

const row = (contract_number: string): CleanContractRow => ({
  contract_number,
  title: null,
  programme: null,
  procedure: null,
  signed_on: null,
  original_end_on: null,
  closed_on: null,
  duration_months: null,
});

describe("cleanContractNumbersOf", () => {
  it("collects every contract_number the register names", () => {
    const set = cleanContractNumbersOf({
      contracts: [row("BG-RRP-3.008-0282"), row("BG16RFOP002-2.077-0541")],
    });
    expect(set?.has("BG-RRP-3.008-0282")).toBe(true);
    expect(set?.has("BG16RFOP002-2.077-0541")).toBe(true);
    expect(set?.has("BG16RFOP002-2.001-0450")).toBe(false);
  });

  it("returns undefined — NOT an empty Set — for a payload that names nothing", () => {
    // ⚠️ The distinction the module exists for. An empty Set marks nothing and
    // claims the register was consulted, which turns every unmarked row into
    // negative space. `new Set(rows ?? [])` is the simplification that breaks it.
    expect(cleanContractNumbersOf({ contracts: [] })).toBeUndefined();
    expect(cleanContractNumbersOf({ contracts: null })).toBeUndefined();
    expect(cleanContractNumbersOf({})).toBeUndefined();
  });

  it("returns undefined for an absent payload", () => {
    // The company is in neither ИСУН register — 175 returns no row at all.
    expect(cleanContractNumbersOf(null)).toBeUndefined();
    expect(cleanContractNumbersOf(undefined)).toBeUndefined();
  });

  it("de-duplicates, because contract_number is not unique by schema", () => {
    // `contract_number` is `reg_no` with the -C## contract-VERSION suffix stripped
    // and the PK is `reg_no`, so two versions of one contract share this key.
    const set = cleanContractNumbersOf({
      contracts: [row("BG-RRP-3.008-0282"), row("BG-RRP-3.008-0282")],
    });
    expect(set?.size).toBe(1);
  });
});
