// /council/resolution/:id — one municipal-council decision and its named vote.
//
// These URLs are SERVED BY THE `db` FUNCTION (functions/spa_page.js), not
// prerendered, and they carry no sitemap <loc>. 4,676 resolutions (9,352 with
// the EN mirror) would fit under the Firebase file-count ceiling, but each body
// is one title and a vote table — the shape that earns a thin-content penalty
// rather than traffic. The function gives them a real head so a crawler that
// finds one is not told it is a duplicate of the homepage; this screen is what
// a human sees after hydration.
//
// TWO TALLIES, BOTH LABELLED. `protocolTally` is the aggregate the protokol
// prints; `namedVoteTally` is what the per-councillor list adds up to. They
// disagree on 62% of named-vote resolutions (Перник: 100%) because a
// councillor list can be partial and OCR drops rows. Showing one unlabelled
// would present a contested figure as settled; showing both without saying
// which is which shows a reader two numbers for one vote and invites them to
// assume one is a bug. `tallyBasis` is rendered verbatim for that reason.

import { FC } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { SectionHeading } from "@/ux/infographic/SectionHeading";
import { useDayLabel } from "@/ux/feed/useDayLabel";
import {
  useCouncilResolution,
  type CouncilTallyCounts,
  type CouncilVoteRow,
} from "@/data/council/useCouncilHub";

const VOTE_KEY: Record<CouncilVoteRow["vote"], string> = {
  for: "council_vote_for",
  against: "council_vote_against",
  abstain: "council_vote_abstain",
};

const VOTE_CLASS: Record<CouncilVoteRow["vote"], string> = {
  for: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  against: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  abstain: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

/** A tally line, or a DASH when this council publishes no named vote. Never a
 *  zero: 11 of the 16 councils give an aggregate only, and "0 against" would
 *  assert a unanimity the source never recorded. */
const TallyLine: FC<{ tally: CouncilTallyCounts | null | undefined }> = ({
  tally,
}) => {
  const { t } = useTranslation();
  if (!tally || tally.for == null)
    return <span className="text-muted-foreground">&mdash;</span>;
  return (
    <span className="tabular-nums">
      {t("council_tally_inline", {
        for: tally.for,
        against: tally.against ?? 0,
        abstain: tally.abstain ?? 0,
      })}
    </span>
  );
};

export const CouncilResolutionScreen: FC = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  // The SAME formatter every other council surface uses, and the same one
  // functions/spa_page.js reproduces — the untitled <h1> embeds the date, so a
  // different rendering here would change the heading on hydration.
  const dayLabel = useDayLabel("long");
  const { data, isLoading, isError } = useCouncilResolution(id);

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // A FAILED lookup is not "no such resolution" — the hook keeps the two
  // apart so an outage says so and React Query retries, rather than telling a
  // reader a real decision does not exist.
  if (isError) {
    return (
      <div className="mx-auto w-full px-4 py-16 sm:px-6">
        <p className="text-muted-foreground">
          {t("council_unavailable_retry")}
        </p>
      </div>
    );
  }

  // Unknown id. A SOFT not-found: the function serves a 200 for anything under
  // this prefix, so a hard <NotFound /> would claim a status nothing sets.
  if (!data) {
    return (
      <div className="mx-auto w-full px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-bold">
          {t("council_resolution_missing_title")}
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {t("council_resolution_missing_body")}
        </p>
        <Link
          to="/council"
          className="mt-4 inline-block text-sm underline underline-offset-4"
        >
          {t("council_not_covered_back")}
        </Link>
      </div>
    );
  }

  const votes = data.votes ?? [];

  // 2,234 of 4,727 resolutions (47%) store the literal "(no title parsed)" —
  // the scraper's placeholder for minutes it could read but whose subject line
  // it could not isolate. The same fallback runs in functions/spa_page.js, so
  // the served <h1> and the hydrated one agree; without it hydration would put
  // a parser's internal state back on screen after the function had replaced
  // it.
  const parsed =
    data.title && !/^\(?\s*no title parsed\s*\)?$/i.test(data.title.trim())
      ? data.title.trim()
      : null;
  const heading =
    parsed ??
    t("council_resolution_untitled", {
      number: data.number ?? "—",
      date: dayLabel(data.decidedOn),
    });

  return (
    <div className="mx-auto w-full px-4 py-8 sm:px-6">
      <p className="text-sm text-muted-foreground">
        {/* Link on the FRONTEND code. `councilCode` is the internal key and is
            not routable for 8 of the 16 councils, so linking on it would put a
            "we do not track this council" page one click from that council's
            own decision. Null means not linkable — plain text, as
            CouncilHubScreen does. A proper name either way, so it stays marked
            lang="bg" for a screen reader. */}
        {data.councilFrontendCode ? (
          <Link
            to={`/council/${data.councilFrontendCode}`}
            className="underline underline-offset-4"
          >
            <span lang="bg">{data.councilName}</span>
          </Link>
        ) : (
          <span lang="bg">{data.councilName}</span>
        )}
      </p>
      <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
        <span lang="bg">{heading}</span>
      </h1>
      <p className="mt-2 text-muted-foreground">
        {t("council_resolution_lede", {
          number: data.number ?? "—",
          date: dayLabel(data.decidedOn),
          session: data.session ?? "—",
        })}
      </p>

      <section className="mt-8" aria-labelledby="council-res-vote">
        <SectionHeading
          id="council-res-vote"
          heading={t("council_resolution_vote_heading")}
          description={
            i18n.language === "bg"
              ? data.tallyBasisBg || data.tallyBasis
              : data.tallyBasisEn || data.tallyBasis
          }
        />
        <dl className="mt-4 grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <dt className="text-xs text-muted-foreground">
              {t("council_tally_protocol")}
            </dt>
            <dd className="mt-1 text-sm">
              <TallyLine tally={data.protocolTally} />
            </dd>
          </div>
          <div className="rounded-md border p-3">
            <dt className="text-xs text-muted-foreground">
              {t("council_tally_named")}
            </dt>
            <dd className="mt-1 text-sm">
              <TallyLine
                tally={data.hasNamedVotes ? data.namedVoteTally : null}
              />
            </dd>
          </div>
        </dl>
      </section>

      {/* (b) vs (c) — said in words rather than by an absent section, so a
          council that publishes only an aggregate is not mistaken for one we
          have no data on. */}
      {data.hasNamedVotes && votes.length > 0 ? (
        <section className="mt-8" aria-labelledby="council-res-people">
          <SectionHeading
            id="council-res-people"
            heading={t("council_resolution_people_heading")}
            description={t("council_resolution_people_desc", {
              count: votes.length,
            })}
          />
          <ul className="mt-4 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {votes.map((v) => (
              <li
                key={`${v.name}-${v.vote}`}
                className="flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-sm odd:bg-muted/40"
              >
                {/* Link on the SLUG only. A councillor can carry a resolved
                    person_id and still have no /person page — that page exists
                    for active public figures — so linking on the id would mint
                    a 404 per councillor. */}
                {v.personSlug ? (
                  <Link
                    to={`/person/${v.personSlug}`}
                    className="truncate underline underline-offset-4"
                  >
                    <span lang="bg">{v.name}</span>
                  </Link>
                ) : (
                  <span className="truncate" lang="bg">
                    {v.name}
                  </span>
                )}
                <span
                  className={`shrink-0 rounded-sm px-1.5 py-0.5 text-xs ${VOTE_CLASS[v.vote]}`}
                >
                  {t(VOTE_KEY[v.vote])}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mt-8 max-w-2xl text-sm text-muted-foreground">
          {t("council_no_named_votes_explain")}
        </p>
      )}

      {data.sourceUrl ? (
        <p className="mt-8 text-sm">
          <a
            href={data.sourceUrl}
            rel="nofollow noopener"
            target="_blank"
            className="underline underline-offset-4"
          >
            {t("council_minutes_source")}
          </a>
        </p>
      ) : null}
    </div>
  );
};

export default CouncilResolutionScreen;
