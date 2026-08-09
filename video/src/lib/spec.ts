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
 * Which persistent canvas the spec drives. Each has its OWN state shape, so the
 * spec is generic over it and the composition switches on this discriminant.
 *
 * It is a string rather than a component reference because Remotion's
 * `defaultProps` must survive JSON serialization — a component cannot travel in
 * props, so the composition resolves the name to one.
 */
export type CanvasKind = "inflation" | "risk";

/**
 * The 16:9 explainer. Unlike a short, scenes do not own a full-screen visual:
 * ONE canvas persists for the whole video and each scene declares only what it
 * CHANGES about it (`canvas`), plus the rail copy for its own beat.
 *
 * `C` is that canvas's state type. It defaults to `unknown` so a consumer that
 * only reads the language fields — `gate1`, `synthesize`, `emit_vtt` — can hold
 * specs with different canvases in one map without caring which.
 */
export type ExplainerScene<C = unknown> = {
  id: number;
  kicker?: string;
  stat?: string;
  headline: string;
  body?: string;
  onScreen: string;
  voiceOver: string;
  grounding?: { file: string; path: string };
  canvas?: Partial<C>;
  /**
   * Show a captured REAL page in the chart column for this scene instead of the
   * drawn canvas. The "this is the actual tool" beat.
   */
  screen?: { name: string; zoomAt?: number; cursor?: boolean };
};

export type ExplainerSpec<C = unknown> = {
  slug: string;
  kind: "explainer";
  /** Which persistent canvas this spec drives. */
  canvasKind: CanvasKind;
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
  voice: {
    provider: string;
    voiceId: string;
    /**
     * Delivery note handed to the engine, never spoken and never captioned.
     *
     * It lives on the SPEC rather than in the synthesis script because it is an
     * editorial choice — the register a video is narrated in — and because the
     * operator should see it at gate 1 next to the words it will shape.
     * Providers apply it differently; see `Provider.synthesize`.
     */
    direction?: string;
    /**
     * Playback-rate correction applied at RENDER time, pitch preserved.
     *
     * A delivery note fixes the engine's rushing but overshoots slightly, and the
     * note has no dial — you cannot ask for "8% faster than that". This is the
     * dial. Applied in the composition rather than baked into the WAVs so that
     * re-tuning costs a re-render and never a re-synthesis: the clips are the
     * expensive artifact (59 API calls, ~12 min) and the tempo is the cheap
     * opinion.
     *
     * Keep it inside roughly 0,9–1,15 — past that the pitch preservation starts
     * to smear consonants. Default 1 (no correction).
     */
    tempo?: number;
  };
  scenes: ExplainerScene<C>[];
};

/** Where a spec's per-scene audio lives, relative to `video/public/`. */
export const audioPath = (slug: string, sceneId: number) =>
  `voiceover/${slug}/${String(sceneId).padStart(2, "0")}.wav`;

/**
 * What the voice/caption scripts need from a spec, regardless of format — they
 * only ever touch the slug, kind, voice and each scene's id + voiceOver, so the
 * canvas type is irrelevant to them and stays unresolved.
 */
export type VoiceableSpec = ExplainerSpec;
