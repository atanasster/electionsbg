import { FC } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { useArticles } from "@/data/articles/useArticles";
import { useElectionContext } from "@/data/ElectionContext";
import { StatCard } from "./StatCard";

export const ArticlesTile: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { selected } = useElectionContext();
  const { data: articles } = useArticles();

  // Show only articles tied to the selected election. Cycles without a
  // matching article hide the tile entirely (no empty card).
  const matching = articles?.filter((a) => a.election === selected) ?? [];
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
