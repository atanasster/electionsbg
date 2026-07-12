// TileHubGrid — a "hub" page body: thematic sections, each a real <h2> heading
// with a hairline rule over a responsive grid of InfographicTiles. Pure layout;
// the caller passes localized headings + tile props. Used by the Държавни сектори
// hub and reusable for any other dashboard that fronts a set of destinations.

import { FC } from "react";
import { InfographicTile, InfographicTileProps } from "./InfographicTile";

export interface TileHubSection {
  /** Section heading, already localized — rendered as an <h2> landmark. */
  heading: string;
  tiles: InfographicTileProps[];
}

export const TileHubGrid: FC<{
  sections: TileHubSection[];
  className?: string;
}> = ({ sections, className }) => (
  <div className={className}>
    <div className="flex flex-col gap-7 sm:gap-10">
      {sections.map((section, i) => {
        const headingId = `tilehub-section-${i}`;
        return (
          <section key={headingId} aria-labelledby={headingId}>
            <div className="mb-3 flex items-center gap-3 sm:mb-4">
              <h2
                id={headingId}
                className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                {section.heading}
              </h2>
              <span
                aria-hidden
                className="h-px flex-1 bg-gradient-to-r from-border to-transparent"
              />
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {section.tiles.map((tile) => (
                <InfographicTile key={tile.to} {...tile} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  </div>
);
