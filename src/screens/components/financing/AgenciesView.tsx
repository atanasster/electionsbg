import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { AgenciesSummary, SharedVendor } from "@/data/dataTypes";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { formatThousands } from "@/data/utils";
import { PartyChip } from "./financingShared";
import { useAgencyTypeLabel } from "./financingConstants";

// The dashboard shows only vendors hired by MORE THAN ONE party — the
// interesting cross-party signal. A company ЕИК is a unique legal entity (not a
// namesake like donor names), so a shared vendor is meaningful. The grouping is
// precomputed at ingest (agencies_summary.json); the full per-party agency list
// lives on each party's page (PartyAgenciesTile).
export const AgenciesView: FC<{ summary: AgenciesSummary }> = ({ summary }) => {
  const { t } = useTranslation();
  const { findParty } = usePartyInfo();
  const typeLabel = useAgencyTypeLabel();

  const columns = useMemo<DataTableColumns<SharedVendor, unknown>>(
    () => [
      {
        accessorKey: "name",
        header: t("name"),
        cell: ({ row }) =>
          row.original.eik ? (
            <Link
              to={`/company/${row.original.eik}`}
              className="font-medium hover:underline"
              underline={false}
            >
              {row.original.name}
            </Link>
          ) : (
            <span className="font-medium">{row.original.name}</span>
          ),
      },
      {
        accessorKey: "type",
        header: t("type"),
        accessorFn: (row) => typeLabel(row.type),
      },
      {
        accessorKey: "parties",
        header: t("parties"),
        // Sort by how many parties hired the vendor (most shared first).
        accessorFn: (row) => row.parties.length,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
              {row.original.parties.length}
            </span>
            {row.original.parties.map((p) => (
              <PartyChip key={p} party={findParty(p)} />
            ))}
          </div>
        ),
      },
    ],
    [t, typeLabel, findParty],
  );

  if (summary.sharedVendors.length === 0) return null;

  return (
    <div className="w-full">
      {/* Subheading — this table sits under the Разходи (Expenses) section. */}
      <Hint text={t("financing_agencies_shared_hint")} underline={false}>
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span>{t("financing_agencies")}</span>
        </div>
      </Hint>
      <div className="mb-3 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">
          {formatThousands(summary.sharedVendors.length)}
        </span>{" "}
        {t("financing_agencies_shared")} ·{" "}
        {t("financing_distinct_companies", { n: summary.distinctCompanies })}
      </div>
      <DataTable
        title={t("financing_agencies")}
        pageSize={15}
        columns={columns}
        data={summary.sharedVendors}
      />
    </div>
  );
};
