// AwarderBreadcrumb — the hierarchy control for a single awarder page
// (/awarder/:eik). Same pattern as SectorBreadcrumb / ProcurementBreadcrumb:
//
//   Управление › Обществени поръчки › Държавни сектори › Възложители › <this awarder>
//
// Governance, Обществени поръчки (the hub), Държавни сектори (the sectors hub)
// and Възложители (the awarders index) are links; the last crumb is the current
// awarder's display name (text).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Breadcrumbs, Crumb } from "@/ux/Breadcrumbs";
import { SECTORS_HUB_PATH } from "./SectorBreadcrumb";

export const AWARDERS_INDEX_PATH = "/procurement/awarders";

export const AwarderBreadcrumb: FC<{
  /** i18n key for the current label. */
  currentKey?: string;
  /** Already-resolved current label (the awarder's display name). Wins over
   *  currentKey. */
  current?: string;
  className?: string;
}> = ({ currentKey, current, className }) => {
  const { t } = useTranslation();
  const label = current ?? (currentKey ? t(currentKey) : undefined);

  const items: Crumb[] = [
    { label: t("nav_governance"), to: "/governance" },
    { label: t("procurement_link_label"), to: "/procurement" },
    { label: t("sectors_hub_nav"), to: SECTORS_HUB_PATH },
    // Linked to the awarders index when we're on a specific awarder; the current
    // (non-linked) crumb on the index itself.
    {
      label: t("procurement_index_awarders"),
      ...(label ? { to: AWARDERS_INDEX_PATH } : {}),
    },
  ];
  if (label) items.push({ label });

  return <Breadcrumbs items={items} className={className} />;
};
