// The presidential country page — `/presidential/:cycle`.
//
// One canonical route per cycle. The shared pollRound query parameter restores
// the round toggle and polling view; unavailable rounds resolve to round one.
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

import { FC, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePresidentialSummary } from "@/data/presidential/usePresidentialSummary";
import { findPresidentialEntry } from "@/data/presidentialCatalogue";
import { ElectionScopeBar } from "@/screens/elections/ElectionScopeBar";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
// ⚠ THE PARLIAMENTARY DASHBOARD'S OWN SECTION SHELL, imported rather than reproduced — the same
// argument `ElectionFactsGrid` below is imported on. Every analysis section on `/parliamentary`
// is a `DashboardSection` (micro-caps kicker, icon, trailing rule); this page was hand-rolling
// `<section><h2 class="text-lg font-semibold">`, which `src/index.css` renders in the DISPLAY
// serif — so the two dashboards read as two products at every heading. The outcome canvas keeps
// its own `<h2>`, because that is what `ElectionResultsShell` renders on the parliamentary side.
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import {
  AlertTriangle,
  Building2,
  // ⚠ ALIASED. A bare `Map` import from lucide-react SHADOWS the global `Map` constructor in
  // this module, and `new Map<string, RegionLeader>()` a hundred lines down then fails to
  // compile with an error that names neither the import nor the icon.
  Map as MapIcon,
  Shuffle,
  GitFork,
  Split,
  Target,
} from "lucide-react";
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
import { formatInt } from "@/lib/currency";
import { PresidentialPersonName } from "./PresidentialPersonName";
import { PresidentialRoundToggle } from "./PresidentialRoundToggle";
import { usePresidentialRound } from "@/data/presidential/usePresidentialRound";
import {
  PresidentialPollsTile,
  PresidentialPollsTrendTile,
} from "./PresidentialPollsTile";
import { PresidentialTicketRanking } from "./PresidentialTicketRanking";
import {
  leadersByPlace,
  useRoundRollup,
  type RollupState,
} from "@/data/presidential/useRoundRollup";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import {
  PresidentialRegionsMap,
  type PresidentialMapRound,
  type RegionLeader,
} from "./PresidentialRegionsMap";
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
import { PresidentialFlowTile } from "./PresidentialFlowTile";
import { usePresidentialFlow } from "@/data/presidential/usePresidentialFlow";
import { PresidentialProblemSectionsTile } from "./PresidentialProblemSectionsTile";
import { PresidentialProblemVotesTile } from "./PresidentialProblemVotesTile";
import { scopeNeighborhoods } from "@/data/presidential/neighborhoodScope";
import { PresidentialScreeningTile } from "./PresidentialScreeningTile";
import { PresidentialRiskIndex } from "./PresidentialRiskIndex";
import { usePresidentialRiskScore } from "@/data/presidential/useRiskScore";
import {
  hasScreeningContent,
  usePresidentialScreening,
} from "@/data/presidential/useScreening";
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

const RoundPanel: FC<{
  round: PresidentialSummaryRound;
  cycle: string;
  /** Every round the cycle has — the map's hover card shows them all. */
  rounds: (1 | 2)[];
}> = ({ round, cycle, rounds }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const entry = findPresidentialEntry(cycle);
  const info = entry?.rounds[round.round];
  const hasRunoff = rounds.includes(2);
  // ⚠ THE REGION ROLL-UP IS THE ONE LEVEL SMALL ENOUGH TO SERVE A MAP — 113.9 KB for the whole
  // country at 2021, against 974.6 KB at municipality and 14.4 MB at settlement. Those two are
  // exactly what the per-place surface artifacts exist to avoid, which is why no map below this
  // one is drawn from them.
  //
  // ⚠ BOTH ROUNDS ARE READ, because the map's hover card answers „how did this place vote" for
  // each of them (the parliamentary card's job, for a two-round ballot). Each is one country-wide
  // file per round, and React Query dedupes the shown round against the call below. The abroad
  // roll-ups feed the world inset the same way. A one-round cycle never asks for round 2.
  const region1 = useRoundRollup(cycle, 1, "region");
  const region2 = useRoundRollup(hasRunoff ? cycle : undefined, 2, "region");
  const abroad1 = useRoundRollup(cycle, 1, "abroad");
  const abroad2 = useRoundRollup(hasRunoff ? cycle : undefined, 2, "abroad");
  const rollup = round.round === 1 ? region1 : region2;
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
  const mapRounds = useMemo<PresidentialMapRound[]>(() => {
    const ready = (s: RollupState) =>
      s.status === "ready" ? s.rollup : undefined;
    return rounds.map((n) => ({
      round: n,
      regions: ready(n === 1 ? region1 : region2),
      abroad: ready(n === 1 ? abroad1 : abroad2),
    }));
  }, [rounds, region1, region2, abroad1, abroad2]);
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
  // ⚠ PER ROUND. The two rounds are different paperwork — 2011's invalid rate halves between
  // them — so the screen is rebuilt rather than lifted to the page.
  const screening = usePresidentialScreening(cycle, round.round);
  // The Election Risk Index gates on the section risk score alone — its other inputs are optional.
  // ⚠ READ HERE ONLY FOR THE SECTION GATE: `DashboardSection` cannot see that
  // `PresidentialRiskIndex` self-hides; React Query shares this fetch with the component's own.
  const riskScore = usePresidentialRiskScore(cycle, round.round);
  // ⚠ PER CYCLE. Absent is the normal answer for both: a cycle decided in round 1 has no
  // transfer to estimate, and only 2021's presidential vote shared its day with a parliamentary
  // one, so four of the five cycles have no split-ticket file by construction.
  const transfer = useRunoffTransfer(cycle);
  const split = useSplitTicket(cycle);
  // ⚠⚠ CONTENT, NOT QUERY STATUS. `ready` is not „has something to draw" for either tile:
  // `isRollup` accepts an entries-empty or all-zero roll-up, and both tiles self-hide on an
  // empty result — so a status gate leaves the heading standing over an empty grid. `leaders.size
  // > 0` is the check the map uses, and it is equivalent to the tile's own „at least one oblast
  // cast a vote".
  const hasTopRegions = leaders.size > 0;
  const hasCleavages =
    cleavages.status === "ready" &&
    selectCleavageRows(cleavages.cleavages.rows).length > 0;
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
  // ⚠⚠ THE SECTION'S OWN GATE, NOT THE TILE'S SELF-HIDE. `DashboardSection` CANNOT see through
  // a component boundary — `isRenderable` returns true for `<PresidentialFlowTile />` whatever
  // it renders — so a tile that returns null leaves the heading standing over nothing. Measured
  // on 2006, whose flow the producer refuses on coverage. React Query dedupes this call against
  // the tile's own, so the gate costs no second request.
  const flow = usePresidentialFlow(cycle, round.round, "national");
  const hasFlow = flow.hasPair && flow.hasFile;
  // ⚠ THE COUNTRY SCOPE IS THE ARTIFACT ITSELF — `scopeNeighborhoods` returns the published
  // `tickets` array verbatim at this level rather than re-deriving it, so the country page and
  // the place pages cannot disagree about a share by a rounding step.
  const scopedHoods = useMemo(
    () =>
      hoods.status === "ready"
        ? scopeNeighborhoods(hoods.neighborhoods, { level: "country" })
        : null,
    [hoods],
  );
  // ⚠ CONTENT. A round nothing could be scored publishes four zero bands, which reads as „every
  // section was clean" when the truth is that none was measurable.
  const hasScreening =
    screening.status === "ready" && hasScreeningContent(screening.screening);
  const hasRisk = riskScore.status === "ready";
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

      {/* 2. the canvas — the national ranking beside the map, `/parliamentary`'s arrangement.

             ⚠ THE RANKING IS UNGATED AND THE MAP IS NOT. `round.ranking` is in the summary this
             page already has; the map's fills come from a region ROLL-UP that is usually absent
             (`data/*_pvr` is gitignored and has no bucket copy). So the list renders alone in
             that state — a canvas with one column — rather than the whole first screen
             disappearing with the map.

             ⚠ THE SHELL'S OWN GRID CONSTANTS. The DOM order is ranked-then-map and at `lg` the
             map is PLACED into column 1 — placement, never `order`, so the reading order on a
             phone is the list first. */}
      <section aria-labelledby={`pvr-canvas-${round.round}`}>
        <h2 id={`pvr-canvas-${round.round}`} className="text-lg font-semibold">
          {t("election_ballot_presidential_ticket")}
        </h2>
        <div
          className={`mt-2 ${CANVAS_GRID_CLASS}`}
          data-outcome-canvas="presidential_ticket"
        >
          <div className={CANVAS_RANKED_SLOT_CLASS} data-canvas-slot="ranked">
            <PresidentialTicketRanking round={round} tickets={tickets} />
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
                rounds={mapRounds}
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* 3. source and method — the parliamentary shell's footnote slot. ⚠ ART. 93 (3) IS TWO
             CONDITIONS AND THE NOTE SAYS BOTH: „49.42% and no winner" is the sentence a reader
             needs, and the producer decides them (`outcome.meetsMajority` / `meetsTurnout`) so
             this renders a verdict rather than re-deriving one. It used to be its own section
             with its own heading, and the turnout/ballot counts a second one — both repeating
             figures the strip above already carries. What is left here is only what the strip
             cannot say: the verdict, the turnout basis, and the two counts outside it. */}
      <section
        aria-labelledby={`pvr-source-${round.round}`}
        className="space-y-1 text-xs text-muted-foreground"
        data-presidential-source
      >
        <h2 id={`pvr-source-${round.round}`} className="sr-only">
          {t("election_source_title")}
        </h2>
        <p data-presidential-rule>
          {t("election_source_cik")}{" "}
          {round.outcome.winsOutright
            ? t("presidential_rule_won")
            : t("presidential_rule_runoff")}{" "}
          {t(
            round.outcome.meetsMajority
              ? "presidential_rule_majority_met"
              : "presidential_rule_majority_unmet",
          )}{" "}
          {t(
            round.outcome.meetsTurnout
              ? "presidential_rule_turnout_met"
              : "presidential_rule_turnout_unmet",
          )}
        </p>
        <p>
          {/* ⚠ ABSENT BEFORE 2016 AND RENDERED AS ABSENT. The form did not carry „не подкрепям
              никого", so a 0 here would claim nobody chose an option nobody was offered. */}
          {round.votes.noneOfTheAbove !== undefined ? (
            <>
              {t("presidential_none_of_the_above")}:{" "}
              <span className="tabular-nums">
                {formatInt(round.votes.noneOfTheAbove, lang)}
              </span>
              {" · "}
            </>
          ) : null}
          {t("presidential_invalid_ballots")}:{" "}
          <span className="tabular-nums">
            {formatInt(round.votes.invalid, lang)}
          </span>
          {". "}
          {t("presidential_share_denominator")}{" "}
          {/* ⚠ THE BASIS COMES FROM THE CATALOGUE'S CODE, NOT FROM THE SUMMARY'S SENTENCE —
              `turnout.basis` is Bulgarian corpus prose and would ship untranslated to the
              English band. 2006 is `domestic-only`: its 144 abroad sections report neither a
              roll nor a signature count. */}
          {info
            ? t(
                info.turnoutBasis === "domestic-only"
                  ? "presidential_turnout_basis_domestic"
                  : "presidential_turnout_basis_all",
              )
            : null}
        </p>
      </section>

      {/* 4. where the votes went — `/parliamentary`'s „Гласове" band comes first after the
             canvas there, and its vote-flow tile is this page's nearest kin. Three questions,
             each under its OWN heading because each is a different kind of claim: the flow
             from the parliamentary vote is an ESTIMATE, the runoff transfer is an ESTIMATE with
             an arithmetic pickup beside it, and the split ticket is a LOWER BOUND. One heading
             over all three is how a reader carries one licence over to numbers that do not
             have it. */}
      {hasFlow ? (
        <DashboardSection
          id="presidential-flow"
          // ⚠ THE SECTION AND THE TILE MUST NOT SAY THE SAME THING — rendered with the tile's own
          // title, the heading read „Как гласуваха партийните избиратели" twice in a row.
          title={t("presidential_flow_section")}
          icon={GitFork}
          headingLevel={2}
        >
          <PresidentialFlowTile cycle={cycle} round={round.round} />
        </DashboardSection>
      ) : null}

      {/* ⚠ ONLY WHEN THE ESTIMATE HAS ACTUALLY ARRIVED. `absent` is the ordinary answer, and
          `unusable` (a payload that lost its caveat) must draw nothing at all. */}
      {transfer.status === "ready" ? (
        <DashboardSection
          id="presidential-transfer"
          title={t("presidential_transfer_heading")}
          icon={Shuffle}
          headingLevel={2}
        >
          <PresidentialTransferTile transfer={transfer.transfer} />
          {/* ⚠ A SEPARATE QUESTION, ASKED SEPARATELY. Everything above this heading is an
              estimate; everything below it is arithmetic on published protocols. */}
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
        </DashboardSection>
      ) : null}

      {/* ⚠ ROUND ONE ONLY, AND GATED ON THE VIEW. The comparison is against the parliamentary
          ballot cast the SAME DAY, which is round 1's day; under a runoff view the tile would be
          numbers from another ballot beneath a heading about this one. */}
      {round.round === 1 && split.status === "ready" ? (
        <DashboardSection
          id="presidential-split"
          title={t("presidential_split_heading")}
          icon={Split}
          headingLevel={2}
        >
          <PresidentialSplitTicketTile split={split.split} />
        </DashboardSection>
      ) : null}

      {/* 5. geography — where the votes were, and which places went which way. The pair
             `/parliamentary`'s own „География" section carries, in the same order.
             ⚠ GATED ON THE TILES' OWN PREDICATES, not their query status: a heading over an
             empty grid would report a routine absence as a defect. */}
      {hasTopRegions || hasCleavages ? (
        <DashboardSection
          id="geography"
          title={t("dashboard_section_geography")}
          icon={MapIcon}
          headingLevel={2}
        >
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
        </DashboardSection>
      ) : null}

      {/* 6. polls — `/parliamentary`'s „Социологически агенции" sits after geography too.
             ⚠ THE PARLIAMENTARY SECTION'S SHAPE: the accuracy leaderboard and the accuracy
             trend, nothing else. Both cards grade ROUND ONE whatever round is shown. */}
      <DashboardSection
        id="presidential-polls"
        title={t("presidential_polls_heading")}
        icon={Target}
        headingLevel={2}
      >
        <PresidentialPollsTile cycle={cycle} />
        <PresidentialPollsTrendTile cycle={cycle} />
      </DashboardSection>

      {/* 7. anomalies — the parliamentary dashboard's own heading for the same pair of questions.
             ⚠⚠ NEITHER TILE ALLEGES ANYTHING. ⚠ FLASH SELF-HIDES ON FOUR OF THE FIVE CYCLES and
             that is the corpus, not a bug: only 2021 published its СУЕМГ records. */}
      {hasRisk || hasFlash || hasSuspicious || hasScreening ? (
        <DashboardSection
          id="anomalies"
          title={t("dashboard_section_anomalies")}
          icon={AlertTriangle}
          headingLevel={2}
        >
          {/* The Election Risk Index first, as on /parliamentary: the composite ribbon and the
              „Рискови секции" card. */}
          <PresidentialRiskIndex cycle={cycle} round={round.round} />
          {hasFlash ? (
            <PresidentialFlashMemoryTile cycle={cycle} round={round.round} />
          ) : null}
          {hasSuspicious && suspicious.status === "ready" ? (
            <PresidentialSuspiciousTile suspicious={suspicious.suspicious} />
          ) : null}
          {/* ⚠ THE SCREEN BELONGS WITH THE ANOMALIES, not in „Рискови гласове": both start from
              the whole country and let the protocols name the places. */}
          {hasScreening && screening.status === "ready" ? (
            <PresidentialScreeningTile screening={screening.screening} />
          ) : null}
        </DashboardSection>
      ) : null}

      {/* 8. рискови гласове — the eight flagged districts, under the SAME heading key the
             parliamentary dashboard uses. ⚠ ITS OWN SECTION, NOT A THIRD TILE UNDER
             „Аномалии": this one starts from districts somebody else named in print, and folding
             it in would let it borrow the anomalies' „we found this in the data" framing. */}
      {hasHoods && hoods.status === "ready" && scopedHoods ? (
        <DashboardSection
          id="neighborhoods"
          title={t("dashboard_section_neighborhoods")}
          icon={Building2}
          headingLevel={2}
        >
          <PresidentialProblemSectionsTile
            neighborhoods={hoods.neighborhoods}
            scoped={scopedHoods}
            tickets={tickets}
          />
          <PresidentialProblemVotesTile
            scoped={scopedHoods}
            tickets={tickets}
          />
        </DashboardSection>
      ) : null}
    </div>
  );
};

const PresidentialCycleBody: FC<{ cycle: string }> = ({ cycle }) => {
  const { t } = useTranslation();
  const state = usePresidentialSummary(cycle);
  // ⚠ ROUND 1 IS THE DEFAULT, and that is the constitutional order rather than a preference:
  // art. 93 (3) is a test on round 1, and a page that opened on the runoff would answer „who
  // won" while skipping „why there was a second round at all".
  // ⚠ THE SHARED HOOK, so the country page and the place pages read and write the round the
  // same way — a reader who picks the runoff here keeps it on the way down into an oblast.
  const [round, setRound] = usePresidentialRound(
    state.status === "ready" ? state.summary.rounds.map((r) => r.round) : [],
  );

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
      {/* The country result uses the same shared place header as `/parliamentary` and
          `/local/:cycle`: accented card, view eyebrow, „Bulgaria“ h1, and the view switcher
          composed with the election scope. The cycle remains explicit in the scope, so the
          five presidential pages are still distinguishable without making this view look like
          a different product. */}
      <PlaceHeader
        active="presidential"
        level="country"
        cycle={cycle}
        scope={
          // Every catalogued presidential cycle is historical. A future live cycle must take
          // this status from its producer rather than inheriting this literal.
          <ElectionScopeBar
            cycle={shown.date || summary.round1Date}
            status="final"
            round={shown.round}
          />
        }
      />
      <div>
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
      </div>

      {/* ⚠ RENDERED ONLY WHEN THERE IS A SECOND ROUND (the component's own rule). A one-round
          cycle showing a disabled „2-и тур" control offers a page that does not exist. */}
      <PresidentialRoundToggle
        rounds={summary.rounds.map((r) => r.round)}
        round={shown.round}
        onChange={setRound}
      />

      <RoundPanel
        round={shown}
        cycle={cycle}
        rounds={summary.rounds.map((r) => r.round)}
      />
    </section>
  );
};

/** Keyed by cycle to reset cycle-specific children. Round/filter choices are
 * restored from the URL and validated against the selected cycle's coverage. */
export const PresidentialCycleScreen: FC = () => {
  const { cycle } = useParams<{ cycle: string }>();
  if (!cycle) return null;
  return <PresidentialCycleBody key={cycle} cycle={cycle} />;
};
