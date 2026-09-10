# Homepage artwork

Generated with the built-in imagegen tool on 2026-09-10. The original is
`artwork-original.png`; `artwork.webp` is the 720 × 480, 20,474-byte optimized
derivative copied to `public/images/chat/invitation.webp`. Compression preserves
the composition; the original remains available. The symbolic chart has no
numerical claim and is decorative. All actionable text is HTML.

Prompt:

> Use case: ads-marketing. Create a polished editorial illustration for a Bulgarian civic public-data website Наясно, a compact homepage chat invitation. Wide 3:2 composition. Warm cream paper backdrop, charcoal fine ink outlines, restrained burnt-orange accents, subtle paper texture. One speech bubble with a simple question mark connects to a tidy abstract bar-chart card and then an official paper/source document with a small check symbol. Friendly, clear, intelligent, contemporary editorial illustration; ample breathing room, no robot, no brain, no glowing AI effects. No written words, no logos, no numbers or purported real data. The decorative chart is symbolic, not a factual visualization. All three elements form one balanced compact composition readable at 240px wide. No border or drop shadow.

The homepage invitation is visible in development for review. Production is
gated by `CHAT_LAUNCH_PUBLISHED` in `src/lib/chatLaunch.ts`; enable it together
with the reviewed article. Its secondary article link is absent until then.

## Article example evidence (T4)

`examples.json` retains exact bilingual questions, routes, tool arguments, actual narration/envelopes, follow-up sequence, source identifiers and capture timestamps. `source-checks.json` records serving-payload checks, including the budget reconciliation and the 240-seat sum. These are not a complete independent audit of upstream records. `research.md` separates observed competitor behavior from publisher documentation and records excluded examples.

`originals/` contains actual preview screenshots at 800px width; no answer pixels were rewritten. `annotations.json` and `review.html` add numbered **HTML** gutter annotations and accessible captions alongside the unchanged screenshots. This keeps annotation text translatable and legible on narrow displays. T5 carries this composition into the article renderer. Four main figures are start, budget, follow-up and limits. Other originals are supporting evidence, not all intended for publication.

To repeat the capture, run `node scripts/chat-launch/capture-examples.cjs` from the repository root after refreshing the isolated preview. It replaces task-owned originals and writes a candidate manifest to `/tmp/chat-launch-final-examples.json`; verify that candidate before replacing `examples.json`. It does not deploy. The preview hostname expires and must be refreshed when repeating this later.

Review repairs: each figure links to its original at full resolution for narrow-screen inspection; T5 must retain that explicit action. The two supporting `prices-*.png` captures contain map-provider “API KEY REQUIRED” watermarks and are **excluded from publication**. Their numerical table was checked, but the images are diagnostic evidence only. The four selected article figures contain no such map watermark.
