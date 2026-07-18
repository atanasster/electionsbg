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
  action?: SectionAction;
}> = ({ id, heading, action }) => (
  <div className="mb-3 flex items-center gap-3 sm:mb-4">
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
);
