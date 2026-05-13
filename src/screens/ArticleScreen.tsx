import { FC } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useArticles, useArticleBody } from "@/data/articles/useArticles";
import { usePreserveParams } from "@/ux/usePreserveParams";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import { proseClasses } from "@/components/article/proseClasses";

export const ArticleScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { slug } = useParams<{ slug: string }>();
  const { data: index } = useArticles();
  const { data: body, isLoading, isError } = useArticleBody(slug, lang);
  const searchParams = usePreserveParams();

  const meta = index?.find((a) => a.slug === slug);
  const title = meta ? meta.title[lang] : (slug ?? "");
  const description = meta ? meta.summary[lang] : "";

  // Strip the leading H1 from the markdown — ArticleLayout renders its own
  // header block so we'd otherwise duplicate the top-of-page heading.
  const bodyWithoutH1 = body ? body.replace(/^\s*#\s.+\n+/, "") : body;

  return (
    <ArticleLayout
      title={title}
      description={description}
      date={meta?.publishedAt}
      author={meta?.author}
      breadcrumb={{ to: "/articles", label: t("articles_title") }}
    >
      {isLoading ? (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      ) : isError || !bodyWithoutH1 ? (
        <div className="text-sm text-muted-foreground">
          {t("articles_not_found")}
        </div>
      ) : (
        <div className="prose-article">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children, ...rest }) => {
                if (href && href.startsWith("/") && !href.startsWith("//")) {
                  const hashIdx = href.indexOf("#");
                  const hash = hashIdx !== -1 ? href.slice(hashIdx) : "";
                  const hrefWithoutHash =
                    hashIdx !== -1 ? href.slice(0, hashIdx) : href;
                  const [pathname, search = ""] = hrefWithoutHash.split("?");
                  const incoming = new URLSearchParams(search);
                  const merged = searchParams(
                    Object.fromEntries(incoming.entries()),
                  );
                  const finalSearch = merged.toString();
                  const base = finalSearch
                    ? `${pathname}?${finalSearch}`
                    : pathname;
                  return (
                    <RouterLink
                      to={hash ? `${base}${hash}` : base}
                      className={proseClasses.a}
                    >
                      {children}
                    </RouterLink>
                  );
                }
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className={proseClasses.a}
                    {...rest}
                  >
                    {children}
                  </a>
                );
              },
              h2: ({ children }) => (
                <h2 className={proseClasses.h2}>{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className={proseClasses.h3}>{children}</h3>
              ),
              p: ({ children }) => <p className={proseClasses.p}>{children}</p>,
              ul: ({ children }) => (
                <ul className={proseClasses.ul}>{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className={proseClasses.ol}>{children}</ol>
              ),
              li: ({ children }) => (
                <li className={proseClasses.li}>{children}</li>
              ),
              strong: ({ children }) => (
                <strong className={proseClasses.strong}>{children}</strong>
              ),
              code: ({ children }) => (
                <code className={proseClasses.code}>{children}</code>
              ),
              hr: () => <hr className={proseClasses.hr} />,
              table: ({ children }) => (
                <div className={proseClasses.tableWrap}>
                  <table className={proseClasses.table}>{children}</table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className={proseClasses.thead}>{children}</thead>
              ),
              th: ({ children }) => (
                <th className={proseClasses.th}>{children}</th>
              ),
              td: ({ children }) => (
                <td className={proseClasses.td}>{children}</td>
              ),
              tr: ({ children }) => (
                <tr className={proseClasses.tr}>{children}</tr>
              ),
              blockquote: ({ children }) => (
                <blockquote className={proseClasses.blockquote}>
                  {children}
                </blockquote>
              ),
              img: ({ src, alt }) => (
                <img
                  src={src}
                  alt={alt ?? ""}
                  loading="lazy"
                  decoding="async"
                  className={proseClasses.img}
                />
              ),
            }}
          >
            {bodyWithoutH1}
          </Markdown>
        </div>
      )}
    </ArticleLayout>
  );
};
