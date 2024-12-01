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
  const isMachineOnly = () => isMachineOnlyVote(selected);
  return {
    elections,
    selected,
    setSelected,
    isMachineOnly,
  };
};
