// An article as a CARD — photo, credit, badges, headline, excerpt.
//
// The row form (ArticleRow) is the dense reading order; this is the grid form,
// and the difference that matters is the image: a card without one is a row
// with wasted space, and a card with one has to answer for whose photo it is.
// ArticleImage handles both — the credit is not optional there.
//
// ⚠️ An UNANALYSED article renders here too, marked, with no badges. At 8.4%
// analysed that state is the common one, and hiding it would make the corpus
// look complete. Its absence of badges must read as "not yet judged", never
// as "judged neutral" — which is why there is no neutral-looking placeholder.

import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "../labels";
import type { ArticleRecord, Outlet } from "../data";
import { AiBadge, LeanBadge, StanceBadge } from "./Badges";
import { ArticleImage } from "./ArticleImage";

export const ArticleCard = ({
  article,
  outlet,
}: {
  article: ArticleRecord;
  /** Undefined for a domain with no registry row — the monogram covers it. */
  outlet?: Outlet;
}) => {
  const name = outlet?.outlet ?? article.domain;
  const analysis = article.analysis;
  const href = `/article/${article.domain}/${article.id}`;

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <ArticleImage
        image={article.image}
        imageAlt={article.image_alt}
        title={article.title}
        articleUrl={article.url}
        outlet={
          outlet ?? {
            domain: article.domain,
            outlet: article.domain,
            logo: null,
            hotlink_ok: null,
          }
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
          <Link
            to={`/outlet/${article.domain}`}
            className="font-semibold hover:text-primary"
          >
            {name}
          </Link>
          <time
            className="text-muted-foreground"
            dateTime={article.published ?? undefined}
          >
            {relativeTime(article.published)}
          </time>
        </div>
        <div className="flex flex-wrap gap-1">
          {analysis ? (
            <>
              <LeanBadge leaning={analysis.leaning?.label ?? null} short />
              <StanceBadge
                stance={analysis.russia_stance?.label ?? null}
                short
              />
              <AiBadge verdict={analysis.ai_generated?.verdict ?? null} />
            </>
          ) : (
            <Badge
              variant="outline"
              className="font-normal text-muted-foreground"
            >
              още не е анализирана
            </Badge>
          )}
        </div>
        <Link
          to={href}
          className="font-title text-base leading-snug hover:text-primary"
        >
          {article.title ?? "(без заглавие)"}
        </Link>
        {article.excerpt ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">
            {article.excerpt}
          </p>
        ) : null}
      </div>
    </Card>
  );
};
