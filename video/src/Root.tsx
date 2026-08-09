import React from "react";
import { Composition } from "remotion";
import {
  ShortVideo,
  calculateShortMetadata,
  type ShortProps,
} from "./compositions/ShortVideo";
import { t1 } from "./specs/t1-cost-per-vote";
import { t2 } from "./specs/t2-changed-winner";
import { t3 } from "./specs/t3-inflation-rank";
import { e1 } from "./specs/e1-inflation";
import {
  ExplainerVideo,
  calculateExplainerMetadata,
  type ExplainerProps,
} from "./compositions/ExplainerVideo";

/**
 * One composition per (spec × aspect). The two are NOT interchangeable placements:
 * Reels/Shorts are 9:16 and the Facebook feed is 4:5 — a 9:16 posted to feed is
 * letterboxed and reads as a repost. Both come from the same components: scenes
 * are authored against a 1080-wide base and multiplied by `scale(width)`, and the
 * taller-than-it-fits scenes compress their vertical rhythm.
 *
 * There is deliberately no 16:9 here — see the note at the bottom of the list.
 *
 * `durationInFrames` here is a placeholder; `calculateMetadata` replaces it with
 * the real length measured from the narration.
 */
export const RemotionRoot: React.FC = () => {
  const specs = [t1, t2, t3];

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
          defaultProps={
            { spec, sceneDurations: [], captions: true } as ShortProps
          }
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
          defaultProps={
            { spec, sceneDurations: [], captions: true } as ShortProps
          }
          calculateMetadata={calculateShortMetadata}
        />,
        // A 1920x1080 cut was declared here and REMOVED after rendering it —
        // shipping it broken would have been worse than not shipping it.
        //
        // Landscape is not a rescale of portrait. `scale()` is width-derived, so
        // at 1920 wide every element renders 1.78x larger inside a frame that is
        // 840px SHORTER, and six bars overflowed the composition entirely. The
        // vertical-fit factor cannot rescue it: it compresses spacing only, and at
        // 16:9 the TYPE alone exceeds the height. Shrinking type below the ~84/44px
        // floor is precisely the trade that floor exists to prevent.
        //
        // The fix is a landscape LAYOUT — wider bars, fewer rows, or two columns —
        // that spends the extra width instead of fighting it. That belongs with the
        // `explainer` format in phase 4, not smuggled into the shorts.
      ])}
      {/* 16:9 explainer — its OWN layout, not a rescale of the shorts. */}
      <Composition
        id={`${e1.slug}--yt`}
        component={ExplainerVideo}
        durationInFrames={2700}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={
          { spec: e1, sceneDurations: [], captions: false } as ExplainerProps
        }
        calculateMetadata={calculateExplainerMetadata}
      />
    </>
  );
};
