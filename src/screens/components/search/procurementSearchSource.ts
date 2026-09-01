// The ONE `/api/db/procurement-search` request, and the two normalizers over it.
//
// WHY IT IS SHARED. That endpoint answers institutions AND companies from a single call, so
// any hub offering both groups issues it TWICE per keystroke for the same needle unless the
// two sources await the same promise. `governanceSearch.ts` solved that inside itself; the
// global home offers the same two groups, so a second private copy would put the duplicate
// back — one per hub rather than one per group, which is the same defect with a longer
// fuse. Extracted here so there is one in-flight map for the whole app.
//
// ⚠️ KEYED BY THE QUERY, NOT CACHED ACROSS QUERIES. The box debounces and aborts, so the
// only overlap worth collapsing is two sources asking for the SAME needle in the same tick.
// A stale entry is replaced as soon as the needle changes, so this can never answer one
// query with another's rows.

import { Briefcase, Landmark } from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import { decodeEntities } from "@/lib/decodeEntities";
import { isLinkableCompanyKey } from "@/lib/companyKey";

export interface NamedProcurementEntity {
  eik: string;
  name: string;
  contractsEur?: number;
}

export interface ProcurementSearchResponse {
  companies?: NamedProcurementEntity[];
  awarders?: NamedProcurementEntity[];
  altQuery?: string | null;
}

let inFlight: { q: string; p: Promise<ProcurementSearchResponse> } | null =
  null;

export const sharedProcurementSearch = (
  query: string,
  signal: AbortSignal,
): Promise<ProcurementSearchResponse> => {
  if (inFlight?.q === query) return inFlight.p;
  const p = fetch(`/api/db/procurement-search?q=${encodeURIComponent(query)}`, {
    signal,
  }).then((r) => {
    // Throw rather than degrade: HubSearch tells a failed group from an empty one and drops
    // it from its „searched in: …" line. Swallowing would report our outage as an absence.
    if (!r.ok) throw new Error(`procurement-search: ${r.status}`);
    return r.json() as Promise<ProcurementSearchResponse>;
  });
  const entry = { q: query, p };
  inFlight = entry;
  // ⚠️ A SETTLED FAILURE IS EVICTED, AND WITHOUT THIS THE CACHE POISONS A NEEDLE FOR EVER.
  // A rejection — a 500, or the abort `HubSearch` fires on EVERY keystroke — would stay
  // cached under its query, so backspacing to a just-aborted needle returns the rejected
  // promise and never re-issues the request. Both groups then vanish, AND their names
  // vanish from „Няма съвпадения в: …", which is the outage-reported-as-absence failure
  // this module's own header forbids. Only the entry we installed is cleared, so a newer
  // query's entry is never removed by an older one's rejection.
  p.catch(() => {
    if (inFlight === entry) inFlight = null;
  });
  return p;
};

/** TEST ONLY — clears the in-flight entry so one case cannot answer the next. */
export const __resetProcurementSearchCache = (): void => {
  inFlight = null;
};

export const fetchProcurementAwarders = async (
  query: string,
  signal: AbortSignal,
): Promise<SearchItem[]> =>
  (await sharedProcurementSearch(query, signal)).awarders?.map((a) => ({
    id: `awarder-${a.eik}`,
    to: `/awarder/${a.eik}`,
    primary: decodeEntities(a.name),
    secondary: a.eik,
    amountEur: a.contractsEur,
    icon: Landmark,
  })) ?? [];

export const fetchProcurementCompanies = async (
  query: string,
  signal: AbortSignal,
): Promise<SearchItem[]> =>
  (await sharedProcurementSearch(query, signal)).companies
    // ⚠ A link promises somewhere to go. `contractor_eik` carries synthetic keys — `ph-`
    // (a filler registration number) and `np-` (a natural person keyed by name) — which
    // render a page but name nothing anybody can check against a register.
    // `isLinkableCompanyKey` is the one predicate for that, and it deliberately KEEPS
    // `obed-` consortium carriers, whose page is the only route from a joint bid to the
    // firms behind it.
    ?.filter((c) => isLinkableCompanyKey(c.eik))
    .map((c) => ({
      id: `company-${c.eik}`,
      to: `/company/${c.eik}`,
      primary: decodeEntities(c.name),
      secondary: c.eik,
      amountEur: c.contractsEur,
      icon: Briefcase,
    })) ?? [];
