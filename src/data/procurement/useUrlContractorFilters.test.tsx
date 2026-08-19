// Fetch-free unit test for the /procurement/contractors URL-filter hook. Drives it
// through a real MemoryRouter and pins the two load-bearing behaviors:
//   - toDivision: the client half of the double-count guard (fine CPV code → its
//     2-digit division; junk → 'ALL'), and that ?cpv is NORMALISED to division grain
//     on write so the URL never claims precision the rollup can't serve;
//   - extraFilters ALWAYS carries {id:'division'} (the guard) and keeps a stable
//     identity across re-renders (DbDataTable resets pagination on identity change);
//   - and that the hook reads NO `?sector` param — see the last describe block.

import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../../../scripts/lib/strip_comments";
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import {
  DIVISION_ALL,
  toDivision,
  useUrlContractorFilters,
} from "./useUrlContractorFilters";
import { CPV_ALL } from "@/screens/components/procurement/CpvFilterCombobox";

const setup = (url: string) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => ({ f: useUrlContractorFilters(), search: useLocation().search }),
    { wrapper },
  );
};
const q = (search: string) => new URLSearchParams(search);
const divisionOf = (filters: { id: string; value?: unknown }[]) =>
  filters.find((x) => x.id === "division")?.value;

describe("toDivision", () => {
  it("maps CPV_ALL → 'ALL'", () => {
    expect(toDivision(CPV_ALL)).toBe(DIVISION_ALL);
  });
  it("maps a 2-digit division to itself", () => {
    expect(toDivision("45")).toBe("45");
  });
  it("buckets a fine code to its division", () => {
    expect(toDivision("45230000")).toBe("45");
  });
  it("falls back to 'ALL' for a non-numeric-led value", () => {
    expect(toDivision("abc")).toBe(DIVISION_ALL);
    expect(toDivision("")).toBe(DIVISION_ALL);
  });
});

describe("useUrlContractorFilters — read", () => {
  it("reads ?cpv and ?mp; maps ?cpv to its division", () => {
    const { result } = setup("/procurement/contractors?cpv=45&mp=1");
    expect(result.current.f.cpvSel).toBe("45");
    expect(result.current.f.division).toBe("45");
    expect(result.current.f.mpTied).toBe(true);
    expect(result.current.f.hasActiveFilters).toBe(true);
  });

  it("defaults to CPV_ALL / division 'ALL' / mp false when absent", () => {
    const { result } = setup("/procurement/contractors");
    expect(result.current.f.cpvSel).toBe(CPV_ALL);
    expect(result.current.f.division).toBe(DIVISION_ALL);
    expect(result.current.f.mpTied).toBe(false);
    expect(result.current.f.hasActiveFilters).toBe(false);
  });

  it("always carries {id:'division'} in extraFilters (double-count guard)", () => {
    const { result } = setup("/procurement/contractors");
    expect(divisionOf(result.current.f.extraFilters)).toBe(DIVISION_ALL);

    const { result: filtered } = setup("/procurement/contractors?cpv=45&mp=1");
    expect(divisionOf(filtered.current.f.extraFilters)).toBe("45");
    expect(
      filtered.current.f.extraFilters.some((x) => x.id === "is_mp_tied"),
    ).toBe(true);
  });
});

describe("useUrlContractorFilters — write", () => {
  it("normalises a fine code to its division on write (honest URL)", () => {
    const { result } = setup("/procurement/contractors");
    act(() => result.current.f.setCpvSel("45230000"));
    expect(q(result.current.search).get("cpv")).toBe("45");
  });

  it("setCpvSel(CPV_ALL) clears ?cpv", () => {
    const { result } = setup("/procurement/contractors?cpv=45");
    act(() => result.current.f.setCpvSel(CPV_ALL));
    expect(q(result.current.search).has("cpv")).toBe(false);
  });

  it("setMpTied writes '1' / clears ?mp", () => {
    const { result } = setup("/procurement/contractors");
    act(() => result.current.f.setMpTied(true));
    expect(q(result.current.search).get("mp")).toBe("1");
    act(() => result.current.f.setMpTied(false));
    expect(q(result.current.search).has("mp")).toBe(false);
  });

  it("clearFilters removes ?cpv/?mp but preserves ?pscope/?q", () => {
    const { result } = setup(
      "/procurement/contractors?cpv=45&mp=1&pscope=all&q=софарма",
    );
    act(() => result.current.f.clearFilters());
    const p = q(result.current.search);
    expect(p.has("cpv")).toBe(false);
    expect(p.has("mp")).toBe(false);
    expect(p.get("pscope")).toBe("all");
    expect(p.get("q")).toBe("софарма");
  });
});

describe("useUrlContractorFilters — referential stability", () => {
  // extraFilters is spread into DbDataTable, which resets pagination on an
  // identity-keyed effect — a fresh array each render would pin the table to page 1.
  it("keeps the same extraFilters identity across re-renders", () => {
    const { result, rerender } = setup("/procurement/contractors?cpv=45");
    const first = result.current.f.extraFilters;
    rerender();
    expect(result.current.f.extraFilters).toBe(first);
  });

  it("keeps a stable identity for the default (no filters) case too", () => {
    const { result, rerender } = setup("/procurement/contractors");
    const first = result.current.f.extraFilters;
    rerender();
    expect(result.current.f.extraFilters).toBe(first);
  });
});

// The third behaviour, and the one most likely to be "fixed" by a well-meaning
// change: every OTHER procurement browser reads `?sector` (getSectorBrowsePack →
// awarder_eik / buyer_eik IN …), so its absence here reads as an oversight.
//
// It is not. The param is a predicate on the BUYER, and `contractor_rank`
// (migration 122) aggregates CONTRACTORS with no buyer dimension at all — its
// columns are (scope_key, eik, division, name, name_fold, total_eur,
// contract_count, award_count, total_other, is_mp_tied). A filter added here is
// either silently dropped — a link promising „culture's contractors" that serves
// the national list — or forces a third dimension onto a matview whose existing
// two already need the double-count guard the tests above pin.
//
// The sector-scoped question is answered at /culture/procurement#contractors,
// from awarder_group_model's complete per-contractor rollup. §1.3-B of
// docs/plans/culture-investigative-v1.md.
//
// The scan strips comments FIRST: the hook's own header now explains this at
// length, and prose that MENTIONS a pattern is not an occurrence of it — a naive
// scan would fail on the documentation that states the rule.
describe("useUrlContractorFilters — the param it must NOT grow", () => {
  const source = () =>
    stripComments(
      readFileSync(
        path.resolve(
          process.cwd(),
          "src/data/procurement/useUrlContractorFilters.ts",
        ),
        "utf8",
      ),
      { trailing: true },
    );

  it("reads no ?sector — contractor_rank has no buyer dimension", () => {
    expect(source()).not.toMatch(/\bsector\b/i);
  });

  it("still reads the params it does own, so the scan is not vacuous", () => {
    const body = source();
    for (const param of ["cpv", "mp"])
      expect(body).toMatch(new RegExp(`["'\`]${param}["'\`]`));
  });
});
