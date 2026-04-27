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

  // Like canonicalIdFor, but reassigns predecessor-party nicknames to the
  // successor coalition's lineage when CEC `commonName` says they belong
  // together (e.g. ПП and ДБ → ПП-ДБ). Used in consolidated views to sum
  // votes across rebrands/mergers without polluting the strict lineage.
  const consolidationIdFor = (nickName: string): string | undefined =>
    data?.consolidationByNickName?.[nickName] ?? data?.byNickName[nickName];

  const fullNameFor = (
    nickName: string,
    election: string,
  ): string | undefined => {
    const id = data?.byNickName[nickName];
    if (!id) return undefined;
    const party = byId.get(id);
    return party?.history.find((h) => h.election === election)?.name;
  };

  const displayNameFor = (nickName: string): string | undefined => {
    const id = data?.byNickName[nickName];
    if (!id) return undefined;
    return byId.get(id)?.displayName;
  };

  const displayNameForId = (id: string): string | undefined =>
    byId.get(id)?.displayName;

  return {
    data,
    byId,
    colorFor,
    canonicalIdFor,
    consolidationIdFor,
    fullNameFor,
    displayNameFor,
    displayNameForId,
  };
};
