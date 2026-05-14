// Renders a single contract amount as the euro figure, with the original
// leva amount footnoted underneath when the row was converted from BGN.
// Shared across the procurement tiles + tables so the euro-primary display
// stays uniform. See src/lib/currency.ts.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { formatAmountEur } from "@/lib/currency";

export const ContractAmount: FC<{
  amountEur?: number;
  amount?: number;
  currency?: string;
}> = ({ amountEur, amount, currency }) => {
  const { i18n } = useTranslation();
  const { primary, original } = formatAmountEur(
    amountEur,
    amount,
    currency,
    i18n.language,
  );
  if (!primary) return <>—</>;
  return (
    <>
      {primary}
      {original ? (
        <span className="block text-[10px] text-muted-foreground">
          {original}
        </span>
      ) : null}
    </>
  );
};
