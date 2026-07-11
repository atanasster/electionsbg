// "Какво купуват ВиК операторите — по функция" — the group's ЗОП spend folded
// into operating buckets (network construction, water supply, sewerage &
// treatment, materials, energy, other). Each row carries its € share, dominant
// supplier and single-bid share. Pure from VikCategoryAgg. Mirrors the ВСС/НЗОК
// tiles.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { categoryLabel, type VikCategory } from "@/lib/vikAttributes";
import type { VikCategoryAgg } from "@/lib/vikAttributes";

const CATEGORY_COLOR: Record<VikCategory, string> = {
  construction: "bg-primary",
  supply: "bg-sky-500",
  sewerage: "bg-teal-500",
  materials: "bg-violet-500",
  energy: "bg-amber-500",
  other: "bg-muted-foreground/50",
};

export const VikCategoryTile: FC<{
  categories: VikCategoryAgg[];
  totalEur: number;
}> = ({ categories, totalEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = categories.filter((c) => c.totalEur > 0);
  if (rows.length < 2 || totalEur <= 0) return null;
  const max = Math.max(...rows.map((c) => c.totalEur));
  const other = rows.find((c) => c.id === "other");
  const otherShare = other ? other.totalEur / totalEur : 0;

  return (
    <Card id="function">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4" />
          {bg
            ? "Какво купуват ВиК операторите — по функция"
            : "What the water operators buy — by function"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2.5">
        {rows.map((c) => {
          const share = c.totalEur / totalEur;
          const sb = c.singleBidShare;
          return (
            <div key={c.id} className="text-xs">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="font-medium">{categoryLabel(c.id, lang)}</span>
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
                <span>
                  {c.contractCount} {bg ? "договора" : "contracts"} ·{" "}
                  {c.supplierCount} {bg ? "изпълнители" : "suppliers"}
                </span>
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
                ? `„Друго" са предимно договори без CPV код (${Math.round(otherShare * 100)}% от стойността).`
                : `"Other" is mostly contracts with no CPV code (${Math.round(otherShare * 100)}% of value).`}
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
};
