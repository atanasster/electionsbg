import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CanonicalPartiesIndex } from "./canonicalPartyTypes";

const queryFn = async (): Promise<CanonicalPartiesIndex | undefined> => {
  const response = await fetch(`/canonical_parties.json`);
  if (!response.ok) return undefined;
  return response.json();
};

// Replaces useAllPartyColors with a single fetch (one canonical_parties.json
// covers all elections). Adds canonical lineage IDs so cross-election views
// like the bubble timeline can connect bubbles belonging to the same party.
export const useCanonicalParties = () => {
  const { data } = useQuery({
    queryKey: ["canonical_parties"],
    queryFn,
  });

  const byId = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["parties"][number]>();
    data?.parties.forEach((p) => map.set(p.id, p));
    return map;
  }, [data]);

  const colorFor = (nickName: string): string | undefined => {
    const id = data?.byNickName[nickName];
    if (!id) return undefined;
    return byId.get(id)?.color;
  };

  const canonicalIdFor = (nickName: string): string | undefined =>
    data?.byNickName[nickName];

  return {
    data,
    byId,
    colorFor,
    canonicalIdFor,
  };
};
