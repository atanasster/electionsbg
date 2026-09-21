import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { useUrlStoryBrowse } from "./useUrlStoryBrowse";

const wrapperAt = (entry: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    // The reader arrived from the home page, so Back has somewhere to go.
    return (
      <MemoryRouter initialEntries={["/", entry]} initialIndex={1}>
        {children}
      </MemoryRouter>
    );
  };

const renderAt = (entry: string) =>
  renderHook(
    () => ({
      browse: useUrlStoryBrowse(["economy", "elections"], ["a.bg"]),
      location: useLocation(),
      navigate: useNavigate(),
    }),
    { wrapper: wrapperAt(entry) },
  );

describe("useUrlStoryBrowse", () => {
  it("keys per-view state on the CANONICAL browse, not on the raw params", () => {
    // `utm_source` is not part of the browse; an unknown category reads as
    // „all" and gets the bare route's key; the default sort spelled out is
    // still the default.
    expect(
      renderAt("/stories?utm_source=x&category=economy").result.current.browse
        .search,
    ).toBe("?category=economy");
    expect(
      renderAt("/stories?category=nope&sort=ranked").result.current.browse
        .search,
    ).toBe("");
  });

  it("REPLACES the history entry on an edit, so Back does not walk keystrokes", () => {
    const hook = renderAt("/stories");
    act(() => hook.result.current.browse.setQuery("а"));
    act(() => hook.result.current.browse.setQuery("аб"));
    expect(hook.result.current.browse.query).toBe("аб");
    // ⚠️ THE MUTATION THIS CATCHES: a push per edit. Back would then land on
    // „а" rather than on the page the reader came from.
    act(() => hook.result.current.navigate(-1));
    expect(hook.result.current.location.pathname).toBe("/");
    expect(hook.result.current.location.search).toBe("");
  });

  it("omits defaults on write and keeps unrelated params on clear", () => {
    const hook = renderAt("/stories?utm_source=x&category=economy&days=1");
    act(() => hook.result.current.browse.setDays(7));
    expect(hook.result.current.location.search).toBe(
      "?utm_source=x&category=economy",
    );
    act(() => hook.result.current.browse.setSort("latest"));
    expect(hook.result.current.browse.sort).toBe("latest");
    act(() => hook.result.current.browse.setSort("ranked"));
    expect(hook.result.current.location.search).not.toContain("sort=");
    act(() => hook.result.current.browse.clearFilters());
    expect(hook.result.current.location.search).toBe("?utm_source=x");
  });
});
