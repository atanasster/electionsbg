import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useCandidates } from "@/data/preferences/useCandidates";
import { useMps } from "@/data/parliament/useMps";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useElectionContext } from "@/data/ElectionContext";
import type { PartyInfo } from "@/data/dataTypes";

/** URL-driven party filter for detail pages (/mp-assets, /mp-cars, ...).
 *
 * Reads `?partyId=<canonicalId>` (preferred — stable across elections) and
 * falls back to legacy `?partyNum=15` (CEC ballot number for the current
 * election). The canonical id form is required because CEC ballot numbers
 * change every election: `?partyNum=7` means ИТН in 2024_10_27 but maps to
 * a different party in 2026_04_19, so the URL silently breaks when the user
 * switches the election from the global selector.
 *
 * Filtering happens by mpId, not by `partyGroupShort`, because coalition
 * parties (e.g. ПП-ДБ) split into multiple parliamentary groups (ПГ ПП and
 * ПГ ДБ) once seated.
 */
export type PartyScope = {
  partyNum: number | null;
  partyMpIds: Set<number> | null;
  /** Resolved PartyInfo for the current election, when one is found. */
  party: PartyInfo | undefined;
  /** Short label (nickName) for chips. */
  label: string | null;
  /** Canonical full party name for the current election, for page titles. */
  fullName: string | null;
  /** Search params with the party filter removed — for the "clear" button. */
  clearedParams: URLSearchParams;
};

export const usePartyScope = (): PartyScope => {
  const { i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const { selected } = useElectionContext();
  const { candidates } = useCandidates();
  const { findMpByName } = useMps();
  const { findParty } = usePartyInfo();
  const { fullNameFor, byId } = useCanonicalParties();

  const partyIdParam = searchParams.get("partyId");
  const partyNumParam = searchParams.get("partyNum");

  const canonicalParty = useMemo(
    () => (partyIdParam ? byId.get(partyIdParam) : undefined),
    [partyIdParam, byId],
  );

  const partyNum = useMemo<number | null>(() => {
    if (canonicalParty) {
      const entry = canonicalParty.history.find((h) => h.election === selected);
      return entry?.partyNum ?? null;
    }
    if (partyNumParam) {
      const n = Number(partyNumParam);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }, [canonicalParty, selected, partyNumParam]);

  const partyMpIds = useMemo<Set<number> | null>(() => {
    if (partyIdParam == null && partyNumParam == null) return null;
    if (!candidates) return null;
    const ids = new Set<number>();
    if (partyNum == null) return ids;
    const seenNames = new Set<string>();
    for (const c of candidates) {
      if (c.partyNum !== partyNum) continue;
      if (seenNames.has(c.name)) continue;
      seenNames.add(c.name);
      const mp = findMpByName(c.name);
      if (mp) ids.add(mp.id);
    }
    return ids;
  }, [partyIdParam, partyNumParam, partyNum, candidates, findMpByName]);

  const party = useMemo(
    () => (partyNum == null ? undefined : findParty(partyNum)),
    [partyNum, findParty],
  );

  const label = useMemo<string | null>(() => {
    if (canonicalParty) {
      return i18n.language === "en"
        ? (canonicalParty.displayNameEn ?? canonicalParty.displayName)
        : canonicalParty.displayName;
    }
    if (partyNum == null) return null;
    if (!party) return String(partyNum);
    if (i18n.language === "en") {
      return party.nickName_en || party.nickName || party.name_en || party.name;
    }
    return party.nickName || party.name;
  }, [canonicalParty, partyNum, party, i18n.language]);

  const fullName = useMemo<string | null>(() => {
    if (canonicalParty) {
      const entry = canonicalParty.history.find((h) => h.election === selected);
      if (entry) {
        const name =
          i18n.language === "en" ? (entry.nameEn ?? entry.name) : entry.name;
        if (name) return name;
      }
      return i18n.language === "en"
        ? (canonicalParty.displayNameEn ?? canonicalParty.displayName)
        : canonicalParty.displayName;
    }
    if (partyNum == null) return null;
    if (!party) return String(partyNum);
    if (selected && party.nickName) {
      const canonical = fullNameFor(party.nickName, selected);
      if (canonical) return canonical;
    }
    if (i18n.language === "en") return party.name_en || party.name;
    return party.name;
  }, [canonicalParty, partyNum, party, selected, fullNameFor, i18n.language]);

  const clearedParams = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("partyId");
    next.delete("partyNum");
    return next;
  }, [searchParams]);

  return { partyNum, partyMpIds, party, label, fullName, clearedParams };
};
