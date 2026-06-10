// /budget/simulator — the national tax-policy simulator. The interactive
// tool lives in BudgetPolicySimulator; this screen is the page shell
// (heading, intro, SEO). Not election-scoped: every scenario is scored
// against the latest closed fiscal year baked into policy_baseline.json.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Title } from "@/ux/Title";
import { BudgetPolicySimulator } from "./components/budget/BudgetPolicySimulator";

export const BudgetPolicySimulatorScreen: FC = () => {
  const { t } = useTranslation();
  const title = t("budget_policy_page_title");
  const description = t("budget_policy_page_description");

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
          {t("budget_policy_page_intro")}
        </p>
        <BudgetPolicySimulator />
      </section>
    </>
  );
};
