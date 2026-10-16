// "Какво купува транспортният сектор — по функция" — the group's ЗОП spend folded
// into operating buckets (rolling stock, construction, transport services, signalling
// & IT, maintenance, design, fuel, supplies, other). Each row carries its € share and
// dominant supplier. Pure from TransportCategoryAgg.
//
// ⚠️ € ONLY — NO COUNTS (transport-hub-v1 T9 F1, the water `functions` precedent).
// awarder_group_model's byCpv / byCpvContractor COUNT the €0 consortium-member rows
// (CPV 45: 826 contracts against 699 ex-member; single-bid 19% against 21.6%), while
// each row links to the ex-member browse. A count here would disagree with the page it
// opens, so contracts, suppliers and the single-bid share are left to the browser.

import { FC } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  categoryLabel,
  categoryCpvDivs,
  type TransportCategory,
  type TransportCategoryAgg,
} from "@/lib/transportAttributes";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";
import { transportContractsHref, useTransportMode } from "./transportMode";

// Fixed colour per category so the universe Select never repaints a survivor (colour
// follows the entity, not its rank — dataviz house rule).
const CATEGORY_COLOR: Record<TransportCategory, string> = {
  rolling_stock: "bg-primary",
  construction: "bg-stone-500",
  transport_services: "bg-cyan-600",
  signalling_it: "bg-violet-500",
  maintenance: "bg-amber-500",
  design: "bg-teal-500",
  fuel_energy: "bg-orange-500",
  supplies: "bg-sky-500",
  other: "bg-muted-foreground/50",
};

export const TransportCategoryTile: FC<{
  categories: TransportCategoryAgg[];
  totalEur: number;
  /** € on contracts with NO CPV code (byCpv cpv === ""), a part of „Друго". */
  noCpvEur?: number;
}> = ({ categories, totalEur, noCpvEur = 0 }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const [params] = useSearchParams();
  const { mode } = useTransportMode();
  const rows = categories.filter((c) => c.totalEur > 0);
  if (rows.length < 2 || totalEur <= 0) return null;
  const max = Math.max(...rows.map((c) => c.totalEur));
  const other = rows.find((c) => c.id === "other");
  const otherShare = other ? other.totalEur / totalEur : 0;
  const noCpvShare = noCpvEur / totalEur;
  const pct = (v: number) =>
    `${(v * 100).toLocaleString(loc, { maximumFractionDigits: 0 })}%`;

  // Deep-link a category to its exact contracts: the sector (or mode) + the category's
  // CPV divisions (the browse ORs the prefixes). "other" has no prefix set, so it
  // isn't linkable.
  const categoryHref = (id: TransportCategory): string | null => {
    const divs = categoryCpvDivs(id);
    if (!divs.length) return null;
    // The mode's awarder set under ?mode, never ?mode itself.
    return transportContractsHref(params, mode, { cpv: divs.join(",") });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4" />
          {bg
            ? "Какво купува транспортният сектор — по функция"
            : "What the transport sector buys — by function"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2.5">
        {rows.map((c) => {
          const share = c.totalEur / totalEur;
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
              {c.topSupplier && (
                <div className="mt-1 min-w-0 truncate text-[11px] text-muted-foreground">
                  {bg ? "водещ изпълнител: " : "top contractor: "}
                  <CompanyLink
                    eik={c.topSupplier.eik}
                    className="hover:text-primary hover:underline"
                  >
                    {c.topSupplier.name}
                  </CompanyLink>
                </div>
              )}
            </div>
          );
        })}
        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {bg
            ? "Категориите групират CPV кодовете на договорите в оперативни функции. Броят договори, изпълнителите и делът с една оферта са в регистъра на договорите — всяка категория води там."
            : "Categories group the contracts' CPV codes into operating functions. The contract counts, the contractors and the single-bid share are in the contracts browser — each category links there."}
          {otherShare > 0 && (
            <>
              {" "}
              {bg
                ? `„Друго“ (${pct(otherShare)} от стойността) са договори с CPV кодове извън осемте категории${noCpvShare > 0 ? ` или без CPV код (последните са ${pct(noCpvShare)} от стойността)` : ""}.`
                : `"Other" (${pct(otherShare)} of value) is contracts with CPV codes outside the eight categories${noCpvShare > 0 ? ` or with no CPV code (the latter ${pct(noCpvShare)} of value)` : ""}.`}
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
};
