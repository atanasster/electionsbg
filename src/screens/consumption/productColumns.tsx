// Shared column defs for a price_products DbDataTable — the product browser and
// the per-category product list render the identical table (title link, chains,
// lowest price, change since euro), so the columns live here.

import { Link } from "react-router-dom";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { fmtEur, euroPctSafe } from "@/data/prices/usePrices";

export interface ProductRow {
  slug: string;
  title: string;
  pid: number;
  brand: string | null;
  netQty: number | null;
  netUnit: string | null;
  chainCount: number;
  currentMinEur: number | null;
  pctSinceEuro: number | null;
}

export const buildProductColumns = (
  T: (b: string, e: string) => string,
  lang: "bg" | "en",
): DataTableColumnDef<ProductRow, unknown>[] => [
  {
    id: "title",
    accessorFn: (r) => r.title,
    header: T("Продукт", "Product"),
    enableSorting: false,
    cell: ({ row }) => (
      <Link
        to={`/product/${row.original.slug}`}
        className="text-sm font-medium hover:underline"
      >
        {row.original.title}
      </Link>
    ),
  },
  {
    id: "chain_count",
    accessorFn: (r) => r.chainCount,
    header: T("Вериги", "Chains"),
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">
        {row.original.chainCount}
      </span>
    ),
  },
  {
    id: "current_min_eur",
    accessorFn: (r) => r.currentMinEur,
    header: T("Най-ниска цена", "Lowest price"),
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="tabular-nums whitespace-nowrap font-medium">
        {row.original.currentMinEur != null
          ? fmtEur(row.original.currentMinEur, lang)
          : "—"}
      </span>
    ),
  },
  {
    id: "pct_since_euro",
    accessorFn: (r) => r.pctSinceEuro,
    header: T("От еврото", "Since euro"),
    meta: { align: "right" },
    cell: ({ row }) => {
      const raw = row.original.pctSinceEuro;
      const v = euroPctSafe(raw);
      if (v == null)
        return (
          <span className="text-xs text-muted-foreground">
            {/* genuinely post-euro product vs a suppressed data artifact */}
            {raw == null ? T("нов", "new") : "—"}
          </span>
        );
      const cls =
        v > 0.1
          ? "text-red-600 dark:text-red-400"
          : v < -0.1
            ? "text-green-600 dark:text-green-400"
            : "text-muted-foreground";
      const sign = v > 0 ? "+" : v < 0 ? "−" : "";
      return (
        <span className={`tabular-nums ${cls}`}>
          {sign}
          {Math.abs(v).toFixed(1)}%
        </span>
      );
    },
  },
];
