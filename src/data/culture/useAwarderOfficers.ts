// The people who DECLARED they work at a given buyer (migration 168).
//
// What it is: a filer's own statement, under their own name and legal
// obligation, that they work at an institution — resolved to an EIK through
// `declaration_employer_link`. What it is NOT: a claim that they signed any
// particular contract, or that they still hold the post. The filing is dated;
// the post is not.
//
// `slug` is null when the person layer has not resolved that filer. That means
// „no profile to link to", never „not a real person" — so a consumer renders the
// name either way and only the LINK is conditional.

import { useQuery } from "@tanstack/react-query";

export interface DeclaredOfficer {
  name: string;
  category: string;
  declaredEmployer: string | null;
  declaredPosition: string | null;
  firstYear: number | null;
  lastYear: number | null;
  filings: number;
  slug: string | null;
}

export interface AwarderOfficers {
  eik: string;
  people: DeclaredOfficer[];
}

export const useAwarderOfficers = (eik: string | null | undefined) =>
  useQuery({
    queryKey: ["db", "awarder-officers", eik] as const,
    enabled: !!eik,
    queryFn: async (): Promise<AwarderOfficers | null> => {
      const r = await fetch(
        `/api/db/awarder-officers?eik=${encodeURIComponent(eik!)}`,
      );
      if (!r.ok) return null;
      return r.json() as Promise<AwarderOfficers>;
    },
    staleTime: Infinity,
  });
