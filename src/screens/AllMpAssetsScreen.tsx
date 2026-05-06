import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Wallet, ArrowUp, ArrowDown, ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { useAssetsRankings } from "@/data/parliament/useAssetsRankings";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { formatThousands } from "@/data/utils";
import type { MpAssetsRankingEntry } from "@/data/dataTypes";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { useRegionScope } from "@/screens/utils/useRegionScope";
import { RegionScopeChip } from "@/screens/utils/RegionScopeChip";

type Scope = "ns" | "all";

const formatBgn = (n: number, lang: string): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Math.round(n),
  );
};

export const AllMpAssetsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { rankings } = useAssetsRankings();
  const { selected } = useElectionContext();
  const [scope, setScope] = useState<Scope>("ns");
  const { regionMpIds, label: regionLabel, clearedParams } = useRegionScope();

  const folder = useMemo(() => electionToNsFolder(selected), [selected]);

  const source: MpAssetsRankingEntry[] = useMemo(() => {
    if (!rankings) return [];
    let rows: MpAssetsRankingEntry[];
    if (scope === "ns" && folder && rankings.byNs[folder]?.topMps?.length) {
      rows = rankings.byNs[folder].topMps;
    } else {
      rows = rankings.topMps;
    }
    if (regionMpIds) {
      rows = rows.filter((m) => regionMpIds.has(m.mpId));
    }
    return rows;
  }, [rankings, scope, folder, regionMpIds]);

  const columns: DataTableColumns<MpAssetsRankingEntry, unknown> = useMemo(
    () => [
      {
        accessorKey: "label",
        header: t("mp_assets_col_mp") || "MP",
        cell: ({ row }) => (
          <div className="flex items-center gap-2 min-w-0">
            <MpAvatar mpId={row.original.mpId} name={row.original.label} />
            <Link
              to={candidateUrlForMp(row.original.mpId)}
              className="hover:underline truncate"
            >
              {row.original.label}
            </Link>
          </div>
        ),
      },
      {
        accessorKey: "partyGroupShort",
        header: t("mp_assets_col_party") || "Party group",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate max-w-[160px] block">
            {row.original.partyGroupShort ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "latestDeclarationYear",
        header: t("mp_assets_col_year") || "Year",
        cell: ({ row }) => (
          <div className="text-right text-xs tabular-nums">
            {row.original.latestDeclarationYear}
          </div>
        ),
      },
      {
        accessorKey: "totalAssetsBgn",
        header: t("mp_assets_col_assets") || "Assets (BGN)",
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-mono">
            {formatBgn(row.original.totalAssetsBgn, i18n.language)}
          </div>
        ),
      },
      {
        accessorKey: "totalDebtsBgn",
        header: t("mp_assets_col_debts") || "Debts (BGN)",
        cell: ({ row }) => (
          <div
            className={`text-right tabular-nums font-mono ${row.original.totalDebtsBgn > 0 ? "text-red-600" : "text-muted-foreground"}`}
          >
            {row.original.totalDebtsBgn > 0
              ? formatBgn(row.original.totalDebtsBgn, i18n.language)
              : "—"}
          </div>
        ),
      },
      {
        accessorKey: "netWorthBgn",
        header: t("mp_assets_col_net") || "Net (BGN)",
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-mono font-semibold">
            {formatBgn(row.original.netWorthBgn, i18n.language)}
          </div>
        ),
      },
      {
        accessorKey: "realEstateCount",
        header: t("mp_assets_col_real_estate") || "Properties",
        cell: ({ row }) => (
          <div className="text-right text-xs tabular-nums">
            {row.original.realEstateCount}
            {row.original.realEstateUnvalued > 0 && (
              <span className="text-muted-foreground ml-1">
                (+{row.original.realEstateUnvalued}{" "}
                {t("mp_assets_unvalued_short") || "n/v"})
              </span>
            )}
          </div>
        ),
      },
      {
        id: "delta",
        accessorFn: (row) => row.delta?.absoluteBgn ?? null,
        header: t("mp_assets_col_yoy") || "YoY change",
        sortUndefined: "last",
        cell: ({ row }) => {
          const delta = row.original.delta;
          if (!delta) {
            return <div className="text-right text-xs text-muted-foreground">—</div>;
          }
          const colorClass =
            delta.absoluteBgn > 0
              ? "text-green-600"
              : delta.absoluteBgn < 0
                ? "text-red-600"
                : "text-muted-foreground";
          return (
            <div className={`text-right text-xs tabular-nums ${colorClass}`}>
              <span className="inline-flex items-center gap-0.5">
                {delta.absoluteBgn > 0 ? (
                  <ArrowUp className="h-3 w-3" />
                ) : delta.absoluteBgn < 0 ? (
                  <ArrowDown className="h-3 w-3" />
                ) : null}
                {delta.pct != null
                  ? `${Math.abs(delta.pct).toFixed(0)}%`
                  : `${formatThousands(Math.round(Math.abs(delta.absoluteBgn)))}`}
              </span>
            </div>
          );
        },
      },
      {
        id: "open",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={candidateUrlForMp(row.original.mpId)}
            className="text-primary hover:underline inline-flex"
            aria-label="open candidate"
          >
            <ExternalLink className="h-3 w-3" />
          </Link>
        ),
      },
    ],
    [t, i18n.language],
  );

  if (!rankings) return null;

  const scopeToggle = (
    <div className="flex items-center gap-2 flex-wrap">
      {regionLabel && (
        <RegionScopeChip label={regionLabel} clearedParams={clearedParams} />
      )}
      <button
        type="button"
        onClick={() => setScope("ns")}
        className={`text-xs px-3 py-1 rounded-full border ${
          scope === "ns"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-card hover:bg-muted/40"
        }`}
        disabled={!folder || !rankings.byNs[folder]?.topMps?.length}
      >
        {t("mp_assets_scope_ns") || "Selected parliament"}
        {folder ? ` · ${folder}` : ""}
      </button>
      <button
        type="button"
        onClick={() => setScope("all")}
        className={`text-xs px-3 py-1 rounded-full border ${
          scope === "all"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-card hover:bg-muted/40"
        }`}
      >
        {t("mp_assets_scope_all") || "All parliaments"}
      </button>
    </div>
  );

  return (
    <div className="w-full">
      <Title description={t("mp_assets_page_description") || ""}>
        {t("mp_assets_page_title") || "MPs by declared assets"}
      </Title>

      <DataTable<MpAssetsRankingEntry, unknown>
        title={t("mp_assets_page_title") || "MPs by declared assets"}
        pageSize={25}
        columns={columns}
        data={source}
        toolbarItems={scopeToggle}
        initialSort={[{ id: "netWorthBgn", desc: true }]}
      />

      <div className="text-xs text-muted-foreground mt-4">
        {t("mp_assets_page_footer") ||
          "Net worth = sum of declared real estate, vehicles, cash, bank deposits, receivables, investments, securities and company shares (declarant + spouse) minus declared debts. Source: register.cacbg.bg (Bulgarian Court of Audit). Each MP's most recent filed declaration is used."}
      </div>
    </div>
  );
};
