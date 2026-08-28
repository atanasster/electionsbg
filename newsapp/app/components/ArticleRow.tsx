// One article row in a feed or story member list: outlet, headline, time,
// lean/stance/AI badges, internal analysis page + external link-out.

import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "../labels";
import type {
  AiVerdict,
  ArticleRecord,
  Leaning,
  QualityVerdict,
  RussiaStance,
  StoryMember,
} from "../data";
import { AiBadge, LeanBadge, QualityBadge, StanceBadge } from "./Badges";

export const ArticleRow = ({
  title,
  domain,
  published,
  url,
  articleId,
  leaning,
  russiaStance,
  aiVerdict,
  quality,
  storyId,
  outletName,
  sourceLayout = false,
}: {
  title: string | null;
  domain: string;
  published: string | null;
  url: string | null;
  articleId: string | null;
  leaning?: Leaning | null;
  russiaStance?: RussiaStance | null;
  aiVerdict?: AiVerdict | null;
  quality?: QualityVerdict | null;
  storyId?: string | null;
  outletName?: string;
  sourceLayout?: boolean;
}) => {
  return (
    <div
      className={cn(
        "border-b last:border-b-0",
        sourceLayout
          ? "news-source-row"
          : "flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5",
      )}
    >
      <div
        className={cn(
          "news-source-meta",
          sourceLayout ? "flex min-w-0 items-baseline gap-1.5" : "contents",
        )}
      >
        <Link
          to={`/outlet/${domain}`}
          className={cn(
            "min-w-0 truncate text-sm font-semibold hover:text-primary",
            sourceLayout ? "flex-1" : "shrink-0",
          )}
        >
          {outletName ?? domain}
        </Link>
        <span className="text-muted-foreground" aria-hidden>
          ·
        </span>
        <time
          className="shrink-0 text-xs text-muted-foreground"
          dateTime={published ?? undefined}
        >
          {relativeTime(published)}
        </time>
      </div>
      <div
        className={cn(
          "news-source-content flex min-w-0 flex-1 flex-col",
          sourceLayout ? "gap-2" : "gap-1",
        )}
      >
        {articleId ? (
          <Link
            to={`/article/${domain}/${articleId}`}
            className={cn(
              "leading-snug underline-offset-4 hover:text-primary hover:underline",
              sourceLayout ? "font-medium" : "text-sm",
            )}
          >
            {title ?? "(без заглавие)"}
          </Link>
        ) : url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              "leading-snug underline-offset-4 hover:text-primary hover:underline",
              sourceLayout ? "font-medium" : "text-sm",
            )}
            aria-label={`${title ?? "Без заглавие"} — прочети оригинала в ${outletName ?? domain} (отваря се в нов раздел)`}
          >
            {title ?? "(без заглавие)"}
          </a>
        ) : (
          <span className="text-sm">{title ?? "(без заглавие)"}</span>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <LeanBadge leaning={leaning} />
          <StanceBadge stance={russiaStance} />
          <AiBadge verdict={aiVerdict} />
          <QualityBadge verdict={quality} />
          {storyId ? (
            <Link
              to={`/story/${storyId}`}
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              история →
            </Link>
          ) : null}
          {!sourceLayout && url && articleId ? (
            <OriginalLink
              url={url}
              title={title}
              outlet={outletName ?? domain}
            />
          ) : null}
        </div>
      </div>
      {sourceLayout && url && articleId ? (
        <div className="news-source-action">
          <OriginalLink url={url} title={title} outlet={outletName ?? domain} />
        </div>
      ) : null}
    </div>
  );
};

const OriginalLink = ({
  url,
  title,
  outlet,
}: {
  url: string;
  title: string | null;
  outlet: string;
}) => (
  <a
    href={url}
    target="_blank"
    rel="noreferrer noopener"
    title={`Прочети в ${outlet}`}
    aria-label={`Прочети оригинала „${title ?? "без заглавие"}" в ${outlet} (отваря се в нов раздел)`}
    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <ExternalLink className="size-4" aria-hidden />
  </a>
);

// Adapter for compact article records (latest feed, outlet pages).
export const ArticleRecordRow = ({
  article,
  outletName,
}: {
  article: ArticleRecord;
  outletName?: string;
}) => (
  <ArticleRow
    title={article.title}
    domain={article.domain}
    published={article.published}
    url={article.url}
    articleId={article.id}
    outletName={outletName}
    leaning={article.analysis?.leaning?.label ?? null}
    russiaStance={article.analysis?.russia_stance?.label ?? null}
    aiVerdict={article.analysis?.ai_generated?.verdict ?? null}
    quality={article.analysis?.quality?.verdict ?? null}
    storyId={article.story_id ?? null}
  />
);

// Adapter for story members — the lean/stance labels ride on the member
// itself; AI + quality verdicts are not part of the member shape, so member
// rows render without those two badges by design.
export const StoryMemberRow = ({
  member,
  outletName,
}: {
  member: StoryMember;
  outletName?: string;
}) => (
  <ArticleRow
    title={member.title}
    domain={member.domain}
    published={member.published}
    url={member.url}
    articleId={member.article_id}
    outletName={outletName}
    leaning={member.leaning}
    russiaStance={member.russia_stance}
    sourceLayout
  />
);
