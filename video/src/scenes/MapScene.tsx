import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Frame } from "../components/Frame";
import { BEAT, THEME, TYPE, scale } from "../theme";
import MAP from "../generated/t2-municipalities.json";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Bulgaria's 265 municipalities, filling in one by one.
 *
 * ⚠️ THE TIMING RULE, and this is the scene it exists for. Each municipality is
 * driven by **time since its own trigger** with a CONSTANT fill duration. Driving
 * them from a slice of one global 0→1 reveal would give each of 288 polygons
 * ~110ms on a 30s timeline, and the map would read as noise rather than a sweep.
 *
 * The sweep runs WEST→EAST by polygon centroid so it reads as a direction rather
 * than a scatter. Order is derived from the path data (deterministic), not shuffled.
 */

/** Rough centroid from the path's move-to commands — enough to order a sweep. */
const centroidX = (d: string): number => {
  const xs = [...d.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)/g)].map((m) =>
    Number(m[1]),
  );
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
};

const ORDERED = [...MAP.features]
  .map((f) => ({ ...f, cx: centroidX(f.d) }))
  .sort((a, b) => a.cx - b.cx);

export const MapScene: React.FC<{
  title: string;
  /** Seconds the whole sweep occupies. Per-item duration stays constant. */
  sweepSeconds?: number;
  legend?: { changed: string; kept: string };
}> = ({ title, sweepSeconds = 4.2, legend }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const pal = THEME.dark;
  const s = scale(width);
  const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  const START = 0.5;
  /** Constant per municipality — never a share of the sweep. */
  const FILL_S = 0.55;
  const n = ORDERED.length;

  // The map fills whatever space the title and legend leave, via `flex: 1` plus
  // `preserveAspectRatio` — NOT a hand-computed height.
  //
  // The first version estimated the remaining height from a two-line title and
  // sized the <svg> with width/height ATTRIBUTES. Both were wrong: the title wraps
  // to three lines at this width, and an SVG's width/height attributes lose to the
  // flex algorithm, so the map rendered at roughly a third of its intended size in
  // an ocean of empty frame. Letting flex do the measuring removes both failure
  // modes and adapts to any aspect for free.

  return (
    <Frame>
      <div
        style={{
          fontSize: TYPE.headline * s,
          fontWeight: 700,
          lineHeight: 1.14,
          letterSpacing: -1.5 * s,
          marginBottom: 24 * s,
          opacity: interpolate(t, [0, BEAT.in], [0, 1], {
            ...ease,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        {title}
      </div>

      {/* ABOVE the map, not below: the burned-in caption band occupies the
          bottom of the frame, and a legend there collided with it on the first
          captioned render. Reading the key before the map is better anyway. */}
      {legend ? (
        <div
          style={{
            display: "flex",
            gap: 36 * s,
            marginBottom: 22 * s,
            fontSize: TYPE.caption * 0.9 * s,
            fontWeight: 600,
            color: pal.muted,
            opacity: interpolate(
              t,
              [
                START + sweepSeconds * 0.5,
                START + sweepSeconds * 0.5 + BEAT.in,
              ],
              [0, 1],
              ease,
            ),
          }}
        >
          {(
            [
              [pal.accent, legend.changed],
              [pal.cool, legend.kept],
            ] as const
          ).map(([c, label]) => (
            <span
              key={label}
              style={{ display: "flex", alignItems: "center", gap: 12 * s }}
            >
              <span
                style={{
                  width: 26 * s,
                  height: 26 * s,
                  borderRadius: 7 * s,
                  backgroundColor: c,
                  display: "inline-block",
                }}
              />
              {label}
            </span>
          ))}
        </div>
      ) : null}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          viewBox={MAP.viewBox}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%" }}
        >
          {ORDERED.map((f, i) => {
            // Time since THIS polygon's trigger. Constant duration, staggered start.
            const trigger = START + (i / n) * sweepSeconds;
            const p = clamp01((t - trigger) / FILL_S);
            const grow = interpolate(p, [0, 1], [0, 1], {
              ...ease,
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            });
            // Kept municipalities stay in the cool counterpart so the 29 read as a
            // deliberate residue rather than as polygons the sweep forgot.
            const target = f.changed ? pal.accent : pal.cool;
            return (
              <path
                key={f.code}
                d={f.d}
                fill={target}
                fillOpacity={grow * (f.changed ? 0.92 : 0.85)}
                stroke={pal.bg2}
                strokeWidth={0.8}
              />
            );
          })}
        </svg>
      </div>
    </Frame>
  );
};
