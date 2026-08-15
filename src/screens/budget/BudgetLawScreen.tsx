// /budget/law — the eight-document frame, and what the year actually published.
//
// Plan: docs/plans/budget-hub-v1.md §7.4.
//
// THE HEADLINE CLAIM IS THE WHOLE RISK. „N of 8 key budget documents" is a
// sentence about a country, and the corpus can only support a sentence about
// THIS SITE. Four of the eight have no ingest at all, and „we do not collect X"
// is not „Bulgaria does not publish X". So the score is stated as coverage HERE,
// with one exception the module is entitled to make: the citizens budget, which
// is what this module is (§3.1).
//
// TWO SCOPES, kept visibly apart. The scorecard is site-wide; the list beneath
// it is one year. They must differ — the only in-year-report record is the КФП
// feed, which carries no fiscal year, so it is present in the frame and in no
// year's list.
//
// NO „who voted for it" SECTION. `budget_document.adopted_by_item_id` is NULL
// on all 33 rows, so the roll-call edge §7.4 describes has no data behind it.
// Rendering it from a title regex is what `bill`'s TypeScript stem split exists
// to prevent — a title carrying „второ гласуване" in a procedural position is a
// first reading. An unbuilt section beats a fabricated one.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { cn } from "@/lib/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { OBS_BUDGET_DOCS, OBS_DOC_COUNT } from "@/lib/obsBudgetDocs";
import { useBudgetLawDocuments } from "@/data/budget/useBudgetLawDocuments";
import { useBudgetHubStats } from "@/data/budget/useBudgetHubStats";
import { orderJourney, packageProgress } from "./budgetJourney";

export const BudgetLawScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });
  const { stats } = useBudgetHubStats();
  const fy =
    fyParam && /^\d{4}$/.test(fyParam)
      ? Number(fyParam)
      : (stats?.fiscalYear ?? null);

  const { documents, isLoading } = useBudgetLawDocuments(fy);

  // Site-wide, from the payload — never derived from `rows`, which is one year
  // and would score four categories absent on any year that lacks them.
  const present = useMemo(
    () => new Set(documents?.obsCategoriesPresent ?? []),
    [documents],
  );
  // Only meaningful once the payload has arrived. Rendered against a degraded
  // sentinel, an empty set scores „0 of 8" — a maximally damaging claim made
  // from no data at all.
  const scored = documents?.obsCategoriesPresent != null;
  const coveredCount = useMemo(
    () => OBS_BUDGET_DOCS.filter((d) => present.has(d.id)).length,
    [present],
  );

  // NO DEDUPE HERE. The corpus carries each document once — held at ingest by
  // `mergeDocuments` (scripts/budget/documents.ts), which drops a
  // machine-derived record the build no longer mints. This page used to dedupe
  // on (url, title, date) because 15 of the corpus's 48 records were the same
  // 15 execution reports twice, under a pre-canonicalisation `document_id`
  // slug; that made FY2024 list 19 documents that were 11. Deduping here only
  // ever fixed this page — `budget_document`, the hub ledger's document counts
  // and the OGP coverage score all read the same corpus and none of them
  // dedupe — so the invariant belongs upstream, where it now is.
  // ORDERED AS A CHAIN, not newest-first (T9.11). An execution report for
  // January is published months after the law it executes, so a date sort puts
  // the reports above the law and the year reads backwards.
  const rows = useMemo(() => orderJourney(documents?.rows ?? []), [documents]);
  const pkg = useMemo(() => packageProgress(rows), [rows]);
  const coverage = documents?.coverage ?? null;
  const title = t("budget_law_title");

  return (
    <>
      <Title description={t("budget_law_description")}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_law_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-6">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_law_intro")}
        </p>

        {/* 1. THE FRAME — site-wide, and labelled as coverage rather than as a
               verdict on the country. */}
        <div>
          <h2 className="mb-1 text-sm font-semibold">
            {t("budget_law_frame_h")}
          </h2>
          {scored ? (
            <p className="mb-2 text-sm">
              {t("budget_law_frame_score", {
                covered: coveredCount,
                total: OBS_DOC_COUNT,
                defaultValue: "",
              })}
            </p>
          ) : null}
          <p className="mb-3 max-w-3xl text-xs text-muted-foreground">
            {t("budget_law_frame_caveat")}
          </p>
          {scored ? (
            <ul className="divide-y rounded-xl border bg-card shadow-sm">
              {OBS_BUDGET_DOCS.map((d) => {
                const has = present.has(d.id);
                return (
                  <li key={d.id} className="flex gap-3 px-4 py-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        has
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {has ? "✓" : "–"}
                    </span>
                    <span>
                      <span className="text-sm font-medium">
                        {bg ? d.labelBg : d.labelEn}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {has
                            ? t("budget_law_present")
                            : t("budget_law_absent")}
                        </span>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {bg ? d.descBg : d.descEn}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="h-72 animate-pulse rounded-xl border bg-card" />
          )}
        </div>

        {/* 2. THE YEAR'S OWN DOCUMENTS. */}
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold">
              {t("budget_law_year_h", { fy, defaultValue: "" })}
              {/* HOW MUCH OF THE THREE-LAW PACKAGE IS PASSED. A Bulgarian
                  budget year is the ЗДБРБ plus the ЗБДОО and ЗБНЗОК fund
                  budgets, and they need not arrive together — rendering the
                  documents as one flat list makes a two-thirds year look
                  complete. Null for every year before the fund-law catalogue
                  begins, so the meter never reports our own collection gap as
                  a law the state has not passed. */}
              {pkg ? (
                <span
                  className={cn(
                    "ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-medium",
                    pkg.have === pkg.total
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                  )}
                >
                  {t("budget_journey_package", {
                    have: pkg.have,
                    total: pkg.total,
                    defaultValue: "",
                  })}
                </span>
              ) : null}
              {/* WHICH laws are pending, as visible text. It was a native
                  `title=` — invisible on touch, unannounced on a
                  non-interactive span, unreachable by keyboard — and it is the
                  substantive half: „1 от 3 закона" without it says a package is
                  short and not which part of it. */}
              {pkg && pkg.missing.length > 0 ? (
                <span className="ml-2 align-middle text-[11px] font-normal text-muted-foreground">
                  {t("budget_journey_package_missing", {
                    laws: pkg.missing.join(", "),
                    defaultValue: "",
                  })}
                </span>
              ) : null}
            </h2>
            {/* THE MIDDLE STAGE OF THE JOURNEY. Without it the chain reads law
                → audit with the execution missing, and nothing distinguishes a
                year still being reported from one whose reports never came.

                ⚠️ IT LEADS WITH `lastPeriod`, AND `monthsAvailable` IS NOT A
                COVERAGE FIGURE. That column counts КФП observations CAPTURED;
                152's `COMMENT ON COLUMN` adds „rendering this as coverage is
                false about a complete year", and FY2021 is the live proof —
                `complete` with SIX, because the feed is cumulative and its
                December row is the whole year. „Отчетени 6 мес. по КФП" for 2021
                is this page under-reporting the state, on the one page whose
                subject is the difference between our coverage and the state's
                record. `lastPeriod` answers the question exactly: 2021-12 means
                reported through December.

                The count survives only inside the not-complete branch, where the
                year is openly unfinished and „6 monthly snapshots" cannot be
                read as a year's worth — the same gate `BudgetScreen` uses. And
                „not closed" is asserted from `complete` alone, a fact about the
                calendar; „the report is missing" would be a claim about МФ this
                corpus cannot make.

                Gated on `lastPeriod`, which 152 declares nullable: without it
                the line renders „Изпълнението е отчетено до " and stops. */}
            {coverage?.lastPeriod ? (
              <span className="text-[11px] text-muted-foreground">
                {t("budget_law_coverage", {
                  last: coverage.lastPeriod,
                  defaultValue: "",
                })}
                {coverage.complete ? null : (
                  <>
                    {" · "}
                    {t("budget_law_coverage_running", {
                      months: coverage.monthsAvailable,
                      defaultValue: "",
                    })}
                  </>
                )}
              </span>
            ) : null}
          </div>
          {stats?.yearsAvailable?.length ? (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {stats.yearsAvailable.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setFyParam(String(y))}
                  className={cn(
                    "rounded border px-2 py-0.5 text-xs tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    y === fy
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border hover:border-primary/60",
                  )}
                >
                  {y}
                </button>
              ))}
            </div>
          ) : null}

          {isLoading ? (
            <div className="h-40 animate-pulse rounded-xl border bg-card" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("budget_law_year_empty")}
            </p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card shadow-sm">
              {rows.map((r) => (
                <li key={r.documentId} className="px-4 py-2.5">
                  {/* THE STAGE, as an eyebrow. Without it the chain's order is
                      information the reader has to infer from the titles — and
                      „Закон за изменение и допълнение на Закона за държавния
                      бюджет" is an amendment that reads like a law. */}
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t(`budget_doc_kind_${r.kind.replace(/-/g, "_")}`, {
                      defaultValue: r.kind,
                    })}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        {r.titleBg || r.documentId}
                      </a>
                    ) : (
                      <span className="text-sm">
                        {r.titleBg || r.documentId}
                      </span>
                    )}
                    {r.publishedOn ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {r.publishedOn}
                      </span>
                    ) : null}
                  </div>
                  {r.obsCategory ? (
                    <span className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {(() => {
                        const slot = OBS_BUDGET_DOCS.find(
                          (d) => d.id === r.obsCategory,
                        );
                        return slot
                          ? bg
                            ? slot.labelBg
                            : slot.labelEn
                          : r.obsCategory;
                      })()}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {/* The КФП feed has no fiscal year, so it is in the frame above and in
              no year's list. Said out loud, because a reader who counts the
              badges here against the ticks above will otherwise find one
              missing and conclude the scorecard is wrong. */}
          <p className="mt-2 max-w-3xl text-[11px] text-muted-foreground/80">
            {t("budget_law_year_note")}
          </p>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_law_source")}
        </p>
      </section>
    </>
  );
};
