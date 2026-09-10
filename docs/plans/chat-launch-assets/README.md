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
