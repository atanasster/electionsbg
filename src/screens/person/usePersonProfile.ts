// The unified person-identity profile shape (082 person_by_slug) + a fetch hook, shared by
// the two entry routes that render the person dashboard: /person/:slug and (Phase 5)
// /candidate/:id. Kept out of the screen file so it exports only components (react-refresh).

import { useEffect, useState } from "react";

export type ProfileRole = {
  source: string;
  facet: string;
  sourceLabel: string;
  role: string;
  ref: string;
  place: string | null;
  confidence: string;
};
export type ProfileCompany = {
  eik: string;
  name: string | null;
  legalForm: string | null;
  seat: string | null;
  status: string | null;
  roles: string[];
  procuredEur: number | null;
  contracts: number | null;
  fundsEur: number | null;
  fundsPaidEur: number | null;
  fundProjects: number | null;
  subsidiesEur: number | null;
};
export type Sanction = {
  program: string;
  authority: string;
  date: string;
  url: string;
};
export type DsFinding = {
  decisionNo: string;
  decisionDate: string;
  body: string;
  category: string | null;
  pseudonyms: string[];
  url: string;
};
export type RegulatorSeat = {
  body: string;
  seat: string;
  termStart: string | null;
  url: string;
};
export type NgoSeat = {
  eik: string;
  name: string | null;
  legalForm: string | null;
  seat: string | null;
  roles: string[];
};
export type PersonProfile = {
  slug: string;
  name: string;
  namesakeRisk: number;
  isPublicFigure: boolean;
  facets: string[];
  roles: ProfileRole[];
  companies: ProfileCompany[];
  ngos: NgoSeat[];
  procuredEur: number;
  fundsEur: number;
  subsidiesEur: number;
  sanctions: Sanction[];
  ds: DsFinding[];
  regulators: RegulatorSeat[];
  aliases: string[];
};

// Fetch a person profile by slug (or a unique folded name). `undefined` = loading,
// `null` = miss (unknown / review-status / private).
export const usePersonProfile = (
  key: string,
): PersonProfile | null | undefined => {
  const [profile, setProfile] = useState<PersonProfile | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    setProfile(undefined);
    if (!key) {
      setProfile(null);
      return;
    }
    fetch(`/api/db/person-profile?slug=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((j: PersonProfile | null) => {
        if (live) setProfile(j && j.slug ? j : null);
      })
      .catch(() => live && setProfile(null));
    return () => {
      live = false;
    };
  }, [key]);
  return profile;
};
