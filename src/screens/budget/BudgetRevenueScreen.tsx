// /budget/revenue — where the state's money comes from.
//
// A thin wrapper: the body is shared with /budget/spending, which is the same
// question asked of a different КФП section (plan §7.1 / T6.3).

import { FC } from "react";
import { BudgetCompositionScreen } from "./BudgetCompositionScreen";

export const BudgetRevenueScreen: FC = () => (
  <BudgetCompositionScreen
    kind="revenue"
    // TR — Eurostat's total general-government revenue. Named here rather than
    // derived from `kind`, because the pairing is a fact about Eurostat's
    // na_items, not about our section names.
    peerItem="TR"
    titleKey="budget_revenue_title"
    descriptionKey="budget_revenue_description"
    introKey="budget_revenue_intro"
    sourceKey="budget_revenue_source"
  />
);
