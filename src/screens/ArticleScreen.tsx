import { FC } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SEO } from "@/ux/SEO";
import { useArticles, useArticleBody } from "@/data/articles/useArticles";
import { usePreserveParams } from "@/ux/usePreserveParams";

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

  // Strip the leading H1 from the markdown — the page renders its own header
  // block, so we don't want a duplicate top-of-page heading.
  const bodyWithoutH1 = body ? body.replace(/^\s*#\s.+\n+/, "") : body;

  const formattedDate = meta?.publishedAt
    ? new Date(meta.publishedAt).toLocaleDateString(
        lang === "bg" ? "bg-BG" : "en-GB",
        { year: "numeric", month: "long", day: "numeric" },
      )
    : null;

  return (
    <>
      <SEO title={title} description={description} type="article" />
      <article className="mx-auto w-full max-w-5xl px-4 md:px-8 py-6 md:py-10">
        <RouterLink
          to="/articles"
          className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t("articles_title")}
        </RouterLink>

        {isLoading ? (
          <div className="mt-8 text-sm text-muted-foreground">
            {t("loading")}
          </div>
        ) : isError || !bodyWithoutH1 ? (
          <div className="mt-8 text-sm text-muted-foreground">
            {t("articles_not_found")}
          </div>
        ) : (
          <>
            <header className="mt-4 mb-8 border-b border-border/60 pb-6">
              {formattedDate ? (
                <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {formattedDate}
                </div>
              ) : null}
              <h1 className="mt-2 text-2xl md:text-3xl font-extrabold leading-tight tracking-tight text-foreground">
                {title}
              </h1>
              {description ? (
                <p className="mt-3 text-base md:text-lg leading-relaxed text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </header>

            <div className="prose-article">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children, ...rest }) => {
                    if (
                      href &&
                      href.startsWith("/") &&
                      !href.startsWith("//")
                    ) {
                      const [pathname, search = ""] = href.split("?");
                      const incoming = new URLSearchParams(search);
                      const merged = searchParams(
                        Object.fromEntries(incoming.entries()),
                      );
                      const finalSearch = merged.toString();
                      return (
                        <RouterLink
                          to={
                            finalSearch
                              ? `${pathname}?${finalSearch}`
                              : pathname
                          }
                          className="text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary"
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
                        className="text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary"
                        {...rest}
                      >
                        {children}
                      </a>
                    );
                  },
                  h2: ({ children }) => (
                    <h2 className="mt-10 mb-3 text-xl md:text-2xl font-bold tracking-tight text-foreground border-b border-border/40 pb-2">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="mt-6 mb-2 text-base md:text-lg font-semibold text-foreground">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p className="my-4 text-[15px] md:text-base leading-7 text-foreground/90">
                      {children}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul className="my-4 space-y-2 list-disc pl-6 marker:text-muted-foreground">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="my-4 space-y-2 list-decimal pl-6 marker:text-muted-foreground">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li className="text-[15px] md:text-base leading-7 text-foreground/90">
                      {children}
                    </li>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-foreground">
                      {children}
                    </strong>
                  ),
                  code: ({ children }) => (
                    <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[0.85em] text-secondary-foreground">
                      {children}
                    </code>
                  ),
                  hr: () => <hr className="my-10 border-border/60" />,
                  table: ({ children }) => (
                    <div className="my-6 overflow-x-auto rounded-lg border border-border">
                      <table className="w-full border-collapse text-sm">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-secondary/60">{children}</thead>
                  ),
                  th: ({ children }) => (
                    <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border-b border-border/40 px-3 py-2 align-top text-[14px] text-foreground/90">
                      {children}
                    </td>
                  ),
                  tr: ({ children }) => (
                    <tr className="even:bg-muted/30">{children}</tr>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="my-4 border-l-4 border-primary/40 pl-4 italic text-muted-foreground">
                      {children}
                    </blockquote>
                  ),
                }}
              >
                {bodyWithoutH1}
              </Markdown>
            </div>
          </>
        )}
      </article>
    </>
  );
};
