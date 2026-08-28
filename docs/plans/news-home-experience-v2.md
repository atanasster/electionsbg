# „Наясно НОВИНИ“ — competitive research and home experience v2

**Status:** proposed plan, 2026-08-28. No product code is changed by this document.

## 1. Recommendation in one sentence

Make the home page an **image-led feed of analyzed stories**, not a feed of scraped
articles: one event, one neutral synthesis, visible coverage breadth, then the different
outlet headlines behind it.

This means:

- Remove the public „Последни статии“ wire from the home page. It makes the product look like
  a conventional aggregator and makes the unanalyzed state the dominant experience.
- Keep only content that has passed analysis on the home page, but group it into stories.
  Do not render five articles about one event as five competing cards.
- Let a single-source analyzed item appear, clearly labelled **„Анализирана статия“**.
  Reserve **„Сравнение на отразяването“** for a cluster with at least two independent
  outlets. A one-outlet cluster is not a comparison.
- Use an image only when the product has a recorded right to display it. Attribution is
  required when the licence requires it, but attribution alone is not permission.

The intended product position is:

> **Не още новини. По-ясен прочит на новините.**

## 2. What the current corpus can actually support

Measured from `news/app-data` on 2026-08-28; the bundle was generated 2026-08-26.

| current bundle | count |
| --- | ---: |
| articles in the latest feed | 600 |
| analyzed articles in that feed | 130 |
| articles with an image | 55 |
| analyzed articles with an image | **1** |
| story clusters | 84 |
| clusters with 2+ outlets | **9** |
| single-outlet clusters | 75 |
| clusters with a Bulgarian summary | 83 |
| current blindspots | 0 |

Across all 4,367 per-outlet article records, 365 are analyzed and 254 carry an image, but
again only one record has both. This is a migration shape: most analyses predate the image
field.

Therefore an analyzed-only, image-led home cannot be shipped honestly by changing JSX.
The necessary sequence is:

1. establish image rights metadata;
2. backfill image metadata into the already analyzed corpus;
3. increase multi-outlet story coverage;
4. then switch the home surface.

The existing hotlink probe is operationally useful but is not a rights register. Of 72
outlet records, only 10 are currently recorded as hotlinking successfully, 3 refuse, and 59
are unknown.

## 3. Competitive landscape

### 3.1 Closest products

| product | organizing unit | strongest interaction | lesson for „Наясно“ | do not copy |
| --- | --- | --- | --- | --- |
| [Ground News](https://ground.news/about) | clustered story | coverage distribution, blindspots, ownership and outlet factuality | Make the story the entry point; source count and coverage mix are excellent scanning cues | Dense dashboards, ambiguous color bars, and treating an outlet rating as the article's own position |
| [AllSides](https://www.allsides.com/unbiased-balanced-news) | editorial story roundup | one synthesized explanation followed by representative Left / Center / Right headlines | Lead with „what happened“ and „how coverage differed“; show a few representative headlines before the full list | A US left/right vocabulary presented as universal; long editorial blocks on every card |
| [Particle](https://particle.news/blog/introducing-particle-the-news-organized) | multi-source story | concise multi-source summaries, multiple explanation modes, entities, timelines and sourced Q&A | Calm reading, progressive disclosure, entity context and „how we got here“ are strong later-stage directions | Personalization and chat before the corpus and evaluation are strong enough |
| [Google News Full Coverage](https://blog.google/products-and-platforms/products/news/get-full-news-story-full-coverage-search/) | topic/story cluster | breadth and freshness with a low-friction route to all sources | Familiar source cards and a clear „full coverage“ action reduce learning cost | A volume-ranked feed; it does not explain framing and would erase the differentiator |
| [SmartNews](https://about.smartnews.com/en/news/2460.html) | personalized feed plus perspective tool | an approachable „News From All Sides“ slider | A simple control can make perspective exploration inviting | Hiding source diversity inside a secondary tool rather than making it the product |
| [NewsGuard](https://www.newsguardtech.com/solutions/news-reliability-ratings/) | publisher | evidence-backed „nutrition label“ | Every consequential label needs provenance and a route to evidence | Red/green verdicts that collapse different questions into one trust score |
| [Ad Fontes](https://adfontesmedia.com/methodology/) | article and source samples | a two-dimensional bias/reliability model and detailed method | Keep separate measures separate and publish sample limitations | A single grand chart as the main reading experience |

### 3.2 Bulgarian alternatives

Bulgarian news aggregators such as Radar and „Виж новините“ compete on breadth,
recency and link discovery. Major portals compete on newsroom brand and volume. None of
those is the correct product benchmark. The defensible local gap is:

- article-level analysis rather than a permanent ideological label on the outlet;
- Bulgarian-specific media and political context;
- a second, explicit Russia-position axis;
- quoted evidence for the classification;
- links from people, parties, institutions and companies into the wider „Наясно“ data
  system.

The last item is the durable advantage. International competitors can build a prettier
bias bar; they cannot easily connect a Bulgarian news subject to declarations, procurement,
elections, parliament and public funding in one evidence system.

## 4. Product principles

### P1. Understanding before volume

The home page should answer „What matters, and what do the sources disagree about?“ It
should not answer „What are the latest 600 URLs?“

### P2. Story first, article second

A story is the public unit. Articles are the evidence and the different framings within it.
This removes duplication and makes the comparison promise legible.

### P3. Analysis status is an eligibility rule, not a badge

On the proposed home, unanalyzed content does not appear. The present „още не е
анализирана“ badge should disappear with the raw latest-articles section. It honestly
describes the pipeline, but it makes the reader browse work the product has not done.

An internal queue or optional `/latest` diagnostics surface can retain corpus recency. It is
not the home page.

### P4. Show counts with every distribution

A spectrum without a sample size looks more certain than it is. Every bar must say, for
example, „Анализирани 6 публикации от 4 медии“. Unknown and not-applicable
are not neutral and must never be colored as neutral.

### P5. Labels describe this article, not the human or outlet

Use „Анализът на текста открива…“. Avoid „Медия X е…“ unless the page is
showing a sufficiently large, dated distribution of that outlet's analyzed articles.

### P6. Calm, finite reading

No infinite scroll. Use a finite first page (12–18 stories), „Покажи още“, clear time
filters and a visible end. The experience should feel like completing a briefing, not losing
an attention contest.

## 5. Proposed information architecture

Top navigation:

1. **Истории** — analyzed story feed (home)
2. **Теми** — topic and disagreement discovery
3. **Медии** — outlet distributions with sample floors and ownership provenance
4. **Методология** — method, limitations, correction policy and image policy
5. Search — title, summary and resolved entities

Do not add personalization, accounts, notifications or a dedicated blindspot navigation item
yet. There are currently zero blindspots and only nine multi-source clusters; navigation must
not advertise an empty instrument.

## 6. Home page blueprint

### 6.1 Header and promise

Use one compact value proposition rather than corpus telemetry:

> **Новините, по-ясно.**  
> Сравняваме как българските медии отразяват едни и същи събития — с източници,
> доказателства и видими разлики в рамкирането.

Move corpus statistics out of the first viewport. They describe the database, not the user
benefit. A small „Как работи“ link is more useful there.

### 6.2 Lead story

One lead story, selected by a deterministic eligibility score rather than manually on every
run:

- analyzed within the selected time window;
- at least two independent outlets;
- usable Bulgarian summary;
- display-cleared image;
- then rank by outlet breadth, freshness and topic relevance;
- never rank by ideological extremity or „controversy“ alone.

Desktop: 60/40 image and text. Mobile: image, topic/age, title, two-line summary, coverage
signal. Show one primary action: **„Сравни отразяването“**.

### 6.3 Filter rail

Use horizontally scrollable chips on mobile and a compact row on desktop:

- Всички
- България
- Свят
- Политика
- Икономика
- Общество
- Околна среда

Time is a separate control: **24 часа / 7 дни / 30 дни**. Default to the shortest
window that still contains enough eligible content; do not default to „Всички“ and mix old
stories into a news home without saying so.

### 6.4 Story grid

Each card contains, in this order:

1. 16:9 or 3:2 image with visible creator/source credit;
2. topic and relative update time;
3. canonical Bulgarian title (maximum three lines);
4. two-line synthesized summary;
5. **„4 медии · 7 публикации“**;
6. one compact, labelled coverage distribution;
7. at most one exceptional signal, such as „Едностранчиво отразяване“.

Do not put both the political spectrum and Russia-stance spectrum on every home card. Two
unlabelled thin bars are visually cryptic and overburden scanning. Choose the signal most
relevant to the story; expose the full analysis on the story page.

For a single-source item, replace the distribution with:

> **Анализирана статия · засега от 1 медия**

This is transparent without making the card look defective.

### 6.5 Sections

Recommended first release:

1. lead story;
2. **Последно анализирани** — the main story grid;
3. **Най-широ отразявани** — only when there are at least three eligible items;
4. **Различно рамкиране** — only when an explicit rule finds a meaningful difference
   backed by enough articles;
5. methodology/footer.

Do not render an empty blindspot rail. Do not manufacture a blindspot from one-outlet
stories.

## 7. Story page blueprint

The current page has the correct raw ingredients but gives metadata and sidebars nearly the
same visual weight as the reader's task. Reorder it around three questions.

### 7.1 What happened?

- title;
- image and rights-aware credit;
- last update, first observed, outlet/article counts;
- concise Bulgarian synthesis;
- a visible disclosure: „Резюмето е създадено от ИИ и е проверено спрямо
  изброените източници“ only when that verification has actually happened.

### 7.2 How did coverage differ?

Use tabs or a segmented control:

- **Обзор** — shared facts and the important differences;
- **Заглавия** — all analyzed members, grouped by article-level leaning;
- **Позиция спрямо Русия** — only when applicable;
- **Доказателства** — quoted evidence and confidence per article.

In Overview, select representative headlines; do not repeat every syndicated copy. Offer
„Всички 7 публикации“ below them.

### 7.3 Where did this come from?

- source list with outlet, original headline, timestamp and external link;
- distinguish direct reporting, agency copy and republication where the evidence supports it;
- ownership claim with register source and checked date;
- correction/report link;
- methodology link adjacent to the analytical labels.

Topics and entities move below the core comparison on mobile. On desktop they can remain in
a narrow sticky rail, but the rail must not begin above the summary.

## 8. Image rights and attribution gate

This is a product blocker, not a caption-style detail.

The existing code assumes that hotlinking plus `© <Outlet>` is sufficient because the image
is not copied. That is too categorical for a launch policy. The EU DSM Directive gives press
publishers rights over online use of press publications, while photographs can carry their
own copyright. The directive's exception for individual words or very short extracts is not
a general image licence. See [Directive (EU) 2019/790, Article 15](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32019L0790).

Attribution is a condition of Creative Commons licences, not a replacement for having a
licence. See [Creative Commons licence conditions](https://creativecommons.org/share-your-work/use-remix/cc-licenses/).

Before an image is eligible for the home page, store:

```ts
type ImageRights = {
  status:
    | "publisher_permission"
    | "licensed"
    | "cc"
    | "public_domain"
    | "official_reuse_policy"
    | "unknown"
    | "blocked";
  creator: string | null;
  credit_text: string;
  credit_url: string;
  licence_name: string | null;
  licence_url: string | null;
  source_url: string;
  checked_at: string;
  display_home: boolean;
};
```

Rules:

- `unknown` and `blocked` never display on the home page.
- `© Outlet` must not be invented when the page credits Reuters, AFP, Getty, a freelancer or
  another photographer. Credit the named creator/rightsholder exactly as the source does.
- A source article link and an image licence link are separate fields.
- Hotlink success is stored separately as delivery metadata. It does not set rights status.
- Cropping, proxying, caching and generating responsive derivatives are disabled unless the
  recorded permission/licence permits adaptation and reproduction.
- Avoid AI-generated documentary-looking images for real news events. If an illustration is
  ever used, mark it visibly as an illustration and keep it out of the evidentiary source
  area.
- Preferred launch sources are explicit publisher opt-ins, appropriately licensed agency
  access, official institutional media libraries with reuse terms, and compatible CC/public
  domain work.

Obtain a Bulgarian/EU media-law review of the final policy and any publisher agreement. This
document is product research, not legal advice.

### 8.1 Approved interim source policy — 2026-08-28

The product owner approved the conservative, fail-closed source policy on 2026-08-28:
only documented publisher permission, appropriately licensed sources/agency access,
compatible Creative Commons work, public-domain work, and official institutional media
libraries with explicit reuse terms may qualify. Hotlink availability never qualifies by
itself. The authoritative policy and launch caveat are recorded in
[`docs/policies/news-image-rights.md`](../policies/news-image-rights.md), with the validator
allowlist in [`news/config/image_rights_policy.json`](../../news/config/image_rights_policy.json).
Legal review and any necessary publisher outreach remain a pre-launch requirement; this
approval does not represent either one.

## 9. Data and editorial eligibility

### 9.1 Home item contract

A story is home-eligible only when all required fields pass:

```ts
type HomeStory = {
  id: string;
  kind: "comparison" | "analyzed_article";
  title_bg: string;
  summary_bg: string;
  image: { url: string; alt: string; rights: ImageRights };
  first_published: string;
  last_published: string;
  analyzed_article_count: number;
  independent_outlet_count: number;
  topics: TopicRef[];
  coverage: {
    leaning: { left: number; center: number; right: number; unknown: number };
    russia: { pro: number; neutral: number; anti: number; not_applicable: number };
  };
  representative_members: StoryMember[];
  quality_flags: string[];
};
```

`kind = "comparison"` requires at least two independent outlets and two analyzed members.
`kind = "analyzed_article"` requires one analyzed member and may not render a distribution.

### 9.2 Independence and syndication

Counting domains is not always counting independent reporting. Where several sites carry the
same BTA/agency copy, show both numbers when known:

> 7 публикации · 4 медии · 2 самостоятелни отразявания

Until republication detection is reliable, say „медии“, not „независими източници“.

### 9.3 Ranking

Ranking inputs may include freshness, coverage breadth, Bulgarian relevance and analysis
completeness. They may not include predicted click-through, outrage language, ideological
distance or party favorability. Publish the ranking rule in methodology.

## 10. Accessibility, performance and responsive behavior

- Images have fixed aspect-ratio boxes to prevent layout shift.
- Only the lead image is eager/high-priority; all grid images are lazy.
- Credits are not baked into the image and remain legible at 200% zoom.
- Never communicate leaning or Russia stance by color alone; every segment has a text label,
  count and accessible name.
- Use a color-blind-safe palette and test light/dark modes independently.
- Card links have a single clear accessible name; nested external credit links must remain
  separately focusable without making the whole card's semantics confusing.
- Mobile cards use one column. At tablet width use two; use three only when summaries remain
  comfortably readable.
- Preserve server/prerendered title, summary, image metadata and static text links to every
  source. Avoid a JS-only news surface.
- Budget the feed by eligible item count, not by loading 600 records and filtering in the
  browser. Generate a small home bundle.

## 11. Delivery plan

### Tier 0 — policy and measurable prerequisites

1. Replace the current hotlink-equals-permission assumption with the rights state above.
2. Decide the permitted image sources with counsel/publisher outreach.
3. Add a rights-review queue and make unknown fail closed.
4. Backfill image metadata for the 365 already analyzed articles.
5. Rebuild the measurement report: analyzed + display-cleared image + multi-source overlap.

**Gate:** do not redesign the home until there are enough eligible items to fill it without
repetition. Proposed minimum: 24 current items within 30 days, at least 8 comparisons, and no
image with unknown rights.

### Tier 1 — content and cluster quality

1. Analyze new articles before they enter the public home bundle.
2. Prioritize analysis by likely story overlap and public importance, not alphabetically by
   outlet.
3. Improve clustering and agency-copy/republication detection.
4. Add `kind`, analyzed counts and independent-coverage status to the story bundle.
5. Create deterministic lead and representative-member selection.

**Gate:** a mutation test proves a one-outlet cluster cannot render as a comparison; unknown
analysis values cannot increase the neutral segment.

### Tier 2 — home MVP

1. Build a dedicated, small `home.json` containing eligible story cards only.
2. Replace the current hero/stats block with the user promise and method link.
3. Add the lead-story module, chip filters and finite analyzed-story grid.
4. Remove „Последни статии“ from `/`.
5. Keep an internal/raw latest route only if it has an operational user.
6. Add empty, slow-data, broken-image and zero-results states.

**Gate:** every home card is analyzed; every rendered image has non-unknown rights and a
visible correct credit; every comparison has 2+ independent outlets.

### Tier 3 — story experience

1. Reorder around What happened / How coverage differed / Sources.
2. Add representative headlines and expandable all-coverage list.
3. Put evidence adjacent to analytical labels.
4. Add direct-reporting/republication markers where proven.
5. Move entities into useful links to the wider „Наясно“ dossiers.

**Gate:** a reader can identify the common facts, the main framing difference and the source
of every claim without learning the color system first.

### Tier 4 — validation and iteration

Run moderated tests with 5–8 Bulgarian readers across different news habits. Give them three
tasks:

1. Explain what happened in one story.
2. Identify how two outlets framed it differently.
3. Find the evidence and original publication behind one analytical label.

Measure:

- task success and time;
- summary-to-comparison opens;
- original-source outbound clicks;
- evidence/method opens;
- return rate without infinite-scroll incentives;
- corrections and „this label means what?“ reports;
- Core Web Vitals and image failure rate by outlet.

Do not optimize raw card click-through as the primary metric. A calmer home that answers the
question without a click can be a better product.

### Tier 5 — later, only after the core is trusted

- story timelines;
- follow a person/place/topic;
- daily digest;
- sourced question answering;
- personal blindspots;
- audio summaries.

These are Particle/Ground-style retention features. They amplify whatever sits underneath;
they should not precede rights, clustering and analysis quality.

## 12. Decisions to make before implementation

1. Is the launch home allowed to mix comparisons and clearly labelled single-source analyzed
   articles, or should it wait for comparison-only density? **Recommendation:** mix them,
   but visually distinguish the two.
2. Which image-rights route will be funded: publisher opt-in, agency licence, open/official
   imagery, or a mixture? **Recommendation:** mixture with one rights schema and fail-closed
   rendering.
3. Is „political leaning“ the public name of the first axis? **Recommendation:** user-test
   „политическо рамкиране“, which describes the text more precisely and is less likely to
   be heard as a permanent verdict on the outlet.
4. Who signs off corrections and disputed classifications? The UI can expose evidence, but a
   public product still needs a named correction workflow.

## 13. Final north-star screen

A reader opens the page and sees one strong current image, one understandable story, a short
explanation, and „4 медии · 7 публикации“. They open it and immediately understand:

- what all sources agree happened;
- which details or language differ;
- how broad the coverage is;
- why the analysis assigned each label;
- who published the original material;
- where the image came from and under what terms it is shown.

That is a substantially different product from a portal with thumbnails. It is also the
experience the current data model is unusually well positioned to build once the image and
coverage prerequisites are made real.
