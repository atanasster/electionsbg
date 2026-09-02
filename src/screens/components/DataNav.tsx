import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Database, History, Map as MapIcon, Share2 } from "lucide-react";
import { PillGroup, PillLink } from "@/components/ui/Pill";

type DataPage = "map" | "links" | "sources" | "updates";

const PAGES: {
  id: DataPage;
  to: string;
  labelKey: string;
  icon: FC<{ className?: string }>;
}[] = [
  { id: "map", to: "/data", labelKey: "data_map_title", icon: MapIcon },
  {
    id: "links",
    to: "/data/links",
    labelKey: "data_links_nav",
    icon: Share2,
  },
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

/** Pill navigation between the data-hub pages (map / links / sources / updates). */
export const DataNav: FC<{ active: DataPage; className?: string }> = ({
  active,
  className,
}) => {
  const { t } = useTranslation();
  return (
    <PillGroup nav label={t("data_title")} className={className}>
      {PAGES.map(({ id, to, labelKey, icon: Icon }) => (
        <PillLink key={id} to={to} selected={id === active}>
          <Icon aria-hidden className="h-3.5 w-3.5" />
          {t(labelKey)}
        </PillLink>
      ))}
    </PillGroup>
  );
};
