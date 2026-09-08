// „Проблемни секции" for a presidential round — the parliamentary dashboard's own tile, with a
// candidate pair where that one has a party.
//
// ⚠⚠ THE SAME COLUMNS AS `ProblemSectionsTile`, DELIBERATELY, AND ONE MORE. A reader who has
// learned the shape of `/parliamentary`'s risk-votes block must find the same shape here:
// quarter, sections, voted, turnout, the leader with a share bar, votes, share. The extra
// column is „Недействителни", and it is the one the SOURCES are about — СЕГА's headline is that
// invalid ballots ran above 40% in the big Roma neighbourhoods — so dropping it to match the
// parliamentary column count exactly would delete the measurement the section exists for.
//
// ⚠ IT IS A REAL `<table>` WEARING THE PARLIAMENTARY TILE'S TYPOGRAPHY, not that tile's grid of
// bare `<span>`s. The look is the same — micro-caps headers, tabular figures, a share bar — and
// the row headers and caption this family already had survive, which a CSS grid cannot express
// without `role` attributes that lie about a structure it does not have.
//
// ⚠⚠ THE CAVEAT COMES FROM THE ARTIFACT AND RENDERS ABOVE THE TABLE. This tile names
// neighbourhoods with an ethnicity attached to them in the press, so a reader who stops at the
// first row must already have read that these are sums over POLLING STATIONS and not a
// statement about how any community voted. `usePresidentialNeighborhoods` refuses a payload
// that lost the sentence, so „the table rendered" implies „the caveat rendered".
//
// ⚠⚠ EVERY DISTRICT LINKS TO THE REPORT THAT NAMED IT. „Рискови" is a claim, and it is not
// ours: the catalogue is curated from Ромски фонд „Рома", СЕГА and Свободна Европа, and
// `sourceUrl` is how a reader checks it rather than taking our word. It rides in the same
// sub-line the parliamentary tile puts the city on — „Пловдив · източник".
//
// ⚠ THE RATE LINES AND THE COVERAGE FOOTNOTE ARE COUNTRY-SCOPE ONLY. Both are statements about
// the whole matched set against the whole country; recomputing them for one oblast's districts
// would need the producer's two publication floors (`INVALID_MIN_PAPER`,
// `ADDITIONAL_MIN_ACTUAL`) restated in the browser, and a floor copied into a second
// implementation is a floor that drifts. A place page gets its own one-line coverage sentence
// instead, which is arithmetic over the rows it is already showing.
//
// ⚠ THE COMPARISON IS ALWAYS AGAINST THE COUNTRY, never against another cycle — 2011 locates
// five of the eight districts and 2001 all eight, because sections are renumbered. „Up 6 points
// on last time" would be a fact about two different sets of stations, which is why this family
// has no Δ column where the parliamentary one does.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatInt, formatPct } from "@/lib/currency";
import { PresidentialPersonName } from "./PresidentialPersonName";
import type { PresidentialTicket } from "@/data/presidential/useTickets";
import type {
  NeighborhoodPlace,
  PresidentialNeighborhoods,
} from "@/data/presidential/useNeighborhoods";
import {
  hasScopedContent,
  type ScopedNeighborhoods,
} from "@/data/presidential/neighborhoodScope";

const PCT_DIGITS = 1;

/** `formatPct` takes a FRACTION; every percentage in this payload is 0-100. */
const pct = (v: number | null | undefined, lang: string) =>
  formatPct(v == null ? null : v / 100, lang, PCT_DIGITS);

/** The parliamentary tile's header type, in one place so nine columns cannot drift apart. */
const TH = "px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide";
const TD = "px-2 py-1.5 text-xs tabular-nums";

export const PresidentialProblemSectionsTile: FC<{
  neighborhoods: PresidentialNeighborhoods;
  scoped: ScopedNeighborhoods;
  /** Ballot-number → ticket, for the leader's colour. ⚠ OPTIONAL AND UNGATED: `tickets.json`
   *  is a separate artifact, so a missing colour must cost a grey dot rather than the row. */
  tickets?: Map<number, PresidentialTicket>;
}> = ({ neighborhoods, scoped, tickets }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isEn = lang === "en";

  // ⚠ THE SAME PREDICATE THE SECTION GATES ON, so this tile can never be the thing that keeps
  // an otherwise empty heading standing.
  if (!hasScopedContent(scoped)) return null;

  const { coverage, national, totals } = neighborhoods;
  const country = scoped.scope.level === "country";
  const nameOf = (p: Pick<NeighborhoodPlace, "name_bg" | "name_en">) =>
    isEn ? p.name_en || p.name_bg : p.name_bg;
  const cityOf = (p: Pick<NeighborhoodPlace, "city_bg" | "city_en">) =>
    isEn ? p.city_en || p.city_bg : p.city_bg;

  return (
    <StatCard
      label={
        <Hint
          text={t("presidential_hoods_hint", {
            // ⚠ FROM THE PAYLOAD, NOT THE COPY. `PROBLEM_NEIGHBORHOODS` is a shared catalogue
            // this tile does not own; a ninth entry would make a hard-coded „осем" quietly
            // false on the most sensitive string on the page, with nothing failing.
            catalogue: formatInt(coverage.catalogue, lang),
          })}
          underline={false}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            <span>{t("problem_sections")}</span>
          </div>
        </Hint>
      }
    >
      {/* ⚠ THE CAVEAT FIRST, ABOVE THE NAMES — at every scope. */}
      <p className="text-xs text-muted-foreground">
        {isEn ? neighborhoods.basisEn : neighborhoods.basis}
      </p>

      {/* ⚠ THE TWO RATES THE SOURCE REPORTING IS ABOUT, each beside the country's own. „7,6%
          недействителни" says nothing until a reader knows the country ran at 6,4%. Country
          scope only — see the file header. */}
      {country ? (
        <ul className="mt-3 space-y-1 text-xs">
          <li>
            {/* ⚠ „В СЕКЦИИТЕ В СТРАНАТА", not „в страната". Both sides of this comparison are
                domestic section sums, and the PUBLISHED national turnout — rendered a few
                sections down this same page — includes abroad and is higher (40,3% against
                37,2% on 2021 round 1). */}
            {t("presidential_hoods_rate_turnout_domestic", {
              here: pct(totals.turnoutPct, lang),
              national: pct(national.turnoutPct, lang),
            })}
          </li>
          <li>
            {/* ⚠⚠ A SUPPRESSED RATE SAYS WHY. The producer withholds it when the districts
                voted on machines — 228 paper ballots across all of 2021's round 1 — and „—"
                alone would read as a gap in our data rather than as a ballot that was not on
                paper. */}
            {totals.invalidPct == null
              ? t("presidential_hoods_invalid_unmeasurable", {
                  paper: formatInt(totals.paperBallots, lang),
                })
              : t("presidential_hoods_rate_invalid", {
                  here: pct(totals.invalidPct, lang),
                  national: pct(national.invalidPct, lang),
                })}
          </li>
        </ul>
      ) : null}

      {/* ⚠ IT SCROLLS INSIDE ITS OWN CONTAINER rather than widening the page — nine columns do
          not fit a phone, and the repo's rule is that wide content never makes the body scroll
          horizontally. */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {t("presidential_hoods_places_caption")}
          </caption>
          <thead>
            {/* ⚠ EVERY CELL IS PADDED, HEADERS INCLUDED — without it „Недействителни" and
                „Водеща двойка" touch in the header row. */}
            <tr className="text-left text-muted-foreground">
              <th scope="col" className={TH}>
                {t("dashboard_neighborhood")}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                {t("dashboard_sections")}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                {t("voted")}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                {t("dashboard_turnout")}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                {t("presidential_hoods_col_invalid")}
              </th>
              <th scope="col" className={TH} colSpan={2}>
                {t("presidential_hoods_col_leader")}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                {t("votes")}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                {t("dashboard_share")}
              </th>
            </tr>
          </thead>
          <tbody>
            {scoped.places.map((p) => {
              const color = p.leader
                ? (tickets?.get(p.leader.number)?.color ?? "#888")
                : "#888";
              return (
                <tr key={p.id}>
                  {/* ⚠ A ROW HEADER, NOT A CELL — so „Столипиново" is announced with each
                      figure beside it rather than eight bare numbers in a row. */}
                  <th
                    scope="row"
                    className="px-2 py-1.5 text-left font-medium max-w-[14rem]"
                  >
                    <span className="block truncate">{nameOf(p)}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {cityOf(p)}
                      {" · "}
                      {/* ⚠ THE SOURCE, NOT A FOOTNOTE. „Рисков" is somebody else's published
                          finding and this is where a reader checks it. */}
                      <a
                        className="underline"
                        href={p.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("source")}
                      </a>
                    </span>
                  </th>
                  <td
                    className={`${TD} whitespace-nowrap text-right font-semibold`}
                  >
                    {formatInt(p.sections, lang)}
                  </td>
                  <td
                    className={`${TD} whitespace-nowrap text-right text-muted-foreground`}
                  >
                    {formatInt(p.actualVoters, lang)}
                  </td>
                  <td
                    className={`${TD} whitespace-nowrap text-right text-muted-foreground`}
                  >
                    {pct(p.turnoutPct, lang)}
                  </td>
                  <td
                    className={`${TD} whitespace-nowrap text-right text-muted-foreground`}
                  >
                    {p.invalidPct == null ? (
                      // ⚠⚠ THE CELL MUST ANSWER ITS OWN COLUMN. On 2021 ALL EIGHT rows are in
                      // this state at once, so a bare „—" reads as eight holes in our data
                      // under a „Недействителни" header. The answer to „how many were invalid"
                      // when nothing was on paper is „there were no paper ballots".
                      <span
                        title={t("presidential_hoods_invalid_unmeasurable", {
                          paper: formatInt(p.paperBallots, lang),
                        })}
                      >
                        {t("presidential_hoods_invalid_no_paper")}
                      </span>
                    ) : (
                      pct(p.invalidPct, lang)
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {p.leader ? (
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        {/* ⚠ BULGARIAN IN BOTH LANGUAGES AND NEVER TRANSLITERATED — a reader
                            is matching these against a ballot or a protocol scan, both
                            Cyrillic. `PresidentialPersonName` refuses a name the corpus cannot
                            resolve to exactly one person, so it links nobody by coincidence. */}
                        <span className="whitespace-nowrap font-medium">
                          <PresidentialPersonName name={p.leader.president} />
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 w-[10rem] min-w-[5rem]">
                    {p.leader ? (
                      <span className="relative block h-2 overflow-hidden rounded-full bg-muted">
                        <span
                          className="absolute bottom-0 left-0 top-0 rounded-full"
                          style={{
                            width: `${Math.max(2, Math.min(100, p.leader.pct))}%`,
                            backgroundColor: color,
                          }}
                        />
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={`${TD} whitespace-nowrap text-right text-muted-foreground`}
                  >
                    {p.leader ? formatInt(p.leader.votes, lang) : "–"}
                  </td>
                  <td
                    className={`${TD} whitespace-nowrap text-right font-semibold`}
                  >
                    {p.leader ? pct(p.leader.pct, lang) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {country ? (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("presidential_hoods_coverage", {
              located: formatInt(coverage.located, lang),
              catalogue: formatInt(coverage.catalogue, lang),
              sections: formatInt(coverage.sections, lang),
              votes: formatInt(coverage.validVotes, lang),
              pct: pct(coverage.pctOfValid, lang),
            })}
          </p>
          {coverage.missing.length > 0 ? (
            // ⚠⚠ NAMED, NOT COUNTED. „Three could not be located" invites a reader to assume
            // the three are like the five; naming them is what lets somebody notice that
            // Факултета is absent from 2011 and present either side of it.
            <p className="mt-1 text-xs text-muted-foreground">
              {t("presidential_hoods_missing", {
                names: coverage.missing.map((m) => nameOf(m)).join(", "),
              })}
            </p>
          ) : null}
        </>
      ) : (
        // ⚠ ARITHMETIC OVER THE ROWS ABOVE, never the country's coverage sentence under a
        // place's name. It also says which catalogue the count is out of, so „2" cannot read
        // as „this place was screened and two were found".
        <p className="mt-3 text-xs text-muted-foreground">
          {t("presidential_hoods_coverage_here", {
            located: formatInt(scoped.places.length, lang),
            catalogue: formatInt(coverage.catalogue, lang),
            sections: formatInt(scoped.sections, lang),
            votes: formatInt(scoped.valid, lang),
          })}
        </p>
      )}
    </StatCard>
  );
};
