# Наясно Новини — editorial-treatment rubric v2

**Status:** proposed implementation plan, 2026-09-01. No implementation has
started.

**Supersedes:** the party-tone semantics in
`docs/plans/news-party-tone-integration-v1.md` and the vocabulary-preservation
decision in §4.2 of `docs/plans/news-analysis-evals-v1.md`. Those files remain
dated design records; do not rewrite them.

## 1. Outcome

Replace the current “explicit evaluative language” classifier with an
evidence-backed **editorial treatment** classifier. It judges what the edited
article does with a position — amplifies, balances, challenges, endorses or
denounces it — rather than trying to infer what an outlet privately likes.

The public result has three applications:

1. treatment of every meaningfully covered political party;
2. stance toward the Russian state and Russian state policy;
3. liberal/progressive versus conservative framing on political subjects.

All three use the same ordered five-position logic, with axis-specific public
labels. The unit remains one article or one article–party pair. Outlet, topic and
story surfaces may aggregate dated count distributions with denominators, but
must not turn them into a permanent outlet rating or a single “bias score”.

The feature is complete only after the prompt, strict schemas, runtime validator,
stored records, gold/evaluation workflow, public correction path, derived
aggregates and every rendering surface use the same versioned semantics.

## 2. Why this is a v2, not a label patch

Measured 2026-09-01:

- corpus: 5,963 saved articles; 1,833 analyzed; 1,687 quality=`ok`;
- party treatment: 307 article–party pairs — 250 `neutral` (81.4%), 38
  `unfavorable`, 14 `favorable`, 5 `mixed`;
- political framing: 510 `neutral`, 85 directional labels and 1,092
  `not_applicable`;
- Russia: 27 `neutral`, 153 directional labels and 1,507 `not_applicable`.

The current party evidence repeatedly says that a central party statement was
published unchallenged and therefore classified as neutral. Under this plan that
is usually mild favorable treatment: the party received a clean microphone. The
same boundary change applies to unchallenged Russian-state premises and to
recognizably liberal/progressive or conservative propositions.

Therefore:

- adding `strong_*` only to party tones is insufficient;
- silently changing the prompt while retaining old records would mix two
  meanings in every story/outlet/topic aggregate;
- existing accepted evaluations cannot override v2 records unless they were
  made against the v2 rubric;
- the frozen v1 gold and benchmark reports remain historical and are not edited
  in place.

## 3. Semantic contract

### 3.1 The shared five-position rule

| Abstract position | Party label | Observable editorial treatment |
| --- | --- | --- |
| -2 | `strong_unfavorable` | The article advances a dominant hostile thesis through authorial accusation, denunciation, investigation or loaded framing. |
| -1 | `unfavorable` | The subject/position is materially weakened by selected criticism, adverse context, contradiction or an unanswered countervoice. |
| 0 | `neutral` | Procedural facts or genuinely balanced treatment; no side controls the edited frame. |
| +1 | `favorable` | A central subject's chosen message or premise controls the headline/lead and receives no material challenge: clean amplification, not necessarily praise. |
| +2 | `strong_favorable` | The article advances a dominant favorable thesis through praise, endorsement, celebration or defense. |

The abstract score is an implementation/evaluation aid, not public copy and not
an invitation to publish outlet averages.

### 3.2 Boundary rules

1. **Centrality is required.** A bare mention, historical fact, vote table or
   incidental quote is neutral and does not become favorable merely because no
   rebuttal follows.
2. **Clean amplification is mildly directional.** A standalone announcement,
   interview answer or position that controls the headline/lead and is relayed
   without material challenge is +1 toward the speaker/position.
3. **A second source is not automatically negative.** It must materially weaken
   the subject's premise or receive editorial weight. Proportionate response and
   counter-response is neutral.
4. **Strong requires an editorial thesis.** A quoted politician praising
   themselves or attacking an opponent does not by itself produce a strong
   label. The headline, narration, structure or investigation must adopt and
   sustain the direction.
5. **A right of reply does not neutralize an investigation.** A documented
   corruption investigation can remain strongly unfavorable while fairly
   including the subject's response.
6. **Truth and stance are different questions.** A negative treatment may be
   thoroughly evidenced; the label does not allege falsehood.
7. **Judge the text, never outlet reputation.** Outlet preference may only be
   derived later from enough article-level observations with article type and
   period visible.

### 3.3 Party treatment

Every unique party in `entities.parties` on a publishable article has exactly
one party-treatment item; every treatment item refers to exactly one displayed
party. Party absence is represented by no item, never by neutral.

The current `mixed` label is removed from the ordinal position. Substantial
evidence in both directions is retained as `mixed_evidence=true` beside the
best-supported net position. A balanced high-intensity article may therefore be
`neutral + mixed_evidence`; a mostly negative investigation containing genuine
praise may be `unfavorable + mixed_evidence`.

No v1 `mixed` item is mapped automatically. It must be re-read.

### 3.4 Russia stance

Retain the stored/public label order:

```text
strong_pro_russia, pro_russia, neutral,
anti_russia, strong_anti_russia, not_applicable
```

Interpret it through editorial treatment:

- unchallenged central amplification of Russian-state premises is
  `pro_russia`;
- material counter-context or unchallenged amplification of the opposing
  premise is `anti_russia`;
- authorial justification/glorification or sustained denunciation/containment
  advocacy reserves the strong endpoints;
- balanced diplomacy or procedural reporting is neutral;
- Russia absent from the material issue is `not_applicable`.

The target is the Russian state, its agents and state policy — not Russian
people, language or culture. The prompt, methodology and labels must say so.

### 3.5 Liberal/progressive framing

Retain the stored label order for compatibility with consumers:

```text
strong_progressive, progressive, neutral,
conservative, strong_conservative, not_applicable
```

Change the public explanation to **liberal/progressive–conservative framing**
and narrow the judged proposition:

- liberal/progressive anchors: civil and minority rights, pluralism,
  institutional checks, rule-of-law reform and European liberal-democratic
  norms;
- conservative anchors: traditional social order, church/family authority,
  sovereignty-first and anti-pluralist/anti-“gender” framing;
- economic liberalism, welfare spending, tax levels and generic
  anti-corruption mentions do not determine the axis on their own.

Favorable treatment of a nominally liberal party does not make an article
progressive when the event has no ideological proposition. Conversely, an
article can treat a conservative party favorably while amplifying a progressive
policy in that particular story. Party and framing judgments stay independent.

### 3.6 Basis and mixed evidence

Every v2 scalar judgment and party item adds:

```text
treatment_basis ∈ procedural_facts | clean_amplification |
                  balanced_sources | critical_context | authorial_thesis |
                  not_applicable
mixed_evidence: boolean
```

`treatment_basis` makes the decision auditable and helps distinguish the new
favorable boundary from praise. It is not a second score. The validator checks
shape and enum membership; semantic compatibility is tested through gold cases
and review routing rather than brittle keyword rules.

When `mixed_evidence=true`, evidence must identify both directions and the item
is routed to review during the initial rollout. `not_applicable` always has
`treatment_basis=not_applicable` and `mixed_evidence=false`.

## 4. Versioned stored contract

The model still emits only qualitative fields. The save step validates,
enriches party identity and then stamps versions:

```json
{
  "analysis_rubric_version": 2,
  "leaning": {
    "label": "progressive",
    "confidence": 0.84,
    "evidence": "...",
    "treatment_basis": "clean_amplification",
    "mixed_evidence": false
  },
  "russia_stance": {
    "label": "not_applicable",
    "confidence": 1,
    "evidence": "Russia is not materially involved.",
    "treatment_basis": "not_applicable",
    "mixed_evidence": false
  },
  "party_tones_version": 3,
  "party_tones": [
    {
      "party": "ГЕРБ",
      "party_id": "gerb",
      "tone": "favorable",
      "confidence": 0.82,
      "evidence": "...",
      "treatment_basis": "clean_amplification",
      "mixed_evidence": false
    }
  ]
}
```

`analysis_rubric_version`, `party_tones_version`, `party_id`, evidence-gate
versions, review metadata and hashes are computed fields. Model-supplied copies
are rejected.

Legacy records remain readable for rollback and historical comparison but are
**unassessed under v2**. They never enter v2 aggregates. A public v2 build fails
if a displayed analysis is legacy; unknown is never projected as neutral.

## 5. Implementation sequence

The dependency is strict:

```text
rubric fixtures → prompt/schema/validator → human reference + scorer
               → eligible model → candidate backfill → atomic promotion
               → public article UI → aggregate surfaces
```

No later phase starts merely because an earlier schema compiles.

### Tier 0 — freeze the decision cases and baseline

Create a tracked v2 rubric fixture set before changing model output:

- at least 60 hand-written boundary cases covering party, Russia and framing;
- press release, wire copy, interview, procedural report, multi-source report,
  opinion, profile and investigation shapes;
- positive factual amplification versus incidental factual mention;
- critical context versus balanced sourcing;
- attributed praise/attack versus adopted editorial thesis;
- genuinely mixed evidence;
- Russia-state versus Russian-people distinction;
- party treatment and ideological framing pointing in different directions.

Each fixture contains a short synthetic excerpt or a hash-bound corpus article,
the expected label/basis/mixed flag, and a one-sentence reason. Do not use
copyrighted full article bodies in tracked fixtures.

Add a dated baseline report with the counts in §2, prompt/schema hashes and a
manifest of the existing 1,833 analysis records. This report is evidence for the
cutover, not a ratchet requiring the new distribution to look different.

**Gate:** two adjudicators independently classify at least 50 real judgments.
Ordinal weighted kappa must reach 0.80 on each scalar axis and party tone. If
humans cannot clear it, revise the rubric before asking models to.

### Tier 1 — prompt, generated schemas and runtime validation

Source changes:

- `.agents/skills/analyze-news-article/SKILL.md` — canonical agent rubric;
- `news/prompts/analyze_system.source.md` — standalone-model rubric;
- `news/scripts/analyze_articles.py` — label constants, version constants,
  raw validation, party enrichment, evidence/review routing, stats and rebuild;
- `news/scripts/build_prompts.py` — JSON Schema and GBNF generation;
- `news/scripts/analyze_local.py` — provenance and candidate-output support.

Regenerate, never hand-edit:

- `news/prompts/analyze_system.md`;
- `news/prompts/analyze_schema.json`;
- `news/prompts/analyze_schema.gbnf`.

Validation requirements:

- exact party-entity coverage and no duplicate party keys;
- new five-value party enum; old `mixed` rejects under v3;
- basis enum and boolean mixed flag on both scalar blocks and every party item;
- confidence finite and in `[0,1]`;
- evidence non-empty and grounded by the existing deterministic gate;
- strong labels with weak/ungrounded evidence route to review;
- all `mixed_evidence=true` items route to review initially;
- non-publishable records carry no party claims and use not-applicable scalar
  shapes;
- version fields are absent from raw model output and stamped only after the
  whole record passes;
- saving remains atomic: one malformed judgment rejects the entire record.

Tests:

- update `news/scripts/test_analyze_articles.py`,
  `test_local_runner.py`, `test_review_routing.py` and `test_prompts.py`;
- add mutation cases proving clean amplification and incidental mention are
  not treated alike;
- prove generated JSON Schema, GBNF and runtime enums accept/reject the same
  shapes;
- retain the skill's five-known-article consistency diff, expanded to include
  at least one example at each mild boundary.

### Tier 2 — evaluation contract and model release gate

Do not rewrite the frozen v1 reference. Create a v2 editorial-treatment
reference revision and bind it to immutable article hashes, rubric hash,
prompt/schema hashes and adjudication version.

Build two sets:

1. a prevalence-oriented stratified sample of at least 150 political articles,
   used to measure real label distribution;
2. a deliberately balanced challenge supplement with at least 25 reference
   judgments per represented endpoint/boundary, clearly reported as a
   diagnostic set rather than prevalence.

Update:

- `news/eval_contract/*.json` and canonical vectors;
- `news/scripts/score_analyses.py`, `benchmark_party_tones.py`,
  `build_political_gold_config.py`, reference validators and their tests;
- `news-functions/src/evaluation.ts`, `storage.ts`, `operator.ts` and function
  tests;
- `newsapp/app/evals.ts`, `evalSubmission.ts`, `EvalArticleScreen.tsx`,
  `ArticleFeedbackScreen.tsx` and tests.

Every task, submission, accepted adjudication and feedback target carries
`analysis_rubric_version`. A v1 submission cannot override a v2 analysis.
Task hashes include the rubric and model-label version, so an in-flight old task
is rejected as stale rather than silently reinterpreted.

Scoring remains separated by field:

- party-pair precision/recall;
- party-tone macro-F1, per-label precision/recall, confusion matrix and ordinal
  weighted kappa;
- leaning and Russia macro-F1 plus ordinal weighted kappa;
- treatment-basis accuracy;
- mixed-evidence precision/recall;
- confidence calibration;
- unresolved/wrong canonical party identity;
- unsupported evidence.

Initial release gates:

| Gate | Minimum |
| --- | ---: |
| Valid schema after bounded retry/review | 100% |
| Party-pair precision | 0.95 |
| Party-pair recall | 0.90 |
| Macro-F1 on each public ordinal field | 0.80 |
| Ordinal weighted kappa on each public ordinal field | 0.80 |
| Recall for every represented party tone | 0.70 |
| Wrong canonical-party links in audited release sample | 0 |
| Unsupported evidence in audited release sample | 0 |
| Treatment-basis accuracy | 0.80 |

No model is eligible through an overall average. The current benchmark already
withholds party treatment because every tested model failed its gate; v2 stays
hidden until the new frozen-input benchmark passes.

### Tier 3 — candidate backfill without mutating live analyses

Add a candidate mode to `analyze_articles.py` / `analyze_local.py`:

- `--save-candidate-batch <root>` validates and enriches records but does not
  update the live analysis tree, story files or index;
- each candidate manifest stores article SHA-256, previous-analysis SHA-256,
  model/served-model, prompt/schema/rubric hashes, attempts, token/cost data and
  candidate SHA-256;
- promotion refuses an article or old-analysis hash that moved after the
  candidate was produced;
- promotion uses the ordinary atomic save path so story detachment/re-attachment
  remains one implementation.

Run order:

1. fresh dated `--stats` and manifest count;
2. pilot 100 political articles, deliberately covering every treatment basis;
3. human-review every pilot diff and re-run the frozen scorer;
4. re-analyze **all currently analyzed articles**, not only those already
   carrying parties — old entity extraction may have missed a party;
5. pause between bounded batches and retain resumable manifests;
6. review every unresolved party, old non-empty label change,
   `mixed_evidence=true`, strong endpoint and low-confidence result;
7. promote only after the complete candidate tree passes validation;
8. run `--rebuild` once after promotion and reconcile every story aggregate.

Cost must be stated at execution time. At the 2026-09-01 count this is 1,833
full article reads. At the measured GLM pricing it is roughly a low-single-digit
dollar model run, but human adjudication is the real cost. Take a new count and
price measurement immediately before execution; do not assume today's corpus or
provider price.

Cutover gate:

- 100% of articles in the currently public analyzed set are v2 or explicitly
  withheld with a review reason;
- zero v1/v2 records are combined in one aggregate;
- every promoted record matches its candidate manifest;
- old analyses have a recoverable local snapshot;
- the rebuilt index and every story count reconcile to the promoted records.

### Tier 4 — public projection and TypeScript contract

Update `news/scripts/build_app_data.py` and related effective-analysis/feedback
code so a public v2 build:

- publishes only `analysis_rubric_version=2` judgments;
- accepts only `party_tones_version=3` party items;
- includes basis and mixed flag on article detail;
- carries compact party position/basis to story members without duplicating
  evidence;
- recomputes story, topic and outlet distributions from effective v2 values;
- never treats absent/legacy/withheld as neutral;
- checks accepted human overrides against the same rubric version;
- includes rubric/prompt/model provenance in article and manifest output.

Update `newsapp/app/data.ts` and `labels.ts`:

- expand `Tone` to the ordered five labels;
- add basis and mixed-evidence types;
- retain existing Russia order;
- update progressive labels to “liberal/progressive framing” in BG/EN copy;
- give every segment text as well as color.

Do not compute or publish a party/outlet mean score. Ordinal positions are used
for evaluation and within-axis spread only. Public aggregates remain raw counts
plus assessed-article/outlet denominators and date ranges.

### Tier 5 — rendering and phased exposure

#### Article and evaluation surfaces

Update `ArticleScreen.tsx` first:

- one card per assessed party with label, evidence, confidence, basis and mixed
  note;
- scalar cards explain clean amplification versus explicit advocacy;
- persistent copy: “this evaluates the edited article, not the party or outlet”;
- correction/report action includes party key, field and rubric version.

Update `EvalArticleScreen.tsx` and feedback screens with five ordered party
choices, basis choice and mixed-evidence control. Strong endpoints and mixed
evidence require a written reason.

#### Story comparison

Update `StoryScreen.tsx`, shared spectra/badges and rows:

- five ordered party segments;
- party selector defaults to widest assessed outlet coverage, never most
  negative treatment;
- filters compose with leaning and Russia filters;
- show assessed/mentioned counts and outlet denominator;
- show basis/mixed details only at article-row level, not as a fabricated story
  verdict.

#### Outlet/topic/home surfaces

- Outlet detail: one distribution per party only at 20+ assessed pairs for that
  outlet/party, with date range and explicit non-rating copy.
- Topics: one party distribution at 20+ assessed pairs from at least 5 outlets.
- Home/story cards: at most one compact party comparison signal, only when at
  least two outlets differ; never add a general outlet or party ranking.
- Outlet directory and Saved: no new party-treatment bars.
- Methodology/About: document target, five boundaries, `not_applicable`, mixed
  evidence, sample floors, model accuracy and correction behavior.

Exposure order:

1. schema/scorer/candidate pipeline with public rendering disabled;
2. article detail in preview after model and evidence gates pass;
3. story comparison after aggregate reconciliation;
4. outlet/topic/home signals only after their sample floors are naturally met;
5. promote the exact verified preview release.

## 6. Tests and acceptance

### Contract/data tests

- raw schema, generated schemas and runtime validator agree;
- exact party coverage and canonical identity refusal;
- v1 absence differs from v2 assessed neutral/empty;
- old accepted feedback cannot cross rubric versions;
- candidate promotion rejects stale article/analysis hashes;
- story/topic/outlet counts equal their effective v2 article members;
- basis and mixed flags survive article projection but do not inflate compact
  bundles;
- no old `mixed` label enters v3;
- no unknown/withheld value enters any neutral bucket;
- source and generated prompt assets are in sync.

### UI/accessibility tests

- all five positions, both directions, neutral, absent, withheld and invalid
  values;
- basis and mixed copy;
- article-party subject is always named beside its treatment;
- keyboard/focus behavior and accessible segment names;
- color independence in light/dark modes;
- 390/768/1440 layouts and long Bulgarian party names;
- no copy describes a party or outlet as inherently positive/negative;
- v1 public feedback/evaluation tasks render stale rather than being submitted.

### Required commands

Run in this order:

```bash
python3 news/scripts/build_prompts.py --check
python3 news/scripts/test_analyze_articles.py
python3 news/scripts/test_local_runner.py
npm run news:test
npm --prefix news-functions test
npm run typecheck:news
npm run build:news
npm run news:perf:gate
npm run news:release:gate
```

Also run the frozen v2 model benchmark with hard release gates and the full
candidate/backfill reconciliation. A green app build is not evidence that the
classifier is accurate.

## 7. Performance and bundle budgets

Remeasure before and after:

- model input/output tokens and valid-response rate;
- `home.json`, `stories.json`, topic, outlet and per-article bundle gzip sizes;
- build time and candidate-backfill throughput;
- story/article render cost on mobile.

Basis and evidence stay out of home/story summary bundles unless directly
rendered. Evidence remains in per-article detail. Any budget increase must name
the rendered feature that requires it; do not widen a ceiling merely because
compression currently passes.

## 8. Rollout and rollback

1. Land contract/evaluation support with feature flags off.
2. Create and validate candidate records without touching the live tree.
3. Promote the full candidate set atomically, rebuild, generate v2 bundles and
   write a release manifest.
4. Deploy a Firebase preview with `npm run deploy:news:preview` and audit at
   least one example for every label/basis plus multi-party, no-party,
   unresolved-party and mixed cases.
5. Promote that exact version with `npm run deploy:news:promote`.

Rollback is the previous verified hosting version plus the UI/build feature
flag. Retain v2 source analyses and manifests for diagnosis; do not convert them
back to v1 or patch generated public JSON. If semantic records are wrong, rebuild
the affected source analyses and all derived aggregates before re-enabling.

## 9. Explicit non-goals

- no claim that an outlet “likes” or “hates” a politician from one article;
- no sentiment toward Russian people or culture;
- no economic-left/right score hidden inside the liberal/conservative axis;
- no automatic mapping from v1 `mixed` or `neutral` to v2;
- no outlet leaderboard, net favorability score or cross-party average;
- no topic-taxonomy change in `news/topics.json`;
- no auto-publication before the independent human/model gates pass.

## 10. Definition of done

- The shared five-position rule and boundary fixtures are versioned and
  independently reproducible.
- Every public analysis is v2, evidence-backed and explicit about basis; every
  displayed party has exactly one v3 treatment item.
- The selected model clears each field's frozen release gate, including zero
  unsupported evidence and wrong party links in the audited sample.
- Public corrections and accepted evaluations are rubric-version-safe.
- Story, topic and outlet aggregates reconcile exactly and expose denominators,
  dates and sample floors without a net outlet rating.
- Article, story, evaluation, methodology and eligible aggregate surfaces use
  the same labels and explanations in BG/EN.
- Tests, accessibility, responsive layouts, bundle budgets, candidate hashes,
  release manifest and preview audit pass on the exact version promoted.
