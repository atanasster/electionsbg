// Shared sub-navigation pill row rendered at the top of every /indicators/*
// sub-page. Plain Links (not tabs) so each entry is a real route — keyboard
// users get history navigation, copy-paste works, the URL is the source of
// truth. The /indicators link is a "back to dashboard" affordance, not a
// nav-equivalent of the four domains.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const DOMAINS = [
  { path: "/indicators/economy", labelKey: "indicators_nav_economy" },
  { path: "/indicators/fiscal", labelKey: "indicators_nav_fiscal" },
  { path: "/indicators/governance", labelKey: "indicators_nav_governance" },
  { path: "/indicators/society", labelKey: "indicators_nav_society" },
] as const;

export const IndicatorsNav: FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "mb-6 flex items-center justify-between gap-3 flex-wrap",
        className,
      )}
    >
      <NavLink
        to="/indicators"
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {t("indicators_nav_back_to_dashboard")}
      </NavLink>
      <nav
        className="flex flex-wrap items-center gap-1.5"
        aria-label={t("indicators_nav_aria")}
      >
        {DOMAINS.map((d) => (
          <NavLink
            key={d.path}
            to={d.path}
            end
            className={({ isActive }) =>
              cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                isActive
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border bg-background text-muted-foreground hover:bg-accent/10 hover:text-foreground",
              )
            }
          >
            {t(d.labelKey)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
};
