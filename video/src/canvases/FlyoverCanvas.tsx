import React, { useLayoutEffect, useRef } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { FlyoverState } from "../../../src/lib/flyover/state";
import { drawFlyoverFrame } from "./flyoverRenderer";

/** Persistent canvas: mounted once, redrawn deterministically for every Remotion frame. */
export const FlyoverCanvas: React.FC<{
  state: FlyoverState;
  width: number;
  height: number;
}> = ({ state, width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    drawFlyoverFrame(ctx, state, { w: width, h: height }, frame / fps);
  }, [fps, frame, height, state, width]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ display: "block", width, height }}
      aria-label="Карта на паричните потоци по области"
    />
  );
};
