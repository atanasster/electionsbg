// Compact "€ per kilo" teaser for the /prices dashboard — the best-value (lowest
// €/kg) staples across categories, a taste of the full /consumption/unit-prices
// explorer. Display-only (no links); the parent card header owns navigation.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import {
  useUnitPrices,
  householdPacks,
  fmtEur,
  HOUSEHOLD_PACK_MAX_G,
} from "@/data/prices/usePrices";

export const UnitPriceTile: FC<{ limit?: number }> = ({ limit = 4 }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const { data } = useUnitPrices();
  if (!data) return null;

  // Lowest €/kg across every kg-basis category, at HOUSEHOLD pack sizes, ONE
  // per category.
  //
  // Without the size filter this board ranked catering packs: the top six were
  // 5–10kg (olives, onions, potatoes) and the first thing a household buys —
  // 1kg flour — was seventh. Bulk is cheaper per kilo by definition, so an
  // unfiltered "най-много храна за парите" measures pack size and calls it
  // value. Without the per-category cap it then answered "which flour", since
  // four brands share the cheapest 0.92 €/kg.
  //
  // Filtered PER CATEGORY so `bulkOnly` means what it says. A category with
  // nothing under the ceiling (Зеленчуци: 8 of 8 are 5–10kg) is dropped rather
  // than shown in bulk under a caption promising household packs.
  const top = (data.categories ?? [])
    .flatMap((c) => {
      const { rows, bulkOnly } = householdPacks(c.kg?.best ?? []);
      if (bulkOnly) return [];
      const cheapest = [...rows].sort((a, b) => a.eurPerUnit - b.eurPerUnit)[0];
      return cheapest
        ? [{ ...cheapest, cat: lang === "bg" ? c.bg : c.en }]
        : [];
    })
    .sort((a, b) => a.eurPerUnit - b.eurPerUnit)
    .slice(0, limit);
  if (!top.length) return null;

  return (
    <div className="text-xs">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {T("Най-много храна за парите (€/кг)", "Most food per euro (€/kg)")}
      </div>
      <div className="mb-1 text-[11px] text-muted-foreground">
        {T(
          `по една от категория · опаковки до ${HOUSEHOLD_PACK_MAX_G / 1000} кг`,
          `one per category · packs up to ${HOUSEHOLD_PACK_MAX_G / 1000} kg`,
        )}
      </div>
      <ul className="space-y-0.5">
        {top.map((p) => (
          <li key={p.slug} className="flex justify-between gap-2">
            <Link
              to={`/product/${p.slug}`}
              className="min-w-0 truncate hover:underline"
            >
              {p.title}
            </Link>
            <span className="shrink-0 tabular-nums text-green-700 dark:text-green-400">
              {fmtEur(p.eurPerUnit, lang)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
