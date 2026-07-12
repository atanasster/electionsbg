// The hierarchy breadcrumb for the /procurement sub-pages — the same pattern as
// SectorBreadcrumb, one level shallower. Replaces the ProcurementNav pill rows
// (primary tabs + the "Тематични анализи" sector enumeration): a sub-page shows
// where it sits and links up to the hub, which fronts the sub-pages as tiles.
//
//   Управление › Обществени поръчки › <this sub-page>
//
// Governance + Обществени поръчки (the hub) are links; the last crumb is the
// current sub-page.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Breadcrumbs, Crumb } from "@/ux/Breadcrumbs";

export const ProcurementBreadcrumb: FC<{
  /** i18n key for the current sub-page label (e.g. "procurement_tenders_nav"). */
  currentKey?: string;
  /** Already-resolved current label. Wins over currentKey. */
  current?: string;
  className?: string;
}> = ({ currentKey, current, className }) => {
  const { t } = useTranslation();
  const label = current ?? (currentKey ? t(currentKey) : undefined);

  const items: Crumb[] = [
    { label: t("nav_governance"), to: "/governance" },
    // Linked to the hub when we're on a sub-page; the current (non-linked) crumb
    // on the hub itself.
    {
      label: t("procurement_index_title"),
      ...(label ? { to: "/procurement" } : {}),
    },
  ];
  if (label) items.push({ label });

  return <Breadcrumbs items={items} className={className} />;
};
