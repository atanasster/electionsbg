// „Проблемни гласове по кандидат" — the parliamentary `ProblemVotesByPartyTile`, with a
// candidate pair where that one has a party.
//
// ⚠⚠ THE LAST COLUMN IS „В СТРАНАТА" AND NOT „Δ П.П.", AND THAT IS THE ONE DELIBERATE
// DIVERGENCE FROM THE PARLIAMENTARY TILE. A Δ against the previous cycle is not computable
// here: 2011 locates five of the eight districts and 2001 all eight, because sections are
// renumbered between ballots — so „up 6 points on last time" would be a fact about two
// different sets of polling stations. The ticket's PUBLISHED national share is the comparison
// the artifact does support, it occupies the same slot, and it answers the same question a
// reader brings („is this unusual?").
//
// ⚠ THE SHARE'S DENOMINATOR IS THE PUBLISHED BASE — tickets plus „не подкрепям никого" — and
// `neighborhoodScope` owns it, because a place-scoped view divides by a different number than
// the country does. Both columns of one row must sit on one basis: measured on 2016's runoff,
// dividing „Тук" by ticket votes alone put Цачева's gap over the country at +5.24pp against a
// true +3.21pp, and on round 1 it FLIPPED Калфин's sign.
//
// ⚠ THE ROW LIMIT IS A SECOND CUT, ON A DIFFERENT AXIS from the producer's `MIN_PCT` (3% of the
// NATIONAL share) — this one ranks by votes INSIDE the districts. They are not redundant: 2016
// round 1 clears the producer's cut with SEVEN tickets, so this drops the seventh, and the tile
// says so rather than letting a row vanish.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatInt, formatPct } from "@/lib/currency";
import { PresidentialPersonName } from "./PresidentialPersonName";
import type { PresidentialTicket } from "@/data/presidential/useTickets";
import {
  hasScopedContent,
  type ScopedNeighborhoods,
} from "@/data/presidential/neighborhoodScope";

const PCT_DIGITS = 1;
const TOP_TICKETS = 6;

const TH = "px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide";
const TD = "px-2 py-1.5 text-xs tabular-nums";

/** `formatPct` takes a FRACTION; every percentage in this payload is 0-100. */
const pct = (v: number | null | undefined, lang: string) =>
  formatPct(v == null ? null : v / 100, lang, PCT_DIGITS);

export const PresidentialProblemVotesTile: FC<{
  scoped: ScopedNeighborhoods;
  /** Ballot-number → ticket, for the row colour. ⚠ OPTIONAL AND UNGATED: `tickets.json` is a
   *  separate artifact, so a missing colour must cost a grey dot rather than the row. */
  tickets?: Map<number, PresidentialTicket>;
}> = ({ scoped, tickets }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  if (!hasScopedContent(scoped)) return null;

  const rows = scoped.tickets.slice(0, TOP_TICKETS);
  // ⚠ THE BAR IS RELATIVE TO THE LEADER, not to 100% — the parliamentary tile's rule. A
  // presidential round 1 leader takes ~50%, so an absolute bar would leave every row in the
  // left half of its track and the comparison a reader wants would be the hardest to see.
  const maxShare = rows[0]?.pct ?? 0;

  return (
    <StatCard
      label={
        <Hint text={t("presidential_hoods_votes_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Vote className="h-4 w-4" aria-hidden />
            <span>{t("presidential_hoods_votes_title")}</span>
          </div>
        </Hint>
      }
    >
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {t("presidential_hoods_votes_title")}
          </caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className={TH}>
                {t("presidential_hoods_col_ticket")}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                {t("votes")}
              </th>
              <th scope="col" className={TH} aria-hidden />
              <th scope="col" className={`${TH} text-right`}>
                {t("dashboard_share_of_problem_votes")}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                {t("presidential_hoods_col_national")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tk) => {
              const color = tickets?.get(tk.number)?.color ?? "#888";
              const barPct = maxShare ? (100 * tk.pct) / maxShare : 0;
              return (
                <tr key={tk.number}>
                  {/* ⚠ BULGARIAN IN BOTH LANGUAGES AND NEVER TRANSLITERATED — a reader is
                      matching these against a ballot. `PresidentialPersonName` refuses a name
                      the corpus cannot resolve to exactly one person, so a candidate who is a
                      link in the ranking above cannot be bare text here by coincidence. */}
                  <th scope="row" className="px-2 py-1.5 text-left font-medium">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="whitespace-nowrap">
                        <PresidentialPersonName name={tk.president} />
                      </span>
                    </span>
                  </th>
                  <td
                    className={`${TD} whitespace-nowrap text-right text-muted-foreground`}
                  >
                    {formatInt(tk.votes, lang)}
                  </td>
                  <td className="px-2 py-1.5 w-[12rem] min-w-[5rem]">
                    <span className="relative block h-2 overflow-hidden rounded-full bg-muted">
                      <span
                        className="absolute bottom-0 left-0 top-0 rounded-full"
                        style={{
                          width: `${Math.max(2, Math.min(100, barPct))}%`,
                          backgroundColor: color,
                        }}
                      />
                    </span>
                  </td>
                  <td
                    className={`${TD} whitespace-nowrap text-right font-semibold`}
                  >
                    {pct(tk.pct, lang)}
                  </td>
                  <td
                    className={`${TD} whitespace-nowrap text-right text-muted-foreground`}
                  >
                    {pct(tk.pctNational, lang)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {scoped.tickets.length > TOP_TICKETS ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("presidential_hoods_more_tickets", {
            count: scoped.tickets.length - TOP_TICKETS,
          })}
        </p>
      ) : null}
    </StatCard>
  );
};
