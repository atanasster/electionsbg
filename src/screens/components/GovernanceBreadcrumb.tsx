// Generic hierarchy breadcrumb for the governance sub-hubs that don't warrant a
// bespoke component (budget, EU funds, parliament, indicators, governments,
// demographics …) and their sub-pages. Same pattern/primitive as
// ProcurementBreadcrumb / SectorBreadcrumb:
//
//   Управление › <section> › <this sub-page>
//
// On the section landing, pass only section* → the section becomes the current
// (non-linked) crumb. On a sub-page, also pass currentKey/current → the section
// links back and the sub-page is the leaf.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Breadcrumbs, Crumb } from "@/ux/Breadcrumbs";

export const GovernanceBreadcrumb: FC<{
  /** i18n key for the section, e.g. "budget_link_label". */
  sectionKey: string;
  /** Section route, e.g. "/budget". */
  sectionTo: string;
  /** i18n key for the current sub-page label (omit on the section landing). */
  currentKey?: string;
  /** Already-resolved current sub-page label. Wins over currentKey. */
  current?: string;
  className?: string;
}> = ({ sectionKey, sectionTo, currentKey, current, className }) => {
  const { t } = useTranslation();
  const label = current ?? (currentKey ? t(currentKey) : undefined);

  const items: Crumb[] = [
    { label: t("nav_governance"), to: "/governance" },
    { label: t(sectionKey), ...(label ? { to: sectionTo } : {}) },
  ];
  if (label) items.push({ label });

  return <Breadcrumbs items={items} className={className} />;
};
