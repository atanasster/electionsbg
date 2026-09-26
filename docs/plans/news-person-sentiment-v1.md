# Наясно Новини — how the media treat Bulgarian people, v1

**Status:** plan only, nothing implemented. Revised 2026-09-26 after two audits
(§12 lists what each changed and why). Every figure was measured
2026-09-26 against the corpus on disk — 14,707 Jev sentiment sidecars
(`news/data/analysis/sentiment/`), 21,478 published articles
(`news/app-data/articles/`), the committed gazetteer
(`news/data/gazetteer.json`). Predictions are marked **(predicted)**.

**Decided (2026-09-26):**
- Pages are **automatic** for people the gazetteer identifies (§4.3).
- **Foreign people are shown** on the article page with their tone, unlinked
  and never aggregated.

**Outcome.** For every article that names a Bulgarian person, the article page
shows how *that article* frames *that person*, inside the person's row of one
„Хора в материала" rail. Those article-person pairs aggregate into a person
page (overall, over time, by outlet), a people index, a „people this outlet
covers" section on each outlet page, and a bridge tile on the main site's
`/person/:slug`.

---

## 1. What already exists — an integration job, not a greenfield one

| Layer | State today | Gap |
| --- | --- | --- |
| Scoring | Jev (`jev_sentiment.py`) scores every party/person subject per article: **37,596 person subjects**; **19,953** primary/secondary and assessed, 17,643 incidental (correctly unscored). Continuous `value` in [−2, 2], 5-level distribution, `spread`, `text_scope`. Live since 2026-09-23 (`NEWS_JEV_PUBLISH`). The 6-subject cap has dropped **0** subjects on any article | Subjects are keyed by the **name string the model wrote** — no identity |
| Identity | `entity_links` (gazetteer → main-site person slugs, exact-one-match); `news_persons` registry (`np_*` ids, human-reviewed — **1** identity); mention index (`news/mentions/person/`, capped at 50 articles/entity) | Not joined to the Jev subjects |
| Who the gazetteer knows | **5,121 office-holders** across 19 tiers (2,116 MPs, 753 mayors, 460 governors, …), all `status='active' AND is_public_figure` in the person layer | No athletes, artists, analysts or civil-society figures; carries `canonical`, `tier`, `party` (mostly null) — **no current role, no dates, no photo, no EN name** |
| Article page | Three blocks: `MentionsBlock` (people chips → naiasno), `JevSubjects` (tone by name, no link), `NewsPersonsBlock` (np_ identities, GLM tones — hidden when Jev is present) | One person can appear three times; the row with the tone links nowhere |
| Rollups | `person_rollups.py` (M/N accounting identities, same-headline dedup), `sentiment_rollups.py` (per-outlet, Sofia-TZ series) — shared with parties | Read GLM `person_tones` (53 sidecars), not Jev; shards only for `active` np_ identities → **2 shards** |
| Person page | `NewsPersonScreen` at `/person/:newsPersonId` | `NEWS_PERSON_ID_SAFE = /^[a-z0-9_]{1,64}$/` **rejects every main-site slug** (they contain `-`); `prerenderRoutes.ts` sitemaps only active np_ ids |
| Party analogue | `/party/:id` ships `SpectrumBar`, `ToneBar`, `OutletBreakdown`, `SentimentSeries` on Jev values | Reusable for persons |
| Release gate | `person_accuracy_gate.py` built; `person_adjudications.json` holds **0 pairs** | Human annotation is the critical path |
| Main site | `build_mention_index.py` writes `data/news/mentions/` | `data/news/` is **gitignored and in no bucket-sync path**, and nothing in `src/` reads it — the bridge has no shipping route today |

### 1.1 Identity is the bottleneck

Of the 19,953 assessed person pairs:

| join outcome (same article, same surface → `entity_links`) | pairs | share |
| --- | ---: | ---: |
| linked to exactly one gazetteer person | **2,792** | 14.0% |
| offered candidates, none chosen (ambiguous) | 818 | 4.1% |
| no link | 16,343 | 81.9% |

The linked pairs cover **233 people** in 2,249 articles, **62 of them with ≥ 5
pairs** — today's automatic-page population. The unlinked set is dominated by
foreigners (Тръмп 848, Путин 352, Зеленски 301), the desired exclusion. The
Bulgarian tail splits in three:

1. **Shared names**: Костадин Костадинов, 94 pairs, is refused because several
   office-holders share the name.
2. **Not office-holders**: Никола Цолов 59, Григор Димитров 47, Велислава
   Петрова 64 — outside the gazetteer by construction.
3. **Surname-only mentions**: 1,122 eligible single-word subjects. ⚠️
   **Linking them within the article does not work**, and this is measured.
   840 have *no* longer form anywhere in the title or body („Радев каза…"),
   279 are preceded by a word the gazetteer does not hold, and only **3**
   resolve to one person. The Bulgarian ones are a small, recurring set:
   Радев 43, Йотова 38, Гюров 33, Борисов 27, Кандев 18, Пеевски 14,
   Волгин 7.

### 1.2 ⚠️ 82% of the links rest on the weakest form

Of the 2,792 linked pairs, **2,285 are `two_part`**, 404 `curated_entity`, 84
`full_name`. The gazetteer's own definition of `two_part` is „unique among the
public figures we hold; **it may be a person we do not hold**". A famous
non-office-holder who shares a first name and surname with an obscure official
is linked to the official. Automatic pages turn that from a wrong chip into a
public page about the wrong person, so §4.3 puts an identity audit in front of
them.

### 1.3 Analysis coverage is uneven over time

Articles with an analysis (and therefore entities and subjects):

| month | analyzed | not analyzed |
| --- | ---: | ---: |
| 2026-07 | 10 | 135 |
| 2026-08 | 1,680 | **3,042** |
| 2026-09 | 11,911 | 2,399 |

An unanalyzed article has no subjects, so it is **absent from M**, not
„pending". A time series across August would therefore trace which articles
got analyzed, not how coverage moved. §4.2 handles it.

The dips are also DAILY, not only monthly. 2026-09-23 to 09-25 ran at
**63% / 62% / 76%** analyzed while the backlog after the Jev launch caught up,
against 98–100% on the days either side. So a monthly floor would pass a week
that is a third missing. **1,915 articles carry no publish date** (1,106 of
them analyzed); they belong in no period.

### 1.4 What the linked pairs look like

Measured over the 2,773 linked, eligible, scored pairs:

| bucket | силно неблаг. | неблаг. | неутрално | благ. | силно благ. |
| --- | ---: | ---: | ---: | ---: | ---: |
| pairs | 80 | 372 | **2,137** | 172 | **12** |

- **77% is neutral.** That is the finding, and every surface must render it as
  such rather than looking empty.
- **„Strongly favourable" has 12 pairs in the entire corpus.** So a gate
  requiring ≥ 30 human labels per five-level bucket cannot be met even by
  labelling everything (§8 changes it).
- **Detection gaps** the annotation sample must be able to see:
  - **1,533** linked people are scored `incidental` — 36% as many as are
    scored at all. Wrongly demoting someone to incidental hides their tone
    silently.
  - **239 of 4,545** people linked in `entity_links` (5%) have no Jev subject
    at all.
  - People the model omitted from `entities` entirely are invisible to both
    counts.
- **78 of 2,773** pairs have no `story_id`.

**The grid is mostly empty today.** Take the top 30 people and the 22 outlets
with ≥ 30 linked pairs. Across all time only **125 of 660 cells (19%)** reach
n ≥ 5, and 51 reach n ≥ 10. §7.1 is designed around that.

---

## 2. Semantic contract

1. **The unit is the (article, identity) pair.** Tone describes how *the article
   as edited* frames the person — headline, narration, selection, who gets to
   answer. It never describes the person, their conduct or their guilt.
2. **Eligible** means primary or secondary, a publishable article and a full
   `text_scope`. Incidental mentions are shown as „споменат мимоходом" and never
   enter an aggregate.
3. **Bulgarian** means the identity resolves to a gazetteer person (Bulgarian
   office-holders, by construction) or to a reviewed `np_*` identity with
   `scope: "bg"`.
   - Foreigners and unresolved names appear on the article rail by name, with
     their tone, and are **never aggregated**: an unresolved „Костадин
     Костадинов" may be two people.
4. **Store the continuous value; display five buckets.** The buckets come from
   `jev_scales.BUCKET_EDGES`, with a generated `jevBucket.ts` twin. `mixed` is
   derived, never stored.
5. **Refusals**, tighter here because these are individuals:
   - **No favourability ranking.** The index sorts by coverage volume, name or
     recency; there is no sortable mean column.
   - **No context-free outlet score.** Every outlet figure is per
     (outlet, person) and carries its n.
   - **Party and person are kept separate.** A person's tone is never inferred
     from their party's, or the reverse.
   - **No aggregate page for a non-public figure.** Automatic pages come only
     from the gazetteer, which is public-figure-only. An `np_*` identity (for
     example the deceased private individual in the Калушев case) gets a page
     only with `scope: "bg"`, `public_figure: true` and `active` review.
   - **No current-office claim from a tier.** The gazetteer's tier means „held
     this kind of office", not „holds it now" (§3.0).

---

## 3. Phase 1 — identity and display data

### 3.0 Enrich the gazetteer (prerequisite)

`build_app_data.py` stays database-free. `build_gazetteer.py` is the one news
stage that already reads the person layer through `psql`, and it runs every
pipeline run (`run_nightly.sh` stage `common_words`). With no database it
**writes nothing and exits 0**, so the previous committed gazetteer stays in
force; the enrichment inherits that behaviour, and stale role dates are the
worst case, never an empty file. So it is the right place to add display
fields to each person entry of the committed gazetteer:

| field | from | why |
| --- | --- | --- |
| `name_en` | the person layer's Latin name, falling back to the repo's `translit_bg_latin` rule | EN pages and titles |
| `roles[]` — `{label_bg, label_en, start, end, date_basis}` | `person_role` | The rail says „президент" only while `end IS NULL`, otherwise „бивш …"; the time series draws role changes |
| `party_id` at each role | `person_role` / `person_election_stats` | Index filter, header |
| `avatar` | the main site's avatar path | Rail and page (a plain `<img>`, so no cross-origin fetch) |
| `retired_slugs` | `person_slug_retired` for this person | Redirects when the person layer re-slugs (§4.4) |
| `identity_version` | sha256 of (id, canonical, the sorted resolvable surfaces) | The gate's staleness key (§8). It moves only when what the name can resolve to moves — never on a role-date edit |

### 3.1 The join, per Jev subject

The join lives in the build, not in the Jev sidecar. The sidecar keeps the
model's names, and `build_app_data.py` stamps identity when it reads them, so a
resolver fix re-attributes history without re-scoring anything.

1. **Exact surface** → `entity_links[name]` of the same article (today's 14%).
2. **Context disambiguation for shared names** — the 818 candidate pairs and
   the Костадинов class.
   - Accept a candidate only when **exactly one** satisfies a positive cue in
     the article: a co-mentioned party matching the candidate's party at the
     article date, or an office word matching a role held on that date („лидерът
     на „Възраждане"", „министърът на …").
   - If zero or two candidates satisfy a cue, refuse.
   - The cues are data (`news/data/person_context_cues.json`), not code.
3. **Surname aliases, reviewed and windowed** — the Радев / Йотова / Гюров
   class. This replaces the first draft's in-article coreference, which §1.1.3
   measured at 3 of 1,122.
   - A human-reviewed file `news/data/person_surname_aliases.json` holds
     `{surface, id, valid_from, valid_to, requires_cue}` (the same shape as the
     existing `institution_aliases.json`).
   - It applies only when the article date falls in the window and no other
     person sharing that surname is named in the same article.
   - Seed it from the measured list, one reviewed entry at a time; never
     generate it.
4. **Reviewed news-only identities** — the `news_persons` registry, for
   Bulgarians outside the gazetteer.
   - Seed the review queue (`news/review/news_person_candidates.json`, 2,801
     surfaces) ordered by *assessed eligible pairs*, not raw mentions.
   - Pre-filter it with a `scope: foreign` stop-list, so reviewers spend their
     time on Цолов, Димитров and Петрова rather than Тръмп.
   - Add `scope` and `public_figure` to the registry schema.
5. **Merge rule.** If two subjects in one article resolve to one identity (26
   pairs today — full name plus surname, scored twice):
   - keep the higher role (primary > secondary), and on a tie the one with more
     mentions;
   - record `merged_surfaces`;
   - never average the two;
   - if the two values differ by ≥ 1 (1 case today), flag `conflict` and
     exclude the pair from aggregates. It stays on the article rail.

Every stamped subject carries:
- on success: `identity: {kind: "person"|"news_person", id, basis:
  "exact"|"context"|"surname_alias"|"registry", form_kind, identity_version}`;
- on refusal: `identity: null` plus `refused_reason`.

The basis travels to the UI tooltip.

### 3.2 Deliverables and measurement

- `news/scripts/person_identity_join.py` plus tests. Cover each step and each
  refusal, the merge and conflict rules, and a mutation test proving step 2
  still refuses when two candidates share the cue.
- A dated eval, `news/evals/person-identity-join-<date>.md`, with linked pairs
  and distinct people per step, before and after.
- A 100-pair hand audit of steps 2–3 at **precision ≥ 0.98**. A wrong link
  attributes a tone to the wrong human; a missing one costs only coverage.
- **(predicted, revised down):** steps 2–3 take linked pairs from 2,792 to
  roughly **3,200–3,600**. Context recovers perhaps half of the 818; the
  surname aliases add ~200. Step 4 grows the set only as fast as reviewers
  accept identities. The first draft's 5,000–6,500 assumed in-article
  coreference, which does not work (§1.1).

---

## 4. Phase 2 — rollups on Jev values

### 4.1 Per-person shard

Move `person_rollups.py` from GLM `person_tones` onto the Jev subjects stamped
in Phase 1, keeping its accounting identities:

```
sum(bucket counts) == N
N + insufficient_text + pending + refused + conflict == M
```

Each shard is `news/app-data/person/<id>.json`:

| block | content |
| --- | --- |
| `summary` | M, N, 5-bucket counts, mean `value`, SE, under three bases (§4.2) |
| `series` | `sentiment_rollups` series, n on every point, ±1 SE, sparse points flagged; starts at the coverage floor (§4.2) |
| `by_outlet` | per outlet: n, bucket counts, mean + 95% CI; **mean withheld below n = 5**, counts still shown |
| `by_role` | the summary split into primary and secondary |
| `co_subjects` | parties and people most often assessed in the same articles, counts only |
| `roles` | from the enriched gazetteer, for the header and the series annotations |
| `articles` | paginated rows: date, outlet, title, role, bucket, value, story id, identity basis |

### 4.2 Statistics decisions, stated once

- **Three bases, all published; the default is story-deduplicated.**
  - **Raw** — every article.
  - **Same-headline deduplicated** — the existing rule.
  - **One pair per (outlet, story)** — the mean of that outlet's articles on
    the story. Fifteen follow-ups from one outlet on one scandal are one
    outlet's position repeated, not fifteen observations. The same-headline
    rule misses BTA copies that were retitled; the story key catches them.
    An article with no `story_id` (78 today) is its own story — counted once,
    never dropped.
- **SE is between-units** at the chosen basis. It is not Jev's `spread`, which
  is the model's uncertainty about one article.
- **No shrinkage.** Pulling small outlets toward the person's mean manufactures
  agreement; a wide CI and a withheld mean are honest.
- **Coverage floor for the series, per PLOTTED point.** A point is drawn only
  when ≥ 80% of the corpus's published articles in that point's own bucket (a
  day, a week or a month — whatever the granularity is) have an analysis.
  - A bucket below the floor shows a hatched band reading „анализът обхваща
    под 80% от статиите за периода" — never a line.
  - A monthly test is not enough: it would pass September while
    23–25 September sat at 62–76% (§1.3).
  - The floor is recomputed every build, so a backlog that catches up turns
    the hatch into a line on its own.
- **Undated articles** (1,915) enter the person's totals and no series point,
  grid period or window. Their count is printed beside the chart, reusing the
  existing `person-undated` row.
- **The article-page baseline excludes the article itself.** At small n the
  article otherwise pulls its own baseline toward itself.

### 4.3 Automatic pages and the identity audit

**Rule:**
- A gazetteer person gets a shard, a page and a sitemap entry when it has
  **N ≥ 5** at the story basis.
- An `np_*` person gets one only when `active`, `scope: "bg"` and
  `public_figure: true`.

**Guard for §1.2** — a page never publishes on `two_part` evidence alone
without a human check. It publishes when either:
- at least one pair in the corpus was linked by `full_name`, `curated_entity`
  or a context cue; or
- the id is in `news/data/person_identity_audit.json`, a list of
  `{id, confirmed_by, date}` entries.

Launch step: audit the current 62 by hand (about 15 minutes; one question per
person — „is the person these articles are about the office-holder this id
names?").

After launch, a newly eligible person that meets neither condition is written
to a review digest in the hourly run's report, not to a page.

Size **(predicted)**: 62 pages today, roughly 120–200 after Phase 1. They are
static shards on the same path the party archive uses — no Postgres, and far
under any hosting file ceiling.

### 4.4 Stable URLs

- News person URLs are `/person/<id>`, with `id` either `np_*` or a main-site
  slug. Underscore is not in the slug charset, so the two namespaces cannot
  collide.
- When the person layer retires a slug, the gazetteer's `retired_slugs` produce
  entries in `news_persons.json`'s existing `retired_ids`. The client redirects
  them instead of 404-ing a URL that was in the sitemap.
- A data test asserts every retired slug points at a live shard.

### 4.5 People index

`news/app-data/persons.json`: id, name, current role, party, N, bucket counts,
last seen. Sorted by N, with no mean field.

---

## 5. Phase 3 — the article page person rail

Replace the people chips in `MentionsBlock`, `JevSubjects` for people, and
`NewsPersonsBlock` with one card, `PersonRail`. It sits in the right column on
`lg`, sticky under the headline comparison, and directly under the axes on
mobile. Parties keep their own `JevSubjects` card.

```
ХОРА В МАТЕРИАЛА                              как ги представя текстът
┌──────────────────────────────────────────────────────────────────────┐
│ [avatar] Румен Радев            основен субект                       │
│          бивш президент (2017–2026) · профил в Наясно →              │
│          враждебно ────────────●──── подчертано благоприятно         │
│          Неблагоприятно  (−0.9)                                       │
│          в други материали: обикновено неутрално · 212 · виж →       │
├──────────────────────────────────────────────────────────────────────┤
│ [avatar] Илияна Йотова          съществен участник                   │
│          президент · ...                                              │
├──────────────────────────────────────────────────────────────────────┤
│ [  ]     Доналд Тръмп           съществен участник                   │
│          ───────●──────────     Неутрално   (без профил)             │
├──────────────────────────────────────────────────────────────────────┤
│ Неразпознати: Костадинов* (неутрално)                                 │
│ Споменати мимоходом: Бойко Борисов, Делян Пеевски                    │
└──────────────────────────────────────────────────────────────────────┘
 * името съвпада с повече от един човек — не свързваме, за да не сгрешим
```

**Rows**

- **One row per identity**, ordered primary → secondary, then by mentions.
- Each row carries the avatar (initials fallback), the role with its date basis
  from §3.0 (never a bare tier), links to the news person page and the naiasno
  profile, and the tone.
- **Foreign people get a full row** (decided), with the tone and „без профил".
  They have no avatar, no baseline and no link.
- **Unresolved Bulgarian-looking names and incidental mentions** fold into two
  quiet lines at the bottom. Hiding them would read as „nobody else was named".

**The tone**

- **A position, not a badge**: a thin `SpectrumBar` with the distribution as a
  soft band and the value as a dot, plus the bucket label.
- **The baseline line** („в други материали: обикновено неутрално · 212")
  shows whether *this* article deviates from how the person is usually covered.
  - It renders only when the person has a page, and it excludes this article.
  - It prints the bucket and n in words, never as a second dot on the same bar
    — two dots on one scale read as two measurements of one thing.
- **Colour** reinforces and the label carries the meaning: `toneMeta` classes,
  red → grey → green in both themes, label always printed.

**Everything else**

- **Provenance** stays in `JevProvenance` beneath, plus one line: „оценката е
  за материала, не за човека".
- **Correction:** each row carries a „сигнализирай" link that extends
  `ReportIssueLink` with a `{person_id, article}` target. This covers both a
  wrong identity and a person objecting to the treatment.
- **Accessibility:** each row is an `<li>` with an `aria-label` reading the
  bucket, role and basis in words; the bar is `aria-hidden`.

**Tests**
- A component test for each row state: exact, context, surname-alias, foreign,
  unresolved, incidental, unrated, conflict and baseline-withheld.
- A gate that no identity renders twice on one page.
- A gate that a role label with `end` set never renders without „бивш".

---

## 6. Phase 4 — person page and people index

### 6.1 `/person/:id` (news app)

Widen `newsPersonId.ts` to the two namespaces (§4.4), together with its Python
twin `NEWS_PERSON_ID_SAFE`, and extend the pinned probe set with main-site
slugs, including a hyphenated one.

Page order, reusing the party archive's components:

1. **Head:** name, avatar, current role and party (dated), naiasno profile
   link. The deck states the basis: „как N материала от K издания представят … —
   оценка на текста, не на човека".
2. **KPI band**, each figure with its basis: N of M eligible; outlets K;
   position (`SpectrumBar`, mean ± SE); share primary. A basis toggle switches
   between story, same-headline and raw.
3. **Distribution:** `ToneBar` of the five buckets.
4. **Over time:** `SentimentSeries`, starting at the coverage floor. Role
   changes are drawn as vertical rules, because a shift that coincides with
   taking office is the most common real explanation.
5. **By outlet:** `OutletBreakdown` — n, stacked buckets, and mean with CI when
   n ≥ 5. Sorted by n, never by mean.
6. **As main subject vs participant:** the `by_role` split.
7. **Appears with:** co-subject chips.
8. **Articles:** paginated, filterable by outlet, bucket and role. Each row
   deep-links to this person's rail row on the article page.

### 6.2 `/persons`

A table, not a leaderboard: name, role, party, N, a mini stacked distribution,
outlets, last seen.
- Default sort is N descending.
- Search uses the shliokavitsa fold, imported from `src/lib/shlyoRules.ts`
  rather than copied, so „jotova" finds Йотова.
- Filters: party, period, outlet. The outlet filter recomputes the mini bars
  from `by_outlet` and reads as „how pik.bg covers these people".

### 6.3 Prerender, sitemap, share card

- Extend `prerenderRoutes.ts`'s person loop (today active np_ only) to every
  §4.3-eligible id, plus `/persons`.
- Add sitemap `<loc>`s, EN mirrors and an og:image of the distribution.
  ⚠️ **The news app has no chart share-image pipeline.** `prerender.ts` only
  copies an article's own photo into `og:image`, and the main site's
  `scripts/capture-*-og.mjs` drive a browser. Generate the person, `/persons`
  and grid cards at build time instead:
  - render an SVG template (name, role, the five-bucket bar, N, date range) to
    PNG with `sharp` (already a dependency), one per page;
  - deterministic, no browser, and the bytes change only when the numbers do;
  - a test asserts every sitemapped person URL has its image file.
- Per the dashboard-hub rules, a page with no eligible pairs is not sitemapped.

---

## 7. Phase 5 — by media

- **Outlet page `/outlet/:domain`:** a „Хора в изданието" section listing the
  top 20 people this outlet assesses most often, each with n and a mini
  distribution. Each links to the person page pre-filtered to this outlet.
  Figures are per (outlet, person); there is no outlet-wide average.
- **Story page:** a person selector on the existing comparison („как всяко
  издание в тази история представя X"), reusing `storyDivergence`.
### 7.1 The outlet × person grid — `/persons/media` („Медиите и хората")

In scope (decided 2026-09-26). It is the densest „by media" view and the
closest to a league table, so its rules are stricter than the rest of the
feature's.

**Data.** `news/app-data/person_outlet_matrix.json`, built from the same shards
at the story basis. Each cell carries `{n, buckets, mean, ci_low, ci_high, dev,
dev_ci_low, dev_ci_high}`, with one block per period (30 days, 90 days, all).

**Density rules — the measured grid is 81% blank (§1.4)**, and a wall of dots
reads as „these outlets ignore these people", which the data does not say. So
rows and columns are chosen by how much they can show, not by volume alone:

1. Start from people and outlets with ≥ 30 linked pairs in the period.
2. **Prune iteratively.** Drop any row with fewer than 4 cells at n ≥ 5, and
   any column with fewer than 4 such cells, until stable. Cap at 25 rows × 15
   columns, ranked by N.
3. **Offer a period only if** the pruned grid still has ≥ 8 rows and ≥ 35% of
   its cells at n ≥ 5. Today that is „all", with „90 days" roughly equal
   (the corpus is ~2 months deep), and 30 days is not offered.
   **(predicted)** Phase 1's extra links move the 90-day grid over the line
   first.
4. The page states what was left out, in words: „показани са 18 души и 12
   издания с достатъчно материали; 41 души и 10 издания имат твърде малко".

**Expect grey.** With 77% of pairs neutral, „позиция" mode is mostly neutral
grey. With most filled cells at n = 5–15, „спрямо обичайното" will colour only
a few cells at first. That is the correct output. The legend says both, so
grey reads as „no detectable difference" rather than „broken".

**Layout**

```
                 Медиите и хората · последните 90 дни   [позиция | спрямо обичайното]
                 bta  24ch  nova  pik  mediapool  dnevnik  …
Илияна Йотова    ■    ■     ■     ■    ■          ■           n на всяка клетка при hover
Румен Радев      ■    ■     ·     ■    ■          ■           · = под 5 материала
Андрей Гюров     ■    ■     ■     ■    ·          ■
…
```

- Rows are sorted by N and columns by outlet volume, **never by tone**.
- There are no row or column totals of tone. A column average is the outlet
  score this project refuses to publish, and it would be one glance away.
- A cell is a square with the bucket colour of the mean; the n appears on hover
  or focus.
  - **Blank (·) below n = 5**, with the count still in the tooltip.
  - **Hatched** for 5–9, where the CI is wide.
- Clicking a cell opens the person page filtered to that outlet, with the
  article list — every square leads to its evidence.

**Two modes, one toggle**

- **„позиция"** (default) colours each cell by the outlet's mean for that person.
- **„спрямо обичайното"** colours it by the gap from that person's mean across
  all *other* outlets. This is where the grid earns its place: most of a row's
  colour is the person, and this mode removes that and shows which outlets
  frame them more or less favourably than the rest.
  - A cell is coloured only when the CI of the gap **excludes zero**; otherwise
    it is grey, labelled „в рамките на обичайното".
  - The legend says in words that this compares outlets' treatment of one
    person, not the outlets themselves.

**Everything else**

- **Mobile:** the grid becomes one card per person, with a horizontally
  scrollable strip of outlet cells and the name pinned.
- **Period** is the 30/90-day/all picker. Every period starts at or after the
  §4.2 coverage floor; a period before it is not offered.
- **Accessibility:** a real `<table>` with row and column headers; each cell's
  accessible name reads the outlet, person, bucket and n; the colour is never
  the only carrier.
- **Links in:** from `/persons`, from `/outlets`, and from each outlet page's
  „Хора в изданието" section (pre-scrolled to that column).
- **Prerendered**, with a sitemap `<loc>` and an og:image of the grid.
- Ships behind `NEWS_PERSON_MATRIX`, after the §8 gate.
- **Tests:**
  - no sort path orders by tone;
  - no tone total exists in the payload;
  - n < 5 cells render blank;
  - deviation mode colours only CI-excluding cells;
  - a mutation check: flip one cell's CI to straddle zero and it must go grey.

---

## 8. Phase 6 — main-site bridge, methodology, release

- **Main site `/person/:slug` — a „В медиите" tile.** It shows N, the
  distribution bar and the outlets, and links to the news person page.
  - Today the shards it would read are gitignored, in no sync path and read by
    nothing, so it needs three things:
    1. a summary block in `build_mention_index.py`'s person shards, computed
       over the **uncapped** pair set (the index caps at 50 articles per
       entity);
    2. a `data/news/mentions/` entry in `scripts/bucket_sync_paths.ts`, plus a
       step in the hourly news publish that pushes it;
    3. the `src/` reader, which degrades to „no tile" on a 404.
  - Add a data test that every shard's slug exists in `person`.
- **Methodology:** a „Как измерваме отношението към хора" section covering:
  - the unit and eligibility;
  - the identity join, its refusals and the two-part-name caveat;
  - what „неутрално" means and why there is no ranking;
  - the three bases, small-n rules and the coverage floor;
  - how to object or correct.
- **Release gate** — `person_accuracy_gate.py`, already written; its input
  currently holds 0 pairs. ⚠️ **It gates the wrong producer.** It scores
  `person-treatment-v1`: GLM's four nominal tones, identities versioned only
  from `news_persons.json`, i.e. `np_*` ids. Port it before anyone annotates:
  - **Tone metrics become ordinal**, over the five Jev buckets: exact-bucket
    agreement, **off-by-one rate**, **sign-flip rate** (favourable read as
    unfavourable or the reverse — the error that matters most), and the mean
    absolute error on `value` against the human's level.
  - `not_assessed` stays a real answer on both sides, and a declined answer is
    still scored as wrong.
  - **Identity versions** come from the enriched gazetteer
    (`identity_version` per gazetteer person) as well as the registry, so a
    pair labelled before a re-slug or re-link goes stale instead of scoring.
  - **Wrong canonical target** stays a hard fail: one human „not this person"
    on a published pair fails the gate.
  - **Support is gated on THREE groups, not five buckets.** „Strongly
    favourable" holds 12 pairs in the whole corpus (§1.4), so ≥ 30 per
    five-level bucket is unmeetable even by labelling everything.
    - Gate on unfavourable (levels 1–2), neutral and favourable (4–5), with
      ≥ 30 human-labelled pairs in each.
    - Report the five-bucket confusion matrix beside it, ungated. „Strongly"
      vs plain is a display distinction the corpus is too thin to certify.
  - **Thresholds:**
    - sign-flip ≤ 2% (Wilson upper bound);
    - exact-bucket ≥ 0.60;
    - off-by-one-or-better ≥ 0.90;
    - ≥ 30 pairs per group;
    - ≥ 200 test pairs.

    Confirm them against the annotator-agreement figure before enforcing —
    a threshold above what two humans agree on is unmeetable.
  - **The sample must be able to see what the model hides.** Draw it with
    `sample_person_pairs.py`, stratified by outlet and identity basis, in four
    strata:

    | stratum | pairs | why |
    | --- | ---: | --- |
    | model-scored, by model group | 150 | Tone accuracy; oversample the thin favourable group — up to all 184 of its pairs |
    | model said `incidental` | 40 | 1,533 linked people are demoted to incidental; if the human says main subject or participant, a tone was hidden |
    | linked in `entity_links` but no Jev subject | 30 | The 239-pair detection gap |
    | gazetteer full name in the text but not in `entities` | 30 | The model's omissions, found by string match over the body |

    The last two measure **recall**, which a sample drawn only from scored
    pairs cannot. The gate reports tone agreement and detection separately and
    never folds them into one score. The stratum is never shown to the
    annotator; every item asks the same questions — the role first (which may
    be „не се споменава съществено"), then the tone.
  - Collect through the review workspace (§8.1), not the public `/evals`
    surface, which has received no submissions.
  - **(predicted)** About 1.5 minutes per pair, so 6–7 hours of reading.
- **Flags**, each an env line in `news/.env.pipeline`, never the shell:

  | flag | covers | ships when |
  | --- | --- | --- |
  | `NEWS_PERSON_RAIL` | article page | the Phase 1 precision audit passes (Jev person tones are already public on article pages; this adds identity and removes duplicates) |
  | `NEWS_PERSON_AGGREGATES` | pages, index, outlet section, main-site tile | the gate passes |
  | `NEWS_PERSON_MATRIX` | the outlet × person grid | after the gate |

### 8.1 The review workspace — `npm run news:review`

Every human step in this plan runs in one local tool, so none of it means
hand-editing JSON. It follows the shape of
`adjudicate_editorial_treatment.py`, which exists because hand-editing is why
that gate never moved:

- `news/scripts/review_persons.py` serves one page on `127.0.0.1:8766` using
  the standard library, with no build step.
- It opens the browser itself and writes the result files. Nothing leaves the
  machine.

```bash
npm run news:review
```

**The page**

```
┌ Преглед ──────────┐┌──────────────────────────────────────────────────────┐
│ Самоличност   3/62 ││ Самоличност · 4 от 62                    ⌨ ? клавиши │
│ Фамилии       0/10 ││                                                      │
│ Нови лица     0/40 ││ [снимка] Георги Димитров Кандев                      │
│ Оценки      12/250 ││          ДАНС (2019–2023) · 138 материала             │
│                    ││                                                      │
│ ▓▓▓░░░░░ 21%       ││ Материалите говорят ли за този човек?                │
│ запазено 14:02     ││  „…заяви Георги Кандев пред bTV, че…"          24ч. │
│                    ││  „…Кандев е тотална щета…"                      petel│
│                    ││  … (5 откъса, избрани от различни издания)          │
│                    ││                                                      │
│                    ││ [Y] Да, същият   [N] Друг човек   [M] Смесено  [S] ? │
└────────────────────┘└──────────────────────────────────────────────────────┘
```

**Controls**

- **The left rail** lists the queues with progress, so no tabs are needed. It
  is not a dashboard, but the no-tabs preference applies anyway.
- **One item per screen**, keyboard first: every choice has a single key, `U`
  undoes the last decision, and `?` shows the keys.
- **Saving:** every decision is written to disk before the next item loads, and
  closing the tab or the terminal loses nothing — the next launch resumes at
  the first undecided item.
- **Excerpts:** the sentence around each mention, with the name highlighted. A
  full-article view is one key (`A`), in a side panel rather than a new tab.
- **Throughput:** about 15 s per identity check, 1 minute per surname and
  1–1.5 minutes per tone judgement **(predicted)**.

**The four queues**

1. **Самоличност** — the §4.3 identity audit. It starts with today's 62 people,
   and later receives the hourly run's „new page awaiting check" digest.
   - Shown: the gazetteer person (name, dated roles, photo) and 5 excerpts drawn
     from different outlets, preferring the weakest (`two_part`) links.
   - `Y` confirms → `person_identity_audit.json`.
   - `N` refuses the id: no page, and the surface is added to an exclusion list
     so the same link is not re-proposed.
   - `M` („some excerpts are someone else") asks which. The page is held and
     the surface is marked `context_required`, so it links only with a §3.1.2
     cue from then on.
2. **Фамилии** — the §3.1.3 surname aliases, proposed by a script from the
   measured single-word subjects, ordered by eligible pairs.
   - Shown: the surname, its count, every gazetteer person who holds it (with
     dated roles), and example excerpts.
   - Pick the person with `1`–`9`. The validity window is pre-filled from that
     person's role dates and the corpus span, and can be edited with two date
     fields.
   - `C` toggles „requires a cue"; `R` rejects the surname outright („Борисов"
     is too common to alias).
   - Writes `person_surname_aliases.json`, stamped with reviewer and date.
3. **Нови лица** — the §3.1.4 registry queue: Bulgarians outside the gazetteer
   (Цолов, Григор Димитров, Велислава Петрова), ordered by eligible pairs, with
   foreign heads of state already filtered out.
   - Shown: excerpts, plus any candidate on the main site with a similar name.
   - Accepting asks three things: `scope` (bg/foreign), `public_figure`
     (yes/no), and a one-line disambiguation (pre-filled with a draft the
     reviewer edits — the draft is a suggestion, never saved unedited).
   - Writes to the `news_persons` registry as `active`.
4. **Оценки** — the tone annotation behind the §8 gate. This queue is
   **blinded**, following the precedent tool's rules:
   - The **outlet, URL and model answer are never shown**. The source is one
     deliberate key (`O`), and the reveal is recorded on the row.
   - Shown: title and full text, with every mention of the target person
     highlighted, and the question „Как текстът представя <име>?".
   - Two answers:
     - the **role**: `P` main subject, `E` participant, `I` passing mention (a
       passing mention needs no tone);
     - the **tone**, on five keys `1`–`5` labelled with the Jev anchors word
       for word, so human and model answer the same question.
   - `X` reports „this isn't the person named", which is the gate's wrong-target
     metric. `S` skips „I can't judge", recorded as declined.
   - An optional note goes to a sidecar and never into the scored rows.
   - Progress is a total count only. A per-bucket counter would reveal the
     sampling stratum, which is the model's bucket.
   - Working copies stay in the gitignored `news/var/review/`. „Finalize"
     writes `news/evals/person_adjudications.json` with reviewer,
     `completed_at` and a row hash. The gate rejects a file whose sealed fields
     moved, as the precedent tool's scorer does.

**What it never does:** show one queue's decision to another queue, auto-accept
anything, or write outside its four target files.

**Tests:** the server's write paths (resume, undo, finalize, sealed fields),
blinding (no outlet, URL or model value in the annotation page's HTML — a test
greps the served page), and that the exclusion list stops a refused link
reappearing.

- **Deploy order:** ship the newsapp bundle before publishing new data shapes
  (the Jev rule). Deploy between hourly runs — `deploy:news` fails while a run
  is writing `news/data`.

---

## 9. Decisions

**Settled 2026-09-26:**
- Automatic pages: yes.
- Foreigners shown on the article rail: yes.
- Outlet × person grid: yes (§7.1).
- The reviewer for identity, surnames, new people and tone annotation is the
  site owner, through the §8.1 workspace.

**Still open**

1. **A second annotator for agreement.** The gate requires ≥ 40 pairs labelled
   independently by **two different people** (κ ≥ 0.60). One person
   re-labelling their own pairs measures consistency, not agreement — the party
   plan already rejected that substitute.
   - The workspace supports a second reviewer via `--reviewer "<name>"` on a
     blinded 50-pair subset, taking about 1 hour.
   - Without one, publish aggregates with the κ arm marked unmet and stated on
     the methodology page, rather than presenting the gate as passed.
2. **Launch timing against the presidential campaign.** The first round is
   **2026-11-08** (`upcomingElections.ts`), and the campaign opens about a
   month earlier. Йотова and Радев are the two most-covered people in the
   corpus (484 and 359 linked pairs), so the person pages and the grid would
   debut as a campaign-coverage scoreboard, on the most contested pages the
   site has ever published.
   - Nothing here is an opinion poll, but reading it as one is the obvious
     misreading. The election silence rules (no polls on the day before and on
     election day) are the precedent a complainant would reach for.
   - Options:
     - (a) ship aggregates before the campaign opens, with the methodology page
       live from day one;
     - (b) ship the rail only (already public) and hold aggregates until after
       the final round;
     - (c) ship everything, but freeze the aggregate data from the day of
       reflection through the close of polls, with a dated banner.
   - Recommend (c) if the gate passes in time, otherwise (b). **(a) is not
     reachable anyway**: the gate needs about 6 hours of annotation plus a
     second reader. Whichever is chosen, a lawyer reads the methodology page
     before the aggregates flag is flipped during a campaign.

## 10. Order and size

| phase | depends on | size **(predicted)** |
| --- | --- | --- |
| 1 gazetteer enrichment + identity join | — | 3–4 days |
| 1r **review workspace** (§8.1): queues Самоличност + Фамилии first | 1 | 1–2 days |
| — *you:* identity audit (~15 min) + surname aliases (~10 min) | 1r | — |
| 2 rollups, three bases, coverage floor, auto-page guard | 1, audit | 2 days |
| 3 article rail | 1 | 1–2 days |
| 4 person page, index, prerender, retired-slug redirects | 2 | 2–3 days |
| 5 outlet section, story selector, **outlet × person grid** (density pruning) | 2, 4 | 2–3 days |
| 6a gate port (ordinal metrics, 3-group support, 4 sampling strata) + Оценки / Нови лица queues | 1r | 1–2 days |
| — *you:* 250 tone judgements (~6 h, in sittings) + a second reader for 50 | 6a | — |
| 6b main-site bridge, methodology, share cards (SVG → sharp), flags on per §9-2 | 2; gate | 2 days |

Phases 1 → 3 can ship alone, because they improve a page that is already
public. Phases 4–6 wait on the gate. The workspace comes right after Phase 1
because your identity audit is what lets Phase 2 publish pages.

## 11. Not in scope

- Re-scoring anything: Jev already reads the full text.
- Analyzing the unanalyzed August backlog. That is its own job, and
  §4.2's floor makes the charts honest without it.
- Party sentiment, which ships separately.
- Companies and institutions.
- Any claim about why an outlet frames someone the way it does.

## 12. Audits — what changed

| # | Finding (measured) | Change |
| --- | --- | --- |
| A1 | In-article coreference recovers **3 of 1,122** single-word subjects — the full name usually isn't in the article | Replaced by reviewed, windowed surname aliases (§3.1.3); prediction revised from 5,000–6,500 to 3,200–3,600 linked pairs |
| A2 | **82%** of links (2,285 / 2,792) are `two_part`, which the gazetteer says may be someone it doesn't hold | Automatic pages need stronger evidence or a one-time audit (§4.3) |
| A3 | The gazetteer has no current role, dates, photo or EN name, and its tier is „held", not „holds" | Gazetteer enrichment (§3.0); the rail prints dated roles, never a bare tier |
| A4 | The gazetteer is **public-figure-only** (5,121 office-holders); 62 people have ≥ 5 pairs | Automatic pages are safe to scope to it; size estimate cut from 400–800 to 120–200 |
| A5 | August is 64% unanalyzed; unanalyzed articles are outside M, not „pending" | Coverage floor on every series (§4.2) |
| A6 | Same-headline dedup misses retitled wire copies and one outlet's repeated follow-ups on one story | Story basis as the default, three bases published (§4.2) |
| A7 | 26 full-name + surname pairs are scored twice in one article; 1 disagrees by ≥ 1 | Merge rule plus a `conflict` state that stays out of aggregates (§3.1.5) |
| A8 | Person-layer slugs retire (23,916 so far), and the news pages would 404 | Carry `retired_slugs` → `retired_ids` redirects (§4.4) |
| A9 | `data/news/` is gitignored, unsynced and unread | The bridge now names its sync path and reader (§8) |
| A10 | The baseline included the article it is compared against | Exclude it (§4.2) |
| A11 | No route for a person to object to a treatment | A per-row report link with a person target (§5) |
| A12 | The 6-subject cap drops **0** subjects | Removed as a concern |
| A13 | `person_accuracy_gate.py` scores GLM's four nominal tones and versions only `np_*` identities — it cannot evaluate what ships | Port to Jev ordinal metrics (sign-flip, off-by-one, exact) and gazetteer identity versions (§8) |
| A14 | The public `/evals` surface has received no submissions; hand-editing JSON is why the editorial-treatment gate stalled | One local keyboard-first workspace for all four human queues (§8.1) |
| A15 | The gate's agreement arm needs two different people; one reviewer cannot meet it | Second-reader subset in the workspace; if nobody is available, publish with that arm marked unmet (§9) |

**Second audit (2026-09-26):**

| # | Finding (measured) | Change |
| --- | --- | --- |
| B1 | Linked eligible pairs by bucket: 80 / 372 / **2,137** / 172 / **12** — „strongly favourable" can never reach 30 labels | Gate support on three groups; five-bucket matrix reported, not gated (§8) |
| B2 | The sample was drawn only from scored pairs, so it could not measure what the model hides: 1,533 linked people scored `incidental`, and 239 of 4,545 linked people with no Jev subject | Four sampling strata including two recall strata; detection reported apart from tone (§8) |
| B3 | Grid: only **125 of 660** cells (19%) reach n ≥ 5 across all time | Iterative row/column pruning, a per-period density test, and the omission stated in words (§7.1) |
| B4 | Daily analysis coverage dipped to 62–76% on 23–25 Sep inside a month that passes an 80% floor | Floor applied per plotted point, not per month (§4.2) |
| B5 | 1,915 articles have no publish date; 78 linked pairs have no `story_id` | Undated: counted in totals, in no period. No story: its own story (§4.2) |
| B6 | The news app's `og:image` is an article photo; chart cards exist only on the main site, via a browser | Build-time SVG → PNG with `sharp` (§6.3) |
| B7 | `identity_version` was named but never defined for gazetteer people | Defined as a hash of id, canonical and resolvable surfaces (§3.0) |
| B8 | The first round of the presidential election is 2026-11-08; the two most-covered people are the two leading figures | Launch-timing decision with a recommended freeze window (§9-2) |
| B9 | §3.0 said the pipeline must not open Postgres; the gazetteer stage already does, every run, and writes nothing without a database | Corrected: `build_app_data` stays database-free; enrichment rides the existing stage and its keep-previous behaviour |
