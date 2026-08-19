import { FC, ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SEO } from "@/ux/SEO";
import { formatDateLong } from "@/lib/formatDate";

// Shared shell for long-form pages (analysis articles + documentation).
// Renders the breadcrumb, header (date / title / description / divider),
// and a max-width container; children are the body and should use the
// `proseClasses` strings (or the `<Article*>` primitives) so typography
// matches between markdown-rendered and hand-written pages.
//
// The breadcrumb is always shown — pass `breadcrumb={null}` only if you
// truly don't want one (deep-linked standalone page).

type Breadcrumb = { to: string; label: string };

type Props = {
  title: string;
  description?: string;
  /** When set, rendered in place of the plain `description` string in the
   * visible lede (e.g. with inline links). `description` is still used for the
   * SEO meta description, so keep it as clean prose. */
  descriptionNode?: ReactNode;
  /** ISO 8601 string. When set, formatted into the locale-aware long form
   * shown above the title. Optional — documentation pages usually omit it. */
  date?: string;
  /** Byline shown next to the date (e.g. "Claude Opus 4.7"). */
  author?: string;
  /** Breadcrumb back-link, e.g. `{ to: "/articles", label: t("articles_title") }`.
   * Pass `null` to hide. */
  breadcrumb: Breadcrumb | null;
  /** When `true`, the page title is also injected into <head> via SEO and the
   * page is marked as `type="article"` (default `true` matches articles). */
  seo?: boolean;
  /** "article" or "website" — drives og:type. Defaults to "article". */
  seoType?: "article" | "website";
  children: ReactNode;
};

export const ArticleLayout: FC<Props> = ({
  title,
  description,
  descriptionNode,
  date,
  author,
  breadcrumb,
  seo = true,
  seoType = "article",
  children,
}) => {
  const { i18n } = useTranslation();
  // formatDateLong, never a bare `new Date(date).toLocaleDateString(...)`: `publishedAt` is a
  // calendar DAY ("2026-08-17"), which parses as UTC midnight, so formatting it in the
  // viewer's zone printed the day BEFORE for every reader west of Greenwich — the byline read
  // "16 АВГУСТ 2026 Г." while the article feed on the same page said 17. Bulgarian readers
  // (UTC+3) never saw it. The helper pins UTC for the date-only shape only, so a caller that
  // passes a real instant still renders in the reader's own zone.
  const formattedDate = date ? formatDateLong(date, i18n.language) : null;
  return (
    <>
      {seo ? (
        <SEO title={title} description={description ?? ""} type={seoType} />
      ) : null}
      <article className="mx-auto w-full max-w-5xl px-4 md:px-8 py-6 md:py-10">
        {breadcrumb ? (
          <RouterLink
            to={breadcrumb.to}
            className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {breadcrumb.label}
          </RouterLink>
        ) : null}
        <header className="mt-4 mb-8 border-b border-border/60 pb-6">
          {formattedDate || author ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {formattedDate ? <span>{formattedDate}</span> : null}
              {formattedDate && author ? <span aria-hidden>·</span> : null}
              {author ? <span>{author}</span> : null}
            </div>
          ) : null}
          <h1 className="mt-2 text-2xl md:text-3xl font-extrabold leading-tight tracking-tight text-foreground">
            {title}
          </h1>
          {(descriptionNode ?? description) ? (
            <p className="mt-3 text-base md:text-lg leading-relaxed text-muted-foreground">
              {descriptionNode ?? description}
            </p>
          ) : null}
        </header>
        {children}
      </article>
    </>
  );
};
