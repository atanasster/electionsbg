# „Наясно Новини“ — editorial home grid v4

**Status:** proposed, 2026-09-01. No product code is changed by this document.

This plan follows the implemented story-card v3 work. V3 improved the anatomy of
an individual card; v4 fixes how cards of different kinds compose into a whole
page.

## 1. Outcome

Turn the home page from a three-column collection of independently sized tiles
into a calm editorial briefing with a deliberate visual rhythm:

- one image-led lead story;
- at most one secondary feature per section;
- a consistent, text-led supporting-card system with optional side thumbnails;
- full-width use of short sections instead of empty grid tracks;
- visible, compact image provenance and attribution;
- source order, visual order, keyboard order and chronological order that agree.

The page should look designed even when only five of sixteen stories have a
rights-cleared image, not merely when every card happens to have the same data.

## 2. Diagnosis

### 2.1 The screenshots are one structural failure

The current supporting grid becomes three equal-width columns at 1024px. Each
CSS Grid row is as tall as its tallest item. Image-led cards add a full-width
16:10 image and caption above the same body used by text cards.

The cards then opt into two different height rules:

- image-led detailed cards use `h-full`;
- text-first and compact cards use `self-start`.

As a result, a portrait card can make its row roughly twice as tall while the
two adjacent text cards stop at their natural height. The next row cannot rise
into the empty space. This produces the large blank bands in screenshots 2 and
3: it looks like a broken masonry layout, but it is ordinary row-based Grid.

Other height variance compounds the same problem:

- comparison cards may add a labelled spectrum while single-source cards do
  not;
- summaries and titles have different clamped lengths;
- a long credit may wrap;
- a section with only two supporting stories still uses a three-track grid,
  leaving a visibly empty third track as in screenshot 1.

### 2.2 The current test suite misses composition

The visual fixture proves that individual cards do not overflow and explicitly
expects an image-led card to be taller than a text-first card. It does not render
the live section composition or assert row geometry, section fill, chronological
reading order, or the size of the holes between rows.

This is why v3 can be correct at card level and the shipped page can still look
broken.

### 2.3 The current corpus must shape the design

Measured from `news/app-data/home.json` on 2026-09-01:

| home corpus | count |
| --- | ---: |
| stories | 16 |
| analyzed article records | 19 |
| stories with a rights-cleared image | **5** |
| single-outlet stories | **14** |
| multi-outlet stories | **2** |

All five currently cleared images are Creative Commons illustrations selected
for the subject. They are not publisher-permission source photographs. The UI
must therefore distinguish an independently selected illustration from an
image actually published with a source article.

## 3. Options considered

### A. Stretch every card to the tallest card in its row

This would align bottoms with a small CSS change, but it would turn the existing
blank bands into blank space *inside* adjacent cards. The page would remain
visually sparse and the image would still determine the row's importance.

**Decision:** reject as a cosmetic patch.

### B. Use true masonry or dense auto-placement

This would fill the holes, but it weakens the chronological scan and can make
visual, DOM and keyboard order disagree. Native masonry is not a sufficiently
stable cross-browser foundation for the primary news feed, and a JavaScript
packing algorithm adds layout shift and complexity to a finite sixteen-item
briefing.

**Decision:** reject for the main feed. It is acceptable only for a future,
non-chronological visual archive whose DOM and reading-flow behavior have been
proven separately.

### C. Reserve an identical media slot on every card

This gives perfect rows, but fourteen text-first stories would receive a large
logo, monogram or pseudo-image only to satisfy geometry. V3 deliberately removed
that unfinished-looking placeholder treatment.

**Decision:** reject.

### D. Hybrid editorial grid

Reserve large media for feature modules. Standard stories use one stable card
anatomy; a cleared image appears as a side thumbnail at desktop widths rather
than a full-width block. Text-first stories use the same card without reserving
an empty media area.

**Decision:** recommend.

## 4. North-star page composition

### 4.1 Lead band

Keep one lead story, but make the full module visible as one composition:

- desktop: image 7/12, content 5/12;
- mobile: image, compact attribution, then content;
- no supporting cards are allowed to stretch the lead's row;
- the lead image remains the only eager/high-priority image;
- image choice remains deterministic and rights-gated.

The lead should not be selected merely because it is the newest item with any
image. Rank eligible leads by freshness, multi-outlet breadth, summary quality
and image relevance, with deterministic tie-breaks. Do not rank by ideological
extremity or predicted clicks.

### 4.2 `Обнови ме` band

After the lead, supporting updates use an auto-fitting row:

- one story fills the available width;
- two stories form two equal columns;
- three stories may form three compact columns only when the resulting card
  width remains at least 23rem; otherwise the third wraps;
- no empty third track is retained for a two-item section.

These are the most recent stories, so their DOM order stays chronological.

### 4.3 Standard story grid

Use at most two columns inside the existing 84rem reading shell.

- below 48rem: one column;
- 48–64rem: one wide row card, allowing an optional side thumbnail;
- 64rem and above: two columns, each using `minmax(0, 1fr)`;
- never return to three standard columns merely because the monitor is wide.

This produces a comfortable Bulgarian headline measure and makes an image
thumbnail additive rather than structurally dominant.

### 4.4 Standard story-card anatomy

Desktop image-led card:

```text
┌────────────────────────────────────────────────┐
│ ┌─────────────┐  topic                         age │
│ │    image     │  Story headline                  │
│ │              │  Two-line synthesis…               │
│ └─────────────┘                                  │
│ Illustration: creator · licence                      │
│ BTA · BNR · +2 more          Coverage differs →        │
└────────────────────────────────────────────────┘
```

Text-first cards remove the media column and let the content span the card. They
do not reserve an empty slot.

All standard cards in a completed row stretch to the same row height, but the
thumbnail format keeps natural heights close enough that stretching does not
create a large void. Source preview and the comparison cue sit in a stable
footer region. Titles and summaries retain explicit clamps.

### 4.5 Analysis cue

Do not render the full spectrum bar on every supporting comparison card. It is
too tall for the amount of evidence currently available and visually resembles
a confidence meter.

Use a one-line, text-labelled cue in the standard card footer, for example:

- `2 медии · има разлики в рамкирането`;
- `3 медии · различна позиция спрямо Русия`.

The lead or a dedicated `Различни гледни точки` feature may keep one
fully labelled distribution with counts. The story page remains the place for
the complete analysis.

### 4.6 Briefing controls

The current large `Моят кратък преглед` panel interrupts the story rhythm
after only two supporting cards. Recompose it as a compact briefing toolbar:

- one summary line: cadence, density, followed-topic count and last completion;
- `Приключих прегледа` remains visible;
- advanced topic and format controls open in a disclosure/drawer;
- mobile touch targets remain at least 44px;
- preferences and behavior do not change in this visual pass.

This is lower priority than the grid repair and may ship as a separate phase.

## 5. Image and attribution model

### 5.1 Rights remain fail closed

Source-article imagery is welcome, but attribution is not permission. A home
image still requires `display_home === true`, an allowlisted rights status and
reviewable authority under the approved image-rights policy.

Unknown, blocked and merely hotlinkable publisher images stay out of the home.

### 5.2 Distinguish provenance visibly

Extend the image record additively with a reviewed role/origin, for example:

```ts
type ImageRole = "source_photo" | "illustration" | "official_image";

type ImagePresentation = {
  role: ImageRole;
  source_domain: string | null;
  source_article_url: string | null;
  crop_allowed: boolean;
  focal_x: number | null;
  focal_y: number | null;
};
```

The visible caption then says what the image actually is:

- source image: `От публикацията на Actualno · Снимка: …`;
- selected Commons work: `Илюстрация: … · CC BY-SA 4.0`;
- official library: `Официално изображение: … · условия`.

The article link, creator/source link and licence/authority link remain separate
focus targets. The full structured attribution remains available to assistive
technology and on the story page.

### 5.3 Cropping and focal point

The screenshot portraits are visually over-dominant and occasionally awkwardly
cropped. Add optional reviewed focal coordinates, but apply cover-cropping only
when the recorded authority permits adaptation. Otherwise render the whole image
with `contain` and an intentional neutral surround.

Do not infer a face crop in the browser and do not proxy or create derivatives
without a recorded permission basis.

### 5.4 Home image selection

Choose at most one image per story on the home page. Rank candidates by:

1. rights-cleared source image directly associated with a story member;
2. rights-cleared official image directly associated with the event/person;
3. rights-cleared illustration with reviewed subject relevance;
4. no image.

Within one rung, rank by relevance review, recency, outlet rank and stable id.
Do not prefer an image solely because it exists, and do not show a collage of
several outlets in standard cards. A multi-image comparison belongs on the story
page, where each image can carry a readable caption and context.

## 6. Implementation plan

### Phase 0 — Lock the composition contract

1. Add a full-home test fixture generated from the current 16-story shape: five
   image stories, long Bulgarian headlines, wrapped credits, two comparisons
   and short two-item sections.
2. Capture the current screenshots as failing references for the layout defect.
3. Add geometry assertions for complete rows: card tops and bottoms align
   within one CSS pixel, and the next row starts at the configured gap rather
   than after an unrelated tall media block.
4. Assert that one- and two-item sections consume the available width without
   an empty reserved track.
5. Assert that DOM, focus and visual order stay chronological.

Likely files:

- `newsapp/test-fixtures/`
- `tests/news/story-cards.spec.ts`
- a new full-home Playwright spec or extension of
  `tests/news/responsive-pages.spec.ts`

### Phase 1 — Build layout primitives

1. Introduce an `EditorialStoryGrid`/section-grid primitive with named variants
   for update and standard sections.
2. Introduce a media presentation primitive that supports feature, thumbnail
   and no-media modes without changing rights behavior.
3. Give every standard card one internal grid with explicit media, content,
   attribution and footer areas.
4. Replace the full spectrum in standard cards with the compact comparison cue.
5. Preserve one story link around title + summary and independent external
   attribution links.

Likely files:

- `newsapp/app/components/StoryCard.tsx`
- `newsapp/app/components/LeadStory.tsx`
- `newsapp/app/components/ArticleImage.tsx` or a new `StoryMedia.tsx`
- `newsapp/app/components/StorySourcePreview.tsx`
- `newsapp/news.css`

### Phase 2 — Recompose the home

1. Replace the shared three-column `STORY_GRID` string with section-aware grid
   variants.
2. Keep the lead in its own band.
3. Let the remainder of `Обнови ме` auto-fit one to three compact
   cards without a reserved empty column.
4. Render `Още анализирани истории`, perspectives and
   outside-interest stories in the two-column standard grid.
5. Keep briefing grouping and ranking semantics unchanged in this phase.
6. Verify that compact density remains a real information-density option and
   does not simply remove all imagery without changing layout.

Likely files:

- `newsapp/app/screens/HomeScreen.tsx`
- `newsapp/app/homeHierarchy.ts`
- `newsapp/app/briefing.ts`
- `newsapp/news.css`

### Phase 3 — Add explicit image provenance

1. Add optional presentation/provenance fields to the article image contract.
2. Update the Commons backfill to emit `role: "illustration"` deterministically.
3. Update any publisher-permission workflow to emit `source_photo`, the source
   domain/article URL and the recorded crop permission.
4. Validate that a source-photo caption names the publishing outlet and that an
   illustration never does.
5. Backfill the five current cleared records and rebuild `home.json`.
6. Keep the UI tolerant of an old bundle during deployment; missing new fields
   fall back to the existing neutral `Изображение:` label, never to a
   fabricated source-photo claim.

Likely files:

- `newsapp/app/data.ts`
- `newsapp/app/components/imageCredit.ts`
- `news/scripts/build_app_data.py`
- image-rights/backfill scripts and their tests
- `news/config/image_rights_policy.json` only if the policy itself changes

### Phase 4 — Compact the briefing controls

1. Move advanced cadence/density/topic settings behind a disclosure or sheet.
2. Preserve the completion action and current local-storage contract.
3. Keep the expanded control fully keyboard-operable with visible focus in
   both themes.
4. Test the panel at 320px and 400% zoom.

Likely files:

- `newsapp/app/components/BriefingControls.tsx`
- `newsapp/app/components/BriefingControls.test.tsx`
- `newsapp/news.css`

### Phase 5 — Responsive, accessibility and performance gates

Verify at 320, 390, 768, 1024 and 1440 CSS pixels, plus a 1280px viewport at
400% zoom:

- no two-dimensional page scrolling;
- no card, credit, source name or topic badge defines min-content width;
- visual order matches DOM and keyboard order;
- every image has correct alt treatment and a visible credit;
- every credit/authority link has a visible two-color-equivalent focus state in
  light and dark themes;
- muted attribution remains at least 4.5:1 for its text size;
- the comparison cue is understandable without color;
- reduced motion removes hover translation;
- only the lead image is eager; supporting images are lazy;
- image failure leaves an intentional stable card rather than a broken icon;
- no new proxy, cache or derivative path bypasses the rights record;
- layout shift stays within the existing news performance budget.

Run at minimum:

```bash
npx vitest run newsapp/app/components newsapp/app/screens/HomeScreen.test.tsx \
  newsapp/app/screens/HomeScreen.layout.test.ts scripts/news_accessibility.test.ts
npm run news:cards:visual
npm run build:news
npm run news:perf:gate
```

Before release, run the complete `news:release:gate`.

## 7. Acceptance criteria

The work is complete when:

1. No desktop section contains the screenshot pattern of one tall portrait card
   holding two short text cards above a blank band.
2. A two-item update section uses the full content width without an empty third
   track.
3. Standard story cards use at most two columns and remain comfortably readable
   in Bulgarian and English.
4. An optional supporting image changes the card's visual richness, not the
   height of the entire section.
5. Text-first cards look intentional and reserve no fake media slot.
6. Large media appears only in a lead or explicit feature module.
7. Full spectrum charts no longer create random supporting-card heights.
8. A source image says which publication it came from; an independent
   illustration is labelled as an illustration.
9. Every displayed image remains rights-cleared and visibly attributed;
   attribution alone never qualifies an image.
10. Chronological DOM, visual and focus order agree at every breakpoint.
11. The page reflows at 320 CSS pixels and 400% zoom without horizontal scroll.
12. Light, dark, keyboard, reduced-motion and failed-image states pass.

## 8. Explicitly out of scope

- native/JavaScript masonry for the primary feed;
- fake AI documentary imagery;
- using outlet logos as large substitutes for missing article images;
- changing story clustering to manufacture more comparison cards;
- rewriting ranking around engagement or outrage;
- making the whole card an anchor around credit and licence links;
- multi-image collages on ordinary home cards;
- weakening or bypassing the approved image-rights policy.

## 9. Recommended sequence

Ship the layout repair first using the current five cleared images and current
data contract. Add explicit image-role metadata immediately after, then compact
the briefing controls. This gives the page a stable editorial skeleton before
expanding the source-image pipeline, so future image coverage improves the
design instead of destabilizing it again.
