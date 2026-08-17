// /council — the municipal-council hub.
//
// NOT a tile grid, deliberately. A tile grid fronts a module's SUB-MODULES;
// this module has one sub-page shape repeated sixteen times, so a grid would
// either seed sixteen arbitrary councils or point every tile at the same page.
// The hub is therefore a PICKER (the dashboard-hub skill's own prescription for
// a `/x/:id` destination): the reader chooses their own council rather than
// landing on one somebody else chose.
//
// COVERAGE IS THE OPENING CLAIM. 16 councils of 265, and only 5 publish
// per-councillor votes. Both numbers come from the payload — a hard-coded
// fraction goes stale in both directions.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { SectionHeading } from "@/ux/infographic/SectionHeading";
import { useDayLabel } from "@/ux/feed/useDayLabel";
import {
  useCouncilOverview,
  type CouncilSummary,
} from "@/data/council/useCouncilHub";

const nf = (lang: string) =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB");

const CouncilRow: FC<{ c: CouncilSummary; lang: string }> = ({ c, lang }) => {
  const { t } = useTranslation();
  // `count` drives PLURALISATION; `formatted` is what is displayed. Passing the
  // raw number into the string renders 11483 where bg-BG wants 11 483.
  const n = nf(lang);
  const dayLabel = useDayLabel("long");

  // A council with no frontendCode cannot be linked — `/council/` would be a
  // self-link back to the hub, which looks like a working row and is not.
  // Every council has one today; this is the guard, not a hypothetical.
  if (!c.frontendCode) return null;

  // The named-vote watermark, shown ONLY when it lags. Казанлък's named votes
  // are a year older than its newest decision, and a row dating the badge with
  // the ordinary date says the opposite.
  const namedIsStale =
    c.hasNamedVotes &&
    !!c.newestNamedOn &&
    !!c.newestDecidedOn &&
    c.newestNamedOn < c.newestDecidedOn;

  return (
    <Link
      to={`/council/${c.frontendCode}`}
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-border/60 px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span lang="bg" className="min-w-[11rem] flex-1 font-medium">
        {c.name}
      </span>
      <span className="text-sm tabular-nums text-muted-foreground">
        {t("council_n_resolutions", {
          count: c.resolutions,
          formatted: n.format(c.resolutions),
        })}
      </span>
      {c.hasNamedVotes ? (
        <span className="rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          {t("council_named_votes_badge", {
            count: c.namedVotes,
            formatted: n.format(c.namedVotes),
          })}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {t("council_no_named_votes_badge")}
        </span>
      )}
      {namedIsStale && (
        <span className="text-xs tabular-nums text-amber-700 dark:text-amber-500">
          {t("council_named_stale", {
            day: dayLabel(c.newestNamedOn as string),
          })}
        </span>
      )}
      <span className="text-xs tabular-nums text-muted-foreground">
        {t("council_newest", {
          day: c.newestDecidedOn ? dayLabel(c.newestDecidedOn) : "—",
        })}
      </span>
    </Link>
  );
};

export const CouncilHubScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const n = nf(lang);
  const { data, isLoading } = useCouncilOverview();

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data || data.councilsCovered === 0) {
    return (
      <div className="mx-auto w-full px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold">{t("council_hub_title")}</h1>
        <p className="mt-3 text-muted-foreground">
          {t("council_hub_unavailable")}
        </p>
      </div>
    );
  }

  const named = data.councils.filter((c) => c.hasNamedVotes);
  const quiet = data.councils.filter((c) => !c.hasNamedVotes);

  // DERIVED, never a literal. The share is 43% corpus-wide and 0%-100% per
  // council — the same hard-coded-fraction trap this module's own headers warn
  // about, which is exactly how it got written down here first.
  const unknown = data.resultSplit?.unknown ?? 0;
  const resultBasis =
    unknown > 0
      ? t("council_basis_result_unknown", {
          pct: ((unknown / data.resolutions) * 100).toFixed(0),
          n: n.format(unknown),
          total: n.format(data.resolutions),
        })
      : t("council_basis_result_none", { total: n.format(data.resolutions) });

  return (
    <div className="mx-auto w-full px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold sm:text-3xl">
        {t("council_hub_title")}
      </h1>

      {/* Band 0 — coverage, stated before anything else. */}
      <p className="mt-3 max-w-3xl text-muted-foreground">
        {t("council_hub_coverage", {
          covered: n.format(data.councilsCovered),
          total: n.format(data.councilsTotal),
          resolutions: n.format(data.resolutions),
        })}
      </p>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        {t("council_hub_coverage_named", {
          withNamed: n.format(data.councilsWithNamedVotes),
          covered: n.format(data.councilsCovered),
          votes: n.format(data.namedVotes),
        })}
      </p>

      {/* Band 1 — the picker, scoped to the councils that publish named votes. */}
      <section className="mt-8" aria-labelledby="council-named">
        <SectionHeading
          id="council-named"
          heading={t("council_band_named_heading")}
          description={t("council_band_named_desc", {
            count: named.length,
          })}
        />
        <div className="grid gap-2">
          {named.map((c) => (
            <CouncilRow key={c.code} c={c} lang={lang} />
          ))}
        </div>
      </section>

      {/* Band 2 — the rest. Named for what is in it, not "Още". */}
      <section className="mt-8" aria-labelledby="council-quiet">
        <SectionHeading
          id="council-quiet"
          heading={t("council_band_quiet_heading")}
          description={t("council_band_quiet_desc", { count: quiet.length })}
        />
        <div className="grid gap-2">
          {quiet.map((c) => (
            <CouncilRow key={c.code} c={c} lang={lang} />
          ))}
        </div>
      </section>

      {/* Band 3 — what the corpus does and does not say. */}
      <section className="mt-10 max-w-3xl" aria-labelledby="council-basis">
        <SectionHeading
          id="council-basis"
          heading={t("council_band_basis_heading")}
        />
        <p className="text-sm text-muted-foreground">
          {t("council_basis_attendance")}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{resultBasis}</p>
      </section>
    </div>
  );
};
