// /consumption/chain/:eik — a retail chain's profile. The retail side (basket
// cost + rank among chains, from the national `chains` payload) plus the bridge
// to the company's money-flows profile: a chain has a real EIK, so /company/:eik
// already aggregates its public procurement, EU funds, ownership and connections.
// It also lists the chain's own products with the chain's price vs the market
// min (the precomputed `chain-products:<eik>` payload), each linking to the
// per-product cross-chain ladder.

import { FC, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Store, Building2, ArrowRight, ShoppingBasket } from "lucide-react";
import { Link } from "@/ux/Link";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import {
  useNationalChains,
  useChainProducts,
  fmtEur,
} from "@/data/prices/usePrices";
import { useCompanyProfile } from "@/data/procurement/useCompanyProfile";
import { formatEurCompact } from "@/lib/currency";

export const ChainProfileScreen: FC = () => {
  const { eik = "" } = useParams();
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const numFmt = new Intl.NumberFormat(bg ? "bg-BG" : "en-US");
  const { data } = useNationalChains();
  const { data: chainProducts } = useChainProducts(eik);

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

  // The company behind the chain — a compact cross-corpus summary (money-flows),
  // with the full profile one click away at /company/:eik.
  const { data: profile } = useCompanyProfile(eik);
  const chips: string[] = [];
  if (profile) {
    const p = profile.procurement;
    if (p && p.contractCount > 0)
      chips.push(
        T(
          `изпълнител · ${p.contractCount} договора · ${formatEurCompact(p.totalEur, i18n.language)}`,
          `supplier · ${p.contractCount} contracts · ${formatEurCompact(p.totalEur, i18n.language)}`,
        ),
      );
    if (profile.officers.length > 0)
      chips.push(
        T(
          `${profile.officers.length} собственици/органи`,
          `${profile.officers.length} officers/owners`,
        ),
      );
    if (profile.politicians.length > 0)
      chips.push(
        T(
          `${profile.politicians.length} политически връзки`,
          `${profile.politicians.length} political links`,
        ),
      );
    if (profile.funds) chips.push(T("еврофондове", "EU funds"));
    if (profile.subsidies) chips.push(T("субсидии ДФЗ", "farm subsidies"));
  }
  const trName =
    profile?.company?.name && profile.company.name !== name
      ? profile.company.name
      : null;

  return (
    <>
      <SEO
        title={title}
        description={T(
          `Цени и профил на търговската верига ${name}.`,
          `Prices and profile for the ${name} retail chain.`,
        )}
      />
      <ConsumptionBreadcrumb
        section={T("Вериги", "Chains")}
        sectionTo="/consumption/chains"
        current={name}
        className="my-4"
      />

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
                      {T("продукта от кошницата", "basket products priced")}
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

        {chainProducts?.products?.length ? (
          <DashboardSection
            id="products"
            title={T("Продукти на веригата", "Chain products")}
            subtitle={T(
              "Цена в тази верига спрямо най-ниската на пазара",
              "Price at this chain vs the cheapest on the market",
            )}
            icon={ShoppingBasket}
          >
            <Card className="p-3 sm:p-4">
              <ul className="divide-y">
                {chainProducts.products.map((p) => {
                  const cheapest =
                    p.marketMin != null && p.price <= p.marketMin + 0.001;
                  return (
                    <li
                      key={p.slug}
                      className="flex items-center gap-3 py-2 text-sm"
                    >
                      <Link
                        to={`/product/${p.slug}`}
                        className="min-w-0 flex-1 truncate font-medium hover:underline"
                      >
                        {p.title}
                      </Link>
                      {!cheapest && p.marketMin != null ? (
                        <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground line-through sm:inline">
                          {fmtEur(p.marketMin, lang)}
                        </span>
                      ) : null}
                      <span className="w-20 shrink-0 text-right font-semibold tabular-nums">
                        {fmtEur(p.price, lang)}
                      </span>
                      {cheapest ? (
                        <span className="hidden w-16 shrink-0 text-right text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 sm:inline">
                          {T("най-евтина", "cheapest")}
                        </span>
                      ) : (
                        <span className="hidden w-16 shrink-0 sm:inline" />
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </DashboardSection>
        ) : null}

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
            <Card className="p-4 transition-colors hover:bg-muted/50">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {T("Пълен профил на фирмата", "Full company profile")}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {trName ? `${trName} · ` : ""}
                    {T(`ЕИК ${eik}`, `EIK ${eik}`)}
                  </div>
                </div>
                <ArrowRight className="size-5 shrink-0 text-primary" />
              </div>
              {chips.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <span
                      key={c}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              ) : null}
            </Card>
          </Link>
        </DashboardSection>
      </section>
    </>
  );
};
