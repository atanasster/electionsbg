// /budget/spending — where the state's money goes.
//
// The twin of /budget/revenue: same four-part spine, same shared body, a
// different КФП section (plan §7.1 / T6.4).
//
// TWO pairings are decided here rather than derived, and both are facts about
// somebody else's taxonomy:
//
//   * `kind="expenditure"` selects §II Разходи. The section that carries the
//     §III Вноска в бюджета на ЕС is ALSO kind = 'expenditure', which is why
//     the body picks by `series` — see the comment there.
//   * `peerItem="TE"` is Eurostat's total general-government expenditure. Left
//     on TR by a copy-paste from the revenue wrapper, this page would print
//     Bulgaria's REVENUE share of GDP under a spending heading: 38.1% instead
//     of 41.7%, rank 24 instead of 23, both real numbers and both wrong here.
//     `BudgetSpendingScreen.test.tsx` is the gate.

import { FC } from "react";
import { BudgetCompositionScreen } from "./BudgetCompositionScreen";

export const BudgetSpendingScreen: FC = () => (
  <BudgetCompositionScreen
    kind="expenditure"
    peerItem="TE"
    titleKey="budget_spending_title"
    descriptionKey="budget_spending_description"
    introKey="budget_spending_intro"
    sourceKey="budget_spending_source"
  />
);
