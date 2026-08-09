# Publishing — captions, thumbnail, cuts, hosting, SEO

Load when preparing the deliverables around a render. The skill **never publishes**;
this file describes what the draft must contain so the operator can.

## Aspect cuts — and the one that is NOT a rescale

| Placement | Ratio | State |
|---|---|---|
| FB / IG **Reels**, YouTube **Shorts** | 9:16 · 1080×1920 | ✅ built, burned-in captions |
| FB **feed** | 4:5 · 1080×1350 | ✅ built — the feed is **not** Reels; a 9:16 posted to feed is letterboxed and reads as a repost |
| YouTube, on-site embed | 16:9 · 1920×1080 | ❌ **not built** — needs its own layout |

The two portrait-ish cuts genuinely do come from one composition: scenes are authored
against a 1080-wide base and multiplied by `scale(width)`, and `BarsScene` compresses
its vertical rhythm to fit the shorter frame.

**⚠️ Landscape is not a rescale of portrait, and an earlier draft of this file
claimed it was.** A 1920×1080 composition was built, rendered and deleted: `scale()`
is width-derived, so at 1920 wide every element renders **1.78× larger inside a frame
840px shorter**, and six bars overflowed the composition entirely. The vertical-fit
factor cannot rescue it — it compresses *spacing*, and at 16:9 the **type alone**
exceeds the height. Shrinking type below the ~84/44px floor is exactly the trade that
floor exists to prevent.

A 16:9 cut needs a landscape **layout** — wider bars, fewer rows, or two columns —
that spends the extra width instead of fighting it. That is `explainer`-format work
(phase 4). Until it exists, ship shorts in the two portrait cuts and give YouTube the
9:16 as a Short.

**Vertical fit, when adding a scene type:** compress *spacing* to fit, never type. The
legibility minimums are a floor on a phone screen, so shrinking text to fit trades a
visible defect for an unreadable one.

## Captions — two forms, both required

- **Burned in** for social cuts. Facebook autoplays muted; an uncaptioned Bulgarian
  voice track reaches nobody there. This is not optional polish.
- **`.vtt` sidecar** for YouTube and the on-site player, where burned-in text blocks
  translation and looks worse.

**Built and in use: derived timing, no transcriber** (`video/src/lib/captions.ts`).

Two things are already known exactly — the **text** of every scene (the spec's
`voiceOver`, signed off at gate 1) and the **duration** of every clip (measured for
`calculateMetadata`). Distributing the first across the second needs no model and
**cannot mis-transcribe**. Pages split on **characters, not words**: Bulgarian word
lengths vary enough to drift over an 8-second scene, while characters track the
measured ~13 chars/s closely.

What it costs, and the design that follows from it: the timing is *derived*, so a
page boundary can sit a beat early. Pages therefore render **whole, with no per-word
highlight** — a highlight subtly out of sync reads as broken, while a whole page
slightly early just reads as a caption. Do not add karaoke highlighting on top of
derived timing.

**Whisper is the upgrade, not the starting point.** `@remotion/install-whisper-cpp`
gives real word-level timestamps with no Python toolchain, but its documented model
is `medium.en` (English-only); Bulgarian needs a multilingual one whose BG accuracy
is undocumented and which is a large download to validate. Only worth it if word-level
karaoke is genuinely wanted — and validate on a real Bulgarian clip first.

**⚠️ Captions render as a SIBLING of `<Frame>`, so they inherit nothing from it.**
Set `fontFamily` explicitly. The first captioned render came out in Chromium's
default serif — readable, on-brand for nobody, and it will not reproduce on a
machine that happens to have Inter installed.

## Thumbnail (1280×720)

On YouTube this is plausibly a bigger lever on whether anyone watches than the video's
own content. Auto-render one per video from the same spec — `cardKit` already renders
the brand at 1080×1080, so a 16:9 variant is an addition to an existing renderer, not
new work.

Same glyph rule as every other rendered frame: Read the PNG before showing it.

## Transcript on the page

It is the script — already written, already reviewed at gate 1, zero marginal cost.
Render it under the embed. Gives accessibility, and a text surface for the crawler
that a video embed does not provide.

## Hosting

**YouTube is the canonical host.** `videos.insert` costs 1,600 quota units against a
default 10,000/day, i.e. ~6 uploads/day — far beyond any realistic cadence here.
Free bandwidth, free transcoding, free player, and it gives search surface the site
does not have.

**On-site: embed the YouTube player** and add `VideoObject` JSON-LD to that page.
`embedUrl` for a YouTube embed, `contentUrl` for a self-hosted file; at least one must
be present for video indexing.

**⚠️ The JSON-LD must be prerendered**, emitted from `scripts/prerender/` (see
`jsonLd.ts`) — for the same reason every other `<meta>` on this site is. Injected
client-side, Google never sees it.

Add a `sitemap_video.xml` shard alongside the existing sitemap shards once there is
more than a handful of videos.

**⚠️ MP4s go in the GCS bucket (`gs://data-electionsbg-com`), never in `dist/`.**
Firebase's deploy ceiling is on file *count* and `dist/` is already ~248k files; a
453k-file dist has failed to deploy. Note `bucket_sync_paths.ts` refuses unlisted
subtrees by design, so a `video/` subtree needs an explicit entry there — not a silent
upload.

Self-hosting is only worth it for a cookie-free player. If it becomes wanted: the
existing bucket first (storage + egress only, no adaptive bitrate — fine for ≤3 min
1080p), Cloudflare Stream ($1/1,000 min delivered, bundled encoding) if volume grows.

## The draft

`brand/videos/drafts/<slug>.md` plus an entry in `brand/videos/index.json`, mirroring
`brand/posts/index.json`. Carry `postSlug` when the finding also shipped as a card, so
the pair can be published together and neither is later mistaken for a duplicate of
the other.

The draft states, for the operator:

- where the MP4, thumbnail, `.vtt` and transcript are
- the BG script as narrated
- the deep link and the confirming sources
- which cuts were rendered (9:16 / 1:1 / 16:9)
- a reminder that **nothing has been published**

## Copy conventions

Inherited from `naiasno-post` and unchanged: no emojis, non-partisan, natural
Bulgarian. Close the description and the final scene with the share line —
«Споделете, за да стигне Наясно до повече хора.»

For a YouTube description: the deep link goes in the body (unlike a Facebook post,
where it goes in the first comment because FB throttles link posts).
