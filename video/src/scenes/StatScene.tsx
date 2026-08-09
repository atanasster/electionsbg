import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Frame } from "../components/Frame";
import { BEAT, THEME, TYPE, scale } from "../theme";

/**
 * One number, large. Used only when the fact genuinely has nothing to compare
 * against — otherwise `BarsScene` is the default (see references/scenes.md).
 *
 * Animation is written for Remotion Studio editability: `interpolate()` inline in
 * `style`, individual CSS transform properties rather than `transform` strings, so
 * the operator can retime a beat against the Bulgarian voice track without a code
 * change.
 */
export const StatScene: React.FC<{
  value: string;
  label: string;
  sub?: string;
}> = ({ value, label, sub }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const pal = THEME.dark;
  const s = scale(width);

  const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  return (
    <Frame>
      <div
        style={{
          fontSize: TYPE.kicker * s,
          fontWeight: 600,
          letterSpacing: 2 * s,
          textTransform: "uppercase",
          color: pal.muted,
          opacity: interpolate(t, [0, BEAT.in], [0, 1], {
            ...ease,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        {sub ?? "Наясно"}
      </div>

      <div
        style={{
          marginTop: 24 * s,
          fontSize: TYPE.hero * s,
          fontWeight: 700,
          lineHeight: 1.02,
          letterSpacing: -4 * s,
          color: pal.accent,
          opacity: interpolate(t, [0.1, 0.1 + BEAT.in], [0, 1], ease),
          // `perceptual-scale` because a linear scale ramp reads as decelerating.
          scale: interpolate(t, [0.1, 0.1 + BEAT.in], [0.88, 1], {
            ...ease,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
        }}
      >
        {value}
      </div>

      <div
        style={{
          marginTop: 28 * s,
          fontSize: TYPE.headline * s,
          fontWeight: 600,
          lineHeight: 1.18,
          letterSpacing: -1 * s,
          color: pal.text,
          whiteSpace: "pre-line",
          opacity: interpolate(t, [0.28, 0.28 + BEAT.in], [0, 1], ease),
          translate: `0px ${interpolate(
            t,
            [0.28, 0.28 + BEAT.in],
            [18 * s, 0],
            {
              ...ease,
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          )}px`,
        }}
      >
        {label}
      </div>
    </Frame>
  );
};
