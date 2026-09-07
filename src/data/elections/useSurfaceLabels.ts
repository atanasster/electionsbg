// Resolving a surface's IDs to labels, at render time (§5.3, Phase 2 item 6b).
//
// The artifact carries an id; the label comes from the corpus that owns BOTH languages. That is
// the same argument as "no URLs in the blob": a generator that emits a resolved label keeps
// emitting the old one after the naming rule moves, and both sides stay green.
//
// ⚠ IT COMPOSES THE APP'S EXISTING RESOLVERS AND ADDS NO PRODUCER. `canonical_parties.json`,
// `municipalities.json`, `settlements.json` and `regions.json` each already have exactly one
// reader in the browser, and §5.3 names the precedent: the EN place name has a build-time
// producer with a silent degrade, and "do not add a third producer" is written into the plan.
// A fetch issued from here would be that third producer. `useSurfaceLabelSources.test.ts` scans
// this file for it.
//
// ⚠ TWO KINDS OF NAME NEVER GO THROUGH A RESOLVER, and both are deliberate (§5.3): a person's
// name and a local-only list's own name are Bulgarian in BOTH languages, because no English
// form of either exists anywhere in the corpus and a transliteration is a name that appears in
// no source document. They arrive on the row already, in `candidateName` / `localPartyName`.

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useObshtinaLabel } from "@/data/municipalities/useObshtinaLabel";
import { useRegions } from "@/data/regions/useRegions";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { typedSettlementName } from "@/data/dataTypes";
import type { ElectionPlaceLevel, ElectionRankedEntry } from "./surfaceTypes";

/** What a ranked row is called, and whether the corpus could name it at all.
 *
 *  ⚠ THE THREE CASES ARE DISTINGUISHED, not collapsed into a string. "ГЕРБ" (a canonical party),
 *  „Движение заедно за промяна" (a local list with no canonical party, its own Bulgarian name in
 *  both languages) and "an id that resolved to nothing" are three different things, and a
 *  consumer that cannot tell them apart renders the third as a blank cell beside a real vote
 *  count. */
export type RankedRowLabel =
  | { kind: "party"; label: string; color?: string }
  | { kind: "local_list"; label: string }
  | { kind: "independent" }
  | { kind: "unresolved"; id: string };

export const useSurfaceLabels = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const { byId, displayNameForId, colorFor } = useCanonicalParties();
  const obshtinaLabel = useObshtinaLabel();
  const { findRegion } = useRegions();
  const { findSettlement } = useSettlementsInfo();

  /** ⚠ THE ROW, NOT THE BARE ID. `partyId` and `localPartyName` are two halves of one answer —
   *  the generator emits the second exactly when the first is null — so resolving them apart is
   *  how a local list ends up unlabelled on a page whose data has its name. */
  const rankedLabel = useCallback(
    (
      e: Pick<
        ElectionRankedEntry,
        "partyId" | "localPartyName" | "isIndependent"
      >,
    ): RankedRowLabel => {
      if (e.partyId) {
        const label = displayNameForId(e.partyId);
        return label
          ? { kind: "party", label, color: colorFor(e.partyId) }
          : { kind: "unresolved", id: e.partyId };
      }
      if (e.localPartyName)
        return { kind: "local_list", label: e.localPartyName };
      // A null id with no local name is an INDEPENDENT — the generator's own encoding — and the
      // label is copy rather than a name, so it localises.
      if (e.isIndependent !== false) return { kind: "independent" };
      return { kind: "unresolved", id: "" };
    },
    [displayNameForId, colorFor],
  );

  /** The `/party/<nickName>` slug a ranked row links to, or `undefined` when the corpus cannot
   *  name one.
   *
   *  ⚠ THE NICKNAME OF *THIS* CYCLE, not the lineage's current one. `/party/:id` is keyed on the
   *  nickname the CEC printed for that election, so linking a 2005 row to „ГЕРБ-СДС" would send
   *  a reader to a coalition formed twenty years later — the same rule `buildHistoryNameIndex`
   *  states for colour, one field over. `displayName` is the fallback and is itself the LATEST
   *  cycle's nickname, so it is right for a row whose own cycle the corpus does not record.
   *
   *  ⚠ AND IT RESOLVES AT RENDER TIME, like the label. The artifact carries the id; a producer
   *  that emitted a URL would keep emitting the old shape after the routing rule moved, with
   *  both sides green — §5.3's rule, and the reason this hook exists at all. */
  const partySlug = useCallback(
    (
      partyId: string | null | undefined,
      election?: string,
    ): string | undefined => {
      if (!partyId) return undefined;
      const p = byId.get(partyId);
      if (!p) return undefined;
      const inCycle = election
        ? p.history.find((h) => h.election === election)?.nickName
        : undefined;
      return inCycle || p.displayName || undefined;
    },
    [byId],
  );

  /** A place code → the name a reader can read, in the active language.
   *
   *  ⚠ EVERY LEVEL FALLS BACK TO THE CODE, NEVER TO AN EMPTY STRING — `useObshtinaLabel`'s rule,
   *  applied to the other four. A blank place name on a result page is a heading about nowhere;
   *  „PDV-00" is ugly and honest, and it still tells a reader which page they are on. */
  const placeLabel = useCallback(
    (level: ElectionPlaceLevel, id: string): string => {
      switch (level) {
        // The one level whose label is genuinely copy: „България" names no row in any place
        // dictionary, because the country is not one of its own subdivisions.
        case "country":
          return t("bulgaria");
        // ⚠ ABROAD IS A REGION IN THE DICTIONARY, NOT A COPY KEY. The 32nd MIR is not a place
        // on any map, so a new `election_place_abroad` string looked like the answer — but
        // `regions.json` already carries it as „Извън страната" / "Abroad", in both languages,
        // under the same `oblast` code the surface stores. Adding the key would have been a
        // second producer for a name the corpus owns, and — since neither corpus had it — one
        // that renders as its own identifier on the page.
        case "abroad":
        case "region": {
          const r = findRegion(id);
          // `||` rather than `??`: `name_en` is typed as required, so the only value that can
          // reach the fallback is an EMPTY string — which `??` would pass through, dropping the
          // reader to the code when the Bulgarian name was right there.
          return (isBg ? r?.name : r?.name_en || r?.name) || id;
        }
        case "municipality":
          return obshtinaLabel(id) || id;
        case "settlement":
          // The typed form („гр. София", „с. Иваново") is the one every other place heading on
          // the site uses; English carries no Cyrillic type marker and the helper knows it.
          return typedSettlementName(
            findSettlement(id),
            isBg ? "bg" : "en",
            id,
          );
        case "section":
          // A polling station has no name anywhere in the corpus — only its number, which IS the
          // id. Returning it is the whole answer, not a fallback.
          return id;
      }
    },
    [t, isBg, findRegion, obshtinaLabel, findSettlement],
  );

  return { rankedLabel, partySlug, placeLabel };
};
