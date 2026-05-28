// Municipal contact details per município. Empty until the
// update-municipal-contacts skill runs (see
// scripts/officials/municipal_contacts/README.md). Hook returns undefined
// for any município not yet in the index — the tile auto-hides.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type MunicipalContact = {
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  mayor_office_phone?: string;
  council_chair_phone?: string;
  fax?: string;
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

export const useMunicipalContacts = (obshtina?: string | null) => {
  const { data } = useQuery({
    queryKey: ["municipal_contacts"],
    queryFn: fetchContacts,
    staleTime: Infinity,
  });
  if (!obshtina) return { data, contact: undefined };
  let contact = data?.contactsByObshtina[obshtina];
  if (!contact && isSofiaDistrict(obshtina)) {
    contact = data?.contactsByObshtina[SOFIA_CITY_KEY];
  }
  return { data, contact };
};
