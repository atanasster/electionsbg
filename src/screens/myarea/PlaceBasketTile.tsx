// Full local basket for one settlement — every monitored КЗП product with its
// cheapest local price, the store behind it (Google Maps directions), and a
// promo badge when the product is on offer today (promoMin below the regular
// min). Grouped by category; long categories collapse to the cheapest few with
// a "show all" toggle. Settlement-grain (needs the place shard) — self-hides on
// município pages and uncovered settlements, where the summary tile already
// carries the headline.
//
// Data is entirely from the place:<ekatte> shard already fetched by the
// summary tile — no new payload. NOT official CPI.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShoppingBasket, MapPin, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { resolvePriceKeys } from "@/data/prices/pricePlaceKeys";
import {
  usePriceDict,
  useSettlementPrices,
  fmtEur,
  mapsDirectionsUrl,
  type SettlementProduct,
} from "@/data/prices/usePrices";

interface Props {
  ekatte?: string;
  obshtina: string;
}

/** Rows shown per category before the "show all" toggle. */
const COLLAPSE_AT = 6;

export const PlaceBasketTile: FC<Props> = ({ ekatte, obshtina }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const { priceEkatte } = resolvePriceKeys(obshtina, ekatte);
  const { data: dict } = usePriceDict();
  const { data: sett } = useSettlementPrices(priceEkatte);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // product id → { name, category id }
  const prodMeta = useMemo(
    () =>
      new Map(
        (dict?.products ?? []).map((p) => [
          p.id,
          { name: lang === "bg" ? p.bg : p.en, cat: p.cat },
        ]),
      ),
    [dict, lang],
  );

  // Group the place's products by category, each sorted cheapest-first.
  const groups = useMemo(() => {
    if (!dict || !sett) return [];
    const byCat = new Map<number, SettlementProduct[]>();
    for (const p of sett.products) {
      const cat = prodMeta.get(p.id)?.cat;
      if (cat == null) continue;
      (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(p);
    }
    return dict.categories
      .map((c) => ({
        id: c.id,
        name: lang === "bg" ? c.bg : c.en,
        items: (byCat.get(c.id) ?? []).sort(
          (a, b) => bestPrice(a) - bestPrice(b),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [dict, sett, prodMeta, lang]);

  if (!dict || !sett || groups.length === 0) return null;

  const toggle = (cat: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const row = (p: SettlementProduct) => {
    const name = prodMeta.get(p.id)?.name ?? String(p.id);
    // The store fields (cheapestChain/cheapestStore) identify the lowest
    // REGULAR-price store — the shard doesn't carry which store runs the promo.
    // So the priced store row is the regular min; a promo (min(promo_eur) below
    // the regular min) is surfaced as a store-less chip, not attributed to this
    // store.
    const hasPromo = p.promoMin != null && p.promoMin < p.min;
    const storeLabel = [p.cheapestChain, p.cheapestStore]
      .filter(Boolean)
      .join(" · ");
    return (
      <li key={p.id} className="flex flex-col leading-tight">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate min-w-0 flex items-center gap-1.5">
            {name}
            {hasPromo ? (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 text-primary px-1.5 py-0 text-[10px] font-medium shrink-0"
                title={T("Промоция в града", "On promotion in town")}
              >
                <Tag className="size-2.5" />
                {T("промо", "sale")} {fmtEur(p.promoMin!, lang)}
              </span>
            ) : null}
          </span>
          <span className="tabular-nums shrink-0">{fmtEur(p.min, lang)}</span>
        </div>
        {p.cheapestStore ? (
          <a
            href={mapsDirectionsUrl([
              p.cheapestChain,
              p.cheapestStore,
              sett.name,
            ])}
            target="_blank"
            rel="noreferrer"
            title={T(
              `Упътване до ${storeLabel}`,
              `Directions to ${storeLabel}`,
            )}
            className="text-[11px] text-muted-foreground hover:text-primary hover:underline inline-flex items-center gap-1 min-w-0 max-w-full"
          >
            <MapPin className="size-3 shrink-0" />
            <span className="truncate">{storeLabel}</span>
          </a>
        ) : p.cheapestChain ? (
          <span className="text-[11px] text-muted-foreground truncate">
            {p.cheapestChain}
          </span>
        ) : null}
      </li>
    );
  };

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div>
        <h3 className="font-semibold flex items-center gap-1.5">
          <ShoppingBasket className="size-4 text-primary" />
          {T("Пълна кошница", "Full basket")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {T(
            "Най-ниска цена в града по продукт и къде",
            "Lowest local price per product and where",
          )}
        </p>
      </div>

      {/* One column on phones; two from sm up so the long list stays scannable
          without a wall of single-column rows on desktop. */}
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {groups.map((g) => {
          const isOpen = expanded.has(g.id);
          const shown =
            isOpen || g.items.length <= COLLAPSE_AT
              ? g.items
              : g.items.slice(0, COLLAPSE_AT);
          return (
            <div key={g.id} className="text-xs">
              <div className="font-medium mb-1.5 text-muted-foreground uppercase tracking-wide text-[11px]">
                {g.name}
              </div>
              <ul className="space-y-1.5">{shown.map(row)}</ul>
              {g.items.length > COLLAPSE_AT ? (
                <button
                  type="button"
                  onClick={() => toggle(g.id)}
                  className="mt-1.5 text-[11px] text-primary hover:underline"
                >
                  {isOpen
                    ? T("по-малко", "show less")
                    : T(
                        `още ${g.items.length - COLLAPSE_AT}`,
                        `show ${g.items.length - COLLAPSE_AT} more`,
                      )}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
};

/** Effective best price today (promo when cheaper), for cheapest-first sort. */
function bestPrice(p: SettlementProduct): number {
  return p.promoMin != null && p.promoMin < p.min ? p.promoMin : p.min;
}
