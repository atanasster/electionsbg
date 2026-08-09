import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Frame } from "../components/Frame";
import { BEAT, THEME, TYPE, scale } from "../theme";

/** Closing card: the claim restated, the deep link, the share ask. */
export const OutroScene: React.FC<{
  title: string;
  cta: string;
  url: string;
}> = ({ title, cta, url }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const pal = THEME.dark;
  const s = scale(width);
  const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  return (
    <Frame wordmark={false}>
      <div
        style={{
          fontSize: TYPE.headline * s,
          fontWeight: 700,
          lineHeight: 1.16,
          letterSpacing: -1.5 * s,
          whiteSpace: "pre-line",
          opacity: interpolate(t, [0, BEAT.in], [0, 1], {
            ...ease,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: `0px ${interpolate(t, [0, BEAT.in], [16 * s, 0], {
            ...ease,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}px`,
        }}
      >
        {title}
      </div>

      <div
        style={{
          marginTop: 40 * s,
          display: "inline-flex",
          alignSelf: "flex-start",
          padding: `${18 * s}px ${34 * s}px`,
          borderRadius: 999,
          backgroundColor: pal.accent,
          color: "#0b1224",
          fontSize: TYPE.support * s,
          fontWeight: 700,
          opacity: interpolate(t, [0.3, 0.3 + BEAT.in], [0, 1], ease),
          scale: interpolate(t, [0.3, 0.3 + BEAT.in], [0.94, 1], {
            ...ease,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
        }}
      >
        {cta}
      </div>

      <div
        style={{
          marginTop: 26 * s,
          fontSize: TYPE.caption * s,
          fontWeight: 500,
          color: pal.muted,
          opacity: interpolate(t, [0.45, 0.45 + BEAT.in], [0, 1], ease),
        }}
      >
        {url}
      </div>

      <div
        style={{
          marginTop: 56 * s,
          fontSize: TYPE.headline * 1.05 * s,
          fontWeight: 700,
          letterSpacing: -1 * s,
          opacity: interpolate(t, [0.6, 0.6 + BEAT.in], [0, 1], ease),
        }}
      >
        на<span style={{ color: pal.accent }}>ясно</span>
      </div>
    </Frame>
  );
};
