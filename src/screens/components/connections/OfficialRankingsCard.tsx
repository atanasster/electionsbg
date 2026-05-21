// "Most-connected officials" card on /connections. Surfaces the topOfficials
// ranking from connections-rankings.json — officials ranked by their
// high-confidence (declared-stake) company neighbourhood. Renders nothing
// when no officials have a high-confidence link.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/ux/Card";
import { useConnectionsRankings } from "@/data/parliament/useConnectionsRankings";

const ROWS = 15;

export const OfficialRankingsCard: FC = () => {
  const { t } = useTranslation();
  const { rankings } = useConnectionsRankings();
  const officials = rankings?.topOfficials ?? [];

  if (officials.length === 0) return null;

  return (
    <Card className="my-4">
      <CardContent className="p-3 md:p-4">
        <h3 className="text-sm font-semibold mb-1">
          {t("connections_top_officials_title") || "Most-connected officials"}
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          {t("connections_top_officials_subtitle") ||
            "Cabinet, governors, mayors and councillors ranked by their high-confidence (declared-stake) company neighbourhood."}
        </p>
        <ol className="space-y-1 text-sm">
          {officials.slice(0, ROWS).map((o, i) => (
            <li key={o.slug} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <Link
                to={`/officials/${o.slug}`}
                className="truncate text-primary hover:underline"
              >
                {o.label}
              </Link>
              <span className="truncate text-xs text-muted-foreground">
                {o.municipality ?? t(`officials_cat_${o.role}`, o.role)}
              </span>
              <span className="ml-auto shrink-0 text-xs font-medium tabular-nums">
                {o.highConfDegree}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
};
