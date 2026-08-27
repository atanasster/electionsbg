---
name: naiasno-video
description: Draft a Наясно explainer video and save a reviewable draft (never auto-publishes). Two formats — EXPLAINER (the default: 16:9, one accreting chart, 10–15 min for a multi-part subject or 60–120 s for a single finding, for YouTube + on-site) and SHORT (25–50 s, 9:16, a cutdown for Reels). Grounds every figure in data/, writes a conversational Bulgarian scene script with numbers spelled out for the voice track, synthesizes per-scene TTS, renders with Remotion and burns BG captions. Use when the user asks to "make a video", "create an explainer video", "turn this post into a video", "видео за <тема>", "направи видео", "запиши обяснение", to script a walkthrough of a site feature, or to turn a data finding / article / watcher report into a video.
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
npm run video:render -- <id> brand/videos/<slug>/yt.mp4
npm run video:check                # typecheck video/ (NOT covered by `npm run build`)
npm run video:studio               # Remotion Studio, for retiming by hand
npm run video:fonts                # re-mirror Inter after scripts/fonts/fetch-fonts.mjs
npm run video:screens              # capture real app pages (needs `npm run dev`)
npm run video:data-inflation       # rebuild a spec's data layer + assert its claims
npm run video:data-risk            # ditto, for the election-risk explainer
npm run video:gate1  -- <spec>     # ⛔ GATE 1 — print the script + check what is checkable
```

A new video means a new spec in `video/src/specs/`, registered in
`video/src/Root.tsx` and in the `SPECS` maps of `scripts/video/synthesize.ts`,
`emit_vtt.ts` and `gate1.ts`.

**16:9 (1920×1080) is the explainer, via `Stage16x9` — its own layout, not a
rescale.** The shorts use 9:16 (1080×1920) and 4:5 (1080×1350) via `Frame`. Never
try to serve landscape by rescaling a portrait scene; see `references/publish.md`.

Measured on T1: **~2 min per cut** to render, 885 frames, ~2 MB. Render cost scales
with frame count, so budget a long-form cut at roughly its ratio — a 10-min video
is ~20× T1's frames. Synthesis scales with SCENE COUNT (one request each), and at
~50 scenes the transient-failure retries stop being theoretical.

## Where everything lives

**One folder per video, `brand/videos/<slug>/`**, holding the draft, the cuts, the
thumbnail, the captions and the transcript. The folder already carries the slug, so
the files inside are named by ROLE and never repeat it:

```
brand/videos/
  index.json                    the registry — dup-check reads this
  <slug>/
    draft.md                    the operator's review sheet
    yt.mp4                      16:9 cut     (reel.mp4 / feed.mp4 for portrait)
    thumb.png                   1280×720
    captions.vtt                YouTube sidecar
    transcript.txt              for the page under the embed
```

**`brand/videos/` is gitignored in full**, exactly like `brand/posts/` and for the
same reason: these are drafts until an operator publishes them by hand, and a
13-minute cut is ~49 MB against a repo that is already fighting a file-count ceiling.
Everything in there regenerates from the spec plus the voice-over.

Three things deliberately live OUTSIDE that folder, because a build step reads them
from a fixed place:

| Path | Why not in the video folder |
|---|---|
| `video/public/voiceover/<slug>/NN.wav` | Remotion's `staticFile()` resolves against `video/public` |
| `video/src/specs/<id>.ts` + `generated/<id>.json` | the composition imports them |
| `raw_data/video/tts_bakeoff/` | provider research, not a deliverable |

## Two formats — the EXPLAINER is the flagship

| | **`explainer`** ⭐ | **`short`** |
|---|---|---|
| Length | **10–15 min** (or 60–120 s for a single finding) | 25–50 s |
| Aspect | **16:9** (1920×1080) | 9:16 · also 4:5 for FB feed |
| Layout | `Stage16x9` — persistent chrome, chart + rail | `Frame` — one full-bleed visual |
| Visual | **ONE canvas that accretes** across scenes | a new visual per scene |
| Scenes | 40–60 long-form · 8–12 short-form | 4–6 |

**Length is declared per spec (`runtimeSeconds`), not inferred from `kind`**, and
gate 1 enforces the declared window. An explainer covering a topic with SEVERAL
components — an index built from five signals, a budget with eight lines — should
run long-form: at 90 s each component gets one sentence and the video becomes a
list of numbers, which is the failure the explainer format exists to fix. Reserve
the 60–120 s form for a single finding with one thread through it (E1).

**Default to `explainer`.** Decided 2026-08-08 after the shorts were judged too
simplistic: the card style is right for a thumb-scroll and wrong for a video, where
the audience has given you a minute and expects to be shown the working.

A `short` is now best understood as a **cutdown** — pick three scenes of the
explainer and re-cut them 9:16 — rather than as its own production.

### What makes an explainer not a slideshow

- **One canvas, mounted for the whole video**, which each scene only *changes* (a
  series fades in, the window widens, a marker drops). Information accretes. This
  forces the canvas OUTSIDE every `<Sequence>` — see `references/remotion.md`.
- **Chrome the social cards strip**: axis units, gridlines, year labels, a
  benchmark line, and the dataset id on screen throughout. That is what lets a
  viewer *check* the claim rather than take it.
- **Depth.** The shorts used six numbers where the dataset held 86 quarters. If the
  data has history, the history is usually the story.

**Never read an article aloud.** At ~135 wpm the median BG article (~3,400 words)
is 25 minutes. An `explainer` is a *derived* script that picks one thread.

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
4. **Non-partisan, no emojis, conversational Bulgarian.** Let the number be the
   point — no adjectives, no outrage, no party-side framing. This binds the
   voice-over and the on-screen text equally. Register table in step 3.
5. **Draft only.** Never upload, never post, never publish.
6. **Spoken ≡ shown.** Every scene's `voiceOver` figure must be the Bulgarian
   verbalization of the same scene's `onScreen` figure. A video that narrates one
   number while displaying another is the most damaging error this brand can ship.
   Enforced at gate 1 by a printed side-by-side — see step 4.
7. **Every number in the voice track is spelled out in Bulgarian words.** Digits and
   symbols stay on screen only. This is not a style preference; `bg-BG` has no
   pronunciation override, so rewriting is the only lever on WHICH SOUNDS come out.
   Pacing is a separate lever (`voice.direction`) — do not conflate them.
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
      ─▶ draft in brand/videos/<slug>/draft.md
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
**13,5 chars/s bare, 11,0 chars/s with a delivery note** — and every video should
carry a note, so budget at the directed rate. Declare the window as
`runtimeSeconds` on the spec and let `video:gate1` enforce it:

| Target | `runtimeSeconds` | `voiceOver` total | scenes | per scene |
|---|---|---|---|---|
| 40 s short | `[25, 50]` | ~440 chars | 5 | ~90 |
| 90 s explainer | `[60, 120]` | ~1 000 chars | 10 | ~100 |
| **12 min explainer** | `[600, 900]` | **~7 900 chars** | 50–60 | ~135 |

Budget from the spelled-out text — it runs substantially longer than the on-screen
figure it replaces (716 vs 433 chars on the reference passage), so counting the
digits under-estimates every time.

**Set `voice.direction`, then tune with `voice.tempo`.** A natural-language delivery
note ("read this as a calm documentary narrator…") is the difference between a read
that sounds like a person and one that sounds like a machine — measured at **22%
slower** across E2's 59 clips, exactly the rushing `references/voice.md` identifies
as the core defect. E2 shipped without one for a day and the operator's first note on
the render was that it sounded AI-generated. It is not optional polish.

The note has no dial, so it will land a few percent off. `voice.tempo` is the dial —
a pitch-preserved playback rate applied at render time, so re-tuning costs a
re-render and never a re-synthesis. **Judge both on the finished cut, not on a
clip:** pacing is the one property that only reveals itself over ten minutes, and
both of E2's pacing corrections came from watching, not from listening to a sample.

**Structure.** A `short` is hook → context → twist → CTA. A **90 s explainer** is
one thread through the finding. A **long-form explainer is parts, not scenes** —
name each part, and inside a part say what the thing MEASURES before you say what
it scored. The failure mode long-form removes is a video that recites numbers; the
failure mode it introduces is a video that lists sections. What prevents the second
is that each part has to *earn* its place by changing what the viewer believes.

Two things long-form buys that are worth spending scenes on, because at 90 s they
are the first casualties:

- **The confound in the same breath as the finding.** E2's concentration drop
  (592 → 145 settlements) is only publishable alongside the turnout rise that
  partly explains it. Three scenes: the drop, the confound, the refusal. At 90 s
  this had to be cut entirely rather than shipped half-stated.
- **The lesson, not just the number.** E2 spends a whole scene on «висока оценка не
  значи голямо число» — the thing a viewer needs in order to read the NEXT figure
  without you.

Writing rules: no emojis; non-partisan; **conversational** Bulgarian, never a
word-for-word translation from English and never compressed newspaper register.
No share line — a video ends on the finding and the deep link. (Sharing is a
platform button; asking for it out loud reads as begging and costs a beat.)

**Conversational means the phrasing a person would use out loud**, which is not
the phrasing that fits a chart caption. Prefer the plain verb and the full noun
phrase over the compact one, and drop metaphors that read fine but sound
writerly:

| Not this | This |
|---|---|
| индексът **показва** 47 | индексът **е** 47 |
| до него **пише** «висок» | до него **е отбелязано** «висок» |
| опират в **таван** от 0,2 | са близо до **границата** от 0,2 |
| **другаде** се задейства преброяване | **в някои държави** се задейства преброяване |
| средното от петте **прави** 47 | средното от петте **е** 47 |
| седем избора са **мерени** | седем избора са **оценявани** |
| **средното им** е 54 | **средната стойност** е 54 |
| а **върхът** — 77 | а **най-голямата** — 77 |
| последният **цикъл** | последните **избори** |

### Say the disclosure ONCE

A screening caveat — "this is not an accusation", "every signal has an innocent
explanation" — belongs at the **start**, stated properly, and then not again. E2's
first cut repeated it in five scenes and the operator's note was to cut it back to
one. Repetition does not make a caveat stronger; it makes the video sound defensive,
and it spends beats that could carry a finding.

The distinction to hold: a **disclosure** is generic and belongs once. What a
specific signal MEANS is not a disclosure and stays — «тези гласове не са сгрешени,
просто не могат да се проверят» is the definition of that signal, and «може да е
нормално, може и да не е» is the whole reason concentration is measured. Rewrite
those as statements about the metric rather than as apologies for it, and the
repetition disappears on its own.

### Put every figure in its own series

E2's integrity signals were compared against seven prior cycles from the first
draft; the five CONTEXT signals were presented bare, and the operator asked for the
same treatment. A number with no series behind it is not yet a finding — the viewer
has nothing to judge "is 39 a lot?" against.

Rank each against ITS OWN available set, not the headline's. Availability differs
per signal (Benford needs a qualifying party, a swing needs a prior cycle, polling
error needs agencies that published), so E2 ranks each across 9, 11 or 13 cycles and
carries the count in the sentence.

**⚠️ Derive the summary, never count it by eye.** The draft of E2's closing scene
said "two of the five are unusually high" — the two the script had dwelt on. Four of
five actually rank in the top two of their own series, and gate 1 caught it only
because the claim was grounded. Note also that a rank can be true and misleading:
Benford ranks 2nd of 13 while scoring 8 out of 100, because 11 of the 13 score zero.
When that happens, say what actually connects the high ones instead of leaning on
the count.

### Two editorial patterns worth reusing

**When the subject is an ABUSABLE number, turn it on itself.** A risk index over an
election is one number a reader can screenshot as proof of fraud. E2 is built so
nobody can use it that way — the scariest-looking component (90/100) turns out to be
under three thousand votes in one and a half million; the alarming label turns out to
be a fixed threshold that knows nothing about the past; and the one reading actually
maxed out is not an integrity signal at all. The video is *more* interesting for it,
not less, and that is the point: the defensive framing IS the story.

**Comparability across time is a claim, and usually the fragile one.** E2's index has
13 elections of history but only 7 are comparable, because the headline averages the
AVAILABLE signals and availability changed. A mean over three signals and a mean over
five are different statistics wearing the same number. Whenever a video puts a figure
next to its own past, ask what changed in the denominator, the coverage or the method
— and assert the comparable set in the build script so a refresh cannot widen it
silently.

## Step 4 — ⛔ GATE 1: the operator reads the script

```bash
npm run video:gate1 -- <spec>
```

`scripts/video/gate1.ts` prints every scene as `onScreen` · numeric tokens ·
number-word spans · `voiceOver` · `grounding`, and **fails** on: a digit anywhere in
a `voiceOver` (rule 7), a shown figure that does not resolve at its `grounding`
path, a shown figure with no `grounding` block at all, a scene over the char
ceiling, and a total outside the spec's `runtimeSeconds`.

Do **not** claim to check `voiceOver` against `onScreen` mechanically — once numbers
are Bulgarian words, comparing them by machine needs the very verbalizer this design
avoids. The gate prints the two columns side by side and the **operator** signs off
on rule 6.

**Read those two columns yourself before handing over.** The recurring defect is a
scene that DISPLAYS a figure the narration never speaks — it passes every
mechanical check, because the figure is grounded and the voice track is clean; the
two just never meet. Ten of E2's fifty-nine scenes had it on first draft. Either
speak the figure or move it out of `onScreen` into `body`, where it reads as
chart detail rather than as the scene's claim.

**Stop here and wait.** Nothing is spent yet.

## Step 5 — Voice

**The voice is already decided: `gemini` · `Rasalgethi` ·
`gemini-3.1-flash-tts-preview`** (`CHOSEN_VOICE` in `scripts/video/tts_bakeoff.ts`).
Put it in the spec's `voice` block and do not vary it between videos. It needs no
GCP setup — it runs on the `GEMINI_API_KEY` already in `.env.local`.

Per scene, one clip. Not one clip for the whole video — `bg-BG` has no SSML break
tag on any provider we use, so the pause BETWEEN scenes comes from the edit, and
per-scene clips are also what the composition measures its own length from. Pauses
WITHIN a scene come from `voice.direction`, which is a different lever and the one
that was missed.

Three things that are not optional here, all learned the hard way — full detail in
`references/voice.md`:

- **Retry the transients and then assert one file per scene.** A 200 can carry no
  audio, and a connection can drop mid-generation; both lose a scene's narration
  while the run still reports success.
- **Trim leading/trailing silence adaptively** (`loudnorm` → `silencedetect`), or the
  cuts sag.
- **Budget the script by the measured rate — 13.0 chars/s, 137 wpm.** The table is
  in step 3; `video:gate1` enforces the spec's declared `runtimeSeconds`. Check it
  at step 3, not after the render.

## Step 6 — Render, caption, thumbnail

Needs the `video/` Remotion project. If absent, stop after step 5 and say so.

`references/remotion.md` carries what must not be re-derived: the
`calculateMetadata` + audio-duration pattern, per-frame render stability, the
timing model, the markup gotchas, layout minimums, and why we do **not** use GSAP.
`references/publish.md` carries caption forms, thumbnail spec and aspect cuts.

## Step 7 — ⛔ GATE 2 and the draft

Extract 3–4 frames per render and **Read them** — look for tofu boxes, clipped text,
and any figure that disagrees with the script. Then write the draft:
`brand/videos/<slug>/draft.md` + an entry in `brand/videos/index.json`, carrying the
`postSlug` cross-link when the finding also shipped as a card. Paths inside the draft
are relative to its own folder — the point of the layout is that "where is the MP4"
has one answer.

Show the operator: a frame or two, the BG script, the deep link, the sources, and
where the file is. Remind them it is unpublished.

## Spec shape

The authority is `ExplainerSpec` in `video/src/lib/spec.ts` — read it rather than
this sketch if the two disagree.

```jsonc
{
  "slug": "2026-08-09-election-risk-explainer",
  "kind": "explainer",
  "runtimeSeconds": [600, 900],           // gate 1 enforces this window
  "title": "…",
  "topic": "Изборен риск",                // persistent header chrome
  "period": "юли 2021 — април 2026 · 7 сравними избора",
  "sourceLine": "Източник: ЦИК … · naiasno.bg",
  "link": "https://electionsbg.com/risk-analysis?elections=2026_04_19",
  "postSlug": "…",                        // when a card carries the same finding
  "sources": ["data/…json", "https://results.cik.bg/…"],
  "voice": { "provider": "gemini", "voiceId": "Rasalgethi" },
  "scenes": [
    {
      "id": 16,
      "kicker": "Защо тогава 90",          // rail copy for this beat
      "stat": "90",
      "headline": "Границата е 0,2%",
      "body": "Прагът, при който в някои държави\nсе задейства преброяване.",
      "onScreen": "0,18% спрямо 0,2%",     // the scene's CLAIM — must be spoken
      "voiceOver": "Защо тогава деветдесет? Защото нула цяло осемнайсет процента …",
      "grounding": { "file": "video/src/generated/risk.json", "path": "$.facts…" },
      "canvas": { /* what this scene CHANGES about the one persistent visual */ }
    }
  ]
}
```

`onScreen` is the scene's declared claim and gate 1 checks it both ways. `body` is
supporting detail — an exact denominator too long to say aloud belongs there, not in
`onScreen`. Scenes do not own a visual: they declare a `canvas` delta.
→ `references/scenes.md`

**Ground every figure in a generated data layer, not in `data/` directly.** A build
script (`scripts/video/build_risk.ts`, `build_inflation.ts`) recomputes the story
from source, **asserts every claim the narration makes, and refuses to write** when
one moves. Where the site already computes the figure, call the site's own function
rather than re-deriving it — a video explaining a number must not own a second
definition of that number.

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
