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
import { Input } from "@/components/ui/input";
import { footerRender } from "./footerRender";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  initialSort?: SortingState;
  striped?: boolean;
}

export const DataTable = <TData, TValue>({
  columns,
  data,
  pageSize = 10,
  stickyColumn,
  getSubRows,
  title = "electionsbg",
  initialSort = [],
  toolbarItems,
  striped = true,
}: DataTableProps<TData, TValue>) => {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [filter, setFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const { t } = useTranslation();
  const dataColumns = useMemo(() => {
    const mapColumns = (cols: DataTableColumns<TData, TValue>) =>
      cols
        .filter((c) => !c.hidden)
        .map((c) => {
          const v = {
            ...c,
            sortUndefined: "last",
          };
          if (c.columns) {
            v.columns = mapColumns(c.columns) as DataTableColumns<
              TData,
              TValue
            >;
          }
          return v;
        });
    return mapColumns(columns);
  }, [columns]);

  const table = useReactTable({
    data,
    columns: dataColumns as DataTableColumns<TData, TValue>,
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
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
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
              table.getRowModel().rows.map((row) => {
                const isOdd = striped && row.index % 2 === 1;
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className="group hover:bg-transparent"
                  >
                    {row.getVisibleCells().map((cell, idx) => {
                      const isSticky = !!(stickyColumn && idx === 0);
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            "px-2 py-1 md:px-3",
                            isOdd && "bg-muted/30",
                            isSticky && "sticky left-0 z-5",
                            isSticky && !isOdd && "bg-card",
                            "group-hover:bg-muted/50",
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
                      );
                    })}
                  </TableRow>
                );
              })
            ) : (
              // Reserve roughly a full pageSize worth of vertical space here
              // so the empty-state row doesn't render at h-24 (the React-Query
              // loading window) and then snap to a full ~25-row table when
              // data arrives. Without this, the bottom toolbar shifts ~600px
              // downward on hydration, and that move dominates CLS for
              // every /reports/* page.
              <TableRow>
                <TableCell
                  colSpan={100}
                  className="text-center w-full"
                  style={{ height: `${Math.max(pageSize * 28, 600)}px` }}
                >
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
                        `px-2 py-1 md:px-3 ${stickyColumn && idx === 0 ? " sticky left-0 z-5" : ""}`,
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="flex items-center gap-2 text-secondary-foreground text-xs md:text-sm"
                disabled={!table.getRowModel().rows?.length}
              >
                <Download className="size-4" />
                <span>{t("export")}</span>
                <ChevronDown className="size-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() => exportToCsv<TData>(table, title)}
              >
                <Download className="size-4" />
                <span>{t("csv")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => exportToJSON<TData>(table, title)}
              >
                <FileJson className="size-4" />
                <span>{t("json")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  const { exportToPDF } = await import("./exportToPDF");
                  exportToPDF<TData>(table, title);
                }}
              >
                <FileText className="size-4" />
                <span>{t("pdf")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
