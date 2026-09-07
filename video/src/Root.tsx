import React from "react";
import { Composition } from "remotion";
import { e1 } from "./specs/e1-inflation";
import { e2 } from "./specs/e2-risk";
import { e3 } from "./specs/e3-money-map";
import { v3 } from "./specs/v3-real-screen";
import { ExplainerVideo } from "./compositions/ExplainerVideo";
import { FlyoverReel } from "./compositions/FlyoverReel";
import {
  calculateExplainerMetadata,
  type ExplainerProps,
} from "./compositions/explainerMetadata";
import {
  calculateFlyoverReelMetadata,
  MONEY_MAP_REEL_EDITS,
  type FlyoverReelProps,
} from "./compositions/flyoverReelMetadata";

/**
 * The 16:9 explainer is the format (decided 2026-08-08). The portrait shorts that
 * preceded it — and their `Frame`/Stat/Bars/Outro/Map scenes — were removed once
 * the explainer proved out; a short is now a CUTDOWN re-cut from explainer scenes
 * rather than its own production. Git history has them if one is ever wanted back.
 *
 * `durationInFrames` here is a placeholder; `calculateMetadata` replaces it with
 * the real length measured from the narration.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
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
      {/* E2 — long-form (~10 min). `durationInFrames` here is a placeholder like
          the others; calculateMetadata measures the real length from 59 clips. */}
      <Composition
        id={`${e2.slug}--yt`}
        component={ExplainerVideo}
        durationInFrames={18600}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={
          { spec: e2, sceneDurations: [], captions: false } as ExplainerProps
        }
        calculateMetadata={calculateExplainerMetadata}
      />
      {/* E3 — the shared home/article flyover, timed by its narration. */}
      <Composition
        id={`${e3.slug}--yt`}
        component={ExplainerVideo}
        durationInFrames={3600}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={
          { spec: e3, sceneDurations: [], captions: false } as ExplainerProps
        }
        calculateMetadata={calculateExplainerMetadata}
      />
      {/* The plan's social cut: a portrait re-layout of explainer scenes 1, 2, 4. */}
      <Composition
        id={`${e3.slug}--reel`}
        component={FlyoverReel}
        durationInFrames={2100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={
          {
            spec: e3,
            edits: MONEY_MAP_REEL_EDITS,
            sceneDurations: [],
            captions: true,
          } as FlyoverReelProps
        }
        calculateMetadata={calculateFlyoverReelMetadata}
      />
      {/* V3 — the real-screen treatment, for comparison against E1's canvas. */}
      <Composition
        id={`${v3.slug}--yt`}
        component={ExplainerVideo}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={
          { spec: v3, sceneDurations: [], captions: false } as ExplainerProps
        }
        calculateMetadata={calculateExplainerMetadata}
      />
    </>
  );
};
