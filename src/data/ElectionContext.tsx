import { useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import allElections from "../data/json/elections.json";
import { ElectionInfo } from "./dataTypes";
import { useSearchParam } from "@/screens/utils/useSearchParam";

export const useElectionContext = () => {
  const [election, setElection] = useSearchParam("elections", {
    replace: true,
  });
  // /elections/:date routes (per-election landing pages) embed the election
  // date directly in the URL path. When that param is present and valid it
  // wins over the `?elections=` query param so the URL stays canonical.
  const { date: pathDate } = useParams<{ date?: string }>();
  const elections = useMemo(() => allElections.map((e) => e.name), []);
  const selected = useMemo(() => {
    if (pathDate && elections.find((e) => e === pathDate)) {
      return pathDate;
    }
    if (election && elections.find((e) => e === election)) {
      return election;
    }
    return elections[0];
  }, [pathDate, election, elections]);
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
  return {
    elections,
    selected,
    setSelected,
    priorElections,
    prevElections,
    electionStats,
    stats: allElections as ElectionInfo[],
  };
};
