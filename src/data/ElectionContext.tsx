import { useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import allElections from "../data/json/elections.json";
import allLocalElections from "../data/json/local_elections.json";
import allPresidentialElections from "../data/json/presidential_elections.json";
import { ElectionInfo } from "./dataTypes";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import type { PresidentialElectionEntry } from "./presidentialCatalogue";

export type { PresidentialElectionEntry };

export type LocalElectionEntry = {
  name: string; // e.g. "2023_10_29_mi"
  round1Date: string;
  round2Date: string | null;
  kind: "regular" | "partial";
};

export const useElectionContext = () => {
  const [election, setElection] = useSearchParam("elections", {
    replace: true,
  });
  // /elections/:date routes (per-election landing pages) embed the election
  // date directly in the URL path. When that param is present and valid it
  // wins over the `?elections=` query param so the URL stays canonical.
  const { date: pathDate } = useParams<{ date?: string }>();
  const elections = useMemo(() => allElections.map((e) => e.name), []);
  // Local cycles live in their own catalogue and are surfaced to the
  // selector via `localElections`. They never enter `elections` (the
  // parliamentary array) so next/prev arrow navigation skips them.
  const localElections = useMemo<LocalElectionEntry[]>(
    () => allLocalElections as LocalElectionEntry[],
    [],
  );
  // Presidential cycles are a third catalogue, on the same terms as the local one: the
  // selector renders them, and they never enter `elections`, so prev/next arrows keep
  // stepping through parliamentary cycles only.
  //
  // ⚠ THE CAST IS AN ASSERTION, NOT A CHECK — TypeScript types the JSON structurally, so
  // `decidedInRound` arrives as `number` and `rounds` as an index signature.
  // `isPresidentialElectionEntry` is what actually validates the committed file, in
  // `presidentialCatalogue.test.ts`.
  //
  // First consumer is `electionsHubCycle.ts` (plan T4.2) — until it lands nothing reads
  // this, and an unused property on a returned object is invisible to `noUnusedLocals`.
  const presidentialElections = useMemo<PresidentialElectionEntry[]>(
    () => allPresidentialElections as PresidentialElectionEntry[],
    [],
  );
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
    localElections,
    presidentialElections,
    selected,
    setSelected,
    priorElections,
    prevElections,
    electionStats,
    stats: allElections as ElectionInfo[],
  };
};
