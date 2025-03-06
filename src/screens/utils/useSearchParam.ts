import { useCallback, useMemo } from "react";
import { NavigateOptions, useSearchParams } from "react-router-dom";

export const useSearchParam = (
  param: string,
  navigateOpts?: NavigateOptions,
): [string | null, (value?: string) => void] => {
  const [searchParams, setSearchParams] = useSearchParams();
  const setSearchParam = useCallback(
    (newValue?: string) => {
      if (newValue) {
        searchParams.set(param, newValue);
      } else {
        searchParams.delete(param);
      }
      setSearchParams(searchParams, navigateOpts);
    },
    [navigateOpts, param, searchParams, setSearchParams],
  );
  const searchParam = useMemo(() => {
    return searchParams.get(param);
  }, [param, searchParams]);
  return [searchParam, setSearchParam];
};
