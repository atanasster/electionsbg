import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { FONT, SAFE, THEME, TYPE, scale } from "../theme";
import { timePages } from "../lib/captions";
import { WORDMARK_BAND } from "./Frame";

/**
 * Burned-in Bulgarian captions for the social cuts.
 *
 * Not optional there: Facebook and Instagram autoplay muted, so an uncaptioned
 * Bulgarian voice track reaches nobody in the feed. The YouTube/on-site cut takes
 * a `.vtt` sidecar instead, where burned-in text blocks translation and looks
 * worse — hence the `captions` switch on the composition rather than baking these
 * into every scene.
 *
 * Pages are shown WHOLE, with no per-word highlight, because the timing is
 * derived from character counts rather than measured (see lib/captions.ts). A
 * highlight subtly out of sync reads as broken; a whole page a beat early just
 * reads as a caption.
 */
export const Captions: React.FC<{
  /** The scene's `voiceOver`, verbatim. */
  text: string;
  /** The scene's length in frames — pages are timed across it. */
  durationInFrames: number;
}> = ({ text, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const s = scale(width);
  const pal = THEME.dark;

  const pages = timePages(text, durationInFrames / fps);
  const t = frame / fps;
  const page = pages.find((p) => t >= p.fromSec && t < p.toSec) ?? pages.at(-1);
  if (!page) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.x * s,
        right: SAFE.x * s,
        // Sits above the wordmark band so the two never collide, in any aspect.
        bottom: (SAFE.y + WORDMARK_BAND) * s,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          // MUST be set here. Captions render as a SIBLING of <Frame>, not a
          // child, so they inherit nothing from it — the first captioned render
          // came out in Chromium's default serif. Readable, on-brand for nobody,
          // and invisible in the Studio preview if the host has Inter installed.
          fontFamily: FONT,
          fontSize: TYPE.support * 1.05 * s,
          fontWeight: 700,
          lineHeight: 1.28,
          textAlign: "center",
          color: pal.text,
          // A slab behind the text rather than a stroke: it survives any frame
          // underneath, which a text-shadow does not once a bar sits behind it.
          backgroundColor: "rgba(7,11,22,0.82)",
          padding: `${14 * s}px ${22 * s}px`,
          borderRadius: 14 * s,
          maxWidth: "100%",
        }}
      >
        {page.text}
      </div>
    </div>
  );
};
