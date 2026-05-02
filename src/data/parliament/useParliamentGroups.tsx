import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

// Override map for parliamentary groups that don't map 1:1 to a CIK ballot
// party — typically the components of a coalition that split into separate
// groups after being seated (e.g. PP-DB → ПГ ПП and ПГ ДБ).
//
// Election results stay coalition-shaped (CIK party data is untouched). MP
// views look up the override by the bare short group name (parliament.bg's
// `currentPartyGroupShort` minus the "ПГ" / "ПГ на" prefix) and use the
// component's color/display name when present.
export type ParliamentGroup = {
  shortName: string;
  longName: string;
  displayName: string;
  color: string;
  parentCoalitionId?: string;
  parentCoalitionNickName?: string;
};

type ParliamentGroupsFile = { groups: ParliamentGroup[] };

const queryFn = async (): Promise<ParliamentGroupsFile | undefined> => {
  const response = await fetch(`/parliament_groups.json`);
  if (!response.ok) return undefined;
  return response.json();
};

// parliament.bg gives short names like "ПГ ПП", "ПГ на ПБ", "ПГ ДБ".
// Strip the "ПГ" / "ПГ на" prefix to get the bare short name we key on.
const stripPgPrefix = (s: string): string =>
  s.replace(/^ПГ(\s+на)?\s+/, "").trim();

export const useParliamentGroups = () => {
  const { data } = useQuery({
    queryKey: ["parliament_groups"] as [string],
    queryFn,
    staleTime: Infinity,
  });

  const byShort = useMemo(() => {
    const m = new Map<string, ParliamentGroup>();
    for (const g of data?.groups ?? []) m.set(g.shortName, g);
    return m;
  }, [data]);

  const byParent = useMemo(() => {
    const m = new Map<string, ParliamentGroup[]>();
    for (const g of data?.groups ?? []) {
      const parent = g.parentCoalitionNickName;
      if (!parent) continue;
      const arr = m.get(parent) ?? [];
      arr.push(g);
      m.set(parent, arr);
    }
    return m;
  }, [data]);

  // Look up an override for a parliament.bg `currentPartyGroupShort` value.
  // Returns undefined when no override exists — caller should fall back to
  // CIK / coalition data.
  const lookup = useMemo(
    () =>
      (currentPartyGroupShort?: string | null): ParliamentGroup | undefined => {
        if (!currentPartyGroupShort) return undefined;
        return byShort.get(stripPgPrefix(currentPartyGroupShort));
      },
    [byShort],
  );

  // Children of a coalition that splits in parliament — undefined when the
  // coalition has no entries in parliament_groups.json.
  const childrenFor = useMemo(
    () =>
      (parentNickName?: string | null): ParliamentGroup[] | undefined => {
        if (!parentNickName) return undefined;
        return byParent.get(parentNickName);
      },
    [byParent],
  );

  return { lookup, childrenFor, stripPgPrefix };
};

export { stripPgPrefix };
