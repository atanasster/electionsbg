// The "€X по N договора" footer line every contracts DbDataTable renders under
// its rows. Fed by DbDataTable's renderAggregates render prop; the
// trailing noun (договора / анекса) is the only per-caller difference.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { formatEur } from "@/lib/currency";

export const ContractsAggregatesFooter: FC<{
  /** The footer aggregates handed back by DbDataTable (Σ € + count). */
  agg: { sumAmountEur?: number; count?: number };
  total: number;
  /** Whether the count is exact (else it's prefixed with ≈). */
  exact: boolean;
  /** The trailing noun: "договора" for contracts, "анекса" for annexes. */
  word: string;
}> = ({ agg, total, exact, word }) => {
  const { t } = useTranslation();
  return (
    <span className="text-sm text-muted-foreground">
      <span className="font-semibold tabular-nums text-foreground">
        {formatEur(agg.sumAmountEur ?? 0)}
      </span>{" "}
      {t("company_contracts_total_over") || "по"}{" "}
      <span className="tabular-nums">
        {exact ? "" : "≈"}
        {(agg.count ?? total).toLocaleString("bg-BG")}
      </span>{" "}
      {word}
    </span>
  );
};
