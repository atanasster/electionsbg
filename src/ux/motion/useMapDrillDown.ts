import { useCallback, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { drillTransform } from "./drillZoom";
import { MOTION_MS } from "./motionTokens";

// Click a region → the map flies into it → the next page draws that region (motion-v1 §3.3).
//
// The SVG regions are an overlay on a Leaflet tile layer, and both sit in the SVG's parent
// box (`<div className="relative">` in every election map). So the zoom is applied to THAT
// box — tiles, regions, arrows and labels move as one picture. A Web Animation on `transform`
// is composited: no rAF loop, no React render per frame.
//
// ⚠️ ONE HOOK PER MAP, NOT PER REGION. `useMapElements` calls it and hands `drill` to every
// region: a settlement map has thousands of paths, and the hook must outlive any one of them —
// the next route can reuse the same map with fewer features, unmounting the clicked region
// while the zoomed box survives.
//
// ⚠️ THE ZOOM IS UNDONE WHEN THE ROUTE CHANGES, not when the animation ends. Navigation runs in
// `startTransition`, so the zoomed old page stays on screen until the new route commits; and
// when the new route reuses this map (oblast → município on one screen), the box would
// otherwise stay magnified over the new content. `fill: "forwards"` holds the end frame, and
// the location-keyed layout effect — or unmount — cancels it, which restores everything the
// flight changed.

const FLY_MS = MOTION_MS.slow;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Returns `drill(pathEl, go)`: fly into `pathEl`, then call `go` once. Falls straight through
 *  to `go` under reduced motion, without the Web Animations API, or for a degenerate shape.
 *  A call while a flight is already under way is ignored — a double click, a held Enter, or a
 *  second region clicked mid-flight must not navigate twice. */
export const useMapDrillDown = () => {
  const location = useLocation();
  const animation = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    animation.current?.cancel();
    animation.current = null;
  }, [location.key]);
  useLayoutEffect(
    () => () => {
      animation.current?.cancel();
      animation.current = null;
    },
    [],
  );

  return useCallback((pathEl: SVGGraphicsElement | null, go: () => void) => {
    if (animation.current) return;
    const svg = pathEl?.ownerSVGElement;
    const box = svg?.parentElement;
    if (reducedMotion() || !pathEl || !svg || !box || !box.animate) return go();
    const transform = drillTransform(
      pathEl.getBBox(),
      svg.width.baseVal.value,
      svg.height.baseVal.value,
    );
    if (!transform) return go();
    // Clip the flight to the map's own frame so the magnified picture does not spill over the
    // page around it. Everything changed here is restored when the zoom is cancelled.
    const frame = box.parentElement;
    const prevOverflow = frame?.style.overflow ?? "";
    const prevOrigin = box.style.transformOrigin;
    if (frame) frame.style.overflow = "hidden";
    box.style.transformOrigin = "0 0";
    const anim = box.animate(
      [
        { transform: "none", opacity: 1 },
        { transform, opacity: 0.6 },
      ],
      {
        duration: FLY_MS,
        easing: "cubic-bezier(0.33, 1, 0.68, 1)",
        fill: "forwards",
      },
    );
    animation.current = anim;
    // Navigate as the camera ARRIVES rather than after it settles: the last stretch of an
    // ease-out moves a few pixels, and waiting it out reads as lag.
    const timer = setTimeout(go, Math.round(FLY_MS * 0.8));
    anim.addEventListener(
      "cancel",
      () => {
        clearTimeout(timer);
        if (frame) frame.style.overflow = prevOverflow;
        box.style.transformOrigin = prevOrigin;
      },
      { once: true },
    );
  }, []);
};

export type MapDrill = ReturnType<typeof useMapDrillDown>;
