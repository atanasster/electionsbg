// Latest-snapshot breakdown. Shows the five top-level sections (revenue,
// expenditure, EU contribution, balance, financing); for the two big sections
// each line item gets a proportional bar so you can see where the money comes
// from and where it goes. Plan-vs-executed shown where the source publishes a
// budget-law column.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PieChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import type { KfpSnapshot, KfpSnapshotSection } from "@/data/budget/types";

const pctOfPlan = (
  section: Pick<KfpSnapshotSection, "planned" | "executed">,
): number | null => {
  if (!section.planned || !section.executed) return null;
  const plan = section.planned.amountEur;
  if (plan === 0) return null;
  return (section.executed.amountEur / plan) * 100;
};

const SectionBlock: FC<{
  section: KfpSnapshotSection;
  label: string;
  lang: "bg" | "en";
}> = ({ section, label, lang }) => {
  const { t } = useTranslation();
  const executed = section.executed?.amountEur ?? 0;
  const pct = pctOfPlan(section);
  // Bar scale: largest line in the section drives full width.
  const maxLine = Math.max(
    1,
    ...section.lines.map((l) => Math.abs(l.executed?.amountEur ?? 0)),
  );
  const lines = section.lines.filter((l) => (l.executed?.amountEur ?? 0) !== 0);

  return (
    <div className="py-2.5 border-b border-border/50 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-sm font-bold tabular-nums">
          {formatEur(executed)}
        </span>
      </div>
      {pct != null ? (
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {pct.toFixed(1)}% {t("budget_of_plan") || "of plan"}
          {section.planned
            ? ` · ${t("budget_planned") || "plan"} ${formatEur(section.planned.amountEur)}`
            : ""}
        </div>
      ) : null}
      {lines.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {lines.map((line, i) => {
            const v = line.executed?.amountEur ?? 0;
            const width = (Math.abs(v) / maxLine) * 100;
            return (
              <li key={`${line.labelBg}-${i}`} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-muted-foreground">
                    {lang === "en" && line.labelEn
                      ? line.labelEn
                      : line.labelBg}
                  </span>
                  <span className="tabular-nums shrink-0">{formatEur(v)}</span>
                </div>
                <div className="mt-0.5 h-1 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full rounded bg-primary/60"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};

export const BudgetBreakdownTile: FC<{ snapshot: KfpSnapshot }> = ({
  snapshot,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const sectionLabel = (s: KfpSnapshotSection): string =>
    lang === "bg" ? s.labelBg : s.labelEn || s.labelBg;

  return (
    <Card className="my-4" data-og="budget-breakdown">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PieChart className="h-4 w-4" />
          {t("budget_breakdown_title") || "Where the money goes"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {(t("budget_breakdown_asof") || "State budget execution as of") +
            " " +
            snapshot.asOf}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {snapshot.sections.map((section) => (
          <SectionBlock
            key={section.code}
            section={section}
            label={sectionLabel(section)}
            lang={lang}
          />
        ))}
      </CardContent>
    </Card>
  );
};
