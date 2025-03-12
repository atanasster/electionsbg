import { useMemo } from "react";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { PartyResultsRow } from "@/data/dataTypes";
import { useTranslation } from "react-i18next";
import { useRegions } from "@/data/regions/useRegions";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Caption } from "@/ux/Caption";
import { Link } from "@/ux/Link";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";

type ColumnDataType = PartyResultsRow;

type ColumnType = "oblast" | "obshtina" | "ekatte" | "section";

export function PartyRecountTable({
  title,
  visibleColumns = [],
  data: rows,
}: {
  title: string;
  visibleColumns?: ColumnType[];
  data?: PartyResultsRow[] | null;
}) {
  const { t, i18n } = useTranslation();
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();
  const isXSmall = useMediaQueryMatch("xs");
  const isSmall = useMediaQueryMatch("sm");

  const { hasPaperVotes, hasMachineVotes, data } = useMemo(() => {
    let hasPaperVotes = false;
    let hasMachineVotes = false;
    return {
      data: rows
        ?.filter((d) => d.recount)
        .map((d) => {
          if (d.machineVotes) {
            hasMachineVotes = true;
          }
          if (d.paperVotes) {
            hasPaperVotes = true;
          }

          return {
            ...d,
            paperVotesChange: d.recount
              ? d.recount.addedPaperVotes + d.recount.removedPaperVotes
              : 0,
            machineVotesChange: d.recount
              ? d.recount.addedMachineVotes + d.recount.removedMachineVotes
              : 0,
            totalVotesChange: d.recount
              ? d.recount.addedVotes + d.recount.removedVotes
              : 0,
            pctTotalVotesChange:
              d.recount && d.totalVotes
                ? (100 * (d.recount.addedVotes + d.recount.removedVotes)) /
                  d.totalVotes
                : d.recount?.removedVotes
                  ? -100
                  : 0,
          };
        })
        .sort((a, b) => {
          if (a.position === b.position) {
            return b.totalVotes - a.totalVotes;
          }
          return a.position - b.position;
        }),
      hasMachineVotes,
      hasPaperVotes,
    };
  }, [rows]);
  const columns: DataTableColumns<ColumnDataType, unknown> = useMemo(
    () => [
      {
        accessorKey: "oblast",
        header: t("region"),
        hidden: !visibleColumns.includes("oblast"),
        className: "font-bold",
        accessorFn: (row) => {
          const region = findRegion(row.oblast);
          return i18n.language === "bg"
            ? region?.long_name || region?.name
            : region?.long_name_en || region?.name_en;
        },
        cell: ({ row }) => {
          const region = findRegion(row.original.oblast);
          return (
            <Link to={`/municipality/${row.original.oblast}`}>
              {i18n.language === "bg"
                ? region?.long_name || region?.name
                : region?.long_name_en || region?.name_en}
            </Link>
          );
        },
      },
      {
        accessorKey: "obshtina",
        hidden: !visibleColumns.includes("obshtina"),
        header: t("municipality"),
        className: "font-bold",
        accessorFn: (row) => {
          const municipality = findMunicipality(row.obshtina);
          return i18n.language === "bg"
            ? municipality?.name
            : municipality?.name_en;
        },
        cell: ({ row }) => {
          const municipality = findMunicipality(row.original.obshtina);
          return (
            <Link to={`/settlement/${row.original.obshtina}`}>
              {i18n.language === "bg"
                ? municipality?.name
                : municipality?.name_en}
            </Link>
          );
        },
      },
      {
        accessorKey: "ekatte",
        hidden: !visibleColumns.includes("ekatte"),
        className: "font-bold",
        header: t("settlement"),
        accessorFn: (row) => {
          const settlement = findSettlement(row.ekatte);
          return i18n.language === "bg"
            ? settlement?.name
            : settlement?.name_en;
        },
        cell: ({ row }) => {
          const settlement = findSettlement(row.original.ekatte);
          return (
            <Link to={`/sections/${row.original.ekatte}`}>
              {i18n.language === "bg" ? settlement?.name : settlement?.name_en}
            </Link>
          );
        },
      },
      {
        accessorKey: "section",
        className: "font-bold",
        hidden: !visibleColumns.includes("section"),
        header: t("section"),
        cell: ({ row }) => (
          <Link to={`/section/${row.original.section}`}>
            {row.original.section}
          </Link>
        ),
      },
      {
        accessorKey: "position",
        className: "font-bold text-right",
        header: t("position"),
        cell: ({ row }) => `#${row.original.position}`,
      },
      {
        header: t("paper_votes"),
        hidden: isSmall || !hasPaperVotes,
        colSpan: 2,
        columns: [
          {
            accessorKey: "paperVotes",
            header: t("recounted_votes"),
            hidden: isSmall || !hasPaperVotes,
            dataType: "thousands",
          },
          {
            accessorKey: "paperVotesChange",
            header: t("change"),
            hidden: isSmall || !hasPaperVotes,
            dataType: "thousandsChange",
          },
        ],
      },
      {
        header: t("machine_votes"),
        hidden: isSmall || !hasMachineVotes,
        colSpan: 2,
        columns: [
          {
            accessorKey: "machineVotes",
            header: t("recounted_votes"),
            hidden: isSmall || !hasPaperVotes,
            dataType: "thousands",
          },
          {
            accessorKey: "machineVotesChange",
            header: t("change"),
            hidden: isSmall || !hasPaperVotes,
            dataType: "thousandsChange",
          },
        ],
      },
      {
        header: isXSmall ? t("votes") : t("total_votes"),
        colSpan: 2,
        columns: [
          {
            accessorKey: "totalVotes",
            header: t("recounted_votes"),
            dataType: "thousands",
          },
          {
            accessorKey: "totalVotesChange",
            header: t("change"),
            dataType: "thousandsChange",
          },
        ],
      },
      {
        accessorKey: "pctTotalVotesChange",
        headerHint: t("pct_recount_changes_explainer"),
        header: "%",
        dataType: "pctChange",
      },
    ],
    [
      t,
      visibleColumns,
      isSmall,
      hasPaperVotes,
      hasMachineVotes,
      isXSmall,
      findRegion,
      i18n.language,
      findMunicipality,
      findSettlement,
    ],
  );
  return data?.length ? (
    <div className="w-full">
      <Caption className="py-8">{title}</Caption>
      <DataTable
        title={title}
        pageSize={Math.min(data.length, 32)}
        columns={columns}
        stickyColumn={true}
        data={data}
      />
    </div>
  ) : null;
}
