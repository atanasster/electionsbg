// Combined consumption search for the /consumption hub. One box over the
// product catalogue: a debounced trigram search against price_products
// (/api/db/price-search, the same endpoint the product browser uses), grouped
// in the shared EntitySearchTile dropdown. Rows deep-link to /product/:slug.
//
// Thin adapter over EntitySearchTile — the shell owns the box, grouped dropdown
// and keyboard nav; this owns the fetch + group building. Places / chains /
// categories groups join once those hub sub-pages exist (Steps 6+).

import { FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShoppingBasket } from "lucide-react";
import {
  EntitySearchTile,
  type SearchGroup,
} from "@/ux/search/EntitySearchTile";

/** A price-search hit (functions/db_routes.js "price-search"). */
interface ProductHit {
  slug: string;
  title: string;
  brand: string | null;
  net_qty: number | null;
  net_unit: string | null;
  chain_count: number;
  current_min_eur: number | null;
  pct_since_euro: number | null;
}

export const ConsumptionSearchTile: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const T = (b: string, e: string) => (bg ? b : e);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);

  const term = q.trim();
  const hasQuery = term.length >= 2;

  // Debounced live product search (200 ms); stale requests aborted. A failing
  // fetch degrades to empty rather than blanking the box.
  useEffect(() => {
    if (!hasQuery) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/db/price-search?q=${encodeURIComponent(term)}`, {
        signal: ctl.signal,
      })
        .then((r) => r.json() as Promise<ProductHit[]>)
        .catch(() => [] as ProductHit[])
        .then((rows) => {
          if (ctl.signal.aborted) return;
          setHits(Array.isArray(rows) ? rows : []);
          setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [term, hasQuery]);

  const groups = useMemo((): SearchGroup[] => {
    if (hits.length === 0) return [];
    const sub = (h: ProductHit) =>
      [
        h.brand,
        h.net_qty != null ? `${h.net_qty}${h.net_unit ?? ""}` : null,
        h.chain_count > 0
          ? T(`${h.chain_count} вериги`, `${h.chain_count} chains`)
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || undefined;
    return [
      {
        key: "products",
        label: T("Продукти", "Products"),
        items: hits.map((h) => ({
          id: `product-${h.slug}`,
          to: `/product/${h.slug}`,
          primary: h.title,
          secondary: sub(h),
          amountEur: h.current_min_eur,
          icon: ShoppingBasket,
        })),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, bg]);

  return (
    <EntitySearchTile
      idPrefix="csearch"
      title={T("Търсене на продукти и цени", "Search products & prices")}
      placeholder={T(
        "търси продукт, напр. мляко Верея, олио…",
        "search a product, e.g. milk, sunflower oil…",
      )}
      hint={T(
        "Търси сред хиляди продукти — цена, вериги и промяна от еврото.",
        "Search thousands of products — price, chains and change since the euro.",
      )}
      loadingLabel={t("loading") || T("Зареждане…", "Loading…")}
      noResultsLabel={t("no_results") || T("Няма резултати", "No results")}
      lang={i18n.language}
      value={q}
      onChange={setQ}
      loading={loading}
      groups={groups}
    />
  );
};
