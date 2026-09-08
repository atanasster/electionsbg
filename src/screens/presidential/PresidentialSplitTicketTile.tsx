// „Едната бюлетина, другата бюлетина" — the ПВР ticket against the same nominator's НС list,
// for the one cycle whose presidential vote shared its day with a parliamentary one.
//
// ⚠⚠ EVERY NUMBER HERE IS A FLOOR, AND THE COPY SAYS „ПОНЕ" EVERY TIME. Nobody sees which
// ballot a voter put in which box. What is seen is that in a section N people chose the list
// and M chose the ticket — two sets drawn from that section's voters — so at least |N−M| of
// them voted differently on the two. „X% of the party's voters abandoned its candidate" is the
// sentence this tile exists to NOT write.
//
// ⚠ THE REFUSED LIST IS RENDERED, NOT HIDDEN. Nine of 2021's 23 tickets were nominated by
// инициативни комитети and have no list to compare against — including BOTH finalists. A tile
// showing only the fourteen comparable ones would read as „these are the candidates", with the
// two everyone came to read about quietly missing. The parties that backed Радев and Герджиков
// are a political fact the ballot does not record and this repo does not assert.
//
// ⚠ THE CAVEAT COMES FROM THE ARTIFACT (`basis` / `basisEn`), so a producer change reaches the
// reader with the numbers rather than waiting for somebody to remember a locale file.
// `useSplitTicket` refuses a payload that has lost it.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Split } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatInt } from "@/lib/currency";
import type { SplitTicket } from "@/data/presidential/useSplitTicket";

export const PresidentialSplitTicketTile: FC<{ split: SplitTicket }> = ({
  split,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isEn = lang === "en";
  const runoffRefusals = split.refused.filter((r) => r.reachedRunoff);
  const committee = split.refused.filter((r) => r.reason === "committee");
  const unmatched = split.refused.filter((r) => r.reason !== "committee");

  return (
    <StatCard
      label={
        <Hint text={t("presidential_split_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Split className="h-4 w-4" />
            <span>{t("presidential_split_title")}</span>
          </div>
        </Hint>
      }
    >
      {/* ⚠ THE DERIVATION FIRST. Under the table, a reader who stops at the numbers has read a
          measurement where the data supports only a minimum. */}
      <p className="text-xs text-muted-foreground">
        {isEn ? split.basisEn : split.basis}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          {/* ⚠ NAMES LEFT, NUMBERS RIGHT — and the `text-left` on `<thead>` reaches ONLY these
              header cells. A `<th>` defaults to `text-align: center`, so the row headers in
              `<tbody>` below need their own `text-left`: without it every district name sat
              centred in its column while the counts beside it sat left, i.e. the site's
              alignment rule inverted in both columns at once. */}
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-3 font-normal">
                {t("presidential_split_col_pair")}
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-normal">
                {t("presidential_split_col_ticket")}
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-normal">
                {t("presidential_split_col_list")}
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                {t("presidential_split_col_min")}
              </th>
            </tr>
          </thead>
          <tbody>
            {split.pairs.map((p) => (
              <tr key={p.number} className="border-t">
                <th scope="row" className="py-1 pr-3 text-left font-normal">
                  {p.president}
                  <span className="text-muted-foreground">
                    {" · "}
                    {p.listName}
                  </span>
                </th>
                <td className="py-1 pr-3 text-right">
                  {formatInt(p.ticketVotes, lang)}
                </td>
                <td className="py-1 pr-3 text-right">
                  {formatInt(p.listVotes, lang)}
                </td>
                {/* ⚠ „ПОНЕ" IS IN THE CELL, not only in the column head — a figure copied out
                    of a table takes its caption with it only if the caption is beside it. */}
                <td className="py-1 text-right">
                  {t("presidential_split_at_least", {
                    votes: formatInt(p.minSplitVoters, lang),
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {split.refused.length ? (
        <div className="mt-3 text-xs text-muted-foreground">
          {/* ⚠⚠ TWO ARMS, BECAUSE THEY ARE TWO DIFFERENT CLAIMS. `committee` is a fact about
              the BALLOT — this pair was put up by an инициативен комитет. The others are facts
              about OUR MATCHER: the nominator IS on the ballot and we could not confirm which
              list is theirs. Describing the second as committee-nominated invents a nominator
              kind the register did not record — the same unsupported attribution this tile
              exists to refuse, pointed the other way. `nominatedBy.kind` is „unknown" for 10 of
              2021's 14 matched nominators, so the population at risk is most of the table. */}
          {committee.length ? (
            <p>
              {t("presidential_split_refused_committee", {
                count: committee.length,
                names: committee.map((r) => r.president).join(", "),
              })}
            </p>
          ) : null}
          {unmatched.length ? (
            <p className={committee.length ? "mt-1" : undefined}>
              {t("presidential_split_refused_unmatched", {
                count: unmatched.length,
                names: unmatched.map((r) => r.president).join(", "),
              })}
            </p>
          ) : null}
          {runoffRefusals.length ? (
            <p className="mt-1">
              {t("presidential_split_refused_finalists", {
                names: runoffRefusals.map((r) => r.president).join(", "),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        {isEn ? split.coverage.basisEn : split.coverage.basis}{" "}
        {/* ⚠ THE UNMATCHED SECTIONS ARE NAMED, not left as a difference a reader has to find.
            They are the ones cast abroad — the presidential tree keeps those in `abroad.json`
            rather than in `tur1/sections` — and they take ДПС's list figure to 253,257 against
            a published national 341,000. The FLOOR is unaffected: a subset of disjoint sections
            yields a weaker bound, never an overstated one. */}
        {split.coverage.sectionsNsOnly
          ? t("presidential_split_coverage_abroad", {
              sections: formatInt(split.coverage.sectionsMatched, lang),
              abroad: formatInt(split.coverage.sectionsNsOnly, lang),
            })
          : t("presidential_split_coverage", {
              sections: formatInt(split.coverage.sectionsMatched, lang),
            })}
      </p>
    </StatCard>
  );
};
