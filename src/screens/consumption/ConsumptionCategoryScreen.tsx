// /consumption/category/:cat — one КЗП basket category: its price trend since the
// euro (from the national byCategory index) over a table of the category's
// products (price_products filtered to the category's product groups). Reuses the
// shared product columns + the price sparkline. Monitoring index, not official CPI.

import { FC, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutGrid } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import { PriceSparkline } from "@/screens/components/prices/PriceSparkline";
import {
  usePriceIndex,
  fmtPct,
  priceChangeColor,
} from "@/data/prices/usePrices";
import {
  buildProductColumns,
  type ProductRow,
} from "@/screens/consumption/productColumns";

export const ConsumptionCategoryScreen: FC = () => {
  const { cat = "" } = useParams();
  const catId = Number(cat);
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const { data: index } = usePriceIndex();

  const category = index?.categories.find((c) => c.id === catId);
  const label = category
    ? bg
      ? category.bg
      : category.en
    : T("Категория", "Category");
  const series = index?.national.byCategory[String(catId)] ?? [];
  const change =
    series.length >= 2 ? series[series.length - 1].v / 100 - 1 : null;

  const pids = useMemo(
    () =>
      (index?.products ?? []).filter((p) => p.cat === catId).map((p) => p.id),
    [index, catId],
  );

  const columns = useMemo(
    () => buildProductColumns(T, lang),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bg, lang],
  );
  const fixedFilters = useMemo<DbColumnFilter[]>(
    () => [{ id: "chain_count", min: 1 }],
    [],
  );
  const extraFilters = useMemo<DbColumnFilter[]>(
    () => [{ id: "pid", value: pids }],
    [pids],
  );

  return (
    <>
      <SEO
        title={`${label} · ${T("Потребление", "Consumption")}`}
        description={T(
          `Цените на ${label.toLowerCase()} в България от въвеждането на еврото.`,
          `Prices for ${label.toLowerCase()} in Bulgaria since the euro.`,
        )}
      />
      <ConsumptionBreadcrumb
        section={T("Категории", "Categories")}
        sectionTo="/consumption/categories"
        current={label}
        className="my-4"
      />

      <section aria-label={label}>
        <div className="my-4 flex items-center gap-2">
          <LayoutGrid className="size-5 text-primary" />
          <h1 className="text-2xl font-bold">{label}</h1>
        </div>

        <DashboardSection
          id="prices"
          title={T("Промяна от еврото", "Change since the euro")}
          subtitle={T(
            "мониторингов индекс, не официален ИПЦ",
            "monitoring index, not official CPI",
          )}
          icon={LayoutGrid}
        >
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            {change != null ? (
              <div
                className={`text-3xl font-bold tabular-nums ${priceChangeColor(
                  change,
                )}`}
              >
                {fmtPct(change)}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                {T("няма данни за тренда", "no trend data")}
              </span>
            )}
            {series.length > 1 ? (
              <PriceSparkline points={series} width={260} height={56} />
            ) : null}
          </Card>
        </DashboardSection>

        <DashboardSection
          id="products"
          title={T("Продукти в категорията", "Products in the category")}
          icon={LayoutGrid}
        >
          {index && pids.length > 0 ? (
            <DbDataTable<ProductRow>
              resource="price_products"
              columns={columns}
              fixedFilters={fixedFilters}
              extraFilters={extraFilters}
              defaultSort={[{ id: "chain_count", desc: true }]}
              searchPlaceholder={T(
                "търси в категорията…",
                "search in the category…",
              )}
            />
          ) : null}
        </DashboardSection>
      </section>
    </>
  );
};
