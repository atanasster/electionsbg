// The presidential country page — `/presidential/:cycle`.
//
// ⚠ THE RUNOFF IS A TOGGLE, NOT A ROUTE (plan §9, resolved 2026-09-06). One canonical page per
// cycle with a round switch, because the surfaces already carry both rounds and two routes
// would compete for the same query. The switch is COMPONENT STATE rather than a query
// parameter: a `?round=2` would mint a second address for the same page — the thing the
// decision was taken to avoid — and the round is view state, not the cross-page state the
// URL contract is for. The cost is stated rather than hidden: „балотаж 2021" has no URL of
// its own and ranks against the cycle page.
//
// ⚠ THE COUNTRY LEVEL IS `canonical`, so this page reads `national_summary.json` directly
// rather than a generated surface (`SURFACE_POLICY.presidential.country`). Every level below
// it renders through `PresidentialPlaceScreen`.
//
// ⚠ ART. 93 (3) IS TWO CONDITIONS AND THE PAGE SAYS BOTH. „49.42% and no winner" is the
// sentence a reader needs; a strip that led with the leader's share alone would read as a win.
// The producer decides them (`outcome.meetsMajority` / `meetsTurnout`), so this file renders a
// verdict rather than re-deriving one — a second implementation of the constitutional test is
// exactly the drift that makes two surfaces disagree about who was elected.

import { FC, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePresidentialSummary } from "@/data/presidential/usePresidentialSummary";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { findPresidentialEntry } from "@/data/presidentialCatalogue";
import { ElectionScopeBar } from "@/screens/elections/ElectionScopeBar";
// ⚠ THE PARLIAMENTARY DASHBOARD'S OWN BAND AND ITS OWN GRID, imported rather than reproduced.
// `/parliamentary` opens with a four-card KPI strip above a map-beside-a-table canvas, and this
// page is the same kind of page; a lookalike built here would match on the day it was written
// and drift the first time either moved. `ElectionFactsGrid` is the strip `ElectionResultsShell`
// renders, and the three layout constants are the ones its canvas and its skeleton share.
import { ElectionFactsGrid } from "@/screens/elections/ElectionFactsGrid";
import {
  CANVAS_GRID_CLASS,
  CANVAS_MAP_SLOT_CLASS,
  CANVAS_RANKED_SLOT_CLASS,
} from "@/screens/elections/electionSurfaceLayout";
import { presidentialCountryFacts } from "@/data/presidential/countryFacts";
import { formatInt, formatPct } from "@/lib/currency";
import { PresidentialPersonName } from "./PresidentialPersonName";
import { PresidentialTicketRanking } from "./PresidentialTicketRanking";
import {
  leadersByPlace,
  useRoundRollup,
} from "@/data/presidential/useRoundRollup";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import {
  PresidentialRegionsMap,
  type RegionLeader,
} from "./PresidentialRegionsMap";
import { PresidentialRegionsList } from "./PresidentialRegionsList";
import { ToLocalSameDay } from "@/screens/components/SameDayElectionLink";
import { useRunoffTransfer } from "@/data/presidential/useRunoffTransfer";
import { useSplitTicket } from "@/data/presidential/useSplitTicket";
import { PresidentialSplitTicketTile } from "./PresidentialSplitTicketTile";
import { PresidentialTransferTile } from "./PresidentialTransferTile";
import { PresidentialFlashMemoryTile } from "./PresidentialFlashMemoryTile";
import { PresidentialSuspiciousTile } from "./PresidentialSuspiciousTile";
import {
  hasSuspiciousContent,
  usePresidentialSuspicious,
} from "@/data/presidential/useSuspiciousSettlements";
import { useFlashDiff } from "@/data/presidential/useFlashDiff";
import { PresidentialNeighborhoodsTile } from "./PresidentialNeighborhoodsTile";
import {
  hasNeighborhoodContent,
  usePresidentialNeighborhoods,
} from "@/data/presidential/useNeighborhoods";
import { PresidentialTopRegionsTile } from "./PresidentialTopRegionsTile";
import { PresidentialCleavagesTile } from "./PresidentialCleavagesTile";
import { usePresidentialCleavages } from "@/data/presidential/usePresidentialCleavages";
import { selectCleavageRows } from "@/screens/dashboard/selectCleavageRows";
import {
  PresidentialRunoffSwingLegend,
  PresidentialRunoffSwingList,
  PresidentialRunoffSwingMap,
} from "./PresidentialRunoffSwing";
import type { PresidentialSummaryRound } from "@/data/presidential/summary";

// ⚠ THE REPO'S FORMATTERS, NOT `toLocaleString("bg-BG")` AND `toFixed`. A hardcoded locale
// renders „1 322 385" on the English page and „49.42%" on the Bulgarian one, where Bulgarian
// writes „49,42%"; and `formatInt`'s own header records what an unguarded `.toLocaleString()`
// costs — a `TypeError` on a field the served JSON does not carry, which with no error
// boundary in `src/` unmounts the React root. Both render „—" for an absent value, never 0.
// `formatPct` takes a FRACTION, which is what `shareOfValid` and `turnout.pct` are.
const PCT_DIGITS = 2;

/** The nominator's kind → its label key. ⚠ THE THREE ARE NOT INTERCHANGEABLE: a ticket may be
 *  put up by a party, a coalition or an инициативен комитет, and calling a committee a party is
 *  a false statement about a named pair — the same reason the ranked row carries no `partyId`. */
const NOMINATOR_KEY: Record<string, string> = {
  party: "presidential_nominator_party",
  coalition: "presidential_nominator_coalition",
  committee: "presidential_nominator_committee",
};

const RoundPanel: FC<{ round: PresidentialSummaryRound; cycle: string }> = ({
  round,
  cycle,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const entry = findPresidentialEntry(cycle);
  const info = entry?.rounds[round.round];
  // ⚠ THE REGION ROLL-UP IS THE ONE LEVEL SMALL ENOUGH TO SERVE A MAP — 113.9 KB for the whole
  // country at 2021, against 974.6 KB at municipality and 14.4 MB at settlement. Those two are
  // exactly what the per-place surface artifacts exist to avoid, which is why no map below this
  // one is drawn from them.
  const rollup = useRoundRollup(cycle, round.round, "region");
  // ⚠ ONLY A READY ROLL-UP MAY COLOUR A MAP. A place missing from a ready one genuinely cast
  // no votes, which is what the map's „няма подадени гласове" label says; a place missing
  // because nothing has loaded yet has not, and rendering that label for all 31 oblasts —
  // above a ranking table showing millions of votes — is a false claim about named places.
  // Absent is the COMMON case here: `data/*_pvr` is gitignored and has no bucket copy.
  const leaders = useMemo(
    () =>
      rollup.status === "ready"
        ? leadersByPlace(rollup.rollup)
        : new Map<string, RegionLeader>(),
    [rollup],
  );
  const tickets = useTicketsByNumber(cycle);
  // ⚠ PER ROUND, LIKE EVERY OTHER SECTION OF THIS PANEL. Round 1 and the runoff are different
  // electorates and different fields of candidates, so their cleavages are different analyses —
  // and the producer writes one file per round for that reason.
  const cleavages = usePresidentialCleavages(cycle, round.round);
  // ⚠ PER ROUND AGAIN, and both of the anomalies section's inputs are usually ABSENT: only
  // 2021 published flash records at all, and `suspicious_settlements.json` reaches the bucket
  // only through `bucket:gz`. React Query dedupes these against the tiles' own calls, so
  // reading them here to gate the heading costs no second request.
  const flash = useFlashDiff(cycle, round.round);
  const suspicious = usePresidentialSuspicious(cycle, round.round);
  // ⚠ PER ROUND AGAIN. The eight districts are the same places in both rounds, but the
  // protocols are not — 2021's runoff turnout there is 20.5% against 23.9% in round 1 — so the
  // figures are rebuilt rather than lifted to the page.
  const hoods = usePresidentialNeighborhoods(cycle, round.round);
  // ⚠⚠ CONTENT, NOT QUERY STATUS. `ready` is not „has something to draw" for either tile:
  // `isRollup` accepts an entries-empty or all-zero roll-up, and both tiles self-hide on an
  // empty result — so a status gate leaves the heading standing over an empty grid, which is
  // the one thing the section's own comment says it exists to prevent. `leaders.size > 0` is
  // the same check the map and the oblast table above already use, and it is equivalent to the
  // tile's own „at least one oblast cast a vote".
  const hasTopRegions = leaders.size > 0;
  const hasCleavages =
    cleavages.status === "ready" &&
    selectCleavageRows(cleavages.cleavages.rows).length > 0;
  // ⚠⚠ CONTENT, NOT QUERY STATUS — the same rule as the geography pair above, and here each
  // predicate is the TILE'S OWN. `flash` can be a readable file with no comparable ticket, and
  // a `ready` suspicious payload can have no measurable rule at all; either would leave
  // „Аномалии" standing over an empty grid, which reports the corpus's ordinary silence as a
  // defect.
  // ⚠ THE TILE'S REAL PREDICATE, not `tickets.length`. `PresidentialFlashMemoryTile` renders
  // whenever it has any ticket and then filters to the rows worth reading — so an all-zero
  // ticket set opens the heading and draws a table with no body under it.
  const hasFlash =
    !!flash &&
    flash.tickets.some((r) => r.machineVotes > 0 || r.flashVotes > 0);
  const hasSuspicious =
    suspicious.status === "ready" &&
    hasSuspiciousContent(suspicious.suspicious);
  // ⚠ CONTENT AGAIN, and here the empty state is the dangerous one: a „Рискови гласове" heading
  // over a blank is an insinuation about eight named districts with no figures under it.
  const hasHoods =
    hoods.status === "ready" && hasNeighborhoodContent(hoods.neighborhoods);
  const abroadTo = presidentialUrl(cycle, "abroad");
  // ⚠ THE ROUND ON SCREEN, never the cycle. Round 1 and the runoff are different electorates —
  // nationally 5.7 points apart in 2021 — so the band is rebuilt per round like every other
  // section of this panel, rather than being lifted to the page.
  const facts = useMemo(() => presidentialCountryFacts(round), [round]);
  return (
    <div className="space-y-6">
      {/* 1. the outcome strip — the same component and the same four-card grid `/parliamentary`
             opens with, so the two dashboards read as one kind of page. ⚠ ITS OWN `<h2>` is
             `sr-only` and its ids are scoped by the ROUND, because both panels can be mounted
             in one document and two nodes sharing an id make both landmarks announce the
             first. */}
      <ElectionFactsGrid facts={facts} titleId={`pvr-facts-${round.round}`} />

      {/* 2. the canvas — the map and the national result side by side, the arrangement
             `/parliamentary` opens with and the reason this block moved above the rule strip
             and the full table.

             ⚠ THE PAIR BESIDE THE MAP IS THE NATIONAL RANKING, not the per-oblast table. §4's
             rule is that a map has a text equivalent and that colour is never the only encoding
             of a winner; on every other kind that equivalent is the ranked result, and putting
             the oblast table there instead answered a different question one level down. The
             oblast table follows immediately (section 3) and keeps BOTH of its own jobs: the
             map's per-region twin, and the only route from this page to an oblast.

             ⚠ THE RANKING IS UNGATED AND THE MAP IS NOT. `round.ranking` is in the summary this
             page already has; the map's fills come from a region ROLL-UP that is usually absent
             (`data/*_pvr` is gitignored and has no bucket copy). So the list renders alone in
             that state — a canvas with one column — rather than the whole first screen
             disappearing with the map, which is what gating the pair on `leaders` would do.

             ⚠ THE SHELL'S OWN GRID CONSTANTS. The DOM order is ranked-then-map and at `lg` the
             map is PLACED into column 1 — placement, never `order`, so the reading order on a
             phone is the list first. Hand-writing the ratio here is what would drift from
             `/parliamentary` the first time either side changed it. */}
      <section aria-labelledby={`pvr-canvas-${round.round}`}>
        <h2 id={`pvr-canvas-${round.round}`} className="text-lg font-semibold">
          {t("election_ballot_presidential_ticket")}
        </h2>
        <div
          className={`mt-2 ${CANVAS_GRID_CLASS}`}
          data-outcome-canvas="presidential_ticket"
        >
          <div className={CANVAS_RANKED_SLOT_CLASS} data-canvas-slot="ranked">
            <PresidentialTicketRanking
              round={round}
              tickets={tickets}
              detailsHref={`#pvr-ranking-${round.round}`}
            />
          </div>
          {leaders.size > 0 ? (
            <div className={CANVAS_MAP_SLOT_CLASS} data-canvas-slot="map">
              {/* ⚠ VISIBLE, NOT `sr-only`, AND INSIDE THE SLOT. The shell renders a map's
                  question as a visible `<h3>` above the map on every other kind. */}
              <h3 className="text-sm font-medium" data-map-question>
                {t("presidential_map_q_who_led_region")}
              </h3>
              <PresidentialRegionsMap
                cycle={cycle}
                round={round.round}
                leaders={leaders}
                tickets={tickets}
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* 3. the per-oblast table — the map's region-by-region twin, and the only route from
             this page down to an oblast, which is why it renders on exactly the same condition
             as the map. ⚠ BOTH OR NEITHER: they used to appear and disappear separately, and a
             map with no per-region text at all asserts „няма подадени гласове" about 31 named
             places in the state this corpus is usually in. */}
      {leaders.size > 0 ? (
        <PresidentialRegionsList
          cycle={cycle}
          leaders={leaders}
          tickets={tickets}
        />
      ) : null}

      {/* 3b. geography — where the votes were, and which places went which way. The pair
             `/parliamentary`'s own „География" section carries, in the same order.

             ⚠ EACH TILE SELF-HIDES ON ITS OWN INPUT. The regions tile needs the roll-up the map
             also needs (usually absent — `data/*_pvr` is gitignored and reaches the bucket only
             through `bucket:gz`); the cleavages tile needs its own per-round artifact, which the
             producer writes only where two tickets clear its readability cut. A heading over an
             empty grid would report a routine absence as a defect, so the SECTION is gated on
             at least one of them having something to draw — the tiles' OWN predicates, not
             their query status. */}
      {hasTopRegions || hasCleavages ? (
        <section aria-labelledby={`pvr-geography-${round.round}`}>
          <h2
            id={`pvr-geography-${round.round}`}
            className="text-lg font-semibold"
          >
            {t("dashboard_section_geography")}
          </h2>
          <div className="mt-2 space-y-3">
            {hasTopRegions && rollup.status === "ready" ? (
              <PresidentialTopRegionsTile
                cycle={cycle}
                rollup={rollup.rollup}
                tickets={tickets}
              />
            ) : null}
            {hasCleavages && cleavages.status === "ready" ? (
              <PresidentialCleavagesTile cleavages={cleavages.cleavages} />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 4. art. 93 (3), both conditions. ⚠ IT SITS BELOW THE CANVAS NOW and still above the
             full table: the strip answers „why was there a second round", which is a question a
             reader asks after seeing the result, not before it. */}
      <section
        aria-labelledby={`pvr-rule-${round.round}`}
        className="rounded-lg border p-4"
      >
        <h2 id={`pvr-rule-${round.round}`} className="text-lg font-semibold">
          {t("presidential_rule_heading")}
        </h2>
        <p className="mt-2 text-sm">
          {round.outcome.winsOutright
            ? t("presidential_rule_won")
            : t("presidential_rule_runoff")}
        </p>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>
            {t(
              round.outcome.meetsMajority
                ? "presidential_rule_majority_met"
                : "presidential_rule_majority_unmet",
            )}
          </li>
          <li>
            {t(
              round.outcome.meetsTurnout
                ? "presidential_rule_turnout_met"
                : "presidential_rule_turnout_unmet",
            )}
          </li>
        </ul>
      </section>

      {/* 5. the FULL table — every ticket, with the vice-president and the nominator. ⚠ NOT A
             DUPLICATE OF THE CANVAS LIST: that one is a top-eight preview of one column, and
             these three columns are what a canvas column cannot hold. For an инициативен
             комитет the nominator is also the difference between a committee and a party, which
             is a false statement about a named pair if it is dropped. */}
      <section aria-labelledby={`pvr-ranking-${round.round}`}>
        <h2 id={`pvr-ranking-${round.round}`} className="text-lg font-semibold">
          {t("presidential_ranking_heading")}
        </h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col">{t("presidential_col_ticket")}</th>
                <th scope="col">{t("presidential_col_pair")}</th>
                <th scope="col">{t("presidential_col_nominator")}</th>
                <th scope="col" className="text-right">
                  {t("presidential_col_votes")}
                </th>
                <th scope="col" className="text-right">
                  {t("presidential_col_share")}
                </th>
              </tr>
            </thead>
            <tbody>
              {round.ranking.map((r) => (
                <tr key={r.number} className="border-t">
                  <td>{r.number}</td>
                  {/* ⚠ BULGARIAN IN BOTH LANGUAGES AND NEVER TRANSLITERATED — a reader is
                      matching these against a ballot or a protocol scan, both Cyrillic. */}
                  {/* ⚠ A LINK ONLY WHERE THE NAME RESOLVES TO EXACTLY ONE PUBLIC FIGURE.
                      Measured over all five ballots, 17 of 140 names are shared — „Иван
                      Стефанов Иванов" by 15 people — and linking one of them would attribute
                      this candidacy, and everything else on that profile, to somebody who
                      merely shares a name. The refusal renders as plain text; the name is
                      still there, which is what a reader needs. */}
                  <td>
                    <PresidentialPersonName name={r.president} />
                    <span className="block text-muted-foreground">
                      <PresidentialPersonName name={r.vicePresident} />
                    </span>
                  </td>
                  <td className="text-muted-foreground">
                    {r.nominatedBy.name}
                    {NOMINATOR_KEY[r.nominatedBy.kind] ? (
                      <span className="block">
                        {t(NOMINATOR_KEY[r.nominatedBy.kind])}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatInt(r.votes, lang)}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatPct(r.shareOfValid, lang, PCT_DIGITS)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("presidential_share_denominator")}
        </p>
      </section>

      {/* 6. anomalies — the two „is anything odd here" surfaces, in one section, in the order
             a reader can act on: first what the MACHINES recorded against what the commissions
             wrote down, then the settlements whose protocols trip a threshold.

             ⚠⚠ NEITHER TILE ALLEGES ANYTHING, and the section heading must not be read as
             doing so either. „Аномалии" is the parliamentary dashboard's own heading for the
             same pair of questions, which is why it is that key rather than a presidential
             one — a second wording for one concept is how two dashboards come to imply
             different things about the same kind of finding.

             ⚠ FLASH SELF-HIDES ON FOUR OF THE FIVE CYCLES and that is the corpus, not a bug:
             only 2021 published its СУЕМГ records. 2016 is the case that makes the
             distinction — machines counted votes in 500 of its 12,340 round-1 sections and
             ЦИК published nothing from them — so the tile keys on the RECORDS existing, never
             on `machineVoting`. */}
      {hasFlash || hasSuspicious ? (
        <section aria-labelledby={`pvr-anomalies-${round.round}`}>
          <h2
            id={`pvr-anomalies-${round.round}`}
            className="text-lg font-semibold"
          >
            {t("dashboard_section_anomalies")}
          </h2>
          {/* ⚠ ONE DISCIPLINE FOR BOTH TILES, and the same one the geography section uses:
              the section's OWN predicate gates the mount, and the tile's early return is the
              belt to that braces. Relying on the self-hide alone works until a tile loses it,
              at which point the section silently regains the empty-grid failure it was built
              to prevent — and a reader of this JSX cannot tell which gate is load-bearing. */}
          <div className="mt-2 space-y-3">
            {hasFlash ? (
              <PresidentialFlashMemoryTile cycle={cycle} round={round.round} />
            ) : null}
            {hasSuspicious && suspicious.status === "ready" ? (
              <PresidentialSuspiciousTile suspicious={suspicious.suspicious} />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 6b. рискови гласове — the eight flagged districts, under the SAME heading key the
             parliamentary dashboard uses for the same question. It sits after „Аномалии"
             because it is a lens on named places rather than a screen over the whole country,
             and a reader arrives at it having already read what the protocol flags do and do
             not prove.

             ⚠ ITS OWN SECTION, NOT A THIRD TILE UNDER „Аномалии". The two are different kinds
             of claim: the anomalies section screens every settlement and lets the numbers name
             the places, while this one starts from eight districts somebody else has already
             named in print. Folding them together would let the second borrow the first's
             „we found this in the data" framing. */}
      {hasHoods && hoods.status === "ready" ? (
        <section aria-labelledby={`pvr-hoods-${round.round}`}>
          <h2 id={`pvr-hoods-${round.round}`} className="text-lg font-semibold">
            {t("dashboard_section_neighborhoods")}
          </h2>
          <div className="mt-2">
            <PresidentialNeighborhoodsTile
              neighborhoods={hoods.neighborhoods}
            />
          </div>
        </section>
      ) : null}

      <section aria-labelledby={`pvr-turnout-${round.round}`}>
        <h2 id={`pvr-turnout-${round.round}`} className="text-lg font-semibold">
          {t("presidential_turnout_heading")}
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">
              {t("presidential_turnout_pct")}
            </dt>
            {/* ⚠ `null` IS „NO RATE", NEVER 0% — and `formatPct` already renders „—" for it,
                which is why there is no ternary here. */}
            <dd className="tabular-nums">
              {formatPct(round.turnout.pct, lang, PCT_DIGITS)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("presidential_valid_votes")}
            </dt>
            <dd className="tabular-nums">
              {formatInt(round.votes.valid, lang)}
            </dd>
          </div>
          {/* ⚠ ABSENT BEFORE 2016 AND RENDERED AS ABSENT. The form did not carry „не
              подкрепям никого", so a 0 here would claim nobody chose an option nobody was
              offered — which is why the key is optional rather than defaulted. */}
          {round.votes.noneOfTheAbove !== undefined ? (
            <div>
              <dt className="text-muted-foreground">
                {t("presidential_none_of_the_above")}
              </dt>
              <dd className="tabular-nums">
                {formatInt(round.votes.noneOfTheAbove, lang)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">
              {t("presidential_invalid_ballots")}
            </dt>
            <dd className="tabular-nums">
              {formatInt(round.votes.invalid, lang)}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          {/* ⚠ THE BASIS COMES FROM THE CATALOGUE'S CODE, NOT FROM THE SUMMARY'S SENTENCE.
              `turnout.basis` is Bulgarian corpus prose; rendering it would ship untranslated
              copy to the English band. The catalogue stores `all-sections` / `domestic-only`
              for exactly this, and 2006 is the second — its 144 abroad sections report neither
              a roll nor a signature count while casting 46,113 valid votes, so they are in
              neither half of the ratio. */}
          {info
            ? t(
                info.turnoutBasis === "domestic-only"
                  ? "presidential_turnout_basis_domestic"
                  : "presidential_turnout_basis_all",
              )
            : null}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("presidential_invalid_note")}
        </p>
      </section>

      <section aria-labelledby={`pvr-abroad-${round.round}`}>
        <h2 id={`pvr-abroad-${round.round}`} className="text-lg font-semibold">
          {t("presidential_abroad_heading")}
        </h2>
        <p className="mt-2 text-sm">
          {t("presidential_abroad_summary", {
            sections: round.abroad.sections,
            countries: round.abroad.countries,
            ballots: formatInt(round.abroad.ballotsFound, lang),
          })}
        </p>
        {/* ⚠ A COUNT, NEVER A PERCENTAGE. There is no registered-voter denominator outside the
            country, and fed through this repo's own turnout rule the abroad rollup renders
            87–98% for every country with the „cast > denom" guard never firing — plausible,
            and forbidden by decision 6. */}
        <p className="mt-1 text-xs text-muted-foreground">
          {t("presidential_abroad_no_turnout")}
        </p>
        {abroadTo ? (
          <Link className="mt-2 inline-block text-sm underline" to={abroadTo}>
            {t("presidential_abroad_link")}
          </Link>
        ) : null}
      </section>
    </div>
  );
};

const PresidentialCycleBody: FC<{ cycle: string }> = ({ cycle }) => {
  // ⚠ CALLED UNCONDITIONALLY, above every early return in this component — React hook order.
  // The four states are handled at the mount site far below.
  const transfer = useRunoffTransfer(cycle);
  // ⚠ ABSENT IS THE NORMAL ANSWER HERE. Only 2021's presidential vote shared its day with a
  // parliamentary one, so four of the five cycles have no such file by construction.
  const split = useSplitTicket(cycle);
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const state = usePresidentialSummary(cycle);
  // ⚠ ROUND 1 IS THE DEFAULT, and that is the constitutional order rather than a preference:
  // art. 93 (3) is a test on round 1, and a page that opened on the runoff would answer „who
  // won" while skipping „why there was a second round at all".
  const [round, setRound] = useState<1 | 2>(1);

  if (state.status === "loading")
    return (
      <section className="my-4" aria-busy="true">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-64 animate-pulse rounded bg-muted" />
      </section>
    );
  if (state.status !== "ready")
    return (
      <section className="my-4">
        <h1 className="text-2xl md:text-3xl font-bold">
          {t("presidential_cycle_title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {/* ⚠ TWO REASONS, TWO SENTENCES. „not published yet" is the expected answer for a
              cycle whose tree has not shipped; „unreadable" is a defect. A single message
              would report a bug as a routine gap. */}
          {t(
            state.status === "absent"
              ? "presidential_not_published"
              : "presidential_unusable",
          )}
        </p>
      </section>
    );

  const { summary } = state;
  const shown =
    summary.rounds.find((r) => r.round === round) ?? summary.rounds[0];

  return (
    <section className="my-4 space-y-6">
      <header>
        {/* ⚠ THE YEAR IS IN THE HEADING, not only in the scope line beneath it. Five pages
            sharing one `<h1>` is the duplicate-signal shape this repo takes seriously; the
            bare title stays as the BACK-LINK text on a place page, where a year is wrong. */}
        {/* ⚠ THE SAME SCALE AS `PlaceHeader`'s title on `/parliamentary`. Two result dashboards
            whose headline sizes differ read as two products, and this page's `<h1>` is the same
            kind of thing: the name of the cycle the numbers beneath it describe. */}
        <h1 className="text-2xl md:text-3xl font-bold">
          {t("presidential_cycle_title_year", {
            year: summary.round1Date.slice(0, 4),
          })}
        </h1>
        {/* ⚠ THE ROUND-1 DATE, NOT THE CYCLE ID. `cycleIsoDate` returns "" for a `_pvr`
            folder, and `formatDate` passes an unparseable string through verbatim — i.e. the
            folder id on the page, the exact defect that shipped on 613 pages once. */}
        {/* ⚠ `status="final"` IS A LITERAL, and the justification is that every catalogued
            presidential cycle is historical: the newest is 2021 and the corpus is a closed
            record. The artifact's own `status.result` cannot be read here — the header sits
            OUTSIDE the surface boundary, and this page has no artifact at all, being served
            from the canonical summary. A future LIVE cycle must read the producer's answer
            rather than this literal. */}
        <ElectionScopeBar
          cycle={shown.date || summary.round1Date}
          status="final"
          round={shown.round}
        />
        <p className="mt-1 text-sm">
          {t(
            summary.decidedInRound === 1
              ? "presidential_decided_round1"
              : "presidential_decided_runoff",
          )}
          {": "}
          <strong>
            <PresidentialPersonName name={summary.winner.president} />
          </strong>
          {" · "}
          <PresidentialPersonName name={summary.winner.vicePresident} />
        </p>
        {/* ⚠ THE OTHER DIRECTION OF THE SAME CROSS-LINK. A pill on only one side is a route a
            reader can take once and never find again — and this side is the one where „local
            elections were held the same day" is the more surprising fact.
            ⚠ THE SPACING RIDES ON THE PILL, not on a wrapper: the component self-hides on four
            of the five cycles, and an unconditional `mt-2` div leaves a gap under the header on
            every one of them. */}
        <ToLocalSameDay cycle={cycle} className="mt-2" />
      </header>

      {/* ⚠ RENDERED ONLY WHEN THERE IS A SECOND ROUND. A one-round cycle showing a disabled
          „2-и тур" control offers a page that does not exist. All five committed cycles went
          to a runoff, so the single-round arm is testable only against a future cycle — which
          is why it is a data check rather than a constant. */}
      {summary.rounds.length > 1 ? (
        <div
          role="group"
          aria-label={t("presidential_round_toggle_label")}
          className="flex gap-2"
        >
          {summary.rounds.map((r) => (
            <button
              key={r.round}
              type="button"
              aria-pressed={r.round === shown.round}
              onClick={() => setRound(r.round)}
              className={`rounded border px-3 py-1 text-sm ${
                r.round === shown.round ? "bg-accent font-semibold" : ""
              }`}
            >
              {t("election_round", { round: r.round })}
            </button>
          ))}
        </div>
      ) : null}

      <RoundPanel round={shown} cycle={cycle} />

      {/* ⚠ ONLY THE SURVIVING TICKETS, and the caption says so. A ticket absent from the runoff
          did not fall to zero — it was not standing — so 2021's other 21 would each show a
          delta equal to minus their whole round-1 vote, Карадайъ's 309,681 among them. */}
      {summary.swing ? (
        <section aria-labelledby="pvr-swing">
          <h2 id="pvr-swing" className="text-lg font-semibold">
            {t("presidential_swing_heading")}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {summary.swing.tickets.map((s) => (
              <li key={s.number}>
                {/* The same rule as the ranked rows — one component, so a name cannot be a
                    link in one list and bare text in the other on the same page. */}
                <PresidentialPersonName name={s.president} />
                {": "}
                <span className="tabular-nums">
                  {formatPct(s.round1Share, lang, PCT_DIGITS)} →{" "}
                  {formatPct(s.round2Share, lang, PCT_DIGITS)}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  ({s.deltaVotes >= 0 ? "+" : ""}
                  {formatInt(s.deltaVotes, lang)})
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("presidential_swing_note")}
          </p>
        </section>
      ) : null}

      {/* ⚠ ONLY WHEN THE ESTIMATE HAS ACTUALLY ARRIVED. `absent` is the ordinary answer — a
          cycle decided in round 1 has no transfer to estimate, and `data/*_pvr` reaches the
          bucket only through a sync, so „not published yet" is the common state. Neither is a
          reason to draw an empty chart, and `unusable` (a payload that lost its caveat) must
          draw nothing at all. */}
      {transfer.status === "ready" ? (
        <section aria-labelledby="pvr-transfer" className="space-y-4">
          <h2 id="pvr-transfer" className="text-lg font-semibold">
            {t("presidential_transfer_heading")}
          </h2>
          <PresidentialTransferTile transfer={transfer.transfer} />
          {/* ⚠ A SEPARATE QUESTION, ASKED SEPARATELY. Everything above this heading is an
              estimate; everything below it is arithmetic on published protocols. Running them
              together under one heading is how a reader carries the estimate's licence over
              to numbers that do not need it — and, worse, the other way round. */}
          <h3
            className="font-semibold"
            data-map-question
            id="pvr-transfer-pickup"
          >
            {t("presidential_pickup_heading", {
              president: transfer.transfer.finalists[0].president,
            })}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("presidential_pickup_note")}
          </p>
          <PresidentialRunoffSwingList
            cycle={cycle}
            winner={transfer.transfer.finalists[0].president}
            oblasts={transfer.transfer.oblasts}
          />
          <PresidentialRunoffSwingLegend />
          <PresidentialRunoffSwingMap
            cycle={cycle}
            winner={transfer.transfer.finalists[0].president}
            oblasts={transfer.transfer.oblasts}
          />
        </section>
      ) : null}

      {/* ⚠ ITS OWN SECTION, AND ITS OWN KIND OF CLAIM. The transfer above is an ESTIMATE and
          the pickup beside it is arithmetic; this is a LOWER BOUND — a third thing, and the
          only one of the three that a reader is likely to quote as if it were a measurement.
          Keeping it under its own heading is what stops the three licences blurring. */}
      {/* ⚠ ROUND ONE ONLY, AND GATED ON THE VIEW. The comparison is against the parliamentary
          ballot cast the SAME DAY, which is round 1's day; under a runoff view the tile would
          be numbers from another ballot beneath a heading about this one. `coverage.basis`
          says so in prose at the foot of the tile, but a reader who does not reach the last
          paragraph has been shown the wrong round. Every other section on this page keys off
          `shown.round`; this now does too. */}
      {shown.round === 1 && split.status === "ready" ? (
        <section aria-labelledby="pvr-split" className="space-y-3">
          <h2 id="pvr-split" className="text-lg font-semibold">
            {t("presidential_split_heading")}
          </h2>
          <PresidentialSplitTicketTile split={split.split} />
        </section>
      ) : null}
    </section>
  );
};

/**
 * `/presidential/:cycle`.
 *
 * ⚠ KEYED ON THE CYCLE, and that is a correctness fix rather than a style. The round is
 * COMPONENT STATE by design (the runoff is a toggle, not a route), and all five cycles share
 * one `<Route>` element — so without the key, changing only `:cycle` re-renders the same
 * instance, `useState`'s initial value is not re-applied, and a reader who toggled to the
 * runoff and then picked another cycle from the header dropdown lands on THAT cycle's runoff,
 * never seeing the art. 93 (3) test this page leads with. Two clicks, and both controls are on
 * this page.
 */
export const PresidentialCycleScreen: FC = () => {
  const { cycle } = useParams<{ cycle: string }>();
  if (!cycle) return null;
  return <PresidentialCycleBody key={cycle} cycle={cycle} />;
};
