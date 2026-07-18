// "Промоции край вас" — the biggest current promo cuts among stores in this
// município, from the deals-muni:<obshtina> payload. Coverage-aware: an
// obshtina with no covered stores/promos returns null and the tile self-hides
// (the place still has its basket + summary). Rows deep-link to the product and
// chain pages. Monitoring index, not official CPI.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Link } from "@/ux/Link";
import { Card } from "@/components/ui/card";
import { DealsList } from "@/screens/components/consumption/DealsList";
import { useMuniDeals, fmtPriceDate } from "@/data/prices/usePrices";

interface Props {
  obshtina: string;
  /** How many rows to show before the "see all" link. */
  limit?: number;
}

export const PlaceDealsTile: FC<Props> = ({ obshtina, limit = 8 }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const { data } = useMuniDeals(obshtina);

  const deals = data?.deals ?? [];
  if (deals.length === 0) return null;

  return (
    <Card className="p-3 sm:p-4 flex flex-col gap-2">
      <DealsList deals={deals.slice(0, limit)} lang={lang} />
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
        <Link
          to="/consumption/deals"
          className="font-medium text-primary hover:underline inline-flex items-center gap-1"
        >
          {T("Всички промоции", "All promotions")}
          <ArrowRight className="size-3" />
        </Link>
        {data?.latestDate ? (
          <span className="text-muted-foreground tabular-nums">
            {fmtPriceDate(data.latestDate, lang)}
          </span>
        ) : null}
      </div>
    </Card>
  );
};
