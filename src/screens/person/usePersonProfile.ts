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
  // The TYPED place (migration 115). `placeKind` names the namespace `placeCode` is in
  // — 'mir' (31 electoral constituencies), 'obshtina' (the app's municipality codes),
  // 'settlement' (an EKATTE code: a кмет на кметство governs a VILLAGE, not the община around
  // it) or 'judicial' (a judicial_body code) — and both labels are resolved server-side (082
  // joins place_dim for mir/obshtina/settlement, judicial_body for judicial), so no consumer
  // needs a code→name dictionary. A settlement's label arrives WITH its type ("с. Безмер").
  // `placeLabelEn` is null for judicial roles — those bodies have no English name — so render
  // with a Bulgarian fallback. `judicialKind` is set for magistrate roles only and drives the
  // Съдия/Прокурор/Следовател heading.
  placeKind: "mir" | "obshtina" | "settlement" | "judicial" | null;
  placeCode: string | null;
  placeLabel: string | null;
  placeLabelEn: string | null;
  judicialKind: string | null;
  confidence: string;
  // When the office was held, as ISO dates, plus WHAT they measure (081 person_role.date_basis).
  // The basis is not decoration: 'term' is the mandate itself, 'election' is the vote that
  // produced it (the oath follows at the constitutive session) and 'filing' is when a
  // встъпителна / при напускане declaration reached the Сметна палата — up to ~30 days after
  // the event, so an upper bound rather than the appointment. Render the phrasing the basis
  // licenses (PersonProfileScreen.termText); a bare range would state all three alike.
  // Null on every role no source has dated yet.
  start: string | null;
  end: string | null;
  dateBasis: "term" | "election" | "filing" | null;
};
export type ProfileCompany = {
  eik: string;
  name: string | null;
  legalForm: string | null;
  seat: string | null;
  status: string | null;
  roles: string[];
  /** HOW this person↔company link was established (082, via person_company_bridge_a).
   *
   *  'declared' = a curated register (declared interests / ИВСС чл.175а) put this COMPANY on
   *  this person. 'name_match' = it was found by folded name alone.
   *
   *  NOT a confirmed identity even when 'declared': the company link is register-sourced, but
   *  the officer row inside it is still matched on (given, family). UI copy must not upgrade
   *  it to "потвърдена самоличност". Optional because a cloud database served by a 082 older
   *  than tr-attribution-basis-v1 omits it — treat absent as 'name_match', never as declared. */
  linkBasis?: "declared" | "name_match";
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
  /** How many DISTINCT people the Commerce Registry records under this person's name fold.
   *
   *  ⚠️ null means UNMEASURED, never 1. The fold was not observed in the TR daily feed's
   *  window (9.4% of folds, a share that GROWS as the CR-Deeds arm widens, since that source
   *  publishes no identity key at all), or this database predates the loader. Rendering null
   *  as "one person" turns an absence of evidence into a reassurance, which is the exact
   *  failure the three-state design exists to prevent. */
  foldPeopleN?: number | null;
  /** 'resolved' = cross-source identity. 'verified' = a Tier-V private owner minted from the
   *  registry by name fold. 'shared_name' = the same mint on a fold the registry says is two
   *  or more people. */
  identityConfidence?: "resolved" | "verified" | "shared_name";
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

/** Does the registry itself say several people share this person's name?
 *
 *  Reads BOTH signals and returns true if EITHER says so, because they are written by
 *  different steps of the same resolve: `fold_people_n` is copied onto every person, while
 *  `identity_confidence = 'shared_name'` is set only on the Tier-V mint. A resolver that
 *  populated one and dropped the other — the `copyRows` / `date_basis` failure class this
 *  repo has shipped before — would otherwise leave the profile card and the browser chip
 *  making different claims about one named person, which tr-attribution-basis-v1 §0.2 calls
 *  the worst bug this family can carry.
 *
 *  Fail-safe by construction: disagreement produces the caveat, never its absence. */
export const isSharedNameIdentity = (p: {
  foldPeopleN?: number | null;
  identityConfidence?: string;
}): boolean =>
  p.identityConfidence === "shared_name" || (p.foldPeopleN ?? 0) > 1;

/** The four states a profile lookup can be in. `missing` and `failed` are DELIBERATELY
 *  distinct, and conflating them is what this type exists to prevent.
 *
 *  The bug it closes: the hook used to map every rejection to `null`, so a 500, a dropped
 *  connection or a non-JSON body was indistinguishable from "no such person" — and
 *  PersonProfileScreen answers `null` with the name-keyed portfolio fallback, which calls
 *  useNoindex(). One blip on /api/db/person-profile while Googlebot was rendering therefore
 *  de-indexed a perfectly good prerendered person page until the next recrawl, with nothing
 *  failing anywhere. That endpoint is documented in CLAUDE.md as having 500'd on prod (a
 *  point lookup full-scanning `person`, fixed in 082), and Google reported the resulting
 *  noindex on pages that resolve fine today.
 *
 *  A failed lookup must therefore never reach a noindex branch: unknown is a fact about the
 *  person, failed is a fact about the request. */
export type PersonProfileState =
  | { status: "loading" }
  | { status: "ok"; profile: PersonProfile }
  | { status: "missing" }
  | { status: "failed" };

// Fetch a person profile by slug (or a unique folded name), distinguishing a miss from a
// failed lookup. An empty key is a `missing` — there is nothing to ask for.
export const usePersonProfileState = (key: string): PersonProfileState => {
  const [state, setState] = useState<PersonProfileState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    if (!key) {
      setState({ status: "missing" });
      return;
    }
    fetch(`/api/db/person-profile?slug=${encodeURIComponent(key)}`)
      .then((r) => {
        // A non-2xx is a failed lookup, not an answer. Without this the route's error body
        // parses as JSON, yields no `slug`, and reads as "no such person".
        if (!r.ok) throw new Error(`person-profile ${r.status}`);
        return r.json();
      })
      .then((j: PersonProfile | null) => {
        if (!live) return;
        // A 200 with a null/slugless body IS the route's way of saying "nobody" — that one
        // is a genuine miss.
        setState(
          j && j.slug ? { status: "ok", profile: j } : { status: "missing" },
        );
      })
      .catch(() => live && setState({ status: "failed" }));
    return () => {
      live = false;
    };
  }, [key]);
  return state;
};

// The original tri-state view, kept for the callers that cannot act on the difference:
// `undefined` = loading, `null` = miss. A failed lookup reads as a miss here, which is safe
// only because none of these callers noindex on it — CandidateScreen and
// CandidateProfileHeader just omit the person block, and PersonContractsScreen falls back to
// filtering by name. The screen that DOES noindex uses usePersonProfileState above.
export const usePersonProfile = (
  key: string,
): PersonProfile | null | undefined => {
  const state = usePersonProfileState(key);
  if (state.status === "loading") return undefined;
  return state.status === "ok" ? state.profile : null;
};
