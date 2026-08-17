// /council/:code — one municipal council.
//
// `code` is the FRONTEND obshtina code, so a My-Area reader in район Лозенец
// (S2414) and one on the Sofia city dashboard (SFO_CITY) reach the same
// Столичен общински съвет. Resolution happens server-side through
// council_muni_code; the client never maps codes.
//
// THREE STATES, not two. A place is (a) not covered at all — 249 of 265, (b)
// covered but publishing no named votes — 11 of 16, or (c) covered with named
// votes — 5. Collapsing (b) into (a) tells a reader in Пловдив that nothing is
// known about their council while 151 of its resolutions are indexed.

import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { SectionHeading } from "@/ux/infographic/SectionHeading";
import { Link } from "react-router-dom";
import { useDayLabel } from "@/ux/feed/useDayLabel";
import { useCouncilOverview } from "@/data/council/useCouncilHub";
import {
  useCouncilMuni,
  type CouncilResolutionRow,
} from "@/data/council/useCouncilHub";

/** `unknown` is 43% of the corpus — the plurality for one município. Rendering
 *  adopted/rejected as a binary misreports nearly half of it, so the third
 *  state is shown as itself. */
const ResultChip: FC<{ result: CouncilResolutionRow["result"] }> = ({
  result,
}) => {
  const { t } = useTranslation();
  if (result === "adopted")
    return (
      <span className="rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
        {t("council_result_adopted")}
      </span>
    );
  if (result === "rejected")
    return (
      <span className="rounded-sm bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-700 dark:text-rose-400">
        {t("council_result_rejected")}
      </span>
    );
  if (result === "returned")
    return (
      <span className="rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">
        {t("council_result_returned")}
      </span>
    );
  return (
    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      {t("council_result_unknown")}
    </span>
  );
};

export const CouncilScreen: FC = () => {
  const { code } = useParams();
  const { t, i18n } = useTranslation();
  const nfmt = new Intl.NumberFormat(
    i18n.language === "bg" ? "bg-BG" : "en-GB",
  );
  const { data, isLoading, isError } = useCouncilMuni(code);
  const overview = useCouncilOverview();
  const dayLabel = useDayLabel("long");

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // A FAILED lookup is not "no council here". The hook keeps the two apart, so
  // an outage says so and React Query retries, instead of telling a reader
  // their município has no council.
  if (isError) {
    return (
      <div className="mx-auto w-full px-4 py-16 sm:px-6">
        <p className="text-muted-foreground">
          {t("council_unavailable_retry")}
        </p>
      </div>
    );
  }

  // (a) Not covered — 249 of 265 municipalities. A SOFT 404: hosting serves a
  //     200 for this route whatever the screen renders, so a hard <NotFound />
  //     would claim a status nothing sets. Name the situation and offer the way
  //     on instead.
  if (!data) {
    return (
      <div className="mx-auto w-full px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-bold">{t("council_not_covered_title")}</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {t("council_not_covered_body", {
            covered: overview.data?.councilsCovered ?? 16,
            total: overview.data?.councilsTotal ?? 265,
          })}
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

  const unknown = data.resultSplit?.unknown ?? 0;
  const resultBasis =
    unknown > 0
      ? t("council_basis_result_unknown", {
          pct: ((unknown / data.resolutionCount) * 100).toFixed(0),
          n: nfmt.format(unknown),
          total: nfmt.format(data.resolutionCount),
        })
      : t("council_basis_result_none", {
          total: nfmt.format(data.resolutionCount),
        });

  return (
    <div className="mx-auto w-full px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold sm:text-3xl">
        {/* The council's name is Bulgarian on both pages — it is a proper
            name, not untranslated copy — so mark it for a screen reader the
            same way the resolution titles are. */}
        <span lang="bg">{data.name}</span>
        {t("council_screen_title_suffix")}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {t("council_screen_lede", {
          count: data.resolutionCount,
          resolutions: nfmt.format(data.resolutionCount),
        })}
      </p>

      {/* (b) vs (c) — said in words, not by an absent section. */}
      {data.hasNamedVotes ? (
        <section className="mt-8" aria-labelledby="council-people">
          <SectionHeading
            id="council-people"
            heading={t("council_people_heading")}
            description={t("council_people_desc", {
              votes: nfmt.format(data.namedVoteCount),
              resolutions: nfmt.format(data.namedVoteResolutions),
              total: nfmt.format(data.resolutionCount),
            })}
          />
          <div className="grid gap-1.5 sm:grid-cols-2">
            {data.councillors.map((c) => (
              <div
                key={`${c.personId ?? "x"}-${c.name}`}
                className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-border/60 px-3 py-2 text-sm"
              >
                <span className="min-w-[10rem] flex-1 font-medium">
                  {c.name}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {t("council_councillor_votes", {
                    count: c.votes,
                    formatted: nfmt.format(c.votes),
                  })}
                </span>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {t("council_councillor_split", {
                    for: c.for,
                    against: c.against,
                    abstain: c.abstain,
                  })}
                </span>
              </div>
            ))}
          </div>
          {/* The i18n wording, not `data.attendanceBasis` — that field is
              Bulgarian and rendering it verbatim put a Bulgarian sentence on
              /en. It stays in the payload as the contract for non-UI consumers
              (the AI chat, any API reader), and a data test keeps the two
              Bulgarian wordings identical. */}
          <p className="mt-3 text-xs text-muted-foreground">
            {t("council_basis_attendance")}
          </p>
        </section>
      ) : (
        <p className="mt-6 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
          {t("council_no_named_votes_explain")}
        </p>
      )}

      <section className="mt-8" aria-labelledby="council-resolutions">
        <SectionHeading
          id="council-resolutions"
          heading={t("council_resolutions_heading")}
          description={t("council_resolutions_desc_capped", {
            shown: nfmt.format(data.resolutions.length),
            total: nfmt.format(data.resolutionCount),
          })}
        />
        {/* Бургас is 367 unclear of 374 and Русе 0 of 211, so this share is
            computed for THIS council. A corpus figure here is wrong for every
            one of the sixteen. */}
        <p className="mb-3 text-xs text-muted-foreground">{resultBasis}</p>
        <div className="grid gap-2">
          {data.resolutions.map((r) => (
            <div
              key={r.id}
              className="rounded-md border border-border/60 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {dayLabel(r.decidedOn)}
                </span>
                {r.number && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    № {r.number}
                  </span>
                )}
                <ResultChip result={r.result} />
                {r.hasNamedVotes && (
                  <span className="rounded-sm bg-sky-500/10 px-1.5 py-0.5 text-xs text-sky-700 dark:text-sky-400">
                    {t("council_named_vote_chip")}
                  </span>
                )}
              </div>
              {/* Bulgarian, verbatim, in both languages. There is no title_en
                  in the corpus and machine-translating a legal instrument's
                  title would be inventing one. */}
              <p className="mt-1 text-sm" lang="bg">
                {r.title}
              </p>
              {r.sourceUrl && (
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  aria-label={t("council_source_link_a11y", {
                    number: r.number ?? r.id,
                    day: dayLabel(r.decidedOn),
                  })}
                >
                  {t("council_source_link")}
                </a>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
