// /consumption/products — browse & search all ~118k products.
//
// The feature the whole migration exists to enable: the old pipeline kept only
// the 101 КЗП group codes and discarded every real SKU name. This is a
// server-side DbDataTable over price_products (the canonical, cross-chain
// catalogue), with free-text search (trigram) and a category facet. Rows
// deep-link to /product/:slug. See docs/plans/consumption-pg-v1.md §9.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Title } from "@/ux/Title";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import { usePriceDict } from "@/data/prices/usePrices";
import {
  buildProductColumns,
  type ProductRow,
} from "@/screens/consumption/productColumns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

export const ProductsBrowserScreen: FC = () => {
  const { i18n } = useTranslation();
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

  const columns = useMemo(
    () => buildProductColumns(T, lang),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <ConsumptionBreadcrumb
        section={T("Продукти", "Products")}
        className="mt-4 mb-2"
      />
      <Title>{T("Продукти", "Products")}</Title>

      <section aria-label={T("Продукти", "Products")}>
        <DashboardSection id="products">
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
