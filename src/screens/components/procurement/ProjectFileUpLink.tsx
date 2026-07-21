// "Part of a project file" up-link (§10 Phase 3) — on a contract/tender detail
// page, surface any curated flagship dossier that includes this member, via the
// precomputed members.json reverse index. Renders nothing when the member is in
// no curated file. Bilingual-inline, matching the feature convention.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { useProjectMemberFiles } from "@/data/procurement/useProjectFile";

export const ProjectFileUpLink: FC<{ id: string | undefined }> = ({ id }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const files = useProjectMemberFiles(id);
  if (files.length === 0) return null;
  return (
    <div className="pt-1 text-sm">
      <span className="inline-flex flex-wrap items-center gap-1.5 text-muted-foreground">
        <FolderOpen className="h-4 w-4 text-primary" />
        {bg ? "Част от досие:" : "Part of a project file:"}
        {files.map((f, i) => (
          <span key={f.slug}>
            {i > 0 && ", "}
            <Link
              to={`/procurement/project/${f.slug}`}
              className="text-primary hover:underline"
            >
              {(bg ? f.title.bg : f.title.en) ?? f.title.bg ?? f.title.en}
            </Link>
          </span>
        ))}
      </span>
    </div>
  );
};
