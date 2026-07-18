// Biggest price-movers lists, shared across the price tiles. Two layouts,
// because the two host tiles have different width budgets:
//
//   MoversSplit  — two columns (risers | fallers) with icons and fixed
//                  red/green columns. Used where the tile has full width
//                  (MyAreaPricesTile product movers; future category/deals pages).
//   MoversInline — a single interleaved list (risers then fallers), each row
//                  coloured by its actual sign. Used inside a narrow grid cell
//                  (GovernancePricesTile category movers) where two columns
//                  wouldn't fit; colour-by-sign keeps a barely-risen "faller"
//                  honest.
//
// Both resolve an id → label via `nameFor`, so a caller passes product movers
// (product dict) or category movers (category dict) unchanged.

import { FC } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Link } from "@/ux/Link";
import { fmtPct, priceChangeColor } from "@/data/prices/usePrices";

export interface MoverItem {
  id: number;
  /** fractional change since the euro (0.05 = +5%). */
  change: number;
}

const RED = "text-red-600 dark:text-red-400";
const GREEN = "text-green-600 dark:text-green-400";

interface Common {
  up: MoverItem[];
  down: MoverItem[];
  nameFor: (id: number) => string;
  /** rows per direction (default 3). */
  limit?: number;
  /** when set, each row's label links here — e.g. a category page. */
  hrefFor?: (id: number) => string;
}

const Row: FC<{
  m: MoverItem;
  nameFor: (id: number) => string;
  color: string;
  hrefFor?: (id: number) => string;
}> = ({ m, nameFor, color, hrefFor }) => {
  const href = hrefFor?.(m.id);
  return (
    <li className="flex justify-between gap-2">
      {href ? (
        <Link to={href} className="truncate min-w-0 hover:underline">
          {nameFor(m.id)}
        </Link>
      ) : (
        <span className="truncate min-w-0">{nameFor(m.id)}</span>
      )}
      <span className={`tabular-nums shrink-0 ${color}`}>
        {fmtPct(m.change)}
      </span>
    </li>
  );
};

export const MoversSplit: FC<
  Common & { risersLabel: string; fallersLabel: string }
> = ({
  up,
  down,
  nameFor,
  limit = 3,
  hrefFor,
  risersLabel,
  fallersLabel,
}) => {
  if (!up.length && !down.length) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
      <div>
        <div className={`flex items-center gap-1 ${RED} font-medium mb-1`}>
          <TrendingUp className="size-3.5" /> {risersLabel}
        </div>
        <ul className="space-y-0.5">
          {up.slice(0, limit).map((m) => (
            <Row key={m.id} m={m} nameFor={nameFor} color={RED} hrefFor={hrefFor} />
          ))}
        </ul>
      </div>
      <div>
        <div className={`flex items-center gap-1 ${GREEN} font-medium mb-1`}>
          <TrendingDown className="size-3.5" /> {fallersLabel}
        </div>
        <ul className="space-y-0.5">
          {down.slice(0, limit).map((m) => (
            <Row
              key={m.id}
              m={m}
              nameFor={nameFor}
              color={GREEN}
              hrefFor={hrefFor}
            />
          ))}
        </ul>
      </div>
    </div>
  );
};

export const MoversInline: FC<Common & { title: string }> = ({
  up,
  down,
  nameFor,
  limit = 3,
  hrefFor,
  title,
}) => {
  const rows = [...up.slice(0, limit), ...down.slice(0, limit)];
  if (!rows.length) return null;
  return (
    <div className="text-xs">
      {title ? <div className="font-medium mb-1">{title}</div> : null}
      <ul className="space-y-0.5">
        {rows.map((m) => (
          <Row
            key={m.id}
            m={m}
            nameFor={nameFor}
            color={priceChangeColor(m.change)}
            hrefFor={hrefFor}
          />
        ))}
      </ul>
    </div>
  );
};
