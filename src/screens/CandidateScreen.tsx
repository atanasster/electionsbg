// /candidate/:id — kept for its SEO value (the biggest organic-traffic draw), but the body
// is now the shared person dashboard (person-candidate-merge-v1). The candidate slug resolves
// to its person via /api/db/candidate-person; on a hit we render <PersonDashboard> under the
// candidate URL with candidate-framed SEO preserved. A miss (bare-name URL, private/review
// person, unknown slug) falls through to the legacy <Candidate> render + its namesake chooser,
// so no inbound link dead-ends. NO redirect.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SEO } from "@/ux/SEO";
import { Candidate } from "./components/candidates/Candidate";
import { PersonDashboard } from "./person/PersonProfileScreen";
import { usePersonProfile } from "./person/usePersonProfile";

// Resolve a candidate slug (c-{party}-… | mp-{id}) to its owning person's slug.
// `undefined` = resolving, `null` = no public person (fall through), string = the person slug.
const useCandidatePerson = (id?: string): string | null | undefined => {
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
    fetch(`/api/db/candidate-person?slug=${encodeURIComponent(id)}`)
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

export const CandidateScreen = () => {
  const { id: name } = useParams();
  const personSlug = useCandidatePerson(name);
  const profile = usePersonProfile(personSlug ?? "");

  // Still resolving the candidate → person mapping.
  if (personSlug === undefined) return <div className="w-full" />;

  // Resolved to a person: render the shared dashboard under the candidate URL, keeping the
  // candidate-framed <title> so the SEO page is unchanged.
  if (personSlug) {
    if (profile === undefined) return <div className="w-full" />;
    if (profile)
      return (
        <div className="w-full">
          {/* Client-side SEO fallback; the authoritative candidate meta is data-driven in
              the prerender (scripts/prerender/dynamicRoutes.ts) and unaffected by this. */}
          <SEO title={profile.name} description={profile.name} />
          <PersonDashboard p={profile} />
        </div>
      );
  }

  // Fall-through: bare-name URL / private / unknown → the legacy candidate render.
  return <div className="w-full">{name && <Candidate name={name} />}</div>;
};
