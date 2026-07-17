// Top programmes by contracted value for /funds. Reads byProgram from the
// contract-level corpus index. Each row carries the programme name (in
// Bulgarian, ИСУН-canonical) with a horizontal contracted-value bar, the
// per-programme disbursement rate as a small badge, and the contract count
// in a tabular sub-line. Capped at 10 rows — the remainder live in the
// per-programme shards under by-program/ (not yet surfaced as its own page,
// see Phase 3 of the funds-UX plan).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { FundsProjectsIndexFile } from "@/data/funds/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

const numFmt = new Intl.NumberFormat("bg-BG");

const TOP_N = 10;

// Disbursement rate color buckets — match the policy framing: a programme
// paying >80 % of contracted is healthy (green), 40-80 % normal (amber),
// <40 % flag (rose). Same rate palette used across the funds tiles.
const rateBadgeClass = (pct: number): string => {
  if (pct >= 80)
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100";
  if (pct >= 40)
    return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
  return "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100";
};

export const TopProgramsTile: FC<{ index: FundsProjectsIndexFile }> = ({
  index,
}) => {
  const { t } = useTranslation();
  const rows = index.byProgram.slice(0, TOP_N);
  const max = Math.max(...rows.map((r) => r.rollup.totalEur), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Layers className="h-4 w-4 text-amber-600" aria-hidden />
          <span>{t("funds_programs_tile_title")}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("funds_programs_tile_subtitle", {
              n: rows.length,
              total: index.byProgram.length,
            })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <ul className="space-y-3">
          {rows.map((p, i) => {
            const pct = (p.rollup.totalEur / max) * 100;
            const disbursementPct =
              p.rollup.totalEur > 0
                ? (p.rollup.paidEur / p.rollup.totalEur) * 100
                : 0;
            return (
              <li key={p.programCode}>
                <Link
                  to={`/funds/programme/${p.programCode}`}
                  className="block space-y-1 rounded -mx-2 px-2 py-1 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0 line-clamp-1 font-medium">
                      {p.programName}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${rateBadgeClass(disbursementPct)}`}
                      title={t("funds_programs_tile_disbursement_tip", {
                        paid: compactEur(p.rollup.paidEur),
                        total: compactEur(p.rollup.totalEur),
                      })}
                    >
                      {disbursementPct.toFixed(0)}%
                    </span>
                    <span className="shrink-0 w-20 text-right text-sm font-medium tabular-nums">
                      {compactEur(p.rollup.totalEur)}
                    </span>
                  </div>
                  <div className="ml-7 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-amber-400/70"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="ml-7 text-[11px] text-muted-foreground tabular-nums">
                    {numFmt.format(p.rollup.contractCount)}{" "}
                    {t("funds_programs_tile_contracts")} ·{" "}
                    {numFmt.format(p.rollup.beneficiaryCount)}{" "}
                    {t("funds_programs_tile_beneficiaries")}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-[11px] text-muted-foreground">
          {t("funds_programs_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
