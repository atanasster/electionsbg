// /consumption/chain/:eik — a retail chain's profile. The retail side (basket
// cost + rank among chains, from the national `chains` payload) plus the bridge
// to the company's money-flows profile: a chain has a real EIK, so /company/:eik
// already aggregates its public procurement, EU funds, ownership and connections.
// The embedded company tiles + the chain's product-price ranking land in a
// follow-on (they need the chain-products payload + the company rollup adapter).

import { FC, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Store, Building2, ArrowRight } from "lucide-react";
import { Link } from "@/ux/Link";
import { SEO } from "@/ux/SEO";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import { useNationalChains, fmtEur } from "@/data/prices/usePrices";

export const ChainProfileScreen: FC = () => {
  const { eik = "" } = useParams();
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const numFmt = new Intl.NumberFormat(bg ? "bg-BG" : "en-US");
  const { data } = useNationalChains();

  const info = useMemo(() => {
    if (!data) return null;
    const sorted = [...data.national].sort((a, b) => a.basket - b.basket);
    const idx = sorted.findIndex((c) => c.eik === eik);
    return idx < 0
      ? { row: null, rank: null, total: sorted.length }
      : { row: sorted[idx], rank: idx + 1, total: sorted.length };
  }, [data, eik]);

  const name = info?.row?.chain ?? T("Верига", "Chain");
  const title = `${name} · ${T("Потребление", "Consumption")}`;

  return (
    <>
      <SEO
        title={title}
        description={T(
          `Цени и профил на търговската верига ${name}.`,
          `Prices and profile for the ${name} retail chain.`,
        )}
      />
      <PlaceHeader active="consumption" level="country" className="my-4" />

      <section aria-label={name}>
        <div className="my-4 flex items-center gap-2">
          <Store className="size-5 text-primary" />
          <h1 className="text-2xl font-bold">{name}</h1>
        </div>

        <DashboardSection
          id="prices"
          title={T("Кошница на веригата", "Chain basket")}
          subtitle={T(
            "мониторингов индекс, не официален ИПЦ",
            "monitoring index, not official CPI",
          )}
          icon={Store}
        >
          <Card className="flex flex-wrap items-end gap-x-10 gap-y-3 p-4">
            {info?.row ? (
              <>
                <div>
                  <div className="text-3xl font-bold tabular-nums">
                    {fmtEur(info.row.basket, lang)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {T("съпоставима кошница", "comparable basket")} ·{" "}
                    {info.row.nPriced}/{data?.commonBasketSize}
                  </div>
                </div>
                {info.rank ? (
                  <div>
                    <div className="text-3xl font-bold tabular-nums">
                      {info.rank}
                      <span className="text-base text-muted-foreground">
                        /{info.total}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {T("по цена на кошницата", "by basket cost")}
                    </div>
                  </div>
                ) : null}
                {info.row.products != null ? (
                  <div>
                    <div className="text-3xl font-bold tabular-nums">
                      {numFmt.format(info.row.products)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {T("проследени продукта", "tracked products")}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {T(
                  "Тази верига няма съпоставима кошница в мониторинга.",
                  "This chain has no comparable basket in the monitor.",
                )}
              </p>
            )}
          </Card>
        </DashboardSection>

        <DashboardSection
          id="sources"
          title={T("Отвъд щанда", "Beyond the shelf")}
          subtitle={T(
            "Фирмата зад веригата — поръчки, връзки, собственост",
            "The company behind the chain — contracts, connections, ownership",
          )}
          icon={Building2}
        >
          <Link to={`/company/${eik}`} className="block">
            <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/50">
              <div className="min-w-0">
                <div className="font-medium">
                  {T("Пълен профил на фирмата", "Full company profile")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {T(
                    `ЕИК ${eik} · обществени поръчки, еврофондове, свързани лица`,
                    `EIK ${eik} · public procurement, EU funds, connected people`,
                  )}
                </div>
              </div>
              <ArrowRight className="size-5 shrink-0 text-primary" />
            </Card>
          </Link>
        </DashboardSection>
      </section>
    </>
  );
};
