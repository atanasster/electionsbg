import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { FONT, SAFE, THEME, scale, type ThemeName } from "../theme";
import { injectFonts } from "../lib/fonts";

/**
 * Vertical band the wordmark occupies, in base (1080-wide) pixels. Content is
 * padded clear of it — see the Frame body.
 */
export const WORDMARK_BAND = 64;

/**
 * The portrait stage for the SHORTS: background wash, safe area, wordmark.
 *
 * Children position against a 1080-wide base and scale by the real composition
 * width, which serves 9:16 and 4:5. Landscape uses `Stage16x9` instead — it is a
 * different layout, not a rescale.
 */
export const Frame: React.FC<{
  theme?: ThemeName;
  children: React.ReactNode;
  /** Hide the wordmark on scenes that carry their own branding (the outro). */
  wordmark?: boolean;
}> = ({ theme = "dark", children, wordmark = true }) => {
  injectFonts();
  const { width } = useVideoConfig();
  const pal = THEME[theme];
  const s = scale(width);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: pal.bg,
        backgroundImage: `radial-gradient(120% 80% at 50% 0%, ${pal.bg} 0%, ${pal.bg2} 100%)`,
        fontFamily: FONT,
        color: pal.text,
      }}
    >
      {/* The wordmark is absolutely positioned, so the content area must RESERVE
          its band or tall content simply runs underneath it. Caught on the 4:5
          feed cut, where 6 bars have 570px less room than at 9:16 and the last
          bar rendered behind the wordmark. */}
      <AbsoluteFill
        style={{
          paddingTop: SAFE.y * s,
          paddingBottom: (SAFE.y + (wordmark ? WORDMARK_BAND : 0)) * s,
          paddingLeft: SAFE.x * s,
          paddingRight: SAFE.x * s,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {children}
      </AbsoluteFill>

      {wordmark ? (
        <div
          style={{
            position: "absolute",
            left: SAFE.x * s,
            bottom: (SAFE.y - 40) * s,
            fontSize: 34 * s,
            fontWeight: 700,
            letterSpacing: -0.5 * s,
            color: pal.muted,
          }}
        >
          на<span style={{ color: pal.accent }}>ясно</span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
