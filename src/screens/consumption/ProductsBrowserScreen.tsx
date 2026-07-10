// /consumption/products — browse & search all ~118k products.
//
// The feature the whole migration exists to enable: the old pipeline kept only
// the 101 КЗП group codes and discarded every real SKU name. This is a
// server-side DbDataTable over price_products (the canonical, cross-chain
// catalogue), with free-text search (trigram) and a category facet. Rows
// deep-link to /product/:slug. See docs/plans/consumption-pg-v1.md §9.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShoppingBasket } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { usePriceDict } from "@/data/prices/usePrices";
import { fmtEur } from "@/data/prices/usePrices";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProductRow {
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

const ALL = "__all__";

export const ProductsBrowserScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const { data: dict } = usePriceDict();

  const [pid, setPid] = useState<string>(ALL);

  const extraFilters = useMemo<DbColumnFilter[]>(
    () => (pid === ALL ? [] : [{ id: "pid", value: [pid] }]),
    [pid],
  );

  // Retired products (chain_count = 0) keep their frozen slug so old
  // /product/:slug URLs still resolve, but must never appear in the browser or
  // its count. Server-enforced: the registry validates `chain_count` as a range
  // filter, so the user cannot remove this. (rebuild_catalog zeroes chain_count
  // when a canon_key vanishes — see §4.5 / step 5b.)
  const fixedFilters = useMemo<DbColumnFilter[]>(
    () => [{ id: "chain_count", min: 1 }],
    [],
  );

  const columns = useMemo<DataTableColumnDef<ProductRow, unknown>[]>(
    () => [
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
          const v = row.original.pctSinceEuro;
          if (v == null)
            return (
              <span className="text-xs text-muted-foreground">
                {T("нов", "new")}
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
    ],
    [bg, lang],
  );

  return (
    <>
      <SEO
        title={T("Продукти и цени", "Products and prices")}
        description={T(
          "Търси и сравнявай цените на хиляди продукти по вериги в България от въвеждането на еврото.",
          "Search and compare prices of thousands of products across chains in Bulgaria since the euro.",
        )}
      />
      <PlaceHeader active="consumption" level="country" className="my-4" />

      <section aria-label={T("Продукти", "Products")}>
        <DashboardSection
          id="products"
          title={T("Всички продукти", "All products")}
          subtitle={t("prices_not_cpi")}
          icon={ShoppingBasket}
        >
          <DbDataTable<ProductRow>
            resource="price_products"
            columns={columns}
            fixedFilters={fixedFilters}
            extraFilters={extraFilters}
            defaultSort={[{ id: "chain_count", desc: true }]}
            searchPlaceholder={T(
              "търси продукт, напр. мляко Верея, олио…",
              "search a product, e.g. milk, sunflower oil…",
            )}
            toolbar={
              <Select value={pid} onValueChange={setPid}>
                <SelectTrigger className="w-[13rem]">
                  <SelectValue placeholder={T("Всички групи", "All groups")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {T("Всички групи", "All groups")}
                  </SelectItem>
                  {dict?.products.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p[lang]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </DashboardSection>
      </section>
    </>
  );
};
