# Remotion — composition practices for this project

Load when writing or debugging composition code. Distilled from `remotion-dev/skills`
(the Remotion team's own agent skills, pinned to `4.0.507`) plus this project's
constraints. Rationale: `docs/plans/explainer-video-v1.md` §11–12.

**Pin this file's assumptions to a Remotion version when the project is created**, so
a stale reference is visible rather than silently wrong.

## The one architectural rule

**The composition sizes itself from the audio, not the other way round.**

Synthesize one clip per scene, measure each with `getAudioDuration()` (mediabunny —
works in Node, **not ffprobe**), and return the total from `calculateMetadata`. Scene
lengths and narration then cannot drift apart by construction.

```tsx
export const calculateMetadata: CalculateMetadataFunction<Props> = async () => {
  const durations = await Promise.all(
    SCENE_AUDIO.map((f) => getAudioDuration(staticFile(f))),
  );
  return { durationInFrames: Math.ceil(durations.reduce((a, d) => a + d * FPS, 0)) };
};
```

Pass the per-scene durations into the component as a prop so scenes know their own
length. This is Remotion's documented voice-over pattern — useful corroboration,
since `bg-BG`'s missing pause control forces the same architecture on us anyway.

## Markup practices

- **`premountFor` on every `<Sequence>`.** Remotion's own instruction is literally
  "Always premount any `<Sequence>`!" Without it a scene's assets pop in on entry.
  `<Sequence premountFor={1 * fps}>`.
- **`useCurrentFrame()` is LOCAL inside a `<Sequence>`** — 0-based, not timeline
  absolute. The classic off-by-a-scene bug.
- **`<Series>` for sequential scenes**, with negative `offset` for overlaps. This is
  the scene model already; do not hand-roll frame offsets.
- **Time-based timing.** Key animation off `t = frame / fps` with constant per-item
  durations, never off a slice of a global progress value. See the map rule in
  `references/scenes.md` — it is a real bug, not a style note.
- **`output: 'perceptual-scale'`** on scale interpolations; linear scale reads as
  decelerating.
- **`useDelayRender()`** to hold the render while data loads. Any composition that
  reads a `data/` file needs it.

## Keep it Studio-editable — this is a workflow requirement, not taste

Keep `interpolate()` **inline in the `style` prop**, and use individual CSS transform
properties rather than `transform` strings:

```tsx
// 👍 Studio can read and write these back to code
style={{
  scale: interpolate(frame, [0, 20], [0.9, 1], { extrapolateRight: "clamp" }),
  translate: interpolate(frame, [0, 20], ["0px 20px", "0px 0px"]),
}}

// 👎 opaque to Studio — becomes a computed value
const y = interpolate(frame, [0, 20], [20, 0]);
style={{ transform: `translateY(${y}px)` }}
```

Why it matters here: it lets the **operator** nudge pacing against the Bulgarian voice
track directly in Studio, instead of describing the problem and waiting for a code
change. That turns gate 2 from a report-and-fix loop into a self-service one, which
for a solo operator is the most valuable property in the pipeline.

Use `transform` strings only for `skew()`, `perspective()`, or order-sensitive chains.

## Do not add GSAP

Decided 2026-08-08 (`docs/plans/explainer-video-v1.md` §12a). Free since April 2025, so
cost is not the reason.

- Remotion renders each frame as a pure function of `frame`, possibly out of order and
  in parallel. GSAP runs on its own wall-clock ticker; they meet only through a bridge
  (`paused: true` + `tl.seek(frame / fps)` per frame). Skip the bridge and a 4-second
  animation renders in ~1 second with the rest black.
- It costs the Studio editability above.
- Of the eight things GSAP is known for, six are a few lines natively here — stagger is
  a `.map()` with offset interpolation, DrawSVG is `strokeDashoffset`, MotionPath is
  `getPointAtLength()`, SplitText is `[...text].map()`, custom eases are `Easing.bezier`
  plus **`d3-ease`, already installed**. The two it clearly wins (MorphSVG, Flip) are
  the two this content does not need — and `Flip` measures live DOM state, which a
  seeked out-of-order renderer handles worst.
- `remotion-dev/skills` is ~60 files of the vendor's own animation guidance and never
  mentions GSAP once.

**Revisit only on a named trigger:** a shot that genuinely needs shape morphing; a
motion designer who thinks in GSAP timelines; or a specific named shot where
`interpolate` demonstrably fails. It is free and adoptable for a single scene, so this
is cheap to reverse — do not treat it as doctrine.

Stack: `interpolate` + `spring` + `Easing` + `d3-ease`.

## Render stability

Mostly relevant to WebGL/canvas content. `references/scenes.md` avoids tile maps for
exactly these reasons, but the rules generalize.

- **Never move a WebGL camera per frame.** `map.jumpTo()` each frame makes the basemap
  shimmer in headless renders. Render one oversized static plate and move it with CSS
  `translate`/`scale`. Same pattern is the zoom mechanism for walkthrough captures.
- **Keep any canvas dimension ≤ 4096 px.** Do not reflexively render at 3×: 1920 × 3 =
  5760 and Chromium may **silently downsample** — soft output, nothing in the logs.
- **The async-content harness** is `delayRender → mutate → once('idle') →
  continueRender → triggerRepaint`. Generalizes past maps to anything imperative or
  asynchronous, including reading a `data/` file at render time.
- **WebGL renders want** `preserveDrawingBuffer: true`, `--gl=angle`, concurrency 1
  while validating.
- **Distinguish the failure modes:** repeating shimmer = the live renderer is moving;
  steadily soft during a push = the plate is underspecified or being scaled above 1.

## Verify the artefact, not the preview

**Render an MP4 and inspect it. Never approve from the Studio preview** — Remotion's
own guidance is "do not approve it as a minor preview artefact."

This is the same lesson as the glyph check, reached independently. Extract 3–4 frames
per render and Read them, looking for tofu boxes, clipped text, and any figure that
disagrees with the script.
