// The top ИСУН beneficiaries by contracted value.
//
// EXTRACTED from FundsScreen, where it was a private component rendered inline on the hub.
// Nothing about it changed — it moves so `/funds/beneficiaries` can own it and the hub can
// front it with a tile instead of a fetch.
//
// `rowCount` is the caller's, not this component's: the same list is a 15-row preview on some
// surfaces and the full published ranking on its own page, and a card that decided for itself
// would make the page's heading count disagree with the rows under it.

import { type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/ux/Card";
import { orgTypeLabel } from "@/data/funds/orgLabels";
import { formatEur } from "@/lib/currency";
import type { FundsTopRow } from "@/data/funds/types";

export const TopBeneficiariesCard: FC<{
  rows: FundsTopRow[];
  rowCount?: number;
}> = ({ rows, rowCount = 15 }) => {
  const { t, i18n } = useTranslation();
  const visible = rows.slice(0, rowCount);
  return (
    <Card>
      <CardContent className="p-3 text-sm md:p-4">
        <ul className="flex flex-col divide-y divide-border">
          {visible.map((r, i) => (
            <li
              key={r.eik ?? `${r.name}-${i}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              {r.eik ? (
                <Link
                  to={`/company/${r.eik}`}
                  // CLAMPED, for the same reason the open-calls titles are: an organisation's
                  // registered name is a legal name, and the longest here runs past 120
                  // characters. Unclamped, one row sets the height of the whole card.
                  className="line-clamp-2 min-w-0 flex-1 font-medium hover:underline"
                  title={r.name}
                >
                  {r.name}
                </Link>
              ) : (
                <span
                  className="line-clamp-2 min-w-0 flex-1 font-medium"
                  title={r.name}
                >
                  {r.name}
                </span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">
                {orgTypeLabel(r.orgType, i18n.language)}
              </span>
              {r.mpTied ? (
                <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  {t("funds_mp_badge") || "MP-connected"}
                </span>
              ) : null}
              <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">
                {formatEur(r.contractedEur)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
