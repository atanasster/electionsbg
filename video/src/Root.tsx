import React from "react";
import { Composition } from "remotion";
import {
  ShortVideo,
  calculateShortMetadata,
  type ShortProps,
} from "./compositions/ShortVideo";
import { t1 } from "./specs/t1-cost-per-vote";

/**
 * One composition per (spec × aspect). The aspects are NOT interchangeable
 * placements: Reels/Shorts are 9:16, the Facebook feed is 1:1 or 4:5 — a 9:16
 * posted to feed is letterboxed and reads as a repost — and YouTube is 16:9.
 * Scenes are authored against a 1080-wide base and scaled, so all three come from
 * the same components rather than a second layout.
 *
 * `durationInFrames` here is a placeholder; `calculateMetadata` replaces it with
 * the real length measured from the narration.
 */
export const RemotionRoot: React.FC = () => {
  const specs = [t1];

  return (
    <>
      {specs.flatMap((spec) => [
        <Composition
          key={`${spec.slug}-reel`}
          id={`${spec.slug}--reel`}
          component={ShortVideo}
          durationInFrames={900}
          fps={30}
          width={1080}
          height={1920}
          defaultProps={{ spec, sceneDurations: [] } as ShortProps}
          calculateMetadata={calculateShortMetadata}
        />,
        <Composition
          key={`${spec.slug}-feed`}
          id={`${spec.slug}--feed`}
          component={ShortVideo}
          durationInFrames={900}
          fps={30}
          width={1080}
          height={1350}
          defaultProps={{ spec, sceneDurations: [] } as ShortProps}
          calculateMetadata={calculateShortMetadata}
        />,
      ])}
    </>
  );
};
