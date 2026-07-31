// `?pscope` is now carried across sections by ordinary links (it is in the
// usePreserveParams allowlist), so scopes minted where they are valid arrive on
// pages that cannot serve them. resolveScope is the one place that decides what
// such a scope means; both the page's aggregation and its <ScopeControl> read
// it, which is the only reason the two can be trusted to agree.

import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { createElement, type ReactNode } from "react";
import {
  defaultScopeYears,
  resolveScope,
  SCOPE_FIRST_YEAR,
  useScope,
  type Scope,
} from "./useScope";

const at = (url: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(MemoryRouter, { initialEntries: [url] }, children);
  };

// The two real coverage sets that differ from the corpus: the НФЦ film register
// (/culture, a contiguous span starting in 2014) and the CAP financial years
// (/subsidies, which SKIPS 2014/2018/2019/2020).
const CULTURE_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014]; // prettier-ignore
const AGRI_YEARS = [2025, 2024, 2023, 2022, 2021, 2017, 2016, 2015];

describe("defaultScopeYears", () => {
  it("spans the corpus floor through the given year, newest first", () => {
    expect(defaultScopeYears(2026)[0]).toBe(2026);
    expect(defaultScopeYears(2026).at(-1)).toBe(SCOPE_FIRST_YEAR);
    expect(defaultScopeYears(2026)).toHaveLength(2026 - SCOPE_FIRST_YEAR + 1);
  });
});

describe("resolveScope", () => {
  it("keeps a scope the caller covers", () => {
    expect(resolveScope("ns")).toBe("ns");
    expect(resolveScope("all")).toBe("all");
    expect(resolveScope("y:2019")).toBe("y:2019");
    expect(resolveScope("y:2024", { years: CULTURE_YEARS })).toBe("y:2024");
    expect(resolveScope("y:2017", { years: AGRI_YEARS })).toBe("y:2017");
  });

  it("falls back to ns for a year outside the caller's coverage", () => {
    // /culture: the film register ends before the procurement picker does, so a
    // scope picked on /procurement lands here as a year that has no films.
    expect(resolveScope("y:2026", { years: CULTURE_YEARS })).toBe("ns");
    // /subsidies-shaped sparse coverage: 2019 is a perfectly good procurement
    // year and a hole in the CAP corpus.
    expect(resolveScope("y:2019", { years: AGRI_YEARS })).toBe("ns");
  });

  it("falls back to ns for a year outside the corpus even with no support given", () => {
    // Hand-typed or stale links. The default set matches the precomputed
    // per-scope windows exactly, so anything outside it has no rows anywhere.
    expect(resolveScope("y:2099")).toBe("ns");
    expect(resolveScope(`y:${SCOPE_FIRST_YEAR - 1}` as Scope)).toBe("ns");
  });

  it("falls back to ns for 'all' only when the caller has no full-corpus view", () => {
    expect(resolveScope("all", { allowAll: false })).toBe("ns");
    expect(resolveScope("all", { allowAll: true })).toBe("all");
    expect(resolveScope("all", { years: CULTURE_YEARS })).toBe("all");
  });

  it("treats an empty coverage list as covering nothing", () => {
    // A page whose years come from data still renders while that data loads;
    // reporting ns then keeps the control in step with the skeleton beneath it.
    expect(resolveScope("y:2024", { years: [] })).toBe("ns");
  });
});

describe("useScope", () => {
  it("reads the URL param and resolves it against the caller's coverage", () => {
    const { result } = renderHook(
      () => useScope({ years: CULTURE_YEARS, allowAll: false }),
      { wrapper: at("/culture?pscope=y:2026") },
    );
    expect(result.current.scope).toBe("ns");
  });

  it("leaves the same URL param alone for a caller that covers it", () => {
    const { result } = renderHook(() => useScope(), {
      wrapper: at("/procurement?pscope=y:2026"),
    });
    expect(result.current.scope).toBe("y:2026");
  });

  it("resolves 'all' away for a caller with no full-corpus view", () => {
    const { result } = renderHook(() => useScope({ allowAll: false }), {
      wrapper: at("/culture?pscope=all"),
    });
    expect(result.current.scope).toBe("ns");
  });

  it("writes a chosen scope to the URL and drops the default again", () => {
    const { result } = renderHook(
      () => ({ ...useScope(), search: useLocation().search }),
      { wrapper: at("/procurement") },
    );
    act(() => result.current.setScope("y:2024"));
    expect(result.current.search).toBe("?pscope=y%3A2024");
    act(() => result.current.setScope("ns"));
    expect(result.current.search).toBe("");
  });
});
