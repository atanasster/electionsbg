// The hierarchy breadcrumb for the /governance/declarations sub-hub and its
// pages — same pattern as ProcurementBreadcrumb / SectorBreadcrumb.
//
//   Управление › Декларации › <this sub-page>
//
// Управление + Декларации (the hub) link; the last crumb is the current page.
// Rendered with no props on the hub itself (Декларации becomes non-linked text).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Breadcrumbs, Crumb } from "@/ux/Breadcrumbs";

export const DECLARATIONS_HUB_PATH = "/governance/declarations";

export const DeclarationsBreadcrumb: FC<{
  /** i18n key for the current sub-page label (e.g. "mp_assets_link_label"). */
  currentKey?: string;
  /** Already-resolved current label. Wins over currentKey. */
  current?: string;
  className?: string;
}> = ({ currentKey, current, className }) => {
  const { t } = useTranslation();
  const label = current ?? (currentKey ? t(currentKey) : undefined);

  const items: Crumb[] = [
    { label: t("nav_governance"), to: "/governance" },
    {
      label: t("menu_group_declarations"),
      ...(label ? { to: DECLARATIONS_HUB_PATH } : {}),
    },
  ];
  if (label) items.push({ label });

  return <Breadcrumbs items={items} className={className} />;
};
