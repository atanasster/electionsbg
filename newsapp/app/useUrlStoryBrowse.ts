// URL-backed state for the corpus browse (`/stories`). Same contract as the
// home filters: the URL is the source of truth, defaults are omitted,
// unrelated params survive, and edits REPLACE the history entry so typing a
// search does not make Back walk every keystroke.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { StorySort } from "./data";
import {
  BROWSE_DEFAULT_DAYS,
  BROWSE_DEFAULT_SORT,
  BROWSE_PARAMS,
  BROWSE_QUERY_MAX,
  browseSearch,
  parseBrowseFilters,
  type BrowseFilters,
  type BrowseParam,
} from "./storyBrowse";

export interface UrlStoryBrowse extends BrowseFilters {
  setCategory: (value: string) => void;
  setDays: (value: number) => void;
  setDomain: (value: string) => void;
  setSort: (value: StorySort) => void;
  setQuery: (value: string) => void;
  clearFilters: () => void;
  /** The browse's canonical search string, for keying per-view state. */
  search: string;
}

export const useUrlStoryBrowse = (
  categoryIds: readonly string[] | null,
  domains: readonly string[] | null,
): UrlStoryBrowse => {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(
    () => parseBrowseFilters(params, { categories: categoryIds, domains }),
    [params, categoryIds, domains],
  );
  // ⚠️ THE CANONICAL FORM OF THE BROWSE, not the raw params: `?category=nope`
  // (read as „all") and the bare route are one view and get one depth key,
  // and a stray `utm_` a link added is not part of it.
  const search = useMemo(() => browseSearch(filters), [filters]);

  const write = useCallback(
    (key: BrowseParam, value: string | null) => {
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

  return {
    ...filters,
    search,
    setCategory: useCallback(
      (value: string) => write("category", value === "all" ? null : value),
      [write],
    ),
    setDays: useCallback(
      (value: number) =>
        write("days", value === BROWSE_DEFAULT_DAYS ? null : String(value)),
      [write],
    ),
    setDomain: useCallback(
      (value: string) => write("domain", value === "all" ? null : value),
      [write],
    ),
    setSort: useCallback(
      (value: StorySort) =>
        write("sort", value === BROWSE_DEFAULT_SORT ? null : value),
      [write],
    ),
    setQuery: useCallback(
      (value: string) => write("q", value.slice(0, BROWSE_QUERY_MAX) || null),
      [write],
    ),
    clearFilters: useCallback(() => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key of BROWSE_PARAMS) next.delete(key);
          return next;
        },
        { replace: true },
      );
    }, [setParams]),
  };
};
