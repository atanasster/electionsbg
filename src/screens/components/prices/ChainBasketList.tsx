// Cheapest-chains basket list — shared by the Governance national tile and the
// per-place MyArea tile (identical row markup in both). Renders only the <ul>;
// each tile keeps its own header, since the wording differs.
//
// Each row: chain name + basket € + coverage (nPriced / basket size). Kept in
// one place so the upcoming chain-name link (→ /consumption/chain/:eik) is added
// once for every surface that lists chains.

import { FC } from "react";
import { Link } from "@/ux/Link";
import { fmtEur, type ChainRow } from "@/data/prices/usePrices";

interface Props {
  chains: ChainRow[];
  /** coverage denominator (national commonBasketSize / muni coreBasketSize). */
  basketSize: number;
  lang: "bg" | "en";
  /** cap the number of rows (national tile shows 4, place tile 3). */
  limit?: number;
}

export const ChainBasketList: FC<Props> = ({
  chains,
  basketSize,
  lang,
  limit,
}) => {
  const rows = limit != null ? chains.slice(0, limit) : chains;
  if (!rows.length) return null;
  return (
    <ul className="space-y-0.5">
      {rows.map((c) => (
        <li key={c.eik} className="flex justify-between gap-2">
          <Link
            to={`/consumption/chain/${c.eik}`}
            className="truncate min-w-0 hover:underline"
          >
            {c.chain}
          </Link>
          <span className="tabular-nums shrink-0 text-muted-foreground whitespace-nowrap">
            {fmtEur(c.basket, lang)}
            <span className="opacity-60">
              {" "}
              · {c.nPriced}/{basketSize}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
};
