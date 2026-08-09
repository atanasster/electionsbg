import React from "react";
import {
  Audio,
  Easing,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import { Stage16x9, STAGE } from "../components/Stage16x9";
import { InflationCanvas } from "../scenes/InflationCanvas";
import { RiskCanvas } from "../scenes/RiskCanvas";
import { ScreenPlate } from "../scenes/ScreenPlate";
import { Captions } from "../components/Captions";
import { THEME } from "../theme";
import { audioPath, type ExplainerSpec } from "../lib/spec";
import { EXPLAINER_TAIL_SECONDS, sceneFrames } from "../lib/audio";
import { resolveCanvas, type CanvasState } from "../lib/canvasState";
import {
  resolveRiskCanvas,
  type RiskCanvasState,
} from "../lib/riskCanvasState";

/**
 * Every explainer spec, whatever canvas it drives. The composition reads the
 * language fields uniformly and narrows to a canvas state only at the one switch
 * below — which is why the spec is generic rather than carrying a union of every
 * canvas's fields.
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

/** The right-hand rail: the one thing this scene is saying. */
const Rail: React.FC<{
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
  const inAt = (d: number) =>
    interpolate(t, [d, d + 0.45], [0, 1], {
      ...ease,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });

  return (
    <div style={{ opacity: 1 }}>
      {kicker ? (
        <div
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: pal.muted,
            marginBottom: 18,
            opacity: inAt(0),
          }}
        >
          {kicker}
        </div>
      ) : null}

      {stat ? (
        <div
          style={{
            fontSize: 116,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: -3,
            color: pal.accent,
            marginBottom: 22,
            opacity: inAt(0.08),
            scale: interpolate(t, [0.08, 0.53], [0.92, 1], {
              ...ease,
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              output: "perceptual-scale",
            }),
          }}
        >
          {stat}
        </div>
      ) : null}

      <div
        style={{
          fontSize: 52,
          fontWeight: 700,
          lineHeight: 1.16,
          letterSpacing: -1,
          whiteSpace: "pre-line",
          opacity: inAt(0.16),
          translate: `0px ${interpolate(t, [0.16, 0.61], [14, 0], {
            ...ease,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}px`,
        }}
      >
        {headline}
      </div>

      {body ? (
        <div
          style={{
            marginTop: 24,
            fontSize: 32,
            fontWeight: 500,
            lineHeight: 1.42,
            color: pal.muted,
            whiteSpace: "pre-line",
            opacity: inAt(0.3),
          }}
        >
          {body}
        </div>
      ) : null}
    </div>
  );
};

export const ExplainerVideo: React.FC<ExplainerProps> = ({
  spec,
  sceneDurations,
  captions,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const chartW = width - STAGE.padX * 2 - STAGE.railW - STAGE.gap;
  const chartH = height - STAGE.headerH - STAGE.footerH - 48;

  // Which scene is on screen right now — the chart column swaps to a captured
  // page for scenes that declare one. Computed from absolute time for the same
  // reason the canvas is: this lives outside every <Sequence>.
  const starts: number[] = [];
  {
    let acc = 0;
    for (const d of sceneDurations) {
      starts.push(acc);
      acc += d;
    }
  }
  let active = 0;
  while (active + 1 < starts.length && frame >= starts[active + 1]!) active++;
  const activeScreen = spec.scenes[active]?.screen;

  let from = 0;
  return (
    <>
      <Stage16x9
        topic={spec.topic}
        period={spec.period}
        source={spec.sourceLine}
        // ABSOLUTE frame — this is the whole reason the canvas is not inside a
        // <Sequence>: useCurrentFrame() is sequence-local, and a persistent
        // visual needs the global clock to accrete across scene boundaries.
        chart={
          activeScreen ? (
            <ScreenPlate
              name={activeScreen.name as never}
              width={chartW}
              height={chartH}
              zoomAt={activeScreen.zoomAt}
              cursor={activeScreen.cursor}
            />
          ) : spec.canvasKind === "risk" ? (
            <RiskCanvas
              state={resolveRiskCanvas(
                spec.scenes as { canvas?: Partial<RiskCanvasState> }[],
                sceneDurations,
                frame,
                fps,
              )}
              width={chartW}
              height={chartH}
            />
          ) : (
            <InflationCanvas
              state={resolveCanvas(
                spec.scenes as { canvas?: Partial<CanvasState> }[],
                sceneDurations,
                frame,
                fps,
              )}
              width={chartW}
              height={chartH}
            />
          )
        }
        rail={null}
      />

      {/* Per-scene rail + audio. The rail sits in the same column the Stage
          reserves, positioned absolutely so each scene can replace only it. */}
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
            premountFor={30}
          >
            <div
              style={{
                position: "absolute",
                top: STAGE.headerH,
                bottom: STAGE.footerH,
                right: STAGE.padX,
                width: STAGE.railW,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                color: THEME.dark.text,
              }}
            >
              <Rail
                kicker={scene.kicker}
                headline={scene.headline}
                body={scene.body}
                stat={scene.stat}
              />
            </div>
            <Audio
              src={staticFile(audioPath(spec.slug, scene.id))}
              playbackRate={spec.voice.tempo ?? 1}
            />
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
