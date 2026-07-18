// Reciprocal of the chain→company bridge: when a /company/:eik EIK is itself a
// КЗП price-monitored retail chain, surface its retail position (comparable-basket
// cost + rank among chains) with a link into the Consumption chain profile. Data
// comes from the `retailChain` block on /api/db/company (only present for chains),
// so this tile renders nothing for a normal company. Closes the dual-corpus loop.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShoppingBasket, ArrowRight } from "lucide-react";
import { Link } from "@/ux/Link";
import { Card } from "@/components/ui/card";
import { fmtEur } from "@/data/prices/usePrices";

export interface RetailChainInfo {
  chain: string;
  basket: number;
  n_priced: number;
  rank: number;
  total: number;
}

export const CompanyRetailChainTile: FC<{
  eik: string;
  info: RetailChainInfo;
}> = ({ eik, info }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  return (
    <Link to={`/consumption/chain/${eik}`} className="block">
      <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 items-center gap-3">
          <ShoppingBasket className="size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="font-medium">
              {T("Търговска верига", "Retail chain")}
            </div>
            <div className="text-xs text-muted-foreground">
              {T(
                `кошница ${fmtEur(info.basket, lang)} · ${info.rank}-о от ${info.total} по цена`,
                `basket ${fmtEur(info.basket, lang)} · #${info.rank} of ${info.total} by price`,
              )}
            </div>
          </div>
        </div>
        <ArrowRight className="size-5 shrink-0 text-primary" />
      </Card>
    </Link>
  );
};
