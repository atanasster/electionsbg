import React from "react";
import {
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { THEME } from "../theme";
import SCREENS from "../generated/screens.json";

/**
 * A real page from the app, panned and zoomed — the "this is the actual tool"
 * beat that a drawn chart cannot make.
 *
 * ── THE FIXED-PLATE PATTERN ───────────────────────────────────────────────────
 * The page is captured ONCE at 2x into an oversized still, and the movement is a
 * CSS transform on that still. Nothing re-renders the page per frame, so there is
 * no shimmer, no async harness and no per-frame browser work — the same rule the
 * skill states for WebGL maps, applied to UI.
 *
 * The zoom target is not eyeballed: `capture_screens.ts` records each focus
 * element's rect in PLATE pixels straight from the DOM, so the choreography is
 * derived from the page rather than measured off a screenshot by hand.
 */

type PlateMeta = {
  file: string;
  plate: { w: number; h: number };
  focus: { x: number; y: number; w: number; h: number } | null;
  capturedFrom: string;
};

export const ScreenPlate: React.FC<{
  name: keyof typeof SCREENS;
  width: number;
  height: number;
  /** Seconds into the scene at which the zoom begins. */
  zoomAt?: number;
  /** Show the synthetic cursor travelling to the focus row. */
  cursor?: boolean;
}> = ({ name, width, height, zoomAt = 1.4, cursor = true }) => {
  const meta = SCREENS[name] as PlateMeta;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const pal = THEME.dark;
  const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  const { plate, focus } = meta;

  /**
   * Zoom is a FIXED magnification over the fit, not a "fit the focus rect" —
   * deliberately, after the derived version failed on this plate.
   *
   * The target row spans the table's full width at an aspect near 84:1, so
   * "make the focus rect fill the frame" resolves to roughly the fit scale and
   * produces no zoom at all. Any full-width row has this property; it is a
   * property of tables, not a quirk of this one.
   *
   * So: magnify a fixed amount and anchor the row's LEFT edge, which is where
   * the label and the first value columns are — the part the narration cites.
   * The right-hand columns crop, and that is the correct trade for legibility.
   */
  const ZOOM = 2.4;
  const fitScale = Math.min(width / plate.w, height / plate.h);
  const zoomScale = fitScale * ZOOM;

  const p = interpolate(t, [zoomAt, zoomAt + 1.5], [0, 1], {
    ...ease,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const scale = fitScale + (zoomScale - fitScale) * p;

  /**
   * With `transformOrigin: 0 0` and individual transform properties, a plate
   * point (px,py) lands at `translate + (px,py) * scale`. So the translate must
   * interpolate BETWEEN the two end states, not be composed of one plus the
   * other:
   *
   *   p=0 → the plate fits and is centred      → (baseX, baseY)
   *   p=1 → the focus centre sits mid-frame    → (w/2 - cx*zoom, h/2 - cy*zoom)
   *
   * The first version added `baseX` to the zoom target and multiplied an
   * already-interpolated offset by `p` a second time, which shrank the plate and
   * walked it toward the corner instead of zooming into the row.
   */
  // Anchor the row's LEFT edge (plus a small margin) rather than its centre.
  const cx = focus
    ? focus.x + width / zoomScale / 2 - 40 / zoomScale
    : plate.w / 2;
  const cy = focus ? focus.y + focus.h / 2 : plate.h / 2;
  const baseX = (width - plate.w * fitScale) / 2;
  const baseY = (height - plate.h * fitScale) / 2;
  const tx = interpolate(p, [0, 1], [baseX, width / 2 - cx * zoomScale], ease);
  const ty = interpolate(p, [0, 1], [baseY, height / 2 - cy * zoomScale], ease);

  // Cursor travels to the row just before the zoom starts.
  const cp = interpolate(t, [zoomAt - 0.9, zoomAt + 0.1], [0, 1], {
    ...ease,
    easing: Easing.bezier(0.33, 1, 0.68, 1),
  });
  const curX = interpolate(
    cp,
    [0, 1],
    [width * 0.82, baseX + cx * fitScale + 40],
    ease,
  );
  const curY = interpolate(
    cp,
    [0, 1],
    [height * 0.88, baseY + cy * fitScale],
    ease,
  );

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        borderRadius: 18,
        border: `1px solid ${pal.rule}`,
        backgroundColor: pal.bg2,
      }}
    >
      <Img
        src={staticFile(meta.file)}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: plate.w,
          height: plate.h,
          transformOrigin: "0 0",
          // Individual transform properties, not a `transform` string — keeps the
          // values editable in Remotion Studio.
          translate: `${tx}px ${ty}px`,
          scale,
        }}
      />

      {/* Focus outline, once the zoom has committed. */}
      {focus ? (
        <div
          style={{
            position: "absolute",
            left: tx + focus.x * scale,
            top: ty + focus.y * scale,
            width: focus.w * scale,
            height: focus.h * scale,
            border: `2px solid ${pal.accent}`,
            borderRadius: 8,
            opacity: interpolate(t, [zoomAt + 0.6, zoomAt + 1.2], [0, 1], ease),
            boxShadow: `0 0 0 9999px rgba(7,11,22,0.42)`,
          }}
        />
      ) : null}

      {cursor ? (
        <svg
          width={40}
          height={46}
          viewBox="0 0 24 28"
          style={{
            position: "absolute",
            left: curX,
            top: curY,
            opacity: interpolate(
              t,
              [0.4, 0.9, zoomAt + 1.9, zoomAt + 2.3],
              [0, 1, 1, 0],
              ease,
            ),
            filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.55))",
          }}
        >
          <path
            d="M3 2 L3 21 L8.5 16.2 L11.8 23.6 L15.2 22.1 L12 14.9 L19 14.3 Z"
            fill="#ffffff"
            stroke="#0b1224"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </div>
  );
};
