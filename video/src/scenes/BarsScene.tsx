import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Frame, WORDMARK_BAND } from "../components/Frame";
import { BEAT, SAFE, THEME, TYPE, scale } from "../theme";
import type { Bar } from "../lib/spec";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The default visual: a ranking or comparison, 3-6 rows.
 *
 * ⚠️ THE TIMING RULE. Each bar is driven by **time since its own trigger** with a
 * CONSTANT duration (`BEAT.item`) — never by a slice of one global 0→1 reveal.
 * With a global slice, adding rows silently shortens every row's animation and
 * the chart reads as a flicker rather than a build. See references/scenes.md.
 */
export const BarsScene: React.FC<{
  title: string;
  bars: Bar[];
  unit?: string;
}> = ({ title, bars, unit }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const pal = THEME.dark;
  const s = scale(width);
  const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
  const trackW = (1080 - SAFE.x * 2) * s;
  const START = 0.35;

  /**
   * Vertical fit. `scale()` is width-derived, so the SAME content has 570px less
   * room at 1080x1350 (feed) than at 1080x1920 (reel) — six bars overflowed into
   * the wordmark on the first feed render. Rather than a second layout, compress
   * the vertical rhythm by the shortfall.
   *
   * Spacing absorbs it, never the type: the layout minimums (headline >= 84,
   * supporting >= 44 at 1080 wide) are a legibility floor on a phone screen, so
   * shrinking text to fit would trade a visible defect for an unreadable one.
   */
  const TITLE_H = TYPE.headline * 1.14 * 2 + 44; // two lines + margin
  const ROW_H =
    TYPE.support * 1.2 + 8 + TYPE.caption * 0.78 * 1.2 + 8 + 26 + 30;
  const needed = TITLE_H + bars.length * ROW_H;
  const available = height / s - SAFE.y * 2 - WORDMARK_BAND;
  const fit = Math.min(1, Math.max(0.55, available / needed));

  return (
    <Frame>
      <div
        style={{
          fontSize: TYPE.headline * s,
          fontWeight: 700,
          lineHeight: 1.14,
          letterSpacing: -1.5 * s,
          marginBottom: 44 * s * fit,
          opacity: interpolate(t, [0, BEAT.in], [0, 1], {
            ...ease,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        {title}
      </div>

      {bars.map((b, i) => {
        // Time since THIS bar's trigger — constant duration, staggered start.
        const trigger = START + i * BEAT.stagger;
        const p = clamp01((t - trigger) / BEAT.item);
        const grow = interpolate(p, [0, 1], [0, 1], {
          ...ease,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        });
        const color = b.emphasis ? pal.accent : pal.cool;

        return (
          <div key={b.label} style={{ marginBottom: 30 * s * fit }}>
            {/* Name and value share a line; the note goes UNDERNEATH. With all
                three inline, a long party name ("БСП — Обединена левица" plus
                "0 мандата") runs into its own value — measured on the first
                render, and a longer name would collide outright. */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 20 * s,
                marginBottom: 8 * s * fit,
                opacity: interpolate(p, [0, 0.35], [0, 1], ease),
              }}
            >
              <div
                style={{
                  fontSize: TYPE.support * s,
                  fontWeight: 600,
                  color: b.emphasis ? pal.text : pal.muted,
                  // Backstop for a name longer than any currently in a spec:
                  // shrink and ellipsize rather than push the value off-frame.
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {b.label}
              </div>
              <div
                style={{
                  fontSize: TYPE.support * 1.15 * s,
                  fontWeight: 700,
                  color,
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {b.display}
                {unit ?? ""}
              </div>
            </div>

            {b.note ? (
              <div
                style={{
                  fontSize: TYPE.caption * 0.78 * s,
                  fontWeight: 500,
                  color: pal.muted,
                  marginBottom: 8 * s * fit,
                  opacity: interpolate(p, [0.1, 0.45], [0, 1], ease),
                }}
              >
                {b.note}
              </div>
            ) : null}

            <div
              style={{
                height: 26 * s,
                width: trackW,
                borderRadius: 13 * s,
                backgroundColor: pal.rule,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: (Math.abs(b.value) / max) * trackW * grow,
                  borderRadius: 13 * s,
                  backgroundColor: color,
                }}
              />
            </div>
          </div>
        );
      })}
    </Frame>
  );
};
