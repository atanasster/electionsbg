import { useCallback, useMemo } from "react";
import electionsData from "../data/json/elections.json";
import { useSearchParams } from "react-router-dom";
import { ElectionInfo, isMachineOnlyVote } from "./dataTypes";

export const useElectionContext = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const elections = useMemo(() => electionsData.map((e) => e.name), []);
  const selected = useMemo(() => {
    const urlElections = searchParams.get("elections");
    if (urlElections && elections.find((e) => e === urlElections)) {
      return urlElections;
    }
    return elections[0];
  }, [elections, searchParams]);
  const setSelected = useCallback(
    (newSelected: string) => {
      if (elections.find((e) => e === newSelected)) {
        searchParams.set("elections", newSelected);
        setSearchParams(searchParams, { replace: true });
      }
    },
    [elections, searchParams, setSearchParams],
  );

  const priorElections: ElectionInfo | undefined = useMemo(() => {
    const idx = electionsData.findIndex((e) => e.name === selected);
    return idx >= 0 && idx < elections.length - 1
      ? (electionsData[idx + 1] as ElectionInfo)
      : undefined;
  }, [elections, selected]);

  const isMachineOnly = () => isMachineOnlyVote(selected);
  return {
    elections,
    selected,
    setSelected,
    isMachineOnly,
    priorElections,
  };
};
