// Topic chips, with each half linking to the main-site page it names.
//
// ⚠️ A TOPIC IS TWO DESTINATIONS, NOT ONE. „Лица и длъжностни лица ·
// Декларации и конфликти на интереси" is the persons browser and the
// declarations register — two separate pages — so one link over the joined
// string would send a reader who clicked the second half to the first. The
// halves are rendered as separate anchors inside one chip, with the „·" a
// plain separator that belongs to neither.
//
// ⚠️ A HALF IS A LINK ONLY WHERE THE TAXONOMY DECLARES A ROUTE, and most
// subcategories declare none — a refusal rather than a gap, since a chip
// pointing at an adjacent page is worse than plain text. Every declared
// route is checked against src/routes.tsx by news/scripts/test_topic_routes.py,
// because a route renamed in the other half of the repo would otherwise leave
// this committed taxonomy green while the chip 404s.
//
// ⚠️ CROSS-ORIGIN, so plain <a> and absolute hrefs — react-router's <Link>
// would try to route them inside this app. Same rule as EntityChips.

import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { topicParts } from "../labels";
import type { TaxonomyCategory } from "../data";

export const TopicChips = ({
  categories,
  topics,
  inline = false,
}: {
  categories: TaxonomyCategory[] | null;
  topics: { category: string; subcategory: string | null }[];
  /** No wrapper — the caller already has a badge row of its own. */
  inline?: boolean;
}) => {
  if (!topics.length) return null;
  const Wrapper = inline ? Fragment : "div";
  return (
    <Wrapper {...(inline ? {} : { className: "flex flex-wrap gap-1.5" })}>
      {topics.map((t) => {
        const parts = topicParts(categories, t.category, t.subcategory);
        const key = `${t.category}/${t.subcategory}`;
        if (!parts.length) {
          return (
            <Badge key={key} variant="secondary" className="font-normal">
              {t.category}
            </Badge>
          );
        }
        return (
          <Badge key={key} variant="secondary" className="font-normal">
            {parts.map((p, i) => (
              <span key={p.label}>
                {i > 0 ? (
                  <span aria-hidden className="mx-1 text-muted-foreground">
                    ·
                  </span>
                ) : null}
                {p.href ? (
                  <a
                    href={p.href}
                    rel="noreferrer"
                    title={`${p.label} в electionsbg.com`}
                    className="underline decoration-dotted underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {p.label}
                  </a>
                ) : (
                  p.label
                )}
              </span>
            ))}
          </Badge>
        );
      })}
    </Wrapper>
  );
};
