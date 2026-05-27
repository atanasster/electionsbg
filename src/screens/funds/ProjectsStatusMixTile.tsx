// Contract-status mix tile for /funds — Completed / In progress / Signed /
// Terminated as a horizontal bar list with totalEur AND paidEur per row.
// Surfaces the disbursement-gap story: completed contracts are ~99 % paid;
// active contracts sit at ~20-40 % paid; signed-but-not-started contracts
// are 0 %; terminated contracts have a near-zero payment rate.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type {
  FundsProjectsIndexFile,
  FundsProjectsRollup,
} from "@/data/funds/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

const numFmt = new Intl.NumberFormat("bg-BG");

// Bulgarian-text status → display key + accent color. The raw status string
// from ИСУН is verbose ("Приключен (към датата на приключване)"); we shorten
// it for the tile and pin colours to the same palette as EuFundsTile so the
// status grammar is consistent across the app.
const STATUS_STYLES: Array<{
  match: (s: string) => boolean;
  i18nKey: string;
  color: string;
  // CSS color for the filled bar segment.
  barClass: string;
}> = [
  {
    match: (s) => s.startsWith("Приключен"),
    i18nKey: "funds_tile_status_completed",
    color: "rgb(16 185 129)",
    barClass: "bg-emerald-400",
  },
  {
    match: (s) => s.startsWith("В изпълнение"),
    i18nKey: "funds_tile_status_in_progress",
    color: "rgb(14 165 233)",
    barClass: "bg-sky-400",
  },
  {
    match: (s) => s === "Сключен",
    i18nKey: "funds_tile_status_signed",
    color: "rgb(100 116 139)",
    barClass: "bg-slate-400",
  },
  {
    match: (s) => s.startsWith("Прекратен"),
    i18nKey: "funds_tile_status_terminated",
    color: "rgb(244 63 94)",
    barClass: "bg-rose-400",
  },
];

interface StatusRow {
  status: string;
  rollup: FundsProjectsRollup;
}

// Collapse the raw byStatus rows into the four styled buckets (Completed /
// In progress / Signed / Terminated), summing all matching variants. The
// ИСУН corpus carries long-tail variants — "В изпълнение (временно спрян)"
// and "В изпълнение (под наблюдение)" both belong under the "In progress"
// umbrella for the dashboard story. Anything that matches no style falls
// into an "other" row at the bottom (rare; sums tiny outliers).
const groupedRows = (
  byStatus: StatusRow[],
): Array<{ row: StatusRow; style: (typeof STATUS_STYLES)[number] | null }> => {
  const used = new Set<string>();
  const out: Array<{
    row: StatusRow;
    style: (typeof STATUS_STYLES)[number] | null;
  }> = [];
  for (const style of STATUS_STYLES) {
    const matches = byStatus.filter((r) => style.match(r.status));
    if (matches.length === 0) continue;
    for (const m of matches) used.add(m.status);
    const merged: StatusRow = {
      status: matches[0].status,
      rollup: matches.reduce(
        (acc, r) => ({
          contractCount: acc.contractCount + r.rollup.contractCount,
          beneficiaryCount: acc.beneficiaryCount + r.rollup.beneficiaryCount,
          totalEur: acc.totalEur + r.rollup.totalEur,
          grantEur: acc.grantEur + r.rollup.grantEur,
          paidEur: acc.paidEur + r.rollup.paidEur,
        }),
        {
          contractCount: 0,
          beneficiaryCount: 0,
          totalEur: 0,
          grantEur: 0,
          paidEur: 0,
        } as FundsProjectsRollup,
      ),
    };
    out.push({ row: merged, style });
  }
  const other = byStatus.filter((r) => !used.has(r.status));
  if (other.length > 0) {
    const merged: StatusRow = {
      status: "other",
      rollup: other.reduce(
        (acc, r) => ({
          contractCount: acc.contractCount + r.rollup.contractCount,
          beneficiaryCount: acc.beneficiaryCount + r.rollup.beneficiaryCount,
          totalEur: acc.totalEur + r.rollup.totalEur,
          grantEur: acc.grantEur + r.rollup.grantEur,
          paidEur: acc.paidEur + r.rollup.paidEur,
        }),
        {
          contractCount: 0,
          beneficiaryCount: 0,
          totalEur: 0,
          grantEur: 0,
          paidEur: 0,
        } as FundsProjectsRollup,
      ),
    };
    out.push({ row: merged, style: null });
  }
  return out;
};

export const ProjectsStatusMixTile: FC<{ index: FundsProjectsIndexFile }> = ({
  index,
}) => {
  const { t } = useTranslation();
  const rows = groupedRows(index.byStatus);
  const maxTotal = Math.max(...rows.map((r) => r.row.rollup.totalEur), 1);
  const corpusTotal = index.totals.totalEur;
  const corpusPaid = index.totals.paidEur;
  const corpusRate = corpusTotal > 0 ? (corpusPaid / corpusTotal) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Activity className="h-4 w-4 text-sky-600" aria-hidden />
          <span>{t("funds_status_tile_title")}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("funds_status_tile_subtitle", {
              rate: corpusRate.toFixed(0),
            })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="space-y-3">
          {rows.map(({ row, style }) => {
            const totalPct = (row.rollup.totalEur / maxTotal) * 100;
            const paidPct =
              row.rollup.totalEur > 0
                ? (row.rollup.paidEur / row.rollup.totalEur) * 100
                : 0;
            return (
              <div key={row.status} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">
                    {style ? t(style.i18nKey) : row.status}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {numFmt.format(row.rollup.contractCount)}{" "}
                    {t("funds_status_tile_contracts")}
                  </span>
                </div>
                <div className="relative h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`absolute inset-y-0 left-0 ${
                      style ? style.barClass : "bg-muted-foreground/60"
                    } opacity-40`}
                    style={{ width: `${totalPct}%` }}
                    title={`${t("funds_status_tile_contracted")}: ${compactEur(row.rollup.totalEur)}`}
                  />
                  <div
                    className={`absolute inset-y-0 left-0 ${
                      style ? style.barClass : "bg-muted-foreground"
                    }`}
                    style={{ width: `${(totalPct * paidPct) / 100}%` }}
                    title={`${t("funds_status_tile_paid")}: ${compactEur(row.rollup.paidEur)}`}
                  />
                </div>
                <div className="flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    {compactEur(row.rollup.totalEur)}{" "}
                    {t("funds_status_tile_contracted")} ·{" "}
                    {compactEur(row.rollup.paidEur)}{" "}
                    {t("funds_status_tile_paid")}
                  </span>
                  <span className="font-medium">
                    {paidPct.toFixed(0)}%{" "}
                    {t("funds_status_tile_disbursement_short")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("funds_status_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
