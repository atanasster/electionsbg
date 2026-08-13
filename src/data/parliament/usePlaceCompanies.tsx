// Companies REGISTERED at a place, live from Postgres (/api/db/place-companies,
// migration 133). Backs `PlaceCompaniesTile` on the settlement / municipality
// governance dashboards.
//
// This replaces the static MP-linked shards (useCompaniesAtSettlement) as the
// tile's source. Those only ever listed a company when an MP's NAME matched one
// of its officers, which is how a village of 46 companies came to show exactly
// one — the wrong one. Here the place is the question and the political link is
// an ANSWER the row may or may not carry.

import { useQuery } from "@tanstack/react-query";

export type PlaceCompanyOfficer = {
  name: string;
  /** Comma-joined TR role vocabulary, e.g. "manager,sole_owner". */
  roles: string | null;
};

export type PlaceCompanyPolitician = {
  name: string;
  /** In-app href of the politician (e.g. "/candidate/mp-5113"). */
  ref: string;
  kind: string;
  role: string | null;
};

export type PlaceCompany = {
  uic: string;
  name: string;
  legalForm: string | null;
  status: string | null;
  /** Public money (contracts ∪ subsidies ∪ funds), 0 when none. */
  moneyEur: number;
  officers: PlaceCompanyOfficer[];
  politicians: PlaceCompanyPolitician[];
};

export type PlaceCompanies = {
  /** Companies we can PLACE here — see the coverage caveat in migration 133. */
  count: number;
  moneyCount: number;
  politicalCount: number;
  /** Companies here held by a public figure — the predicate /settlement/:id/companies pages,
   *  and NOT a superset of politicalCount despite reading like one. Optional so a database
   *  serving a 133 older than this field simply hides the link. */
  personLinkCount?: number;
  companies: PlaceCompany[];
};

/** Settlement (numeric EKATTE) or municipality (obshtina code, e.g. "VID33"). */
export type PlaceKey =
  | { kind: "ekatte"; ekatte: string | undefined }
  | { kind: "muni"; obshtina: string | undefined };

const queryFn = async (
  place: PlaceKey,
  limit: number,
): Promise<PlaceCompanies | null> => {
  const param =
    place.kind === "ekatte"
      ? `ekatte=${encodeURIComponent(place.ekatte ?? "")}`
      : `obshtina=${encodeURIComponent(place.obshtina ?? "")}`;
  const r = await fetch(`/api/db/place-companies?${param}&limit=${limit}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`db fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as PlaceCompanies | null;
};

export const usePlaceCompanies = (place: PlaceKey, limit = 5) => {
  const id = place.kind === "ekatte" ? place.ekatte : place.obshtina;
  return useQuery({
    queryKey: ["place-companies", place.kind, id ?? "", limit] as const,
    queryFn: () => queryFn(place, limit),
    enabled: !!id,
    staleTime: Infinity,
  });
};
