---
name: naiasno-video
description: Draft a Наясно explainer video and save a reviewable draft (never auto-publishes). Two formats — SHORT (30–50 s, 9:16, one data point, for Reels/Shorts) and EXPLAINER (2.5–5 min, 16:9, from an article, for YouTube + on-site). Grounds every figure in data/, writes a Bulgarian scene script with numbers spelled out for the voice track, synthesizes per-scene TTS, renders with Remotion and burns BG captions. Use when the user asks to "make a video", "create an explainer video", "turn this post into a video", "видео за <тема>", "направи видео", "запиши обяснение", to script a walkthrough of a site feature, or to turn a data finding / article / watcher report into a video.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Write
  - Edit
  - WebSearch
  - WebFetch
---

# Наясно — explainer video composer

Turns one grounded fact (or one article) into a publish-ready Bulgarian explainer
video: a scene script, a per-scene voice track, a Remotion render, burned BG
captions, a thumbnail and a draft note. Output is a **draft for the operator to
review and publish by hand** — this skill never uploads to YouTube or Facebook.

Sibling of `naiasno-post`. Same brand, same discipline, same refusal to publish.
Plan and full rationale: `docs/plans/explainer-video-v1.md`.

## Build state — the whole chain runs

The `video/` Remotion project exists and T1 renders end to end (phase 1, 2026-08-08).

```bash
npm run video:voice  -- <spec>     # per-scene TTS into video/public/voiceover/
npm run video:vtt    -- <spec>     # .vtt sidecar + transcript
npm run video:render -- <id> <out> # e.g. 2026-08-08-cost-per-vote--reel
npm run video:check                # typecheck video/ (NOT covered by `npm run build`)
npm run video:studio               # Remotion Studio, for retiming by hand
npm run video:fonts                # re-mirror Inter after scripts/fonts/fetch-fonts.mjs
```

A new short means a new spec in `video/src/specs/`, registered in
`video/src/Root.tsx` and in the `SPECS` maps of `scripts/video/synthesize.ts` and
`emit_vtt.ts`.

**Aspect cuts that work: 9:16 (1080×1920) and 4:5 (1080×1350).** 16:9 does not —
see `references/publish.md`. Do not add a landscape composition expecting a rescale
to work.

Measured on T1: **~2 min per cut** to render, 885 frames, ~2 MB.

## Two formats

| | **`short`** | **`explainer`** |
|---|---|---|
| Length | 30–50 s | 2.5–5 min |
| Aspect | 9:16 (Reels/Shorts) · also cut 1:1 for FB feed | 16:9 |
| Input | one data point — same input as a `naiasno-post` `data` post | one `public/articles/*-bg.md` |
| Scenes | 4–6 | 10–18 |
| Voice | TTS (same-day turnaround is the point) | prefer a human read — long shelf life |

**Default to `short`.** It shares an input with `naiasno-post`, so one finding yields
a card *and* a video; it is cheap to iterate on; and it is where the audience is.
An `explainer` is roughly 6× the work for a fraction of the reach — build one only
when asked, or when the topic is evergreen product education.

**Never read an article aloud.** At Bulgarian narration pace (~135 wpm) the median
BG article (~3,400 words) is 25 minutes. An `explainer` is a *derived* script that
picks one thread, not a narration of the text.

## Non-negotiable rules

Rules 1–5 are inherited from `naiasno-post` unchanged. 6–9 are video-specific.

1. **Grounded in our data.** Every figure comes from a real file under `data/` or
   `public/` and links to the matching on-site page. Never invent or estimate.
2. **Confirmed against public information.** Verified against the primary register
   (АОП, Сметна палата/bulnao, ЦИК, parliament.bg, data.egov.bg, Eurostat, НСИ) or a
   reputable report, via WebSearch/WebFetch. URL recorded in `sources`. If it cannot
   be confirmed, **do not draft** — report the discrepancy.
   *Exception:* when the topic comes from an existing entry in `brand/posts/index.json`,
   that post's `sources` already carry the confirmation. Reuse them and say so; do
   not re-confirm what is already recorded.
3. **No duplicates.** Dup-check before composing (step 1).
4. **Non-partisan, no emojis, plain Bulgarian.** Let the number be the point — no
   adjectives, no outrage, no party-side framing. This binds the voice-over and the
   on-screen text equally.
5. **Draft only.** Never upload, never post, never publish.
6. **Spoken ≡ shown.** Every scene's `voiceOver` figure must be the Bulgarian
   verbalization of the same scene's `onScreen` figure. A video that narrates one
   number while displaying another is the most damaging error this brand can ship.
   Enforced at gate 1 by a printed side-by-side — see step 4.
7. **Every number in the voice track is spelled out in Bulgarian words.** Digits and
   symbols stay on screen only. This is not a style preference; `bg-BG` has no
   pronunciation override, so it is the only correction lever that exists.
   → `references/voice.md`
8. **Caption everything.** Facebook autoplays muted; an uncaptioned Bulgarian voice
   track reaches nobody there. Burned-in for social, `.vtt` sidecar for YouTube.
9. **Check the artefact, not the preview.** Extract frames from the rendered MP4 and
   Read them before showing the operator. The Studio preview lies — and a missing
   glyph renders as a silent tofu box, since nothing throws.

## Pipeline

```
topic ─▶ dup-check ─▶ ground in data/ ─▶ confirm (or reuse a post's sources)
      ─▶ write the scene script (BG; numbers spelled out for VO)
      ─▶ ⛔ GATE 1 — operator reads the script            (nothing spent yet)
      ─▶ per-scene TTS ─▶ trim silence ─▶ render ─▶ captions ─▶ thumbnail
      ─▶ ⛔ GATE 2 — operator watches the render          (before any publish)
      ─▶ draft in brand/videos/drafts/<slug>.md
```

Both gates are mandatory. Gate 1 is the cheap one and catches most errors — nothing
is synthesized or rendered until a human has read the Bulgarian.

## Step 1 — Topic, format, dup-check

Three ways in:

- **From the user's request** — a named topic, post, or article.
- **From an existing post** (preferred for the first videos): pick an entry from
  `brand/posts/index.json` — its figure is already grounded *and* already confirmed,
  which removes a day's work and rule 2's research.
- **From fresh data**: `data-reports/latest.md`, same vein table as `naiasno-post`
  step 3.

Then dup-check. A video *of* an existing post is the intent, not a duplicate — what
must not happen is two videos of the same fact:

```bash
node_modules/.bin/tsx scripts/posts/post_tool.ts check "<entity, metric, year>"
```

Also check `brand/videos/index.json` if it exists. On high overlap with an existing
**video**, pick another angle.

## Step 2 — Ground every figure

Find the exact value and the on-site deep link. Data homes are the same table as
`naiasno-post` step 3 — read it there rather than duplicating it here.

Record per figure: exact value, dataset path, JSON path, deep link. These become the
scene's `grounding` block, and step 4 asserts against them.

**Reproduce the figure, do not copy it.** Both test videos found something by
recomputing from source rather than trusting the card:

- **T1** — the card called ПрБ the cheap pole at €0,58/vote. ГЕРБ-СДС is cheaper
  (€0,54). The scene now states the ratio to ИТН, which holds.
- **T2** — three attempts before the number matched. See the trap below.

**⚠️ Entity identity across time is the trap to expect.** `partyNum` in the election
data is a **ballot position, reassigned every election** — number 1 was ДОСТ in 2024
and ИТН in 2026. Comparing it across cycles compares different parties and reported
that ~100% of municipalities changed hands. Compare on party NAME, then fold renames
(`ДПС-НН → ДПС`, `БСП → БСП-ОЛ`) or the answer is 256 instead of 236.

**Check the denominator too.** The obshtina code list contains 24 Sofia районa and 6
abroad "continents"; Bulgaria has **265** municipalities, and Sofia's winner is the
sum of its районa. A denominator that is not 265 means the filter is wrong. Assert it
in the build script and refuse to write — `build_map_t2.ts` does.

When a published card exists, matching its figure **and its breakdown** is the
strongest available check that the recomputation is right.

## Step 3 — Write the scene script

The core of the skill, and where every avoidable error lives.

For each scene write four things:

- `onScreen` — the figure as a reader sees it: digits, decimal comma, €, `млн.`/`млрд.`
- `voiceOver` — the same fact in natural spoken Bulgarian, **every number as words**
- `visual` — the renderer and its data (→ `references/scenes.md`)
- `grounding` — file + path the `onScreen` value came from

**Read `references/voice.md` before writing any `voiceOver`.** It carries the
verbalization rules (gender agreement on 1/2, count forms, ordinal years, ЕИК
digit-by-digit, acronym handling) and the reason they cannot be fixed after the fact.
`scripts/video/passage.ts` holds six worked `raw`→`spoken` pairs built from real
published facts — the canonical examples, not invented ones.

**Budget the length here, not after the render.** Measured on the chosen voice:
**13.0 chars/s, 137 wpm**. A 40 s short is **~520 characters of `voiceOver` total,
~105 per scene** across five scenes. Budget from the spelled-out text — it runs
substantially longer than the on-screen figure it replaces (716 vs 433 chars on the
reference passage), so counting the digits under-estimates every time.

Structure a `short` as: hook (the surprising number) → context (what it is measured
against) → the twist → CTA. Structure an `explainer` as one thread through the
article, not a summary of it.

Writing rules: no emojis; non-partisan; natural Bulgarian, never a word-for-word
translation from English; close with the share line —
«Споделете, за да стигне Наясно до повече хора.»

## Step 4 — ⛔ GATE 1: the operator reads the script

Print, per scene, a three-column table: `onScreen` · `voiceOver` · `grounding`.

Assert mechanically (this half **is** automatable): every `onScreen` value equals the
value at its `grounding` path in `data/`. Fail the gate on any mismatch.

Do **not** claim to check `voiceOver` against `onScreen` mechanically — once numbers
are Bulgarian words, comparing them by machine needs the very verbalizer this design
avoids. Print both, extract the numeric tokens from `onScreen` and the number-word
spans from `voiceOver` beside each other so the check takes seconds, and require
explicit operator sign-off.

**Stop here and wait.** Nothing is spent yet.

## Step 5 — Voice

**The voice is already decided: `gemini` · `Rasalgethi` ·
`gemini-3.1-flash-tts-preview`** (`CHOSEN_VOICE` in `scripts/video/tts_bakeoff.ts`).
Put it in the spec's `voice` block and do not vary it between videos. It needs no
GCP setup — it runs on the `GEMINI_API_KEY` already in `.env.local`.

Per scene, one clip. Not one clip for the whole video — `bg-BG` has no pause control
on any provider we use, so pauses come from the edit, and per-scene clips are also
what the composition measures its own length from.

Three things that are not optional here, all learned the hard way — full detail in
`references/voice.md`:

- **Retry the transients and then assert one file per scene.** A 200 can carry no
  audio, and a connection can drop mid-generation; both lose a scene's narration
  while the run still reports success.
- **Trim leading/trailing silence adaptively** (`loudnorm` → `silencedetect`), or the
  cuts sag.
- **Budget the script by the measured rate — 13.0 chars/s, 137 wpm.** A 40 s short is
  ~520 characters of `voiceOver`, ~105 per scene across five. Check this at step 3,
  not after the render.

## Step 6 — Render, caption, thumbnail

Needs the `video/` Remotion project. If absent, stop after step 5 and say so.

`references/remotion.md` carries what must not be re-derived: the
`calculateMetadata` + audio-duration pattern, per-frame render stability, the
timing model, the markup gotchas, layout minimums, and why we do **not** use GSAP.
`references/publish.md` carries caption forms, thumbnail spec and aspect cuts.

## Step 7 — ⛔ GATE 2 and the draft

Extract 3–4 frames per render and **Read them** — look for tofu boxes, clipped text,
and any figure that disagrees with the script. Then write the draft:
`brand/videos/drafts/<slug>.md` + an entry in `brand/videos/index.json`, carrying the
`postSlug` cross-link when the finding also shipped as a card.

Show the operator: a frame or two, the BG script, the deep link, the sources, and
where the file is. Remind them it is unpublished.

## Spec shape

```jsonc
{
  "slug": "2026-08-10-cost-per-vote",
  "kind": "short",                        // short | explainer
  "title": "…",
  "link": "https://electionsbg.com/financing?elections=2026_04_19",
  "postSlug": "2026-08-02-cost-per-vote-april-2026",   // when a card exists
  "sources": ["data/financing/…json", "https://erik.bulnao.government.bg/…"],
  "voice": { "provider": "gemini", "voiceId": "Rasalgethi" },
  "scenes": [
    {
      "id": 1,
      "visual": { "type": "stat", "value": "6,79 €", "label": "на глас" },
      "onScreen": "6,79 €",
      "voiceOver": "шест цяло седемдесет и девет евро на глас",
      "grounding": { "file": "data/financing/…json", "path": "$.itn.eurPerVote" }
    }
  ],
  "cta": { "text": "Виж разбивката", "url": "…" }
}
```

`visual.type` mirrors `cardKit`'s renderer selection (`bars` → infographic,
`series` → line, `rows` → table, `stat` → single number) so video and card share one
design vocabulary. → `references/scenes.md`

## References — load on demand

Each is self-contained; load only what the current step needs.

| Load | When |
|---|---|
| [`references/voice.md`](references/voice.md) | writing any `voiceOver`, or choosing/configuring TTS |
| [`references/scenes.md`](references/scenes.md) | choosing a `visual.type`, animating a map, or scripting a walkthrough |
| [`references/remotion.md`](references/remotion.md) | writing or debugging composition code |
| [`references/publish.md`](references/publish.md) | captions, thumbnail, aspect cuts, YouTube/on-site, SEO |

## Preserve operator changes

This repo has a concurrent auto-committer and parallel sessions. If a spec,
composition or draft changed unexpectedly mid-task, assume it was deliberate —
ask before overwriting. Commit by explicit pathspec, never sweep the index.
