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
import { formatInt, formatPct } from "@/lib/currency";
import {
  namesakeCountForTicket,
  personHrefForTicket,
} from "@/data/presidential/ticketPersons";
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
import { useRunoffTransfer } from "@/data/presidential/useRunoffTransfer";
import { PresidentialTransferTile } from "./PresidentialTransferTile";
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

/** A candidate's name, linked to their `/person` page where the corpus can name exactly one.
 *
 *  ⚠ NOT A COMPONENT THAT DECIDES — the decision was made at build time by
 *  `build_ticket_persons.ts`, which REFUSES a shared name rather than scoring candidates. All
 *  this does is render the refusal as plain text, and say WHY when the reason is ambiguity:
 *  „no link" and „several people have this name" are different facts, and only the second is
 *  worth a reader's attention. */
const PersonName: FC<{ name: string }> = ({ name }) => {
  const { t } = useTranslation();
  const href = personHrefForTicket(name);
  if (href)
    return (
      <Link className="underline" to={href}>
        {name}
      </Link>
    );
  const namesakes = namesakeCountForTicket(name);
  return (
    <>
      {name}
      {/* ⚠ THE EXPLANATION IS NOT IN A `title`. A tooltip reaches a mouse and nothing else —
          not touch, not a keyboard, and a screen reader only sometimes — so the mark carries
          the reason as its accessible name instead, and the visible text stays short. */}
      {namesakes > 1 ? (
        <span className="ml-1 text-xs text-muted-foreground">
          <span aria-hidden="true">{t("presidential_namesake_mark")}</span>
          <span className="sr-only">
            {t("presidential_namesake_hint", { count: namesakes })}
          </span>
        </span>
      ) : null}
    </>
  );
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
  const abroadTo = presidentialUrl(cycle, "abroad");
  return (
    <div className="space-y-6">
      <section
        aria-labelledby={`pvr-rule-${round.round}`}
        className="rounded-lg border p-4"
      >
        <h2 id={`pvr-rule-${round.round}`} className="font-semibold">
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

      <section aria-labelledby={`pvr-ranking-${round.round}`}>
        <h2 id={`pvr-ranking-${round.round}`} className="font-semibold">
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
                    <PersonName name={r.president} />
                    <span className="block text-muted-foreground">
                      <PersonName name={r.vicePresident} />
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

      {/* ⚠ THE TWIN FIRST, THEN THE MAP. §4: the ranked result precedes the map in the DOM,
          and on mobile that is the visual order too — the list is the accessible result as
          well as the faster scan. Here it is load-bearing twice over: 17 of 2021's 23 tickets
          carry a NEUTRAL-palette colour, because an инициативен комитет has no party colour to
          inherit, so several fills are near-indistinguishable greys — and the table is the
          only route from this page down to an oblast.

          ⚠ BOTH OR NEITHER, gated on the roll-up having ANSWERED. They used to appear and
          disappear separately: the list returns null with no rows while the map rendered 31
          keyboard buttons asserting „няма подадени гласове" — a choropleth with no text
          equivalent at all, saying something false, in the state this corpus is usually in. */}
      {leaders.size > 0 ? (
        <section aria-labelledby={`pvr-where-${round.round}`}>
          {/* ⚠ VISIBLE, NOT `sr-only`. The shell renders a map's question as a visible heading
              on every other kind, and hiding it here would make the same information sighted-
              reader-only on the one page that draws its map outside the shell. */}
          <h2
            id={`pvr-where-${round.round}`}
            className="font-semibold"
            data-map-question
          >
            {t("presidential_map_q_who_led_region")}
          </h2>
          <PresidentialRegionsList
            cycle={cycle}
            leaders={leaders}
            tickets={tickets}
          />
          <PresidentialRegionsMap
            cycle={cycle}
            round={round.round}
            leaders={leaders}
            tickets={tickets}
          />
        </section>
      ) : null}

      <section aria-labelledby={`pvr-turnout-${round.round}`}>
        <h2 id={`pvr-turnout-${round.round}`} className="font-semibold">
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
        <h2 id={`pvr-abroad-${round.round}`} className="font-semibold">
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
        <h1 className="text-xl font-semibold">
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
        <h1 className="text-xl font-semibold">
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
            <PersonName name={summary.winner.president} />
          </strong>
          {" · "}
          <PersonName name={summary.winner.vicePresident} />
        </p>
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
          <h2 id="pvr-swing" className="font-semibold">
            {t("presidential_swing_heading")}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {summary.swing.tickets.map((s) => (
              <li key={s.number}>
                {/* The same rule as the ranked rows — one component, so a name cannot be a
                    link in one list and bare text in the other on the same page. */}
                <PersonName name={s.president} />
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
          <h2 id="pvr-transfer" className="font-semibold">
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
