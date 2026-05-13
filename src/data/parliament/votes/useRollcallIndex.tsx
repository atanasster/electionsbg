import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { RollcallIndexFile } from "./types";

const queryFn = async (): Promise<RollcallIndexFile | undefined> => {
  const response = await fetch(dataUrl(`/parliament/votes/index.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

// Returns the sessions list scoped to the currently selected election's
// parliament. Sessions are filtered by their `ns` field — entries without one
// (legacy index files) are kept on the fallback path so a partially-migrated
// dataset still renders.
export const useRollcallIndex = () => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_index"] as [string],
    queryFn,
    staleTime: Infinity,
  });

  const ns = electionToNsFolder(selected);
  const sessions = useMemo(() => {
    const all = data?.sessions ?? [];
    if (!ns) return all;
    // If at least one entry carries `ns`, treat the index as scope-aware and
    // filter strictly. Otherwise it's a legacy file — return everything so the
    // SPA degrades gracefully rather than going blank.
    const anyScoped = all.some((s) => s.ns);
    return anyScoped ? all.filter((s) => s.ns === ns) : all;
  }, [data, ns]);

  return {
    index: data,
    sessions,
    currentNs: ns ?? data?.ns,
    isLoading,
  };
};
