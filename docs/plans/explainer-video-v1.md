# Explainer videos for Наясно — options research (v1)

Research date: **2026-08-08**. Scope: how to produce Bulgarian-voiced explainer
videos from this repo's own data and articles, and where to host them. Ends with
a recommended stack and the shape of a `naiasno-video` skill.

Nothing here is built yet — `grep -rn "VideoObject|<video|youtube.com/embed" src/ scripts/`
returns nothing. This is a greenfield decision.

---

## 0. What this repo already has that a video pipeline should reuse

Four existing assets change the calculus, and any option that can't use them is
paying twice:

| Asset | Where | Why it matters for video |
|---|---|---|
| Card renderer + brand palette | `scripts/posts/cardKit.ts` | Navy `#0b1224` / coral `#df6b43` theme, wordmark, bar/line/table renderers — already tuned for Cyrillic. A video frame is the same design problem at 1920×1080×30. |
| Live-page screenshotting | `scripts/capture-*.mjs` (7 files, Playwright, 2× DPI, clip-by-heading) | Already the way article images are made. The same code records the real dashboard as video frames. |
| The post skill's discipline | `.claude/skills/naiasno-post/SKILL.md` (312 lines) | Grounding gate, dup-check, non-partisan/no-emoji rules, draft-never-publish, `post_tool.ts save`. The video skill should be this skill's sibling, not a new invention. |
| The GCS bucket | `gs://data-electionsbg-com` (`scripts/bucket_sync_paths.ts`) | Somewhere to put MP4s that is **not** `dist/`. See §4 — this is load-bearing. |

And one existing constraint that rules out an obvious approach: **Firebase
hosting has failed to deploy at 453k files** (`docs/plans/…`, CLAUDE.md). `dist/`
is already ~248k files. Video files must never enter `dist/`.

Source article lengths (BG): 902–6,842 words, median ~3,400. At Bulgarian
narration pace (~130–140 wpm) a 3,400-word article read aloud is **25 minutes**.
So a long-form video is a *derived script*, never a read-aloud of the article.

---

## 1. Three separable choices

People treat "make explainer videos" as one decision. It is three, and they can
be picked independently — which means you can get the voice right first and
change the picture later without redoing anything.

1. **Voice** — which TTS speaks Bulgarian well enough to carry a serious data brand.
2. **Picture** — how frames get generated (code-rendered? screen-recorded? AI-generated? avatar?).
3. **Distribution** — YouTube, on-site, or both; and what the SEO wiring is.

Choice 1 is the one with a clear, non-obvious winner. Choice 2 has a clear winner
*for this repo specifically*. Choice 3 is a both/and.

---

## 2. Voice — Bulgarian TTS

### The landscape, checked against primary docs

| Provider | bg-BG voices | Tier / quality | Price | Verdict |
|---|---|---|---|---|
| **Google Cloud TTS** | **30 Chirp 3 HD** + 1 Standard | Chirp 3 HD is Google's current premium LLM-based tier | **$30 / 1M chars**, **1M chars/mo free** | **Recommended default** |
| Azure AI Speech | **2** — `bg-BG-KalinaNeural`, `bg-BG-BorislavNeural` | Plain neural. **No** Neural HD, **no** multilingual, **no** styles/roles for bg-BG | ~$16 / 1M chars | Cheap, but two dated voices and zero prosody control |
| ElevenLabs | Bulgarian (`bul`) via Eleven v3 (70+ langs) | Best-in-class *on major languages*; vendor-adjacent reviews note quality on **lower-traffic languages is uneven** | ~$0.30 / 1k chars (Creator) → **$300 / 1M**, $0.24/1k on Pro | 10× Google. Only worth it if a listen test proves it |
| OpenAI / Gemini TTS | Multilingual, bg not separately documented | Steerable, good prosody control | mid | Wildcard — include in the bake-off |

**The non-obvious finding:** Azure is most people's reflex for Bulgarian and it is
the *weakest* option here — Microsoft's own language-support page lists exactly two
bg-BG voices with no HD variant and no expressive styles, while Google lists **30
Chirp 3 HD** voices. If you assumed BG was a two-voice backwater, that stopped
being true.

**Free tier does the whole job.** 1M chars/month free on Chirp 3 HD. A 3-minute
explainer script is ~2,600 characters. That is **~380 free videos a month** before
a cent is spent. Cost is not a factor in this decision — quality is.

*(Pricing above is from a third-party summary; Google's own pricing page truncated
on fetch. Confirm the $30/1M rate and the 1M free allowance in the Cloud console
before relying on the number. It does not change the recommendation — Chirp 3 HD
would still win at 3× that price.)*

### Chirp 3 HD's Bulgarian is more limited than its voice count suggests

Verified against Google's own Chirp 3 HD page. Two capability tables list locale
exclusions, and **`bg-bg` is in both**:

- **No pause control.** The `[pause]` / `[pause short]` / `[pause long]` markup is
  unsupported for `bg-bg` (excluded alongside cs, el, et, he, hr, hu, lt, lv, pa,
  ro, sk, sl, sr, yue).
- **No custom pronunciations.** `bg-bg` is excluded there too (a longer list of 27
  locales). There is **no phoneme override** for Bulgarian.

Plus the model-wide limits: SSML support is a restricted tag subset on synchronous
requests only (nothing on streaming). `speaking_rate` (0.25×–2×) *is* available for
all locales, so global pacing is controllable.

Three consequences, all of which tighten the design rather than break it:

1. **Per-scene synthesis is mandatory, not merely convenient.** Since the API
   cannot insert a pause in Bulgarian, every pause must come from the *edit* —
   scene boundaries and inserted silence. §5's per-scene approach was already the
   plan; this removes the alternative.
2. **The "spell numbers out" fix is now the only lever, not one of several.**
   There is no `<phoneme>` fallback for Bulgarian, so orthographic rewriting in the
   script is the sole way to correct anything the model says wrong.
3. **The bake-off must test the hard cases, not a generic paragraph** (below).

### Decide by bake-off, not by table

Bulgarian TTS quality claims are unverifiable from documentation. Synthesize **one
identical passage** across Chirp 3 HD (3–4 voice picks), Azure Kalina + Borislav,
and ElevenLabs v3, and listen.

Because Bulgarian has no pronunciation override, the passage must be built from the
things that have **no fix if they come out wrong** — not a generic sentence:

- **Institution acronyms:** АОП, НЗОК, ЦАИС ЕОП, ДФЗ, КЗК, ЕИК, ДЗИ, НВО.
- **Hard place names** from real posts: Ружинци, Неделино, Крушари, Малко Търново, Самуил, Безмер.
- **Money in euro, decimal comma:** 6,79 €/глас · 4,23 млн. евро · €1,2 млрд.
- **Percent with decimals and a year:** 43,4% · 2024 г. · 5,38.
- **A digit string that must not be read as a number:** ЕИК 000695089.

Budget: under $1 and one afternoon. Commit it as `scripts/video/tts_bakeoff.ts` so
the test is repeatable when a provider ships a new model — and so the *same* passage
can be sent to a human narrator for an apples-to-apples comparison (§2b).

### 2b. The option the first draft of this plan missed: a human narrator

This plan initially considered only synthetic voices. That was a gap, and at this
volume the omission is not obviously the right call.

For a brand whose entire proposition is credibility and whose stated voice is
"let the number be the point", a real Bulgarian narrator is the reference standard —
and it dissolves every problem in §2 at once: no verbalization rules, no acronym
mispronunciation, no missing pause control, no uncanny-valley risk on a serious
subject.

**Cost, honestly held:** general freelance narration runs roughly $50–500/hour
depending on experience, and Bulgarian rates sit well below Western European ones
(ERI puts the average Bulgarian voice actor at ~€17k/year). A 40-second short is
plausibly **€15–40 per script**, so 8 shorts/month lands somewhere near
**€120–320/month**. That figure is an estimate from thin public data, not a quote —
**get two real quotes before treating it as fact.**

**The real cost is not money, it is latency.** TTS turns a script into audio in
seconds, so a finding can go from watcher report to published video the same day.
A human introduces a turnaround of hours-to-days and a dependency on one person's
availability, which kills the "post the thing that moved today" use case that makes
this worth doing at all.

**Recommendation:** treat it as a *tier*, not an either/or —

- **TTS** for time-sensitive shorts, where same-day beats better-sounding.
- **A human** for the long-form explainers (§5) and any evergreen pillar video,
  where the piece has a long shelf life and the quality difference compounds.

Put a human read of the bake-off passage next to the three synthetic ones. If the
gap is small, TTS wins everywhere on latency alone; if it is large, you have learned
that before building a pipeline around the wrong voice.

### The problem that will actually bite: Bulgarian number verbalization

This is the sleeper issue and it is worse in Bulgarian than in English.

Every headline on this site is a number, and TTS engines verbalize numbers with a
language-specific rule set that is thin for BG. Concretely, what breaks:

- **Currency.** The site moved to EUR on 2026-01-01. `1,2 млрд. евро` — the engine
  must read the comma as a decimal (BG convention), expand `млрд.`, and inflect.
  Reading it as "едно запетая две" or "1,2 милиард" is instantly wrong to a native ear.
- **Gender agreement on 1 and 2.** Bulgarian inflects: `два договора` (masc) but
  `две поръчки` (fem). A generic verbalizer has no idea which noun follows.
- **Masculine count form.** `5 договора`, not `5 договори`.
- **Ordinals and years.** `2024 г.` → „две хиляди двайсет и четвърта година".
- **Percent decimals.** `30,1%` → „трийсет цяло и една десета процента".
- **Identifiers.** `ЕИК 000695089` must be read digit-by-digit, never as a number.
- **Abbreviations.** `АОП`, `НЗОК`, `ЦАИС ЕОП`, `ДФЗ` — letter-by-letter or as a
  word, and the engine will guess wrong at least some of the time.

**The fix, and it is clean:** the skill writes the voice-over script with every
number **already spelled out in Bulgarian words**, and keeps the digit form only
in the on-screen text. TTS then never verbalizes anything — it reads prose.

```
onScreen:  "€1,2 млрд."                      ← grounded against data/, rendered as text
voiceOver: "един цяло и два милиарда евро"   ← what the TTS is handed
```

This costs nothing (the model composing the script is already writing Bulgarian),
removes an entire class of failure, and — usefully — makes the spoken form a thing
a human reviewer can check by reading, before any audio is generated.

It is the same reasoning that produced `cardKit.ts`, whose header says image models
"mangle Cyrillic" so cards are drawn with a real text renderer instead. Same
principle, applied to the audio track: don't hand Cyrillic-specific work to a
system that treats it as a long-tail case.

---

## 3. Picture — how frames get made

### Option A — Remotion (React) ✅ recommended primary

Write the video as React components; render to MP4 via headless Chrome + ffmpeg.

**Why it fits this repo unusually well:**
- The site is React 19 + TypeScript + Recharts. Remotion videos are React +
  TypeScript, and can import the site's actual chart components and theme tokens.
  A chart in the video is *the same chart* as on the page, not a lookalike.
- It is data-driven by design: props in, video out. One template → a video per
  município, per contractor, per week. That is exactly the shape of this data.
- Timing can be driven by the TTS audio, so narration and visuals cannot drift.
- Captions from SRT/VTT are first-class — which matters enormously for Facebook
  (autoplay is muted).

**Licensing:** free for individuals and companies with **≤3 employees**, including
commercial use, and **local rendering incurs no additional fee** (cloud rendering
units are only for their Lambda product). A solo operation qualifies. A company
license starts at $100/mo minimum (4 seats @ $25) if the team grows past 3 —
worth knowing as a future cost, not a present one.

**Cost:** $0 today. Renders on your own machine.

### Option B — Playwright screen capture of the live site ✅ recommended as an asset source

You already do this for stills (`scripts/capture-*.mjs`). Extended to video, it
records the real `/procurement/contract/…` page scrolling, a map filtering, the
tax simulator's sliders moving.

Its value is credibility: "this is the actual tool, go use it" is a stronger beat
than a re-drawn animation, and it doubles as a UI smoke test (the existing capture
scripts already log a skip when a heading disappears). Its limits are that timing
is hard to control precisely and re-recording is needed whenever the UI changes.

**Use it for one or two beats inside a Remotion composition**, not as the whole video.

### Option C — AI avatar presenters (HeyGen / Synthesia) ⚠️ probably not

HeyGen: 30+ languages core, 175+ for TTS, ~$1/min of 1080p avatar video via a
pay-as-you-go API; Synthesia is the enterprise-governance equivalent. Neither
vendor's marketing confirms Bulgarian avatar lip-sync quality specifically, so it
would need its own bake-off.

The stronger objection is brand fit. This site's stated voice is non-partisan,
no-emoji, "let the number be the point". A synthetic presenter reads as
content-farm and invites exactly the credibility attack a transparency site cannot
afford. **Recommend against for the core format.** Possible later for a
short-format host if you ever want a face.

### Option D — Generative video (Sora / Veo / Runway) ❌ rules itself out

These cannot render exact Cyrillic text or exact numbers — the two things every
frame of this content is made of. `cardKit.ts` already documents this failure mode
for still images. Fine for a 2-second abstract B-roll transition; useless for the
substance.

### Option E — Hosted template APIs (Creatomate / JSON2Video / Shotstack)

JSON-spec-in, MP4-out, no local render. Genuinely simpler, and they wrap Azure/
ElevenLabs TTS. But: per-render cost, a template language weaker than React, no
reuse of the site's chart components, and BG font handling is one more thing to
verify remotely. **Only worth it if local rendering proves too slow or too fiddly.**

### Recommendation

**Remotion as the composition engine, with Playwright captures as one asset type
inside it, and `cardKit`'s palette as the shared design token source.** Rule out
generative video for substantive frames; hold avatars in reserve.

---

## 4. Distribution and hosting

### YouTube — yes, as the canonical host

- **Upload automation works:** YouTube Data API v3, `videos.insert` costs **1,600
  quota units** against a default **10,000 units/day** → **~6 uploads/day**
  without asking for anything. That is far beyond any realistic cadence here.
  (Going past it requires a compliance audit — not a concern at this volume.)
- Gives search/discovery surface the site does not have, which speaks directly to
  the known **SEO discovery gap** (broader-data pages at ~0 GSC impressions).
- Free bandwidth, free transcoding, free player.

### On-site — yes, embedded, with the schema

Embed the YouTube player on the relevant article/hub page and add **`VideoObject`
structured data** to that page. Google's guidance: `embedUrl` for a YouTube embed,
`contentUrl` for a self-hosted file — at least one must be present for video
indexing. For a growing library, also emit a **video sitemap** shard.

This is where the existing prerender infrastructure earns its keep: the site
already prerenders `<meta>` because "SPA + Firebase rewrite hides React `<meta>`"
(`feedback_static_seo`). The same applies to `VideoObject` JSON-LD — it must be
prerendered, not injected client-side, or Google will never see it. Slot it into
`scripts/prerender/` alongside the existing head-tag emission, and add a
`sitemap_video.xml` shard next to `sitemap_judiciary.xml`.

### Self-hosting — only if you want a cookie-free player

If GDPR-clean, no-YouTube-branding embeds matter:

| Option | Cost | Note |
|---|---|---|
| **Existing GCS bucket** (`gs://data-electionsbg-com`) | storage + egress only | Simplest. No new vendor. No adaptive bitrate — fine for ≤3 min 1080p |
| **Cloudflare Stream** | **$1 / 1,000 min delivered**, encoding + storage bundled | Best value for VOD; adaptive bitrate, real player |
| **Bunny Stream** | ~half of Cloudflare for basic hosting | Cheapest |
| Mux | $0.07/min encode + delivery on top | Overkill — priced for live + analytics products |

**Recommendation:** YouTube as canonical + on-site embed + `VideoObject` +
video sitemap. Add the GCS-hosted MP4 later only if a cookie-free player is wanted;
skip Cloudflare/Bunny until volume justifies a vendor.

**Hard rule:** MP4s go in the **bucket**, never in `dist/`. Firebase's deploy
ceiling is on file *count* and `dist/` is already ~248k. Also note
`bucket_sync_paths.ts` refuses unlisted subtrees by design — a `video/` subtree
needs an explicit entry there, not a silent upload.

---

## 5. The skill — `naiasno-video`

Build it as **naiasno-post's sibling**, reusing its proven shape rather than
inventing a second discipline. That skill's rules — grounded in `data/`, confirmed
against a primary public source, dup-checked, non-partisan, no emojis, natural
Bulgarian, **saves a draft and never publishes** — all transfer unchanged.

### Two formats, one skill

| | **Short** (`kind: short`) | **Long** (`kind: explainer`) |
|---|---|---|
| Length | 30–50 s | 2.5–5 min |
| Aspect | 9:16 | 16:9 |
| Source | one data point (same input as a `data` post) | one article under `public/articles/*-bg.md` |
| Target | FB/IG Reels, YouTube Shorts | YouTube + on-site embed |
| Scenes | 4–6 | 10–18 |

The short format is the higher-value one to build first: it shares an input with
the post skill (so a single finding yields a card *and* a video), it is cheap to
iterate on, and it is where the audience is.

### Pipeline

```
topic ─▶ dup-check ─▶ ground in data/ ─▶ confirm vs public source
      ─▶ write scene script (BG, numbers spelled out for VO)
      ─▶ operator reviews the SCRIPT  ◀── gate 1, before any spend
      ─▶ TTS per scene ─▶ measure durations ─▶ Remotion render
      ─▶ burn captions ─▶ draft written to brand/videos/drafts/<slug>.md
      ─▶ operator reviews the VIDEO  ◀── gate 2, before publish
```

Two review gates, both mandatory. The first is the cheap one and catches most
errors; nothing is synthesized or rendered until a human has read the Bulgarian.

### Spec shape

```jsonc
{
  "slug": "2026-08-10-procurement-single-bidder",
  "kind": "short",                       // short | explainer
  "title": "…",
  "link": "https://electionsbg.com/procurement",
  "sources": ["data/procurement/summary.json", "https://www.aop.bg/…"],
  "scenes": [
    {
      "id": 1,
      "visual": { "type": "stat",  "value": "€1,2 млрд.", "label": "…" },
      "onScreen": "€1,2 млрд.",
      "voiceOver": "един цяло и два милиарда евро обществени поръчки",
      "grounding": { "file": "data/procurement/summary.json", "path": "$.noCompetition2024Eur" }
    },
    { "id": 2, "visual": { "type": "bars",    "bars": [ /* cardKit shape */ ] }, "…": "…" },
    { "id": 3, "visual": { "type": "capture", "url": "/procurement/contract/701291266900", "scroll": true }, "…": "…" }
  ],
  "cta": { "text": "Виж разбивката", "url": "…" }
}
```

`visual.type` deliberately mirrors `cardKit`'s existing renderer selection
(`bars` → infographic, `series` → line, `rows` → table). Same design vocabulary,
same palette, one place to change the look.

### Gates the skill must enforce

Carried over from naiasno-post:

1. **Grounded** — every figure traces to a real file under `data/`/`public/`.
2. **Confirmed** — verified against the primary register (АОП, Сметна палата,
   ЦИК, data.egov.bg, Eurostat, НСИ) via WebSearch/WebFetch; URL recorded.
3. **No duplicates** — check the registry before composing.
4. **Non-partisan, no emojis, natural Bulgarian.**
5. **Draft only** — never uploads to YouTube or Facebook by itself.

New, and specific to video:

6. **Spoken ≡ shown.** For every scene, `voiceOver`'s number must be the Bulgarian
   verbalization of `onScreen`'s number. This is a genuinely new failure class:
   the card renderer can only be wrong once, but a video can say one figure while
   displaying another, and that is the single most damaging error this brand could
   ship.

   **This cannot be fully automated, and the first draft of this plan over-claimed
   that it could.** Once numbers are spelled out as Bulgarian words (§2) the two
   sides are a digit string and a prose phrase — comparing them mechanically means
   writing the Bulgarian number-verbalizer the spell-out approach exists to avoid.
   So the gate is a **review gate with a machine assist**: extract every numeric
   token from `onScreen` and every number-word span from `voiceOver`, print them
   side by side per scene, and require explicit operator sign-off at gate 1. What
   *is* fully mechanical: asserting `onScreen` matches its `grounding` path in
   `data/`. Do that automatically; leave the spoken half to the human, and make the
   diff small enough to be read in seconds.
7. **Glyph check.** naiasno-post learned this the hard way: a missing glyph renders
   as a tofu box, silently, because nothing throws — and `→` is *not* in the card
   font. Same renderer family, same trap, now across ~900 frames instead of one
   image. Extract 3–4 frames per render and **Read them** before showing the operator.
8. **Caption every video.** Facebook autoplays muted; an uncaptioned BG voice-over
   reaches nobody there. Burn BG captions in for social cuts, and ship a `.vtt`
   sidecar for the YouTube/on-site version.
9. **Duration guard.** Refuse a short over ~60 s and an explainer over ~6 min
   rather than silently shipping something no one finishes.

### The deliverables around the video, which are not optional

The first draft of this plan stopped at "an MP4 exists". Four things ship with it,
and two of them are free because the pipeline already holds the material:

- **Thumbnail (1280×720).** On YouTube this is the single biggest lever on whether
  anyone watches at all — plausibly more than the video's own content. `cardKit`
  already renders the brand at 1080×1080; a 16:9 variant is a small addition to an
  existing renderer, not new work. Auto-render one per video from the same spec.
- **Transcript on the page.** It is the script — already written, already reviewed,
  zero marginal cost. It gives accessibility, a text surface for the crawler that a
  video embed does not provide, and it directly serves the known SEO discovery gap.
  Render it under the embed.
- **Captions, two forms.** Burned-in for social cuts (Facebook autoplays muted, so
  an uncaptioned Bulgarian voice-over reaches nobody there); a `.vtt` sidecar for
  YouTube and the on-site player, where burned-in text blocks translation and
  looks worse.
- **Registry + cross-link.** `brand/videos/index.json`, mirroring
  `brand/posts/index.json` (46 entries today). A finding that yields both a card
  and a video should carry each other's slug, so the pair can be published together
  and neither is later mistaken for a duplicate of the other.

### Aspect ratios: two placements, not one

The first draft said "9:16" as if social were one target. It is two:

| Placement | Ratio | Note |
|---|---|---|
| FB / IG **Reels**, YouTube **Shorts** | 9:16 | Vertical, ≤60 s, burned-in captions |
| FB **feed** | 1:1 or 4:5 | The feed is not Reels; a 9:16 posted to feed is letterboxed and reads as a repost |
| YouTube, on-site embed | 16:9 | The long form |

Remotion renders all three from one composition by parameterizing the canvas —
provided the layout is authored responsively from the start. Retrofitting a
fixed-width composition to a second ratio is the expensive version of this.

### Language scope

BG only for v1 — that is the user's stated requirement and it is the right call:
the audience is Bulgarian and a second voice track doubles every step of the
pipeline. If EN is ever wanted, the cheap path is an **English `.vtt` on the same
video**, not a second narration. The site's EN articles already exist as the
translation source. Decide this once and write it down, so it does not get
re-litigated per video.

### Caption timing

*(Revised after reviewing `remotion-dev/skills` — see §11. Word-level captions are
available immediately, not "later", and the duration mechanism is Remotion-native.)*

Chirp 3 HD does not return word-level timestamps. Three tiers, and the first two
are both cheaper than v1 assumed:

- **Per-scene durations** (the spine, always): synthesize each scene separately and
  measure each clip. Use `getAudioDuration()` (mediabunny, works in Node) inside
  Remotion's `calculateMetadata`, **not ffprobe** — the composition then sizes
  itself from the audio, so scene lengths and narration cannot drift apart by
  construction. This is Remotion's own documented voice-over pattern, which is
  useful corroboration: the architecture bg-BG's missing pause control *forced* on
  us is the one Remotion recommends anyway.
- **Word-level captions** via `@remotion/install-whisper-cpp` — `transcribe()` with
  `tokenLevelTimestamps: true`, then `toCaptions()`. Local whisper.cpp, installed by
  the package itself; **no Python, no WhisperX, no separate toolchain**, which is
  most of why v1 deferred this. Transcribe each scene clip individually.
  **The caveat that survives:** the documented example uses `medium.en`, an
  English-only model. Bulgarian needs a multilingual one (`medium` / `large-v3`) —
  bigger, slower, and with Bulgarian WER still undocumented. So it is cheap to
  *try* now rather than proven to work; validate on a real clip in phase 1.
- **Rendering them**: `@remotion/captions` provides `createTikTokStyleCaptions()`
  (page grouping via `combineTokensWithinMilliseconds`) and per-token highlighting —
  i.e. the standard Reels caption treatment is a package, not a build.
  **Gotcha:** captions are whitespace-sensitive; keep the leading space in each
  token's `text` and set `whiteSpace: "pre"`, or the words run together.

**Also trim the silence.** TTS clips routinely carry leading/trailing silence, which
makes per-scene concatenation feel slack. Detect it adaptively rather than with a
fixed dB floor: run ffmpeg `loudnorm=print_format=json` to get `input_thresh`, feed
that into `silencedetect=noise=${thresh}dB:d=0.5`, and apply the result as
`trimBefore` / `trimAfter`. Cheap, and it is the difference between a cut that lands
and one that sags.

---

## 6. Cost

Worked example, 8 shorts + 2 explainers per month:

| Line | Volume | Cost |
|---|---|---|
| TTS (Chirp 3 HD) | ~8×700 + 2×2,600 ≈ 10,800 chars/mo | **$0** (1M/mo free) |
| Remotion license | solo | **$0** (free ≤3 employees) |
| Rendering | local machine | **$0** |
| YouTube hosting + API | 10 uploads/mo vs ~6/day allowance | **$0** |
| On-site embed | YouTube iframe | **$0** |
| *Optional* self-hosted MP4 | ~2 GB in the existing bucket | cents |

**Marginal cost is effectively zero.** The entire budget is your time and the
one-time build. That materially changes the calculus versus, say, HeyGen at ~$1
per rendered minute or ElevenLabs at 10× Google's character rate — neither of
which is *expensive*, but neither of which is free either, and free removes any
reason to ration experiments.

---

## 7. What will actually bite

Ordered by how likely they are to cost you a weekend:

1. **Bulgarian number verbalization** (§2). Mitigated by spelling numbers out in
   the script. If you skip that mitigation, this is where the project stalls.
2. **Voice quality is unverifiable in advance.** Do the bake-off first. If all
   three providers sound wrong for a serious data brand, that is a finding worth
   having on day one rather than after the pipeline is built.
3. **Font glyphs in rendered frames** — silent tofu boxes, now at 900 frames per
   video instead of one card. Automate a spot-check.
4. **Playwright captures rot.** The existing capture scripts already skip when a
   heading disappears; a video composition that silently loses a beat is worse
   than a still that is obviously missing. Fail the render, don't skip.
5. **Render time.** Unmeasured on your hardware. A 3-min 1080p30 Remotion render
   is minutes, not seconds. Measure before wiring it into any watcher-driven flow.
6. **Scope creep into publishing.** naiasno-post deliberately stops at a draft.
   Keep that. YouTube upload automation is easy and should still be a separate,
   explicitly-invoked step.

---

## 8. Recommended phasing

**Phase 0 — decide the voice. ✅ DONE 2026-08-08.**

**Chosen: `gemini` · `Rasalgethi` · `gemini-3.1-flash-tts-preview`** —
`CHOSEN_VOICE` in `scripts/video/tts_bakeoff.ts`.

Run: 18 clips over two rounds on the §2 hard-case passage — round 1 across Chirp 3
HD and Gemini in both variants, round 2 a 6-way male comparison on `spoken`.
Total spend **~1.1% of one month's free tier**.

Three things the run settled that the research had wrong or open:

- **Cloud TTS refuses API keys outright** (401 · "API keys are not supported by
  this API"). It needs an OAuth token *and* `texttospeech.googleapis.com` enabled
  on the project — two operator steps §2 did not know about. Both are now done and
  Chirp 3 HD is live with all 31 bg-BG voices confirmed (30 Chirp3-HD + 1 Standard).
- **Gemini TTS is a fourth viable provider**, reachable with the `GEMINI_API_KEY`
  already in `.env.local` and no GCP setup at all. Its `gemini-3.1-flash-tts-preview`
  speaks Bulgarian; §2 missed it because the model postdates the docs consulted.
- **The winner was not the favourite.** Chirp 3 HD had 30 bg-BG voices,
  `speaking_rate` control, and ran ~16% faster (46.3 s vs 55.3 s mean on identical
  text) — and lost on ear. That is the whole reason this was a listening test and
  not a table.

Also measured, and useful later: raw-vs-spoken **duration delta** is a cheap proxy
for whether an engine is swallowing numbers rather than reading them. Both variants
say the same words, so they should run to similar lengths; `bg-BG-Chirp3-HD-Achird`
came in **16 s shorter** on `raw`, and the delta varied by voice *within* the same
engine (Achernar +1.8 s vs Achird −16.0 s). If that holds up, voice choice is partly
a correctness decision and not only an aesthetic one.

**The spell-out rule is CONFIRMED necessary** (judged on Rasalgethi, 2026-08-08):
`spoken` sounds natural, `raw` is **audibly accelerated**. Rule 7 stands, unrelaxed.

The mechanism is worth stating because it is not the one §2 predicted. The
anticipated failure was *mispronunciation* — a decimal comma read as a pause, an
ЕИК read as a number. What actually degrades is **pacing**: handed digits, the
engine compresses them and rushes, and the result is wrong-sounding without being
wrong. That is a harder defect to catch than a mangled number, because nothing in
the output is identifiably incorrect — it just does not sound like a person.

It also promotes the raw-vs-spoken **duration delta** from a speculative proxy to a
measured one: Rasalgethi's −4.0 s is already audible as rushing, so Achird's
−16.0 s is a different order of problem. The delta is a bake-off diagnostic, not a
production gate — nothing but `spoken` is ever synthesized for a real video — but it
is the cheapest way to rank candidates on this axis before listening.

**Phase 1 — three shorts, by hand (2–3 days).** Not one. Remotion project,
`cardKit` palette ported to CSS tokens, chosen voice, burned BG captions. Build the
three topics in §9 — they are chosen to test three different unknowns, and one
video cannot tell you whether the format works or whether that particular topic did.
**Measure the render time** here; it is currently unmeasured and it constrains every
later automation decision.

**⛔ Decision gate — do not skip to phase 2 by default.** After three videos, with
real numbers in hand: did they get watched? Was the per-video effort after the
pipeline exists plausibly under an hour? Did the voice hold up? If shorts do not
land, the correct outcome is to **stop here** — three hand-made videos cost a few
days; a skill plus SEO wiring plus long-form is a couple of weeks, and this repo has
a documented history of building the pipeline first and discovering the audience
later. Write the answer down either way.

**Phase 2 — the skill (2–3 days).** `.claude/skills/naiasno-video/SKILL.md` +
`scripts/video/video_tool.ts` (`check` / `save`, mirroring `post_tool.ts`), the
spec shape from §5, both review gates, the spoken≡shown and glyph checks.

**Phase 3 — distribution (1 day).** `VideoObject` JSON-LD emitted from
`scripts/prerender/`, `sitemap_video.xml` shard, an on-page embed component, and
the `bucket_sync_paths.ts` entry if self-hosting.

**Phase 4 — long form (later).** Article → explainer script. Only after shorts
have proven the format is worth the time; a 5-minute video is roughly 6× the work
of a 40-second one and has a fraction of the reach.

**Phase 5 — optional.** YouTube upload automation via Data API v3 as an explicit
command, never automatic.

---

## 9. Test topics — the first three shorts

Chosen from **already-published posts** (`brand/posts/index.json`, 46 entries), for
one reason that saves a day each: their figures are already grounded in `data/` and
already confirmed against a primary source. A test of the *video* pipeline should
not also be a test of the research pipeline.

Each tests a different unknown. Build all three before deciding anything.

### T1 — «6,79 € за глас, и пак извън парламента» — the baseline

- **Post:** `2026-08-02-cost-per-vote-april-2026` · link `/financing?elections=2026_04_19`
- **Fact:** ИТН отчете 161 919 € разходи за 23 861 гласа (6,79 €/глас) и не влезе в
  парламента; ПрБ отчете 0,58 €/глас и 131 мандата.
- **Why first:** the simplest possible video that is still interesting — two
  numbers, one comparison, understood in four seconds, and the arithmetic *is* the
  story so it stays non-partisan without effort. Visual is two bars, which
  `cardKit` already knows how to draw.
- **Tests:** the end-to-end chain; euro-with-decimal-comma verbalization
  («шест цяло седемдесет и девет евро на глас»); party acronyms (ИТН, ПрБ) with no
  pronunciation override available.
- **Format:** 9:16, ~35 s, 4 scenes.

### T2 — «236 от 265 общини смениха победителя си» — the map

- **Post:** `2026-07-31-municipalities-changed-winner` · link `/?elections=2026_04_19`
- **Fact:** между октомври 2024 и април 2026 победителят се смени в 236 от 265
  общини (89%); само 29 запазиха първата си партия.
- **Why second:** one number, and the country map filling in municipality by
  municipality is the most motion-native asset this site owns. A still card cannot
  do it, so this is the first topic where video earns its cost instead of merely
  matching a card.
- **Tests:** whether an animated map is worth the build; whether a Playwright
  capture of the live map beats a re-drawn Remotion one (build both, pick).
- **Format:** 9:16, ~30 s, 3 scenes.
- **Build it in SVG with `d3-geo`, not a tile provider.** `cardKit.ts` already
  imports `geoMercator` + `geoPath`, so the municipality shapes can be React `<path>`
  elements with an animated `fill` — no Mapbox/MapLibre/MapTiler key, no WebGL, no
  headless-render shimmer, no 4096 px renderbuffer ceiling, and deterministic frame
  to frame. Remotion's own maps guidance says to pick exactly one technique and
  rates the no-tile route "smallest, fastest, most deterministic"; here the basemap
  carries no information at all — the *data* is the map — so the tile layer would be
  cost with no payload.
- **⚠️ The timing bug to avoid, borrowed from §11:** do **not** drive each
  municipality's fill from a slice of one global 0→1 reveal. Remotion's map-explainer
  reference is explicit that per-item animation must run on **time since that item's
  trigger**, with a constant per-item duration — otherwise short items "flash by in a
  fraction of a second". With 265 municipalities on a ~30 s timeline that failure is
  near-certain: each fill would get ~110 ms and the whole map would read as noise
  rather than as a sweep. Trigger by arrival, hold each fill for a constant ~600 ms.

### T3 — «Не сме първи по инфлация в ЕС» — the correction

- **Post:** `2026-08-03-inflation-eu-rank` · link `/indicators/compare`
- **Fact:** през юни 2026 Евростат отчита Румъния 9,2%, Литва 5,4%, България 5,2% —
  България е трета в ЕС, при средно 2,9% за ЕС.
- **Why third:** correcting a widely-held belief is the highest-retention hook
  there is, and it is the format this brand can do that no one else in the market
  can. Also exercises the EU-peer bar + flag components, which already exist.
- **Tests:** whether the myth-correction hook outperforms the fact-delivery hook of
  T1 — the one audience question worth answering early, since it determines how
  every future topic gets framed.
- **Format:** 9:16, ~40 s, 5 scenes.

### Held back — and why it is worth saying out loud

`2026-08-04-ruzhintsi-matura-nula-vzeli` (СУ „Никола Й. Вапцаров", с. Ружинци —
среден успех 2,00 при 12 зрелостници) is the **best TTS stress test in the
registry**: a hard place name, a school name with an initial, and a decimal grade,
all unfixable if mispronounced since `bg-bg` has no pronunciation override.

Put that text in the **phase-0 bake-off passage**, where it is exactly the right
input. Do not make it one of the first videos. It names a single identifiable school
and its result belongs to twelve named-in-principle minors; a video travels further
and lands harder than the card did, and that is an editorial call to make
deliberately rather than inherit from "the post already exists". The card was a
defensible publication; the video is a different decision, not the same one at a
larger size.

### First long-form, when phase 4 arrives

`public/articles/2026-06-20-following-public-money-bg.md` (2,979 words) → a ~3-minute
"how to follow public money on Наясно". It is a **product** explainer, so its factual
risk is far lower than an analysis piece, it is evergreen, it is the natural landing
page for the SEO discovery gap, and `scripts/capture-procurement-shots.mjs` already
captures most of its visuals.

---

## 10. Audit log — what this review changed (2026-08-08)

Full re-check of v1 against primary sources. Findings, by severity:

**Material — changed a recommendation:**

1. **Chirp 3 HD has no pause control and no custom pronunciation for `bg-bg`.**
   Verified verbatim in both of Google's locale-exclusion lists. v1 recommended
   Chirp 3 HD without checking its Bulgarian *capability* surface, only its voice
   *count*. Recommendation stands, but per-scene synthesis is now mandatory rather
   than preferred, orthographic rewriting is the only correction lever, and the
   bake-off passage is now specified as hard cases rather than a generic paragraph.
2. **A human narrator was never considered.** The whole of §2 evaluated synthetic
   voices only. Added as §2b with a tiering recommendation (TTS for time-sensitive
   shorts, human for evergreen long-form) and an honest flag that the cost estimate
   comes from thin data and needs two real quotes.

**Over-claim, walked back:**

3. **"Spoken ≡ shown" was described as mechanically assertable.** It is not — once
   numbers are spelled out as Bulgarian words, checking them mechanically requires
   the very verbalizer the design avoids. Downgraded to a review gate with a
   machine-printed diff; the `onScreen`-vs-`data/` half stays fully automatic.

**Gaps — added:**

4. Thumbnails (1280×720 from `cardKit`), on-page transcript, two caption forms,
   `brand/videos/index.json` + post↔video cross-link.
5. FB feed (1:1 / 4:5) is a different placement from Reels (9:16); v1 said "9:16"
   as though social were one target. Costly to retrofit, cheap to author for.
6. EN scope stated explicitly (BG only; subtitles, never a second VO).
7. A **decision gate after phase 1**, and phase 1 widened from one video to three.
   v1 flowed from "one short by hand" straight into building the skill regardless
   of the result, which is the failure mode this repo already has history with.
8. Render time assigned to phase 1 rather than left as an unowned risk.

**Corrections:**

9. `scripts/capture-*.mjs` is **7** files, not 6.
10. The Google TTS price came from a third-party summary (the official page
    truncated on fetch); flagged inline as needing console confirmation.

**Checked and unchanged:** Azure's two bg-BG voices; Google's 30 Chirp 3 HD bg-BG
voices; Remotion's free license at ≤3 employees with free local rendering; YouTube's
1,600-unit upload cost against a 10,000/day default; the `dist/` file-count hazard;
`VideoObject` / video-sitemap guidance. `scripts/prerender/jsonLd.ts` exists and is
confirmed as the right home for the schema work in phase 3.

---

## 11. Borrowed from `remotion-dev/skills` (reviewed 2026-08-08)

**Verified as genuine and current:** `github.com/remotion-dev/skills`, the Remotion
team's own agent-skill repo — 4,246 stars, last pushed 2026-08-07, skills pinned to
Remotion `4.0.507`. Not a third-party interpretation; this is the vendor documenting
its own product for agents. Reviewed the voice-over, timing, sequencing,
silence-detection, captions, multimedia, maps and layout skills.

### What it confirms (worth knowing the design is not idiosyncratic)

**Per-scene TTS → measure → size the composition is Remotion's own documented
voice-over pattern.** §5 arrived at that architecture because bg-BG has no pause
control and pauses must come from the edit. Remotion recommends it for everyone.
Two independent reasons for the same design is the good case.

Their default provider is ElevenLabs, but the skill states plainly that any TTS that
"can produce an audio file" substitutes. So §2's Google recommendation drops in with
no friction — the pipeline is provider-agnostic and the bake-off decides.

### What it changes

1. **`calculateMetadata` + mediabunny's `getAudioDuration()` replaces ffprobe.**
   The composition computes its own length from the audio at render time. Removes a
   dependency and makes narration/scene drift structurally impossible.
2. **Word-level captions move from "later" to "now"** — `@remotion/install-whisper-cpp`
   installs whisper.cpp itself. The Python toolchain that made v1 defer this does not
   exist. (Bulgarian model caveat retained — see §5.)
3. **`@remotion/captions` supplies the Reels caption treatment** —
   `createTikTokStyleCaptions()` + token highlighting — rather than it being a build.
4. **T2's map should be `d3-geo` SVG, and its timing model changes.** See §9.
5. **Adaptive silence trimming** via `loudnorm` → `silencedetect` → `trimBefore` /
   `trimAfter`, added to §5.

### Render-stability rules to adopt before writing any animation

These are hard-won and none are guessable:

- **Never move a WebGL map camera per frame.** `map.jumpTo()` each frame makes the
  basemap shimmer in headless renders. Render one oversized static plate and move it
  with CSS `translate`/`scale`. *(Applies only if a tile map is ever used; §9 avoids
  it for T2, but the rule generalizes to any WebGL canvas.)*
- **Keep any canvas dimension ≤ 4096 px.** The skill warns specifically against
  reflexively rendering at 3×: 1920 × 3 = 5760, and Chromium may silently downsample
  it — the symptom is soft output with nothing in the logs.
- **The async-content harness is `delayRender → mutate → once('idle') →
  continueRender → triggerRepaint`.** Generalizes past maps to anything imperative
  or asynchronous, which includes fetching a `data/` file at render time.
- **WebGL renders want `preserveDrawingBuffer: true`, `--gl=angle`, concurrency 1.**
- **Time-based timing.** Key animation off `t = frame / fps` with constant per-item
  durations, never off a slice of a global progress value.
- **Verify by rendering an MP4, not by watching the Studio preview** — "do not
  approve it as a minor preview artefact." This is the same lesson as §5's glyph
  gate, arrived at independently: **the preview lies, so check the artefact.**

### Markup gotchas for phase 1

- **`premountFor` on every `<Sequence>`.** The skill's instruction is literally
  "Always premount any `<Sequence>`!" — without it a scene's assets pop in on entry.
- **`useCurrentFrame()` is LOCAL inside a `<Sequence>`** (0-based, not timeline
  absolute). Classic off-by-a-scene bug.
- **`<Series>` with negative `offset` for overlapping scenes** — exactly §5's scene
  model, already a primitive.
- **`output: 'perceptual-scale'`** on scale interpolations; linear scale reads as
  decelerating to the eye.
- **Studio-editability is a code style**, and it matters here: keep `interpolate()`
  inline in the `style` prop and use individual CSS transform properties
  (`scale` / `translate` / `rotate`) rather than `transform` strings, and Remotion
  Studio can write timing tweaks back to code. That turns §5's gate-2 review from
  "operator reports a problem, I fix it" into "operator nudges the timing directly."
- **Video layout minimums** (their §video-layout, scaled from 1080 px wide): headline
  ≥ 84 px, supporting text ≥ 44 px, key content ≥ 80 px from the sides and ≥ 100 px
  from top and bottom. Worth adopting verbatim as `cardKit`'s video-side tokens —
  `cardKit` is tuned for a 1080×1080 still viewed at full size, and a phone-screen
  Reel is a different legibility problem.

### Skill-design patterns worth copying into `naiasno-video`

- **Router + self-contained leaves.** Their top-level `SKILL.md` is a dispatcher that
  loads one sub-skill on demand, and each technique directory "may be removed without
  breaking the others." If `naiasno-video` grows a second format, that is the shape —
  and it is how the 312-line `naiasno-post` should probably split too.
- **"Preserve user changes"** — their first rule: if code changed unexpectedly
  mid-conversation, assume it was deliberate and ask rather than overwrite. That is
  directly load-bearing in *this* repo, where a concurrent auto-committer touches the
  tree mid-session.
- **Pin the skill to a library version** in frontmatter (`version: 4.0.507`), so a
  stale skill is visible rather than silently wrong.

---

## 12. GSAP, and how to build walkthrough videos (2026-08-08)

Two questions that arrived together but resolve separately.

### 12a. Should we install GSAP? — **No, not now.** Revisit on a named trigger.

The licensing objection is dead: Webflow made GSAP **100% free in April 2025**,
including every former Club plugin (SplitText, MorphSVG, DrawSVG, MotionPath).
Cost is not the reason to decline.

Nor is bundle weight, and it is worth killing that reflex explicitly: the Remotion
project is a **separate bundle from the site's**. This repo has a live critical-path
problem (`bundle-critical-path-v1.md` — ~1,015 KB br before the route renders), but
a video-only dependency never enters it. Judge GSAP on the video pipeline alone.

**The real cost is determinism plumbing plus a lost workflow.**

Remotion renders each frame as a pure function of `frame`, potentially out of order
and across parallel browser instances. GSAP is driven by its own wall-clock ticker,
so the two only meet through a bridge: build the timeline `paused: true` and
`tl.seek(frame / fps)` on every frame. That works. Skip it and the documented
failure is stark — the ticker races ahead, a 4-second animation renders in ~1 second
and the rest of the composition comes out black.

Two things then follow that are easy to miss:

- **You now maintain two timing systems** — Remotion frames and GSAP seconds — with
  `<Sequence>`'s local-frame semantics interacting between them.
- **Remotion Studio can no longer edit the animation.** §11 established that keeping
  `interpolate()` inline in `style` lets Studio write timing tweaks back to code —
  the thing that turns gate-2 review from "operator reports a problem, I fix it" into
  "operator nudges the pacing directly." A GSAP timeline is opaque to Studio. For a
  solo operator tuning pacing against a Bulgarian voice track, that is the most
  valuable property in the whole pipeline, and GSAP trades it away.

**And the payoff is smaller than GSAP's reputation suggests _for this content_.**
What a data explainer would actually use it for, against the native cost:

| GSAP | Native equivalent here | Winner |
|---|---|---|
| `stagger` (265 municipalities) | `interpolate(frame, [i*s, i*s+d], …)` in a `.map()` | **native** — and §9's constant-per-item rule *is* a manual stagger anyway |
| DrawSVG | `strokeDasharray` / `strokeDashoffset` + `interpolate`, ~4 lines | **native** |
| MotionPath (cursor) | `path.getPointAtLength(t * getTotalLength())` — native SVG API | **native** |
| SplitText | `[...text].map()` + staggered `interpolate` | **native**, and more inspectable for Cyrillic given this repo's glyph history |
| CustomEase / CustomBounce | `Easing.bezier`, `spring()`, plus **`d3-ease` already installed** | **native** |
| Timeline labels / relative offsets | `<Series>` + negative `offset` | tie |
| **MorphSVG** (shape tweening) | genuinely hard to hand-roll | **GSAP** |
| **Flip** (layout transitions) | genuinely hard | GSAP — but the most seek-fragile thing in the library |

Six of eight are a handful of lines against native APIs. The two GSAP clearly wins
are the two a data explainer does not need — and `Flip` measures live DOM state,
which is exactly what a seeked, parallel, out-of-order renderer handles worst.

**The tie-breaker:** `remotion-dev/skills` is ~60 files of the vendor's own animation
guidance — timing, sequencing, transitions, easing, maps, text highlights — and it
**never mentions GSAP once**. The people who know the renderer best do not reach for
it.

**Revisit if any of these becomes true** (the decision is cheap to reverse — GSAP is
free, and it can be adopted for a single scene without restructuring anything):

- a video genuinely needs **shape morphing** (a bar literally becoming the country outline);
- a **motion designer who thinks in GSAP timelines** joins — then the Studio-editability argument inverts, because Studio was never their tool;
- native `interpolate` demonstrably fails a specific shot, with the shot named.

Absent one of those, `interpolate` + `spring` + `Easing` + `d3-ease` is the stack.

### 12b. Walkthrough videos — four approaches, and GSAP is irrelevant to all four

"Walkthrough" here means showing the real product: cursor moving, panels opening,
a zoom onto the thing being discussed. Note that **none** of these options is made
easier by GSAP — the cursor is an `interpolate` along a path, the zoom is a plate
transform, the highlight is opacity and scale.

**A. A screen-recording app** (Screen Studio, Tella). Auto-zoom on click, smoothed
cursor, good defaults, no build at all. Fastest route to something polished.
Not reproducible, not data-driven, and a UI change means re-recording by hand.
→ *Right for the single "how to use Наясно" pillar video if it is wanted this month.*

**B. Playwright-driven capture → composited in Remotion** ⭐ **the pipeline answer.**
The repo already has **7** Playwright capture scripts, so this extends an existing
capability rather than adding one. Script the journey, capture deterministically,
composite in Remotion with a synthetic cursor, captions and the TTS track.

The idea that makes this better than a screen recorder rather than merely
reproducible: **have the Playwright script emit an action log** —
`{tMs, type: "click" | "scroll" | "hover", x, y, selector}` — and let Remotion
consume that log as the **zoom and cursor choreography**. That is exactly Screen
Studio's auto-zoom-on-click, except the automation script *is* the storyboard, it is
diffable, and it re-runs when the UI moves. The zoom itself is §11's **fixed-plate**
pattern: capture oversized (≤4096 px), then translate/scale the plate — never
re-render the page per frame.

**C. Mount the site's real React components inside Remotion.** The site is React 19;
Remotion is React. Import the actual component and drive its props across frames.
Pixel-perfect, **vector text** (crisp Cyrillic at any scale, no canvas-font tofu
risk), deterministic by construction, no browser automation at all.
The cost is providing the context stack with fixtures instead of network — React
Query (prefilled cache), Router, i18n, `ElectionContext`, `cabinetAnchorContext`,
`useScope`. Bounded and known, but real.
→ *Right for component-level beats ("here is the risk index tile"), not whole journeys.*

**D. iframe the live site inside Remotion.** Cross-origin, `delayRender` and
determinism problems. Not recommended.

**Recommendation: C for component beats, B for journeys, A as an escape hatch** when
a good video this week beats a reproducible one next month.

### 12c. The staleness property that only walkthroughs have

Worth stating because it is specific to this site and does not apply to the
card-based videos in §9.

A walkthrough records **real pages showing real numbers**. Those numbers move: a
`db:refresh`, a contracts reload, a new ИСУН ingest, and `/procurement/contract/…`
now shows a different figure than the recording does. The video keeps asserting the
old one, at a 200, with nothing failing — the same silent-staleness shape this
repo's CLAUDE.md documents for a dozen loaders.

That is an argument for **what walkthroughs should be about**: the mechanics of the
tool ("how to trace a contract to its buyer"), which are evergreen, rather than a
specific contract's value, which is not. Where a figure must appear on screen, note
it in the spec's `grounding` block so a corpus reload can flag the video for
re-recording — and prefer §9's card-based format for anything whose *point* is a
number.

---

## Sources

- [Azure Speech language & voice support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts) — bg-BG: Kalina + Borislav only, no HD/multilingual/styles
- [Google Cloud TTS voice list](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types) — bg-BG: 30 Chirp 3 HD + 1 Standard
- [Chirp 3 HD voices](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd) — **`bg-bg` excluded from BOTH pause control and custom pronunciations**; SSML is a restricted subset, synchronous only; `speaking_rate` 0.25×–2× all locales
- [Bulgarian voice actor pay (ERI)](https://www.salaryexpert.com/salary/job/voice-actor/bulgaria) · [freelance VO rates](https://www.sidestackers.com/rates/voice-over-artist) — thin data; get real quotes
- [Google Cloud TTS pricing](https://cloud.google.com/text-to-speech/pricing) · [pricing breakdown](https://texttolab.com/blog/google-cloud-tts-pricing) — Chirp 3 HD $30/1M chars, 1M/mo free
- [ElevenLabs models](https://elevenlabs.io/docs/overview/models) · [languages](https://help.elevenlabs.io/hc/en-us/articles/13313366263441-What-languages-do-you-support) · [v3 review](https://inworld.ai/resources/elevenlabs-v3-review) · [pricing](https://flexprice.io/blog/elevenlabs-pricing-breakdown)
- [Remotion licensing](https://www.remotion.dev/docs/license/pricing) · [terms](https://www.remotion.dev/docs/license/terms) · [license FAQ](https://www.remotion.dev/docs/license/faq)
- [Remotion vs Motion Canvas vs Revideo](https://www.pkgpulse.com/guides/remotion-vs-motion-canvas-vs-revideo-programmatic-video-2026)
- [YouTube Data API quota](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) · [quota limits explained](https://www.getphyllo.com/post/youtube-api-limits-how-to-calculate-api-usage-cost-and-fix-exceeded-api-quota)
- [Video schema markup guide](https://schemavalidator.org/guides/video-schema-seo-guide) · [video sitemaps](https://swarmify.com/blog/video-sitemap/)
- [HeyGen API pricing](https://www.heygen.com/api-pricing) · [HeyGen vs Synthesia](https://www.ngram.com/blog/heygen-vs-synthesia)
- [Cloudflare Stream vs Mux vs Bunny](https://www.pkgpulse.com/guides/mux-vs-cloudflare-stream-vs-bunny-stream-video-cdn-2026)
- [WhisperX word-level timestamps](https://github.com/m-bain/whisperx) · [guide](https://localaimaster.com/blog/whisperx-guide)
- [GSAP is now 100% free](https://webflow.com/blog/gsap-becomes-free) (Webflow, April 2025) · [standard license](https://gsap.com/community/standard-license/) · [CSS-Tricks writeup](https://css-tricks.com/gsap-is-now-completely-free-even-for-commercial-use/) — all former Club plugins included
- [Remotion↔GSAP bridge and its failure mode](https://hyperframes.mintlify.app/guides/hyperframes-vs-remotion) — paused timeline + `seek(frame/fps)`; without it the ticker runs at wall-clock and the render blacks out
- [remotion-dev/skills](https://github.com/remotion-dev/skills) — the Remotion team's own agent skills (4.2k★, pinned to 4.0.507). Reviewed: `remotion-markup/{voiceover,timing,sequencing,silence-detection}.md`, `remotion-captions/{display,transcribe,import-srt}-captions.md`, `remotion-multimedia/get-audio-duration.md`, `remotion-maps/**` (incl. `render-stability.md`, `map-explainer-architecture.md`), `remotion-create/video-layout.md`
