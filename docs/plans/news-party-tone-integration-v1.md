# Наясно Новини — party sentiment integration v1

**Status:** implementation in progress, 2026-08-28.

## 1. Outcome

For every analyzed article that lists a political party as a meaningful entity, publish
one evidence-backed assessment of how that article treats that party:

- `favorable` — the article's own framing is favorable;
- `unfavorable` — the article's own framing is unfavorable;
- `neutral` — the party is covered without a clear favorable or unfavorable frame;
- `mixed` — the article materially contains both favorable and unfavorable framing.

The assessment belongs to the **article-party pair**, never permanently to the party or
the outlet. Story, topic and outlet views may aggregate those pairs only as dated count
distributions with visible denominators. They must not turn them into a net score, a
winner/loser label or a claim about editorial intent.

The feature is complete when the analysis writer, validator, stored records, story and
topic aggregation, public bundles, all relevant screens, evaluation harness, methodology,
correction path and release gates use the same semantics.

## 2. Current-state audit

The repository already has the beginning of the feature, but not an integrated one.

| Layer | Current state | Gap |
| --- | --- | --- |
| Prompt | `news/prompts/analyze_system.md` asks for `party_tones` | Only a short rubric; no evidence or confidence |
| Constrained output | JSON Schema and GBNF allow `{party, tone}` | No stable party identity, provenance or schema version |
| Validation | Checks that `party_tones` is an array and the tone is in the four-value enum | Does not reject duplicates, unknown parties, tones for absent parties or missing tones for displayed parties |
| Analysis records | `party_tones` is stored | Legacy `[]` cannot distinguish “checked and none” from “old analysis did not assess this reliably” |
| Story builder | Merges party entity names | Drops party tones from members and aggregates entirely |
| App-data builder | Copies article `party_tones` | Does not require or normalize it; stories and outlets have no party-tone data |
| TypeScript | Defines `Tone` and `{party, tone}` | Story members and aggregates have no party-tone contract |
| Components | `ToneBadge` exists | It is unused and does not name the party, so it is ambiguous by itself |
| Article UI | Lists party chips | Does not show the assessment, evidence or confidence |
| Story UI | Compares political leaning and Russia stance | Cannot compare treatment of a selected party across sources |
| Outlet/topic UI | Shows the two existing axes | No party-specific distributions or denominators |
| Methodology | Documents only the two axes | Does not explain party treatment, quotations, neutrality, mixed framing or aggregation limits |
| Evaluation | Scores quality, topics, mentions, leaning, Russia stance and AI origin | Does not score party detection or party tone |

Measured on 2026-08-28:

- 365 analysis records exist; 6 list at least one party entity and only 2 contain any
  party-tone assessment.
- The frozen 240-article gold set contains 11 records with party entities, only 6 records
  with party-tone labels, and 5 listed-party records with no corresponding tone.
- Some gold party entities are themselves suspicious false positives or ambiguous names
  (`Дано`, `нова сила`), so merely scoring the six populated rows would manufacture a
  reassuring metric from an inadequate reference subset.

## 3. Semantic contract

### 3.1 What is being judged

Judge the position expressed by the **article as edited**, using headline, narration,
selection and ordering of claims, attribution, contextualization and who gets an answer.
Do not infer a label from outlet reputation, party ideology or whether the reported event
is objectively good or bad for the party.

A hostile quotation does not automatically make the article unfavorable. If the statement
is clearly attributed and the article supplies proportionate context or response, the
article can be neutral. Conversely, repeating an allegation prominently without challenge
can be unfavorable even when every sentence is attributed.

`neutral` means the axis was assessed and no direction is clear. It is not “party absent,”
“not analyzed,” or “low confidence.” `mixed` requires material favorable and unfavorable
framing; it is not an escape hatch for uncertainty. Low-confidence cases retain the best
supported tone and enter review routing.

### 3.2 Coverage invariant

For a publishable (`quality=ok`, `site_relevant=true`) v2 analysis:

1. every unique string in `entities.parties` has exactly one `party_tones` entry;
2. every `party_tones.party` exactly matches one string in `entities.parties`;
3. duplicate party keys are rejected;
4. non-publishable records carry no public party-tone claims;
5. an empty assessed list is valid only when `entities.parties` is also empty.

This makes the party chips shown in the UI the explicit boundary. Incidental words that
look like party names but are not meaningful article entities do not acquire a sentiment
label. If an article should show a party, fixing the missing entity and its tone is one
atomic correction.

### 3.3 Versioned stored shape

Use a new version marker so old empty arrays are not interpreted as audited zeroes:

```json
{
  "party_tones_version": 2,
  "party_tones": [
    {
      "party": "ГЕРБ",
      "party_id": "gerb",
      "tone": "unfavorable",
      "confidence": 0.86,
      "evidence": "Конкретен цитат или проверима конкретна парафраза от материала."
    }
  ]
}
```

The model emits `party`, `tone`, `confidence` and `evidence`. It must not mint
`party_id`. The save step resolves that field deterministically from the production
gazetteer/mentions after raw-output validation, just as review routing is computed after
the analyst returns.

For a uniquely resolved canonical party, `party_id` is required. For a genuinely new,
foreign or ambiguous party, `party_id` is `null`; the assessment remains visible on the
article, but cross-article aggregation uses a normalized name only within that story and
must not merge it into a long-term outlet/topic series. Never guess an election-party ID.

The display string is retained as an article-time snapshot. A later coalition rename must
not rewrite what the article said, while `party_id` provides the stable aggregation key.

### 3.4 Evidence and confidence

- `confidence` is finite and within `[0,1]`.
- `evidence` is non-empty and must be grounded in the stored title/description/body.
- A quote must occur in the article after the same normalization used by the existing
  evidence checker. A concrete paraphrase is allowed only when its named actors and action
  are recoverable from the article; route unverifiable paraphrases to review.
- `mixed` evidence must identify both directions.
- `neutral` evidence must explain the absence of directional framing rather than merely
  repeat that the party appeared.

Add the field to the existing deterministic review router. At minimum, route unresolved
party identity, confidence below the chosen calibration threshold, `mixed`, failed evidence
grounding and disagreement between candidate extraction and model entities to review.

## 4. Pipeline changes

### Phase A — prompt, constrained schema and validation

1. Edit prose in `news/prompts/analyze_system.source.md` and the constrained-output
   generator in `news/scripts/build_prompts.py`, then regenerate
   `news/prompts/analyze_system.md`, `analyze_schema.json` and
   `analyze_schema.gbnf`; never hand-edit a generated artifact.
2. Expand the Bulgarian rubric with the semantics in §3, especially attributed attacks,
   neutral versus absent, and the two-sided requirement for `mixed`.
3. Add `confidence` and `evidence` to each raw party-tone item. Keep `party_id` out of model
   output.
4. Extend `validate_analysis()` in `news/scripts/analyze_articles.py` with the exact
   entity/tone set invariant, uniqueness, confidence, evidence, and non-publishable rules.
5. Resolve and stamp `party_id` after validation. Reuse the gazetteer's contested-surface
   refusal: a name claimed by multiple canonical parties resolves to none.
6. Stamp `party_tones_version=2` only after all checks and deterministic enrichment pass.
7. Make `validate_publishable_analysis()` require a valid v2 block once the rollout flag is
   enabled. Before cutover, legacy records remain readable but explicitly unassessed.
8. Preserve atomic saves: one bad party item rejects the full analysis record rather than
   publishing the other labels with a silently partial party list.

Tests:

- one tone for every party entity, including multiple parties;
- missing, extra and duplicate party entries reject;
- invalid tone/confidence/evidence reject;
- model-supplied `party_id` rejects;
- unique aliases resolve to the right ID and contested aliases remain unresolved;
- neutral and mixed evidence requirements reject degenerate answers;
- legacy absent version differs from v2 empty;
- quality failures cannot leak party claims;
- regenerated JSON Schema and GBNF remain in sync with the source generator.

### Phase B — evaluation before model selection

Do not publish party sentiment merely because the current model emits valid JSON.

1. Preserve the frozen 240-article gold selection and its hash. Re-adjudicate its 11
   party-entity records under the v2 rubric, correcting party-entity false positives and
   filling every valid party assessment. Record these corrections as a new reference
   revision, not an invisible rewrite of the completion audit.
2. Add a deterministic `party_mention` sampling signal to `build_gold_set.py` for the next
   gold version, but do not relabel the existing strata.
3. Build a separate party-tone evaluation supplement of at least 80 articles, spread across
   outlets, dates, single-party/multi-party articles, coalitions, quoted attacks, neutral
   reporting and ambiguous aliases. Iteratively add rare reference tones while reporting
   that this is an intentionally balanced diagnostic set, not corpus prevalence.
4. Have a second adjudicator independently label at least 50 party-article pairs. Report
   inter-annotator agreement and disagreements; the existing self-repeat pass is not a
   substitute.
5. Extend `news/scripts/score_analyses.py` and model benchmark output with separate fields:
   - party-pair detection precision and recall over `(url, party key)`;
   - tone macro-F1 and per-tone precision/recall on matched pairs;
   - confusion table, including declined output;
   - confidence calibration by band;
   - evidence presence/grounding failures;
   - unresolved/canonical identity counts.
6. Keep these results separate. Do not produce one “party sentiment accuracy” or one overall
   model score.

Initial release gates, to be confirmed against adjudicator agreement:

| Gate | Minimum |
| --- | ---: |
| Party-pair precision | 0.95 |
| Party-pair recall | 0.90 |
| Tone macro-F1 | 0.80 |
| Recall for every represented tone | 0.70 |
| Wrong canonical-party links in the audited release sample | 0 |
| Unsupported evidence in the audited release sample | 0 |
| Valid-schema completion | 99% before retry; 100% after retry/review |

Compare the configured production model, local `gemma4:12b`, and selected free/low-cost
OpenRouter models on the same frozen inputs. Record end-to-end latency, tokens, retries,
refusals and cost beside field accuracy. Choose the cheapest/fastest model that clears every
gate; route only low-confidence or review-triggering cases to the stronger fallback. A fast
model that misses a gate is not eligible for this field even if its overall analysis score
looks good.

### Phase C — backfill and ongoing acquisition

1. Produce a dry-run inventory over all analyzed records:
   - v2 assessed with parties;
   - v2 assessed with none;
   - legacy with candidate party mentions;
   - legacy with party entities;
   - unresolved/contested party names;
   - existing tones that would change under v2.
2. Re-run **all currently analyzed articles**, not only the six already listing parties.
   Existing entity extraction may itself have missed a party, and old `[]` values cannot be
   trusted as assessed absence.
3. Use checkpointed batches, deterministic input manifests and idempotent writes. Keep the
   pre-backfill records recoverable and emit changed-field diffs for review.
4. Require manual review for every unresolved identity, changed non-empty legacy tone,
   `mixed` result and low-confidence result during the first backfill.
5. Recompute every affected story only after its member records are committed. Then rebuild
   public bundles from source records; never patch generated app JSON by hand.
6. Add v2 party-tone coverage and review counts to the analyzer run summary and operational
   stats. A successful nightly run with falling coverage must fail its quality gate rather
   than silently publish fewer assessments.

Cutover requires 100% of currently public analyzed articles to be either v2-assessed or
explicitly withheld with a recorded review reason. The UI must never treat a legacy empty
array as “neutral” or “no parties.”

## 5. Story, topic and outlet aggregation

### 5.1 Story members and story distribution

Add a compact form to each story member:

```ts
type PartyToneCompact = {
  party: string;
  party_id: string | null;
  tone: Tone;
};
```

Evidence and confidence stay on the article detail bundle, avoiding duplication in
`stories.json`. Add a story-level array:

```ts
type PartyToneAggregate = {
  party: string;
  party_id: string | null;
  mentioned_articles: number;
  assessed_articles: number;
  outlet_count: number;
  by_tone: Partial<Record<Tone, number>>;
};
```

Group by `party_id` when present. For unresolved identities, group only within the story by
a conservative normalized exact name. Keep `mentioned_articles` and `assessed_articles`
separate throughout migration; unknown is not neutral and must not enter `by_tone`.

Update both story writers: `recompute_story()` in `analyze_articles.py` and the defensive
normalization in `build_app_data.py`. Add a full empty shape for old story files so stale
artifacts cannot white-screen the app.

### 5.2 Topic aggregates

Extend topic data with per-party tone count distributions, keyed by canonical `party_id`,
plus assessed article/outlet denominators and the data date range. Exclude unresolved party
names from cross-story topic totals. Do not pre-divide into percentages.

Only expose a topic-party distribution when it has at least 20 assessed article-party pairs
from at least 5 outlets. The raw counts can remain in diagnostics, but a tiny public bar is a
claim with false visual precision.

### 5.3 Outlet aggregates

Add per-party count distributions to the outlet bundle with:

- party ID and display label;
- four tone counts;
- assessed article count;
- first and last publication date represented.

Show a distribution only at 20+ assessed article-party pairs for that outlet and party.
Never rank outlets by favorable/unfavorable share, compute a “bias score,” or collapse all
parties together. The unit is “how this outlet's analyzed articles treated Party X during
this period,” not “Outlet X is pro/anti Party X.”

### 5.4 Bundle projections and budgets

Do not let the full story party matrix ride into `home.json` accidentally through the
existing whole-`aggregates` projection. Give home stories one optional compact signal:

```ts
party_tone_signal?: {
  party: string;
  party_id: string | null;
  assessed_articles: number;
  by_tone: Partial<Record<Tone, number>>;
};
```

Select it only when one party has at least two assessed articles from two outlets and either
more than one tone bucket or party tone is the strongest available comparison signal.
Remeasure the 33 KiB `home.json` gzip budget, the 220 KiB feed budget, `stories.json`, topic
bundles and per-domain bundles. Any budget increase must be explicit and justified by the
rendered feature, not accepted because compression happened to hide it.

## 6. UI integration

### 6.1 Shared components and language

Replace the unused bare `ToneBadge` with components that always include the subject, for
example `ГЕРБ: негативно отношение`. Color is secondary to text; favorable/unfavorable
must not be conveyed only through green/red. Support keyboard focus, screen-reader labels,
light/dark themes and narrow layouts.

Use “отношение на материала към …” in headings. Avoid the more psychological “sentiment”
in Bulgarian public copy and avoid “positive/negative party,” which can be misread as an
evaluation of the party itself.

### 6.2 Article page

Add a section directly below the two article axes and above AI/quality details:

- one card per party entity;
- party name/link, tone label, confidence and evidence;
- a short line: “Оценява се този материал, не партията и не медията”;
- a contextual “Сигнализирай проблем” action identifying the party assessment.

If the record is v2 and has no party, render nothing. If it is legacy/unassessed, do not show
a neutral placeholder. During staging only, an operator diagnostic may say the party layer
is pending; production cutover removes that state through the complete backfill.

### 6.3 Story page

Add a third comparison block, structurally different from the two scalar axes:

1. party selector chips, with the number of assessed members;
2. a four-segment tone distribution for the selected party;
3. click-to-filter by tone, composed with the existing leaning and Russia filters;
4. source rows show the selected party and tone; without a selection they show at most two
   compact party-tone chips and `+N` for the rest;
5. denominator copy states assessed articles and outlets, plus any mentioned-but-unassessed
   legacy members during preview.

Default to the party with the broadest assessed outlet coverage, not the most negative tone.
Do not display a majority verdict such as “the story is negative toward GERB.” The useful
finding is the source distribution.

### 6.4 Home and article-list surfaces

- Multi-outlet `StoryCard`: allow one party-tone comparison signal to compete with the
  existing political/Russia signals under the explicit selection rule in §5.4.
- Single-article `ArticleCard`: show at most one named party-tone badge and `+N`; keep the
  article-level disclaimer in the badge title/accessible label.
- `ArticleRow` on outlet pages: same compact rule. `StoryMemberRow` uses the selected party
  context on the story page.
- Search/filter matching should include displayed party names, but tone words must not alter
  free-text ranking.

### 6.5 Outlet pages and outlet directory

Add an “Отношение към партии в анализираните материали” section to the individual outlet
page, gated by the per-party floor in §5.3. Each row shows counts, date range and denominator.
Copy explicitly says this is a distribution of articles, not an outlet rating.

Do not put party-tone bars on every card in the outlet directory. Without first selecting a
party they are not comparable, and collapsing parties would be invalid. The directory needs
no new claim; the outlet detail page is the correct surface.

### 6.6 Topics, Saved, methodology and corrections

- Topics: add “отношение към партия” as a distinct analysis mode with a party selector. It
  uses the topic/party floors and never treats tones as an ordinal left-right axis.
- Saved: retain title-only rows. It is a bookmark index, not an analysis surface; no tone
  data needs duplication there.
- Methodology: add a complete party-treatment section covering §3, sample floors, unknown
  versus neutral, model/evidence limitations, gold metrics and correction behavior.
- Corrections/reporting: allow a correction entry to identify `party_tone`, party key,
  previous value, new value, evidence and corrected-at timestamp. Article/story links must
  remain stable after correction and regenerated aggregates must reflect it.
- About/navigation: no new top-level route is needed for v1. Party tone is a dimension of
  articles, stories, topics and outlet profiles, not a standalone leaderboard.

## 7. Testing and acceptance gates

### Data and contract tests

- raw schema, GBNF and runtime validator accept/reject the same shapes;
- exact entity/tone coverage invariant and canonical resolution;
- legacy versus assessed-empty semantics;
- deterministic story aggregates with multiple parties, multiple articles from one outlet,
  unresolved names and corrected analyses;
- topic/outlet thresholds and date ranges;
- app-data builder never publishes evidence from the wrong article;
- home projection includes at most one compact signal;
- generated JSON satisfies TypeScript contracts and old defensive defaults do not crash.

### UI tests

- article party cards render label, evidence, confidence and disclaimer;
- neutral, mixed, absent, unassessed and invalid-label behavior;
- story party selection and combined filters update rows/counts correctly;
- compact `+N` behavior at mobile width;
- outlet and topic thresholds suppress small samples;
- no component describes an outlet or party as inherently favorable/unfavorable;
- keyboard, focus, accessible names, color independence, light/dark contrast and 390/768/1440
  layouts;
- correction links contain only public, non-sensitive context.

### Release checks

Run, in order:

```bash
npm run news:test
npm run typecheck:news
npm run build:news
npm run news:perf:gate
npm run news:release:gate
```

Also require:

- all model gates in §4B pass on frozen inputs;
- all public analyzed records satisfy v2 or are explicitly withheld;
- story/member/topic/outlet aggregate reconciliation is exact;
- bundle budgets pass with recorded before/after sizes;
- a staging audit covers at least one neutral, favorable, unfavorable, mixed, multi-party,
  unresolved-party and no-party article, plus a multi-outlet story and a thresholded outlet;
- a moderated comprehension check confirms readers understand “article treatment,” do not
  generalize it to the outlet, and can find the evidence. Any false-belief finding is a
  release blocker.

## 8. Rollout and rollback

1. Ship schema/validator/scorer changes with public rendering disabled.
2. Run the dedicated evaluation and select the eligible model/fallback route.
3. Backfill into versioned records, review diffs, rebuild stories and app bundles.
4. Enable article UI in the preview channel; reconcile every displayed assessment to source
   JSON and evidence.
5. Enable story, topic, outlet and compact-card surfaces; run accessibility, layout and
   bundle gates.
6. Deploy a Firebase preview with `npm run deploy:news:preview`, record the version and audit
   it, then promote that exact verified version with `npm run deploy:news:promote`.

Rollback is a UI/build flag that hides party-tone surfaces and returns to the previous
verified hosting version. Do not delete v2 source analyses on rollback; retain them for
diagnosis. If the defect is semantic or identity-related, rebuild affected records and all
derived aggregates before re-enabling rather than patching public JSON.

## 9. Definition of done

- One v2 evidence-backed tone exists for every displayed party in every public analyzed
  article, with honest legacy/unknown semantics.
- Stable party IDs are deterministic; ambiguous identities are never guessed.
- The dedicated gold evaluation clears per-field accuracy, evidence and identity gates.
- Story, topic and outlet totals reconcile exactly to article-party pairs and always show
  their denominators.
- Article, story, home/list, outlet, topic, methodology and correction surfaces implement
  the behaviors above; Saved and the outlet directory have documented intentional
  exclusions.
- No UI turns article treatment into a permanent party/outlet rating or a single net score.
- Tests, accessibility, responsive layouts, bundle budgets, release manifest and staging
  audit pass on the exact version promoted to production.
