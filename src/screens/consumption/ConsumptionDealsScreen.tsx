// /consumption/deals — "Промоции", the biggest current price cuts. The largest
// promo discount per product from the daily КЗП feed (promo vs regular price),
// precomputed into the `deals` payload. Monitoring index, not official CPI.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Tag } from "lucide-react";
import { Link } from "@/ux/Link";
import { SEO } from "@/ux/SEO";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import { useDeals, fmtEur, fmtPriceDate } from "@/data/prices/usePrices";

export const ConsumptionDealsScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const { data } = useDeals();
  const deals = data?.deals ?? [];

  return (
    <>
      <SEO
        title={T("Промоции · Потребление", "Deals · Consumption")}
        description={T(
          "Най-големите намаления по продукти в България — промоционална спрямо редовна цена от дневния фийд на КЗП.",
          "The biggest per-product price cuts in Bulgaria — promo vs regular price from the daily CPC feed.",
        )}
      />
      <PlaceHeader active="consumption" level="country" className="my-4" />

      <section aria-label={T("Промоции", "Deals")}>
        <DashboardSection
          id="prices"
          title={T("Най-големи намаления днес", "Biggest cuts today")}
          subtitle={
            data?.latestDate
              ? `${T("промоционална спрямо редовна цена", "promo vs regular price")} · ${fmtPriceDate(data.latestDate, lang)}`
              : T("промоционална спрямо редовна цена", "promo vs regular price")
          }
          icon={Tag}
        >
          {deals.length === 0 ? null : (
            <Card className="p-3 sm:p-4">
              <ul className="divide-y">
                {deals.map((d) => (
                  <li
                    key={d.slug}
                    className="flex items-center gap-3 py-2 text-sm"
                  >
                    <span className="w-12 shrink-0 rounded-md bg-red-500/15 px-2 py-1 text-center text-xs font-bold tabular-nums text-red-700 dark:text-red-300">
                      −{d.discPct}%
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/product/${d.slug}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {d.title}
                      </Link>
                      {d.chain ? (
                        <Link
                          to={`/consumption/chain/${d.eik}`}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          {d.chain}
                        </Link>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-semibold tabular-nums">
                        {fmtEur(d.promo, lang)}
                      </div>
                      <div className="text-xs tabular-nums text-muted-foreground line-through">
                        {fmtEur(d.reg, lang)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </DashboardSection>
      </section>
    </>
  );
};
