import { useQuery } from "@tanstack/react-query";
import {
  Agency,
  Poll,
  PollDetail,
  PollsAccuracy,
  PollsAnalysis,
} from "./pollsTypes";

// Polls span elections, so these queries are not keyed on the selected election.
// All five files live at /polls/*.json (top-level, election-independent).

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(path);
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

export const useAgencies = () =>
  useQuery({
    queryKey: ["polls", "agencies"],
    queryFn: () => fetchJson<Agency[]>("/polls/agencies.json"),
  });

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
