import { staticFile, type CalculateMetadataFunction } from "remotion";
import { audioPath, type ExplainerSpec } from "../lib/spec";
import { EXPLAINER_TAIL_SECONDS, sceneFrames } from "../lib/audio";
import type { CanvasState } from "../lib/canvasState";
import type { RiskCanvasState } from "../lib/riskCanvasState";

/**
 * The composition's props and the length measurement that fills them in.
 *
 * Split out of <ExplainerVideo> so that file exports components only — Fast
 * Refresh drops a module's state on every edit when a component sits next to a
 * plain function export, which in a Remotion Studio session means the preview
 * restarts from frame 0 while you are tuning a scene.
 */

/**
 * Every explainer spec, whatever canvas it drives. The composition reads the
 * language fields uniformly and narrows to a canvas state only at the one switch
 * in <ExplainerVideo> — which is why the spec is generic rather than carrying a
 * union of every canvas's fields.
 */
export type AnyExplainerSpec =
  | ExplainerSpec<CanvasState>
  | ExplainerSpec<RiskCanvasState>;

export type ExplainerProps = {
  spec: AnyExplainerSpec;
  sceneDurations: number[];
  captions: boolean;
};

export const calculateExplainerMetadata: CalculateMetadataFunction<
  ExplainerProps
> = async ({ props }) => {
  const fps = 30;
  const { durations, total } = await sceneFrames(
    props.spec.scenes.map((s) => staticFile(audioPath(props.spec.slug, s.id))),
    fps,
    // A longer tail than the shorts: an explainer breathes between points, and
    // the canvas transition needs room to land before the next line starts.
    EXPLAINER_TAIL_SECONDS,
    props.spec.voice.tempo ?? 1,
  );
  return {
    durationInFrames: total,
    fps,
    props: { ...props, sceneDurations: durations },
  };
};
