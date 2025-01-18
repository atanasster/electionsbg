import { useCallback, useMemo } from "react";
import allElections from "../data/json/elections.json";
import { useSearchParams } from "react-router-dom";
import { ElectionInfo, isMachineOnlyVote } from "./dataTypes";

export const useElectionContext = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const elections = useMemo(() => allElections.map((e) => e.name), []);
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

  const prevElections: (name?: string) => ElectionInfo | undefined =
    useCallback(
      (name?: string) => {
        const idx = allElections.findIndex((e) => e.name === name);
        return idx >= 0 && idx < elections.length - 1
          ? (allElections[idx + 1] as ElectionInfo)
          : undefined;
      },
      [elections],
    );
  const priorElections: ElectionInfo | undefined = useMemo(() => {
    return prevElections(selected);
  }, [prevElections, selected]);

  const electionStats: ElectionInfo | undefined = useMemo(() => {
    return allElections.find((e) => e.name === selected) as
      | ElectionInfo
      | undefined;
  }, [selected]);
  const isMachineOnly = () => isMachineOnlyVote(selected);
  return {
    elections,
    selected,
    setSelected,
    isMachineOnly,
    priorElections,
    prevElections,
    electionStats,
    stats: allElections as ElectionInfo[],
  };
};
