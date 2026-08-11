// A ranked "where the money is" tile for the person portfolio — reused for the two cuts the
// person page shows (docs/plans/person-procurement-browser-v1.md, Tier 4):
//   • BY COMPANY   — the person's own firms, ranked by procurement € (which firm won the money);
//   • BY SETTLEMENT — the awarder settlements paying those firms, ranked (geographic spread).
//
// Both arrive already ranked + reconciled from /api/db/person (person_procurement_by_company /
// _by_settlement, migration 125), so this component only slices the top N and draws bars. It
// self-hides when empty (most people have no procurement).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { LucideIcon } from "lucide-react";

export type PersonBreakdownRow = {
  /** Stable key (eik / ekatte / a sentinel for the national bucket). */
  id: string;
  /** Row label (company name / settlement name). */
  label: string;
  /** Destination, or null for a non-linkable row (e.g. the "national" settlement bucket). */
  href: string | null;
  totalEur: number;
  contractCount: number;
};

const TOP_ROWS = 8;

export const PersonProcurementBreakdownTile: FC<{
  title: string;
  icon: LucideIcon;
  rows: PersonBreakdownRow[];
}> = ({ title, icon: Icon, rows }) => {
  const { t, i18n } = useTranslation();
  if (!rows || rows.length === 0) return null;

  const shown = rows.slice(0, TOP_ROWS);
  // Bars scale to #1 so proportions read even when the leader is a small slice of the whole.
  const maxEur = Math.max(...shown.map((r) => r.totalEur), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
          {rows.length > TOP_ROWS ? (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {t("pp_breakdown_top_n", { n: TOP_ROWS }) || `Топ ${TOP_ROWS}`}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-1">
        {/* Label and € share one line, the contract count sits under them. Keeping the count
            INLINE with the label is what broke on a phone: `truncate` on an inline <Link> is
            inert (it needs a block box), so a long company name pushed the count onto a second
            line and orphaned its unit word next to a value still sitting on the first. */}
        {shown.map((r) => (
          <div key={r.id} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              {r.href ? (
                <Link
                  to={r.href}
                  className="min-w-0 truncate text-sm text-primary hover:underline"
                  title={r.label}
                >
                  {r.label}
                </Link>
              ) : (
                <span
                  className="min-w-0 truncate text-sm text-muted-foreground"
                  title={r.label}
                >
                  {r.label}
                </span>
              )}
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {formatEurCompact(r.totalEur, i18n.language)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {t("pp_stake_proc_contracts", { count: r.contractCount })}
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full rounded bg-primary/60"
                style={{
                  width: `${Math.max(3, (r.totalEur / maxEur) * 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
