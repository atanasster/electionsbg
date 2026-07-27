// Fetch-free unit test for the shared URL-backed procurement-filter hook. Drives
// the hook through a real MemoryRouter (no network — vitest.setup.ts makes an
// unstubbed fetch throw) and asserts the query-string round-trip: untrusted ?proc
// validation, the FILTER_ALL → delete-param normalisation, the boolean toggle, the
// company-only ?year dimension, hasActiveFilters, and that clearFilters preserves
// every unmanaged param (?topic/?sector/?q/?pscope). See docs/testing-standards.md.

import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import {
  FILTER_ALL,
  useUrlProcurementFilters,
  type UseUrlProcurementFiltersOptions,
} from "./useUrlProcurementFilters";

// Render the hook plus a location probe so a test can read the resulting URL.
const setup = (url: string, opts: UseUrlProcurementFiltersOptions) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => ({
      f: useUrlProcurementFilters(opts),
      search: useLocation().search,
    }),
    { wrapper },
  );
};

// Parse the current URL's query string into a param map for assertions.
const q = (search: string) => new URLSearchParams(search);

describe("useUrlProcurementFilters — read", () => {
  it("reads a valid ?proc bucket, ?cpv and the boolean toggle", () => {
    const { result } = setup(
      "/procurement/contracts?proc=open&cpv=45&single=1",
      {
        toggleParam: "single",
      },
    );
    expect(result.current.f.procBucket).toBe("open");
    expect(result.current.f.cpvSel).toBe("45");
    expect(result.current.f.toggle).toBe(true);
    expect(result.current.f.hasActiveFilters).toBe(true);
  });

  it("coerces a garbage ?proc value to null (untrusted URL input)", () => {
    const { result } = setup("/procurement/contracts?proc=garbage", {
      toggleParam: "single",
    });
    expect(result.current.f.procBucket).toBeNull();
    expect(result.current.f.hasActiveFilters).toBe(false);
  });

  it("defaults ?cpv to FILTER_ALL when absent, and toggle to false", () => {
    const { result } = setup("/procurement/tenders", {
      toggleParam: "cancelled",
    });
    expect(result.current.f.cpvSel).toBe(FILTER_ALL);
    expect(result.current.f.toggle).toBe(false);
    expect(result.current.f.hasActiveFilters).toBe(false);
  });

  it("reads the tenders ?cancelled toggle under its own param name", () => {
    const { result } = setup("/procurement/tenders?cancelled=1", {
      toggleParam: "cancelled",
    });
    expect(result.current.f.toggle).toBe(true);
    // The contracts-shaped ?single param must NOT be read here.
    expect(q(result.current.search).get("single")).toBeNull();
  });

  it("reads ?year only when withYear is set", () => {
    const withoutYear = setup("/company/123/contracts?year=2024", {
      toggleParam: "single",
    });
    expect(withoutYear.result.current.f.year).toBe(FILTER_ALL);
    expect(withoutYear.result.current.f.hasActiveFilters).toBe(false);

    const withYear = setup("/company/123/contracts?year=2024", {
      toggleParam: "single",
      withYear: true,
    });
    expect(withYear.result.current.f.year).toBe("2024");
    expect(withYear.result.current.f.hasActiveFilters).toBe(true);
  });
});

describe("useUrlProcurementFilters — write", () => {
  it("setCpvSel(FILTER_ALL) deletes ?cpv; a real value sets it", () => {
    const { result } = setup("/procurement/contracts?cpv=45", {
      toggleParam: "single",
    });
    act(() => result.current.f.setCpvSel(FILTER_ALL));
    expect(q(result.current.search).has("cpv")).toBe(false);

    act(() => result.current.f.setCpvSel("72,48"));
    expect(q(result.current.search).get("cpv")).toBe("72,48");
  });

  it("setToggle writes '1' / clears under the configured param name", () => {
    const { result } = setup("/procurement/tenders", {
      toggleParam: "cancelled",
    });
    act(() => result.current.f.setToggle(true));
    expect(q(result.current.search).get("cancelled")).toBe("1");
    act(() => result.current.f.setToggle(false));
    expect(q(result.current.search).has("cancelled")).toBe(false);
  });

  it("setProcBucket writes a valid bucket to ?proc, and null clears it", () => {
    const { result } = setup("/procurement/contracts", {
      toggleParam: "single",
    });
    act(() => result.current.f.setProcBucket("open"));
    expect(q(result.current.search).get("proc")).toBe("open");
    act(() => result.current.f.setProcBucket(null));
    expect(q(result.current.search).has("proc")).toBe(false);
  });

  it("setYear writes ?year and FILTER_ALL clears it (withYear)", () => {
    const { result } = setup("/company/1/contracts", {
      toggleParam: "single",
      withYear: true,
    });
    act(() => result.current.f.setYear("2024"));
    expect(q(result.current.search).get("year")).toBe("2024");
    act(() => result.current.f.setYear(FILTER_ALL));
    expect(q(result.current.search).has("year")).toBe(false);
  });

  it("setYear is a no-op when withYear is false (never strands ?year)", () => {
    const { result } = setup("/procurement/contracts", {
      toggleParam: "single",
    });
    act(() => result.current.f.setYear("2024"));
    expect(q(result.current.search).has("year")).toBe(false);
  });
});

describe("useUrlProcurementFilters — clearFilters", () => {
  it("clears every managed param but preserves ?topic/?sector/?q/?pscope", () => {
    const { result } = setup(
      "/procurement/tenders?proc=open&cpv=45&cancelled=1&topic=guardrails&sector=roads&q=мост&pscope=all",
      { toggleParam: "cancelled" },
    );
    act(() => result.current.f.clearFilters());
    const p = q(result.current.search);
    expect(p.has("proc")).toBe(false);
    expect(p.has("cpv")).toBe(false);
    expect(p.has("cancelled")).toBe(false);
    // Unmanaged params survive.
    expect(p.get("topic")).toBe("guardrails");
    expect(p.get("sector")).toBe("roads");
    expect(p.get("q")).toBe("мост");
    expect(p.get("pscope")).toBe("all");
  });

  it("also clears ?year when withYear is set", () => {
    const { result } = setup(
      "/company/123/contracts?year=2024&proc=open&cpv=45&single=1&q=пътища",
      { toggleParam: "single", withYear: true },
    );
    act(() => result.current.f.clearFilters());
    const p = q(result.current.search);
    expect(p.has("year")).toBe(false);
    expect(p.has("proc")).toBe(false);
    expect(p.has("cpv")).toBe(false);
    expect(p.has("single")).toBe(false);
    expect(p.get("q")).toBe("пътища");
  });
});
