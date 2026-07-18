// Shared promo list — the −N% / product / chain / promo-vs-regular rows used by
// both the national /consumption/deals screen and the per-município "промоции
// край вас" tile on the place dashboard. Rows deep-link to the product page and
// the chain profile. Monitoring index, not official CPI.

import { FC } from "react";
import { Link } from "@/ux/Link";
import { fmtEur, type DealRow } from "@/data/prices/usePrices";

interface Props {
  deals: DealRow[];
  lang: "bg" | "en";
}

export const DealsList: FC<Props> = ({ deals, lang }) => (
  <ul className="divide-y">
    {deals.map((d) => (
      <li key={d.slug} className="flex items-center gap-3 py-2 text-sm">
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
);
