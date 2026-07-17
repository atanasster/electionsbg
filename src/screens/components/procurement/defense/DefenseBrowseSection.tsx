// Defense enrichment strip for the sector browse pack (/procurement/contracts?
// sector=defense). Renders the consolidated per-unit rollup as context ABOVE the
// filtered contracts table — scope-aware, over the SAME 25-EIK set the table
// filters on. Uses the lightweight `useDefenseGroupRollup` (ONE grouped aggregate)
// rather than the pack's full 25-EIK fan-out. Mirrors VikBrowseSection.

import { FC } from "react";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useDefenseGroupRollup } from "@/data/procurement/useDefense";
import type { SectorBrowseSectionProps } from "../sectorPacks";

const TOP_N = 12;

export const DefenseBrowseSection: FC<SectorBrowseSectionProps> = ({
  scope,
  eiks,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { units, isLoading } = useDefenseGroupRollup(eiks, scope);

  if (isLoading)
    return (
      <div className="h-[180px] animate-pulse rounded-xl border bg-card" />
    );
  if (!units.length) return null;
  const rows = units.slice(0, TOP_N);
  const max = Math.max(...rows.map((u) => u.totalEur), 1);
  const total = units.reduce((a, u) => a + u.totalEur, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4" />
          {bg
            ? "Структурите на МО — договорена стойност"
            : "МО units — contracted value"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        <p className="text-xs text-muted-foreground">
          {bg
            ? `${units.length} структури · ${formatEurCompact(total, lang)} общо в обхвата.`
            : `${units.length} units · ${formatEurCompact(total, lang)} total in scope.`}
        </p>
        {rows.map((u) => (
          <div key={u.eik} className="text-xs">
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
              <AwarderLink
                eik={u.eik}
                className="min-w-0 truncate hover:text-primary hover:underline"
              >
                {u.name}
              </AwarderLink>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatEurCompact(u.totalEur, lang)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(2, (u.totalEur / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
