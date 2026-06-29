import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Per-year State Budget Law: adoption date + in-year amendment dates. Carries
// only dates; the defender/reviser finance ministers are resolved at display
// time from data/finance_ministers.json. `adopted` null = no budget law in
// force (caretaker year on a bridging/extended law).
export type BudgetLaw = {
  year: number;
  adopted: string | null;
  revisions?: string[];
  note?: "no_budget" | "interim";
};

type BudgetLawsPayload = {
  budgetLaws: BudgetLaw[];
};

export const useBudgetLaws = () =>
  useQuery({
    queryKey: ["budgetLaws"],
    queryFn: async () => {
      const res = await fetch(dataUrl("/budget_laws.json"));
      if (!res.ok) return [] as BudgetLaw[];
      const payload = (await res.json()) as BudgetLawsPayload;
      return payload?.budgetLaws ?? [];
    },
  });
