// /budget/simulator — the national tax-policy simulator. The interactive
// tool lives in BudgetPolicySimulator; this screen is the page shell
// (heading, intro, SEO). Not election-scoped: every scenario is scored
// against the latest closed fiscal year baked into policy_baseline.json.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { BudgetPolicySimulator } from "./components/budget/BudgetPolicySimulator";

export const BudgetPolicySimulatorScreen: FC = () => {
  const { t } = useTranslation();
  const title = t("budget_policy_page_title");
  const description = t("budget_policy_page_description");

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_policy_page_title"
        className="mt-5"
      />
      <section aria-label={title} className="my-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("budget_policy_page_intro")}
        </p>
        <Link
          to="/articles/2026-06-12-tax-policy-simulator"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <BookOpen className="h-4 w-4 shrink-0" />
          {t("budget_policy_methodology_link")}
        </Link>
        <BudgetPolicySimulator />
      </section>
    </>
  );
};
