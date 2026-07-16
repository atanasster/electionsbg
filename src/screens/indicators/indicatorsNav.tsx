// Shared sub-navigation pill row rendered at the top of every /indicators
// screen. Plain Links (not tabs) so each entry is a real route — keyboard
// users get history navigation, copy-paste works, the URL is the source of
// truth.
//
// Two flavours:
//   <IndicatorsNav />                — sub-page header (Economy/Fiscal/...
//                                       + Compare + "back to dashboard")
//   <IndicatorsNav variant="landing"> — landing-page sub-nav (Economy/
//                                       Fiscal/.../Compare as siblings;
//                                       no back-to-dashboard chip because
//                                       we ARE the dashboard)
//
// Both variants preserve the URL search string (`?elections=...&cabinet=...`)
// across navigation so the global anchor and the selected election survive
// when the user moves between sibling pages — that was the source of the
// "click Compare loses the cabinet" bug.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";

const DOMAINS = [
  { path: "/indicators/economy", labelKey: "indicators_nav_economy" },
  { path: "/indicators/fiscal", labelKey: "indicators_nav_fiscal" },
  { path: "/indicators/budgets", labelKey: "indicators_nav_budgets" },
  { path: "/indicators/governance", labelKey: "indicators_nav_governance" },
  { path: "/indicators/society", labelKey: "indicators_nav_society" },
  { path: "/indicators/compare", labelKey: "indicators_nav_compare" },
] as const;

const pillClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    "rounded-full border px-3 py-1 text-xs transition-colors",
    isActive
      ? "border-primary bg-primary/10 text-primary font-medium"
      : "border-border bg-background text-muted-foreground hover:bg-accent/10 hover:text-foreground",
  );

export const IndicatorsNav: FC<{
  className?: string;
  /** "subpage" (default) shows a "back to dashboard" link + the 5 domain
   *  pills. "landing" omits the back link — used on /indicators itself,
   *  where the dashboard tiles live below the nav. */
  variant?: "subpage" | "landing";
}> = ({ className, variant = "subpage" }) => {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const activeDomain = DOMAINS.find((d) => d.path === pathname);

  const renderPills = (
    <nav
      className="flex flex-wrap items-center gap-1.5"
      aria-label={t("indicators_nav_aria")}
    >
      {DOMAINS.map((d) => (
        <NavLink
          key={d.path}
          to={{ pathname: d.path, search }}
          end
          className={pillClass}
        >
          {t(d.labelKey)}
        </NavLink>
      ))}
    </nav>
  );

  if (variant === "landing") {
    // Centred row, no back-link — the dashboard tiles below are the
    // landing's main content, not a sibling page to navigate back to.
    return (
      <div className={cn("mb-4 flex justify-center", className)}>
        {renderPills}
      </div>
    );
  }

  return (
    <>
      {/* Hierarchy breadcrumb up to Управление — the sub-page counterpart of the
          landing's own breadcrumb (rendered here since IndicatorsNav sits right
          under the Title on every theme page). */}
      <GovernanceBreadcrumb
        sectionKey="gov_hub_indicators_title"
        sectionTo="/indicators"
        currentKey={activeDomain?.labelKey}
        className="mt-5 mb-3"
      />
      <div
        className={cn(
          "mb-6 flex items-center justify-between gap-3 flex-wrap",
          className,
        )}
      >
        <NavLink
          to={{ pathname: "/indicators", search }}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t("indicators_nav_back_to_dashboard")}
        </NavLink>
        {renderPills}
      </div>
    </>
  );
};
