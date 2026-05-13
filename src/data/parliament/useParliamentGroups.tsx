import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";

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
  const response = await fetch(dataUrl(`/parliament_groups.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
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

  // parliament.bg uses long names for some groups (e.g. "ПГ на Продължаваме
  // Промяната") and short forms for others (e.g. "ПГ ДПС"). Index every alias
  // a group might be referenced by — uppercased so case mismatches between the
  // override file and parliament.bg's casing don't cause a miss.
  const byShort = useMemo(() => {
    const m = new Map<string, ParliamentGroup>();
    for (const g of data?.groups ?? []) {
      for (const alias of [g.shortName, g.longName, g.displayName]) {
        if (alias) m.set(alias.toUpperCase(), g);
      }
    }
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
        return byShort.get(stripPgPrefix(currentPartyGroupShort).toUpperCase());
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

  const {
    colorFor: cikColorFor,
    displayNameFor: cikDisplayNameFor,
    findCanonicalNickName: cikFindNickName,
  } = useCanonicalParties();

  // Roll-call CSVs label parliamentary groups with their bare short name
  // (e.g. "ГЕРБ - СДС", "БСП - ОЛ"), with whitespace around the hyphen and
  // sometimes a "ПГ на" prefix. Try a few normal forms when bridging into
  // canonical-CIK lookups so colours/labels resolve for every group, not
  // just the ones that have an explicit entry in parliament_groups.json.
  const variants = (short: string): string[] => {
    const stripped = stripPgPrefix(short);
    const out = new Set<string>([short, stripped]);
    out.add(stripped.replace(/\s*[-–—]\s*/g, "-"));
    out.add(stripped.replace(/\s+/g, ""));
    return [...out];
  };

  const colorForPartyShort = useCallback(
    (short?: string | null): string | undefined => {
      if (!short) return undefined;
      const override = lookup(short)?.color;
      if (override) return override;
      for (const v of variants(short)) {
        const c = cikColorFor(v);
        if (c) return c;
      }
      return undefined;
    },
    [lookup, cikColorFor],
  );

  const labelForPartyShort = useCallback(
    (short?: string | null): string => {
      if (!short) return "";
      const override = lookup(short)?.displayName;
      if (override) return override;
      for (const v of variants(short)) {
        const n = cikDisplayNameFor(v);
        if (n) return n;
      }
      return stripPgPrefix(short);
    },
    [lookup, cikDisplayNameFor],
  );

  // CIK nickName usable as the SPA's /party/<nickName> URL slug. For
  // parliamentary groups that are components of a coalition (e.g. ПП split
  // off ПП-ДБ) the URL targets the parent coalition. Returns undefined when
  // no CIK match is found — caller decides whether to render a link or text.
  const nickNameForPartyShort = useCallback(
    (short?: string | null): string | undefined => {
      if (!short) return undefined;
      const override = lookup(short);
      if (override?.parentCoalitionNickName) {
        return override.parentCoalitionNickName;
      }
      for (const v of variants(short)) {
        const nick = cikFindNickName(v);
        if (nick) return nick;
      }
      return undefined;
    },
    [lookup, cikFindNickName],
  );

  return {
    lookup,
    childrenFor,
    stripPgPrefix,
    colorForPartyShort,
    labelForPartyShort,
    nickNameForPartyShort,
  };
};

export { stripPgPrefix };
