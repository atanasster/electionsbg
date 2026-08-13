// Companies registered at a place that a person in public life holds a registry role in —
// live from Postgres (/api/db/place-mp-companies, migration 151). Backs the paginated
// /settlement/:id/companies + /sofia/companies screen.
//
// Replaces the static `parliament/companies-by-{ekatte,obshtina}/` shard families (646 files,
// 307 places). Those matched an MP NAME against TR officers with no people-per-name guard;
// this reads the gated `person_role` set, so it covers 1,332 settlements and 260
// municipalities — and every row names a resolved person with a /person slug rather than a
// name that happened to match.
//
// ONE hook where there were two. The shards shipped `{id}-summary.json` (top-5 + counts) and
// `{id}-page-NNN.json` separately, which is two fetches and two chances to disagree about
// `count`; the route differs only in `pageSize`, so a caller that wants the teaser asks for a
// small page and reads the same counts.

import { useQuery } from "@tanstack/react-query";

/** A person in public life holding a registry role at this company. */
export type CompaniesHqPerson = {
  slug: string;
  name: string;
  /** Every capacity this person holds at this company ("manager", "sole_owner", …).
   *  An ARRAY because 53.1% of (company, person) pairs hold more than one, and a client-side
   *  dedupe by slug over one-row-per-role silently dropped the others. */
  roles: string[];
};

export type CompaniesHqRow = {
  uic: string;
  name: string;
  legalForm: string | null;
  status: string | null;
  /** Public money (contracts ∪ subsidies ∪ funds), 0 when none. */
  moneyEur: number;
  people: CompaniesHqPerson[];
};

export type CompaniesHqPage = {
  /** Qualifying companies in the whole place, not on this page. */
  count: number;
  /** DISTINCT people across the whole place — stable as the reader pages. */
  personCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  companies: CompaniesHqRow[];
};

/** Place key — numeric EKATTE (`"56784"`, settlement view) OR an obshtina code (`"PDV22"`,
 *  municipality view). Sofia's `SFO_CITY` and the 24 `S####` rayon codes are accepted too. */
export type CompaniesHqPlace =
  | { kind: "ekatte"; ekatte: string | undefined }
  | { kind: "muni"; obshtina: string | undefined };

const placeParam = (p: CompaniesHqPlace): string =>
  p.kind === "ekatte"
    ? `ekatte=${encodeURIComponent(p.ekatte ?? "")}`
    : `obshtina=${encodeURIComponent(p.obshtina ?? "")}`;

const placeId = (p: CompaniesHqPlace): string | undefined =>
  p.kind === "ekatte" ? p.ekatte : p.obshtina;

const fetchPage = async (
  place: CompaniesHqPlace,
  page: number,
  pageSize: number,
): Promise<CompaniesHqPage | null> => {
  const r = await fetch(
    `/api/db/place-mp-companies?${placeParam(place)}&page=${page}&pageSize=${pageSize}`,
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`db fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as CompaniesHqPage | null;
};

export const useCompaniesHqPage = (
  place: CompaniesHqPlace,
  page: number,
  pageSize = 50,
) => {
  const id = placeId(place);
  return useQuery({
    queryKey: [
      "place-mp-companies",
      place.kind,
      id ?? "",
      page,
      pageSize,
    ] as const,
    queryFn: () => fetchPage(place, page, pageSize),
    enabled: !!id && page >= 1,
    staleTime: Infinity,
  });
};
