import { useQuery } from "@tanstack/react-query";
import type { Agency } from "./pollsTypes";
import { dataUrl } from "@/data/dataUrl";

// The agency REGISTRY (`/polls/agencies.json`) — names, abbreviations and ЕИК. It belongs to
// neither race: the same Тренд or Маркет ЛИНКС runs both parliamentary and presidential polls.
// ⚠ ITS OWN MODULE, not `usePolls.tsx`, because `consumer_race_isolation.test.ts` forbids a
// presidential consumer from importing the parliamentary polls module at all. `usePolls.tsx`
// re-exports this, and the query key is shared, so both families read one cache entry.
export const useAgencies = () =>
  useQuery({
    queryKey: ["polls", "agencies"],
    queryFn: async (): Promise<Agency[] | undefined> => {
      const res = await fetch(dataUrl("/polls/agencies.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as Agency[];
    },
  });

/** An agency's display name from the registry, falling back to its id when it is not listed. */
export const agencyDisplayName = (
  agencies: readonly Agency[] | undefined,
  id: string,
  isBg: boolean,
): string => {
  const a = agencies?.find((x) => x.id === id);
  return a ? (isBg ? a.name_bg : a.name_en) : id;
};
