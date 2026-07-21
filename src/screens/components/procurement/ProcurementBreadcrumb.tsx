// The hierarchy breadcrumb for the /procurement sub-pages — the same pattern as
// SectorBreadcrumb, one level shallower. Replaces the ProcurementNav pill rows
// (primary tabs + the "Тематични анализи" sector enumeration): a sub-page shows
// where it sits and links up to the hub, which fronts the sub-pages as tiles.
//
//   Управление › Обществени поръчки › <this sub-page>
//
// Governance + Обществени поръчки (the hub) are links; the last crumb is the
// current sub-page. Detail pages (a single contract/tender) sit one level
// deeper — pass `section` for the linked sub-page they belong to, and the
// resolved entity name as `current`:
//
//   Управление › Обществени поръчки › <section> › <current leaf>

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Breadcrumbs, Crumb } from "@/ux/Breadcrumbs";

export const ProcurementBreadcrumb: FC<{
  /** i18n key for the current sub-page label (e.g. "procurement_tenders_nav"). */
  currentKey?: string;
  /** Already-resolved current label. Wins over currentKey. */
  current?: string;
  /** Optional linked sub-page crumb between the hub and the current leaf, for
   *  detail pages (e.g. Договори → /procurement/contracts). Pass `labelKey` for an
   *  i18n label, or `label` for an already-resolved one. */
  section?: { labelKey?: string; label?: string; to: string };
  className?: string;
}> = ({ currentKey, current, section, className }) => {
  const { t } = useTranslation();
  const label = current ?? (currentKey ? t(currentKey) : undefined);
  // The hub links whenever anything (a section and/or leaf) sits below it.
  const hasDescendant = label != null || section != null;

  const items: Crumb[] = [
    { label: t("nav_governance"), to: "/governance" },
    // Linked to the hub when we're on a sub-page; the current (non-linked) crumb
    // on the hub itself.
    {
      label: t("procurement_link_label"),
      ...(hasDescendant ? { to: "/procurement" } : {}),
    },
  ];
  if (section)
    items.push({
      label: section.label ?? (section.labelKey ? t(section.labelKey) : ""),
      to: section.to,
    });
  if (label) items.push({ label });

  return <Breadcrumbs items={items} className={className} />;
};
