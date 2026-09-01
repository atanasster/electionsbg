# „Наясно Новини“ — editorial home grid v4

**Status:** proposed, 2026-09-01. Audited against the codebase, the gates and the
live corpus on 2026-09-01; every measured figure below carries that date and was
taken from this checkout. No product code is changed by this document.

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

⚠️ **That last sentence is a RATIO-ROBUSTNESS property, and it is the thing most
likely to be under-tested.** The work is not "make today's 5-of-16 corpus look
good"; it is "look good at every image ratio between 0 and 1". A fixture pinned
to today's ratio tests one point on that curve and rots the moment coverage
moves — and coverage is about to move: `home_health.counts.recent_image_cleared`
is already **40** against the **5** the home bundle currently selects.

## 2. Diagnosis

### 2.1 The screenshots are one structural failure

The current supporting grid becomes three equal-width columns at 1024px
(`newsapp/news.css:213`). Each CSS Grid row is as tall as its tallest item.
Image-led cards add a full-width 16:10 image and caption above the same body
used by text cards.

The cards then opt into two different height rules
(`newsapp/app/components/StoryCard.tsx:63`):

- image-led detailed cards use `h-full`;
- text-first and compact cards use `self-start`.

As a result, a portrait card can make its row roughly twice as tall while the
two adjacent text cards stop at their natural height. The next row cannot rise
into the empty space. This produces the large blank bands in screenshots 2 and
3: it looks like a broken masonry layout, but it is ordinary row-based Grid.

Other height variance compounds the same problem:

- summaries and titles have different clamped lengths;
- a long credit may wrap;
- a section with only two supporting stories still uses a three-track grid,
  leaving a visibly empty third track as in screenshot 1.

⚠️ **The comparison spectrum is NOT one of those causes, and an earlier draft of
this plan said it was.** `newsapp/app/briefing.ts:132-133` partitions the
remainder strictly by kind — `perspectives` is every comparison story,
`moreAnalyzed` is every non-comparison story — so the two sections are
homogeneous by construction. The 13-card section where the holes actually appear
contains **zero** spectra. Mixed-kind rows can only occur in `Обнови ме`
(at most two cards) and `Водещи истории извън интересите ви` (at most three).
§4.5 remains a good copy decision; it is not a layout fix, and must not be
scheduled as one.

### 2.2 The measured composition, 2026-09-01

Simulating `buildHomeHierarchy` → `buildBriefingSections` over the committed
`news/app-data/home.json` with no followed topics and the 7-day default window:

| section | cards | with image | tracks | result |
| --- | ---: | ---: | --- | --- |
| lead | 1 | 1 | own band | fine |
| `Обнови ме` | **2** | 0 | 3 | **one empty track** — screenshot 1 |
| `Различни гледни точки` | **0** | 0 | — | section does not render at all |
| `Още анализирани истории` | **13** | 4 (idx 1, 6, 8, 10) | 3 → 5 rows | **4 of 5 rows carry an image card** — screenshots 2/3 |
| `Водещи истории извън интересите ви` | 0 | 0 | — | renders the "follow topics" empty state |

Three consequences the design must absorb:

- the empty third track is real, and it is in the **update** band;
- the blank bands are in **`Още анализирани истории`**, a section with no
  spectra in it, so the fix there is entirely about the media block;
- `Различни гледни точки` is **currently empty** — both comparison stories are
  recent enough to land in `update` — so any rule written for it has no
  production instance to check against today.

### 2.3 The current test suite misses composition — and pins the opposite

The visual fixture proves that individual cards do not overflow and explicitly
expects an image-led card to be taller than a text-first card. It does not render
the live section composition or assert row geometry, section fill, chronological
reading order, or the size of the holes between rows.

This is why v3 can be correct at card level and the shipped page can still look
broken.

⚠️ **Worse: four committed artifacts encode exactly the behaviour v4 replaces,
and `npm run news:release:gate` therefore fails at three points before a single
new assertion is written.** They are listed in §6 Phase 0.5, which exists to
retire them in one commit.

### 2.4 The current corpus must shape the design

Measured from `news/app-data/home.json` on 2026-09-01:

| home corpus | count |
| --- | ---: |
| stories | 16 |
| analyzed article records | 19 |
| stories with a rights-cleared image | **5** |
| single-outlet stories | **14** |
| multi-outlet stories | **2** |

All five currently cleared images are Creative Commons illustrations selected
for the subject (`status: "cc"`, 5 of 5). They are not publisher-permission
source photographs. The UI must therefore distinguish an independently selected
illustration from an image actually published with a source article.

Across the whole review trail — `news/data/**`, not just the home bundle —
**40** article records carry an `image_rights` block: 36 `cc` and 4
`public_domain`, all `display_home: true`. **Zero** carry
`publisher_permission`. Two things follow, and both shape Phase 3:

- a schema change to the rights block touches **40 records, not 5**;
- the `source_photo` path in §5.2 would ship with **no production instance**, so
  its only possible gate is a fixture plus a build-time validator that makes the
  claim unforgeable.

## 3. Options considered

### A. Stretch every card to the tallest card in its row

This would align bottoms with a small CSS change, but it would turn the existing
blank bands into blank space *inside* adjacent cards. The page would remain
visually sparse and the image would still determine the row's importance.

**Decision:** reject as a cosmetic patch. ⚠️ Note that the obvious geometry
assertion — "card tops and bottoms align within one CSS pixel" — **passes on
this rejected option**. See Phase 0 for the assertion that discriminates.

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

⚠️ **Most of this section already ships — keep it, do not re-implement it.**
`newsapp/app/components/LeadStory.tsx:41` is already `md:grid-cols-5` with the
image at `col-span-3` and the content at `col-span-2` (60/40, against the 58/42
of a 7/12 split — a difference not worth a commit). Mobile image-first ordering,
the single `priority` eager image, the rights-gated image choice and the lead
living outside the supporting grid so nothing can stretch its row are all
current behaviour. The invariants below are therefore **regression targets**,
not new work:

- desktop: image and content side by side, image the larger track;
- mobile: image, compact attribution, then content;
- no supporting cards are allowed to stretch the lead's row;
- the lead image remains the only eager/high-priority image;
- image choice remains deterministic and rights-gated.

**The one genuinely new thing here is the ranking function.** Today the lead is
`supportingRank` — recency, then outlet breadth, then id — over items that have
a cleared image and a non-empty `summary_bg`. That is close to "newest cleared
image with a summary".

⚠️ **Rank only by fields that exist.** Of the four criteria an earlier draft
proposed — freshness, multi-outlet breadth, summary quality, image relevance —
the first two are available today and the last two **have no field in the data
model**, and Phase 3 does not add one. So either:

- **(recommended)** ship freshness + breadth + a deterministic id tie-break,
  which is one small, testable change over today's rank; or
- specify `image_relevance` / `summary_quality` as reviewed fields in Phase 3
  with their own validators, and only then rank on them.

Do not rank by ideological extremity or predicted clicks.

### 4.2 `Обнови ме` band

After the lead, supporting updates use an auto-fitting row:

- one story fills the available width;
- two stories form two equal columns;
- no empty third track is retained for a two-item section.

These are the most recent stories, so their DOM order stays chronological.

⚠️ **There is no three-column case, and an earlier draft specified one.**
`newsapp/app/briefing.ts:129` caps `update` at three items and slot 0 is
consumed by the lead (or by the first card when the lead is suppressed), so the
update grid holds **at most two**. A "three compact columns above 23rem" rule
would be dead spec, dead code and an untested branch. If three is wanted, the
cap in `briefing.ts` has to change first, deliberately, with its own reasoning
about how much a briefing may show before completion.

### 4.3 Standard story grid

Use at most two columns inside the existing 84rem reading shell
(`newsapp/news.css:38`).

- below 48rem: one column;
- 48–64rem: one wide row card, allowing an optional side thumbnail;
- 64rem and above: two columns, each using `minmax(0, 1fr)`;
- never return to three standard columns merely because the monitor is wide.

This produces a comfortable Bulgarian headline measure and makes an image
thumbnail additive rather than structurally dominant.

**Auto-fit is a property of the grid primitive, not a special case for
`Обнови ме`.** A section holding fewer cards than its track count must consume
the width rather than reserve an empty track — otherwise §4.2's defect returns
in two-column form the first time `Различни гледни точки` renders a single
story, which §2.2 shows is exactly one story away.

⚠️ **State the tablet trade openly.** Today the grid is two columns from 640px;
this moves that to 1024px, so a 768px tablet loses half its density.
`tests/news/responsive-pages.spec.ts` exercises 768 and its expectations move
with this change. The trade is deliberate — a 384px column cannot hold a
Bulgarian headline plus a thumbnail — but it is a regression for tablet users
and should be named rather than discovered.

### 4.4 Standard story-card anatomy

Desktop image-led card:

```text
┌──────────────────────────────────────────────────────┐
│ ┌──────────┐   topic                            age  │
│ │  thumb   │   Story headline                        │
│ │          │   Two-line synthesis…                   │
│ └──────────┘                                         │
│ Illustration: creator · licence                      │
│ BTA · BNR · +2 more              Coverage differs →  │
└──────────────────────────────────────────────────────┘
```

Text-first cards remove the media column and let the content span the card. They
do not reserve an empty slot.

All standard cards in a completed row stretch to the same row height, but the
thumbnail format keeps natural heights close enough that stretching does not
create a large void. Source preview and the comparison cue sit in a stable
footer region. Titles and summaries retain explicit clamps.

**"Close enough" is a number, not a hope.** The design target is:

> in any completed row, the tallest image-led card is at most **1.25×** the
> tallest text-only card, and no card's rendered content ends more than **32
> CSS pixels** above its own bottom edge.

Both are asserted in Phase 0. Without them, §4.4 is prose that Option A also
satisfies.

**Decide what happens to the text-card kicker.** `.news-story-card--text::before`
(`newsapp/news.css:68`) is the 3px gradient rule that makes a text-first card
look intentional rather than unfinished — v3's highest-value change. Once an
image card is a thumbnail card, the two are visually close, and a rule present
on one and absent on the other becomes an arbitrary distinction. Recommendation:
**apply the kicker to every standard card** and let the thumbnail be the only
difference. Note `scripts/news_home_layout.test.ts` pins the rule's existence, so
this is a gate edit either way.

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

⚠️ **Scope claim:** per §2.1 this is a **copy and comprehension** improvement,
not a fix for the blank bands. Measured on the current corpus it changes the
height of at most two cards, in a section that does not currently render. It is
worth doing; it is not worth sequencing ahead of the grid repair, and it must
not be credited with fixing row geometry.

### 4.6 Briefing controls

The current large `Моят кратък преглед` panel interrupts the story rhythm
after only two supporting cards. Recompose it as a compact briefing toolbar:

- one summary line: cadence, density, followed-topic count and last completion;
- `Приключих прегледа` remains visible;
- advanced topic and format controls open in a disclosure/drawer;
- mobile touch targets remain at least 44px;
- preferences and behavior do not change in this visual pass.

This is lower priority than the grid repair and may ship as a separate phase.

### 4.7 Compact density

⚠️ **Compact density is a first-class layout state and no earlier draft
specified it.** Today, at `density === "compact"`:

- `HomeScreen` renders **no lead module at all** — the lead becomes an ordinary
  `StoryCard`;
- `StoryCard` drops the image, the summary and the spectrum.

So compact's entire differentiator is "remove media and prose". Under a
two-column grid with side thumbnails, removing a thumbnail barely changes the
page, and dropping the lead module removes the one composition v4 exists to
protect. Decide and record:

- does compact keep the lead module (recommended: **yes**, at a reduced image
  ratio) or keep dropping it?
- does compact keep the thumbnail (recommended: **no**) and, if not, does it
  gain a tighter row rhythm so it remains a real density option rather than the
  same layout with less in it?

Phase 2 must verify this, and Phase 0's fixture matrix must cover both
densities — otherwise compact is only ever seen by readers who chose it.

## 5. Image and attribution model

### 5.1 Rights remain fail closed

Source-article imagery is welcome, but attribution is not permission. A home
image still requires `display_home === true`, an allowlisted rights status and
reviewable authority under the approved image-rights policy.

Unknown, blocked and merely hotlinkable publisher images stay out of the home.

Two existing enforcement points must survive Phase 3 unchanged:

- `newsapp/app/data.ts:1068` rejects the **whole bundle** unless every article
  without `display_home === true` has `image === null`. Non-cleared image URLs
  never reach the client at all.
- `news/scripts/build_app_data.py:457` (`image_rights_block`) validates status,
  evidence, URL shape and canonical dates at build time, and refuses a
  display-cleared record with missing evidence.

### 5.2 Distinguish provenance visibly

Extend the image record additively with a reviewed role/origin:

```ts
type ImageRole = "source_photo" | "illustration" | "official_image";
```

The visible caption then says what the image actually is:

- source image: `От публикацията на Actualno · Снимка: …`;
- selected Commons work: `Илюстрация: …`;
- official library: `Официално изображение: …`.

The article link, creator/source link and licence/authority link remain separate
focus targets. The full structured attribution remains available to assistive
technology and on the story page.

Five constraints, all of which an earlier draft left open:

- ⚠️ **`role` is NOT derivable from `status`, so it is new evidence, not a
  relabelling.** A CC-licensed photograph published *in* the article is `cc` and
  `source_photo`; a CC illustration we picked is `cc` and `illustration`. The
  status cannot tell them apart, which is exactly why the field is needed — and
  exactly why it can carry a false claim about a named publisher unless it is
  validated.
- ⚠️ **`source_photo` must be unforgeable at build time.** Require
  `source_article_url` to be non-null and its host to equal the article's own
  domain, and raise in `image_rights_block` otherwise. A caption reading
  „От публикацията на X" must be provably about X's own page.
- **Split the fields by nature, and put the rights-bearing ones inside
  `image_rights`.** `role`, `crop_allowed` and `source_article_url` are claims
  about permission and provenance: inside the block they inherit the fail-closed
  validator, the evidence check and the policy file. `focal_x` / `focal_y` are
  presentation and may live beside it. A free-standing `ImagePresentation`
  object would need a second validator, a second whitelist and its own arm in
  `isHomeBundle`, and would let the two disagree about the same image.
- **The caption must not restate the licence.** `ArticleImage` already renders
  `licence_name` as its own focusable link, and `compactImageCredit` strips it
  from the text precisely to avoid the duplicate. `Илюстрация: … · CC BY-SA 4.0`
  would print it twice.
- ⚠️ **`compactImageCredit` is hardcoded Bulgarian.** It returns
  `Изображение: ${creator}` with no `tr()`, so English cards already read
  „Изображение: X" today. Phase 3 rewrites that function into three caption
  forms; localise it in the same change or record the deferral explicitly.

### 5.3 Cropping and focal point

The screenshot photographs are centre-cropped by `object-cover` inside a fixed
`aspect-[16/10]` box, so a portrait subject loses its top and bottom. (The
*card* is tall because of that box plus its caption, not because the image is
portrait.) Add optional reviewed focal coordinates, but apply cover-cropping only
when the recorded authority permits adaptation.

⚠️ **`contain` and a side thumbnail conflict, and the plan must resolve it.**
"Render the whole image with `contain` and a neutral surround" is reasonable in
a large lead slot and produces a *tiny* subject inside a small 16:10 thumbnail.
Specify both:

- the thumbnail's own aspect ratio (recommended: **1:1**, which suits both
  portrait and landscape sources far better than 16:10 at thumbnail size);
- the no-crop rendering inside it (recommended: `contain` on a neutral surround
  in a square box — acceptable at 1:1 in a way it is not at 16:10).

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

⚠️ Rungs 1 and 2 have **no members today** (§2.4: 36 `cc`, 4 `public_domain`,
0 `publisher_permission`), so this ladder is inert until the publisher-permission
pipeline exists. Ship it as ordering that degrades to rung 3, and gate it on a
fixture rather than on production data.

## 6. Implementation plan

### Phase 0 — Lock the composition contract

1. Add a full-home test **fixture matrix**, not one snapshot. Today's shape has
   zero perspectives, no mixed-kind rows and exactly one image ratio, so a
   fixture generated from it cannot exercise §4.2, §4.5 or §4.7 at all. Cover:
   - image coverage **0**, **4/13** (today), **all**;
   - section sizes **1, 2, 3, 13** cards;
   - at least one section mixing comparison and analyzed kinds;
   - both densities and both locales;
   - long Bulgarian headlines, wrapped credits, a failed image.
2. Capture the current rendering as a dated **"before" artifact** under
   `docs/references/news-home-editorial-grid-v4/`, following v3's convention.
   (A "failing reference screenshot" is not a thing — a reference that fails is
   a broken gate. The defect is encoded as a failing *assertion*, in item 3.)
   ⚠️ The screenshots this plan argues from are not in the repo: the only QA
   images under `docs/plans/` are dated 2026-08-28, i.e. before v3 shipped on
   08-31, so a reader currently cannot check the diagnosis.
3. Add geometry assertions that **discriminate against Option A**:

   ```ts
   // 1. No card's content may float in a void — catches Option A's
   //    "align the bottoms and leave the space inside the card".
   const slack = card.getBoundingClientRect().bottom
               - lastContentChild.getBoundingClientRect().bottom;
   expect(slack).toBeLessThanOrEqual(32);

   // 2. A thumbnail may enrich a card; it may not double it.
   expect(maxImageCardHeight / maxTextCardHeight).toBeLessThanOrEqual(1.25);
   ```

   ⚠️ Do **not** assert only "tops and bottoms align within one CSS pixel, and
   the next row starts at the configured gap". The first clause passes on
   Option A, which §3 rejects; the second is unfalsifiable, because rows in CSS
   Grid are always separated by the gap. The hole is *inside* the row.
4. Assert that a section holding fewer cards than its track count consumes the
   available width without an empty reserved track — for **every** section, not
   only `Обнови ме`.
5. Assert that DOM, focus and visual order stay chronological.

Likely files:

- `newsapp/test-fixtures/` (the matrix; note `story-cards.tsx:122` currently
  hard-codes `news-supporting-grid` and the spec asserts exactly four cards)
- `tests/news/story-cards.spec.ts`
- a new full-home Playwright spec or extension of
  `tests/news/responsive-pages.spec.ts`
- `docs/references/news-home-editorial-grid-v4/`

### Phase 0.5 — Retire the gates this plan invalidates

⚠️ **Four committed artifacts encode the behaviour v4 replaces. Retire them in
one commit, before Phase 1, so the release gate is green at every commit rather
than red for three phases.**

| artifact | what it pins | why v4 breaks it |
| --- | --- | --- |
| `scripts/news_home_layout.test.ts:15` | `repeat(3, minmax(0, 1fr))` at 1024px | §4.3 removes the third column |
| `scripts/news_home_layout.test.ts:22` | `.news-story-card--text::before` exists | §4.4 may apply the kicker to every card |
| `newsapp/app/components/StoryCard.test.tsx:99,127` | `h-full` on image cards, `self-start` on text cards | §4.4 replaces the mechanism |
| `tests/news/story-cards.spec.ts:48` | `textCardHeight < imageCardHeight` | §4.4 makes them near-equal by design |

Each is **replaced**, never simply deleted: the CSS gate re-pins the new track
rule, and the height assertion becomes the bounded ratio from Phase 0 item 3.
A gate that stops discriminating is worse than no gate.

### Phase 1 — Build layout primitives

1. Introduce an `EditorialStoryGrid`/section-grid primitive with named variants
   for update and standard sections, auto-fitting per §4.3.
2. Introduce a media presentation primitive that supports feature, thumbnail
   and no-media modes without changing rights behavior. Fix the thumbnail aspect
   and the no-crop rendering per §5.3.
3. Give every standard card one internal grid with explicit media, content,
   attribution and footer areas.
4. Replace the full spectrum in standard cards with the compact comparison cue.
5. Preserve one story link around title + summary and independent external
   attribution links.
6. **Measure the CSS budget before and after** (see §6.1). This phase is the one
   most likely to exhaust it.

Likely files:

- `newsapp/app/components/StoryCard.tsx`
- `newsapp/app/components/LeadStory.tsx`
- `newsapp/app/components/ArticleImage.tsx` or a new `StoryMedia.tsx`
- `newsapp/app/components/StorySourcePreview.tsx`
- `newsapp/news.css`
- `scripts/news_home_layout.test.ts` (re-pin the new track rule)

### Phase 2 — Recompose the home

1. Replace the shared three-column `STORY_GRID` string with section-aware grid
   variants. (`STORY_GRID` is `"news-supporting-grid grid gap-3"` — the column
   counts live in `news.css`, not in the string, so both sides move together.)
2. Keep the lead in its own band; keep §4.1's existing behaviour and change only
   the ranking function.
3. Let the remainder of `Обнови ме` auto-fit **one or two** cards without a
   reserved empty column. There is no three-card case (§4.2).
4. Render `Още анализирани истории`, perspectives and
   outside-interest stories in the two-column standard grid.
5. Keep briefing grouping and ranking semantics unchanged in this phase.
6. Resolve §4.7: decide whether compact keeps the lead module and what makes it
   a real density option rather than the same layout with less in it.

Likely files:

- `newsapp/app/screens/HomeScreen.tsx`
- `newsapp/app/screens/HomeScreen.layout.test.ts`
- `newsapp/app/homeHierarchy.ts`
- `newsapp/app/briefing.ts`
- `newsapp/news.css`

### Phase 3a — Extend the rights contract (no visible change)

⚠️ **This is where the whole risk of Phase 3 lives, and it is invisible in
review.** `news/scripts/build_app_data.py:523` returns a **strict whitelist
projection**:

```python
return {key: raw.get(key) for key in IMAGE_RIGHTS_KEYS}
```

and `:271` sets `IMAGE_RIGHTS_REQUIRED_KEYS = frozenset(IMAGE_RIGHTS_KEYS)`. So
there are exactly two outcomes and both need handling:

- add the new fields to the source records **without** extending
  `IMAGE_RIGHTS_KEYS` → they are **silently dropped**. The build exits 0,
  `home.json` never carries them, the UI falls back to the neutral
  `Изображение:` label for ever, and every count reconciles;
- add them **to** `IMAGE_RIGHTS_KEYS` → they become **required on every record**,
  and the build hard-fails until all **40** records carrying an `image_rights`
  block are backfilled — not the 5 the home bundle selects.

Steps:

1. Extend `IMAGE_RIGHTS_KEYS` with `role`, `crop_allowed`, `source_article_url`
   and extend the validator: enumerated role, boolean `crop_allowed`, and the
   `source_photo` host check from §5.2.
2. If any new field becomes required evidence, update
   `news/config/image_rights_policy.json` — `load_image_rights_policy` asserts
   `required_evidence == IMAGE_RIGHTS_KNOWN_EVIDENCE` exactly, so this is not
   optional the way §6's earlier draft implied.
3. Update `news/scripts/apply_commons_images.py` to emit
   `role: "illustration"` deterministically.
4. Backfill **all 40** records and rebuild `home.json`.
5. Add optional presentation fields (`focal_x`, `focal_y`) to the app contract
   and `isHomeBundle`, without weakening the `image == null` invariant at
   `newsapp/app/data.ts:1068`.
6. **Re-run `npm run news:perf:gate`** — `homeJsonGzip` is at 90.9% of budget
   (§6.1).

Verification for this phase is that `npm run news:data` still succeeds and the
new fields are present in `home.json`. No caption changes yet.

### Phase 3b — Render provenance

1. Rewrite `compactImageCredit` into the three caption forms of §5.2, localised
   (it is currently Bulgarian-only in both locales), without restating the
   licence the component already links.
2. Validate that a source-photo caption names the publishing outlet and that an
   illustration never does.
3. Keep the UI tolerant of an old bundle during deployment; missing new fields
   fall back to the existing neutral `Изображение:` label, never to a
   fabricated source-photo claim.
4. Gate the `source_photo` path on a fixture — there is no production instance
   (§2.4).

Likely files:

- `newsapp/app/data.ts`
- `newsapp/app/components/imageCredit.ts`
- `newsapp/app/components/ArticleImage.tsx`
- `news/scripts/build_app_data.py`
- `news/scripts/apply_commons_images.py` and its tests
- `news/config/image_rights_policy.json` if required evidence changes

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
- the gzip budgets of §6.1 still hold.

Run at minimum:

```bash
npx vitest run newsapp scripts/news_accessibility.test.ts \
  scripts/news_home_layout.test.ts scripts/news_performance_budget.test.ts
npm run news:cards:visual
npm run build:news
npm run news:perf:gate
```

⚠️ An earlier draft's command omitted `scripts/news_home_layout.test.ts` — the
one gate this change actually breaks (§6 Phase 0.5).

Before release, run the complete `news:release:gate`.

### 6.1 The budgets this plan spends

⚠️ **`npm run news:perf:gate` measures gzip BYTES, not layout shift.**
`scripts/news_performance_budget.ts:5` is `htmlGzip` / `cssGzip` / `jsGzip` /
`homeJsonGzip`. An earlier draft claimed "layout shift stays within the existing
news performance budget"; **there is no news CLS gate at all** —
`newsapp/app/newsVitals.ts` is a RUM beacon that reports from real sessions, and
`perf:cls` / `tests/perf.spec.ts` cover the main site, not `dist-news`.

Measured 2026-09-01 against the committed `dist-news` and `home.json`:

| budget | limit | current | used | headroom |
| --- | ---: | ---: | ---: | ---: |
| `cssGzip` | 30,000 | 26,465 | **88.2%** | **3,535 B** |
| `homeJsonGzip` | 33,792 | 30,720 | **90.9%** | **3,072 B** |
| `jsGzip` | 140,000 | 118,607 | 84.7% | 21,393 B |
| `htmlGzip` | 2,000 | 1,222 | 61.1% | 778 B |

Phase 1 (a grid primitive, a media primitive, per-card grid areas) and Phase 4
(a disclosure) spend `cssGzip`, which has 3.5 KB left. Phase 3a spends
`homeJsonGzip`, which has 3.0 KB left and grows with image coverage — and §1
expects coverage to grow from 5 toward the 40 already cleared.

Rules:

- run `news:perf:gate` after Phase 1 and again after Phase 3a's rebuild;
- landing over budget is a decision, not an accident: re-ratchet the constant
  **with the measurement written beside it**, never silently;
- if a CLS guarantee is wanted, add a real news CLS gate as its own piece of
  work; otherwise move the claim to §8.

## 7. Acceptance criteria

The work is complete when:

1. No desktop section contains the screenshot pattern of one tall portrait card
   holding two short text cards above a blank band.
2. **Any** section holding fewer cards than its track count uses the full
   content width without an empty reserved track — including the two-item
   `Обнови ме` band and a one-item `Различни гледни точки`.
3. Standard story cards use at most two columns and remain comfortably readable
   in Bulgarian and English.
4. An optional supporting image changes the card's visual richness, not the
   height of the entire section: in any completed row the tallest image-led card
   is at most 1.25× the tallest text-only card, and no card's content ends more
   than 32px above its own bottom edge.
5. Text-first cards look intentional and reserve no fake media slot.
6. Large media appears only in a lead or explicit feature module.
7. In a section that mixes comparison and analyzed stories, the comparison cue
   does not change the row height. (Scoped deliberately: §2.1 shows the
   post-briefing sections are homogeneous by kind, so a corpus-wide claim about
   spectra would be vacuous.)
8. A source image says which publication it came from, and that claim is
   validated at build time against the article's own domain; an independent
   illustration is labelled as an illustration.
9. Every displayed image remains rights-cleared and visibly attributed;
   attribution alone never qualifies an image.
10. Chronological DOM, visual and focus order agree at every breakpoint.
11. The page reflows at 320 CSS pixels and 400% zoom without horizontal scroll.
12. Light, dark, keyboard, reduced-motion and failed-image states pass.
13. The layout holds at image coverage 0, 4/13 and all — not only at today's
    ratio — and in both densities.
14. Every gate in §6 Phase 0.5 has been replaced by an assertion that still
    discriminates, and `news:release:gate` is green.
15. The gzip budgets of §6.1 hold, or were re-ratcheted with the measurement
    recorded.

## 8. Explicitly out of scope

- native/JavaScript masonry for the primary feed;
- a news CLS gate (no such gate exists today; adding one is separate work);
- fake AI documentary imagery;
- using outlet logos as large substitutes for missing article images;
- changing story clustering to manufacture more comparison cards;
- raising the `briefing.update` cap of three (a briefing-semantics decision, not
  a layout one);
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

Two amendments the audit adds:

1. **Phase 0.5 sits between the contract and the primitives.** Retiring the four
   contradicting gates in one commit keeps `news:release:gate` green at every
   commit instead of red for three phases — and forces each retired assertion to
   be consciously replaced rather than quietly dropped.
2. **Phase 3 splits into 3a and 3b.** All of the risk is in 3a (the whitelist
   projection and the 40-record backfill) and none of it is visible in the UI;
   3b is ordinary rendering work. Splitting them means the dangerous half is
   verified by "the build still succeeds and the fields are present", which is a
   check that cannot pass by accident.
