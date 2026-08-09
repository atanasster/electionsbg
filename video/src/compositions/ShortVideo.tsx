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
import { Captions } from "../components/Captions";
import { audioPath, type VideoSpec } from "../lib/spec";
import { sceneFrames } from "../lib/audio";

export type ShortProps = {
  spec: VideoSpec;
  /** Filled by calculateMetadata from the real audio — never hand-entered. */
  sceneDurations: number[];
  /**
   * Burn Bulgarian captions into the frame. ON for the social cuts (Facebook and
   * Instagram autoplay muted, so an uncaptioned BG voice track reaches nobody in
   * the feed); OFF for the YouTube/on-site cut, which takes the `.vtt` sidecar
   * instead — burned-in text there blocks translation and looks worse.
   */
  captions: boolean;
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

export const ShortVideo: React.FC<ShortProps> = ({
  spec,
  sceneDurations,
  captions,
}) => {
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
            {captions ? (
              <Captions
                text={scene.voiceOver}
                durationInFrames={durationInFrames}
              />
            ) : null}
          </Sequence>
        );
      })}
    </>
  );
};
