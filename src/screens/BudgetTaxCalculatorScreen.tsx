// /budget/tax-calculator — the standalone "what did your taxes buy?" tax
// calculator. The interactive tool itself lives in BudgetTaxCalculator; this
// screen is the page shell (heading, intro, SEO) that hosts it. With no
// fiscalYear prop the calculator defaults to the latest known МОД and the
// latest COFOG year — the right behaviour for a general civic tool that is
// not scoped to a single election term.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Title } from "@/ux/Title";
import { BudgetTaxCalculator } from "./components/budget/BudgetTaxCalculator";

export const BudgetTaxCalculatorScreen: FC = () => {
  const { t } = useTranslation();
  const title = t("budget_tax_calculator_page_title");
  const description = t("budget_tax_calculator_page_description");

  return (
    <>
      <Title description={description}>{title}</Title>
      <section aria-label={title} className="my-4 space-y-4">
        <Link
          to="/budget"
          className="text-primary hover:underline inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("budget_index_title")}
        </Link>
        <p className="text-sm text-muted-foreground">
          {t("budget_tax_calculator_page_intro")}{" "}
          <Link to="/budget/simulator" className="text-primary hover:underline">
            {t("budget_citizen_policy_sim_link")}
          </Link>
        </p>
        <BudgetTaxCalculator />
      </section>
    </>
  );
};
