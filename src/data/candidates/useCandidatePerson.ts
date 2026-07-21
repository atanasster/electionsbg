// Resolve a /candidate/:id URL param to its owning person's slug so BOTH the id form
// (`/candidate/mp-5229`) and the bare-name form (`/candidate/Мария Балъкчиева`) resolve to
// the same unified person. A slug goes through candidate_person_slug (exact); a bare name
// goes through candidate_person_by_name (unambiguous match only — a >1-namesake name returns
// null and the caller falls back to the legacy render). Shared by the candidate main
// dashboard (CandidateScreen) and the candidate sub-page header (CandidateProfileHeader).
//
// `undefined` = resolving, `null` = no public person (fall back), string = the person slug.

import { useEffect, useState } from "react";

// A candidate slug is `mp-{id}` or `c-…`; anything else (spaces, Cyrillic) is a bare-name
// SEO/legacy URL. The two forms resolve through different lookups.
const CANDIDATE_SLUG_RE = /^(mp-\d+|c-)/;

export const useCandidatePerson = (
  id?: string | null,
): string | null | undefined => {
  const [personSlug, setPersonSlug] = useState<string | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    setPersonSlug(undefined);
    if (!id) {
      setPersonSlug(null);
      return;
    }
    const query = CANDIDATE_SLUG_RE.test(id)
      ? `slug=${encodeURIComponent(id)}`
      : `name=${encodeURIComponent(id)}`;
    fetch(`/api/db/candidate-person?${query}`)
      .then((r) => r.json())
      .then((j: { personSlug: string | null }) => {
        if (live) setPersonSlug(j?.personSlug ?? null);
      })
      .catch(() => live && setPersonSlug(null));
    return () => {
      live = false;
    };
  }, [id]);
  return personSlug;
};
