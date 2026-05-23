// Shared cabinet-colour helpers. Extracted from GovernmentTimeline so the
// /indicators KPI sparkline + CabinetScoreCard can paint the same bands as
// the multi-indicator timeline without duplicating the resolver chain
// (canonical-parties → legacy historical → neutral fallback) or the
// hex/rgb-to-rgba conversion the band fills use.

import { Government } from "@/data/governments/useGovernments";

export type ColorResolver = (nickName: string) => string | undefined;

export const FALLBACK_PARTY_COLOR = "#475569";

// Caretaker fallbacks for the historical predecessor labels we still ship in
// public/governments.json — these aren't current CEC nicknames, so the
// canonical resolver doesn't know them.
export const LEGACY_PARTY_COLORS: Record<string, string> = {
  "Реформаторски блок": "#9b59b6",
  "Патриотичен фронт": "#7f8c8d",
  "Обединени патриоти": "#7f8c8d",
};

export const resolvePartyColor = (
  nickName: string | undefined,
  colorFor: ColorResolver,
): string => {
  if (!nickName) return FALLBACK_PARTY_COLOR;
  return (
    colorFor(nickName) ?? LEGACY_PARTY_COLORS[nickName] ?? FALLBACK_PARTY_COLOR
  );
};

// Normalise rgb()/rgba()/hex inputs into the same rgba() representation with
// a chosen alpha. Recharts band fills and inline SVG <rect> backgrounds both
// take a CSS string, so we can't rely on canvas-only utilities.
export const withAlpha = (color: string, alpha: number): string => {
  const trimmed = color.trim();
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }
  if (trimmed.startsWith("#")) {
    const h = trimmed.slice(1);
    const expand =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    const r = parseInt(expand.slice(0, 2), 16);
    const g = parseInt(expand.slice(2, 4), 16);
    const b = parseInt(expand.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return trimmed;
};

export const colorForGovernment = (
  g: Government,
  colorFor: ColorResolver,
  alpha = 0.18,
): string => {
  if (g.type === "caretaker") return `rgba(120, 120, 120, ${alpha})`;
  return withAlpha(resolvePartyColor(g.parties[0], colorFor), alpha);
};

export const colorForGovernmentSolid = (
  g: Government,
  colorFor: ColorResolver,
): string => {
  if (g.type === "caretaker") return "#94a3b8";
  return resolvePartyColor(g.parties[0], colorFor);
};
