// SectorBreadcrumb — the shared hierarchy control for the government-sector
// pages. Replaces the old "Тематични анализи" strip that enumerated all ~13
// sibling sectors on every sector dashboard: instead of listing the siblings, we
// show the trail up to the sectors hub, which is the one place that lists them.
//
//   Управление › Обществени поръчки › Сектори › <this sector>
//
// The middle crumbs are links (governance dashboard, procurement, the sectors
// hub); the last is the current sector (text). On the hub itself, omit `current`
// so the trail ends at a non-linked "Сектори".

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Breadcrumbs, Crumb } from "@/ux/Breadcrumbs";

export const SECTORS_HUB_PATH = "/governance/sectors";

export const SectorBreadcrumb: FC<{
  /** i18n key for the current sector's label (e.g. "judiciary_nav"). */
  currentKey?: string;
  /** Already-resolved current label (e.g. an awarder's display name). Wins over
   *  currentKey. */
  current?: string;
  className?: string;
}> = ({ currentKey, current, className }) => {
  const { t } = useTranslation();
  const label = current ?? (currentKey ? t(currentKey) : undefined);

  const items: Crumb[] = [
    { label: t("nav_governance"), to: "/governance" },
    { label: t("procurement_link_label"), to: "/procurement" },
    // Linked when we're on a sector page; the current (non-linked) crumb on the
    // hub itself.
    { label: t("sectors_hub_nav"), ...(label ? { to: SECTORS_HUB_PATH } : {}) },
  ];
  if (label) items.push({ label });

  return <Breadcrumbs items={items} className={className} />;
};
