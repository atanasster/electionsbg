// Hierarchy breadcrumb for the pages fronted by the two election hubs — the
// analyses hub (/parliamentary/analysis) and the reports hub
// (/parliamentary/reports). Same pattern/primitive as GovernanceBreadcrumb /
// ProcurementBreadcrumb:
//
//   Избори › Анализи › <this analysis>            (a top-level analysis page)
//   Избори › Анализи › <analysis> › <sub-page>    (a sub-page, e.g. methodology)
//   Избори › Доклади › <this report>              (a report page)
//
// "Избори" links to the elections home; the hub crumb links to its hub whenever
// something sits below it. Pass `section` for the linked parent page a sub-page
// belongs to (e.g. Изгубени гласове → /wasted-vote), and the sub-page as
// currentKey/current.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Breadcrumbs, Crumb } from "@/ux/Breadcrumbs";

const HUBS = {
  analysis: { labelKey: "analysis_hub_nav", to: "/parliamentary/analysis" },
  reports: { labelKey: "reports_hub_nav", to: "/parliamentary/reports" },
} as const;

export const ElectionsBreadcrumb: FC<{
  /** Which hub this page hangs off — sets the second crumb. */
  hub: "analysis" | "reports";
  /** i18n key for the current page label (omit on the hub landing itself). */
  currentKey?: string;
  /** Already-resolved current label. Wins over currentKey. */
  current?: string;
  /** Optional linked parent-page crumb between the hub and the current leaf, for
   *  sub-pages (e.g. Изгубени гласове → /wasted-vote). Pass `labelKey` for an
   *  i18n label or `label` for an already-resolved one. */
  section?: { labelKey?: string; label?: string; to: string };
  className?: string;
}> = ({ hub, currentKey, current, section, className }) => {
  const { t } = useTranslation();
  const label = current ?? (currentKey ? t(currentKey) : undefined);
  const hasDescendant = label != null || section != null;
  const hubCfg = HUBS[hub];

  const items: Crumb[] = [
    { label: t("nav_elections"), to: "/" },
    { label: t(hubCfg.labelKey), ...(hasDescendant ? { to: hubCfg.to } : {}) },
  ];
  if (section)
    items.push({
      label: section.label ?? (section.labelKey ? t(section.labelKey) : ""),
      to: section.to,
    });
  if (label) items.push({ label });

  return <Breadcrumbs items={items} className={className} />;
};
