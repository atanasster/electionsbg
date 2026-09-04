// The disclosure above a person dashboard served under a SHARED bare-name candidate URL.
//
// `candidate_person_by_name` resolves 385 folds where the name really is several public
// people (up to 9 on one fold) and exactly one of them stood in the cycle the page is
// showing. Without this line the page asserts a single identity — declarations, assets,
// connections, procurement — under a URL that means all of them, picked out by a DEFAULT
// (`?elections=` falls back to the newest cycle) rather than by anything the reader chose.
// See docs/plans/person-candidate-display-unification-v1.md §1.1.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import type { Namesake } from "@/data/candidates/useCandidatePerson";
import { dottedDate } from "@/data/utils";

export const SharedNameNotice: FC<{
  people: Namesake[];
  /** The person the page is currently showing — excluded from the "others" list. */
  shownSlug: string;
  /** The cycle that picked them. */
  election: string;
}> = ({ people, shownSlug, election }) => {
  const { t } = useTranslation();
  const others = people.filter((p) => p.personSlug !== shownSlug);
  if (others.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-2.5 text-sm">
      <span className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
        <Users className="h-4 w-4" />
        {t("shared_name_notice", {
          count: others.length,
          date: dottedDate(election),
        })}
      </span>
      {/* Named links, not a count: the whole point is that the reader can reach the person
          they actually meant. The МИР of each one's latest candidacy is what tells them
          apart — two namesakes routinely share a party. */}
      <span className="flex flex-wrap gap-x-2 gap-y-1">
        {others.map((p) => (
          <Link
            key={p.personSlug}
            to={`/person/${p.personSlug}`}
            className="text-primary hover:underline"
          >
            {p.displayName} ({dottedDate(p.latestElection)})
          </Link>
        ))}
      </span>
    </div>
  );
};
