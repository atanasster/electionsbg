import {
  ColumnDef,
  ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  HeaderContext,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMemo, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type DataTableColumnDef<TData, TValue> = ColumnDef<TData, TValue> & {
  hidden?: boolean;
  className?: string;
  columns?: DataTableColumns<TData, TValue>;
};
export type DataTableColumns<TData, TValue> = DataTableColumnDef<
  TData,
  TValue
>[];

interface DataTableProps<TData, TValue> {
  columns: DataTableColumns<TData, TValue>;
  data: TData[];
  pageSize?: number;
  stickyColumn?: boolean;

  getSubRows?: (originalRow: TData, index: number) => undefined | TData[];
}

const HeaderCell = <TData, TValue>({
  props,
  c,
}: {
  props: HeaderContext<TData, TValue>;
  c: DataTableColumnDef<TData, TValue>;
}) => {
  const { column } = props;

  return (
    <div className="flex justify-center items-center">
      {typeof c.header === "function" ? c.header(props) : c.header || c.id}
      {column.getCanSort() && (
        <Button
          variant="ghost"
          className="px-0"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          <ArrowUpDown className="ml-2 h-4 w-4 " />
        </Button>
      )}
    </div>
  );
};
export const DataTable = <TData, TValue>({
  columns,
  data,
  pageSize = 10,
  stickyColumn,
  getSubRows,
}: DataTableProps<TData, TValue>) => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const { t } = useTranslation();
  const dataColumns = useMemo(() => {
    return columns
      .filter((c) => !c.hidden)
      .map((c) => {
        return {
          ...c,
          header: (props) => {
            return <HeaderCell<TData, TValue> props={props} c={c} />;
          },
          columns: c.columns
            ?.map(
              (subC) =>
                ({
                  ...subC,
                  header: (props) => (
                    <HeaderCell<TData, TValue> props={props} c={subC} />
                  ),
                }) as DataTableColumnDef<TData, TValue>,
            )
            .filter((c) => !c.hidden),
        } as DataTableColumnDef<TData, TValue>;
      });
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
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
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
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </div>
                      </div>
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
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
      </Table>
      {table.getPageCount() > 1 ? (
        <div className="flex items-center justify-end space-x-2 py-4 mr-4">
          <Button
            variant="outline"
            className="flex justify-between w-24 text-secondary-foreground"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft />
            <div>{t("previous")}</div>
          </Button>
          <div className="text-center">{`${table.getState().pagination.pageIndex + 1} / ${table.getPageCount()}`}</div>
          <Button
            variant="outline"
            className="flex justify-between w-24 text-secondary-foreground"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <div>{t("next")}</div>
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </div>
  );
};
