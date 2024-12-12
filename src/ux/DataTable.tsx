import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";

export type DataTableColumns<TData, TValue> = (ColumnDef<TData, TValue> & {
  hidden?: boolean;
})[];

interface DataTableProps<TData, TValue> {
  columns: DataTableColumns<TData, TValue>;
  data: TData[];
  pageSize?: number;
  stickyColumn?: boolean;
}

export const DataTable = <TData, TValue>({
  columns,
  data,
  pageSize = 10,
  stickyColumn,
}: DataTableProps<TData, TValue>) => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const { t } = useTranslation();
  const dataColumns = useMemo(() => {
    return columns
      .filter((c) => !c.hidden)
      .map((c) => {
        return {
          ...c,
          header: (props) => {
            const { column } = props;
            return (
              <div className="flex justify-center items-center">
                {typeof c.header === "function"
                  ? c.header(props)
                  : c.header || c.id}
                <Button
                  variant="ghost"
                  className="px-0"
                  onClick={() =>
                    column.toggleSorting(column.getIsSorted() === "asc")
                  }
                >
                  <ArrowUpDown className="ml-2 h-4 w-4 " />
                </Button>
              </div>
            );
          },
        } as ColumnDef<TData, TValue>;
      });
  }, [columns]);
  const table = useReactTable({
    data,
    columns: dataColumns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      pagination: { pageSize },
    },
    state: {
      sorting,
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
                    className={`py-0 ${stickyColumn && idx === 0 ? " sticky left-0 z-5 bg-card" : ""}`}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={dataColumns.length}
                className="h-24 text-center"
              >
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
            className="w-24 text-secondary-foreground"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            {t("previous")}
          </Button>
          <div className="text-center">{`${table.getState().pagination.pageIndex + 1} / ${table.getPageCount()}`}</div>
          <Button
            variant="outline"
            className="w-24 text-secondary-foreground"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {t("next")}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
