// /consumption/categories — the 14 КЗП basket categories, each with its change
// since the euro (from the national byCategory index), linking to the per-category
// page. Monitoring index, not official CPI.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid } from "lucide-react";
import { Link } from "@/ux/Link";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import {
  usePriceIndex,
  fmtPct,
  priceChangeColor,
} from "@/data/prices/usePrices";

export const ConsumptionCategoriesScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const T = (b: string, e: string) => (bg ? b : e);
  const { data: index } = usePriceIndex();

  const cats = useMemo(() => {
    if (!index) return [];
    return index.categories
      .map((c) => {
        const s = index.national.byCategory[String(c.id)] ?? [];
        const change = s.length >= 2 ? s[s.length - 1].v / 100 - 1 : null;
        return { id: c.id, label: bg ? c.bg : c.en, change };
      })
      .sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity));
  }, [index, bg]);

  return (
    <>
      <SEO
        title={T("Категории · Потребление", "Categories · Consumption")}
        description={T(
          "Цените по категории храни в България от въвеждането на еврото.",
          "Food-category prices in Bulgaria since the euro.",
        )}
      />
      <ConsumptionBreadcrumb
        section={T("Категории", "Categories")}
        className="my-4"
      />

      <section aria-label={T("Категории", "Categories")}>
        <DashboardSection
          id="prices"
          title={T("Категории", "Categories")}
          subtitle={T(
            "Промяна от еврото · мониторингов индекс, не официален ИПЦ",
            "Change since the euro · monitoring index, not official CPI",
          )}
          icon={LayoutGrid}
        >
          {cats.length === 0 ? null : (
            <Card className="p-3 sm:p-4">
              <ul className="divide-y">
                {cats.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2">
                    <Link
                      to={`/consumption/category/${c.id}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {c.label}
                    </Link>
                    {c.change != null ? (
                      <span
                        className={`shrink-0 text-sm tabular-nums ${priceChangeColor(
                          c.change,
                        )}`}
                      >
                        {fmtPct(c.change)}
                      </span>
                    ) : null}
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
