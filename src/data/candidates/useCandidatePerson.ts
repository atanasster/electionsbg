// Resolve a /candidate/:id URL param to its owning person so BOTH the id form
// (`/candidate/mp-5229`) and the bare-name form (`/candidate/Мария Балъкчиева`) reach the
// same unified person dashboard. A slug goes through candidate_person_slug (exact); a bare
// name goes through candidate_person_by_name, narrowed by the ELECTION the page is already
// showing. Shared by the candidate main dashboard (CandidateScreen) and the candidate
// sub-page header (CandidateProfileHeader).
//
// When a name still names more than one public person the API returns that SET instead of a
// slug, so the caller can offer a choice rather than falling through to the legacy body —
// which reads the name-folder shards and merges both people's history onto one page.
// Measured 2026-09-03: 1,478 name folds / 4,092 people were in that state, and the
// prerendered indexed candidate family is the bare-name form, so this is the majority URL
// shape rather than an edge case.
//
// `personSlug`: `undefined` = resolving, `null` = no single public person (check
// `namesakes`), string = the person slug.

import { useEffect, useState } from "react";

// A candidate slug is `mp-{id}` or `c-…`; anything else (spaces, Cyrillic) is a bare-name
// SEO/legacy URL. The two forms resolve through different lookups.
const CANDIDATE_SLUG_RE = /^(mp-\d+|c-)/;

export type NamesakeCandidacy = {
  election: string;
  partyNum: number | null;
  partyNick: string | null;
  partyColor: string | null;
  candidateSlug: string;
  totalVotes: number | null;
  /** МИР of that candidacy's strongest region — the field that tells two same-named
   *  politicians apart when they also share a party. NULL for a roster-only candidacy. */
  oblast: string | null;
};

export type Namesake = {
  personSlug: string;
  displayName: string;
  latestElection: string;
  candidacies: NamesakeCandidacy[];
};

export type CandidatePersonResolution = {
  /** `undefined` while resolving, `null` for no single public person. */
  personSlug: string | null | undefined;
  /** Every public person on this name fold — the same set with two meanings, read against
   *  `personSlug`. With no slug and ≥2 entries it is a CHOICE; WITH a slug and ≥2 entries it
   *  is a DISCLOSURE that the URL is shared and the election picked this person out of it
   *  (a >1 fold cannot resolve without the election, so that combination IS "the election
   *  chose"). Empty for a candidate-slug URL, which is party-unique by construction. */
  namesakes: Namesake[];
  /** The lookup itself FAILED (a non-2xx, a dead pool, an offline dev server) — distinct
   *  from `personSlug: null`, which is an answer. A caller must not read a failure as "no
   *  such person": for a shared name that sends the page to the legacy name-keyed body,
   *  which merges two people's shards onto one page at a 200. */
  failed: boolean;
};

const EMPTY: Namesake[] = [];

export const useCandidatePerson = (
  id?: string | null,
  /** The cycle the page is showing (`ElectionContext.selected`). Narrows a shared name to
   *  the person who ran that year — the disambiguator the page always holds, unlike the
   *  party, which is only known after resolving the candidate index. */
  election?: string | null,
): CandidatePersonResolution => {
  const [personSlug, setPersonSlug] = useState<string | null | undefined>(
    undefined,
  );
  const [namesakes, setNamesakes] = useState<Namesake[]>(EMPTY);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setPersonSlug(undefined);
    setNamesakes(EMPTY);
    setFailed(false);
    if (!id) {
      setPersonSlug(null);
      return;
    }
    const query = CANDIDATE_SLUG_RE.test(id)
      ? `slug=${encodeURIComponent(id)}`
      : `name=${encodeURIComponent(id)}` +
        (election ? `&election=${encodeURIComponent(election)}` : "");
    fetch(`/api/db/candidate-person?${query}`)
      .then((r) => {
        // A non-2xx is a failed lookup, not an answer — the same rule
        // `usePersonProfileState` records. Its error body parses as JSON, yields no
        // `personSlug`, and would read as "this name is nobody".
        if (!r.ok) throw new Error(`candidate-person ${r.status}`);
        return r.json();
      })
      .then((j: { personSlug: string | null; namesakes?: Namesake[] }) => {
        if (!live) return;
        setPersonSlug(j?.personSlug ?? null);
        setNamesakes(j?.namesakes?.length ? j.namesakes : EMPTY);
      })
      .catch(() => {
        if (!live) return;
        setPersonSlug(null);
        setNamesakes(EMPTY);
        setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [id, election]);
  return { personSlug, namesakes, failed };
};
