// /consumption/basket — "Моята кошница", a personal shopping basket. Pick
// products (localStorage, no account) and see the live total + how the whole
// basket has moved since the euro. The killer ONS-style personal-inflation
// analog on real local prices. Prices are re-fetched live (React Query) from the
// same /api/db/price-product endpoint the product page uses.

import { FC, useMemo, useState, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ShoppingBasket, Plus, X, Search } from "lucide-react";
import { Link } from "@/ux/Link";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import { fetchProduct, type ProductHit } from "@/data/prices/fetchPricePayload";
import { fmtEur, fmtPct, priceChangeColor } from "@/data/prices/usePrices";
import {
  useBasket,
  addToBasket,
  removeFromBasket,
  clearBasket,
  inBasket,
} from "@/data/prices/useBasket";

// Inline add-search — the same /api/db/price-search endpoint as the hub, but its
// rows ADD to the basket rather than navigate.
const AddSearch: FC<{
  lang: "bg" | "en";
  T: (b: string, e: string) => string;
}> = ({ lang, T }) => {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const term = q.trim();
  const hasQuery = term.length >= 2;

  useEffect(() => {
    if (!hasQuery) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/db/price-search?q=${encodeURIComponent(term)}`, {
        signal: ctl.signal,
      })
        .then((r) => r.json() as Promise<ProductHit[]>)
        .catch(() => [] as ProductHit[])
        .then((rows) => {
          if (!ctl.signal.aborted) setHits(Array.isArray(rows) ? rows : []);
        });
    }, 200);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [term, hasQuery]);

  return (
    <div>
      <label className="relative block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={T(
            "добави продукт, напр. мляко Верея…",
            "add a product, e.g. milk…",
          )}
          aria-label={T("Добави продукт", "Add a product")}
          className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </label>
      {hasQuery && hits.length > 0 ? (
        <ul className="mt-2 max-h-72 overflow-auto rounded-md border divide-y">
          {hits.map((h) => {
            const already = inBasket(h.slug);
            return (
              <li
                key={h.slug}
                className="flex items-center gap-2 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{h.title}</span>
                {h.current_min_eur != null ? (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {fmtEur(h.current_min_eur, lang)}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={already}
                  onClick={() => addToBasket(h.slug, h.title)}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40"
                >
                  <Plus className="size-3" />
                  {already ? T("добавен", "added") : T("добави", "add")}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};

export const ConsumptionBasketScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const basket = useBasket();

  const results = useQueries({
    queries: basket.map((it) => ({
      queryKey: ["prices", "product", it.slug, ""],
      queryFn: () => fetchProduct(it.slug),
      staleTime: Infinity,
    })),
  });

  const rows = basket.map((it, i) => {
    const d = results[i]?.data;
    return {
      slug: it.slug,
      title: d?.product.title ?? it.title,
      min: d?.product.current_min_eur ?? null,
      pct: d?.product.pct_since_euro ?? null,
    };
  });

  const totals = useMemo(() => {
    const priced = rows.filter((r) => r.min != null);
    const total = priced.reduce((s, r) => s + (r.min as number), 0);
    // Basket change since the euro: baseline_i = min_i / (1 + pct_i/100); the
    // basket change is Σnow / Σbaseline − 1, over the products with a baseline.
    const withPct = rows.filter((r) => r.min != null && r.pct != null);
    const now = withPct.reduce((s, r) => s + (r.min as number), 0);
    const base = withPct.reduce(
      (s, r) => s + (r.min as number) / (1 + (r.pct as number) / 100),
      0,
    );
    const change = base > 0 ? now / base - 1 : null;
    return { total, pricedCount: priced.length, change };
  }, [rows]);

  const loading = results.some((r) => r.isLoading);

  return (
    <>
      <SEO
        title={T("Моята кошница · Потребление", "My basket · Consumption")}
        description={T(
          "Състави своя кошница и виж общата цена и промяната от въвеждането на еврото.",
          "Build your basket and see the total price and its change since the euro.",
        )}
      />
      <ConsumptionBreadcrumb
        section={T("Моята кошница", "My basket")}
        className="my-4"
      />

      <section aria-label={T("Моята кошница", "My basket")}>
        <DashboardSection
          id="prices"
          title={T("Моята кошница", "My basket")}
          subtitle={T(
            "Твоите продукти · мониторингов индекс, не официален ИПЦ",
            "Your products · monitoring index, not official CPI",
          )}
          icon={ShoppingBasket}
        >
          <Card className="flex flex-col gap-4 p-4">
            <AddSearch lang={lang} T={T} />

            {basket.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {T(
                  "Кошницата е празна. Добави продукти отгоре.",
                  "Your basket is empty. Add products above.",
                )}
              </p>
            ) : (
              <>
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li key={r.slug} className="flex items-center gap-3 py-2">
                      <Link
                        to={`/product/${r.slug}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                      >
                        {r.title}
                      </Link>
                      {r.pct != null ? (
                        <span
                          className={`shrink-0 text-xs tabular-nums ${priceChangeColor(
                            r.pct / 100,
                          )}`}
                        >
                          {fmtPct(r.pct / 100)}
                        </span>
                      ) : null}
                      <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                        {r.min != null ? fmtEur(r.min, lang) : "—"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFromBasket(r.slug)}
                        aria-label={T("Премахни", "Remove")}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="flex items-end justify-between gap-3 border-t pt-3">
                  <div>
                    <div className="text-3xl font-bold tabular-nums">
                      {fmtEur(totals.total, lang)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {loading
                        ? T("зареждане на цените…", "loading prices…")
                        : T(
                            `общо · ${totals.pricedCount} продукта`,
                            `total · ${totals.pricedCount} products`,
                          )}
                    </div>
                  </div>
                  {totals.change != null ? (
                    <div className="text-right">
                      <div
                        className={`text-2xl font-bold tabular-nums ${priceChangeColor(
                          totals.change,
                        )}`}
                      >
                        {fmtPct(totals.change)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {T("от еврото", "since the euro")}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={clearBasket}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {T("Изчисти кошницата", "Clear basket")}
                  </button>
                </div>
              </>
            )}
          </Card>
        </DashboardSection>
      </section>
    </>
  );
};
