// /procurement/mps — full pageable list of MPs AND non-MP officials ranked by
// procurement awarded to their connected companies, DB-backed
// (/api/db/procurement-rankings) and scoped to the current procurement window
// (?pscope). Two stacked sections sharing one fetch (useProcurementRankings
// already returns both topMps and topOfficials, unlimited) — the "see all"
// destination for the dashboard's TopConnectedPeopleTile and the flags page's
// MP-tied section, replacing the old /procurement/people scanner.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users, Landmark } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/ux/data_table/DataTable";
import { Title } from "@/ux/Title";
import { useProcurementRankings } from "@/data/procurement/useProcurementRankings";
import type {
  ProcurementByNsTopMp,
  ProcurementByNsTopOfficial,
} from "@/data/dataTypes";
import { MpAvatar } from "./components/candidates/MpAvatar";
import { ConfidenceBadge } from "./components/connections/ConfidenceBadge";

const formatEur = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });

// Human label for an official's role, falling back to a de-underscored form
// when no translation exists. Same helper as TopConnectedPeopleTile.
const roleLabel = (role: string, t: (k: string) => string): string => {
  if (!role) return "";
  const key = `official_role_${role}`;
  const translated = t(key);
  return translated === key ? role.replace(/_/g, " ") : translated;
};

export const TopMpsScreen: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useProcurementRankings();

  const columns = useMemo<ColumnDef<ProcurementByNsTopMp>[]>(
    () => [
      {
        id: "rank",
        header: "#",
        cell: ({ row, table }) =>
          table.getState().pagination.pageIndex *
            table.getState().pagination.pageSize +
          row.index +
          1,
        enableSorting: false,
        meta: { exportable: false },
      },
      {
        accessorKey: "mpName",
        header: t("procurement_col_mp") || "MP",
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div>
              <span className="inline-flex items-center gap-2">
                <Link
                  to={`/candidate/mp-${e.mpId}#mp-procurement`}
                  className="font-medium hover:underline inline-flex items-center gap-2"
                >
                  <MpAvatar mpId={e.mpId} name={e.mpName} />
                  {e.mpName}
                </Link>
                {e.confidence === "medium" ? (
                  <ConfidenceBadge confidence="medium" showHigh={false} />
                ) : null}
              </span>
              {e.topContractorNames.length > 0 ? (
                <div className="text-xs text-muted-foreground truncate max-w-md">
                  {e.topContractorNames.join(", ")}
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "totalEur",
        header: t("procurement_index_col_total") || "Total",
        cell: ({ row }) =>
          `€${formatEur.format(Math.round(row.original.totalEur))}`,
        meta: { align: "right" },
      },
      {
        accessorKey: "contractorCount",
        header: t("procurement_col_companies") || "Companies",
        meta: { align: "right" },
      },
      {
        accessorKey: "contractCount",
        header: t("procurement_index_col_contracts") || "Contracts",
        meta: { align: "right" },
      },
    ],
    [t],
  );

  const officialColumns = useMemo<ColumnDef<ProcurementByNsTopOfficial>[]>(
    () => [
      {
        id: "rank",
        header: "#",
        cell: ({ row, table }) =>
          table.getState().pagination.pageIndex *
            table.getState().pagination.pageSize +
          row.index +
          1,
        enableSorting: false,
        meta: { exportable: false },
      },
      {
        accessorKey: "name",
        header: t("procurement_col_official") || "Official",
        cell: ({ row }) => {
          const e = row.original;
          const role = roleLabel(e.role, t);
          return (
            <div>
              <Link
                to={`/officials/${e.slug}`}
                className="font-medium hover:underline inline-flex items-center gap-2"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200">
                  <Landmark className="h-3.5 w-3.5" />
                </span>
                {e.name}
                {role ? (
                  <span className="text-xs text-muted-foreground font-normal">
                    {role}
                  </span>
                ) : null}
              </Link>
              {e.topContractorNames.length > 0 ? (
                <div className="text-xs text-muted-foreground truncate max-w-md">
                  {e.topContractorNames.join(", ")}
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "totalEur",
        header: t("procurement_index_col_total") || "Total",
        cell: ({ row }) =>
          `€${formatEur.format(Math.round(row.original.totalEur))}`,
        meta: { align: "right" },
      },
      {
        accessorKey: "contractorCount",
        header: t("procurement_col_companies") || "Companies",
        meta: { align: "right" },
      },
      {
        accessorKey: "contractCount",
        header: t("procurement_index_col_contracts") || "Contracts",
        meta: { align: "right" },
      },
    ],
    [t],
  );

  const windowSuffix =
    data && (data.start || data.end) ? (
      <span className="ml-2">
        · {data.start ?? ""}
        {data.end ? `…${data.end}` : ` …`}
      </span>
    ) : null;

  return (
    <>
      <Title
        description={
          t("procurement_connected_people_desc") ||
          "MPs and public officials whose connected companies received public procurement, DB-scoped to the selected parliament or the full corpus."
        }
      >
        {t("procurement_connected_people_title") ||
          "Connected MPs and officials"}
      </Title>
      {isLoading ? (
        <div className="min-h-[600px] my-4" aria-hidden />
      ) : !data ? (
        <p className="my-4 text-sm text-muted-foreground">
          {t("data_load_failed") ||
            "The data could not be loaded — please try again shortly."}
        </p>
      ) : (
        <>
          <section aria-label="top-mps" className="my-4">
            <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4 text-amber-600" />
              {t("procurement_top_mps_subtitle") ||
                "MPs whose declared business interests received the most procurement in the period."}
              {windowSuffix}
            </div>
            <DataTable
              columns={columns}
              data={data.topMps}
              pageSize={25}
              initialSort={[{ id: "totalEur", desc: true }]}
            />
          </section>
          <section aria-label="top-officials" className="my-4">
            <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
              <Landmark className="h-4 w-4 text-teal-600" />
              {t("procurement_top_officials_subtitle") ||
                "Public officials whose declared business interests received the most procurement in the period."}
              {windowSuffix}
            </div>
            <DataTable
              columns={officialColumns}
              data={data.topOfficials}
              pageSize={25}
              initialSort={[{ id: "totalEur", desc: true }]}
            />
          </section>
        </>
      )}
    </>
  );
};
