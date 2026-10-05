// The hover card for one place on a presidential map — the presidential twin of the
// parliamentary map's `PartyVotesXS` card: the place as a heading, then the leading tickets with
// their votes and share, so a reader sees the RESULT on hover rather than one sentence about the
// leader.
//
// ⚠ ONE BLOCK PER ROUND, AND EACH IS LABELLED. Round 1 and the runoff are different electorates
// and different fields of candidates, so the two blocks are never merged into one list — and the
// round on screen is marked, because a card that showed the other round's leader first would read
// as a contradiction of the colour under the cursor.
//
// ⚠ THE SHARE IS OF THE TICKET VOTES IN THAT PLACE, the same denominator `leadersByPlace` (and so
// the map's fill and its aria-label) uses. „Не подкрепям никого" is valid and is not in the
// roll-up, so this is „share of the vote cast for a pair" — a different number from the national
// table's share of valid votes, and the card must not be read as that one.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { formatInt, formatPct } from "@/lib/currency";
import type { RollupEntry } from "@/data/presidential/useRoundRollup";
import type { PresidentialTicket } from "@/data/presidential/useTickets";

/** Rows per round. Four is what the parliamentary card shows; a runoff has two. */
const TIP_ROWS = 4;

export type PresidentialTipRound = {
  round: 1 | 2;
  /** This place's row in that round's roll-up — `undefined` when the round's file has not
   *  loaded, or the place cast nothing in it. */
  entry?: RollupEntry;
};

export const PresidentialPlaceTip: FC<{
  title: string;
  rounds: PresidentialTipRound[];
  tickets: Map<number, PresidentialTicket>;
  /** The round the map is coloured by — marked in the card. */
  current: 1 | 2;
}> = ({ title, rounds, tickets, current }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const blocks = rounds
    .map((r) => {
      const votes = r.entry?.results.votes ?? [];
      const total = votes.reduce((a, v) => a + v.totalVotes, 0);
      // Ties break on the ballot number — the same order `foldPlace` picks a leader by.
      const top = votes
        .filter((v) => v.totalVotes > 0)
        .sort((a, b) => b.totalVotes - a.totalVotes || a.partyNum - b.partyNum)
        .slice(0, TIP_ROWS);
      return { round: r.round, total, top };
    })
    .filter((b) => b.total > 0);
  return (
    <div className="text-left" data-presidential-tip>
      <div className="pb-1 text-center text-lg">{title}</div>
      {blocks.length === 0 ? (
        <div className="text-[11px] opacity-70">
          {t("presidential_tip_no_votes")}
        </div>
      ) : (
        blocks.map((b) => (
          <div
            key={b.round}
            className={`mt-1 first:mt-0 ${b.round === current ? "" : "opacity-75"}`}
            data-tip-round={b.round}
          >
            <div className="mb-0.5 flex items-baseline justify-between gap-3 text-[10px] uppercase tracking-wide opacity-70">
              <span className={b.round === current ? "font-semibold" : ""}>
                {t("election_round", { round: b.round })}
              </span>
              <span className="tabular-nums">
                {formatInt(b.total, lang)} {t("votes")}
              </span>
            </div>
            <table className="w-full border-collapse text-[11px] leading-tight">
              <tbody>
                {b.top.map((v) => {
                  const ticket = tickets.get(v.partyNum);
                  return (
                    <tr key={v.partyNum} className="font-medium">
                      <td className="py-0.5 pr-2">
                        <div className="flex max-w-[180px] items-center gap-1.5">
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2 shrink-0 rounded-sm"
                            style={{
                              backgroundColor: ticket?.color ?? "lightgrey",
                            }}
                          />
                          {/* ⚠ BULGARIAN IN BOTH LANGUAGES — a reader matches it against a
                              ballot, and the ballot is Cyrillic. */}
                          <span className="truncate">
                            {ticket?.president ?? `№ ${v.partyNum}`}
                          </span>
                        </div>
                      </td>
                      <td className="py-0.5 pr-2 text-right tabular-nums opacity-90">
                        {formatInt(v.totalVotes, lang)}
                      </td>
                      <td className="py-0.5 text-right font-semibold tabular-nums">
                        {formatPct(v.totalVotes / b.total, lang, 1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
};
