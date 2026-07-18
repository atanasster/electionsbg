// /consumption/deals — "Промоции", the biggest current price cuts. The largest
// promo discount per product from the daily КЗП feed (promo vs regular price),
// precomputed into the `deals` payload. When an area anchor (?area=) is set the
// screen re-scopes to that município's promos ("промоции край вас") with a
// link back to the national feed; the prerendered/canonical page stays the
// national version (the re-scope is client-only). Monitoring index, not
// official CPI.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Tag, ArrowRight } from "lucide-react";
import { Link } from "@/ux/Link";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Title } from "@/ux/Title";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import { DealsList } from "@/screens/components/consumption/DealsList";
import { useAreaAnchor } from "@/data/area/areaAnchor";
import { useAreaResolver } from "@/data/area/useAreaResolver";
import { useDeals, useMuniDeals, fmtPriceDate } from "@/data/prices/usePrices";

export const ConsumptionDealsScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);

  const [params] = useSearchParams();
  // "виж всички" forces the national feed while KEEPING the global ?area=
  // anchor intact (so leaving the deals page doesn't drop the user's place).
  const forceAll = params.get("all") === "1";
  const anchor = useAreaAnchor();
  const area = useAreaResolver(anchor?.id);
  const obshtina = area && area.kind !== "unknown" ? area.obshtina : null;
  const placeName =
    area?.kind === "settlement"
      ? bg
        ? area.settlement.name
        : area.settlement.name_en
      : area?.kind === "municipality"
        ? bg
          ? area.municipality.name
          : area.municipality.name_en
        : null;

  const { data: national } = useDeals();
  const { data: local } = useMuniDeals(obshtina);

  // Scope to the anchored município only when it actually has local promos;
  // otherwise fall through to the national feed (an obshtina with no covered
  // stores returns null).
  const scoped = !forceAll && !!(local && local.deals.length > 0);
  const allSearch = (() => {
    const p = new URLSearchParams(params);
    p.set("all", "1");
    return `?${p.toString()}`;
  })();
  const data = scoped ? local : national;
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
      <ConsumptionBreadcrumb
        section={T("Промоции", "Deals")}
        className="mt-4 mb-2"
      />
      <Title>{T("Промоции", "Deals")}</Title>

      <section aria-label={T("Промоции", "Deals")}>
        <DashboardSection
          id="prices"
          title={
            scoped && placeName
              ? T(`Промоции · ${placeName}`, `Deals · ${placeName}`)
              : T("Най-големи намаления днес", "Biggest cuts today")
          }
          subtitle={
            data?.latestDate
              ? `${T("промоционална спрямо редовна цена", "promo vs regular price")} · ${fmtPriceDate(data.latestDate, lang)}`
              : T("промоционална спрямо редовна цена", "promo vs regular price")
          }
          icon={Tag}
        >
          {scoped ? (
            <p className="mb-2 text-xs text-muted-foreground">
              {T(
                `Показва промоции в община ${placeName}. `,
                `Showing promotions in ${placeName} municipality. `,
              )}
              <Link
                to={{ search: allSearch }}
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                {T("Виж всички", "See all")}
                <ArrowRight className="size-3" />
              </Link>
            </p>
          ) : null}
          {deals.length === 0 ? null : (
            <Card className="p-3 sm:p-4">
              <DealsList deals={deals} lang={lang} />
            </Card>
          )}
        </DashboardSection>
      </section>
    </>
  );
};
