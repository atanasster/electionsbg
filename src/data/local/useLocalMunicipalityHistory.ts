// Fans out useLocalMunicipality across every cycle in the catalogue so a
// dashboard tile can render mayor / council history without a per-cycle
// boilerplate. Returns an array sorted oldest → newest with a stable shape;
// cycles where the município has no data (e.g. Sofia districts in pre-2019
// cycles when the район wasn't elected separately) become entries with
// `bundle: undefined` so the consumer can render placeholder chips.

import { useQueries } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { LocalMunicipalityBundle } from "./types";
import { useLocalElectionList } from "./useLocalCycles";

type Row = {
  cycle: string;
  round1Date: string;
  bundle: LocalMunicipalityBundle | undefined;
  isLoading: boolean;
};

const fetchBundle = async (
  cycle: string,
  obshtinaCode: string,
): Promise<LocalMunicipalityBundle | undefined> => {
  const response = await fetch(
    dataUrl(`/${cycle}/municipalities/${obshtinaCode}.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local municipality history fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useLocalMunicipalityHistory = (
  obshtinaCode?: string | null,
): { rows: Row[]; isLoading: boolean } => {
  const list = useLocalElectionList();
  const sorted = [...list].sort((a, b) =>
    a.round1Date.localeCompare(b.round1Date),
  );
  const queries = useQueries({
    queries: sorted.map((entry) => ({
      queryKey: ["local_municipality_history", entry.name, obshtinaCode],
      queryFn: async () => fetchBundle(entry.name, obshtinaCode ?? ""),
      enabled: !!obshtinaCode,
    })),
  });
  const rows: Row[] = sorted.map((entry, i) => ({
    cycle: entry.name,
    round1Date: entry.round1Date,
    bundle: queries[i].data,
    isLoading: queries[i].isLoading,
  }));
  const isLoading = rows.some((r) => r.isLoading);
  return { rows, isLoading };
};
