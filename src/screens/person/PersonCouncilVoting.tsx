// The общински съвет analogue of MpVotingSection — a councillor's voting record,
// off the SAME serving layer (161_council_serving.sql) the /council pages already
// use. This is what CouncilActivitySection was meant to be, per that migration's own
// header: keyed on person_id (via the slug adapter, council_councillor_by_slug) rather
// than an officials slug, so it survives a re-slug.
//
// Self-hides entirely — no empty section header, and no orphaned TRACK header either
// (see the `header` prop) — when the person has no council votes attributed to them,
// exactly like MpVotingSection does for a person with no roll-call record. There is no
// separate "is this person a councillor" gate before the fetch:
// council_councillor_by_slug() is a cheap, index-served lookup for everyone (same shape
// as usePersonMagistrateHoldings), so a person who was never on a council simply gets a
// fast null back rather than needing this component to re-derive "councillor-ness" from
// person_role itself.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import {
  useCouncilCouncillor,
  type CouncilCouncillorVote,
} from "@/data/council/useCouncilHub";

const formatInt = (n: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB").format(n);

const formatPct = (frac: number, lang: string): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(frac);
};

const VOTE_KEY: Record<CouncilCouncillorVote["vote"], string> = {
  for: "council_vote_for",
  against: "council_vote_against",
  abstain: "council_vote_abstain",
};

const VOTE_CLASS: Record<CouncilCouncillorVote["vote"], string> = {
  for: "text-emerald-700 dark:text-emerald-400",
  against: "text-rose-700 dark:text-rose-400",
  abstain: "text-amber-700 dark:text-amber-400",
};

const RECENT_SHOWN = 8;

export const PersonCouncilVoting: FC<{
  slug: string;
  /** The "Местна власт" track header, for a person who ALSO has a National Assembly
   *  voting record. Rendered HERE, inside this component's own success path, rather than
   *  by the parent — this card self-hides whenever the corpus has not attributed this
   *  person's council votes, and a header rendered by the parent would then sit above
   *  nothing, labelling a record that is not on the page. Undefined for everyone else. */
  header?: ReactNode;
}> = ({ slug, header }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data: entry, isLoading } = useCouncilCouncillor(slug);

  // Deliberately a bare placeholder rather than a mounted DashboardSection with a
  // header (unlike MpVotingSection, which keeps its header through loading so the
  // header's own height never appears/disappears once the data resolves) — the
  // common outcome here is `null` (most people, including most councillors whose
  // votes haven't been attributed yet, per the module header), so keeping a
  // header mounted for a state most requests never leave would itself be the
  // more common layout shift, not the rarer one.
  if (isLoading) {
    return (
      <Card className="my-4" aria-hidden>
        <CardContent>
          <div className="min-h-[80px] sm:min-h-[220px]" />
        </CardContent>
      </Card>
    );
  }
  if (!entry) return null;

  // Explicit votes against the council's own majority, plus abstentions on a
  // resolution that DID have one — never a "loyalty %", since this corpus
  // carries no party affiliation to be loyal TO (161's own header). The
  // denominator is `ofScoredVotes`: this councillor's votes on resolutions
  // that actually had a majority, never `votes` (which also counts
  // no-majority/tied resolutions that could not be scored either way).
  const withMajorityPct =
    entry.ofScoredVotes > 0
      ? (entry.ofScoredVotes -
          entry.againstMajority -
          entry.abstainedFromMajority) /
        entry.ofScoredVotes
      : null;

  const recent = entry.recent.slice(0, RECENT_SHOWN);

  return (
    <>
      {header}
      <DashboardSection
        id="person-council-voting"
        title={t("pp_council_voting_title")}
        icon={Landmark}
        headingLevel={2}
      >
        <Card className="my-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <Landmark className="h-4 w-4" />
              {t("pp_council_voting_title")}
              <span className="text-xs text-muted-foreground font-normal">
                · {entry.councilName}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              {t("pp_council_voting_intro")}
            </p>

            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
              {withMajorityPct != null && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t("pp_council_voting_with_majority")}
                  </div>
                  <div className="text-3xl font-bold tabular-nums">
                    {formatPct(withMajorityPct, lang)}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("pp_council_voting_votes_cast")}
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatInt(entry.votes, lang)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("council_vote_for")}
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatInt(entry.for, lang)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("council_vote_against")}
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatInt(entry.against, lang)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("council_vote_abstain")}
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatInt(entry.abstain, lang)}
                </div>
              </div>
              {entry.againstMajority > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t("pp_council_voting_against_majority")}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    {formatInt(entry.againstMajority, lang)}
                  </div>
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground mt-4 pt-3 border-t">
              {entry.attendanceBasis}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {entry.dissentBasis}
            </div>

            {recent.length > 0 && (
              <div className="mt-5 pt-4 border-t">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {t("pp_council_voting_recent")}
                </h3>
                <ul className="divide-y">
                  {recent.map((r) => (
                    <li key={r.id}>
                      <Link
                        to={`/council/resolution/${r.id}`}
                        underline={false}
                        className="flex items-baseline gap-2 py-2 text-sm hover:text-primary"
                      >
                        <span className="tabular-nums text-xs text-muted-foreground shrink-0">
                          {r.decidedOn}
                        </span>
                        <span
                          className={`shrink-0 text-xs font-medium ${VOTE_CLASS[r.vote]}`}
                        >
                          {t(VOTE_KEY[r.vote])}
                        </span>
                        <span className="line-clamp-1 flex-1">{r.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </DashboardSection>
    </>
  );
};
