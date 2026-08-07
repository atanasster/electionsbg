// SectionHeading — the uppercase label + hairline rule that tops each hub
// section, with an optional trailing "see all →" action link. Shared by
// TileHubGrid (per-section headers) and FeaturedStrip so the markup lives in
// one place.

import { FC } from "react";
import { Link } from "react-router-dom";

export interface SectionAction {
  to: string;
  label: string;
}

export const SectionHeading: FC<{
  /** id for aria-labelledby wiring (TileHubGrid links its <section> to it). */
  id?: string;
  heading: string;
  /** One line saying what the band contains. A heading is a label; this is the
   *  sentence that makes it a table of contents — „В залата" tells a reader where they
   *  are, not what they will find under it. Optional, because a band whose heading is
   *  already a full statement does not need one. */
  description?: string;
  action?: SectionAction;
}> = ({ id, heading, description, action }) => (
  <div className="mb-3 sm:mb-4">
    <div className="flex items-center gap-3">
      <h2
        id={id}
        className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
      >
        {heading}
      </h2>
      <span
        aria-hidden
        className="h-px flex-1 bg-gradient-to-r from-border to-transparent"
      />
      {action ? (
        <Link
          to={action.to}
          className="whitespace-nowrap text-xs font-semibold text-primary hover:underline"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
    {description ? (
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        {description}
      </p>
    ) : null}
  </div>
);
