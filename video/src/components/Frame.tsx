import React from "react";
import { AbsoluteFill, staticFile, useVideoConfig } from "remotion";
import { FONT, SAFE, THEME, scale, type ThemeName } from "../theme";

/**
 * Font loading. Remotion renders in headless Chromium, where `system-ui` is
 * whatever the host happens to have — so Cyrillic must not be left to it. The
 * faces are the site's own self-hosted Inter, mirrored by `npm run video:fonts`.
 *
 * Injected once at module scope rather than per-component: a <style> per scene
 * would be re-inserted on every frame of every scene.
 */
/**
 * Vertical band the wordmark occupies, in base (1080-wide) pixels. Content is
 * padded clear of it — see the Frame body.
 */
export const WORDMARK_BAND = 64;

let fontsInjected = false;
const injectFonts = () => {
  if (fontsInjected || typeof document === "undefined") return;
  fontsInjected = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = staticFile("fonts/inter.css");
  document.head.appendChild(link);
};

/**
 * The shared stage: background wash, safe area, wordmark.
 *
 * Every child positions itself against a 1080-wide base and is scaled by the real
 * composition width, so one set of scenes serves 9:16, 1:1 and 16:9.
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
