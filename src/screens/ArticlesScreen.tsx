import { FC } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { Link } from "@/ux/Link";
import { useArticles } from "@/data/articles/useArticles";

export const ArticlesScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: articles, isLoading } = useArticles();

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  return (
    <>
      <SEO
        title={t("articles_title")}
        description={t("articles_meta_description")}
      />
      <div className="mx-auto w-full max-w-5xl px-4 md:px-8 py-6 md:py-10">
        <header className="mb-8 border-b border-border/60 pb-6">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            {t("articles_title")}
          </div>
          <h1 className="mt-2 text-2xl md:text-3xl font-extrabold leading-tight tracking-tight text-foreground">
            {t("articles_title")}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {t("articles_meta_description")}
          </p>
        </header>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("loading")}</div>
        ) : !articles || articles.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("articles_empty")}
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {articles.map((a) => (
              <li key={a.slug} className="py-5 first:pt-0">
                <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {formatDate(a.publishedAt)}
                </div>
                <Link
                  to={`/articles/${a.slug}`}
                  className="mt-1 block text-lg md:text-xl font-bold leading-snug text-foreground hover:text-primary"
                  underline={false}
                >
                  {a.title[lang]}
                </Link>
                <p className="mt-2 text-sm md:text-[15px] leading-relaxed text-muted-foreground">
                  {a.summary[lang]}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
};
