# PRD: Manifesto / platform corpus

Build a structured corpus of party manifestos (предизборни програми)
across cycles, then layer features on top: per-cycle topic emphasis,
side-by-side compare, eventually a Wahl-O-Mat-style match quiz and a
promise tracker (when paired with roll-call data).

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

## Goals

1. **Build a manifesto corpus.** One markdown-normalised file per
   `(party, cycle)` tuple, with provenance metadata.
2. **Topic-tag each manifesto.** Surface "this party's 2026 platform
   focused on healthcare and EU funds" answers.
3. **Side-by-side compare.** Pick 2-3 parties for one election; see
   what each emphasised, where they agree, where they diverge.
4. **Foundation for a match quiz.** Phase 4. Map user values to
   manifesto signals.
5. **Foundation for a promise tracker.** Phase 5. Cross-reference
   manifesto promises against the new roll-call data — did the party
   vote how they promised?

## Non-goals (this PRD)

- LLM "fact-checking" of manifesto claims. Out of scope; political
  speech evaluation is hard and partial.
- Multilingual translation. BG corpus is canonical; English summaries
  generated, but the source-of-truth stays Bulgarian.
- Government coalition agreements (коалиционно споразумение) — those
  are post-election. Different shape, different incentives. Could
  layer in later.

## Data model

```
data/manifestos/
  index.json
    [{ partyKey, cycle, slug, sourceUrl, ingestedAt, format, topics: [...] }]
  corpus/<cycle>/<partyKey>.md
    YAML frontmatter + body. Frontmatter includes:
      partyKey, cycle, sourceUrl, retrievedAt, format ("pdf"|"html"|"manual"),
      ocrApplied: bool, sectionTitles: [string], rawByteHash, wordCount
  topics/<cycle>.json
    Aggregate per-cycle: { partyKey: { topic: emphasisScore, ... } }
  derived/
    similarity.json   — pairwise platform similarity per cycle (cosine on TF-IDF)
    diff/<cycle>/<partyA>__<partyB>.json — agreed/diverged stances
```

```ts
type ManifestoIndexEntry = {
  partyKey: string;          // canonical party key from canonical_parties.json
  cycle: string;             // election date YYYY_MM_DD or "ongoing"
  slug: string;              // URL-friendly: "gerb-sds__2026_04_19"
  sourceUrl: string;
  ingestedAt: string;
  format: "pdf" | "html" | "manual";
  ocrApplied: boolean;
  wordCount: number;
  topics: TopicSignal[];     // top topics with emphasis score
};

type TopicSignal = {
  topic: string;             // controlled vocabulary, see below
  emphasis: number;          // 0..1 — share of doc dedicated to this topic
  keywords: string[];        // top BG terms that triggered the match
};
```

## Topic vocabulary

Keep it small (~15-25 topics) and stable across cycles so comparison
works. Suggested initial set, BG-first:

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

Each manifesto gets emphasis scores per topic. Computed via:
- TF-IDF over a controlled keyword list per topic, OR
- Embedding-based topic classification (if a BG-aware sentence
  embedding model is available — multilingual MPNet works adequately)

Recommend keyword TF-IDF for v1 — deterministic, debuggable, no LLM
in the critical path. Embedding-based as a v2 enhancement.

## Pipeline

```
scripts/manifestos/
  scrape.ts           # Per-source fetch (party site, Wikipedia, etc.)
  ocr.ts              # Optional: tesseract or Cloud Vision for image PDFs
  to_markdown.ts      # PDF/HTML → clean markdown via pdf2md / readability
  topic_score.ts      # Apply topic vocabulary, compute emphasis vector
  derive_similarity.ts
  derive_diff.ts
```

A `/update-manifestos` skill orchestrates per-(party, cycle) ingest.
Heavily curator-driven — the operator picks the source URL, the
script does the parsing, the operator reviews the markdown output
before committing.

Watcher: `scripts/watch/sources/manifestos.ts` checks party sites for
new platform documents (very low-frequency signal during off-cycle;
high-frequency ~6 weeks before each election).

## SPA features

### Per-party manifesto archive
On `/party/:name` add a "Платформи" tab. Lists each cycle's manifesto
with publication date, link to source, link to read on-site
(rendered markdown).

### Per-cycle topic dashboard
New route `/elections/:date/platforms`. Bar chart per topic showing
which parties emphasised it most. Cyrillic topic labels, party color
bars.

### Side-by-side compare
New route `/compare/platforms?cycle=YYYY_MM_DD&parties=A,B,C`. Three-
column layout. Per-topic emphasis bars, plus a "where they agree" /
"where they diverge" breakdown derived from `diff/`.

### Manifesto reader
`/platforms/:slug` renders the markdown corpus file with section
navigation, source link, citation footer. Uses existing `ArticleProse`
components.

### (Phase 4) Match quiz
`/match-quiz` — 15-20 statements. User scores each on
agree/disagree/neutral. We match against per-party stances on those
same statements (manually scored from the corpus). Output: ranked
match scores.

### (Phase 5) Promise tracker
`/party/:name/promises` — for each major commitment in the manifesto,
show: did the party vote consistently with this in parliament? Pulls
from roll-call derived data + manual annotations linking promises to
specific votes.

## Implementation phases

**Phase 1 — Corpus skeleton + manual import (~1 week)**
- Storage layout above.
- `to_markdown.ts` for PDF + HTML inputs.
- Manual import of the 6-8 parties that crossed threshold in 2026.
- Per-party "Платформи" tab on party page.
- Manifesto reader page.

**Phase 2 — Topic scoring (~5 days)**
- Define topic vocabulary (BG keyword lists per topic).
- `topic_score.ts` computes emphasis vector per manifesto.
- Per-cycle topic dashboard route.

**Phase 3 — Compare view (~4 days)**
- `derive_similarity.ts` + `derive_diff.ts`.
- Compare route.

**Phase 4 — Match quiz (~2 weeks)**
- Curate 20 statements covering the major axes.
- Score each party on each statement (manual, from corpus).
- Quiz UI + result page with shareable link.

**Phase 5 — Promise tracker (~2 weeks)**
- Requires roll-call data already shipping (commit `911041c1f`
  baseline).
- Curate 10-20 specific promises per party per cycle.
- Annotate which votes correspond to each promise.
- Show "kept / partly / broken" indicator per promise.

## Success criteria

- Phase 1 ships with ≥6 parties × current cycle covered. The corpus is
  citable.
- Phase 2 dashboard answers "which parties focused on healthcare in
  2026?" in 1 click.
- Phase 4 quiz is shared organically (track via UTM in share links).
- Phase 5 promise tracker is the editorial centerpiece of the next
  election article.

## Editorial guardrails

- **Source link on every manifesto.** Always link back to the
  authoritative source — party site or archive.
- **No paraphrasing in topic labels.** Topic labels are categorical;
  emphasis scores are quantitative. We never write "party X believes Y"
  in our voice.
- **Manual review gate.** Phase 1 + 2 outputs are human-reviewed
  before commit. The match quiz statements are particularly sensitive
  — wording bias would invalidate the result.
- **Reproducible scoring.** Topic vocabulary + scoring code committed
  to repo. A reader can verify why party X scored high on healthcare.
- **Updates with cycle.** Manifesto for each cycle is frozen at the
  cycle's end. Updates after the election count as "post-cycle
  revisions" tracked separately.

## Open questions

1. **Embedding model.** TF-IDF for v1 is fine. For v2, a BG-aware
   embedding model would improve topic detection. Options:
   - paraphrase-multilingual-MiniLM (small, runs on CPU)
   - Anthropic embeddings via API (cost per ingest, but deterministic)
   - Self-host a BG model like BulbERT
2. **PDF quality.** Some party PDFs are scanned images. OCR via
   Tesseract is OK but BG-OCR quality is moderate. Cloud Vision is
   better but adds external dependency + cost. Recommend Tesseract for
   MVP, escalate per-document if needed.
3. **What counts as a "manifesto"?** Some parties publish a 2-page
   press release, others a 200-page document. Comparison is unfair if
   we treat them as equivalents. Normalisation strategy: word count
   threshold for full-doc treatment vs. summary-only treatment.
4. **Coalition manifestos.** When parties run as a coalition (e.g.
   ГЕРБ-СДС), what's the canonical manifesto? Coalition's joint doc
   if any, else the dominant partner's. Document the choice per cycle.
5. **Multi-cycle compare.** Comparing one party's 2021 vs. 2024
   platforms could surface drift. Worth a dedicated view? Defer to
   post-MVP.

## Reference

- `data/canonical_parties.json` — party id resolution (handles
  coalition aliasing).
- `public/articles/index.json` + `public/articles/<slug>-{bg,en}.md` —
  pattern for markdown content with frontmatter.
- `src/components/article/` — prose layout components (`ArticleProse`,
  `ArticleLayout`) reused for the manifesto reader.
- `scripts/parties/generate_retrospect.ts` — pattern for Claude-
  written narrative content if we want LLM summaries layered on top.
- `data/parliament/votes/derived/loyalty.json` — feeds the promise
  tracker (phase 5).
