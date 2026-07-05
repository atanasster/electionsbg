// Dashboard tile: top procurement contractors (top 10 preview) with a
// "Виж всички" link to the standalone /procurement/contractors page. Has
// two data paths:
//   - Per-NS slice (default): ProcurementByNsFile.topContractors
//   - Show-all-years: top_contractors.json from the global derived index
//
// Operator controls the choice via the parent ProcurementScreen toggle;
// this component just renders whichever rows it's given.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { FollowStar } from "./FollowStar";
import { useTopContractors } from "@/data/procurement/useProcurementIndex";
import type { ProcurementByNsFile } from "@/data/dataTypes";
import { formatEur, formatEurWithOther } from "@/lib/currency";

const TOP_ROWS = 10;

interface Row {
  eik: string;
  name: string;
  totalDisplay: string;
  contractCount: number;
  mpTied: boolean;
}

export const TopContractorsTile: FC<{
  // When provided, render the per-NS top contractors. Otherwise fall back to
  // the global top_contractors.json (full-corpus view).
  byNs?: ProcurementByNsFile | null;
}> = ({ byNs }) => {
  const { t, i18n } = useTranslation();
  const useNs = byNs !== undefined;
  // Skip the full-corpus JSON fetch when the parent passes per-NS data (overview).
  const allYears = useTopContractors(!useNs);

  const rows = useMemo<Row[]>(() => {
    if (useNs) {
      if (!byNs) return [];
      return byNs.topContractors.slice(0, TOP_ROWS).map((e) => ({
        eik: e.eik,
        name: e.name,
        totalDisplay: formatEur(e.totalEur, i18n.language),
        contractCount: e.contractCount,
        mpTied: e.mpTied ?? false,
      }));
    }
    return (
      allYears.data?.entries.slice(0, TOP_ROWS).map((e) => ({
        eik: e.eik,
        name: e.name,
        totalDisplay:
          formatEurWithOther(e.totalEur, e.totalOther, i18n.language) || "—",
        contractCount: e.contractCount,
        mpTied: e.mpTied ?? false,
      })) ?? []
    );
  }, [useNs, byNs, allYears.data, i18n.language]);

  const isLoading = useNs ? false : allYears.isLoading;

  if (isLoading) {
    return (
      <Card className="my-4" aria-hidden>
        <CardContent>
          <div className="min-h-[480px]" />
        </CardContent>
      </Card>
    );
  }
  if (rows.length === 0) return null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Receipt className="h-4 w-4" />
          {t("procurement_index_top_contractors") || "Top contractors"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("procurement_index_top_subtitle") ||
              "Sorted by total amount. MP-tied contractors are highlighted."}
          </span>
          <Link
            to="/procurement/contractors"
            className="ml-auto text-[10px] normal-case text-primary hover:underline"
          >
            {t("procurement_tile_see_all") || "See all"} →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="flex flex-col">
          {rows.map((e, idx) => (
            <div
              key={e.eik}
              className={`text-sm flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0 ${
                e.mpTied
                  ? "bg-amber-50/60 dark:bg-amber-950/20 -mx-2 px-2 rounded"
                  : ""
              }`}
            >
              <span className="text-muted-foreground w-5 shrink-0 text-right tabular-nums text-xs">
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/company/${e.eik}`}
                  className="font-medium hover:underline truncate inline-flex items-center gap-2"
                >
                  <span className="truncate">{e.name}</span>
                  {e.mpTied ? (
                    <span className="inline-block rounded bg-amber-200/60 dark:bg-amber-800/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide shrink-0">
                      {t("procurement_index_mp_tag") || "MP-tied"}
                    </span>
                  ) : null}
                </Link>
              </div>
              <span className="tabular-nums shrink-0 min-w-[90px] text-right font-medium">
                {e.totalDisplay}
              </span>
              <span className="text-muted-foreground tabular-nums shrink-0 text-xs w-8 text-right hidden md:inline">
                {e.contractCount.toLocaleString("bg-BG")}
              </span>
              <FollowStar kind="company" id={e.eik} label={e.name} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
