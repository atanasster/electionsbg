// „Управа на ЮЛНЦ" — the civic-board facet of a person's Commerce-Registry footprint,
// distinct from the business companies PersonCompanies renders.
//
// Extracted from PersonProfileScreen so the rule below is testable in isolation, which is
// how every other block on that page is built.
//
// IT CARRIES THE SAME BASIS MARK AS THE COMPANIES LIST, AND THAT IS THE POINT. An NGO board
// seat bridges exactly like a company officership — `person_resolve.data.test.ts` carries one
// licensing invariant for both facets, and `resolve_persons.ts` attaches them from the same
// `hits` CTE, splitting on role only to choose the `source` value. So a page that marks a
// name-matched company „по име" and renders a name-matched board seat bare is publishing two
// different confidences for one rule — the drift LinkBasisMark's header calls the worst defect
// this family can carry, in its worse direction: one surface had no mark at all.
//
// Measured 2026-08-25, before this shipped: 5,670 of 5,727 board seats (4,887 of 4,927 people)
// rest on a folded name and were rendered with no mark and no caveat, directly beneath a
// companies list that marked every row of its own. Only 57 seats are register-confirmed.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { HeartHandshake } from "lucide-react";
import { LinkBasisMark } from "@/screens/components/LinkBasisMark";
import { isNameMatch, NAMESAKE_FALLBACK } from "@/screens/components/linkBasis";
import { NameMatchDisclosure } from "@/screens/components/NameMatchDisclosure";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { decodeEntities } from "@/lib/decodeEntities";
import { trRoleLabel } from "@/lib/trRole";
import type { NgoSeat } from "./usePersonProfile";

export const PersonNgoSeats: FC<{
  ngos: NgoSeat[];
  /** Distinct registry people on this person's fold; null/undefined = unmeasured. */
  foldPeopleN?: number | null;
}> = ({ ngos, foldPeopleN }) => {
  const { t } = useTranslation();
  if (ngos.length === 0) return null;

  // Hoisted above the map: one claim, resolved once, and identical to the one PersonCompanies
  // puts on its own rows — both read NAMESAKE_FALLBACK so the two tooltips cannot drift.
  const namesake = t("person_namesake_disclosure", {
    defaultValue: NAMESAKE_FALLBACK,
  });

  return (
    <DashboardSection
      id="person-ngos"
      title={t("pp_ngos")}
      icon={HeartHandshake}
    >
      <Card>
        <CardContent className="space-y-2 pt-6">
          {ngos.map((n) => (
            <div
              key={n.eik}
              className="border-b border-border/50 pb-2 last:border-0 last:pb-0"
            >
              <span className="text-sm">
                <Link
                  to={`/company/${n.eik}`}
                  className="font-medium text-primary hover:underline"
                >
                  {n.name ? decodeEntities(n.name) : n.eik}
                </Link>
                {/* Read through the shared `isNameMatch`, so this block and the companies
                    list cannot decide the same claim from different rules — and so an
                    ABSENT basis (a cloud database on an 082 older than this change) reads
                    as a name match rather than as declared. A 'declared' seat carries no
                    mark: that is the absence of a caveat, not a "confirmed" badge, since
                    the curated register put the ORGANISATION on this person and the officer
                    row inside it is still matched on name. */}
                {isNameMatch(n.linkBasis) && <LinkBasisMark label={namesake} />}
                <span className="block text-xs text-muted-foreground">
                  {n.roles.map((r) => trRoleLabel(r, t)).join(", ")}
                </span>
              </span>
            </div>
          ))}
          {/* Conditional for the reason PersonCompanies' copy is: rendering it over a block
              whose every seat is register-confirmed tells those people their own records
              might belong to somebody else. */}
          {ngos.some((n) => isNameMatch(n.linkBasis)) && (
            <NameMatchDisclosure foldPeopleN={foldPeopleN} />
          )}
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
