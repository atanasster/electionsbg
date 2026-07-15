// "Какво купува МВР — по функция" — the group's ЗОП spend folded into operating
// buckets (vehicles, fuel, IT & surveillance, weapons/tactical, health,
// construction, uniforms/supplies, maintenance, other). Each row carries its €
// share, dominant supplier and single-bid share. Pure from SecurityCategoryAgg.
// Mirrors DefenseCategoryTile.

import { FC } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  categoryLabel,
  categoryCpvDivs,
  type SecurityCategory,
} from "@/lib/securityAttributes";
import type { SecurityCategoryAgg } from "@/lib/securityAttributes";

// Fixed colour per category so the universe Select never repaints a survivor
// (colour follows the entity, not its rank — dataviz house rule). Status hues
// (red/green) are reserved for the single-bid signal in the meta line below.
const CATEGORY_COLOR: Record<SecurityCategory, string> = {
  vehicles: "bg-sky-500",
  fuel: "bg-amber-500",
  it_surveillance: "bg-violet-500",
  security_equip: "bg-slate-600",
  health: "bg-teal-500",
  construction: "bg-stone-500",
  supplies: "bg-cyan-600",
  maintenance: "bg-primary",
  other: "bg-muted-foreground/50",
};

export const MvrCategoryTile: FC<{
  categories: SecurityCategoryAgg[];
  totalEur: number;
}> = ({ categories, totalEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const [params] = useSearchParams();
  const rows = categories.filter((c) => c.totalEur > 0);
  if (rows.length < 2 || totalEur <= 0) return null;
  const max = Math.max(...rows.map((c) => c.totalEur));
  const other = rows.find((c) => c.id === "other");
  const otherShare = other ? other.totalEur / totalEur : 0;

  // Deep-link a category to its exact contracts: sector=security + the category's
  // CPV divisions (the browse ORs the prefixes). "other" (no CPV) isn't linkable.
  const categoryHref = (id: SecurityCategory): string | null => {
    const divs = categoryCpvDivs(id);
    if (!divs.length) return null;
    const p = new URLSearchParams(params);
    p.set("sector", "security");
    p.set("cpv", divs.join(","));
    return `/procurement/contracts?${p.toString()}`;
  };

  return (
    <Card id="function">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4" />
          {bg ? "Какво купува МВР — по функция" : "What МВР buys — by function"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2.5">
        {rows.map((c) => {
          const share = c.totalEur / totalEur;
          const sb = c.singleBidShare;
          const href = categoryHref(c.id);
          const label = categoryLabel(c.id, lang);
          return (
            <div key={c.id} className="text-xs">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                {href ? (
                  <Link
                    to={href}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {label}
                  </Link>
                ) : (
                  <span className="font-medium">{label}</span>
                )}
                <span className="tabular-nums text-muted-foreground">
                  {formatEurCompact(c.totalEur, lang)}
                  <span className="ml-1 text-muted-foreground/70">
                    {(share * 100).toLocaleString(lang, {
                      maximumFractionDigits: 0,
                    })}
                    %
                  </span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${CATEGORY_COLOR[c.id] ?? "bg-primary"}`}
                  style={{ width: `${Math.max(2, (c.totalEur / max) * 100)}%` }}
                />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                {href ? (
                  <Link
                    to={href}
                    className="hover:text-primary hover:underline"
                  >
                    {c.contractCount} {bg ? "договора" : "contracts"} ·{" "}
                    {c.supplierCount} {bg ? "изпълнители" : "suppliers"}
                  </Link>
                ) : (
                  <span>
                    {c.contractCount} {bg ? "договора" : "contracts"} ·{" "}
                    {c.supplierCount} {bg ? "изпълнители" : "suppliers"}
                  </span>
                )}
                {c.topSupplier && (
                  <span className="min-w-0 truncate">
                    {bg ? "водещ: " : "top: "}
                    <Link
                      to={`/company/${c.topSupplier.eik}`}
                      className="hover:text-primary hover:underline"
                    >
                      {c.topSupplier.name}
                    </Link>
                  </span>
                )}
                {sb != null && c.bidKnownN >= 3 && (
                  <span
                    className={
                      sb >= 0.5
                        ? "text-amber-600 dark:text-amber-400 font-medium"
                        : ""
                    }
                  >
                    {(sb * 100).toLocaleString(lang, {
                      maximumFractionDigits: 0,
                    })}
                    % {bg ? "с една оферта" : "single-bid"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {bg
            ? "Категориите групират CPV-разделите на договорите в оперативни функции. Делът с една оферта се показва за категории с поне 3 договора с известен брой оферти."
            : "Categories group the contracts' CPV divisions into operating functions. Single-bid share is shown for categories with at least 3 bid-known contracts."}
          {otherShare >= 0.1 && (
            <>
              {" "}
              {bg
                ? `„Друго“ са предимно договори без CPV код (${Math.round(otherShare * 100)}% от стойността).`
                : `"Other" is mostly contracts with no CPV code (${Math.round(otherShare * 100)}% of value).`}
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
};
