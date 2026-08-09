import React from "react";
import {
  Audio,
  Sequence,
  staticFile,
  type CalculateMetadataFunction,
} from "remotion";
import { BarsScene } from "../scenes/BarsScene";
import { OutroScene } from "../scenes/OutroScene";
import { StatScene } from "../scenes/StatScene";
import { audioPath, type VideoSpec } from "../lib/spec";
import { sceneFrames } from "../lib/audio";

export type ShortProps = {
  spec: VideoSpec;
  /** Filled by calculateMetadata from the real audio — never hand-entered. */
  sceneDurations: number[];
};

/**
 * The composition sizes ITSELF from the narration: each scene's length is its
 * clip's duration plus a tail, and the total is their sum. Scene lengths and
 * voice-over therefore cannot drift apart by construction — reword a line and the
 * timing follows on the next render with nothing to update by hand.
 */
export const calculateShortMetadata: CalculateMetadataFunction<
  ShortProps
> = async ({ props }) => {
  const fps = 30;
  const { durations, total } = await sceneFrames(
    props.spec.scenes.map((s) => staticFile(audioPath(props.spec.slug, s.id))),
    fps,
  );
  return {
    durationInFrames: total,
    fps,
    props: { ...props, sceneDurations: durations },
  };
};

const SceneVisual: React.FC<{ spec: VideoSpec; index: number }> = ({
  spec,
  index,
}) => {
  const scene = spec.scenes[index];
  if (!scene) return null;
  const v = scene.visual;
  switch (v.type) {
    case "stat":
      return <StatScene value={v.value} label={v.label} sub={v.sub} />;
    case "bars":
      return <BarsScene title={v.title} bars={v.bars} unit={v.unit} />;
    case "outro":
      return <OutroScene title={v.title} cta={v.cta} url={v.url} />;
  }
};

export const ShortVideo: React.FC<ShortProps> = ({ spec, sceneDurations }) => {
  let from = 0;
  return (
    <>
      {spec.scenes.map((scene, i) => {
        const durationInFrames = sceneDurations[i] ?? 1;
        const start = from;
        from += durationInFrames;
        return (
          <Sequence
            key={scene.id}
            name={`Scene ${scene.id}`}
            from={start}
            durationInFrames={durationInFrames}
            // Always premount: without it a scene's assets pop in on entry.
            premountFor={30}
          >
            <SceneVisual spec={spec} index={i} />
            <Audio src={staticFile(audioPath(spec.slug, scene.id))} />
          </Sequence>
        );
      })}
    </>
  );
};
