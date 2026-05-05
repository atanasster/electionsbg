import { FC } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import {
  DashboardSectionId,
  useArticles,
} from "@/data/articles/useArticles";
import { useElectionContext } from "@/data/ElectionContext";
import { StatCard } from "./StatCard";

type Props = {
  // Topics already surfaced by SectionArticlesStrip on the same page. Articles
  // whose topics are all covered above are hidden here to avoid duplication.
  shownTopics?: readonly DashboardSectionId[];
};

export const ArticlesTile: FC<Props> = ({ shownTopics = [] }) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { selected } = useElectionContext();
  const { data: articles } = useArticles();

  const shown = new Set<DashboardSectionId>(shownTopics);
  const matching = (articles ?? []).filter((a) => {
    if (a.election && a.election !== selected) return false;
    if (!a.topics || a.topics.length === 0) return true;
    return a.topics.some((tp) => !shown.has(tp));
  });
  if (matching.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_articles_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span>{t("dashboard_articles")}</span>
            </div>
          </Hint>
        </div>
      }
    >
      <ul className="mt-1 space-y-2">
        {matching.slice(0, 3).map((a) => (
          <li key={a.slug}>
            <Link
              to={`/articles/${a.slug}`}
              className="text-sm font-medium text-foreground hover:underline"
              underline={false}
            >
              {a.title[lang]}
            </Link>
            <div className="text-xs text-muted-foreground mt-0.5">
              {a.publishedAt} · {a.summary[lang]}
            </div>
          </li>
        ))}
      </ul>
    </StatCard>
  );
};
