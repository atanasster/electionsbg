import { FC } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { Link } from "@/ux/Link";
import {
  DashboardSectionId,
  useArticles,
} from "@/data/articles/useArticles";
import { useElectionContext } from "@/data/ElectionContext";
import { useArticlesForTopic } from "./SectionArticlesContext";

type Props = {
  topic: DashboardSectionId;
};

export const SectionArticlesStrip: FC<Props> = ({ topic }) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { selected } = useElectionContext();
  const { data: articles } = useArticles();
  const assigned = useArticlesForTopic(topic);

  const matching =
    assigned ??
    (articles ?? []).filter((a) => {
      if (!a.topics?.includes(topic)) return false;
      if (a.election && a.election !== selected) return false;
      return true;
    });

  if (matching.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />
        <span>{t("dashboard_section_related_articles")}</span>
      </div>
      <ul className="space-y-1.5">
        {matching.slice(0, 3).map((a) => (
          <li key={a.slug}>
            <Link
              to={`/articles/${a.slug}`}
              className="text-sm font-medium text-foreground hover:underline"
              underline={false}
            >
              {a.title[lang]}
            </Link>
            <div className="text-xs text-muted-foreground">
              {a.publishedAt}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
