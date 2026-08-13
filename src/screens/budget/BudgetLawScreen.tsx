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
// on all 48 rows, so the roll-call edge §7.4 describes has no data behind it.
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

  // 15 of the corpus's 48 records are duplicates — the same title, URL and
  // date under two `document_id` slug variants (a definite article), so FY2024
  // lists 19 documents that are 11. That is an ingest defect and this page is
  // the first surface to expose it; deduping HERE stops the page publishing one
  // document twice without pretending to have fixed the corpus.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (documents?.rows ?? []).filter((r) => {
      const key = `${r.url ?? ""}|${r.titleBg ?? ""}|${r.publishedOn ?? ""}`;
      // A row with neither URL nor title has no identity to dedupe on; keep it.
      if (!r.url && !r.titleBg) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [documents]);
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
          <h2 className="mb-2 text-sm font-semibold">
            {t("budget_law_year_h", { fy, defaultValue: "" })}
          </h2>
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
