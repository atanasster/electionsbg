// „Кой ръководи" — T2.3. The directors of the state cultural institutes, each
// beside the institution THEY named in their own filing.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THE CAREFUL PART IS WHAT THE SENTENCE CLAIMS, and it is one word from claiming
// too much. Rendered here: „X declared they work at Y" — a filing under the
// declarant's own name and legal obligation. NOT rendered: that X signed any
// contract Y awarded, or that X still holds the post. The filing carries a year;
// the post does not.
//
// So the declarant's OWN words for their employer and position are shown
// verbatim, and the institution's registry name is not substituted for them —
// `feedback_name_match_not_identity`, applied to the half of this that IS a name
// match (employer string → EIK; the person↔employer half is self-reported).
//
// A director with no `/person` profile still appears, unlinked: a missing slug
// means the person layer has not resolved that filer, never that the person is
// not real. Dropping the row would silently narrow a register of named public
// officials to the ones our resolver happened to reach.
// ═══════════════════════════════════════════════════════════════════════════════

import { FC } from "react";
import { Link } from "react-router-dom";
import { useAwarderOfficers } from "@/data/culture/useAwarderOfficers";

export const CultureDirectorsSection: FC<{
  eik: string;
  name: string;
  bg: boolean;
}> = ({ eik, name, bg }) => {
  const { data } = useAwarderOfficers(eik);
  // Filtered on the declarant's OWN stated position, not on the register's
  // `category` — which is the same rule this whole plan keeps re-learning, and
  // the first cut broke it here too.
  //
  // `category` is a register GROUP label. Filtering on `cultural_institute`
  // looked right and hid the directors of the Национален исторически музей,
  // НИНКН, НУТИ София and НУМСИ Стара Загора — and because every art-school
  // filing is filed under „school", that entire tier showed ZERO directors on
  // the page whose reason for existing is that the tier was invisible.
  //
  // „Директор" is what a director writes. Matched case-insensitively because the
  // register holds „ДИРЕКТОР", „Директор" and „Директор НИНКН"; anchored to the
  // start so „Заместник-директор" does not read as the head of the institution.
  const directors = (data?.people ?? []).filter((p) =>
    /^\s*директор/i.test(p.declaredPosition ?? ""),
  );
  if (!directors.length) return null;

  return (
    <li className="rounded-xl border bg-card p-4">
      <Link to={`/awarder/${eik}`} className="font-medium hover:underline">
        {name}
      </Link>
      <ul className="mt-2 space-y-1 text-sm">
        {directors.map((d) => (
          <li
            key={`${d.name}-${d.lastYear}`}
            className="flex flex-wrap items-baseline gap-x-2"
          >
            {d.slug ? (
              <Link to={`/person/${d.slug}`} className="hover:underline">
                {d.name}
              </Link>
            ) : (
              <span>{d.name}</span>
            )}
            {d.declaredPosition && (
              <span className="text-muted-foreground">
                — {d.declaredPosition}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {bg ? "декларация" : "declaration"}{" "}
              {d.firstYear === d.lastYear
                ? d.lastYear
                : `${d.firstYear}–${d.lastYear}`}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
};
