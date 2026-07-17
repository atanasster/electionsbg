// „Какво купува МРРБ — по функция" — the group's ЗОП spend folded into МРРБ operating
// functions (cadastre & geodesy IT, construction, design & supervision, maintenance,
// administrative services, supplies, fuel & utilities, other). Mirrors
// EnvironmentCategoryTile / TransportCategoryTile.
//
// The tile leads with the CPV-known coverage %, so the reader knows the functional split
// covers the classified share of the money — the „Друго/Other" bucket is the no-CPV /
// out-of-scheme remainder, a source limitation, not a data bug.

import { FC } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  categoryLabel,
  categoryCpvDivs,
  type RegionalCategory,
  type RegionalCategoryAgg,
} from "@/lib/regionalAttributes";

// Fixed colour per category (colour follows the entity, not its rank — dataviz rule).
const CATEGORY_COLOR: Record<RegionalCategory, string> = {
  cadastre_it: "bg-primary",
  construction: "bg-stone-500",
  design_supervision: "bg-sky-600",
  maintenance: "bg-amber-500",
  admin_services: "bg-teal-500",
  supplies: "bg-emerald-600",
  fuel_utilities: "bg-orange-500",
  other: "bg-muted-foreground/50",
};

export const RegionalCategoryTile: FC<{
  categories: RegionalCategoryAgg[];
  totalEur: number;
}> = ({ categories, totalEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const [params] = useSearchParams();
  const rows = categories.filter((c) => c.totalEur > 0);
  if (rows.length < 2 || totalEur <= 0) return null;
  const max = Math.max(...rows.map((c) => c.totalEur));
  const other = rows.find((c) => c.id === "other");
  const otherShare = other ? other.totalEur / totalEur : 0;
  const cpvKnown = 1 - otherShare;

  const categoryHref = (id: RegionalCategory): string | null => {
    const divs = categoryCpvDivs(id);
    if (!divs.length) return null;
    const p = new URLSearchParams(params);
    p.set("sector", "regional");
    p.set("cpv", divs.join(","));
    return `/procurement/contracts?${p.toString()}`;
  };

  return (
    <Card id="function">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4" />
          {bg
            ? "Какво купува МРРБ — по функция"
            : "What МРРБ buys — by function"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2.5">
        <p className="text-[11px] text-muted-foreground">
          {bg
            ? `${Math.round(cpvKnown * 100)}% от стойността е класифицирана по функция; останалото е в „Друго“ (договори без CPV код или извън тези категории).`
            : `${Math.round(cpvKnown * 100)}% of the value is classified by function; the rest sits in „Other“ (contracts with no CPV code or outside these categories).`}
        </p>
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
                    {(share * 100).toLocaleString(loc, {
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
                    {(sb * 100).toLocaleString(loc, {
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
            ? "Категориите групират CPV-разделите на договорите в оперативни функции на МРРБ (класификация, не официална таксономия). Делът с една оферта се показва за категории с поне 3 договора с известен брой оферти."
            : "Categories group the contracts' CPV divisions into МРРБ operating functions (a classification, not an official taxonomy). Single-bid share is shown for categories with at least 3 bid-known contracts."}
        </p>
      </CardContent>
    </Card>
  );
};
