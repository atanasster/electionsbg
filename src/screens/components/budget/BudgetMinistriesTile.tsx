// Ministry breakdown for the selected fiscal year — every first-level spending
// unit ranked by the expenditure the State Budget Law appropriated to it, with
// a proportional bar. Each row links to the ministry detail screen. Renders
// nothing when the selected year has no law (admin-dimension) data.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useBudgetAdminReconciliation } from "@/data/budget/useBudgetReconciliation";

export const BudgetMinistriesTile: FC<{ fiscalYear: number }> = ({
  fiscalYear,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data: rows } = useBudgetAdminReconciliation(fiscalYear);
  if (!rows || rows.length === 0) return null;

  const expenditure = rows
    .filter((r) => r.kind === "expenditure" && r.planned)
    .map((r) => ({
      nodeId: r.nodeId,
      name: lang === "bg" ? r.nodeNameBg : r.nodeNameEn || r.nodeNameBg,
      planned: r.planned!.amountEur,
    }))
    .sort((a, b) => b.planned - a.planned);
  if (expenditure.length === 0) return null;

  const max = expenditure[0].planned || 1;

  return (
    <Card className="my-4" data-og="budget-ministries">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {t("budget_ministries_title") || "By spending unit"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {(t("budget_ministries_subtitle") ||
            "Expenditure appropriated by the State Budget Law for fiscal year") +
            " " +
            fiscalYear}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-1.5">
          {expenditure.map((m) => {
            const width = (m.planned / max) * 100;
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
                    className="h-full rounded bg-primary/60"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};
