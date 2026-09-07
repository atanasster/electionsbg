// The runoff transition matrix as a RANKED TABLE — the form a 26-node round-1 side needs.
//
// ⚠⚠ THIS IS THE DEFAULT FOR A WIDE MATRIX, NOT A FALLBACK, AND THE NUMBER SAYS SO. 2021's
// round-1 ballot carried 23 tickets, so its matrix is 26 → 5; the parliamentary Sankey draws
// ~11 nodes a side and is already dense. Twenty-six ribbons converging on two candidates
// cannot be traced by eye — a reader cannot answer „where did Каракачанов's voters go", which
// is the only question this artifact exists to answer. The chart stays for the narrow cycles
// (2001 has 8 from-nodes, 2006 has 9), where it reads well.
//
// ⚠ ONE ROW PER ROUND-1 LANE, ONE COLUMN PER RUNOFF LANE, AND EVERY CELL IS A SHARE OF ITS
// ROW. „Of Каракачанов's 190,344 round-1 voters, an estimated 61.8% went to Радев" is the
// sentence; a column share would answer a different question („of Радев's runoff vote, 8% came
// from Каракачанов") and the two are constantly confused. The row's own round-1 total is
// printed beside it so the share has a visible denominator.
//
// ⚠ THE ROWS ARE TICKETS FIRST, THEN THE THREE STRUCTURAL LANES, and that is not a votes sort.
// „Не гласували" is the largest from-node in every cycle — 4.5M against Радев's 1.02M in 2021 —
// so a pure votes ranking opens the table with three rows about nobody. Tickets rank among
// themselves by round-1 votes; the pseudo lanes keep the producer's own order underneath.
//
// ⚠ A MISSING CELL IS „—", NEVER 0%. An edge below the producer's absolute floor was DROPPED,
// not measured at zero, and „0%" is a claim that none of this candidate's voters went there.
// The tile prints `marginGap` beneath for the same reason: the row's cells do not add to 100%.
//
// ⚠ AND A CELL BELOW THE PRINTED FLOOR READS „< 0,1%", NOT „0%", which is the same rule one
// step further in. Карадайъ → недействителни is a real estimated flow of 121 voters against
// 222,581, and at one decimal it prints „0%" — indistinguishable from the „—" two columns over,
// and a stronger claim than either. Widening the decimals instead would put „0,05%" on a table
// whose own precision note says the rows do not add to 100%.
//
// ⚠ „BELOW THE FLOOR", not „rounds to zero", and the two differ. At one decimal a share only
// rounds to zero below 0.05%, so the three corpus cells in [0.05%, 0.1%) would print a true
// „0,1%" and instead print „< 0,1%". Both statements are true; the wider predicate is chosen
// because „< 0,1%" and „0,1%" say the same thing to a reader while „0%" does not, and because a
// rule keyed on the PRINTED floor cannot drift when `PCT_DIGITS` moves.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import type {
  VoteFlowMatrix,
  VoteFlowNode,
} from "@/data/voteFlows/voteFlowTypes";
import { formatInt, formatPct } from "@/lib/currency";
import { PresidentialPersonName } from "./PresidentialPersonName";

/** ⚠ THE THRESHOLD IS ABOUT THE CHART, so it lives beside the table that replaces it rather
 *  than inside either renderer. Measured across the five cycles: 8, 9, 20, 24, 26 from-nodes.
 *  Twelve sits above the parliamentary Sankey's own density (~11 a side, and already dense)
 *  and below the first cycle that needs the table, so 2001 and 2006 keep the chart and
 *  2011 / 2016 / 2021 get the table. */
export const SANKEY_MAX_FROM_NODES = 12;

const PCT_DIGITS = 1;
/** The smallest share `PCT_DIGITS` can print. Anything positive below it reads „< this". */
const PCT_FLOOR = 10 ** -PCT_DIGITS / 100;

/** Tickets by round-1 votes, then the structural lanes in the producer's own order. */
const rankRows = (nodes: VoteFlowNode[]): VoteFlowNode[] => [
  ...nodes.filter((n) => !n.pseudo).sort((a, b) => b.votes - a.votes),
  ...nodes.filter((n) => n.pseudo),
];

export const PresidentialTransferTable: FC<{ matrix: VoteFlowMatrix }> = ({
  matrix,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isEn = lang === "en";
  const labelOf = (n: VoteFlowNode) => (isEn ? n.labelEn : n.label);
  const rows = rankRows(matrix.fromNodes);
  const cols = rankRows(matrix.toNodes);
  // ⚠ KEYED ON BOTH ENDS, in one flat map. The matrix is at most 26 x 5, so a per-row index
  // buys nothing and is one more structure that can go stale against `flows`.
  const cell = new Map(matrix.flows.map((f) => [`${f.from} ${f.to}`, f.votes]));

  return (
    <div className="overflow-x-auto">
      {/* ⚠ `min-w`, NOT JUST `overflow-x-auto`. A `width:100%` auto-layout table collapses to
          MIN-CONTENT on a narrow viewport instead of scrolling, and with seven columns and 26
          rows that wraps „Красимир Каракачанов" word by word into a ragged wall — the exact
          readability problem this table exists to fix. `judiciary/TierTable.tsx` pins the same
          640px for the same reason. */}
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">
          {t("presidential_transfer_table_caption")}
        </caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="px-2 py-1.5">
              {t("presidential_transfer_table_col_line")}
            </th>
            <th
              scope="col"
              className="whitespace-nowrap px-2 py-1.5 text-right"
            >
              {t("presidential_transfer_table_col_round1_votes")}
            </th>
            {cols.map((c) => (
              <th key={c.id} scope="col" className="px-2 py-1.5 text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                    style={{ backgroundColor: c.color }}
                  />
                  <span>{labelOf(c)}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <th scope="row" className="px-2 py-1.5 text-left font-normal">
                <span className="inline-flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                    style={{ backgroundColor: r.color }}
                  />
                  {/* ⚠ THE SAME LINK RULE AS EVERY OTHER PRESIDENTIAL NAME on the page — one
                      component, so a candidate cannot be a link in the ranked list and bare
                      text here. A structural lane is not a person and is never linked. */}
                  {/* ⚠ `r.label`, NOT `labelOf(r)`. `personHrefForTicket` keys on the
                      BULGARIAN spelling `tickets.json` prints, and `labelEn === label` for
                      every ticket in every cycle today — a person's name is not translated —
                      so this reads as a pointless asymmetry. Tidying it to `labelOf` would
                      de-link the whole EN table the day a producer change transliterates one
                      name, and would look correct and pass every test until then. */}
                  <span>
                    {r.pseudo ? (
                      labelOf(r)
                    ) : (
                      <PresidentialPersonName name={r.label} />
                    )}
                  </span>
                </span>
              </th>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                {formatInt(r.votes, lang)}
              </td>
              {cols.map((c) => {
                const votes = cell.get(`${r.id} ${c.id}`);
                // ⚠ TWO REASONS, ONE GLYPH, and the second is unreachable today: no cycle has
                // ever carried a zero-vote from-node (measured across 8/9/20/24/26 nodes on the
                // five cycles). The guard is what makes the division below safe; if such a row
                // ever appears it needs its own mark, because „no share to compute" is a
                // different kind of ignorance from „below the estimate's floor".
                if (votes === undefined || r.votes <= 0)
                  return (
                    <td
                      key={c.id}
                      className="px-2 py-1.5 text-right tabular-nums"
                    >
                      <span
                        aria-hidden="true"
                        className="text-muted-foreground"
                      >
                        {t("presidential_transfer_table_none")}
                      </span>
                      {/* ⚠ THE RULE, NOT THE GLYPH, FOR A SCREEN READER. The whole design turns
                          on „—" meaning something different from „0%", and an em dash announced
                          alone (or skipped) carries none of it — the distinction a non-visual
                          reader most needs is the one the note under the table gives only to a
                          sighted one. */}
                      <span className="sr-only">
                        {t("presidential_transfer_table_none_a11y")}
                      </span>
                    </td>
                  );
                const share = votes / r.votes;
                return (
                  <td
                    key={c.id}
                    className="px-2 py-1.5 text-right tabular-nums"
                  >
                    {/* ⚠ NOT A `title`. The absolute flow is the EVIDENCE behind the
                        percentage, and a tooltip reaches a mouse and nothing else — the rule
                        `PresidentialPersonName` states in its own header, two imports up. So
                        the count becomes the cell's accessible NAME, with its unit and both
                        ends of the flow, rather than a bare unlabelled number. */}
                    <span
                      aria-label={t("presidential_transfer_table_cell_a11y", {
                        votes: formatInt(votes, lang),
                        from: labelOf(r),
                        to: labelOf(c),
                      })}
                    >
                      {share > 0 && share < PCT_FLOOR
                        ? t("presidential_transfer_table_tiny", {
                            pct: formatPct(PCT_FLOOR, lang, PCT_DIGITS),
                          })
                        : formatPct(share, lang, PCT_DIGITS)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {/* ⚠ THE THRESHOLD IS INTERPOLATED, never typed into the copy. `PCT_FLOOR` is derived
          from `PCT_DIGITS`, so a hardcoded „< 0,1%" in the note becomes a sentence contradicting
          the table above it the moment either moves — the one drift this whole component's
          doctrine is against, and the reason `transfer.basis` is rendered from the artifact. */}
      <p className="mt-2 text-xs text-muted-foreground">
        {t("presidential_transfer_table_note", {
          pct: formatPct(PCT_FLOOR, lang, PCT_DIGITS),
        })}
      </p>
    </div>
  );
};
