// „Рискови гласове" on a presidential PLACE page — region, municipality and settlement.
//
// ⚠⚠ IT EXISTS BECAUSE THE PARLIAMENTARY DASHBOARD HAS IT AT EVERY LEVEL AND THIS FAMILY HAD IT
// AT NONE. `/region/PDV-00` and `/municipality/PDV22` are the pages a reader lands on when they
// care about Столипиново, and until now the eight districts were visible only from the country
// page — so the question „how did the flagged neighbourhoods here vote" had an answer on one
// ballot and not on the other.
//
// ⚠⚠ THE SECTIONS ARE FILTERED, AND SO IS EVERY SHARE UNDER THEM. `scopeNeighborhoods` divides
// „дял от проблемните гласове" by the districts in THIS place; showing the artifact's national
// shares beneath a filtered table would publish the country's answer under a place's name. The
// producer emits `places[].tickets` for exactly this.
//
// ⚠ NOTHING HERE IS THE COMMON CASE. Eight districts sit in five oblasts and four municipalities
// — and Sofia's two carry no municipality or ЕКАТТЕ at all, because the placement pass refuses
// their stations — so ~26 of 31 region pages and ~269 of 273 municipality pages render nothing.
// The section self-hides rather than saying „no risky districts here", which reads as a finding
// about a place nobody screened.
//
// ⚠ BOTH ROUNDS, LABELLED. The eight districts are the same places in both, but the protocols
// are not — 2021's runoff turnout there is 20.5% against 23.9% in round 1 — and the place page
// above this already publishes both rounds' results. One section holds them rather than two:
// `DashboardSection` renders `id` into the DOM, so a second one would duplicate an id and make
// both landmarks announce the first.
//
// ⚠ OUTSIDE THE SURFACE BOUNDARY, like `PresidentialPlaceTransfer` and for the same reason: the
// districts artifact and the place surface are different files with different publish paths, so
// a place whose surface has not shipped can still have this, and gating one on the other would
// hide a file that is there.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import {
  hasNeighborhoodContent,
  usePresidentialNeighborhoods,
  type PresidentialNeighborhoods,
} from "@/data/presidential/useNeighborhoods";
import {
  hasScopedContent,
  scopeNeighborhoods,
  type NeighborhoodScope,
  type ScopedNeighborhoods,
} from "@/data/presidential/neighborhoodScope";
import { PresidentialProblemSectionsTile } from "./PresidentialProblemSectionsTile";
import { PresidentialProblemVotesTile } from "./PresidentialProblemVotesTile";
import type { PresidentialPlaceLevel } from "./PresidentialPlaceScreen";

/** ⚠ THE THREE LEVELS THE ARTIFACT CAN ANSWER FOR. A section IS one polling station, so „the
 *  districts in this station" is not a question; and no catalogued district is abroad. */
const SCOPED_LEVELS = new Set<PresidentialPlaceLevel>([
  "region",
  "municipality",
  "settlement",
]);

const scopeFor = (
  level: PresidentialPlaceLevel,
  id: string | undefined,
): NeighborhoodScope | null =>
  id && SCOPED_LEVELS.has(level) ? ({ level, id } as NeighborhoodScope) : null;

export const PresidentialPlaceNeighborhoods: FC<{
  cycle: string;
  level: PresidentialPlaceLevel;
  /** ⚠ THE HOOKS BELOW ARE CALLED AT EVERY LEVEL — React hook order — and are simply scoped
   *  away where there is nothing to answer. */
  id: string | undefined;
}> = ({ cycle, level, id }) => {
  const { t } = useTranslation();
  const scope = scopeFor(level, id);
  // ⚠ BOTH ROUNDS, UNCONDITIONALLY. React Query dedupes these against nothing else on the page,
  // and a place with no district resolves them to `absent` at the cost of two 404s the country
  // page already makes on every cycle whose tree has not shipped.
  const r1 = usePresidentialNeighborhoods(scope ? cycle : undefined, 1);
  const r2 = usePresidentialNeighborhoods(scope ? cycle : undefined, 2);
  const tickets = useTicketsByNumber(scope ? cycle : "");

  if (!scope) return null;

  const readable = (s: typeof r1): PresidentialNeighborhoods | null =>
    s.status === "ready" && hasNeighborhoodContent(s.neighborhoods)
      ? s.neighborhoods
      : null;

  const rounds: {
    round: 1 | 2;
    scoped: ScopedNeighborhoods;
    n: PresidentialNeighborhoods;
  }[] = [];
  for (const [round, state] of [
    [1, r1],
    [2, r2],
  ] as const) {
    const n = readable(state);
    if (!n) continue;
    const scoped = scopeNeighborhoods(n, scope);
    // ⚠ THE TILES' OWN PREDICATE, so the section can never be the thing that keeps an empty
    // heading standing — the rule the country page's own gate follows.
    if (hasScopedContent(scoped)) rounds.push({ round, scoped, n });
  }
  if (!rounds.length) return null;

  return (
    <DashboardSection
      id="neighborhoods"
      title={t("dashboard_section_neighborhoods")}
      icon={Building2}
      headingLevel={2}
    >
      {rounds.map(({ round, scoped, n }) => (
        <div key={round} className="space-y-4">
          {/* ⚠ THE ROUND IS NAMED WHENEVER THERE IS MORE THAN ONE. Two identical-looking pairs
              of tables with no label between them is the state that makes a reader quote the
              runoff's figure as round one's. */}
          {rounds.length > 1 ? (
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("election_round", { round })}
            </h3>
          ) : null}
          <PresidentialProblemSectionsTile
            neighborhoods={n}
            scoped={scoped}
            tickets={tickets}
          />
          <PresidentialProblemVotesTile scoped={scoped} tickets={tickets} />
        </div>
      ))}
    </DashboardSection>
  );
};
