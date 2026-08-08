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
| Live-page screenshotting | `scripts/capture-*.mjs` (6 files, Playwright, 2× DPI, clip-by-heading) | Already the way article images are made. The same code records the real dashboard as video frames. |
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

### Decide by bake-off, not by table

Bulgarian TTS quality claims are unverifiable from documentation. The only honest
method: synthesize **one identical paragraph** — one containing money, a percent,
a year and an institution name — across Chirp 3 HD (3–4 voice picks), Azure Kalina
+ Borislav, and ElevenLabs v3, and listen. Budget: under $1 and one afternoon.
This should be the **first** thing built, and it should be a committed script
(`scripts/video/tts_bakeoff.ts`) so the test is repeatable when a provider ships
a new model.

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
   ship. Assert it mechanically where the mapping is derivable; require explicit
   operator sign-off on the script otherwise.
7. **Glyph check.** naiasno-post learned this the hard way: a missing glyph renders
   as a tofu box, silently, because nothing throws — and `→` is *not* in the card
   font. Same renderer family, same trap, now across ~900 frames instead of one
   image. Extract 3–4 frames per render and **Read them** before showing the operator.
8. **Caption every video.** Facebook autoplays muted; an uncaptioned BG voice-over
   reaches nobody there. Burn BG captions in for social cuts, and ship a `.vtt`
   sidecar for the YouTube/on-site version.
9. **Duration guard.** Refuse a short over ~60 s and an explainer over ~6 min
   rather than silently shipping something no one finishes.

### Caption timing

Chirp 3 HD does not return word-level timestamps. Two ways to get them:

- **Per-scene synthesis** (recommended): synthesize each scene separately, measure
  each clip's duration with ffprobe, and time captions per scene. Coarse but exact,
  zero extra dependencies, and it is *also* how Remotion learns each scene's length.
- **WhisperX forced alignment** if word-level karaoke captions are wanted later —
  wav2vec2 alignment, <100 ms accuracy. Bulgarian WER for Whisper is not
  well-documented, so treat this as an upgrade to validate, not a starting point.

Start with per-scene. It is sufficient and it has no failure mode.

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

**Phase 0 — decide the voice (½ day).** `scripts/video/tts_bakeoff.ts`: one BG
paragraph containing money, a percent, a year and an institution, across Chirp 3 HD
(3–4 voices), Azure Kalina + Borislav, and ElevenLabs v3. Listen. Pick. Commit the
script so it is repeatable.

**Phase 1 — one short, by hand (1–2 days).** Remotion project, `cardKit` palette
ported to CSS tokens, 4 scenes, chosen TTS, burned BG captions. Render one video
about a finding you have already posted. Prove the whole chain end to end before
automating any of it.

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

## Sources

- [Azure Speech language & voice support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts) — bg-BG: Kalina + Borislav only, no HD/multilingual/styles
- [Google Cloud TTS voice list](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types) — bg-BG: 30 Chirp 3 HD + 1 Standard
- [Google Cloud TTS pricing](https://cloud.google.com/text-to-speech/pricing) · [pricing breakdown](https://texttolab.com/blog/google-cloud-tts-pricing) — Chirp 3 HD $30/1M chars, 1M/mo free
- [ElevenLabs models](https://elevenlabs.io/docs/overview/models) · [languages](https://help.elevenlabs.io/hc/en-us/articles/13313366263441-What-languages-do-you-support) · [v3 review](https://inworld.ai/resources/elevenlabs-v3-review) · [pricing](https://flexprice.io/blog/elevenlabs-pricing-breakdown)
- [Remotion licensing](https://www.remotion.dev/docs/license/pricing) · [terms](https://www.remotion.dev/docs/license/terms) · [license FAQ](https://www.remotion.dev/docs/license/faq)
- [Remotion vs Motion Canvas vs Revideo](https://www.pkgpulse.com/guides/remotion-vs-motion-canvas-vs-revideo-programmatic-video-2026)
- [YouTube Data API quota](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) · [quota limits explained](https://www.getphyllo.com/post/youtube-api-limits-how-to-calculate-api-usage-cost-and-fix-exceeded-api-quota)
- [Video schema markup guide](https://schemavalidator.org/guides/video-schema-seo-guide) · [video sitemaps](https://swarmify.com/blog/video-sitemap/)
- [HeyGen API pricing](https://www.heygen.com/api-pricing) · [HeyGen vs Synthesia](https://www.ngram.com/blog/heygen-vs-synthesia)
- [Cloudflare Stream vs Mux vs Bunny](https://www.pkgpulse.com/guides/mux-vs-cloudflare-stream-vs-bunny-stream-video-cdn-2026)
- [WhisperX word-level timestamps](https://github.com/m-bain/whisperx) · [guide](https://localaimaster.com/blog/whisperx-guide)
