import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  HOME_DEFAULT_CATEGORY,
  HOME_FALLBACK_DAYS,
  HOME_QUERY_MAX,
  useUrlHomeFilters,
} from "./useUrlHomeFilters";

const CATEGORIES = ["procurement", "society"];

const setup = (
  url: string,
  categories: readonly string[] | null = CATEGORIES,
  defaultDays = HOME_FALLBACK_DAYS,
) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => ({
      filters: useUrlHomeFilters(categories, defaultDays),
      search: useLocation().search,
    }),
    { wrapper },
  );
};

const params = (search: string) => new URLSearchParams(search);

describe("useUrlHomeFilters", () => {
  it("restores category, timeframe and exact search text from a shared URL", () => {
    const { result } = setup(
      "/?category=procurement&days=7&q=%D0%BC%D0%BE%D1%81%D1%82+",
    );
    expect(result.current.filters.category).toBe("procurement");
    expect(result.current.filters.days).toBe(7);
    expect(result.current.filters.query).toBe("мост ");
  });

  it("falls back safely for unknown categories and unsupported timeframes", () => {
    const { result } = setup("/?category=made-up&days=365");
    expect(result.current.filters.category).toBe(HOME_DEFAULT_CATEGORY);
    expect(result.current.filters.days).toBe(HOME_FALLBACK_DAYS);
    expect(result.current.filters.daysExplicit).toBe(false);
  });

  it("retains an inbound category while taxonomy is still loading", () => {
    const { result } = setup("/?category=procurement", null);
    expect(result.current.filters.category).toBe("procurement");
  });

  it("writes filters, omits defaults, and preserves unrelated parameters", () => {
    const { result } = setup("/?ref=share");

    act(() => result.current.filters.setCategory("procurement"));
    expect(params(result.current.search).get("category")).toBe("procurement");
    expect(params(result.current.search).get("ref")).toBe("share");

    act(() => result.current.filters.setDays(7));
    expect(params(result.current.search).get("days")).toBe("7");
    act(() => result.current.filters.setDays(HOME_FALLBACK_DAYS));
    expect(params(result.current.search).has("days")).toBe(false);

    act(() => result.current.filters.setCategory(HOME_DEFAULT_CATEGORY));
    expect(params(result.current.search).has("category")).toBe(false);
  });

  it("uses the adaptive default without serializing it into the URL", () => {
    const { result } = setup("/", CATEGORIES, 1);
    expect(result.current.filters.days).toBe(1);
    expect(result.current.filters.daysExplicit).toBe(false);

    act(() => result.current.filters.setDays(7));
    expect(params(result.current.search).get("days")).toBe("7");
    expect(result.current.filters.daysExplicit).toBe(true);

    act(() => result.current.filters.setDays(1));
    expect(params(result.current.search).has("days")).toBe(false);
  });

  it("round-trips search input, caps it, and clears every owned parameter", () => {
    const { result } = setup("/?category=society&days=1&q=test&ref=share");
    act(() => result.current.filters.setQuery("търсене "));
    expect(params(result.current.search).get("q")).toBe("търсене ");

    act(() => result.current.filters.setQuery("x".repeat(HOME_QUERY_MAX + 10)));
    expect(params(result.current.search).get("q")).toHaveLength(HOME_QUERY_MAX);

    act(() => result.current.filters.clearFilters());
    const cleared = params(result.current.search);
    expect(cleared.has("category")).toBe(false);
    expect(cleared.has("days")).toBe(false);
    expect(cleared.has("q")).toBe(false);
    expect(cleared.get("ref")).toBe("share");
  });
});
