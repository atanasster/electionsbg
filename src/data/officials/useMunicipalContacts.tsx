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

export const useMunicipalContacts = (obshtina?: string | null) => {
  const { data } = useQuery({
    queryKey: ["municipal_contacts"],
    queryFn: fetchContacts,
    staleTime: Infinity,
  });
  const contact = obshtina ? data?.contactsByObshtina[obshtina] : undefined;
  return { data, contact };
};
