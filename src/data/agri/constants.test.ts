// agriScopeToKey maps the SHARED `?pscope` param onto an agri_payloads key, and
// the two vocabularies do not line up: the procurement pages' picker offers
// every calendar year since SCOPE_FIRST_YEAR (2011), while the ДФЗ corpus covers
// only the CAP financial years in AGRI_FINANCIAL_YEARS. useScopedHref forwards
// the whole query string, so /subsidies is entered on the years in between.
//
// It used to build a key for those years anyway. The route answered 200 with a
// null body, React Query recorded a SUCCESS with undefined data, and the page
// sat on its loading skeleton forever — no data, no empty state, no error. The
// contract that prevents it: an unsupported year resolves to `null`, which the
// caller must render as "no data" rather than fetch.

import { describe, test, expect } from "vitest";
import {
  AGRI_FINANCIAL_YEARS,
  agriScopeToKey,
  agriScopeToYear,
  isAgriFinancialYear,
} from "./constants";
import { SCOPE_FIRST_YEAR } from "@/data/scope/constants";

describe("agriScopeToKey", () => {
  test("ns (the default) resolves to the latest-year singleton", () => {
    expect(agriScopeToKey("ns")).toBe("");
  });

  test("all resolves to the all-years aggregate", () => {
    expect(agriScopeToKey("all")).toBe("all");
  });

  test("every covered financial year resolves to its own key", () => {
    for (const year of AGRI_FINANCIAL_YEARS) {
      expect(agriScopeToKey(`y:${year}`)).toBe(String(year));
    }
  });

  // The regression itself: every year the SHARED picker can hand this page but
  // the corpus has no payload for must resolve to null, not to a doomed key.
  test("a year outside the CAP corpus resolves to null", () => {
    const shared = Array.from(
      { length: new Date().getFullYear() - SCOPE_FIRST_YEAR + 1 },
      (_, i) => SCOPE_FIRST_YEAR + i,
    );
    const uncovered = shared.filter((y) => !isAgriFinancialYear(y));
    // Guard the guard: if this ever empties, the test above is doing the work.
    expect(uncovered.length).toBeGreaterThan(0);
    for (const year of uncovered) {
      expect(agriScopeToKey(`y:${year}`)).toBeNull();
    }
  });

  test("junk in the param does not become a key", () => {
    for (const raw of ["y:", "y:abc", "y:20241", "y:2024x", "y: 2024"]) {
      expect(agriScopeToKey(raw)).toBeNull();
    }
  });
});

// agriScopeToYear feeds a server-side table FILTER, not a payload lookup: an
// uncovered year there yields an honest empty table, so it stays permissive.
describe("agriScopeToYear", () => {
  test("ns is the latest covered year, all is unfiltered", () => {
    expect(agriScopeToYear("ns")).toBe(AGRI_FINANCIAL_YEARS[0]);
    expect(agriScopeToYear("all")).toBeNull();
  });

  test("a year scope filters on that year", () => {
    expect(agriScopeToYear("y:2022")).toBe(2022);
  });
});
