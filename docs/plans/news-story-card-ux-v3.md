# „Наясно Новини“ — world-class story cards v3

**Status:** implemented, 2026-08-31.

Responsive behavior is gated by `tests/news/story-cards.spec.ts` at 320, 390,
768, 1024 and 1440 CSS pixels, plus the 720px reflow equivalent of a 1440px
window at 200% browser zoom. The same gate checks overflow, computed source
visibility, focus styling, reduced motion and dark surfaces. Its four reference
fixtures are captured under `docs/references/news-story-cards-v3/`.

## 1. Outcome

Make every home card read as a calm, editorial entry point to a story:

- the headline and summary are the primary link;
- publication names replace abstract coverage counts as the first source cue;
- image attribution remains correct but becomes compact and quiet;
- labels that repeat product-wide facts disappear;
- cards without a cleared image look intentionally text-first, not unfinished.

The card should answer, in order: **what is this, when was it updated, who
published it, and why should I open it?**

## 2. What the screenshots and code show

The current hierarchy spends too much space on interface copy:

- „АНАЛИЗИРАНА СТАТИЯ“ repeats an eligibility rule: every home item is already
  analyzed.
- „Прочети анализа →“ repeats the destination after a prominent headline and
  summary.
- „1 медия · 1 публикация“ is accurate but less useful than the publisher's
  identity.
- Commons `credit_text` is printed verbatim and then the licence is printed a
  second time. File names, raw URLs, credit boilerplate and licence text can
  occupy three or four lines.
- a story without a cleared image receives a large 16:10 grey placeholder,
  making a valid text story look as if its image failed to load.
- on text-first cards the topic appears in the placeholder and again as a chip.

Current data matters. In `news/app-data/home.json` on 2026-08-31 there are 16
stories and all 16 have one outlet. A `+2 още` treatment must only appear when
the story really has three or more additional outlets; the design must not imply
coverage breadth that the corpus does not yet contain.

## 3. Recommended card anatomy

### Supporting card

```text
┌──────────────────────────────────────┐
│ image (only when rights-cleared)     │
│ Image: OpenStreetMap · CC BY 4.0     │  quiet 11px credit
├──────────────────────────────────────┤
│ Външна политика              преди 8ч│
│                                      │
│ Нападнаха танкер в Ормузкия проток   │  linked headline
│ Танкер е ударен от неидентифициран…  │  linked summary
│                                      │
│ Petel.bg · БТА · +2 още              │  source preview
└──────────────────────────────────────┘
```

For a text-first card, omit the entire image/placeholder region. Start with the
topic/time row and use a restrained 3px topic-colored top rule or neutral card
surface. Do not manufacture a media-shaped empty box.

### Lead card

Keep the existing image/text split, but use the same information order and
components as supporting cards:

1. topic and time;
2. linked headline + linked summary as one focus target;
3. source preview;
4. no analysis eyebrow and no CTA.

The image credit remains outside the story link because its source and licence
are independent external links. The image itself does not become a story link;
this avoids nested or competing link behavior around the caption.

## 4. Copy and interaction decisions

### Remove

- „Анализирана статия“ / „АНАЛИЗИРАНА СТАТИЯ“ from lead and supporting cards.
- „Прочети анализа →“ from single-source cards.
- „Сравни отразяването →“ from multi-source cards. The comparison distinction
  belongs on the destination and, when useful, in a compact source cue rather
  than a second call to action.
- the duplicate bottom topic chip; retain one topic badge in the metadata row.

### Make clickable

Wrap the `<h3>` and summary in one `Link` to `/story/:id`. This produces one
clear keyboard stop and makes the exact content the user asked to open
clickable. Keep a visible focus ring around the linked block. Use headline color
change and a subtle card border/shadow change on hover; do not rely on card lift
or color alone.

The whole card should not be an anchor. Credit and licence links remain separate,
and source names should be display text on the home card rather than additional
focus stops. Outlet links remain available on the story page.

### Replace counts with source preview

Add a shared `StorySourcePreview` used by both card sizes.

- Compact card: show up to 2 publication names.
- Lead card: show up to 3 publication names.
- Remaining distinct outlets render as `+N още`.
- One-outlet story: show only its publication name, e.g. `Actualno`.
- If `article_count > outlet_count`, retain the non-duplicative information as
  quiet trailing copy, e.g. `БТА · БНР · +2 още · 7 публикации`.
- If an outlet is absent from the registry, fall back to its domain.

“Top” must be deterministic and must not imply an editorial trust score. Sort by:

1. number of articles from that domain in this story, descending;
2. outlet registry rank, ascending, when present;
3. localized display name/domain, ascending.

Add an accessible label with the complete meaning, for example: „Източници:
БТА, БНР и още 2 медии; общо 7 публикации“. Do not display stacked logos alone:
they are ambiguous, externally hosted and weak when an outlet has no mark.

### Compact image attribution

Keep the full structured rights record unchanged. Change only card presentation.
Add a density prop to `ArticleImage`, for example `creditVariant="compact"`, and
use it from `StoryCard`, `LeadStory` and other grid cards while keeping full
attribution on the article/story detail view.

Compact rendering should derive from structured fields rather than truncating a
legal string:

- preferred visible text: `Изображение: {creator}`;
- fallback: a cleaned, bounded `credit_text` with raw URLs and repeated licence
  tokens removed;
- separate licence link: `CC BY 4.0`;
- example transformation:
  `Илюстрация · Strait of Hormuz OSM.webp · https://… · OpenStreetMap · CC BY 4.0`
  becomes `Изображение: OpenStreetMap · CC BY 4.0`;
- use 11px (`text-[11px]`), normal weight, muted foreground, compact line height
  and 6–8px horizontal padding;
- allow wrapping when needed; do not ellipsize away creator or licence text;
- preserve source and licence as two links, their external-link semantics and
  visible keyboard focus.

The compact helper should be pure and tested. Do not rewrite `credit_text` in
the corpus or weaken the image-rights gate.

## 5. Additional visual improvements

### A. Intentional text-first cards — highest value

Remove the large grey pseudo-image. Use the saved vertical space for slightly
more generous title leading and a three-line title / two-line summary. This is
the largest improvement visible in screenshot 2.

### B. Stronger, simpler hierarchy

- metadata: 12px, muted;
- headline: 20px on supporting cards, 30–34px on the lead, editorial font;
- summary: 14–15px, `leading-relaxed`, muted but WCAG-compliant;
- sources: 12px, medium weight, visually below the summary;
- one topic badge only, with less fill and no more than one line.

Use consistent vertical rhythm: 12px metadata-to-title, 8px title-to-summary,
16px summary-to-sources. Let title length drive content naturally; avoid large
empty bottoms created solely to pin a CTA that no longer exists.

### C. More restrained card chrome

- soften the border from the current high-contrast outline;
- keep a very small resting shadow and a clearer hover/focus border;
- reduce hover translation to 0–1px or remove it;
- use 10–12px radius consistently for card and image corners;
- keep transitions disabled under `prefers-reduced-motion`.

### D. Better image treatment

- keep a stable aspect ratio for cards that have an image;
- add a subtle neutral caption surface distinct from body copy;
- consider optional focal-position metadata later; do not guess focal points
  with CSS now;
- retain eager/high-priority loading only for the single lead image.

### E. Responsive behavior

- 1 column below 640px, 2 columns from 640px, 3 columns from 1024px remains a
  sound grid.
- At 320–390px, source preview collapses to one name plus `+N още`.
- Never let publication names, credits or URLs define grid min-content width;
  preserve `minmax(0, 1fr)`, `min-w-0` and safe wrapping.
- At 200% zoom, title/summary remain reachable without horizontal scrolling.

## 6. Implementation plan

### Phase 1 — Pure presentation helpers

1. Add a compact credit formatter next to `ArticleImage`.
2. Add a source-preview selector/component that receives `by_domain` and the
   outlet registry.
3. Unit-test sorting, fallbacks, singular/plural text, `+N`, duplicate article
   counts, long creator names and raw-URL removal.

Likely files:

- `newsapp/app/components/ArticleImage.tsx`
- `newsapp/app/components/imageCredit.ts` (new)
- `newsapp/app/components/StorySourcePreview.tsx` (new)
- corresponding `*.test.ts(x)` files

### Phase 2 — Recompose both story cards

1. Pass the outlet registry (not only the representative image outlet) from
   `HomeScreen` to both card types.
2. Remove analysis eyebrows and CTA rows.
3. Wrap headline + summary in one story link.
4. Move topic and relative time into one top metadata row.
5. Render `StorySourcePreview` beneath the linked summary.
6. Omit `ArticleImage` and its 16:10 placeholder entirely when no cleared image
   exists.
7. Keep source/licence links outside the story link and preserve focus order.

Likely files:

- `newsapp/app/screens/HomeScreen.tsx`
- `newsapp/app/components/StoryCard.tsx`
- `newsapp/app/components/LeadStory.tsx`
- `newsapp/news.css`

No data-pipeline or `home.json` schema migration is required for the first
release: `aggregates.by_domain` and the outlet registry already contain the
needed information.

### Phase 3 — Polish and responsive verification

1. Tune card spacing, caption typography, hover/focus states and text-first
   styling in light and dark themes.
2. Verify 320, 390, 768, 1024 and 1440px widths plus 200% zoom.
3. Capture reference screenshots for image-led, text-first, single-source and
   multi-source fixtures.
4. Check long Bulgarian headlines, long outlet names, missing registry rows and
   long Commons creator names.

### Phase 4 — Gates

Update component tests to require:

- no rendered „Анализирана статия“, „Прочети анализа“ or redundant CTA;
- one internal story link wrapping the visible title and summary;
- independent credit and licence links with no nested anchors;
- correct keyboard order and visible focus states;
- compact credit contains no raw URL and does not repeat the licence;
- one-outlet, two-outlet and 4+-outlet source previews render honestly;
- a text-first card has no image-aspect placeholder and no duplicate topic;
- no horizontal overflow from long attribution or source names.

Run at minimum:

```bash
npx vitest run newsapp/app/components newsapp/app/screens/HomeScreen.test.tsx \
  newsapp/app/screens/HomeScreen.layout.test.ts
npm run build:news
```

Before release, also run the existing news release and accessibility gates.

## 7. Acceptance criteria

The work is complete when:

1. Opening a story is obvious from its headline and summary without a separate
   CTA.
2. Home cards never state that they are analyzed; analysis is treated as an
   eligibility rule.
3. A reader sees publication names before abstract counts, with an honest
   `+N още` only for real additional outlets.
4. The Hormuz example fits in one compact attribution line at desktop width and
   contains no visible raw URL, while creator/source and licence remain linked.
5. Cards without images look intentional and materially shorter than image-led
   cards.
6. The lead and grid share one information model and differ only in scale/layout.
7. Light, dark, keyboard, reduced-motion, mobile and 200% zoom states pass.

## 8. Deferred ideas

Do not include these in the first card pass:

- outlet trust/factuality badges;
- ideological color on source names;
- autoplay, carousels or infinite scroll;
- outlet logos without accompanying text;
- changing story ranking or clustering to make `+N` appear more often;
- rewriting historical image-rights metadata merely to shorten the UI.

Those either add a new product claim or solve a pipeline problem rather than the
card's reading experience.
