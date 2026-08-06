// NewsRail — a heading over a row of NewsCards. Reuses SectionHeading so a rail and a tile
// band sit under typographically identical headings on the same page.
//
// A rail with no items renders NOTHING, rather than an empty row or a "no items" box. The
// rail is one of several bands on a hub; a parliament that has no dissents to show should
// lose the rail, not gain a box explaining its absence. The PAGE's empty state is a
// different thing and belongs to the page.

import { FC } from "react";
import { SectionHeading, SectionAction } from "@/ux/infographic/SectionHeading";
import { NewsCard, NewsCardProps } from "./NewsCard";

export const NewsRail: FC<{
  heading: string;
  action?: SectionAction;
  /** `id` is required rather than derived from `to`: two cards in one rail can legitimately
   *  share a destination (two MPs' dissents both link to the same sitting), and a duplicate
   *  React key silently drops one of them. */
  items: (NewsCardProps & { id: string })[];
  className?: string;
}> = ({ heading, action, items, className }) => {
  if (items.length === 0) return null;
  return (
    <section className={className} aria-label={heading}>
      <SectionHeading heading={heading} action={action} />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
        {items.map(({ id, ...card }) => (
          <NewsCard key={id} {...card} />
        ))}
      </div>
    </section>
  );
};
