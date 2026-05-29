// URL-backed Set<string> for per-row expand/collapse state. Used by tiles
// where the user can toggle multiple rows independently and we want the
// expanded set to be shareable / back-button friendly (e.g. paste-the-link
// → see the same rows expanded). Encoded as a single comma-separated value
// under one search param.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export const useUrlExpandedSet = (
  param: string,
): {
  expanded: Set<string>;
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
} => {
  const [searchParams, setSearchParams] = useSearchParams();

  const expanded = useMemo(() => {
    const raw = searchParams.get(param);
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
  }, [param, searchParams]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(expanded);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const params = new URLSearchParams(searchParams);
      if (next.size === 0) params.delete(param);
      else params.set(param, Array.from(next).join(","));
      setSearchParams(params, { replace: true });
    },
    [expanded, param, searchParams, setSearchParams],
  );

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);

  return { expanded, isExpanded, toggle };
};
