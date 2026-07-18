// Section-hierarchy breadcrumb for the Consumption (Потребление) data pages and
// their sub-pages. Same pattern/primitive as GovernanceBreadcrumb:
//
//   Потребление › <section> › <this sub-page>
//
// On a section landing (e.g. /consumption/categories) pass only `section` → it
// becomes the current (non-linked) crumb. On a sub-sub page (e.g. a single
// category or chain) also pass `sectionTo` + `current` → the section links back
// and the entity is the leaf. Consumption labels are inline bilingual strings
// (not i18n keys), so this takes already-resolved label strings.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Breadcrumbs, Crumb } from "@/ux/Breadcrumbs";

export const ConsumptionBreadcrumb: FC<{
  /** Section label (already localized), e.g. "Категории". */
  section: string;
  /** Section route, e.g. "/consumption/categories". Only linked when `current`
   *  is set (on a sub-sub page); on the section landing the section is the leaf. */
  sectionTo?: string;
  /** Already-localized leaf label — the entity on a sub-sub page. Omit on the
   *  section landing. */
  current?: string;
  className?: string;
}> = ({ section, sectionTo, current, className }) => {
  const { t } = useTranslation();
  const root = t("consumption_title") || "Потребление";

  const items: Crumb[] = [{ label: root, to: "/consumption" }];
  items.push({
    label: section,
    ...(current && sectionTo ? { to: sectionTo } : {}),
  });
  if (current) items.push({ label: current });

  return <Breadcrumbs items={items} className={className} />;
};
