import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Database, History, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type DataPage = "map" | "sources" | "updates";

const PAGES: {
  id: DataPage;
  to: string;
  labelKey: string;
  icon: FC<{ className?: string }>;
}[] = [
  { id: "map", to: "/data", labelKey: "data_map_title", icon: MapIcon },
  {
    id: "sources",
    to: "/data/sources",
    labelKey: "data_sources_heading",
    icon: Database,
  },
  {
    id: "updates",
    to: "/data/updates",
    labelKey: "data_recent_changes_heading",
    icon: History,
  },
];

/** Pill navigation between the three data-hub pages (map / sources / updates). */
export const DataNav: FC<{ active: DataPage }> = ({ active }) => {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("data_title")}
      className="flex flex-wrap justify-center gap-2"
    >
      {PAGES.map(({ id, to, labelKey, icon: Icon }) => {
        const isActive = id === active;
        return (
          <Link
            key={id}
            to={to}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-secondary/40 text-secondary-foreground hover:border-accent hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon aria-hidden className="h-3.5 w-3.5" />
            {t(labelKey)}
          </Link>
        );
      })}
    </nav>
  );
};
