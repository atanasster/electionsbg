// Budget-journey timeline. Per fiscal year: the budget law, the КФП execution
// snapshots published so far, and the Сметна палата audit report once it
// lands. Documents with no resolved source URL (placeholders the pipeline
// seeds before the DV idMat is known) are hidden — we only list rows that
// link to a real source. Newest fiscal year first.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitCommitVertical,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type {
  BudgetDocument,
  BudgetDocumentSource,
  BudgetIndex,
  BudgetYearCoverage,
} from "@/data/budget/types";
// ONE definition of the chain, shared with /budget/law. Both surfaces render
// the same year from the same corpus, and while each kept its own copy they
// already disagreed: this tile tie-broke on `seq`, which is 0 for BOTH FY2026
// fund laws, so their order was whatever the array order happened to be —
// against the screen's stable order by id.
import { orderJourney, packageProgress } from "@/screens/budget/budgetJourney";

const ROLE_PRIORITY: BudgetDocumentSource["role"][] = [
  "promulgated",
  "report",
  "bill",
  "dataset",
  "annex",
  "resource",
];

const pickPrimary = (
  sources: BudgetDocumentSource[],
): BudgetDocumentSource | undefined => {
  for (const role of ROLE_PRIORITY) {
    const hit = sources.find((s) => s.role === role);
    if (hit) return hit;
  }
  return sources[0];
};

const DocRow: FC<{ doc: BudgetDocument }> = ({ doc }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const primary = pickPrimary(doc.sources);
  const extras = primary ? doc.sources.filter((s) => s !== primary) : [];
  // /g, and `defaultValue` rather than `|| doc.kind`: i18next returns the KEY
  // on a miss, which is truthy, so the old fallback was dead. Both bugs were
  // invisible because every kind has exactly one hyphen and all seven keys
  // exist — a `mid-year-report` would have resolved on neither.
  const kindLabel = t(`budget_doc_kind_${doc.kind.replace(/-/g, "_")}`, {
    defaultValue: doc.kind,
  });
  if (!primary) return null;
  return (
    <li className="flex items-start gap-2 py-1.5">
      <GitCommitVertical className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {kindLabel}
        </div>
        <div className="text-sm leading-snug">
          <a
            href={primary.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-baseline gap-1"
          >
            <span>{doc.title}</span>
            <ExternalLink className="h-3 w-3 shrink-0 self-center" />
          </a>
        </div>
        {extras.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <span>
                {t("budget_doc_extra_sources", {
                  count: extras.length,
                  defaultValue:
                    extras.length === 1
                      ? `${extras.length} more source`
                      : `${extras.length} more sources`,
                })}
              </span>
            </button>
            {expanded ? (
              <ul className="mt-1 ml-4 space-y-0.5">
                {extras.map((src, idx) => (
                  <li key={`${src.url}-${idx}`} className="text-[12px]">
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline inline-flex items-baseline gap-1"
                    >
                      <span>{src.label || src.url}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 self-center" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </li>
  );
};

const YearGroup: FC<{
  year: number;
  docs: BudgetDocument[];
  coverage: BudgetYearCoverage | undefined;
}> = ({ year, docs, coverage }) => {
  const { t } = useTranslation();
  const months = coverage?.kfpPeriods.length ?? 0;
  // `id` here, `documentId` on the screen — the shared helper reads the latter.
  const pkg = packageProgress(
    docs.map((d) => ({ kind: d.kind, documentId: d.id })),
  );
  return (
    <div className="py-3 border-b border-border/50 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold tabular-nums">
          {year}
          {pkg ? (
            <span
              className={
                "ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium align-middle " +
                (pkg.have === pkg.total
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300")
              }
              title={
                pkg.missing.length
                  ? t("budget_journey_package_missing", {
                      laws: pkg.missing.join(", "),
                    })
                  : undefined
              }
            >
              {t("budget_journey_package", {
                have: pkg.have,
                total: pkg.total,
              })}
            </span>
          ) : null}
        </h3>
        {months > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {months}{" "}
            {t("budget_journey_months") || "monthly execution snapshot(s)"}
          </span>
        ) : null}
      </div>
      <ul className="mt-1">
        {orderJourney(
          // The shard corpus dates a document by promulgation or by report,
          // depending on kind; `seq` was the old tie-break and is 0 for both
          // FY2026 fund laws, so it decided nothing between them.
          docs.map((d) => ({
            ...d,
            documentId: d.id,
            publishedOn: d.promulgationDate ?? d.reportDate ?? null,
          })),
        ).map((d) => (
          <DocRow key={d.id} doc={d} />
        ))}
      </ul>
    </div>
  );
};

export const BudgetJourneyTile: FC<{
  documents: BudgetDocument[];
  index: BudgetIndex | null;
}> = ({ documents, index }) => {
  const { t } = useTranslation();
  const published = documents.filter((d) => d.sources.length > 0);
  const yearDocs = published.filter((d) => d.fiscalYear != null);
  const feedDocs = published.filter((d) => d.fiscalYear == null);
  const years = [...new Set(yearDocs.map((d) => d.fiscalYear as number))].sort(
    (a, b) => b - a,
  );
  const coverageByYear = new Map(
    (index?.years ?? []).map((y) => [y.fiscalYear, y]),
  );

  return (
    <Card className="my-4" data-og="budget-journey">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {t("budget_journey_title") || "The budget journey"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("budget_journey_subtitle") ||
            "Law → execution → audit, per fiscal year."}
          {/* This tile shows the year's OWN chain. /budget/law scores the same
              corpus against the OGP/IBP eight-document frame — the question
              „what is missing entirely", which a per-year chain cannot ask. */}
          {" · "}
          <Link to="/budget/law" className="text-primary hover:underline">
            {t("budget_law_see_all")}
          </Link>
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {years.map((year) => (
          <YearGroup
            key={year}
            year={year}
            docs={yearDocs.filter((d) => d.fiscalYear === year)}
            coverage={coverageByYear.get(year)}
          />
        ))}
        {feedDocs.length > 0 ? (
          <div className="py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              {t("budget_journey_feed") || "Continuous data feed"}
            </div>
            <ul>
              {feedDocs.map((d) => (
                <DocRow key={d.id} doc={d} />
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
