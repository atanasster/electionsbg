// Municipal contact details per município. Empty until the
// update-municipal-contacts skill runs (see
// scripts/officials/municipal_contacts/README.md). Hook returns undefined
// for any município not yet in the index — the tile auto-hides.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type MunicipalOfficialContact = {
  role: "mayor" | "deputy_mayor" | "other";
  roleRaw: string;
  name: string;
  email: string;
};

export type MunicipalContact = {
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  mayor_office_phone?: string;
  council_chair_phone?: string;
  fax?: string;
  /** Mayor full name (iisda's spelling) — used to disambiguate when the
   *  CACBG roster carries a slightly different transliteration. */
  mayor?: string;
  /** Per-person contacts scraped from the iisda detail page: mayor +
   *  every "Заместник-кмет" block. Sofia's SOF00 entry carries the
   *  city-wide mayor + deputies; individual районы don't have their
   *  own entry yet. */
  officials?: MunicipalOfficialContact[];
};

export type MunicipalContactsFile = {
  source: string;
  indexName: string;
  contactsByObshtina: Record<string, MunicipalContact>;
  note?: string;
};

const fetchContacts = async (): Promise<MunicipalContactsFile> => {
  const r = await fetch(dataUrl("/officials/municipal_contacts/index.json"));
  if (!r.ok) throw new Error("municipal contacts fetch failed");
  return r.json();
};

// Sofia's citywide kmet contact is keyed under SOF00 — the 24 районы
// (S23xx/S24xx/S25xx) share that contact. Mirrors the useIndicators /
// useSchools fallback pattern.
const SOFIA_CITY_KEY = "SOF00";
const isSofiaDistrict = (obshtina: string): boolean =>
  /^S2[3-5]\d{2}$/i.test(obshtina);

// Loose name match: uppercase + collapse whitespace. The CACBG roster
// and iisda spell the same person identically in ~all cases; this is
// only here to absorb stray double-spaces or trailing whitespace.
const normName = (s: string): string =>
  s.normalize("NFC").toLocaleUpperCase("bg").replace(/\s+/g, " ").trim();

// Secondary key: first three tokens, with each token's hyphenated suffix
// stripped ("Дончева-Терзийска" → "Дончева"). Covers the case where one
// register has the maiden name and the other has the married/hyphenated
// form — common enough that we hit ~1-2 deputy mayors per município
// where the CACBG declaration and the iisda registry disagree.
const nameStem = (s: string): string =>
  normName(s)
    .split(" ")
    .slice(0, 3)
    .map((tok) => tok.split("-")[0])
    .join(" ");

export const useMunicipalContacts = (obshtina?: string | null) => {
  const { data } = useQuery({
    queryKey: ["municipal_contacts"],
    queryFn: fetchContacts,
    staleTime: Infinity,
  });
  const contact = useMemo(() => {
    if (!obshtina) return undefined;
    let c = data?.contactsByObshtina[obshtina];
    if (!c && isSofiaDistrict(obshtina)) {
      c = data?.contactsByObshtina[SOFIA_CITY_KEY];
    }
    return c;
  }, [data, obshtina]);

  // emailByName + emailByStem: normalized full name → email, with a
  // fallback keyed on the first-three-tokens hyphen-stripped stem so
  // "Дончева" matches an iisda "Дончева-Терзийска" entry. Sofia районы
  // fall through to SOF00, which means a районен kmet's name won't
  // match — the lookup just returns undefined and the UI omits the icon.
  const { emailByName, emailByStem } = useMemo(() => {
    const byName = new Map<string, string>();
    const byStem = new Map<string, string>();
    for (const p of contact?.officials ?? []) {
      byName.set(normName(p.name), p.email);
      byStem.set(nameStem(p.name), p.email);
    }
    return { emailByName: byName, emailByStem: byStem };
  }, [contact]);

  const emailForName = (name?: string | null): string | undefined => {
    if (!name) return undefined;
    return emailByName.get(normName(name)) ?? emailByStem.get(nameStem(name));
  };

  return { data, contact, emailForName };
};
