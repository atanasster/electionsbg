// The "Проследи като досие" on-ramp link (§4.3b) — shared by the contract and
// tender detail headers so the label, icon and styling live in one place. The
// caller builds the seeded href (projectHref(projectFromContract|Tender(...))).
// Bilingual-inline, matching the rest of the project-file feature (no i18n key).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FolderPlus } from "lucide-react";

export const TrackAsProjectFileLink: FC<{ to: string }> = ({ to }) => {
  const { i18n } = useTranslation();
  return (
    <div className="pt-1">
      <Link
        to={to}
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <FolderPlus className="h-4 w-4" />
        {i18n.language === "bg"
          ? "Проследи като досие"
          : "Track as a project file"}
      </Link>
    </div>
  );
};
