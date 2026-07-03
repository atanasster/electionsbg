// "What does the state buy" — national CPV-division breakdown for the
// procurement dashboard, scoped to the section window (?pscope). Top divisions
// as labelled share bars (same visual language as ProcurementBreakdownTile's
// entity version), the long tail + uncoded contracts folded into one closing
// row so the shares always add up against the window total.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PieChart, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Tooltip } from "@/ux/Tooltip";
import { useProcurementSectors } from "@/data/procurement/useProcurementSectors";
import { useProcurementHref } from "@/data/procurement/useProcurementScope";
import { cpvDivisionName } from "@/lib/cpvSectors";
import { formatEurCompact } from "@/lib/currency";

const TOP = 8;

const Bar: FC<{ label: string; share: number; amount: string }> = ({
  label,
  share,
  amount,
}) => (
  <div className="flex items-center gap-2 py-1 text-sm">
    <Tooltip content={label}>
      <span className="min-w-0 w-40 sm:w-56 truncate">{label}</span>
    </Tooltip>
    <span className="relative h-2 flex-1 overflow-hidden rounded bg-muted">
      <span
        className="absolute inset-y-0 left-0 rounded bg-primary/70"
        style={{ width: `${Math.max(1, share * 100)}%` }}
      />
    </span>
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums w-14 text-right">
      {(share * 100).toFixed(1)}%
    </span>
    <span className="shrink-0 text-xs tabular-nums w-16 text-right">
      {amount}
    </span>
  </div>
);

export const ProcurementSectorsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const buildHref = useProcurementHref();
  const { data } = useProcurementSectors();
  if (!data || data.totalEur <= 0 || data.sectors.length === 0) return null;

  const top = data.sectors.slice(0, TOP);
  const restEur =
    data.sectors.slice(TOP).reduce((s, x) => s + x.eur, 0) + data.uncoded.eur;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PieChart className="h-4 w-4 text-muted-foreground" />
          {t("procurement_sectors_title") || "What does the state buy"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 pt-0">
        {top.map((s) => (
          <Bar
            key={s.division}
            label={cpvDivisionName(s.division, i18n.language)}
            share={s.eur / data.totalEur}
            amount={formatEurCompact(s.eur, i18n.language)}
          />
        ))}
        {restEur > 0 ? (
          <Bar
            label={t("procurement_sectors_rest") || "All other sectors"}
            share={restEur / data.totalEur}
            amount={formatEurCompact(restEur, i18n.language)}
          />
        ) : null}
        <Link
          to={buildHref("/procurement/sectors")}
          className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-border bg-accent/30 px-3 py-2 text-xs font-medium text-foreground hover:bg-accent/60 transition-colors"
        >
          {t("procurement_sectors_browse") || "See all sectors"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
};
