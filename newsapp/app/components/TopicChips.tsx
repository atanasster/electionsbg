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
import { useNewsLocale } from "../i18n";

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
  const { language, tr } = useNewsLocale();
  if (!topics.length) return null;
  const Wrapper = inline ? Fragment : "div";
  return (
    <Wrapper
      {...(inline
        ? {}
        : // ⚠️ `items-start`, so a truncated chip does not stretch to the
          // height of its neighbours, and `min-w-0` on the children is what
          // lets `truncate` actually clip inside a flex row.
          { className: "flex flex-wrap items-start gap-1.5" })}
    >
      {topics.map((t) => {
        const parts = topicParts(
          categories,
          t.category,
          t.subcategory,
          language,
        );
        const key = `${t.category}/${t.subcategory}`;
        if (!parts.length) {
          return (
            <Badge key={key} variant="secondary" className="font-normal">
              {t.category}
            </Badge>
          );
        }
        // ⚠️ ONE PART PER CHIP, not two halves inside one. Bulgarian topic
        // labels are long — „Декларации и конфликти на интереси" beside
        // „Лица и длъжностни лица" wrapped to three ragged lines inside a
        // single pill in a 380px sidebar. Split, each chip truncates on its
        // own line and the full text stays reachable through `title`.
        return parts.map((p) => {
          const inner = (
            <Badge
              variant="secondary"
              className={`block max-w-full truncate font-normal${
                p.href
                  ? " underline decoration-dotted underline-offset-2 hover:bg-primary/10 hover:text-primary"
                  : ""
              }`}
            >
              {p.label}
            </Badge>
          );
          return p.href ? (
            <a
              key={`${key}/${p.label}`}
              href={p.href}
              rel="noreferrer"
              // ⚠️ The full label, because the chip may be truncated — a
              // reader who cannot see the whole topic can still read it.
              title={`${p.label} — ${tr("в", "on")} electionsbg.com`}
              className="block max-w-full rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {inner}
            </a>
          ) : (
            <span
              key={`${key}/${p.label}`}
              title={p.label}
              className="block max-w-full"
            >
              {inner}
            </span>
          );
        });
      })}
    </Wrapper>
  );
};
