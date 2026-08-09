# Publishing — captions, thumbnail, cuts, hosting, SEO

Load when preparing the deliverables around a render. The skill **never publishes**;
this file describes what the draft must contain so the operator can.

## Aspect cuts — three placements, not one

| Placement | Ratio | Notes |
|---|---|---|
| FB / IG **Reels**, YouTube **Shorts** | 9:16 | ≤60 s, burned-in captions mandatory |
| FB **feed** | 1:1 or 4:5 | the feed is **not** Reels — a 9:16 posted to feed is letterboxed and reads as a repost |
| YouTube, on-site embed | 16:9 | the `explainer` format |

Remotion renders all three from one composition by parameterizing the canvas —
**provided the layout is authored responsively from the start**. Retrofitting a
fixed-width composition to a second ratio is the expensive version of this, so decide
the target cuts before writing the first scene.

## Captions — two forms, both required

- **Burned in** for social cuts. Facebook autoplays muted; an uncaptioned Bulgarian
  voice track reaches nobody there. This is not optional polish.
- **`.vtt` sidecar** for YouTube and the on-site player, where burned-in text blocks
  translation and looks worse.

Three tiers of timing, cheapest first:

1. **Per-scene** — the spine. Each scene's clip duration is already measured for
   `calculateMetadata`, so scene-level caption timing is free and exact.
2. **Word-level** via `@remotion/install-whisper-cpp` — `transcribe()` with
   `tokenLevelTimestamps: true`, then `toCaptions()`. Local whisper.cpp, installed by
   the package; no Python, no separate toolchain. Transcribe each scene clip
   individually.
   **Caveat:** the documented example uses `medium.en`, English-only. Bulgarian needs
   a multilingual model (`medium` / `large-v3`) — bigger, slower, and BG WER is
   undocumented. Cheap to try; validate on a real clip before relying on it.
3. **Rendering them** — `@remotion/captions` gives `createTikTokStyleCaptions()`
   (page grouping via `combineTokensWithinMilliseconds`) and per-token highlighting.
   **Gotcha:** captions are whitespace-sensitive — keep the leading space in each
   token's `text` and set `whiteSpace: "pre"`, or the words run together.

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
