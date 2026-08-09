import type { PeerGeo } from "../components/Flag";
import type { CanvasState } from "./canvasState";

/**
 * The video spec — the same shape the `naiasno-video` skill writes and the
 * operator signs off at gate 1.
 *
 * `onScreen` and `voiceOver` are deliberately separate fields carrying the SAME
 * fact in two forms: digits for the eye, Bulgarian words for the ear. Rule 6 of
 * the skill (spoken must equal shown) is a property of this pair, and rule 7 is
 * why `voiceOver` may not contain digits at all.
 */

export type Bar = {
  label: string;
  /** Plotted magnitude. */
  value: number;
  /** Pre-formatted display string — keeps Bulgarian decimal commas exact. */
  display: string;
  /** Second line under the label, e.g. a seat count. */
  note?: string;
  /** Draws in `accent` instead of `cool` — at most one or two per chart. */
  emphasis?: boolean;
  /**
   * Renders the country flag before the label. Inline SVG, never emoji — an
   * emoji flag depends on the render host having an emoji font, which headless
   * Chromium often lacks.
   */
  geo?: PeerGeo;
};

export type Visual =
  | { type: "stat"; value: string; label: string; sub?: string }
  | { type: "bars"; title: string; bars: Bar[]; unit?: string }
  | {
      type: "map";
      title: string;
      sweepSeconds?: number;
      legend?: { changed: string; kept: string };
    }
  | { type: "outro"; title: string; cta: string; url: string };

export type Scene = {
  id: number;
  visual: Visual;
  /** The figure exactly as a reader sees it. Asserted against `grounding`. */
  onScreen: string;
  /** Natural spoken Bulgarian, every number as words. Never contains digits. */
  voiceOver: string;
  /** Where `onScreen` came from — checked mechanically at gate 1. */
  grounding?: { file: string; path: string };
};

export type VideoSpec = {
  slug: string;
  kind: "short" | "explainer";
  title: string;
  link: string;
  /** The `brand/posts` entry this shares a finding with, when there is one. */
  postSlug?: string;
  sources: string[];
  voice: { provider: string; voiceId: string };
  scenes: Scene[];
};

/**
 * The 16:9 explainer. Unlike a short, scenes do not own a full-screen visual:
 * ONE canvas persists for the whole video and each scene declares only what it
 * CHANGES about it (`canvas`), plus the rail copy for its own beat.
 */
export type ExplainerScene = {
  id: number;
  kicker?: string;
  stat?: string;
  headline: string;
  body?: string;
  onScreen: string;
  voiceOver: string;
  grounding?: { file: string; path: string };
  canvas?: Partial<CanvasState>;
};

export type ExplainerSpec = {
  slug: string;
  kind: "explainer";
  title: string;
  /** Persistent header chrome — provenance is part of the argument here. */
  topic: string;
  period: string;
  sourceLine: string;
  link: string;
  postSlug?: string;
  sources: string[];
  voice: { provider: string; voiceId: string };
  scenes: ExplainerScene[];
};

/** Where a spec's per-scene audio lives, relative to `video/public/`. */
export const audioPath = (slug: string, sceneId: number) =>
  `voiceover/${slug}/${String(sceneId).padStart(2, "0")}.wav`;

/**
 * What the voice/caption scripts need from a spec, regardless of format — they
 * only ever touch the slug, kind, voice and each scene's id + voiceOver.
 */
export type VoiceableSpec = VideoSpec | ExplainerSpec;
