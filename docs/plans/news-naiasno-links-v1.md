# News → Наясно: links, mark, and the two names that would not resolve (v1)

Four asks from one screenshot of `news.electionsbg.com/story/20260920-723682ff`:
the outbound links still name the retired domain, the masthead still wears the
retired mark, „Благомир Коцев" is plain text although he is the mayor of Варна,
and „Аспарухово" is plain text although the story is about a район of Варна.

## 0. What was measured first

- **`naiasno.bg` is the serving domain and `electionsbg.com` 301s to it.**
  Verified 2026-09-21: `/person/blagomir-kotsev-122tn9`, `/settlement/00775`,
  `/company/206268628`, `/awarder/000668715`, `/en/person/…` and
  `/procurement/appeals` all answer 200 on `naiasno.bg`; the same path on
  `electionsbg.com` answers `301 → naiasno.bg`. So nothing is broken today —
  every baked link costs one redirect hop — and the switch is a correctness and
  branding fix, not an outage fix.
- ⚠️ **`news.naiasno.bg` DOES NOT RESOLVE** (curl: `000`). The news app's own
  canonical stays `news.electionsbg.com`; `NEWS_SITE`, the sitemap `<loc>`s and
  every `canonical`/`og:url` are OUT of scope for this plan. Changing them
  before the DNS exists would point every canonical at a host that does not
  answer.
- **The mark is already correct in source.** `src/layout/header/Logo.tsx` is the
  navy „на" tile (`de48ba2f75`, 2026-09-10) and `newsapp/App.tsx` already
  imports it. The DEPLOYED bundle (`assets/index-BzXE4i7B.js`) still carries the
  old ballot-checkbox SVG — `logoCardClip`, a `M16 30 L27 41 L48 17` check and
  the BG flag stripe. So this is a stale deploy, not a code gap: Tier 2 is a
  verification + rebuild, and there is nothing to write.
- **Благомир Коцев is absent from the gazetteer entirely**, and the roster query
  is why: `PEOPLE_SQL` admits mayors only at `pr.source = 'official_muni'`,
  while his mayoralty is `source = 'local', role = 'mayor',
  ref = '2023_10_29_mi:VAR06:mayor'` — the elected roster. Measured locally:
  **709 elected mayors, 302 of them already in via the registry, 522 new
  people, 525 with a nationally unique full name.**
- ⚠️ **Widening alone does NOT fix the name in the screenshot.** Three `person`
  rows carry the fold of „Благомир Рубинов Коцев" (`5341` the mayor+councillor,
  `5342` and `5343` candidate-only registrations of the same human), so the
  public-figure uniqueness test refuses both his full and two-part form. He is
  one of **7** elected mayors blocked *only* by candidate-only namesakes; **177**
  are blocked by a genuine namesake and stay refused, correctly. The 7 are an
  IDENTITY-LAYER gap (`data/person/link_overrides.json`, a `db:resolve:persons`
  rebuild), not a gazetteer one — so they are served here by the curated,
  context-gated `news/data/entity_link_overrides.json`, which is exactly the
  mechanism's purpose, and the merge is recorded as follow-up.
- **„Аспарухово" is refused because 4 settlements share the name** — and none of
  them is the place the story is about, which is **район Аспарухово, Варна** at
  `/governance/VAR06-05`. A settlements-only dropdown would offer four wrong
  answers, which is worse than plain text.
- **Which place codes `/governance/:id` actually serves**, read off
  `useAreaResolver` rather than guessed: the 294 obshtina codes in
  `data/municipalities.json` (Sofia's 24 районs are obshtina rows `S2xxx`), the
  Sofia composite settlement ids (`68134-2401`), and the 10 city районs of
  `cityRayonCatalog` (`PDV22-01`, `VAR06-05`). ⚠️ **OBLAST CODES DO NOT
  RESOLVE** — `/governance/VAR` renders the unknown-place screen, and the SPA
  answers 200 for it, so a curl check cannot see this. Oblast stays unlinked.

## Tier 1 — the domain

1. **One constant per side.** `MAIN_SITE = "https://naiasno.bg"` in
   `news/scripts/resolve_mentions.py` and `build_feedback_targets.py`;
   `newsapp/app/site.ts` grows `MAIN_SITE` and every client copy
   (`labels.ts`, `App.tsx`, `EntityChips.tsx`) reads it instead of restating it.
2. ⚠️ **NORMALIZE AT THE RENDER BOUNDARY, do not rely on a republish.** ~8,500
   hrefs are baked into published artifacts (`feedback-targets.json`,
   every story/article bundle's `entity_links`). A release published before this
   change is immutable and still served, so `mainSiteUrl()` rewrites the legacy
   host to the new one on the way out — the same function that applies the `/en`
   prefix. The producers change so new artifacts are born right; the normalizer
   is what makes yesterday's release right.
3. ⚠️ **VALIDATORS ACCEPT BOTH HOSTS.** `isPublicReviewedLinks` (data.ts) and
   both guards in `articleFeedback.ts` test the href against a literal
   `electionsbg.com`. Switching the literal instead of widening it silently
   drops every ALREADY-ACCEPTED reviewed link — the links would vanish at a 200
   with nothing failing. The predicate becomes „is this one of our two hosts",
   in ONE place, and the legacy host stays admissible until the artifacts are
   rebuilt and the retirement is measured.
4. Reader-facing strings: the header button, the footer link and the mobile menu
   say `naiasno.bg`; the `EntityChips` tooltip says „в naiasno.bg"; the noscript
   blocks in `newsapp/index.html` and `prerender.ts`, and `isPartOf`, name the
   new domain. Crawler/UA strings (`fetch_latest_articles.py`,
   `source_commons_images.py`, `llm_client.py`'s `NEWS_LLM_SITE_URL` default)
   follow, so a publisher checking who fetched them finds a live site.

## Tier 2 — the mark

Nothing to write. Rebuild `newsapp`, confirm the rendered masthead carries the
navy „на" tile and no `logoCardClip`, and hand the deploy to the operator.

## Tier 3 — places that have a page

1. `build_gazetteer.py` carries a **`detail`** on every place form — the
   obshtina and oblast name from `place_dim` — because a dropdown of four
   entries all reading „Аспарухово" is not a choice. `label()` in
   `resolve_mentions.py` already reads `claim["detail"]`; nothing produces one
   today.
2. Place kinds gain **obshtina** and **rayon**. `ENTITY_ROUTES` gets
   `place:obshtina → /governance/{id}` and `place:rayon → /governance/{id}`.
   **Oblast stays out** — see §0. Sofia's районs arrive for free as obshtina
   rows; the 10 Пловдив/Варна районs are read from the committed
   `data/maps/city_rayons/<muni>.json` (`nuts4` + `name`), the same artifact
   `cityRayonCatalog` mirrors.
3. ⚠️ The existing collapse rule (`place_entries`) folds settlement+obshtina+
   oblast rows that agree on their hierarchy into ONE place and links the most
   specific — that is why „Пловдив" links to the city and not to three pages.
   A район is a NEW level below the obshtina, so it enters
   `PLACE_SPECIFICITY` at −1 and the rule keeps working unchanged.
4. ⚠️ Район names are the worst false-match class in the corpus („Младост",
   „Витоша", „Възраждане" are районs, villages, a mountain and a party). They go
   through the SAME `form()` gate as every other surface — the common-word list,
   the given-name list, the minimum length — so a район cannot buy an exemption.

## Tier 4 — the dropdown

A name matched by several entries stops being plain text and becomes a chip that
OFFERS its candidates. It still does not pick one.

1. `resolve_mentions.py` grows `entity_candidates(entities, gaz)` → name →
   `[{kind, id, canonical, detail, href}]`, written as a sidecar beside
   `entity_links` by `build_app_data.py`.
2. ⚠️ **THE OFFER IS GATED, and the gate is the whole argument.** Candidates are
   published only when they are ALL ONE KIND, at most **5**, and every one has a
   served route. „Ангелов" — 7 public figures AND a village — stays plain text:
   a mixed-kind list asks the reader to decide what part of speech the sentence
   was, and a 7-name list implies one of them is meant when the article may mean
   an eighth Ангелов who is in no roster. Refusing to *pick* was never the same
   as refusing to *offer*, but an unbounded offer is a claim again.
3. ⚠️ **THE COPY MAY NOT ASSERT.** The chip reads „възможни съвпадения" /
   „possible matches" and the menu header says the article's own name was not
   resolved. „Виж профила" over a list we did not verify is the failure this
   whole subsystem exists to prevent.
4. `EntityChips` renders it with the shared Radix `DropdownMenu`
   (`modal={false}`, per the repo's scroll-lock rule), visually distinct from a
   resolved chip — dotted underline is the resolved affordance and must not be
   reused for an unresolved one.

## Tier 5 — mayors

1. `PEOPLE_SQL` admits `pr.source = 'local' AND pr.role = 'mayor'`, folded onto
   the existing `mayor` tier. Every new entry passes the same public-figure
   uniqueness test; 522 people join, 177 stay anchors-only.
   ⚠️ **NO `end_date IS NULL` FILTER** — the file's own rule: a mayor who left
   office last week is exactly who the news is about, and `tiers_mean` says
   „held", not „holds".
2. `news/data/entity_link_overrides.json` gains Благомир Коцев, gated on Варна,
   with the identity-merge follow-up written beside it.

## Follow-ups this plan deliberately does NOT do

- **Merge the 3 `person` rows for Благомир Рубинов Коцев** (and the other 6 of
  the 7). That is `data/person/link_overrides.json` + `db:resolve:persons` + the
  nine-step repair chain + a cloud publish — the `update-persons` skill's job,
  measured in hours, and it moves `person_id` ordinals site-wide.
- **`news.naiasno.bg`.** No DNS; the canonical stays put until there is.
- **Rewriting the baked hrefs in published artifacts.** The normalizer makes
  them correct on the way out; the retirement of the legacy host from the
  validators waits until a rebuild has been measured.
