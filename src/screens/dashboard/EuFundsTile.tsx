// EU-funds (ИСУН) per-place tile, mounted on settlement (`/settlement/:ekatte`)
// and municipality (`/settlement/:obshtina`) dashboards. Reads a slim summary
// shard — funds/projects/by-ekatte/{ekatte}-summary.json or
// by-muni/{obshtina}-summary.json — so the tile loads instantly even on
// places like Sofia where the full per-place contract list is ~20 MB.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Coins, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useFundsForEkatte,
  useFundsForMuni,
} from "@/data/funds/useFundsForPlace";
import type {
  FundsProjectsSummaryFile,
  FundsProjectsTopContract,
} from "@/data/funds/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

// Per-contract status → small chip palette. The four dominant statuses cover
// >99 % of the corpus; anything else falls back to neutral.
const statusVariant = (status: string): { className: string; key: string } => {
  if (status.startsWith("Приключен"))
    return {
      key: "funds_tile_status_completed",
      className:
        "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
    };
  if (status.startsWith("В изпълнение"))
    return {
      key: "funds_tile_status_in_progress",
      className: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
    };
  if (status === "Сключен")
    return {
      key: "funds_tile_status_signed",
      className:
        "bg-slate-100 text-slate-900 dark:bg-slate-900/40 dark:text-slate-100",
    };
  if (status.startsWith("Прекратен"))
    return {
      key: "funds_tile_status_terminated",
      className:
        "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
    };
  return {
    key: "funds_tile_status_other",
    className:
      "bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground",
  };
};

const StatusChip: FC<{ status: string }> = ({ status }) => {
  const { t } = useTranslation();
  const v = statusVariant(status);
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap ${v.className}`}
      title={status}
    >
      {t(v.key)}
    </span>
  );
};

const ContractRow: FC<{ row: FundsProjectsTopContract }> = ({ row }) => {
  const body = (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium line-clamp-2">{row.title}</div>
        <div className="text-xs text-muted-foreground line-clamp-1">
          {row.beneficiaryName} · {row.programName}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="text-sm font-medium tabular-nums">
          {compactEur(row.totalEur)}
        </div>
        <StatusChip status={row.status} />
      </div>
    </div>
  );
  return row.beneficiaryEik ? (
    <Link
      to={`/company/${row.beneficiaryEik}`}
      className="block rounded p-2 -mx-2 hover:bg-muted/50 transition-colors"
    >
      {body}
    </Link>
  ) : (
    <div className="p-2 -mx-2">{body}</div>
  );
};

type Props =
  | { kind: "ekatte"; ekatte: string }
  | { kind: "muni"; obshtina: string };

const SkeletonState: FC = () => (
  <Card>
    <CardHeader className="pb-2">
      <div className="h-5 w-32 bg-muted rounded animate-pulse" />
    </CardHeader>
    <CardContent>
      <div className="h-24 bg-muted/50 rounded animate-pulse" />
    </CardContent>
  </Card>
);

export const EuFundsTile: FC<Props> = (props) => {
  const { t } = useTranslation();
  const ekatteResult = useFundsForEkatte(
    props.kind === "ekatte" ? props.ekatte : undefined,
  );
  const muniResult = useFundsForMuni(
    props.kind === "muni" ? props.obshtina : undefined,
  );
  const query = props.kind === "ekatte" ? ekatteResult : muniResult;
  const data: FundsProjectsSummaryFile | null | undefined = query.data;

  if (query.isLoading) return <SkeletonState />;
  // Place has no EU-funds activity — render nothing rather than an empty
  // card. The settlement-page dashboard already handles undefined-state for
  // its other tiles by simply not rendering.
  if (!data || data.rollup.contractCount === 0) return null;

  const {
    rollup,
    topContracts,
    topPrograms,
    perCapitaEur,
    perCapitaRank,
    cohortSize,
  } = data;
  const disbursementPct =
    rollup.totalEur > 0 ? (rollup.paidEur / rollup.totalEur) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Coins className="h-4 w-4 text-amber-600" aria-hidden />
          <span>{t("funds_tile_title")}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("funds_tile_subtitle")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* Headline metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">
              {t("funds_tile_contracts")}
            </div>
            <div className="text-base font-medium tabular-nums">
              {rollup.contractCount.toLocaleString("bg-BG")}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t("funds_tile_beneficiaries_label", {
                count: rollup.beneficiaryCount,
              })}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("funds_tile_contracted")}
            </div>
            <div className="text-base font-medium tabular-nums">
              {compactEur(rollup.totalEur)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t("funds_tile_paid_short", { v: compactEur(rollup.paidEur) })}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("funds_tile_disbursement_rate")}
            </div>
            <div className="text-base font-medium tabular-nums">
              {disbursementPct.toFixed(0)}%
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t("funds_tile_paid_of_contracted")}
            </div>
          </div>
          <div>
            {perCapitaEur != null ? (
              <>
                <div className="text-xs text-muted-foreground">
                  {t("funds_tile_per_capita")}
                </div>
                <div className="text-base font-medium tabular-nums">
                  {compactEur(perCapitaEur)}
                </div>
                {perCapitaRank != null && cohortSize != null ? (
                  <div className="text-[11px] text-muted-foreground">
                    {t("funds_tile_per_capita_rank", {
                      rank: perCapitaRank,
                      total: cohortSize,
                    })}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground">
                    {t("funds_tile_per_capita_caption")}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">
                  {t("funds_tile_per_capita")}
                </div>
                <div className="text-base font-medium tabular-nums text-muted-foreground">
                  —
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t("funds_tile_per_capita_unavailable")}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Top contracts */}
        {topContracts.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("funds_tile_top_contracts")}
            </div>
            <div className="divide-y divide-border/60">
              {topContracts.map((c) => (
                <ContractRow key={c.contractNumber} row={c} />
              ))}
            </div>
          </div>
        )}

        {/* Top programmes — compact bar list */}
        {topPrograms.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("funds_tile_top_programs")}
            </div>
            <div className="space-y-1">
              {topPrograms.map((p) => {
                const widthPct =
                  topPrograms[0].rollup.totalEur > 0
                    ? (p.rollup.totalEur / topPrograms[0].rollup.totalEur) * 100
                    : 0;
                return (
                  <div
                    key={p.programCode}
                    className="grid grid-cols-[1fr_auto] items-baseline gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="line-clamp-1">{p.programName}</div>
                      <div
                        className="h-1 mt-0.5 rounded-full bg-amber-300/70"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="tabular-nums font-medium text-right">
                      {compactEur(p.rollup.totalEur)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Source link */}
        <div className="flex items-center justify-end">
          <Link
            to="/funds"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            {t("funds_tile_see_all")}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
};
