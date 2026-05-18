// Compact top-5 spending-unit tile for the governance overview dashboard.
// Mirrors BudgetMinistriesTile's visual language (planned bar with executed
// overlay, link to ministry detail) but caps at 5 rows and links out to the
// full breakdown on /budget. Drops the program-expand, procurement footprint
// and MP-connected badge — those belong on the dedicated budget screen.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Landmark, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useBudgetAdminReconciliation } from "@/data/budget/useBudgetReconciliation";

const TOP_N = 5;

export const BudgetTopMinistriesTile: FC<{ fiscalYear: number }> = ({
  fiscalYear,
}) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: rows } = useBudgetAdminReconciliation(fiscalYear);

  if (!rows || rows.length === 0) return null;

  const expenditure = rows
    .filter((r) => r.kind === "expenditure" && r.planned)
    .map((r) => ({
      nodeId: r.nodeId,
      name: lang === "bg" ? r.nodeNameBg : r.nodeNameEn || r.nodeNameBg,
      planned: r.planned!.amountEur,
      amended: r.amended?.amountEur ?? null,
      executed: r.executed?.amountEur ?? null,
    }))
    .sort((a, b) => b.planned - a.planned);
  if (expenditure.length === 0) return null;

  const top = expenditure.slice(0, TOP_N);
  const remaining = expenditure.length - top.length;
  const max =
    Math.max(
      top[0].planned,
      ...top.map((m) => m.amended ?? 0),
      ...top.map((m) => m.executed ?? 0),
    ) || 1;

  const hasAnyExecution = top.some((m) => m.executed != null);
  const execAsOf = `${fiscalYear}-12-31`;

  return (
    <Card className="my-4" data-og="budget-top-ministries">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {t("budget_ministries_title") || "By spending unit"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("budget_top_ministries_subtitle", {
            n: TOP_N,
            total: expenditure.length,
            fy: fiscalYear,
            defaultValue: `Top ${TOP_N} of ${expenditure.length} units · fiscal year ${fiscalYear}`,
          })}
          {hasAnyExecution ? (
            <>
              {" · "}
              {t("budget_ministries_asof") || "execution as of"} {execAsOf}
            </>
          ) : null}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-1.5">
          {top.map((m) => {
            const baseline = m.amended ?? m.planned;
            const baseWidth = (baseline / max) * 100;
            const execShare =
              m.executed != null && baseline > 0
                ? Math.min(100, (m.executed / baseline) * 100)
                : 0;
            return (
              <li key={m.nodeId} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    to={`/budget/ministry/${m.nodeId}`}
                    className="truncate text-primary hover:underline"
                  >
                    {m.name}
                  </Link>
                  <span className="tabular-nums shrink-0 font-medium">
                    {formatEur(m.planned)}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full rounded bg-primary/25"
                    style={{ width: `${baseWidth}%` }}
                  >
                    {m.executed != null ? (
                      <div
                        className="h-full rounded bg-primary/80"
                        style={{ width: `${execShare}%` }}
                      />
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {remaining > 0 ? (
          <Link
            to={`/budget?fy=${fiscalYear}#budget-ministries`}
            className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t("budget_top_ministries_see_all", {
              count: remaining,
              defaultValue: `See all ${remaining} other units`,
            })}
            <ArrowRight className="h-3 w-3" />
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
};
