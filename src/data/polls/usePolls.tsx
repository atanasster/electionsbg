import { useQuery } from "@tanstack/react-query";
import { Poll, PollDetail, PollsAccuracy, PollsAnalysis } from "./pollsTypes";
import { dataUrl } from "@/data/dataUrl";

// Polls span elections, so these queries are not keyed on the selected election.
// All five files live at /polls/*.json (top-level, election-independent).

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(dataUrl(path));
  if (!res.ok) return undefined;
  return (await res.json()) as T;
};

export const usePolls = () =>
  useQuery({
    queryKey: ["polls", "list"],
    queryFn: () => fetchJson<Poll[]>("/polls/polls.json"),
  });

export const usePollDetails = () =>
  useQuery({
    queryKey: ["polls", "details"],
    queryFn: () => fetchJson<PollDetail[]>("/polls/polls_details.json"),
  });

// The registry is race-neutral and lives in its own module; re-exported for existing callers.
export { useAgencies } from "./useAgencies";

export const usePollsAccuracy = () =>
  useQuery({
    queryKey: ["polls", "accuracy"],
    queryFn: () => fetchJson<PollsAccuracy>("/polls/accuracy.json"),
  });

export const usePollsAnalysis = () =>
  useQuery({
    queryKey: ["polls", "analysis"],
    queryFn: () => fetchJson<PollsAnalysis>("/polls/analysis.json"),
  });
