// The contract-key guard in `useContract`.
//
// WHY THIS FILE EXISTS. `enabled` is a cheap filter against firing a request for a garbage
// route param, and it was `/^[0-9a-f]{12}$/` — which rejects the SYNTHETIC CONSORTIUM CARRIER
// keys migration 087 mints as `'obed-' || left(md5(…), 12)`. Those are not an edge case: they
// are the rows that hold a joint award's WHOLE value and its entire annex trail, and the
// corpus holds 2,699 of them against 409,014 bare keys (measured 2026-09-21).
//
// The failure was silent and total. `enabled: false` means no request is made at all, so
// `data` stays undefined, `isLoading` is false, and `/procurement/contract/obed-…` renders
// „Договорът не е намерен" — for EVERY carrier contract in the corpus, on a page whose API
// resolves them perfectly well. It also killed `CompanyTopContractsTile`'s links on any
// consortium entity's own page, since those are built from the same keys.
//
// A regex is not something review reliably catches, and no test covered it, so the shape is
// pinned here against both real forms and against the junk the guard exists to stop.

import { describe, it, expect } from "vitest";
import { CONTRACT_KEY_RE } from "./useContract";

describe("CONTRACT_KEY_RE", () => {
  it("accepts a bare 12-hex key (409,014 of the corpus)", () => {
    expect(CONTRACT_KEY_RE.test("ae8d824eb32c")).toBe(true);
    expect(CONTRACT_KEY_RE.test("b841cf5ee2e2")).toBe(true);
  });

  it("accepts a synthetic consortium CARRIER key (2,699 of the corpus)", () => {
    // The two carriers on the АПИ guardrail framework, УНП 00044-2022-0028. Before this
    // guard admitted them, both of МЛГ ЕООД's joint contracts were unreachable.
    expect(CONTRACT_KEY_RE.test("obed-abf3a70ed9bb")).toBe(true);
    expect(CONTRACT_KEY_RE.test("obed-e577e14118e1")).toBe(true);
  });

  it("still rejects what it exists to reject", () => {
    for (const junk of [
      "", // no param
      "not-a-key",
      "ae8d824eb32", // 11 hex — a truncated paste
      "ae8d824eb32cd", // 13 hex
      "AE8D824EB32C", // md5 output is lower-case; upper would be a different key
      "obed-", // the prefix alone
      "obed-abf3a70ed9b", // 11 hex after the prefix
      "obed-obed-abf3a70ed9bb", // doubled prefix
      "ph-1234567890ab", // a SUPPLIER-identity namespace, never a contract key
      "np-1234567890ab",
      "113581389", // an EIK
      "' OR 1=1 --",
    ]) {
      expect(
        CONTRACT_KEY_RE.test(junk),
        `should reject ${JSON.stringify(junk)}`,
      ).toBe(false);
    }
  });

  it("is anchored at both ends", () => {
    // Without anchors a key embedded in a longer string would pass, and the param goes
    // straight into a query string.
    expect(CONTRACT_KEY_RE.test("xae8d824eb32c")).toBe(false);
    expect(CONTRACT_KEY_RE.test("ae8d824eb32cx")).toBe(false);
    expect(CONTRACT_KEY_RE.test("ae8d824eb32c\nobed-abf3a70ed9bb")).toBe(false);
  });
});
