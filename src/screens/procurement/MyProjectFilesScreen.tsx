// /procurement/projects — "Моите досиета": the localStorage-saved project files
// (§4.3b). Each links back to /procurement/project?q=<spec>; delete removes it.
// v1 is per-browser (the shareable ?q= link is the real backup).

import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import {
  listProjects,
  deleteProject,
  projectHref,
} from "@/data/procurement/projectStore";

export const MyProjectFilesScreen = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  // Read once on mount; refresh explicitly after a delete.
  const [visible, setVisible] = useState(listProjects);

  return (
    <ArticleLayout
      title={bg ? "Моите досиета" : "My project files"}
      description={
        bg
          ? "Проектните досиета, запазени в този браузър."
          : "The project files saved in this browser."
      }
      breadcrumb={{
        to: "/procurement",
        label: bg ? "Обществени поръчки" : "Public procurement",
      }}
      seoType="website"
    >
      <p className="text-xs text-muted-foreground mb-4">
        {bg
          ? "Запазено локално в този браузър. Използвай „Копирай връзка“ за резервно копие."
          : "Saved locally in this browser. Use “Copy link” for a backup."}
      </p>
      {visible.length === 0 ? (
        <p className="text-muted-foreground">
          {bg ? "Още няма запазени досиета." : "No saved files yet."}{" "}
          <Link to="/procurement/project" className="text-primary">
            {bg ? "Създай досие →" : "Create one →"}
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((p) => {
            const label =
              (bg ? p.spec.title?.bg : p.spec.title?.en) ??
              p.spec.title?.bg ??
              p.spec.search?.[0]?.terms ??
              p.id;
            return (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
              >
                <Link
                  to={projectHref(p.spec)}
                  className="text-sm flex-1 text-primary"
                >
                  {label}
                </Link>
                <button
                  className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    deleteProject(p.id);
                    setVisible(listProjects());
                  }}
                >
                  {bg ? "изтрий" : "delete"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ArticleLayout>
  );
};
