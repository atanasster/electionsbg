// „Гласове в рисковите квартали" — how eight flagged Roma districts voted in one presidential
// round.
//
// ⚠⚠ THE CAVEAT COMES FROM THE ARTIFACT AND RENDERS ABOVE EVERYTHING. This tile names
// neighbourhoods with an ethnicity attached to them in the press, so a reader who stops at the
// first row must already have read that these are sums over POLLING STATIONS and not a
// statement about how any community voted — the ecological fallacy `PresidentialCleavagesTile`
// guards against, one grain smaller and with a name on it. `usePresidentialNeighborhoods`
// refuses a payload that lost the sentence, so „the table rendered" implies „the caveat
// rendered".
//
// ⚠⚠ EVERY DISTRICT LINKS TO THE REPORT THAT NAMED IT. „Рискови" is a claim, and it is not
// ours: the catalogue is curated from Антикорупционен фонд, СЕГА and Свободна Европа, and
// `sourceUrl` is how a reader checks it rather than taking our word. A row without its source
// would present somebody else's finding as this site's own.
//
// ⚠⚠ COVERAGE IS PRINTED, AND SO IS WHAT IS MISSING. 2011 locates five of the eight districts
// and 2001 all eight — section RENUMBERING, not anything on the ground — so the aggregate is a
// different set of places in different cycles. The line says which, by name, and says why, so a
// reader cannot silently compare two rounds that are not about the same neighbourhoods.
//
// ⚠ THE COMPARISON IS ALWAYS AGAINST THE COUNTRY, never against another cycle. A ticket's share
// here beside its published national share is a fact about this round; „up 6 points on last
// time" would be a fact about two different sets of stations.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatInt, formatPct } from "@/lib/currency";
import {
  hasNeighborhoodContent,
  type NeighborhoodPlace,
  type PresidentialNeighborhoods,
} from "@/data/presidential/useNeighborhoods";

const PCT_DIGITS = 1;
/**
 * ⚠ A SECOND CUT, ON A DIFFERENT AXIS from the producer's `MIN_PCT` (3% of the NATIONAL share)
 * — this one ranks by votes inside the districts. They are not redundant: 2016 round 1 clears
 * the producer's cut with SEVEN tickets, so this drops the seventh, and the tile says so rather
 * than letting a row vanish. A slice that silently hid a row would also make the artifact's own
 * figures unreviewable from the page that renders them.
 */
const TOP_TICKETS = 6;

/** `formatPct` takes a FRACTION; every percentage in this payload is 0-100. */
const pct = (v: number | null | undefined, lang: string) =>
  formatPct(v == null ? null : v / 100, lang, PCT_DIGITS);

export const PresidentialNeighborhoodsTile: FC<{
  neighborhoods: PresidentialNeighborhoods;
}> = ({ neighborhoods }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isEn = lang === "en";

  // ⚠ THE SAME PREDICATE THE SECTION GATES ON, so this tile can never be the thing that keeps
  // an otherwise empty heading standing.
  if (!hasNeighborhoodContent(neighborhoods)) return null;

  const { coverage, national, totals, tickets, places } = neighborhoods;
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
            catalogue: formatInt(neighborhoods.coverage.catalogue, lang),
          })}
          underline={false}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            <span>{t("presidential_hoods_title")}</span>
          </div>
        </Hint>
      }
    >
      {/* ⚠ THE CAVEAT FIRST, ABOVE THE NAMES. */}
      <p className="text-xs text-muted-foreground">
        {isEn ? neighborhoods.basisEn : neighborhoods.basis}
      </p>

      {/* ⚠ THE TWO RATES THE SOURCE REPORTING IS ABOUT, each beside the country's own. „7,6%
          недействителни" says nothing until a reader knows the country ran at 6,4%. */}
      <ul className="mt-3 space-y-1 text-xs">
        <li>
          {/* ⚠ „В СЕКЦИИТЕ В СТРАНАТА", not „в страната". Both sides of this comparison are
              domestic section sums, and the PUBLISHED national turnout — rendered a few
              sections down this same page — includes abroad and is higher (40,3% against 37,2%
              on 2021 round 1). Two irreconcilable „national turnout" figures on one page is a
              credibility problem even when, as here, the qualified one is the conservative
              comparison. */}
          {t("presidential_hoods_rate_turnout_domestic", {
            here: pct(totals.turnoutPct, lang),
            national: pct(national.turnoutPct, lang),
          })}
        </li>
        <li>
          {/* ⚠⚠ A SUPPRESSED RATE SAYS WHY. The producer withholds it when the districts voted
              on machines — 228 paper ballots across all of 2021's round 1 — and „—" alone would
              read as a gap in our data rather than as a ballot that was not on paper. */}
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

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("presidential_hoods_title")}</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col">{t("presidential_hoods_col_ticket")}</th>
              <th scope="col" className="text-right">
                {t("presidential_hoods_col_here")}
              </th>
              <th scope="col" className="text-right">
                {t("presidential_hoods_col_national")}
              </th>
            </tr>
          </thead>
          <tbody>
            {tickets.slice(0, TOP_TICKETS).map((tk) => (
              <tr key={tk.number} className="border-t">
                {/* ⚠ BULGARIAN IN BOTH LANGUAGES AND NEVER TRANSLITERATED — a reader is
                    matching these against a ballot or a protocol scan, both Cyrillic. And NOT
                    a link: `PresidentialPersonName` would attach this district's figures to a
                    person's profile, which is a claim about them rather than about seventy
                    protocols. */}
                <td>{tk.president}</td>
                <td className="text-right tabular-nums">{pct(tk.pct, lang)}</td>
                <td className="text-right tabular-nums text-muted-foreground">
                  {pct(tk.pctNational, lang)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tickets.length > TOP_TICKETS ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("presidential_hoods_more_tickets", {
            count: tickets.length - TOP_TICKETS,
          })}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          {/* ⚠ ITS OWN CAPTION. Two tables inside one card, and this is the one that names the
              neighbourhoods — unlabelled, a screen-reader user meets it with no idea which of
              the two they are in. */}
          <caption className="sr-only">
            {t("presidential_hoods_places_caption")}
          </caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col">{t("presidential_hoods_col_place")}</th>
              <th scope="col" className="text-right">
                {t("presidential_hoods_col_sections")}
              </th>
              <th scope="col" className="text-right">
                {t("presidential_hoods_col_turnout")}
              </th>
              <th scope="col" className="text-right">
                {t("presidential_hoods_col_invalid")}
              </th>
              <th scope="col">{t("presidential_hoods_col_leader")}</th>
            </tr>
          </thead>
          <tbody>
            {places.map((p) => (
              <tr key={p.id} className="border-t">
                {/* ⚠ A ROW HEADER, NOT A CELL — so „Столипиново" is announced with each figure
                    beside it rather than four bare numbers in a row. */}
                <th scope="row" className="text-left font-normal">
                  {nameOf(p)}
                  <span className="block text-xs text-muted-foreground">
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
                      {t("presidential_hoods_source")}
                    </a>
                  </span>
                </th>
                <td className="text-right tabular-nums">
                  {formatInt(p.sections, lang)}
                </td>
                <td className="text-right tabular-nums">
                  {pct(p.turnoutPct, lang)}
                </td>
                <td className="text-right tabular-nums">
                  {p.invalidPct == null ? (
                    // ⚠⚠ THE SAME RULE AS THE TOTALS LINE ABOVE, and it bites harder here: on
                    // 2021 ALL EIGHT rows are in this state at once, so a bare „—" column reads
                    // as eight holes in our data under a „Недействителни" header — directly
                    // beneath a sentence that has just explained the same state in words.
                    <span
                      className="text-muted-foreground"
                      title={t("presidential_hoods_invalid_unmeasurable", {
                        paper: formatInt(p.paperBallots, lang),
                      })}
                    >
                      {t("presidential_hoods_invalid_machines_short")}
                    </span>
                  ) : (
                    pct(p.invalidPct, lang)
                  )}
                </td>
                <td>
                  {p.leader ? (
                    <>
                      {p.leader.president}
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {pct(p.leader.pct, lang)}
                      </span>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
        // ⚠⚠ NAMED, NOT COUNTED. „Three could not be located" invites a reader to assume the
        // three are like the five; naming them is what lets somebody notice that Факултета is
        // absent from 2011 and present either side of it.
        <p className="mt-1 text-xs text-muted-foreground">
          {t("presidential_hoods_missing", {
            names: coverage.missing.map((m) => nameOf(m)).join(", "),
          })}
        </p>
      ) : null}
    </StatCard>
  );
};
