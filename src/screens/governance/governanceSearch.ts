// The /governance finder's sources — pure data, no JSX.
//
// /governance is a HUB OF HUBS: 21 of its 23 tiles point at another hub. So a reader who
// already knows the subject they want („Желязков", „Пътища", „АПИ") has to guess which of
// five bands contains the hub that contains it — two levels of guessing before they can
// type. This box is the way past both.
//
// THREE GROUPS, TWO ROUTES, ONE REQUEST EACH PER KEYSTROKE. `person-search` answers the
// people group; `procurement-search` answers institutions AND companies — and a naive
// second source would issue that call TWICE per keystroke for the same needle, which is the
// duplicated-request defect declarationsSearch.ts records under its removed "officials"
// group. `sharedProcurementSearch` below is the one-line fix: both sources await the SAME
// in-flight promise.
//
// SCOPE RANKS, IT NEVER FILTERS — the hub-level rule. There is no scope on this page to
// filter by, but the same instinct applies to the money: an institution with no contracts
// is still the right answer to somebody typing its name, so nothing here is gated on
// having a figure.

import { Briefcase, Landmark, Users, FileText } from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import type { HubSearchSource } from "@/ux/search/hubSearchSources";
import { decodeEntities } from "@/lib/decodeEntities";
import { isLinkableCompanyKey } from "@/lib/companyKey";
import { positionLabel } from "@/screens/components/procurement/personSearchGroups";

interface NamedEntity {
  eik: string;
  name: string;
  contractsEur?: number;
}
interface ProcurementSearchResponse {
  companies?: NamedEntity[];
  awarders?: NamedEntity[];
  altQuery?: string | null;
}
interface PersonHit {
  key: string;
  name: string;
  position_type: string | null;
  place_label: string | null;
  href: string;
  has_declaration: boolean;
}
interface PersonSearchResponse {
  power?: PersonHit[];
  altQuery?: string | null;
}

/** ONE in-flight `procurement-search` per needle, shared by the two groups that read it.
 *
 *  Keyed by the query rather than cached across queries: the box debounces and aborts, so
 *  the only overlap worth collapsing is the two sources asking for the SAME needle in the
 *  same tick. A stale entry is replaced as soon as the needle changes, so this can never
 *  answer one query with another's rows. */
let inFlight: { q: string; p: Promise<ProcurementSearchResponse> } | null =
  null;

const sharedProcurementSearch = (
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
  inFlight = { q: query, p };
  return p;
};

let lastPersonAlt: { typed: string; alt: string } | null = null;

const fetchPeople = async (
  query: string,
  signal: AbortSignal,
  bg: boolean,
): Promise<SearchItem[]> => {
  const r = await fetch(
    `/api/db/person-search?q=${encodeURIComponent(query)}`,
    { signal },
  );
  if (!r.ok) throw new Error(`person-search: ${r.status}`);
  const body = (await r.json()) as PersonSearchResponse;
  lastPersonAlt = body.altQuery ? { typed: query, alt: body.altQuery } : null;
  return (body.power ?? []).map((p) => ({
    id: p.key,
    to: p.href,
    primary: decodeEntities(p.name),
    // Role and place — what tells two people of the same name apart, and this register is
    // full of them. `position_type` is a CODE; `positionLabel` is the one map, shared with
    // the procurement and declarations boxes so the three cannot disagree.
    secondary:
      [positionLabel(p.position_type, bg), p.place_label]
        .filter(Boolean)
        .map((x) => decodeEntities(String(x)))
        .join(" · ") || undefined,
    icon: p.has_declaration ? FileText : Users,
  }));
};

const fetchAwarders = async (
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

const fetchCompanies = async (
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

export const governanceSearchSources = (bg: boolean): HubSearchSource[] => [
  {
    id: "people",
    label: { bg: "Хора", en: "People" },
    limit: 5,
    kind: "server",
    fetch: (q, s) => fetchPeople(q, s, bg),
    // VERIFIED destination: /persons reads ?q (useUrlPersonFilters). `altQuery` because the
    // browse table runs its own search WITHOUT the shliokavitsa rewrite, so a link built
    // from what was typed advertises rows the destination cannot find.
    seeAll: (q) => ({
      label: bg ? "Виж всички хора" : "See all people",
      to: `/persons?q=${encodeURIComponent(
        lastPersonAlt && lastPersonAlt.typed === q ? lastPersonAlt.alt : q,
      )}`,
    }),
  },
  {
    id: "awarders",
    label: { bg: "Институции", en: "Institutions" },
    limit: 4,
    kind: "server",
    fetch: fetchAwarders,
    // No see-all: there is no awarders browse page that reads ?q, and a link advertising a
    // filtered destination that delivers an unfiltered one is worse than none (§4).
  },
  {
    id: "companies",
    label: { bg: "Фирми", en: "Companies" },
    limit: 4,
    kind: "server",
    fetch: fetchCompanies,
    seeAll: (q) => ({
      label: bg ? "Виж всички фирми" : "See all companies",
      // ?pscope=all: the browse table defaults to the selected parliament's window, so a
      // company whose contracts predate it would land on zero rows.
      to: `/procurement/contractors?q=${encodeURIComponent(q)}&pscope=all`,
    }),
  },
];
