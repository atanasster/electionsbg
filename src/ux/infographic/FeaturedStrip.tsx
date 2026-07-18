// FeaturedStrip — a SectionHeading (with an optional "see all →" link) over a
// grid of InfographicTiles, capped at 3 columns for larger, spotlight tiles.
// Used for the "featured sectors / categories" strip on hub landings; the same
// header markup as TileHubGrid, but a wider tile and its own trailing link.

import { FC } from "react";
import { InfographicTile, InfographicTileProps } from "./InfographicTile";
import { SectionHeading, SectionAction } from "./SectionHeading";

export const FeaturedStrip: FC<{
  heading: string;
  action?: SectionAction;
  tiles: InfographicTileProps[];
  className?: string;
}> = ({ heading, action, tiles, className }) => (
  <section className={className} aria-label={heading}>
    <SectionHeading heading={heading} action={action} />
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
      {tiles.map((tile) => (
        <InfographicTile key={tile.to} {...tile} />
      ))}
    </div>
  </section>
);
