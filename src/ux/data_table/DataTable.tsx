import {
  ExpandedState,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReactNode, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson,
  FileText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { exportToCsv } from "./exportToCsv";
import { DataTableColumnDef } from "./utils";
import { cellRender } from "./cellRender";
import { headerRender } from "./headerRender";
import { exportToJSON } from "./exportToJSON";
import { exportToPDF } from "./exportToPDF";
import { Input } from "@/components/ui/input";
import { footerRender } from "./footerRender";

export type DataTableColumns<TData, TValue> = DataTableColumnDef<
  TData,
  TValue
>[];

interface DataTableProps<TData, TValue> {
  columns: DataTableColumns<TData, TValue>;
  data: TData[];
  pageSize?: number;
  stickyColumn?: boolean;
  title?: string;
  subTitle?: string;
  getSubRows?: (originalRow: TData, index: number) => undefined | TData[];
  toolbarItems?: ReactNode;
}

export const DataTable = <TData, TValue>({
  columns,
  data,
  pageSize = 10,
  stickyColumn,
  getSubRows,
  title = "electionsbg",
  toolbarItems,
}: DataTableProps<TData, TValue>) => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const { t } = useTranslation();
  const dataColumns = useMemo(() => {
    return columns
      .filter((c) => !c.hidden)
      .map(
        (c) =>
          ({
            ...c,
            sortUndefined: "last",
            invertSorting: !!c.dataType,
          }) as DataTableColumnDef<TData, TValue>,
      );
  }, [columns]);

  const table = useReactTable({
    data,
    columns: dataColumns,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "includesString",
    getSubRows,
    initialState: {
      pagination: { pageSize },
    },
    state: {
      sorting,
      expanded,
    },
  });
  return (
    <>
      <div className="py-2 flex justify-between">
        <Input
          className="w-auto"
          type="search"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            table.setGlobalFilter(String(e.target.value));
          }}
          placeholder={`${t("filter")}...`}
        />
        {toolbarItems}
      </div>
      <div className="rounded-xl border bg-card text-card-foreground shadow">
        <Table className="table-auto">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header, idx) => {
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      className={
                        stickyColumn && idx === 0
                          ? "sticky left-0 z-5 bg-card"
                          : ""
                      }
                    >
                      {header.isPlaceholder ? null : headerRender(header)}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="text-secondary-foreground">
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell, idx) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        `px-2 py-1 md:px-4 md:py-2 ${stickyColumn && idx === 0 ? " sticky left-0 z-5 bg-card" : ""}`,
                        (
                          cell.column.columnDef as DataTableColumnDef<
                            TData,
                            TValue
                          >
                        ).className,
                      )}
                    >
                      {idx === 0 && getSubRows ? (
                        <div
                          style={{
                            paddingLeft: `${row.depth * 2}rem`,
                          }}
                        >
                          <div className="flex items-center">
                            {row.getCanExpand() ? (
                              <button
                                className="cursor-pointer"
                                onClick={row.getToggleExpandedHandler()}
                              >
                                {row.getIsExpanded() ? (
                                  <ChevronDown />
                                ) : (
                                  <ChevronRight />
                                )}
                              </button>
                            ) : (
                              ""
                            )}{" "}
                            {cellRender(cell)}
                          </div>
                        </div>
                      ) : (
                        cellRender(cell)
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={100} className="h-24 text-center w-full">
                  {t("no_results")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          <TableFooter>
            {table.getFooterGroups().map((footerGroup) => (
              <TableRow key={footerGroup.id}>
                {footerGroup.headers.map((header, idx) => {
                  return (
                    <TableCell
                      key={header.id}
                      colSpan={header.colSpan}
                      className={cn(
                        `px-2 py-1 md:px-4 md:py-2 ${stickyColumn && idx === 0 ? " sticky left-0 z-5 bg-card" : ""}`,
                        (
                          header.column.columnDef as DataTableColumnDef<
                            TData,
                            TValue
                          >
                        ).className,
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : footerRender(table, header, !!stickyColumn, t)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableFooter>
        </Table>

        <div className="flex justify-between p-2 md:p-4">
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex justify-between w-12 md:w-24 text-secondary-foreground text-xs md:text-sm"
              onClick={() => exportToCsv<TData>(table, title)}
              disabled={!table.getRowModel().rows?.length}
            >
              <Download className="hidden md:block" />
              <div>{t("csv")}</div>
            </Button>
            <Button
              variant="outline"
              className="flex justify-between w-12 md:w-24 text-secondary-foreground text-xs md:text-sm"
              onClick={() => exportToJSON<TData>(table, title)}
              disabled={!table.getRowModel().rows?.length}
            >
              <FileJson className="hidden md:block" />
              <div>{t("json")}</div>
            </Button>
            <Button
              variant="outline"
              className="flex justify-between w-12 md:w-24 text-secondary-foreground text-xs md:text-sm"
              onClick={() => exportToPDF<TData>(table, title)}
              disabled={!table.getRowModel().rows?.length}
            >
              <FileText className="hidden md:block" />
              <div>{t("pdf")}</div>
            </Button>
          </div>
          {table.getPageCount() > 1 ? (
            <div className="flex items-center justify-end space-x-2">
              <Button
                variant="outline"
                className="flex justify-between w-18 md:w-24 text-secondary-foreground p-2 md:p-4 text-xs md:text-sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronLeft className="hidden md:block" />
                <div>{t("previous")}</div>
              </Button>
              <div className="text-center text-xs md:text-sm">{`${table.getState().pagination.pageIndex + 1} / ${table.getPageCount()}`}</div>
              <Button
                variant="outline"
                className="flex justify-between w-16 md:w-24 text-secondary-foreground p-2 md:p-4 text-xs md:text-sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <div>{t("next")}</div>
                <ChevronRight className="hidden md:block" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
};
