import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CanonicalPartiesIndex } from "./canonicalPartyTypes";
// parliament.bg labels a party group differently from CEC's canonical nickname
// — either a different abbreviation ("ПБ" vs "ПрБ") or the full party name
// spelled out ("Демократична България" vs "ДБ"). Applied after dash/whitespace
// normalization in `partyGroupShortLabel`. Shared with
// scripts/person/partyGroups.ts — see that file's header for why there is
// exactly one copy of this table.
import {
  resolveNicknameToId,
  stripGroupPrefix,
} from "./parliamentGroupAliases";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<CanonicalPartiesIndex | undefined> => {
  const response = await fetch(dataUrl(`/canonical_parties.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

/** Old ballot name → canonical party id, or `null` when the name belongs to more than one
 *  lineage.
 *
 *  ⚠️ COLOUR ONLY. Do not resolve a LABEL or a `/party/<slug>` through this. The register's
 *  own words have to survive on the chip: turning `КП "Коалиция за България"` into the
 *  lineage's CURRENT nickname would tell an MP elected in 2005 that they stood for a
 *  coalition formed twenty years later. `findCanonicalNickName` is the label path and
 *  deliberately does not consult this index.
 *
 *  Keyed under BOTH folds a caller might have applied — the raw case-fold that `colorFor`
 *  uses, and `stripGroupPrefix`'s, which `partyGroupShortColor` applies before it delegates.
 *  One index reached through two different folds is the failure parliamentGroupAliases.ts's
 *  header argues against ("share the matching rule, not just the table"), and it is not
 *  hypothetical here: stripGroupPrefix removes the trailing quote from
 *  `КП "Коалиция за България"`, so 105 of the 240 names — every quoted and every
 *  en-dash-spelled one — were unreachable through that entry point.
 *
 *  Exported and pure so the ambiguity rule can be tested without standing up the hook. */
export const buildHistoryNameIndex = (
  parties: CanonicalPartiesIndex["parties"] | undefined,
): Map<string, string | null> => {
  const seen = new Map<string, string | null>();
  // One ambiguity rule, applied to every key: a name two lineages share resolves to NOTHING
  // rather than to a guess. Colouring one party's chip with another's is worse than grey.
  const put = (key: string, id: string) => {
    if (!key) return;
    const prev = seen.get(key);
    if (prev === undefined) seen.set(key, id);
    else if (prev !== id) seen.set(key, null);
  };
  for (const p of parties ?? []) {
    for (const h of p.history ?? []) {
      // Interior whitespace collapsed too — the real file carries
      // „политическа партия  общество за нова българия" with a double space.
      const raw = (h.name ?? "").replace(/\s+/g, " ").trim();
      if (!raw) continue;
      put(raw.toLocaleLowerCase("bg"), p.id);
      put(stripGroupPrefix(raw).toLocaleLowerCase("bg"), p.id);
    }
  }
  return seen;
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

  // Historical BALLOT names → canonical id. `byNickName` carries only the nicknames a
  // party is known by TODAY (`БСП`, `БСП-ОЛ`), so a label printed on an old ballot —
  // `КП "Коалиция за България"`, `БСП лява България` — resolved to nothing, and an MP
  // elected under it got a grey pill even though canonical_parties.json records that name
  // under `bsp` all along. Used for COLOUR ONLY (see colorFor): the displayed label must
  // stay the register's own words, because resolving it to the current nickname would tell
  // an MP elected in 2005 they stood for a coalition formed twenty years later.
  //
  // A name used by more than one lineage maps to nothing rather than to a guess — 5 of the
  // 240 historical names collide (`ВОЛЯ`, `ПП Глас Народен`, …), and colouring one party's
  // chip with another's is worse than leaving it grey.
  const byHistoryName = useMemo(
    () => buildHistoryNameIndex(data?.parties),
    [data],
  );

  // The case-insensitive fold that used to live here moved into
  // parliamentGroupAliases.ts, where it is memoised per byNickName object and
  // shared with the server. Parliament group labels arrive uppercased
  // ("ВЪЗРАЖДАНЕ") while canonical nicknames are mixed-case ("Възраждане"), so
  // an exact-match lookup misses them — that fold is still applied, just once
  // and in one place.

  // The SHARED chain, identical to the one scripts/person/partyGroups.ts uses:
  // exact → case-insensitive → alias → normalised fold. Hand-rolling it here
  // is what made the browser and the resolver disagree on 5 of the 26 live
  // group shorts (`ГЕРБ - СДС`, `БСП - ОЛ`, `ДПС - НН`, `ПП - ДБ` all resolved
  // server-side and returned undefined here) while both looked correct.
  const resolveCanonicalId = (input: string): string | undefined =>
    resolveNicknameToId(input, data?.byNickName);

  // Accepts either a nickName ("ГЕРБ") or a canonical id ("gerb", "p_67").
  // Local-elections code stamps `primaryCanonicalId` as the canonical id, not a
  // nickName, so the byId fallback is what lights up colour dots in the council
  // dropdown, the chmi history, the Sofia район choropleth, etc.
  const colorFor = (input: string): string | undefined => {
    if (!input) return undefined;
    const direct = byId.get(input)?.color;
    if (direct) return direct;
    const id = resolveCanonicalId(input);
    // Read the colour rather than returning on the id: a resolvable lineage that carries no
    // colour would otherwise dead-end here and never reach the tier below.
    const viaNickName = id ? byId.get(id)?.color : undefined;
    if (viaNickName) return viaNickName;
    // Last resort: an old ballot name the nickname index does not know. Deliberately NOT
    // folded into resolveCanonicalId — findCanonicalNickName reads that, and it must keep
    // returning undefined here so the LABEL stays as the ballot printed it. The nickname
    // tier above always wins; 32 folded history names are also nicknames and one
    // („новото време") names a different lineage in each index.
    const viaHistory = byHistoryName.get(
      input.replace(/\s+/g, " ").trim().toLocaleLowerCase("bg"),
    );
    return viaHistory ? byId.get(viaHistory)?.color : undefined;
  };

  const canonicalIdFor = (nickName: string): string | undefined =>
    data?.byNickName[nickName];

  // Resolve any input (exact, case-insensitive, or via parliament-group alias
  // like "ПБ" → "ПрБ") to the canonical nickName form actually used as the
  // SPA's /party/<nickName> URL slug. Returns the original casing from the
  // data — important when the input is an all-caps parliament.bg label that
  // doesn't match the CIK casing.
  const findCanonicalNickName = (input: string): string | undefined => {
    if (!input) return undefined;
    if (data?.byNickName[input]) return input;
    const id = resolveCanonicalId(input);
    if (!id) return undefined;
    for (const nick of Object.keys(data?.byNickName ?? {})) {
      if (data?.byNickName[nick] === id) return nick;
    }
    return undefined;
  };

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
    const id = resolveCanonicalId(nickName);
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
    // stripGroupPrefix also drops the QUOTES parliament.bg wraps some names in
    // — `ПГ "Прогресивна България"` is the 52nd's largest group (143 of 240
    // sitting MPs) and a prefix-only strip left it unresolvable.
    const stripped = stripGroupPrefix(partyGroupShort);
    if (!stripped) return partyGroupShort;
    const id = resolveNicknameToId(stripped, data?.byNickName);
    if (!id) return stripped;
    const party = byId.get(id);
    if (!party) return stripped;
    return isEn
      ? (party.displayNameEn ?? party.displayName)
      : party.displayName;
  };

  // The COLOUR twin of partyGroupShortLabel, and it exists for the same reason that
  // function does: `colorFor` resolves a nickname, while parliament.bg hands us a group
  // label („ПГ на ГЕРБ – СДС", `ПГ "Прогресивна България"`). Strip the prefix and quotes
  // through the shared helper FIRST, then take the canonical colour — a call site doing
  // that itself is the drift parliamentGroupAliases.ts's header argues against.
  // ⚠️ NOT symmetric with partyGroupShortLabel any more: this inherits colorFor's
  // historical-ballot-name tier and the label twin deliberately must not — see
  // buildHistoryNameIndex. The index is keyed under this function's own fold too, so its
  // reach is the full set rather than the 135 of 240 names stripGroupPrefix leaves intact.
  const partyGroupShortColor = (
    partyGroupShort: string | null | undefined,
  ): string | undefined => {
    if (!partyGroupShort) return undefined;
    const stripped = stripGroupPrefix(partyGroupShort);
    return colorFor(stripped || partyGroupShort);
  };

  return {
    data,
    byId,
    colorFor,
    canonicalIdFor,
    consolidationIdFor,
    findCanonicalNickName,
    fullNameFor,
    displayNameFor,
    displayNameForId,
    partyGroupShortLabel,
    partyGroupShortColor,
  };
};
