---
name: naiasno-post
description: Draft a Наясно social post — Facebook, LinkedIn and X copy from one grounded finding — and save a reviewable draft (never auto-publishes). Three kinds — DATA (a number-led card grounded in the site's own data AND confirmed against a public source), FEATURE (announce a new feature / product launch, e.g. a new tool or site), and DATASET (announce newly ingested data). Checks the registry for duplicates; feature/dataset launches default to pinned for ~2 weeks. Use when the user asks to "create/draft a post", "make a Facebook / LinkedIn / X post", "announce a new feature / launch", "post that we added new data", "post about <topic>", "пост за <тема>", "напиши пост", or to turn a data finding / today's watcher report into a shareable post.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Write
  - WebSearch
  - WebFetch
---

# Наясно — post composer

Turns a single data point into a publish-ready Facebook post for the **Наясно**
brand: a native 1080×1080 card (navy + coral, the site theme) plus BG (and
optional EN) copy, with the deep link and sources. Output is a **draft** for the
operator to review and post by hand — this skill never publishes to Facebook.

## Post kinds

Pass `kind` in the spec (default `data`):

- **`data`** — a number-led stat card. Must follow rules 1–2 below (grounded in
  our data + independently confirmed). Native image; link in the first comment.
  Steps 1–7 below are written for this kind.
- **`feature`** — announce a new feature / product launch (e.g. the AI chat at
  ai.electionsbg.com). No external stat to confirm, so **skip rules 1–2**; instead
  describe the feature ACCURATELY and without hype (verify what it does + its live
  URL) and add an honest "ранна версия" caveat where apt. If the target site has an
  `og:image`, post the **link in the body** and let Facebook pull the preview
  (`image: null`, omit `card`); otherwise render an announcement card.
- **`dataset`** — announce newly ingested data (e.g. "добавихме поръчките за
  2024"). Lead with what's now available + ONE sample figure FROM our data + the
  deep link (rules 3–4 apply to that figure if it's a strong claim).

**Pinning.** `feature`/`dataset` posts default to **pinned for 14 days**. After
publishing, pin the post (Group: post ⋯ → *Pin to Featured*; Page: post ⋯ →
*Feature*). Run `tsx scripts/posts/post_tool.ts pins` anytime to see which
launches are still in-window and which are **EXPIRED — unpin now**.

## Non-negotiable rules

_(Rules 1–2 apply to **data** posts; feature/dataset posts skip the
data/confirmation gate — see Post kinds. Rules 3–5 always apply.)_

1. **Grounded in our data.** Every headline number must come from a real file
   under `data/` (or `public/`) and link to the matching on-site page. Never
   invent or estimate a number. Quote the exact figure.
2. **Confirmed against public information.** Independently verify the headline
   number against the PRIMARY public source (АОП, Сметна палата/bulnao, ЦИК,
   parliament.bg, data.egov.bg, Eurostat, НСИ) or a reputable news report, via
   `WebSearch`/`WebFetch`. Record the confirming URL in `sources`. If it cannot
   be confirmed, or the public source contradicts our data, **do not draft** —
   report the discrepancy instead.
3. **No duplicates.** Run the dup-check before composing (step 2).
4. **Non-partisan, no emojis, plain Bulgarian.** Let the number be the point;
   no adjectives, no outrage, no party-side framing. (User preference: no emojis.)
5. **Link placement is per platform** — the draft states it per section.
   Facebook and LinkedIn: **first comment**, never the body (both demote posts
   carrying an outbound link). X: **in the body**, because a first-comment link
   on X is invisible.
6. **End with a share CTA** on Facebook and LinkedIn — one line, as the last
   line — BG: «Споделете, за да стигне Наясно до повече хора.» / EN: «Share it
   so Наясно reaches more people.» **Not on X**: it costs ~40 of 280 characters
   that the number and its basis need.
7. **One finding, three rewrites — never one body pasted three times.** The
   FIGURE and its BASIS are identical across platforms; only the framing moves.
   A number that is „40,4%" on Facebook and „над 40%" on X is two different
   claims, and the second is the one that gets screenshotted.

## Pipeline

```
topic ─▶ dup-check (post_tool check) ─▶ ground in data/  ─▶ confirm vs public source
      ─▶ compose BG/EN ─▶ write spec.json ─▶ post_tool save ─▶ review draft
```

## Step 1 — Pick the topic / angle

Two ways in:

- **From the user's request** — a named topic or entity.
- **From fresh data (the watcher).** Open `data-reports/latest.md`. Every item in
  its **Changed** section is a post candidate — map it to a vein via the Step 3
  table and lead with what just moved. If there are no changes, fall back to the
  freshest files in any vein, or an evergreen "important" item (e.g. a top-scoring
  NS vote, a notable council decision).

Pick ONE concrete, surprising, checkable fact. Recurring high-value veins to
rotate: **important NS votes** ("Парламентът тази седмица"), **municipal council
decisions** ("твоят град"), follow-the-money (procurement / funds / financing /
declarations), and EU comparisons.

## Step 2 — Duplicate check (before any work)

```bash
node_modules/.bin/tsx scripts/posts/post_tool.ts check "<keywords: entity, metric, year>"
```
If it warns of high overlap, either pick a new angle or propose updating the
existing post. Do not proceed on a near-duplicate.

## Step 3 — Ground the number in our data

Find the exact figure in the data and the on-site deep link. Data homes:

| Vein | Data | Deep link (base: electionsbg.com — naiasno.bg later) |
|---|---|---|
| Important NS votes | `data/parliament/votes/derived/important_votes/{ns}.json`, `…/sessions/{date}.json` | `/votes/:date/:slug`, `/votes/:date` |
| NS dissent / party splits | `…/derived/dissents.json`, `…/party_pair_breaks.json` | `/votes/between/:pair`, `/votes/:date/:slug` |
| NS attendance / loyalty / cohesion | `…/derived/attendance.json`, `loyalty.json`, `cohesion.json` | `/parliament/attendance`, `/parliament/cohesion`, `/parliament` |
| Municipal council votes | `data/council/index.json` (`resolutionsByObshtina`), `data/council/votes/{key}.json` | `/local/:cycle/:obshtinaCode` |
| Procurement | `data/procurement/*` | `/procurement`, `/company/:eik`, `/awarder/:eik` |
| EU funds | `data/funds/*` | `/funds`, `/funds/programme/:code` |
| Budget | `data/budget/*` | `/budget`, `/budget/ministry/:id` |
| MP assets / cars / connections | `public/parliament/*` | `/mp-assets`, `/mp-cars`, `/connections`, `/candidate/:id` |
| Officials' declarations | `data/officials/*` | `/officials/assets`, `/officials/:slug` |
| Party financing | `data/financing/*` | `/financing`, `/party/:id/donors` |
| Elections | `public/<date>/*` | `/`, `/municipality/:id`, `/section/:id` |
| Local elections | `data/<cycle>/*` | `/local/:cycle`, `/local/:cycle/:obshtinaCode` |
| Polls | `data/polls/*` | `/polls`, `/polls/:agencyId` |
| Macro / EU comparison | `data/macro.json`, `data/macro_peers.json` | `/indicators`, `/indicators/compare` |
| Sub-national indicators | `data/indicators.json`, `data/regional.json` | `/indicators`, `/indicators/economy` |
| Demographics / census | `data/census_2021.json`, `data/census/*` | `/demographics`, `/demographics/regions` |
| Transparency / taxes / land use / air | `data/municipal_transparency`, `data/local_taxes`, `data/landuse`, `data/air` | relevant `/indicators` or município page |

Record: the exact value, the dataset path, and the deep link.

### Vote posts — importance rubric (NS + municipal)

Never post a random vote — pick a meaningful one.

- **National Assembly** ("Парламентът тази седмица"). Read
  `data/parliament/votes/derived/important_votes/{ns}.json` (current NS = the
  highest-numbered file, e.g. `52.json`). Each entry has `score`, `title`,
  `topic`, `tally {yes,no,abstain}`, `outcome`, `slug`. Rank by `score` and take a
  recent high-scorer. **Prefer final-adoption votes** — title contains "второ
  гласуване" / "на второ четене" / "окончателно" — over first readings (same
  convention as long-form articles). Card value = the tally or margin (e.g.
  "126 «за»"); deep link `/votes/:date/:slug`. For a "who broke ranks" angle use
  `dissents.json` / `party_pair_breaks.json` (link `/votes/between/:pair`).
- **Municipal council** ("твоят град"). `data/council/votes/{key}.json` holds
  resolutions with за/против/въздържал tallies and named per-councillor votes
  where available (16 munis wired; resolve `key` from the município code via
  `src/data/council/councilObshtinaMap.ts`). Lead with ONE notable, checkable
  decision in a NAMED município (budget, concession, procurement, наредба); deep
  link the município page `/local/:cycle/:obshtinaCode`. In Step 4 confirm against
  the council's own published protocol / minutes.

## Step 4 — Confirm against a public source

Use `WebSearch`/`WebFetch` to find the figure (or its raw basis) in the primary
register or a credible outlet. Capture the URL. If you cannot confirm it, stop
and tell the user — do not draft an unverifiable claim.

## Step 5 — Compose

- **BG body:** a 1-line hook + the number in context (1–2 sentences) + a soft
  CTA ("Пълната разбивка е в линка в коментарите.") + the share line on its own
  last line (rule 6: "Споделете, за да стигне Наясно до повече хора."). No emojis,
  non-partisan, natural readable Bulgarian (not a word-for-word EN translation).
- **EN body (optional):** same, concise, ending with "Share it so Наясно reaches
  more people."

### Step 5b — LinkedIn and X (write these, don't skip them)

The spec takes `li` and `x` beside `bg`/`en`. Each is `{ bg, en? }`. Omit one and
the draft prints „(няма — не публикувай копието за Facebook тук)" in its place,
because a silently missing section is indistinguishable from a deliberate
Facebook-only call, and the operator resolves that ambiguity by pasting the
Facebook copy — the exact outcome these fields exist to prevent.

**LinkedIn** — `li`
- **The first ~200 characters are all that shows** before „…see more". The
  NUMBER and what it is over must be inside them. A hook that defers the figure
  to paragraph two is a hook nobody expands.
- **Method is an asset here, not a caveat to bury.** This is the one audience
  that rewards „both figures come from the same query on the same basis". Say
  the denominator out loud.
- **Write the EN.** LinkedIn is where the non-Bulgarian audience is — write it
  even when the Facebook post ships BG-only.
- Working range ~900–1300 characters (the cap is ~3000). Up to 3 hashtags at the
  end, only ones a person would actually follow. Link in the first comment.

**X** — `x`
- **280 weighted characters, enforced.** `post_tool.ts save` REFUSES an
  over-length body before it renders a card or touches the registry. A URL
  counts 23 however long it is; Cyrillic counts 1 per character, same as Latin.
  The draft prints the live count per language, e.g. `### BG (217/280)`.
- **The link goes in the body** and the card image is attached — the image
  replaces the link preview, so you get the number twice.
- **No share CTA** (rule 6).
- **If it does not fit, it is a thread, not a truncation.** Post 1 carries the
  number and the link; post 2 carries the basis. Never let X cut the end — the
  end is where the caveat lives.

**The rule that outranks all of the above:** if a caveat will not fit, the POST
does not fit. Narrow the claim until the caveat fits, rather than shipping the
figure without it. „40,4%, при 40,9% за страната" is publishable in 280
characters; „40,4%" alone is not, at any length.

### Card spec — prefer the infographic

**Stick to characters the card font actually has.** The renderer draws with
@napi-rs/canvas and a missing glyph comes out as a tofu box in the published
PNG — silently, since nothing throws. Arrows (`→`, `⟶`) are NOT available; write
"от X на Y" or use an em dash `—` (which is). Always Read the rendered PNG
before showing it to the operator, and look for boxes.

**Default to the infographic (bar) card.** Whenever the story has more than one
comparable value — a ranking, a breakdown, EU peers side by side, top gainers/
losers, before/after, a few categories — render the `renderBarCard` infographic
by giving the card a `bars` array. This is the preferred image style. Only fall
back to the single-number stat card when the post genuinely IS one number with
nothing to compare it against (e.g. "2,4 млрд. лв. поръчки без конкуренция").
When a claim is nominally a single figure but naturally decomposes (by year, by
party, by region, vs a benchmark), pull out 3–6 components and make it an
infographic instead.

The tool picks the renderer from the spec shape: a card with `bars` →
infographic, `series` → line chart, `rows` → table; otherwise stat-card (data) /
announce-card (feature/dataset). Pick the shape deliberately per the rule above.

- **Infographic card (preferred) — `bars`:** `title` (the claim, 1–2 lines,
  auto-wrapped), `bars` (3–6 rows of `{ label, value, note? }` where `value` is
  a signed number; positive renders in accent, negative in cool, with an explicit
  +/− so direction survives greyscale), `unit` (appended to each value, default
  `"%"`), optional `legend` (`[positive, negative]`, e.g.
  `["поскъпва","поевтинява"]`), `kicker`, `footnote` (methodology caveat),
  `source`, `cta`, `theme`. Keep it to ≤6 bars — the renderer throws if the rows
  don't fit, so shorten the title/footnote or drop a bar rather than overloading.
  For non-percentage magnitudes (money, counts) set `unit` accordingly (e.g.
  `" млн. лв."`) and use positive values with no `legend`. For a
  magnitude/distribution chart (shares, money, counts — anything that isn't a
  signed change) also set `signed: false` so values render as plain magnitudes
  (`30,1%`) instead of gaining a misleading `+` prefix.
- **Table card — `rows` + `columns`:** for a claim that IS a grid — a few
  entities tracked across a few periods, where a bar chart would have to throw
  away either the entity or the time axis (e.g. "in these 4 municipalities party
  X has not won any of these elections"). `columns` (header labels; `columns[0]`
  heads the row-label column), `rows` (`{ label, sub?, cells }` where each cell
  is `{ value, note?, heat? }` — `value` is pre-formatted text, `note` a muted
  second line, `heat` a 0..1 shading intensity so the pattern reads before the
  numbers), plus `heatLabel` (caption explaining the shading), `kicker`,
  `footnote`, `source`, `cta`, `theme`. Capped at **6 rows × 6 data columns** and
  it throws past that, or when a row's cell count doesn't match the header —
  a silently short row would read as a complete grid missing a period. When the
  real series is longer than fits, show a sample and SAY SO in the footnote.
  **Every number in a cell must name what it measures** — "27,7%" over "ГЕРБ"
  reads as ГЕРБ's 27,7%, when in fact it was ДПС's. Write "ДПС 28%" / "ГЕРБ 35%"
  so neither line can be read onto the other party. That costs width, so budget
  ~4 data columns for two-part labels rather than the 6 the renderer allows.
- **Line card — `series` + `labels`:** for a claim that is a TREND — a few
  entities tracked month by month (or year by year), where the shape of the
  movement, not the endpoint, is the story. Use it when "when did it change?"
  matters; a bar card can only show one moment. `labels` (x tick labels),
  `series` (2–4 of `{ label, values, emphasis? }` where `values` has exactly one
  entry per label), plus `unit` (default `"%"`), `marker` (`{ at, label }` — a
  vertical dashed rule at a point index, e.g. a policy date), `yMax`,
  `decimals`, `kicker`, `footnote`, `source`, `cta`, `theme`. Set `emphasis` on
  the subject series (thicker line, bold end label). Identity is carried three
  ways — colour, dash pattern and a direct end label — so it survives greyscale
  and colour-blindness; the 4th series renders in muted ink, which is the slot
  for a benchmark like an EU average.
  **Use `null` for a period that has not been published** — the line breaks
  there instead of interpolating, so a missing month cannot read as a real
  reading. A `0` would draw a dive to the axis. The renderer throws if a series'
  length doesn't match `labels`, if a series is entirely null, if there are
  fewer than 2 or more than 4 series, or if the title/footnote squeeze the plot
  below 260px. The y-axis snaps to a round step (`niceAxisStep`) so tick labels
  always land on the gridlines they name.
- **Single-number stat card (only when there's nothing to compare):** `value`
  (e.g. "2,4 млрд. лв."), `label` (1–2 short plain-language lines, `\n`
  separated), `source` (e.g. "Източник: АОП"), optional `kicker`, `cta` (default
  "виж разбивката"), `theme` ("dark" default; "light" = cream).

## Step 6 — Save the draft

Write a spec JSON to a temp path, then:
```bash
node_modules/.bin/tsx scripts/posts/post_tool.ts save /tmp/<slug>.spec.json
```
Spec shape:
```json
{
  "slug": "2026-06-01-procurement-no-competition",
  "date": "<today YYYY-MM-DD>",
  "title": "2,4 млрд. лв. поръчки без конкуренция (2024)",
  "tags": ["procurement", "пари"],
  "entities": ["АОП"],
  "keyFact": "2,4 млрд. лв. обществени поръчки възложени без конкуренция през 2024",
  "link": "https://electionsbg.com/procurement",
  "sources": ["data/procurement/summary.json", "https://www.aop.bg/..."],
  "bg": "…BG post body (Facebook — the canonical body)…",
  "en": "…optional EN (Facebook)…",
  "li": { "bg": "…LinkedIn BG…", "en": "…LinkedIn EN…" },
  "x":  { "bg": "…X BG, ≤280 weighted…", "en": "…X EN…" },
  "card": { "value": "2,4 млрд. лв.", "label": "обществени поръчки, възложени\nбез конкуренция през 2024 г.", "source": "Източник: АОП", "theme": "dark" }
}
```
`save` re-runs the dup guard, renders `brand/posts/<slug>.png`, writes
`brand/posts/drafts/<slug>.md`, and appends to `brand/posts/index.json`.

### After the operator publishes — stamp it

The registry is a log of DRAFTS; nothing here publishes. Once a card has
actually gone out, record where, so the next dup-check and the next
back-catalogue seeding can tell "rendered" from "published":

```bash
node_modules/.bin/tsx scripts/posts/post_tool.ts posted <slug> fb-page,fb-group,li,x [--at YYYY-MM-DD]
```

Channels: `fb-page`, `fb-group`, `ig`, `li`, `x`, `pinterest`, `tg`. There is
deliberately **no bare `fb`** — the Page and the Group are different audiences
with different pin flows, and one value would make "already posted?"
unanswerable. `--at` defaults to today; a channel already recorded keeps its
original date unless you pass `--force`.

`post_tool.ts status <channel>` lists what has NOT gone out there yet — that is
the worklist for seeding a new channel from the back catalogue. **An unstamped
post is UNRECORDED, not proven unpublished:** the field was added on
2026-08-14 and every post before it is blank.

**Infographic-card example** (preferred shape — a `bars` array is what triggers
the `renderBarCard` renderer):
```json
{
  "slug": "2026-06-01-eu-prices-vs-peers",
  "date": "<today YYYY-MM-DD>",
  "title": "…",
  "link": "https://electionsbg.com/indicators/compare",
  "sources": ["data/macro_peers.json", "https://ec.europa.eu/eurostat/..."],
  "bg": "…", "en": "…",
  "card": {
    "kicker": "Храни спрямо ЕС",
    "title": "Колко поскъпнаха храните за година",
    "bars": [
      { "label": "България", "value": 10.4 },
      { "label": "Румъния", "value": 7.2 },
      { "label": "Гърция", "value": 3.1 },
      { "label": "ЕС средно", "value": 2.8 }
    ],
    "legend": ["поскъпва", "поевтинява"],
    "source": "Източник: Eurostat",
    "theme": "dark"
  }
}
```

**Extra spec fields (optional):** `kind` (`data`|`feature`|`dataset`, default
`data`), `pin`/`pinUntil` (override the 14-day default), `image` (reference an
existing file e.g. `ai/assets/og.png`, or `null` for link auto-preview).

**Feature-launch example** (link auto-preview — no rendered card):
```json
{
  "slug": "2026-06-09-naiasno-ai-launch",
  "date": "2026-06-09",
  "kind": "feature",
  "title": "Наясно AI вече е онлайн",
  "keyFact": "Наясно AI — AI асистент за изборите и данните, вече онлайн",
  "link": "https://ai.electionsbg.com",
  "sources": ["ai/ app; og:image = ai/assets/og.png"],
  "image": null,
  "bg": "…", "en": "…"
}
```
For a feature/dataset WITHOUT a good og:image, omit `image` and pass an announce
card: `"card": { "eyebrow": "Нова функция", "title": "…", "subtitle": "…\\n…", "cta": "пробвай" }`.
The draft's `## Публикуване` note adapts per kind (native-image vs link-preview)
and reminds you to pin feature/dataset launches.

## Step 7 — Review

Show the operator: the rendered card (Read the PNG), the copy for all three
platforms, the deep link, and the confirming sources. Check the X counts the
draft prints — a body at 279/280 is one edit away from being refused, so leave
it room. Remind: image native on all three; link in the first comment on
Facebook and LinkedIn, in the body on X.
