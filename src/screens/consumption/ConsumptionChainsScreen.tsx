// /consumption/chains — the retail-chain leaderboard. Ranks the comparable-basket
// chains cheapest-first from the national `chains` payload (the fairness-filtered
// set: only chains that price enough of the common basket). Each row links to the
// chain profile (/consumption/chain/:eik), which bridges to the company's
// money-flows profile. Monitoring index, not official CPI.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Store } from "lucide-react";
import { Link } from "@/ux/Link";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import { useNationalChains, fmtEur } from "@/data/prices/usePrices";

export const ConsumptionChainsScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const { data } = useNationalChains();

  const rows = useMemo(
    () => (data ? [...data.national].sort((a, b) => a.basket - b.basket) : []),
    [data],
  );
  const numFmt = new Intl.NumberFormat(bg ? "bg-BG" : "en-US");

  return (
    <>
      <SEO
        title={T("Вериги · Потребление", "Chains · Consumption")}
        description={T(
          "Коя търговска верига има най-евтина кошница в България.",
          "Which retail chain has the cheapest basket in Bulgaria.",
        )}
      />
      <ConsumptionBreadcrumb section={T("Вериги", "Chains")} className="my-4" />

      <section aria-label={T("Вериги", "Chains")}>
        <DashboardSection
          id="chains"
          title={T("Най-евтини вериги", "Cheapest chains")}
          subtitle={T(
            "Кошница от съпоставими продукти · мониторингов индекс, не официален ИПЦ",
            "Comparable-basket cost · monitoring index, not official CPI",
          )}
          icon={Store}
        >
          {rows.length === 0 ? null : (
            <Card className="p-3 sm:p-4">
              <ul className="divide-y">
                {rows.map((c, i) => (
                  <li key={c.eik} className="flex items-center gap-3 py-2">
                    <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <Link
                      to={`/consumption/chain/${c.eik}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {c.chain}
                    </Link>
                    {c.products != null ? (
                      <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                        {numFmt.format(c.products)} {T("продукта", "products")}
                      </span>
                    ) : null}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {c.nPriced}/{data?.commonBasketSize}
                    </span>
                    <span className="w-20 shrink-0 text-right font-semibold tabular-nums">
                      {fmtEur(c.basket, lang)}
                    </span>
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
