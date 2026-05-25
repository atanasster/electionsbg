import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { TopicIndexFile, TopicEntry } from "./types";

const queryFn = async (): Promise<TopicIndexFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/topic_index.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

// Returns the topic-index slice scoped to the user's currently selected
// election. Entries are pre-sorted newest-first inside the artifact, so
// consumers can take the head of the array without re-sorting.
export const useTopicIndex = () => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_topic_index"] as [string],
    queryFn,
    staleTime: Infinity,
  });

  const ns = electionToNsFolder(selected);
  const entries: TopicEntry[] = useMemo(() => {
    if (!data?.byNs) return [];
    if (ns && data.byNs[ns]) return data.byNs[ns].entries;
    // Legacy / unscoped fallback: concatenate every NS slice in date order.
    // Prefer the scoped lookup above; this keeps the page from going blank
    // when the user picks an election the artifact doesn't yet cover.
    const all: TopicEntry[] = [];
    for (const slice of Object.values(data.byNs)) all.push(...slice.entries);
    all.sort((a, b) =>
      a.date === b.date ? a.item - b.item : b.date.localeCompare(a.date),
    );
    return all;
  }, [data, ns]);

  return { entries, isLoading, computedAt: data?.computedAt, currentNs: ns };
};
