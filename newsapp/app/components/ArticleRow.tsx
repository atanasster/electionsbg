// One article row in a feed or story member list: outlet, headline, time,
// lean/stance/AI badges, internal analysis page + external link-out.

import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
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
}) => {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b py-2.5 last:border-b-0">
      <Link
        to={`/outlet/${domain}`}
        className="shrink-0 text-sm font-semibold hover:text-primary"
      >
        {outletName ?? domain}
      </Link>
      <span className="text-muted-foreground">·</span>
      <time
        className="shrink-0 text-xs text-muted-foreground"
        dateTime={published ?? undefined}
      >
        {relativeTime(published)}
      </time>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {articleId ? (
          <Link
            to={`/article/${domain}/${articleId}`}
            className="text-sm leading-snug hover:text-primary"
          >
            {title ?? "(без заглавие)"}
          </Link>
        ) : url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm leading-snug hover:text-primary"
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
          {url && articleId ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              title={`Прочети в ${outletName ?? domain}`}
              aria-label={`Прочети оригинала „${title ?? "без заглавие"}" в ${outletName ?? domain} (отваря се в нов раздел)`}
              className="text-muted-foreground hover:text-primary"
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
};

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
  />
);
