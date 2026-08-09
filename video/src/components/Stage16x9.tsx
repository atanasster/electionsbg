import React from "react";
import { AbsoluteFill } from "remotion";
import { FONT, THEME } from "../theme";
import { injectFonts } from "../lib/fonts";

/**
 * The 16:9 explainer frame — a dashboard, not a card.
 *
 * Landscape is NOT a rescale of the portrait shorts (see references/publish.md):
 * it has ~840px less height and 840px more width, so it gets its own layout that
 * SPENDS the width — persistent chrome top and bottom, chart left, callout rail
 * right. The chrome (topic · period · source) stays on screen for the whole video
 * because in an explainer the provenance is part of the argument, not a footnote.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ TOPIC · period                        наясно │
 *   ├───────────────────────────────┬──────────────┤
 *   │  chart (persistent, accretes)  │  callout    │
 *   ├───────────────────────────────┴──────────────┤
 *   │ source                                       │
 *   └──────────────────────────────────────────────┘
 */

export const STAGE = {
  padX: 64,
  headerH: 96,
  footerH: 64,
  /** Width of the right-hand callout rail. */
  railW: 620,
  gap: 48,
} as const;

export const Stage16x9: React.FC<{
  topic: string;
  period: string;
  source: string;
  chart: React.ReactNode;
  rail: React.ReactNode;
}> = ({ topic, period, source, chart, rail }) => {
  injectFonts();
  const pal = THEME.dark;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: pal.bg,
        backgroundImage: `radial-gradient(120% 90% at 20% 0%, ${pal.bg} 0%, ${pal.bg2} 100%)`,
        fontFamily: FONT,
        color: pal.text,
      }}
    >
      {/* header */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: STAGE.padX,
          right: STAGE.padX,
          height: STAGE.headerH,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${pal.rule}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
          <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>
            {topic}
          </span>
          <span style={{ fontSize: 27, fontWeight: 600, color: pal.muted }}>
            {period}
          </span>
        </div>
        <div style={{ fontSize: 30, fontWeight: 700, color: pal.muted }}>
          на<span style={{ color: pal.accent }}>ясно</span>
        </div>
      </div>

      {/* body */}
      <div
        style={{
          position: "absolute",
          top: STAGE.headerH,
          bottom: STAGE.footerH,
          left: STAGE.padX,
          right: STAGE.padX,
          display: "flex",
          gap: STAGE.gap,
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          {chart}
        </div>
        <div
          style={{
            width: STAGE.railW,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          {rail}
        </div>
      </div>

      {/* footer */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: STAGE.padX,
          right: STAGE.padX,
          height: STAGE.footerH,
          display: "flex",
          alignItems: "center",
          borderTop: `1px solid ${pal.rule}`,
          fontSize: 22,
          fontWeight: 500,
          color: pal.muted,
        }}
      >
        {source}
      </div>
    </AbsoluteFill>
  );
};
