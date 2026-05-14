// Budget-journey timeline. Per fiscal year: the budget law, the КФП execution
// snapshots published so far, and the Сметна палата audit report once it
// lands. Phase 1's law entries are placeholders (no annex URLs yet) — the tile
// shows them greyed with a "pending" note so the journey is visible from the
// start. Newest fiscal year first.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, GitCommitVertical, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type {
  BudgetDocument,
  BudgetIndex,
  BudgetYearCoverage,
} from "@/data/budget/types";

const STAGE_ORDER: Record<BudgetDocument["kind"], number> = {
  law: 0,
  amendment: 1,
  "execution-report": 2,
  "audit-report": 3,
  "kfp-feed": 4,
};

const DocRow: FC<{ doc: BudgetDocument }> = ({ doc }) => {
  const { t } = useTranslation();
  const primary = doc.sources.find(
    (s) => s.role === "promulgated" || s.role === "report" || s.role === "bill",
  );
  const isPlaceholder = doc.sources.length === 0;
  const kindLabel =
    t(`budget_doc_kind_${doc.kind.replace("-", "_")}`) || doc.kind;
  return (
    <li className="flex items-start gap-2 py-1.5">
      <GitCommitVertical
        className={`h-4 w-4 mt-0.5 shrink-0 ${
          isPlaceholder ? "text-muted-foreground/40" : "text-primary"
        }`}
      />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {kindLabel}
        </div>
        <div className="text-sm leading-snug">
          {primary ? (
            <a
              href={primary.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-baseline gap-1"
            >
              <span>{doc.title}</span>
              <ExternalLink className="h-3 w-3 shrink-0 self-center" />
            </a>
          ) : (
            <span className="text-muted-foreground">{doc.title}</span>
          )}
        </div>
        {isPlaceholder ? (
          <div className="text-[11px] text-muted-foreground/70 italic">
            {t("budget_doc_pending") ||
              "Source documents attached in a later phase."}
          </div>
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
  return (
    <div className="py-3 border-b border-border/50 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold tabular-nums">{year}</h3>
        {months > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {months}{" "}
            {t("budget_journey_months") || "monthly execution snapshot(s)"}
          </span>
        ) : null}
      </div>
      <ul className="mt-1">
        {[...docs]
          .sort(
            (a, b) =>
              STAGE_ORDER[a.kind] - STAGE_ORDER[b.kind] || a.seq - b.seq,
          )
          .map((d) => (
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
  const yearDocs = documents.filter((d) => d.fiscalYear != null);
  const feedDocs = documents.filter((d) => d.fiscalYear == null);
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
