// SceneFrame — the wrapper every infographic "scene" renders inside, and the
// single source of the scene drawing contract:
//
//   • viewBox is ALWAYS `SCENE_VIEWBOX` (300×116) so every scene composes at the
//     same aspect on a banner or a mobile thumbnail.
//   • Structural ink = `currentColor`. The frame sets the SVG's text colour to a
//     muted theme foreground, so ink flips light/dark for free — never hardcode
//     a grey.
//   • The accent pop = `var(--sector)`. The host tile sets `--sector` from a
//     TILE_ACCENTS token; scenes just reference the variable.
//   • "Paper" fills (a receipt body, film frames — shapes that sit UNDER ink) use
//     `PAPER` (= the card colour) so they read on both the cream and navy ground.
//   • Scenes are DECORATIVE: the frame is `aria-hidden`, because the tile's
//     visible title already names it. Never put a per-scene aria-label (it would
//     duplicate the title and, worse, wouldn't be localized).

import { FC, PropsWithChildren } from "react";
import { cn } from "@/lib/utils";

export const SCENE_VIEWBOX = "0 0 300 116";

/** Under-ink fill that must read on both grounds — use for "paper" shapes. */
export const PAPER = "hsl(var(--card))";

export const SceneFrame: FC<PropsWithChildren<{ className?: string }>> = ({
  children,
  className,
}) => (
  <svg
    viewBox={SCENE_VIEWBOX}
    className={cn("block h-auto w-full text-foreground/70", className)}
    aria-hidden
    focusable="false"
  >
    {children}
  </svg>
);
