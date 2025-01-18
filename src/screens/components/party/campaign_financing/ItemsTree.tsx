import { formatPct, formatThousands, pctChange } from "@/data/utils";
import { cn } from "@/lib/utils";
import { PercentChange } from "@/ux/PercentChange";
import { FC } from "react";

export type TreeItemType = {
  label: string;
  amount?: number;
  priorAmount?: number;
  items?: TreeItemType[];
};
const TreeItem: FC<{ item: TreeItemType; className?: string }> = ({
  item,
  className,
}) => {
  return (
    !!item.amount && (
      <div className="flex justify-between w-full gap-2">
        <div>{item.label}</div>
        {item.amount && (
          <div className="flex gap-2">
            <div className={cn("flex justify-end", className)}>
              {formatThousands(item.amount, 2)}
            </div>
            <div className="w-20 flex justify-end">
              {!!item.priorAmount && (
                <PercentChange
                  suffix=""
                  pctChange={formatPct(
                    pctChange(item.amount, item.priorAmount),
                  )}
                />
              )}
            </div>
          </div>
        )}
      </div>
    )
  );
};
const calcTotals = (item: TreeItemType): TreeItemType => {
  return item.items
    ? item.items.reduce(
        (acc, curr) => {
          const { amount, priorAmount } = curr.items
            ? calcTotals(curr)
            : { amount: curr.amount, priorAmount: curr.priorAmount };
          return {
            ...acc,
            amount: (acc.amount || 0) + (amount || 0),
            priorAmount: (acc.priorAmount || 0) + (priorAmount || 0),
          };
        },
        {
          label: item.label,
          amount: undefined,
          priorAmount: undefined,
        },
      )
    : {
        label: item.label,
        amount: undefined,
        priorAmount: undefined,
      };
};
export const ItemsTree: FC<{ items: TreeItemType[]; level?: number }> = ({
  items,
  level = 1,
}) => {
  return (
    <ul className="ml-2">
      {items.map((item, idx) => {
        return (
          <li key={`items_${idx}`}>
            {item.items ? (
              <TreeItem item={calcTotals(item)} className="font-bold" />
            ) : (
              <TreeItem
                item={item}
                className={level === 1 ? "font-bold" : ""}
              />
            )}
            {item.items && <ItemsTree items={item.items} level={level + 1} />}
          </li>
        );
      })}
    </ul>
  );
};
