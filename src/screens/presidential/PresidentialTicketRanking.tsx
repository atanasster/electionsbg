// The concise ticket list that sits BESIDE the country map — `/parliamentary`'s ranked result,
// for a presidential ballot.
//
// ⚠ IT IS THE MAP'S TEXT EQUIVALENT, WHICH IS WHY IT EXISTS AT ALL. §4's rule is that a map
// always has one and that colour is never the only encoding of a winner; on `/parliamentary`
// that equivalent is the party ranking beside the map, and this page's canvas used to put the
// per-OBLAST table there instead — a different question, answered one level down. The route down
// to an oblast is the map itself (every region is a keyboard-operable link) and the „Топ
// изборни райони" tile under „География", as on `/parliamentary`.
//
// ⚠ A PREVIEW THAT EXPANDS IN PLACE, NOT A LINK TO A SECOND TABLE. 2021 round 1 carried 23
// tickets; the shell's own preview caps at eight, so this does too, and the caption offers the
// rest rather than truncating in silence. There used to be a full table further down the page
// that repeated every row of this one; expanding here answers the same need without the page
// printing the national result twice.
//
// ⚠ THE COLOUR IS A SECOND ENCODING, NEVER THE ONLY ONE, and it is frequently ABSENT. 17 of
// 2021's 23 tickets carry a neutral-palette slot because an инициативен комитет has no party
// colour to inherit, and `tickets.json` is served from the gitignored presidential tree — so a
// missing swatch is the ordinary state here, and every row still carries its name, its votes
// and its share.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatInt, formatPct } from "@/lib/currency";
import type { PresidentialSummaryRound } from "@/data/presidential/summary";
import type { PresidentialTicket } from "@/data/presidential/useTickets";
import { PresidentialPersonName } from "./PresidentialPersonName";

/** The shell's own preview cap. Eight rows is what `/parliamentary` shows beside its map. */
const PREVIEW_ROWS = 8;

/** ⚠ THE SAME DIGITS THE FULL TABLE PRINTS. Two renderings of one share that round differently
 *  read as two different numbers for the same ticket, on one page. */
const PCT_DIGITS = 2;

export const PresidentialTicketRanking: FC<{
  round: PresidentialSummaryRound;
  tickets: Map<number, PresidentialTicket>;
}> = ({ round, tickets }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [expanded, setExpanded] = useState(false);
  const canExpand = round.ranking.length > PREVIEW_ROWS;
  const shown = expanded ? round.ranking : round.ranking.slice(0, PREVIEW_ROWS);
  // ⚠ SCALED TO THE LEADER, NOT TO 100% — `/parliamentary`'s rule, and the only scale on which a
  // 0.1% ticket is a visible bar rather than a hairline. It is a comparison WITHIN the preview
  // and never a claim about the ballot, which is why the share is printed beside it.
  const maxPct = Math.max(0.01, ...shown.map((r) => r.shareOfValid));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {/* ⚠ THE TABLE'S OWN `<caption>`, and the flex goes on a span INSIDE it: `display: flex`
            overrides `display: table-caption`, which takes the element out of the caption box
            and lays it out beside the first column. Same fix, same reason, as the shell's. */}
        <caption className="mb-2 text-left">
          <span className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {t("election_ranked_caption")}
            </span>
            {canExpand ? (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
                className="text-xs text-primary hover:underline"
              >
                {expanded
                  ? t("presidential_ranking_show_less")
                  : t("presidential_ranking_show_all", {
                      total: round.ranking.length,
                    })}
              </button>
            ) : null}
          </span>
        </caption>
        <thead>
          <tr>
            <th scope="col" className="text-left">
              {t("election_col_entry")}
            </th>
            <th scope="col" className="pl-2 text-right font-normal sm:pl-3">
              {t("presidential_col_votes")}
            </th>
            <th scope="col" className="pl-2 text-right font-normal sm:pl-3">
              {t("presidential_col_share")}
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const color = tickets.get(r.number)?.color;
            const barPct = Math.max(2, (r.shareOfValid / maxPct) * 100);
            return (
              <tr key={r.number}>
                <th scope="row" className="py-1 text-left font-normal">
                  {/* ⚠ THE NAME WRAPS, IT DOES NOT TRUNCATE, and that is the one place this row
                      departs from the shell's. The shell's entry is a party — „ГЕРБ-СДС",
                      „ПП-ДБ" — and `truncate` on it costs nothing; here it is a three-part
                      Bulgarian personal name, and a clipped „Румен Георгиев Ра…" is unusable for
                      the thing a reader is doing with it, which is matching it against a ballot
                      or a protocol scan. Measured at 375 px: with the name on one line the table
                      wants 442 px in a 359 px slot, so the share column — the bar AND the
                      percentage — sits outside the scroll box on the first screen of the page.
                      Wrapping keeps all three columns visible and costs a second line on the
                      longest names. */}
                  <span className="flex min-w-0 items-start gap-2">
                    {color ? (
                      <span
                        aria-hidden
                        className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    ) : null}
                    {/* ⚠ BULGARIAN IN BOTH LANGUAGES AND NEVER TRANSLITERATED — a reader is
                        matching this against a ballot or a protocol scan, both Cyrillic. */}
                    <span className="min-w-0 font-medium">
                      <PresidentialPersonName name={r.president} />
                    </span>
                  </span>
                </th>
                {/* ⚠ THE VOTE COUNT ONE SIZE DOWN, as the shell prints it. Cosmetic on a wide
                    canvas and not on a phone, where three full-size columns do not fit the
                    slot and the last one can only be reached by scrolling. */}
                <td className="py-1 pl-2 text-right text-xs tabular-nums text-muted-foreground sm:pl-3">
                  {formatInt(r.votes, lang)}
                </td>
                <td className="py-1 pl-2 text-right tabular-nums sm:pl-3">
                  <span className="flex items-center justify-end gap-2">
                    {/* ⚠ ONE ELEMENT AND A GRADIENT, not a track with a fill inside it — and
                        `aria-hidden`, because the bar IS the number beside it and a screen
                        reader reading both says the share twice. */}
                    <span
                      aria-hidden
                      className="h-2 min-w-[28px] flex-1 rounded-full bg-muted"
                      style={{
                        backgroundImage: `linear-gradient(to right, ${color ?? "#888"} ${barPct}%, transparent ${barPct}%)`,
                      }}
                    />
                    <span>{formatPct(r.shareOfValid, lang, PCT_DIGITS)}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
