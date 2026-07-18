// Compact "€ per kilo" teaser for the /prices dashboard — the best-value (lowest
// €/kg) staples across categories, a taste of the full /consumption/unit-prices
// explorer. Display-only (no links); the parent card header owns navigation.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { useUnitPrices, fmtEur } from "@/data/prices/usePrices";

export const UnitPriceTile: FC<{ limit?: number }> = ({ limit = 4 }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const { data } = useUnitPrices();
  if (!data) return null;

  // Lowest €/kg across every kg-basis category — the "most food per euro" items.
  const best = (data.categories ?? [])
    .flatMap((c) => (c.kg?.best ?? []).map((p) => ({ ...p, cat: lang === "bg" ? c.bg : c.en })))
    .sort((a, b) => a.eurPerUnit - b.eurPerUnit)
    .slice(0, limit);
  if (!best.length) return null;

  return (
    <div className="text-xs">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {T("Най-много храна за парите (€/кг)", "Most food per euro (€/kg)")}
      </div>
      <ul className="space-y-0.5">
        {best.map((p) => (
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
