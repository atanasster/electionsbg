// URL-backed state for the news home filters. This follows the main site's
// filter contract: the URL is the source of truth, default values are omitted,
// unrelated query params survive, and filter edits replace the current history
// entry so typing a search does not make the Back button walk every keystroke.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { HOME_TIMEFRAMES } from "./homeFilters";

export const HOME_DEFAULT_CATEGORY = "all";
export const HOME_DEFAULT_DAYS = 30;
export const HOME_QUERY_MAX = 200;
export const HOME_FILTER_PARAMS = ["category", "days", "q"] as const;

const VALID_DAYS = new Set<number>(HOME_TIMEFRAMES.map(({ days }) => days));

export interface UrlHomeFilters {
  category: string;
  days: number;
  query: string;
  setCategory: (value: string) => void;
  setDays: (value: number) => void;
  setQuery: (value: string) => void;
  clearFilters: () => void;
}

export const useUrlHomeFilters = (
  categoryIds: readonly string[] | null,
): UrlHomeFilters => {
  const [params, setParams] = useSearchParams();

  const categorySet = useMemo(
    () => (categoryIds ? new Set(categoryIds) : null),
    [categoryIds],
  );
  const rawCategory = params.get("category");
  // Before taxonomy arrives, retaining the raw value avoids a flash of the
  // unfiltered feed. Once it is known, an unknown category is harmlessly read
  // as the default rather than producing a permanently empty shared page.
  const category =
    rawCategory && (!categorySet || categorySet.has(rawCategory))
      ? rawCategory
      : HOME_DEFAULT_CATEGORY;

  const rawDays = Number(params.get("days"));
  const days = VALID_DAYS.has(rawDays) ? rawDays : HOME_DEFAULT_DAYS;
  // URL input is untrusted too: cap it on read as well as on write. Do not trim
  // it, because the input should round-trip exactly while the matcher already
  // normalises whitespace.
  const query = (params.get("q") ?? "").slice(0, HOME_QUERY_MAX);

  const write = useCallback(
    (key: (typeof HOME_FILTER_PARAMS)[number], value: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value == null || value === "") next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setCategory = useCallback(
    (value: string) =>
      write("category", value === HOME_DEFAULT_CATEGORY ? null : value),
    [write],
  );
  const setDays = useCallback(
    (value: number) =>
      write("days", value === HOME_DEFAULT_DAYS ? null : String(value)),
    [write],
  );
  const setQuery = useCallback(
    (value: string) => write("q", value.slice(0, HOME_QUERY_MAX) || null),
    [write],
  );
  const clearFilters = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of HOME_FILTER_PARAMS) next.delete(key);
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  return {
    category,
    days,
    query,
    setCategory,
    setDays,
    setQuery,
    clearFilters,
  };
};
