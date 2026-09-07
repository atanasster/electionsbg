// The concise ticket list that sits BESIDE the country map — `/parliamentary`'s ranked result,
// for a presidential ballot.
//
// ⚠ IT IS THE MAP'S TEXT EQUIVALENT, WHICH IS WHY IT EXISTS AT ALL. §4's rule is that a map
// always has one and that colour is never the only encoding of a winner; on `/parliamentary`
// that equivalent is the party ranking beside the map, and this page's canvas used to put the
// per-OBLAST table there instead — a different question, answered one level down. The oblast
// table has not gone anywhere (`PresidentialRegionsList`, immediately below the canvas): it is
// still the map's per-region twin and still the only route from here down to an oblast page.
// What changed is that the first thing beside the map is now the national result, as it is on
// every other kind.
//
// ⚠ A PREVIEW, NOT THE RESULT. 2021 round 1 carried 23 tickets; the shell's own preview caps at
// eight, so this does too, and the caption LINKS to the full table rather than truncating in
// silence. The full table is where the vice-president and the nominator live — three columns
// that do not fit a canvas column and, for an инициативен комитет, are the difference between a
// committee and a party.
//
// ⚠ THE COLOUR IS A SECOND ENCODING, NEVER THE ONLY ONE, and it is frequently ABSENT. 17 of
// 2021's 23 tickets carry a neutral-palette slot because an инициативен комитет has no party
// colour to inherit, and `tickets.json` is served from the gitignored presidential tree — so a
// missing swatch is the ordinary state here, and every row still carries its name, its votes
// and its share.

import { FC } from "react";
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
  /** In-page anchor to the full table — the `id` of its heading. */
  detailsHref: string;
}> = ({ round, tickets, detailsHref }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const shown = round.ranking.slice(0, PREVIEW_ROWS);
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
            {round.ranking.length > shown.length ? (
              <a
                href={detailsHref}
                className="text-xs text-primary hover:underline"
              >
                {t("dashboard_see_details")} →
              </a>
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
