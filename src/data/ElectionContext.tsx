import { useCallback, useMemo } from "react";
import elections from "../data/json/elections.json";
import { useSearchParams } from "react-router-dom";
import { isMachineOnlyVote } from "./dataTypes";

export const useElectionContext = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = useMemo(() => {
    const urlElections = searchParams.get("elections");
    if (urlElections && elections.find((e) => e === urlElections)) {
      return urlElections;
    }
    return elections[0];
  }, [searchParams]);
  const setSelected = useCallback(
    (newSelected: string) => {
      if (elections.find((e) => e === newSelected)) {
        searchParams.set("elections", newSelected);
        setSearchParams(searchParams, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );
  const priorElections: string | undefined = useMemo(() => {
    const idx = elections.findIndex((e) => e === selected);
    return idx >= 0 && idx < elections.length - 1
      ? elections[idx + 1]
      : undefined;
  }, [selected]);

  const isMachineOnly = () => isMachineOnlyVote(selected);
  return {
    elections,
    selected,
    setSelected,
    isMachineOnly,
    priorElections,
  };
};
