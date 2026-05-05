import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CanonicalPartiesIndex } from "./canonicalPartyTypes";

const queryFn = async (): Promise<CanonicalPartiesIndex | undefined> => {
  const response = await fetch(`/canonical_parties.json`);
  if (!response.ok) return undefined;
  return response.json();
};

// parliament.bg sometimes abbreviates a party differently from CEC's
// canonical nickname. Mapping is applied after dash/whitespace
// normalization in `partyGroupShortLabel`.
const PARLIAMENT_GROUP_ALIASES: Record<string, string> = {
  ПБ: "ПрБ",
};

// Replaces useAllPartyColors with a single fetch (one canonical_parties.json
// covers all elections). Adds canonical lineage IDs so cross-election views
// like the bubble timeline can connect bubbles belonging to the same party.
//
// Display-name and full-name selectors are language-aware: when i18n is set
// to English they return `displayNameEn` / `nameEn` if available, falling
// back to the Bulgarian original. This keeps the UI in sync with the
// language switcher without each call site needing to read i18n.language.
export const useCanonicalParties = () => {
  const { i18n } = useTranslation();
  const isEn = i18n.language === "en";

  const { data } = useQuery({
    queryKey: ["canonical_parties"],
    queryFn,
  });

  const byId = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["parties"][number]>();
    data?.parties.forEach((p) => map.set(p.id, p));
    return map;
  }, [data]);

  // Case-insensitive nickName → canonicalId index. Parliament group labels
  // arrive uppercased (e.g. "ВЪЗРАЖДАНЕ") while canonical history nicknames
  // are mixed-case ("Възраждане"), so an exact-match lookup misses them.
  const byNickNameLower = useMemo(() => {
    const map = new Map<string, string>();
    if (data?.byNickName) {
      for (const [nick, id] of Object.entries(data.byNickName)) {
        const k = nick.toLocaleLowerCase("bg");
        if (!map.has(k)) map.set(k, id);
      }
    }
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
    const entry = party?.history.find((h) => h.election === election);
    if (!entry) return undefined;
    return isEn ? (entry.nameEn ?? entry.name) : entry.name;
  };

  const displayNameFor = (nickName: string): string | undefined => {
    const id = data?.byNickName[nickName];
    if (!id) return undefined;
    const party = byId.get(id);
    if (!party) return undefined;
    return isEn
      ? (party.displayNameEn ?? party.displayName)
      : party.displayName;
  };

  const displayNameForId = (id: string): string | undefined => {
    const party = byId.get(id);
    if (!party) return undefined;
    return isEn
      ? (party.displayNameEn ?? party.displayName)
      : party.displayName;
  };

  // Localize a parliament.bg group short label like "ПГ ВЪЗРАЖДАНЕ" or
  // "ПГ на ГЕРБ-СДС" to the canonical party display name in the active
  // language. Strips the "ПГ"/"ПГ на" prefix, then resolves via
  // `byNickName` (case-insensitive). Falls back to the stripped label
  // when no canonical match exists, and to the raw label when there's no
  // PG prefix to strip.
  //
  // Dash normalization: parliament.bg's index emits en-dashes with spaces
  // ("ГЕРБ – СДС"), while canonical nicknames use a plain hyphen and no
  // spaces ("ГЕРБ-СДС"). Collapse en/em-dashes to "-" and trim spaces
  // around the hyphen so both forms resolve.
  //
  // Aliases: parliament.bg uses some abbreviations that differ from the
  // CEC canonical nicknames ("ПБ" vs "ПрБ" for Прогресивна България).
  // Map the parliament-only forms to their canonical equivalent before
  // lookup.
  const partyGroupShortLabel = (
    partyGroupShort: string | null | undefined,
  ): string | null => {
    if (!partyGroupShort) return null;
    const stripped = partyGroupShort
      .replace(/^ПГ(\s+на)?\s+/, "")
      .replace(/[–—]/g, "-")
      .replace(/\s*-\s*/g, "-")
      .trim();
    if (!stripped) return partyGroupShort;
    const aliased = PARLIAMENT_GROUP_ALIASES[stripped] ?? stripped;
    const id =
      data?.byNickName[aliased] ??
      byNickNameLower.get(aliased.toLocaleLowerCase("bg"));
    if (!id) return stripped;
    const party = byId.get(id);
    if (!party) return stripped;
    return isEn
      ? (party.displayNameEn ?? party.displayName)
      : party.displayName;
  };

  return {
    data,
    byId,
    colorFor,
    canonicalIdFor,
    consolidationIdFor,
    fullNameFor,
    displayNameFor,
    displayNameForId,
    partyGroupShortLabel,
  };
};
