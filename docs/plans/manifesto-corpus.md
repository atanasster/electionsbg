# PRD: Manifesto / platform corpus

Build a structured corpus of party manifestos (предизборни програми)
across cycles, then layer features on top: per-cycle topic emphasis,
side-by-side compare, eventually a Wahl-O-Mat-style match quiz and a
promise tracker (when paired with roll-call data).

*Revised 2026-05-21 after a best-practices review — see "Prior art &
best practices" below.*

## Context

- **What exists.** Nothing on the manifesto side. Party pages currently
  show vote results, financing, candidate lists, and (since the recent
  retrospects feature) AI-written campaign analyses. None of it reflects
  what parties actually promised.
- **What's missing.** A canonical manifesto corpus, NLP processing of
  it, and any UI surface that lets users compare platforms.
- **Why this is harder than other ingests.** Manifestos are
  unstructured text published in inconsistent formats (PDF, HTML, image
  scans). Some parties don't publish a formal manifesto at all and
  rely on speeches / campaign clips. The pipeline is a mix of
  automated scraping and curator judgment.

## Prior art & best practices

This space is well-trodden. Three external bodies of work should
shape the design instead of being reinvented from scratch.

**The Manifesto Project (MARPOR, WZB Berlin).** The academic gold
standard — hand-coded party manifestos since 1945 across 50+
countries. Method: split each manifesto into *quasi-sentences*;
assign each one of ~56 categories grouped into 7 policy domains.
**Bulgaria coverage stops at the March 2017 election** (verified on
the project's browse dashboard, 2026-05-21 — 59 entries, latest
2017-03). The eight snap-election cycles since 2021 are uncoded. So
MARPOR is a *partial* bootstrap, not the spine of phase 1.
Implications:

- The five cycles MARPOR covers (2005, 2009, 2013, 2014, 2017) can
  be imported — both aggregate domain scores and quasi-sentence-
  level "annotated text" CSVs. That gives the historical archive
  real depth and a citable academic anchor. But the editorially-
  interesting 2021–2026 period — the era of snap elections and the
  post-2020 party reshuffle — must be coded fresh by us. Treat
  MARPOR ingest as a useful side-quest, not phase 1's centerpiece.
- The annotated 2005–2017 manifestos earn their keep as a *test
  set*: run the LLM scorer over the manifestos MARPOR hand-coded
  and measure agreement with the expert codes. That measured number
  — not the corpus itself — is the most valuable thing MARPOR gives
  us. Temporal-drift caveat: the party system reshaped after 2020,
  so agreement on pre-2017 text is an upper bound.
- The topic vocabulary (below) should still map onto MARPOR's
  domain → category hierarchy — that is what keeps the pre-2017
  import comparable and our scheme benchmarkable against published
  political science.
- MARPOR's left-right index (RILE) is a known *poor fit* for
  Bulgaria — one of four Eastern-European countries the project
  itself flags. Do not naively reproduce a single left-right axis
  from RILE; if a political-space view is wanted, derive axes
  empirically and validate them.

**Voting Advice Applications (Wahl-O-Mat, smartvote, euandi).**
Decades of method for the match quiz (phase 4). Key practices: an
independent editorial board drafts statements *from manifestos*;
statements are kept only if they statistically *differentiate*
parties; parties answer for themselves rather than being scored by
the tool; positive/negative question polarity is balanced;
limitations are published openly rather than claiming "objectivity."

**Promise trackers (Polimeter / Université Laval, PolitiFact).**
Method for phase 5: explicit inclusion criteria (a promise must be
a formal, in-election, verifiable, precise commitment), a
multi-coder selection pass that drops vague/minor pledges, a status
set richer than kept/broken, and a citation behind every status.

## Goals

1. **Build a manifesto corpus.** One markdown-normalised file per
   `(party, cycle)` tuple, with provenance metadata.
2. **Topic-tag each manifesto** against a vocabulary aligned to the
   MARPOR domain scheme. Surface "this party's 2026 platform focused
   on healthcare and EU funds" answers.
3. **Side-by-side compare.** Pick 2-3 parties for one election; see
   what each emphasised, where they agree, where they diverge.
4. **Foundation for a match quiz.** Phase 4. Map user values to
   manifesto signals using established VAA methodology.
5. **Foundation for a promise tracker.** Phase 5. Cross-reference
   manifesto promises against roll-call, budget-execution, and
   procurement data — did the party govern how they promised?

## Non-goals (this PRD)

- LLM "fact-checking" of manifesto claims. Out of scope; political
  speech evaluation is hard and partial.
- Multilingual translation. BG corpus is canonical; English summaries
  generated, but the source-of-truth stays Bulgarian.
- Government coalition agreements (коалиционно споразумение) — those
  are post-election. Different shape, different incentives. Could
  layer in later.
- A single left-right ideology score. RILE is a poor fit for
  Bulgaria; emphasis-per-topic and an empirical political-space map
  are the honest summaries instead.

## Emphasis vs. position — read this first

The PRD repeatedly distinguishes two things that are easy to
conflate:

- **Emphasis (salience)** — *how much* a manifesto talks about a
  topic. Computed automatically — a grounded LLM classifies each
  quasi-sentence, code aggregates the spans. Quantitative.
- **Position (stance)** — *what the party would do* about it. A
  manifesto can dedicate many sentences to corruption while
  attacking opponents' corruption rather than proposing anything.
  Stance is editorial: curator-coded or party-self-declared.

Every feature below keeps these as separate fields. The topic
dashboard shows emphasis. The compare "agree/diverge" view and the
match quiz need positions. Never merge them into one number.

## Data model

```
data/manifestos/
  index.json
    [{ partyKey, cycle, slug, source, sourceUrl, ingestedAt,
       format, coverage, wordCount, topics: [...] }]
  corpus/<cycle>/<partyKey>.md
    Human-readable normalised manifesto. YAML frontmatter +
    markdown body. Frontmatter: partyKey, cycle, source, sourceUrl,
    retrievedAt, format ("pdf"|"html"|"manual"|"marpor"),
    ocrApplied, sectionTitles, rawByteHash, wordCount, coverage
  coded/<cycle>/<partyKey>.json
    Analytic layer — the manifesto segmented into quasi-sentences
    (MARPOR-style), each carrying a topic code and a stance. Header
    records scorer provenance: scorerModel, scorerPromptHash, the
    raw LLM response, and the dictionary cross-check delta. This —
    not the opaque .md body — is what every downstream feature reads.
  topics/<cycle>.json
    Aggregate per-cycle: { partyKey: { topic: emphasisScore } }
  vocabulary.json
    Controlled topic list + MARPOR crosswalk (topic → 7-domain),
    committed and stable across cycles. Drives both scoring and
    the MARPOR validation.
  derived/
    similarity.json   — pairwise platform similarity per cycle
    space.json        — empirical political-space coordinates
    diff/<cycle>/<partyA>__<partyB>.json — agreed/diverged stances
    drift/<partyKey>.json — one party's emphasis vector across cycles
```

Storing the **coded quasi-sentence layer from day one** is a
deliberate call. The PRD's original model kept only `sectionTitles`
and an opaque markdown body; sentence-level topic tags, the
compare diff, and promise-to-text linking are all impossible to
retrofit onto opaque text. Segment early.

```ts
type ManifestoIndexEntry = {
  partyKey: string;          // canonical key from canonical_parties.json
  cycle: string;             // election date YYYY_MM_DD or "ongoing"
  slug: string;              // URL-friendly: "gerb-sds__2026_04_19"
  source: "marpor" | "scrape" | "manual";
  sourceUrl: string;
  ingestedAt: string;
  format: "pdf" | "html" | "manual" | "marpor";
  ocrApplied: boolean;
  wordCount: number;
  coverage: "full" | "summary" | "thin";  // see open question 3
  topics: TopicSignal[];     // top topics with emphasis score
};

type TopicSignal = {
  topic: string;             // controlled vocabulary, see below
  domain: string;            // MARPOR domain the topic rolls up to
  emphasis: number;          // 0..1 — share of doc dedicated to topic
  keywords: string[];        // top BG terms that triggered the match
};

type CodedSegment = {
  text: string;              // verbatim quasi-sentence (the cited span)
  topic: string | null;      // controlled vocabulary, null if none
  stance: "for" | "against" | "mixed" | null;
  stanceSource: "llm" | "curator" | "party";  // who set the stance
};
```

## Topic vocabulary

Keep it small (~15-25 topics) and stable across cycles so comparison
works. Each topic **rolls up to one of MARPOR's 7 policy domains**
(external relations, freedom & democracy, political system,
economy, welfare & quality of life, fabric of society, social
groups) so the corpus is comparable to academic data. Suggested
initial set, BG-first:

```
healthcare        здравеопазване
education         образование
eu_integration    европейска интеграция
nato              НАТО / отбрана
energy            енергетика
agriculture       земеделие
judicial          съдебна реформа
anti_corruption   борба с корупцията
economy           икономика / данъци
social_security   социално осигуряване / пенсии
demographics      демография / семейство
roma              ромска интеграция
russia            отношения с Русия
nationalism       национална идентичност
green             екология / климат
infrastructure    инфраструктура / транспорт
digital           цифровизация / e-gov
labour            работна заплата / трудови отношения
sofia             София и големите градове
small_business    малък и среден бизнес
```

(Note `sofia` is a geography rather than a policy domain, and
`russia`/`nato`/`eu_integration` overlap under external relations —
worth a tidy-up pass against the MARPOR scheme before freezing.)

Each topic carries an emphasis score and, where the curator
confirms one, a stance. How those are produced — a grounded,
once-per-cycle LLM eval — is the next section.

## Scoring the corpus

Scoring runs **once per (party, cycle)** — ~8 parties × ~13 cycles
≈ 100 manifestos, one batch job each. That framing is decisive:
cost and latency are irrelevant, so the v1 scorer can be an LLM.
It is the same shape as the existing retrospects feature — an LLM
artifact, cached, committed, human-reviewed.

"Use an LLM" does **not** mean "ask it for a 0–1 per topic." A
black-box document scorer hallucinates emphasis and cannot be
audited. Three rules make it sound:

1. **Grounded, quasi-sentence-grain classification.** The LLM
   labels each quasi-sentence (the `coded/` layer) with a topic, a
   stance, and the verbatim span that justifies it. Emphasis is
   then computed **deterministically** — arithmetic over the coded
   spans (cited words / total words). The LLM classifies; code does
   the math. No span → no score, so the model cannot invent
   emphasis on a topic the text never raises. This also yields the
   "why this score" drill-down for free. The prompt carries a
   handful of MARPOR-coded quasi-sentences as gold-standard
   exemplars — in-context few-shot examples. There is no training
   step: Opus is used zero/few-shot, never fine-tuned.
2. **Validate against MARPOR.** Run the classifier over the
   2005–2017 manifestos MARPOR hand-coded, compare to the expert
   codes, and publish the agreement rate + confusion matrix on the
   methodology page. This converts "we used an LLM, trust us" into
   a measured number — the highest-value use of the limited MARPOR
   data (a test set, not display content). Two dependencies:
   - **A topic crosswalk.** Our ~20 topics are not MARPOR's 56
     categories. A committed crosswalk maps each topic onto
     MARPOR's 7 domains; agreement is then measured honestly at the
     *domain* level, not per-topic. Without the crosswalk the
     validation claim is hand-wavy.
   - **Model choice is measured, not assumed.** Run Opus 4.7 and
     Sonnet 4.6 against the test set and pick whichever clears the
     agreement bar — at 100 docs the cheaper model wins ties. Use
     the Batch API either way (50% off; the docs are independent).
3. **Pin and commit the provenance.** Commit the model ID, the
   exact prompt, and the raw LLM response alongside the derived
   scores; record `scorerModel` + `scorerPromptHash` in the coded
   file. Not bit-reproducible, but the committed artifact is the
   authoritative, auditable record — the standard the retrospects
   feature already meets. Run at temperature 0 with the party name
   stripped from the document, so the model scores the text in
   front of it, not the party's reputation.

The dictionary / keyword method survives only as a cheap,
deterministic **cross-check** — a canary that flags manifestos
where the LLM and the lexicon disagree sharply, for curator
attention. It is no longer the primary scorer.

Keep the emphasis / stance split. Emphasis is LLM classification —
low editorial risk, accepted as scored. Stance the LLM **proposes**
and the curator **confirms** in the review gate. Nothing
evaluative: "is this promise realistic / good" stays the
out-of-scope fact-checking non-goal.

For the similarity and political-space views (`similarity.json`,
`space.json`), use multilingual **embeddings**, not the generative
LLM — embeddings are genuinely deterministic (pinned model → same
vector), which is exactly what those derived artifacts want.

## Pipeline

```
scripts/manifestos/
  ingest_marpor.ts    # Import already-coded historical manifestos
  scrape.ts           # Per-source fetch (party site, Wikipedia, etc.)
  ocr.ts              # Optional: tesseract or Cloud Vision for scans
  to_markdown.ts      # PDF/HTML → clean markdown via pdf2md / readability
  classify.ts         # LLM: split into quasi-sentences, label each
                      #   with topic + stance + verbatim span
  aggregate.ts        # Deterministic emphasis vectors from coded spans
  dictionary_check.ts # Keyword cross-check; flag LLM/lexicon disagreement
  validate_marpor.ts  # Score MARPOR-coded docs, emit agreement matrix
  derive_similarity.ts  # Multilingual embeddings → pairwise similarity
  derive_space.ts     # Embeddings → empirical political-space coords
  derive_diff.ts
  derive_drift.ts     # Per-party emphasis across cycles
```

A `/update-manifestos` skill orchestrates per-(party, cycle) ingest,
following the existing `update-*` skill shape (fetch → validate →
transform → aggregate → output, with last-run state under
`state/ingest/`). Heavily curator-driven — the operator picks the
source URL, the script does the parsing, the operator reviews the
markdown output and the curator-coded stances before committing.

Watcher: `scripts/watch/sources/manifestos.ts` checks party sites for
new platform documents (very low-frequency signal during off-cycle;
high-frequency ~6 weeks before each election).

## SPA features

### Per-party manifesto archive
On `/party/:name` add a "Платформи" tab. Lists each cycle's manifesto
with publication date, a **coverage badge** (full / summary / thin),
link to source, link to read on-site (rendered markdown).

### Per-cycle topic dashboard
New route `/elections/:date/platforms`. Bar chart per topic showing
which parties emphasised it most. Cyrillic topic labels, party color
bars. Also an **election-agenda view** — topics summed across all
parties — to answer "2026 was the EU-funds election."

### Side-by-side compare
New route `/compare/platforms?cycle=YYYY_MM_DD&parties=A,B,C`. Three-
column layout. Per-topic emphasis bars, plus a "where they agree" /
"where they diverge" breakdown derived from `diff/`. The diff is
built from curator-coded **stances**, not cosine similarity — two
parties can both emphasise healthcare while proposing opposites.

### Political-space map
A 2D scatter (smartvote "smartmap" pattern) plotting parties from
manifesto content — far more legible than 20 bar charts. Reuse the
party-correlation / embedding visualisation infrastructure already
built for roll-call data. Axes derived empirically (not RILE).

### Cross-cycle drift
Per party, chart how its topic emphasis shifts 2021 → 2024 → 2026.
Cheap to build on top of `topics/`, and editorially rich. Promoted
ahead of the match quiz — higher value per unit effort.

### Manifesto reader
`/platforms/:slug` renders the markdown corpus file with section
navigation, source link, citation footer. Uses existing `ArticleProse`
components. A **"why this score" drill-down** lets a reader click any
topic emphasis and see the exact quasi-sentences that matched — the
reproducibility guardrail, turned into a UI feature.

### Methodology page
An `ArticleLayout` article that states, openly, how emphasis and
stance are computed and where the method is weak — including the
LLM scorer's measured agreement rate against MARPOR's expert codes,
with the confusion matrix. Best practice for civic tools
(Wahl-O-Mat does this) — not optional.

### (Phase 4) Match quiz
`/match-quiz` — Wahl-O-Mat-style. The methodology matters more than
the UI:

- **Statement pool.** Draft 40-60 candidate statements from the
  corpus, covering topics that are both important and divisive.
- **Differentiation test.** Keep only statements where party
  stances actually spread; drop ones every party agrees on.
  Wahl-O-Mat prunes ~80 candidates to 38 this way.
- **Party positions.** Invite parties to self-place on the final
  statements. Where a party doesn't respond, fall back to curator
  coding from the corpus — and label in the UI which is which.
- **Polarity balance.** Mix positively- and negatively-worded
  statements; question polarity is a documented bias source.
- **User flow.** Agree / disagree / neutral / skip, plus an
  issue-weighting step (mark the topics you care about — smartvote
  pattern).
- **Output.** Ranked match scores + the user's own point on the
  political-space map. Shareable result card with an OG image and
  UTM-tagged link.

### (Phase 5) Promise tracker
`/party/:name/promises` — Polimeter discipline:

- **Inclusion criteria.** A promise must be a formal commitment,
  made in the election context, precise enough to verify. A
  multi-coder pass drops vague or minor pledges.
- **Status set.** kept / partly / in progress / stalled / broken /
  not yet rated. A binary kept/broken is too lossy and editorially
  risky.
- **Evidence.** Every status is backed by a citation — a roll-call
  vote, a budget-execution line, a procurement record, or an
  official document. Roll-call alone is a weak proxy: promises are
  often kept via budget allocation or regulation rather than a
  named vote, and an MP voting against their own pledge may simply
  reflect coalition discipline.
- **Headline.** The aggregate ("X% kept in full or part") is the
  editorial centerpiece of the next-election article.

### Cross-feature integration
The app's unfair advantage is the data it already holds:

- **Say-do gap score** — a per-party metric comparing manifesto
  emphasis against actual roll-call behaviour. Only this repo has
  both datasets cleanly.
- **Feed manifestos into `bundle_party_data.ts`** so the AI
  campaign retrospect can reference what the party promised.

## Implementation phases

**Phase 1 — Corpus skeleton + manual import (~1.5 weeks)**
- Storage layout above, including the `coded/` quasi-sentence layer.
- `to_markdown.ts` for PDF + HTML inputs; `segment.ts`.
- Manual import of the 6-8 parties that crossed threshold in 2026 —
  the fresh-coding work, since MARPOR does not cover this cycle.
- Per-party "Платформи" tab, coverage badges, manifesto reader.
- `ingest_marpor.ts` for the 2005–2017 cycles — lower priority; can
  slip to phase 2 if the fresh 2026 import runs long.

**Phase 2 — Topic scoring (~1 week)**
- Topic vocabulary mapped to MARPOR domains; dictionary cross-check
  keyword lists.
- `classify.ts` + `aggregate.ts` — the grounded LLM eval.
- `validate_marpor.ts` — agreement rate vs. expert codes, published
  on the methodology page.
- Per-cycle topic dashboard + election-agenda view.
- "Why this score" drill-down.

**Phase 3 — Compare, drift & space (~1 week)**
- `derive_similarity.ts`, `derive_diff.ts`, `derive_drift.ts`,
  `derive_space.ts`.
- Compare route, cross-cycle drift view, political-space map.

**Phase 4 — Match quiz (~2 weeks)**
- Statement pool from the corpus; differentiation test prune.
- Party self-placement outreach; curator fallback coding.
- Quiz UI, issue weighting, result page with shareable link.
- This is the riskiest phase, not just the longest — bad statement
  wording invalidates the result.

**Phase 5 — Promise tracker (~2 weeks)**
- Requires roll-call data already shipping (commit `911041c1f`
  baseline).
- Curate promises per party per cycle under the inclusion criteria.
- Annotate each promise with citations (votes, budget, procurement).
- Show the kept/partly/.../broken indicator + aggregate headline.

## Success criteria

- Phase 1 ships with ≥6 parties × current cycle covered (the 2026
  cycle is the must-have; the MARPOR-covered 2005–2017 cycles are a
  bonus where the licence permits). The corpus is citable.
- Phase 2 dashboard answers "which parties focused on healthcare in
  2026?" in 1 click, and every score is traceable to source text.
  The LLM scorer's MARPOR agreement rate is measured and published.
- Phase 4 quiz is shared organically (track via UTM in share links).
- Phase 5 promise tracker is the editorial centerpiece of the next
  election article.

## Editorial guardrails

- **Source link on every manifesto.** Always link back to the
  authoritative source — party site, archive, or MARPOR entry.
- **No paraphrasing in topic labels.** Topic labels are categorical;
  emphasis scores are quantitative. We never write "party X believes
  Y" in our voice.
- **Emphasis is automated; stance is reviewed.** Emphasis scores are
  reproducible counts. Stances are curator-coded or party-declared,
  and the UI always shows which.
- **"No stated position" is first-class.** Tools that force a
  position on every party for every issue are the ones that diverge
  >50% from parties' actual stances. A blank is allowed everywhere.
- **Manual review gate.** Phase 1 + 2 outputs are human-reviewed
  before commit. Match quiz statements are particularly sensitive —
  wording bias would invalidate the result.
- **Auditable scoring.** The LLM scorer is not bit-reproducible, so
  the committed artifact is authoritative: model ID, prompt, raw
  response, and per-score citations all live in the repo. A reader
  verifies why party X scored high on healthcare via the "why this
  score" drill-down; the MARPOR agreement rate is published too.
- **Publish the limitations.** The methodology page states openly
  where the method is weak rather than claiming objectivity.
- **Updates with cycle.** Manifesto for each cycle is frozen at the
  cycle's end. Updates after the election count as "post-cycle
  revisions" tracked separately.

## Open questions

1. **MARPOR licence & export format.** Coverage is confirmed —
   Bulgaria 2005–2017 only, the 2021–2026 cycles must be coded
   fresh. Still open: the licence terms for redistributing MARPOR's
   coded data / annotated text inside this repo, and the exact CSV
   schema of the "annotated text" export that `ingest_marpor.ts`
   must parse.
2. **Embedding model for similarity / space.** The scorer is the
   LLM (see "Scoring the corpus"); still open is which multilingual
   embedding feeds `similarity.json` / `space.json`:
   - paraphrase-multilingual-MiniLM (small, runs on CPU, free)
   - Anthropic embeddings via API (cheap at this volume)
   - Self-host a BG model like BulbERT
3. **What counts as a "manifesto"?** Some parties publish a 2-page
   press release, others a 200-page document. The `coverage` field
   (full / summary / thin) records this; thin docs are excluded from
   the compare view rather than treated as equivalents. Emphasis is
   compared as *share* of document, never raw word count.
4. **Coalition manifestos.** When parties run as a coalition (e.g.
   ГЕРБ-СДС), what's the canonical manifesto? Coalition's joint doc
   if any, else the dominant partner's. Document the choice per cycle.
5. **Party self-placement participation.** The match quiz is best
   when parties answer for themselves. What's the outreach plan, and
   the fallback if (likely) several parties don't respond?

## Reference

- `data/canonical_parties.json` — party id resolution (handles
  coalition aliasing).
- `public/articles/index.json` + `public/articles/<slug>-{bg,en}.md` —
  pattern for markdown content with frontmatter.
- `src/components/article/` — prose layout components (`ArticleProse`,
  `ArticleLayout`) reused for the manifesto reader and methodology
  page.
- `scripts/parties/generate_retrospect.ts` /
  `scripts/parties/bundle_party_data.ts` — pattern for Claude-written
  narrative content, and the bundle to extend with manifesto text.
- `data/parliament/votes/derived/loyalty.json` — feeds the promise
  tracker (phase 5).
- The Manifesto Project (MARPOR), WZB Berlin —
  manifesto-project.wzb.eu — coded manifesto corpus + codebook.
- Wahl-O-Mat, smartvote, euandi — voting-advice-application
  methodology for phase 4.
- Polimeter (Université Laval), PolitiFact — promise-tracker
  methodology for phase 5.
