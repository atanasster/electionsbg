import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Series,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FlyoverCanvas } from "../canvases/FlyoverCanvas";
import { Captions } from "../components/Captions";
import { injectFonts } from "../lib/fonts";
import { resolveFlyoverCanvas } from "../lib/flyoverCanvasState";
import { audioPath } from "../lib/spec";
import { FONT, THEME } from "../theme";
import {
  materializeFlyoverCutdown,
  type FlyoverReelProps,
} from "./flyoverReelMetadata";

const REEL = {
  padX: 64,
  headerH: 144,
  mapTop: 164,
  mapH: 620,
  calloutTop: 824,
  calloutBottom: 420,
  footerH: 82,
} as const;

const ReelCallout: React.FC<{
  kicker?: string;
  headline: string;
  body?: string;
  stat?: string;
}> = ({ kicker, headline, body, stat }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const pal = THEME.dark;
  const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const enter = (at: number) =>
    interpolate(t, [at, at + 0.45], [0, 1], {
      ...ease,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });

  return (
    <div>
      {kicker ? (
        <div
          style={{
            color: pal.muted,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: 2,
            marginBottom: 18,
            opacity: enter(0),
            textTransform: "uppercase",
          }}
        >
          {kicker}
        </div>
      ) : null}
      {stat ? (
        <div
          style={{
            color: pal.accent,
            fontSize: 114,
            fontWeight: 700,
            letterSpacing: -3,
            lineHeight: 1,
            marginBottom: 18,
            opacity: enter(0.08),
            scale: interpolate(t, [0.08, 0.53], [0.92, 1], {
              ...ease,
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              output: "perceptual-scale",
            }),
            transformOrigin: "left center",
            whiteSpace: "nowrap",
          }}
        >
          {stat}
        </div>
      ) : null}
      <div
        style={{
          color: pal.text,
          fontSize: 66,
          fontWeight: 700,
          letterSpacing: -1.2,
          lineHeight: 1.12,
          opacity: enter(0.16),
          translate: `0px ${interpolate(t, [0.16, 0.61], [14, 0], ease)}px`,
          whiteSpace: "pre-line",
        }}
      >
        {headline}
      </div>
      {body ? (
        <div
          style={{
            color: pal.muted,
            fontSize: 34,
            fontWeight: 500,
            lineHeight: 1.35,
            marginTop: 20,
            opacity: enter(0.3),
            whiteSpace: "pre-line",
          }}
        >
          {body}
        </div>
      ) : null}
    </div>
  );
};

/** A portrait re-cut of the explainer canvas, not a crop of the 16:9 master. */
export const FlyoverReel: React.FC<FlyoverReelProps> = ({
  spec,
  edits,
  sceneDurations,
  captions,
}) => {
  injectFonts();
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pal = THEME.dark;
  const scenes = materializeFlyoverCutdown(spec, edits);
  const chartW = width - REEL.padX * 2;

  return (
    <>
      <AbsoluteFill
        style={{
          backgroundColor: pal.bg,
          backgroundImage: `radial-gradient(120% 80% at 50% 0%, ${pal.bg} 0%, ${pal.bg2} 100%)`,
          color: pal.text,
          fontFamily: FONT,
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${pal.rule}`,
            display: "flex",
            height: REEL.headerH,
            justifyContent: "space-between",
            left: REEL.padX,
            position: "absolute",
            right: REEL.padX,
            top: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -0.5 }}>
              {spec.topic}
            </div>
            <div
              style={{
                color: pal.muted,
                fontSize: 25,
                fontWeight: 600,
                marginTop: 6,
              }}
            >
              {spec.period}
            </div>
          </div>
          <div style={{ color: pal.muted, fontSize: 30, fontWeight: 700 }}>
            на<span style={{ color: pal.accent }}>ясно</span>
          </div>
        </div>

        <div
          style={{
            height: REEL.mapH,
            left: REEL.padX,
            overflow: "hidden",
            position: "absolute",
            top: REEL.mapTop,
            width: chartW,
          }}
        >
          <FlyoverCanvas
            state={resolveFlyoverCanvas(scenes, sceneDurations, frame, fps)}
            width={chartW}
            height={REEL.mapH}
          />
        </div>

        <div
          style={{
            borderTop: `1px solid ${pal.rule}`,
            bottom: 0,
            color: pal.muted,
            display: "flex",
            fontSize: 21,
            fontWeight: 500,
            height: REEL.footerH,
            left: REEL.padX,
            lineHeight: 1.25,
            alignItems: "center",
            position: "absolute",
            right: REEL.padX,
          }}
        >
          {spec.sourceLine}
        </div>
      </AbsoluteFill>

      <Series>
        {scenes.map((scene, index) => {
          const durationInFrames = sceneDurations[index] ?? 1;
          return (
            <Series.Sequence
              key={scene.id}
              name={`Cutdown scene ${scene.id}`}
              durationInFrames={durationInFrames}
              premountFor={fps}
            >
              <div
                style={{
                  bottom: REEL.calloutBottom,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  left: REEL.padX + 16,
                  position: "absolute",
                  right: REEL.padX + 16,
                  top: REEL.calloutTop,
                }}
              >
                <ReelCallout
                  kicker={scene.kicker}
                  headline={scene.headline}
                  body={scene.body}
                  stat={scene.stat}
                />
              </div>
              <Audio
                src={staticFile(audioPath(spec.slug, scene.id))}
                playbackRate={spec.voice.tempo ?? 1}
                trimBefore={Math.round(scene.trimStartSeconds * fps)}
                trimAfter={Math.round(scene.trimEndSeconds * fps)}
              />
              {captions ? (
                <Captions
                  text={scene.voiceOver}
                  durationInFrames={durationInFrames}
                />
              ) : null}
            </Series.Sequence>
          );
        })}
      </Series>
    </>
  );
};
