# Homepage artwork

Generated with the built-in imagegen tool on 2026-09-10. The original is
`artwork-original.png`; `artwork.webp` is the 720 × 480, 20,474-byte optimized
derivative copied to `public/images/chat/invitation.webp`. Compression preserves
the composition; the original remains available. The symbolic chart has no
numerical claim and is decorative. All actionable text is HTML.

Prompt:

> Use case: ads-marketing. Create a polished editorial illustration for a Bulgarian civic public-data website Наясно, a compact homepage chat invitation. Wide 3:2 composition. Warm cream paper backdrop, charcoal fine ink outlines, restrained burnt-orange accents, subtle paper texture. One speech bubble with a simple question mark connects to a tidy abstract bar-chart card and then an official paper/source document with a small check symbol. Friendly, clear, intelligent, contemporary editorial illustration; ample breathing room, no robot, no brain, no glowing AI effects. No written words, no logos, no numbers or purported real data. The decorative chart is symbolic, not a factual visualization. All three elements form one balanced compact composition readable at 240px wide. No border or drop shadow.

The homepage invitation replaces the slideshow beside search in development and
isolated preview builds, with no duplicate strip. Normal production retains the
slideshow until `src/lib/chatLaunchPublication.json` is published together with
the reviewed article. The preview includes the article link for editorial review.

`homepage-bg.png` and `homepage-en-dark-mobile.png` were refreshed on 2026-09-10
from the actual localhost UI at 1280px light and 390px dark respectively. They
show the replacement card, not article evidence for the displayed live metrics.

## Article example evidence (T4)

`examples.json` retains exact bilingual questions, routes, tool arguments, actual narration/envelopes, follow-up sequence, source identifiers and capture timestamps. `source-checks.json` records serving-payload checks, including the budget reconciliation and the 240-seat sum. These are not a complete independent audit of upstream records. `research.md` separates observed competitor behavior from publisher documentation and records excluded examples.

`originals/` contains actual preview screenshots at 800px width; no answer pixels were rewritten. `annotations.json` and `review.html` add numbered **HTML** gutter annotations and accessible captions alongside the unchanged screenshots. This keeps annotation text translatable and legible on narrow displays. T5 carries this composition into the article renderer. Four main figures are start, budget, follow-up and limits. Other originals are supporting evidence, not all intended for publication.

To repeat the capture, run `node scripts/chat-launch/capture-examples.cjs` from the repository root after refreshing the isolated preview. It replaces task-owned originals and writes a candidate manifest to `/tmp/chat-launch-final-examples.json`; verify that candidate before replacing `examples.json`. It does not deploy. The preview hostname expires and must be refreshed when repeating this later.

Review repairs: each figure links to its original at full resolution for narrow-screen inspection; T5 must retain that explicit action. The two supporting `prices-*.png` captures contain map-provider “API KEY REQUIRED” watermarks and are **excluded from publication**. Their numerical table was checked, but the images are diagnostic evidence only. The four selected article figures contain no such map watermark.


## Toolbar revision (2026-09-10)

The eight selected article originals and their public copies were refreshed after removing the integrated screens' duplicate branding/preferences/footer. The actual UI was captured at localhost:5173; only public data GETs were forwarded to the existing hosted DB and GCS sources. `toolbar-captures.json` records this provenance and timestamps. Each budget/follow-up answer's narration and full envelope exactly matched the previously reviewed hosted evidence. The screenshots contain no fabricated responses or edited answer pixels. Main-region images remain 800 × 1024; the limits views are 800 × 1200. Gutter positions were adjusted to the new layout.

`node scripts/chat-launch/refresh-article-figures.cjs` refreshes only these four bilingual figures. Its default is the hosted preview; `CHAT_CAPTURE_ORIGIN` optionally selects the local UI with real hosted read-through data. It fails if the reviewed narration or envelope changes. Review new data before updating that baseline. The candidate capture manifest is written to `/tmp/chat-toolbar-figure-captures.json`.
