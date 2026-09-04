// /candidate/:id — kept for its SEO value (the biggest organic-traffic draw), but the body
// is now the shared person dashboard (person-candidate-merge-v1). The candidate slug resolves
// to its person via /api/db/candidate-person; on a hit we render <PersonDashboard> under the
// candidate URL with candidate-framed SEO preserved. NO redirect.
//
// Every branch below exists because the ALTERNATIVE is a page that merges two people. The
// legacy `<Candidate>` body reads the NAME-folder shards (data/{election}/candidates/{NAME}/),
// one folder per name — so for a name held by two people it publishes both their preference
// histories as one person's, at a 200, with nothing saying so. Measured 2026-09-03: 1,478
// name folds cover 4,092 people, and the prerendered indexed candidate family is exactly this
// bare-name form. So the branches are (person-candidate-display-unification-v1 Tier 1):
//
//   ONE person                → the shared dashboard.
//   one person, SHARED name   → the dashboard plus a disclosure: the election picked them out
//                               of several, which is not a choice the reader made.
//   SEVERAL people            → the chooser.
//   a FAILED lookup           → nothing. A request-level fault is not a fact about the name.
//   nobody                    → the legacy body, so no inbound link dead-ends.

import { useParams } from "react-router-dom";
import { SEO } from "@/ux/SEO";
import { useNoindex } from "@/lib/useNoindex";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidatePerson } from "@/data/candidates/useCandidatePerson";
import type { Namesake } from "@/data/candidates/useCandidatePerson";
import { Candidate } from "./components/candidates/Candidate";
import { PersonNamesakeChooser } from "./components/candidates/PersonNamesakeChooser";
import { SharedNameNotice } from "./components/candidates/SharedNameNotice";
import { PersonDashboard } from "./person/PersonProfileScreen";
import { usePersonProfileState } from "./person/usePersonProfile";

/** The chooser is a disambiguation page under a URL whose prerendered head describes ONE
 *  person, and thin content by construction (a name and a list of links). Both reasons point
 *  the same way: give it an honest head of its own and keep it out of the index. The
 *  prerendered HTML still says `index` — a rendering crawler is the only thing that sees
 *  this, which is also the only thing that could be misled by the single-person title. */
const NamesakeChoice = ({
  name,
  people,
}: {
  name: string;
  people: Namesake[];
}) => {
  useNoindex();
  return (
    <div className="w-full">
      <SEO title={name} description={name} />
      <PersonNamesakeChooser name={name} people={people} />
    </div>
  );
};

export const CandidateScreen = () => {
  const { id: name } = useParams();
  const { selected } = useElectionContext();
  // The election narrows a shared name to the person who ran that cycle — the disambiguator
  // the page already holds. Resolving the candidate index client-side first would name the
  // party too, but at the cost of a per-election index fetch for one lookup.
  const { personSlug, namesakes, failed } = useCandidatePerson(name, selected);
  const profile = usePersonProfileState(personSlug ?? "");

  // Still resolving the candidate → person mapping.
  if (personSlug === undefined) return <div className="w-full" />;

  // The lookup itself fell over. Hold the blank rather than mounting the name-keyed body:
  // reading a 500 as "no such person" is how a transient fault publishes a conflation.
  if (failed) return <div className="w-full" />;

  // Resolved to a person: render the shared dashboard under the candidate URL, keeping the
  // candidate-framed <title> so the SEO page is unchanged.
  if (personSlug) {
    if (profile.status === "loading") return <div className="w-full" />;
    if (profile.status === "ok")
      return (
        <div className="w-full">
          {/* Client-side SEO fallback; the authoritative candidate meta is data-driven in
              the prerender (scripts/prerender/dynamicRoutes.ts) and unaffected by this. */}
          <SEO
            title={profile.profile.name}
            description={profile.profile.name}
          />
          {/* ≥2 people on this fold means the ELECTION chose which one to show — a default,
              not a reader's decision. Say so, and offer the others. */}
          {namesakes.length > 1 && (
            <SharedNameNotice
              people={namesakes}
              shownSlug={personSlug}
              election={selected}
            />
          )}
          <PersonDashboard p={profile.profile} />
        </div>
      );
    // `failed` here is a fault on the PROFILE call for a person we already resolved. Same
    // rule as above — never fall through to the body that would merge this name.
    if (profile.status === "failed") return <div className="w-full" />;
  }

  // Several public people answer to this name — say so instead of merging them.
  if (name && namesakes.length > 1)
    return <NamesakeChoice name={name} people={namesakes} />;

  // Fall-through: no public person behind this URL → the legacy candidate render.
  return <div className="w-full">{name && <Candidate name={name} />}</div>;
};
