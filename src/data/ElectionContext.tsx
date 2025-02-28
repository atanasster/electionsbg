import { useCallback, useMemo } from "react";
import allElections from "../data/json/elections.json";
import { ElectionInfo, isMachineOnlyVote } from "./dataTypes";
import { useSearchParam } from "@/screens/utils/useSearchParam";

export const useElectionContext = () => {
  const [election, setElection] = useSearchParam("elections", {
    replace: true,
  });
  const elections = useMemo(() => allElections.map((e) => e.name), []);
  const selected = useMemo(() => {
    if (election && elections.find((e) => e === election)) {
      return election;
    }
    return elections[0];
  }, [election, elections]);
  const setSelected = useCallback(
    (newSelected: string) => {
      if (elections.find((e) => e === newSelected)) {
        setElection(newSelected);
      }
    },
    [elections, setElection],
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
