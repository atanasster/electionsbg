// Compact "fiscal footprint" tile on the cabinet detail page. Sums the
// investment-program project value + NOI gross expenditure across every
// fiscal year that overlaps the cabinet's tenure.
//
// "Overlaps" = any part of the calendar fiscal year falls within
// [startDate, endDate). A 4-year cabinet is credited with up to 5 fiscal
// years; a caretaker that lasts 3 months can be credited with 1. The total
// is informational — the cabinet rarely "spent" the full envelope on its
// own (preceding cabinet approved the budget, following one executed the
// tail) — so the tile labels the figure as a tenure-overlap total rather
// than attribution.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import type { Government } from "@/data/governments/useGovernments";
import {
  useNoiFunds,
  useInvestmentProgramIndex,
  useInvestmentProgram,
} from "@/data/budget/useBudget";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return formatEur(v);
};

const fiscalYearsInTenure = (
  startIso: string,
  endIso: string | undefined,
): number[] => {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : new Date();
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const out: number[] = [];
  for (let y = startYear; y <= endYear; y++) out.push(y);
  return out;
};

export const CabinetFiscalFootprintTile: FC<{ government: Government }> = ({
  government,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";

  const tenureYears = useMemo(
    () =>
      fiscalYearsInTenure(
        government.startDate,
        government.endDate ?? undefined,
      ),
    [government.startDate, government.endDate],
  );

  const { data: noi } = useNoiFunds();
  const { data: investIndex } = useInvestmentProgramIndex();
  // Fetch the latest year that overlaps — drives the byCategory / topProjects
  // section. Cabinets spanning multiple years still surface the latest year's
  // composition since per-fiscal-year shape stays roughly stable.
  const latestOverlapYear = useMemo(() => {
    if (!investIndex) return null;
    const available = new Set(investIndex.years.map((y) => y.fiscalYear));
    const overlapped = tenureYears
      .filter((y) => available.has(y))
      .sort((a, b) => b - a);
    return overlapped[0] ?? null;
  }, [investIndex, tenureYears]);
  const { data: program } = useInvestmentProgram(
    latestOverlapYear ?? undefined,
  );

  // Cumulative NOI gross expenditure + pensions across overlap years.
  //
  // Only years carrying real fund detail count. The B1 ingest publishes a new
  // fiscal year mid-cycle as a partial/shell record (funds: [], revenue: 0)
  // whose `expenditure` is just the yearbook pension mass rather than gross
  // expenditure — summing it understates the total while `yearsCovered` still
  // claims the year as covered, and a cabinet whose whole tenure falls in a
  // shell year renders "€X gross, of which €X pensions". Same guard as
  // flattenFundYear in src/data/procurement/useNoi.tsx. If no overlap year is
  // complete the block is dropped entirely rather than shown understated.
  const noiCumulative = useMemo(() => {
    if (!noi) return null;
    const overlapped = noi.years.filter(
      (y) =>
        tenureYears.includes(y.fiscalYear) &&
        y.funds.length > 0 &&
        y.totals.revenue.amountEur > 0,
    );
    if (overlapped.length === 0) return null;
    return {
      yearsCovered: overlapped.length,
      totalExpEur: overlapped.reduce(
        (s, y) => s + y.totals.expenditure.amountEur,
        0,
      ),
      totalPensionsEur: overlapped.reduce(
        (s, y) => s + y.totals.pensions.amountEur,
        0,
      ),
    };
  }, [noi, tenureYears]);

  // Cumulative investment program total across overlap years.
  const investCumulative = useMemo(() => {
    if (!investIndex) return null;
    const overlapped = investIndex.years.filter((y) =>
      tenureYears.includes(y.fiscalYear),
    );
    if (overlapped.length === 0) return null;
    return {
      yearsCovered: overlapped.length,
      totalEur: overlapped.reduce((s, y) => s + y.grandTotalEur, 0),
      totalProjects: overlapped.reduce((s, y) => s + y.projectCount, 0),
    };
  }, [investIndex, tenureYears]);

  if (!noiCumulative && !investCumulative) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Landmark className="h-4 w-4" />
          {t("cabinet_fiscal_footprint_title")}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {tenureYears[0]}
            {tenureYears.length > 1
              ? `–${tenureYears[tenureYears.length - 1]}`
              : ""}
            {lang === "bg" ? " г." : ""}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("cabinet_fiscal_footprint_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {investCumulative && (
            <div className="rounded border bg-card p-3">
              <div className="text-xs text-muted-foreground mb-1">
                {t("cabinet_fiscal_footprint_invest_label")}
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {compactEur(investCumulative.totalEur)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {t("cabinet_fiscal_footprint_invest_caption", {
                  projects: investCumulative.totalProjects.toLocaleString("en"),
                  years: investCumulative.yearsCovered,
                })}
              </div>
            </div>
          )}
          {noiCumulative && (
            <div className="rounded border bg-card p-3">
              <div className="text-xs text-muted-foreground mb-1">
                {t("cabinet_fiscal_footprint_noi_label")}
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {compactEur(noiCumulative.totalExpEur)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {t("cabinet_fiscal_footprint_noi_caption", {
                  pensions: compactEur(noiCumulative.totalPensionsEur),
                  years: noiCumulative.yearsCovered,
                })}
              </div>
            </div>
          )}
        </div>

        {/* Latest-year investment categories — gives a flavour of what kinds of
            projects the cabinet's last overlap year funded. */}
        {program && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("cabinet_fiscal_footprint_latest_categories", {
                year: latestOverlapYear,
              })}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {program.byCategory.slice(0, 3).map((cat) => (
                <div
                  key={cat.key}
                  className="rounded border bg-card p-2 text-xs"
                >
                  <div className="text-muted-foreground line-clamp-1">
                    {lang === "bg" ? cat.labelBg : cat.labelEn}
                  </div>
                  <div className="font-medium tabular-nums">
                    {compactEur(cat.total.amountEur)}
                  </div>
                  <div className="text-muted-foreground text-[10px]">
                    {cat.count} {t("cabinet_fiscal_footprint_projects_unit")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          {t("cabinet_fiscal_footprint_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
