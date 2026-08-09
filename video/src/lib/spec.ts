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
  /**
   * Show a captured REAL page in the chart column for this scene instead of the
   * drawn canvas. The "this is the actual tool" beat.
   */
  screen?: { name: string; zoomAt?: number; cursor?: boolean };
};

export type ExplainerSpec = {
  slug: string;
  kind: "explainer";
  title: string;
  /**
   * Declared narration window in seconds, `[min, max]`, enforced by gate 1.
   *
   * Length belongs to the SPEC and not to `kind`, because the same format serves
   * two very different jobs: a single finding with one thread through it runs
   * 60–120 s (E1), while a subject with several components — an index built from
   * ten signals — runs 10–15 min. Forcing the second into the first gives every
   * component one sentence and turns the video into a list of numbers, which is
   * the failure the explainer format exists to fix.
   */
  runtimeSeconds: [number, number];
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
export type VoiceableSpec = ExplainerSpec;
