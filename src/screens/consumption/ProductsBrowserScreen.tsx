// /consumption/products — browse & search all ~118k products.
//
// The feature the whole migration exists to enable: the old pipeline kept only
// the 101 КЗП group codes and discarded every real SKU name. This is a
// server-side DbDataTable over price_products (the canonical, cross-chain
// catalogue), with free-text search (trigram) and a category facet. Rows
// deep-link to /product/:slug. See docs/plans/consumption-pg-v1.md §9.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Title } from "@/ux/Title";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import { usePriceDict } from "@/data/prices/usePrices";
import { useAreaAnchor } from "@/data/area/areaAnchor";
import { useAreaResolver } from "@/data/area/useAreaResolver";
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

  // The full catalogue only carries a national current-min price; per-place
  // pricing is settlement-grain and lives on the product page. So the browser
  // stays national and instead carries the ?area= anchor onto each product link
  // (client-only — the prerendered/canonical page is unchanged) so the product
  // page opens with the pinned place's local prices.
  const anchor = useAreaAnchor();
  const area = useAreaResolver(anchor?.id);
  const placeName =
    area?.kind === "settlement"
      ? bg
        ? area.settlement.name
        : area.settlement.name_en
      : area?.kind === "municipality"
        ? bg
          ? area.municipality.name
          : area.municipality.name_en
        : null;

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
    () => buildProductColumns(T, lang, anchor?.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bg, lang, anchor?.id],
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

      {anchor && placeName ? (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="size-3.5 shrink-0 text-primary" />
          <span>
            {T(
              `Отворете продукт, за да видите цените за ${placeName}.`,
              `Open a product to see prices for ${placeName}.`,
            )}
          </span>
        </div>
      ) : null}

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
