# Наясно Новини — editorial-treatment rubric v2

**Status:** proposed implementation plan, 2026-09-01. No implementation has
started.

**Revised:** 2026-09-01, after an implementation audit against the shipped
code and the corpus on disk. §2.1 lists what the audit changed and which tier
now owns each item; every figure below was re-measured rather than restated.

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
- party treatment: 307 article–party pairs over all 1,833 records — 250
  `neutral` (81.4%), 38 `unfavorable`, 14 `favorable`, 5 `mixed`;
- political framing, **over the 1,687 `ok` records**: 510 `neutral`, 85
  directional and 1,092 `not_applicable` (over all 1,833 the `not_applicable`
  count is 1,238);
- Russia, same denominator: 27 `neutral`, 153 directional, 1,507
  `not_applicable` (1,653 over all 1,833).

⚠️ The two analysis denominators differ and must be stated wherever these are
quoted. The corpus count comes from the canonical
`python3 news/scripts/analyze_articles.py --stats` command; the remaining
figures were re-derived from `news/data/analysis/articles/` on 2026-09-01.

The current party evidence repeatedly says that a central party statement was
published unchallenged and therefore classified as neutral. Under this plan that
is usually mild favorable treatment: the party received a clean microphone. The
same boundary change applies to unchallenged Russian-state premises and to
recognizably liberal/progressive or conservative propositions.

The neutral bucket visibly contains evidence that describes unchallenged
relaying — „предадено дословно и атрибуирано", „без редакционна оценка",
„без противотежест" — but the size of that subgroup is not yet reproducible
from a checked-in query. Tier 0 must save the exact query and hash-bound result
set before quoting a count. It is a review stratum, never a prior for how many
items must become favorable: centrality and material challenge still require
article-level adjudication.

Therefore:

- adding `strong_*` only to party tones is insufficient;
- silently changing the prompt while retaining old records would mix two
  meanings in every story/outlet/topic aggregate;
- existing accepted evaluations cannot override v2 records unless they were
  made against the v2 rubric;
- the frozen v1 gold and benchmark reports remain historical and are not edited
  in place.

### 2.1 What the 2026-09-01 audit changed

Six findings are **blocking** — the plan as first written could pass every
gate it names and still publish nothing, or ship a silent inversion. Each is
folded into the tier that owns it; this list exists so none is lost.

**B1 — the evidence gate rejects 98.7% of party tones, and it is also the
release gate.** Measured over the corpus: `evidence_grounded` is `true` on
**4 of 307** pairs, `false` on 300, absent on 3 — and all four survivors are
`neutral`. So `build_app_data.py` publishes essentially no party treatment
today, and `score_analyses.py`'s `unsupported_evidence: 0` release gate calls
the **same** `party_tone_evidence_grounded()`, which is why the 2026-08-29
benchmark records every model as failing it. The cause is a contradiction
between two shipped rules: `analyze_system.source.md` asks for „дословен цитат
**или конкретна перифраза**", and gate v1 requires a normalized **contiguous
substring** of the article. v2 makes this strictly worse — it asks evidence to
name a basis and, when mixed, both directions, i.e. more paraphrase. Fix
(Tier 1): split the field. `evidence_quotes` is a bounded list of verbatim
spans and is what the gate checks; `evidence` is the analytical reason and is
not substring-checked. Nothing downstream of Tier 1 is meaningful until this
lands.

**B2 — the new strong party labels silently bypass always-review.** Party
items already have their own per-item route in `record_review`, including
identity, confidence, mixed and evidence checks. The defect is narrower:
`review_routing.ALWAYS_REVIEW` derives strong labels from
`LEANING_LABELS | RUSSIA_LABELS` only. Adding
`strong_favorable`/`strong_unfavorable` to `TONE_LABELS` would therefore send
them through the ordinary 0.75 confidence floor rather than always-review.
Tier 1 fixes that derivation without moving the party collection into the
scalar `ROUTED_FIELDS` tuple.

**B3 — the label vocabularies are hand-copied in seven places with no parity
gate.** `analyze_articles.py` (the generator's source of truth),
`effective_analysis.py`, `score_analyses.py`, `news/eval_contract/contract.json`
plus its JSON Schemas, the `news-functions/src/eval-contract/` copy,
`newsapp/app/data.ts` + `labels.ts`, and `newsapp/app/evals.ts`.
`effective_analysis.PARTY_TONES` **raises** on an unknown tone — but only on
the accepted-adjudication path, and `human_review` is `None` on all 1,833
records, so a stale copy stays invisible until the first post-cutover
adjudication. Tier 1 adds the parity gate.

**B4 — leaning `not_applicable` had two incompatible definitions.** The
shipped prompt is explicit that the leaning test is the **topic, not the
tone**, and
`review_routing.political_not_applicable` flags political-topic +
`not_applicable` as a rubric error. §3.5's narrowing is a **proposition**
test, which would legitimise that exact combination — mass false-positive
review routing, or a spectrum denominator that shrinks with nothing failing.
§3.5 now decides: the topic test is retained for leaning. Russia keeps its
own applicability rule: Russia absent from the material issue is
`not_applicable`, including in an otherwise political article.

**B5 — three version namespaces, two of them called „rubric".** The contract
already ships `rubric_version: "news-article-evaluation-v1"` (a string, in
`contract.json`, `effective_analysis.py` and every synced eval task) alongside
the integer `party_tones_version`. The plan's `analysis_rubric_version: 2` was
a third. §4 now reconciles them.

**B6 — the abstract table must not be wired into `AXIS_POSITIONS`.**
`build_app_data.AXIS_POSITIONS` maps `progressive = -1` and `pro_russia = -1`;
§3.1's abstract table maps `-2…+2` as hostile→favorable. Implementing the
table as a re-mapping reverses every spectrum bar's semantic poles. It does
not change standard-deviation spread or symmetric weighted kappa, which is why
those metrics cannot catch the inversion. §3.1 now freezes the existing sign
convention.

Six further findings are **feasibility** rather than correctness, and each is
recorded where it binds: party identity is the real constraint, not tone (§3.3,
44.6% of pairs carry no `party_id`); foreign parties are unscoped (§3.3);
Tier 5's outlet floor is currently unreachable (0 of 194 cells); endpoint
sample sizes cannot support the stated reference counts (Tier 2); Tier 0's
two-adjudicator gate has no named second adjudicator; and two existing gate
values were missing from the release table (Tier 2).

Smaller items, folded in place rather than listed twice: the contract's
`reason_codes` registry has no way to record a v2 disagreement (Tier 1);
`--candidates` is already taken in `analyze_articles.py` and means something
else (Tier 3); `src/ux/MixBar` belongs to the elections app, not the news app
(Tier 5); the backfill cost estimate excluded retries (Tier 3); 365 records
already carry no `party_tones_version` and no record anywhere carries an
accepted `human_review`, which makes this the cheapest moment to cut over
(§4); and ten source files that touch these vocabularies were missing from the
tier file lists.

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

⚠️⚠️ **IT IS ALSO NOT A RE-MAPPING INSTRUCTION FOR `AXIS_POSITIONS`, AND
READING IT AS ONE INVERTS EVERY PUBLISHED SPECTRUM BAR.**
`build_app_data.AXIS_POSITIONS` already assigns `progressive = -1`,
`strong_progressive = -2`, `pro_russia = -1`, `strong_pro_russia = -2`. On the
two scalar axes the sign is a **direction**, not a valence: `-1` there means
„toward the progressive pole" / „toward the Russian-state premise", NOT
„unfavorable". Only party tone is a valence, and it is the one axis
`AXIS_POSITIONS` does not yet carry. So:

- the existing `leaning` and `russia_stance` sign convention is **frozen** —
  v2 changes their meaning, never their ordering or their sign;
- v2 ADDS a third entry, `party_tone`, whose signs follow §3.1's table
  (`strong_unfavorable = -2 … strong_favorable = +2`);
- a review of any diff touching `AXIS_POSITIONS` must check the sign, because
  a flip is invisible to `weighted_kappa` (symmetric in the two labels) and
  to standard-deviation spread; it shows up in the rendered pole ordering and
  any signed mean/direction consumer.

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
8. **Applicability is axis-specific.** On the leaning axis, applicability is
   decided by the political TOPIC and direction by the treatment: a political
   article with no ideological direction is `neutral`. On the Russia axis,
   Russia must be materially involved: an otherwise political article that
   never touches Russia is `not_applicable`, while balanced treatment of a
   Russia-related issue is `neutral`. Party absence is represented by no item.
   `not_applicable` is excluded from scalar spectrum bars, so each axis's rule
   must be validated independently rather than shared through one shortcut.

### 3.3 Party treatment

Every unique party in `entities.parties` on a publishable article has exactly
one party-treatment item; every treatment item refers to exactly one displayed
party. Party absence is represented by no item, never by neutral. **That
coverage rule is already enforced** by `validate_analysis` and is restated here
as a property v2 must not lose, not as new work.

⚠️⚠️ **THE BINDING CONSTRAINT ON THIS AXIS IS IDENTITY, NOT TONE, AND v2 MAKES
IT WORSE BEFORE IT MAKES IT BETTER.** Measured 2026-09-01: **137 of 307 pairs
(44.6%) carry no stored `party_id`**. The current surface-only
`party_id_for_name` can resolve only 2 of those 137 as the gazetteer stands;
one is a stale `ГЕРБ` record, while the rest include Възраждане (15 pairs),
БСП (10), ПП (7), ДПС (6), ИТН and СДС.

Some missing surfaces are abbreviations; others are deliberately ambiguous,
common words or historically different entities. `ПП`, `ДБ`, `ПП-ДБ`,
`Демократична България` and `Да, България` may refer to a party, component
party, coalition or a later consolidation. Treating them as one party is a
product aggregation policy, not a spelling correction. A surface-only alias
pass would trade missing IDs for wrong canonical links — the release gate's
highest-consequence failure. Three consequences the plan takes as decisions:

- **No party-keyed AGGREGATE may be published for a pair without an exact,
  reviewed `party_id`.** Unresolved pairs still render on the ARTICLE under
  the surface the outlet used. They are counted and reported as unresolved —
  never folded into a distribution and never silently omitted from its
  denominator note.
- **Resolution is a Tier 0 exit condition, not Tier 5 cleanup.** Resolution
  uses article-context party mentions, document-level coreference, country and
  publication date before the context-free `party_id_for_name` fallback. The
  existing refusal rules for common or ambiguous surfaces remain intact.
- **Exact identity and aggregation family stay separate.** `party_id` names
  the party or coalition actually referenced. If the product later groups
  component parties and coalitions, it uses a separately versioned,
  date-bounded `party_aggregate_id`; it never overwrites exact identity or
  silently treats every related surface as interchangeable.

**Foreign parties are in the corpus and were unscoped.** Of the 137 unresolved
pairs, roughly 55 are non-Bulgarian — AfD / „Алтернатива за Германия" (13),
ХДС/ХСС (9), „Непокорна Франция" (4), Единна Русия, СДСМ, ВМРО-ДПМНЕ,
Лейбъристката партия, FPÖ, ANO, MAS. §1's „every meaningfully covered
political party" is therefore narrowed: **the public aggregate party-treatment
surface is Bulgarian parties and coalitions only.** A foreign party still gets
a stored and article-level treatment item, but it is excluded from published
party distributions and the aggregate selector. Country/scope is explicit
metadata, not inferred from a null `party_id`: unresolved Bulgarian and known
foreign are different states.

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

⚠️ **THE NARROWING LANDS ON `neutral`, NEVER ON `not_applicable` — this is the
B4 decision and it is the one thing in §3.5 that is easy to get backwards.** A
political article carrying no ideological proposition is `neutral`: the axis
applies, and the answer is „no direction". `not_applicable` keeps its shipped
meaning — the subject has no political dimension at all (a weather forecast, a
football result). Three reasons the decision goes this way:

- the shipped prompt already says so in as many words („тестът е ТЕМАТА, не
  тонът"), and a prompt change is not retroactive over 1,833 records;
- `review_routing.political_not_applicable` flags political-topic +
  `not_applicable` as a rubric error. Legitimising that pairing would either
  flood the review queue or force the heuristic's removal, and the heuristic
  is the only thing that makes those records actionable;
- `not_applicable` is excluded from the spectrum bar. Routing „no ideological
  proposition" there deletes the article from its story's distribution — so
  the narrowing would shrink the denominator of the very surface it is meant
  to make more honest, invisibly, at a 200.

Expected consequence, stated so it is not read as a regression: the narrowing
should move articles from the directional labels **into `neutral`**, leaving
`not_applicable` roughly where it is. A cutover in which `not_applicable`
grows materially on the framing axis means the rule was implemented as a
proposition test after all.

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
is routed to review during the initial rollout. A scalar `not_applicable`
always has `treatment_basis=not_applicable` and `mixed_evidence=false`. A party
item exists only for meaningful coverage and therefore may never use the
`not_applicable` basis.

### 3.7 Evidence is two fields, not one (B1)

Every v2 scalar judgment and party item carries **both**:

```text
evidence_quotes  a bounded list of VERBATIM spans from this article
evidence         the analytical reason, in the analyst's own words
```

The deterministic gate checks each entry in `evidence_quotes` and nothing
else. `evidence` is never substring-matched — asking a model to justify a
basis, and to name both directions when mixed, is asking for paraphrase, and
paraphrase cannot survive a contiguous-substring test. Merging them back into
one field re-creates B1 exactly: measured on the shipped single field, **4 of
307 pairs pass and all four are `neutral`**, so the site publishes only the
label it least needs a model for, and no model can ever clear the
`unsupported_evidence: 0` release gate, which calls the same function.

Four rules make the split safe rather than a loophole:

1. A directional label with `mixed_evidence=false` requires exactly **one**
   quote. A directional claim with no quotable span is not gradeable and
   routes to review rather than publishing.
2. `neutral + mixed_evidence=false` and `not_applicable` require an empty
   list. Their analytical reason still explains procedural balance or why the
   axis is absent; an invented token such as `null` is not a quote.
3. `mixed_evidence=true` requires exactly **two** quotes, one per direction,
   whether the net label is neutral or directional. The validator grounds
   each list entry separately; it never concatenates non-adjacent spans and
   asks one contiguity check to approve them.
4. Each quote is bounded in length, non-empty after normalization and unique
   within the judgment. The gate keeps its current normalization and
   contiguity requirement. Loosening it to token overlap would lose the
   negation safety its header warns about („получи" versus „не получи").

**The general analysis evidence gate version is 2** so no v1 party approval
or unvalidated scalar claim is grandfathered. V2 records stamp
`analysis_evidence_gate_version=2`; each scalar block and party item carries a
computed `evidence_grounded` decision. The current
`party_tone_evidence_gate_version=1` remains a legacy field only. Public
projection trusts a saved decision only when the general gate version matches;
otherwise it rechecks or withholds. The same gate covers the two scalar blocks
and party items, because a `strong_pro_russia` without a grounded span is as
material as a strong party claim.

## 4. Versioned stored contract

The model still emits only qualitative fields. The save step validates,
enriches party identity and then stamps versions:

```json
{
  "analysis_rubric_version": 2,
  "analysis_evidence_gate_version": 2,
  "leaning": {
    "label": "progressive",
    "confidence": 0.84,
    "evidence_quotes": ["..."],
    "evidence": "...",
    "treatment_basis": "clean_amplification",
    "mixed_evidence": false,
    "evidence_grounded": true
  },
  "russia_stance": {
    "label": "not_applicable",
    "confidence": 1,
    "evidence_quotes": [],
    "evidence": "Russia is not materially involved.",
    "treatment_basis": "not_applicable",
    "mixed_evidence": false,
    "evidence_grounded": true
  },
  "party_tones_version": 3,
  "party_tones": [
    {
      "party": "ГЕРБ",
      "party_id": "gerb",
      "party_country_code": "BG",
      "party_identity_status": "exact",
      "party_aggregate_id": "gerb",
      "party_identity_version": 2,
      "tone": "favorable",
      "confidence": 0.82,
      "evidence_quotes": ["..."],
      "evidence": "...",
      "treatment_basis": "clean_amplification",
      "mixed_evidence": false,
      "evidence_grounded": true
    }
  ]
}
```

`analysis_rubric_version`, `party_tones_version`, identity fields
(`party_id`, country/status, optional aggregate id and identity version),
evidence-gate versions, `evidence_grounded`, review metadata and hashes are
computed fields. Model-supplied copies are rejected. Unknown country and
unresolved Bulgarian identity remain explicit null/status combinations rather
than being inferred from one another.

**Three version fields, and two of them were already called „rubric" (B5).**
The repo ships `rubric_version` as a STRING
(`"news-article-evaluation-v1"`, declared in `news/eval_contract/contract.json`,
restated in `effective_analysis.RUBRIC_VERSION`, and stamped on every task in
`news/data/evals/tasks/current.json`), alongside the INTEGER
`party_tones_version`. Adding an integer `analysis_rubric_version` beside a
string `rubric_version` is two things with one name and different types. The
contract:

| field | type | scope | v1 → v2 |
| --- | --- | --- | --- |
| `rubric_version` | string | the EVALUATION contract — tasks, submissions, accepted adjudications | `news-article-evaluation-v1` → `news-article-editorial-treatment-v2` |
| `analysis_rubric_version` | int | the stored ANALYSIS record's semantics | absent → `2` |
| `party_tones_version` | int | the party-item SHAPE within that record | `2` → `3` |
| `analysis_evidence_gate_version` | int | deterministic grounding rules for all public judgment blocks | absent → `2` |
| `party_identity_version` | int | exact/country/aggregate identity mapping on each party item | absent → `2` |

They are not interchangeable and do not all move for the same reason: an
evaluation transport/schema change may bump `rubric_version` without changing
analysis semantics, while a party-item shape change may bump only
`party_tones_version`. The consistency contract is therefore record/task
specific, not a global `iff` between unrelated constants:

- every v2 analysis has `analysis_rubric_version=2`,
  `party_tones_version=3` and `analysis_evidence_gate_version=2`; each party
  item has `party_identity_version=2`;
- every evaluation task/submission states both its own `rubric_version` and
  the `analysis_rubric_version` it targets;
- applying an adjudication requires the task's target analysis version to
  equal the stored record's version, regardless of whether the evaluation
  transport version later changes.

Without these checks a v2 analysis can be graded against a v1 task and neither
side reports a mismatch.

⚠️ `effective_analysis.RUBRIC_VERSION` is a hand-copied duplicate of the
contract's value and is checked with `!=` in two places. It is inside the B3
parity gate for that reason.

Legacy records remain readable for rollback and historical comparison but are
**unassessed under v2**. They never enter v2 aggregates. A public v2 build fails
if a displayed analysis is legacy; unknown is never projected as neutral.

Two measurements make the cutover cheaper than it reads, and both are
time-limited:

- **365 of the 1,833 records already carry no `party_tones_version` at all**,
  so a fifth of the corpus is legacy under this plan's own rule before v2
  starts. The backfill is not „break 1,833 good records"; it is „bring 1,468
  forward and finish 365 that were never stamped".
- **`human_review` is `None` on all 1,833 records** — there is not one
  accepted adjudication anywhere. Every cross-version override hazard in this
  plan (§Tier 2, §Tier 4, §6) is therefore currently **vacuous**, and the
  version-safety machinery is being built before it is needed rather than
  after. That is the right order and it is also the cheapest moment: the first
  accepted v1 adjudication is the point at which this stops being free.

## 5. Implementation sequence

The dependency is strict:

```text
party-id resolution + rubric fixtures (split-evidence shape)
      → prompt/schema/validator + evidence split + vocabulary parity gate
      → human reference + scorer → eligible model → candidate backfill
      → atomic promotion → public article UI → aggregate surfaces
```

No later phase starts merely because an earlier schema compiles.

Two audit items move the front of this chain and neither is optional:
**the evidence split (B1)** must land before any model is measured, because
the release gate it feeds is currently unpassable by construction; and
**party-id resolution (§3.3)** must land before the backfill, because a
re-read that produces unresolved records has to be paid for twice.

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
the expected label/basis/mixed flag, expected evidence-quote cardinality and a
one-sentence reason. Do not use copyrighted full article bodies in tracked
fixtures.

Add a dated baseline report with the counts in §2, prompt/schema hashes and a
manifest of the existing 1,833 analysis records. This report is evidence for the
cutover, not a ratchet requiring the new distribution to look different.

The baseline also creates a reproducible **candidate review stratum** for
neutral evidence that appears to describe clean amplification. The checked-in
query, article/pair hashes and manual adjudications travel together. Its
transition matrix is reported after the pilot, but no expected movement is
declared: an incidental mention can use the same „without editorial comment"
language and remain neutral under §3.2's centrality rule. The purpose is to
detect a prompt that did not change behaviour without pressuring reviewers to
manufacture a target distribution.

**Two exit conditions belong to Tier 0 that are easy to defer and expensive to
defer:**

- **Contextual party resolution (§3.3).** 44.6% of pairs carry no stored
  `party_id`, including Възраждане, БСП, ПП, ДПС and related
  ДБ/ПП-ДБ/Да България surfaces. Add country/date metadata and run the existing
  document-level mention/coreference evidence before the context-free
  fallback. Review every proposed new Bulgarian mapping before the backfill.
  Target: zero wrong links; every remaining unresolved Bulgarian surface is
  named with a refusal reason. Foreign parties are marked foreign, not merely
  left null.
- **The `evidence_quotes` split (§3.7).** It is a Tier 1 code change, but the
  Tier 0 fixtures must be written against the SPLIT shape. Fixtures written
  with one evidence field would need rewriting, and a rubric fixture set is
  the one artifact this plan says must not be edited in place.

⚠️ **The adjudication gate below needs two humans and this is a solo
project — decide the fallback now rather than stalling on it.** Acceptable, in
descending order of strength: (a) a second human adjudicator, which is what
the gate assumes; (b) one adjudicator labelling twice, blinded, with the two
passes separated by at least a week and the fixture order reshuffled — this
measures rubric stability rather than inter-rater agreement, and must be
reported under that name; (c) a model as second annotator, which is **not**
independent (it shares the rubric text with the system under test) and may be
used only as a triage signal that surfaces disagreements for a human, never as
a κ denominator. Whichever is used is named in the baseline report. What is
not acceptable is skipping the gate: if the boundaries cannot be applied
consistently by their author, no model result downstream means anything.

**Gate:** two adjudicators independently classify at least 50 real judgments
(or the named fallback above). Ordinal weighted kappa must reach 0.80 on each
scalar axis and party tone. If humans cannot clear it, revise the rubric before
asking models to.

### Tier 1 — prompt, generated schemas and runtime validation

Source changes:

- `.agents/skills/analyze-news-article/SKILL.md` — canonical agent rubric;
- `news/prompts/analyze_system.source.md` — standalone-model rubric;
- `news/scripts/analyze_articles.py` — label constants, version constants,
  raw validation, party enrichment, evidence/review routing, stats and rebuild;
- `news/scripts/build_prompts.py` — JSON Schema and GBNF generation;
- `news/scripts/analyze_local.py` — provenance and candidate-output support;
- `news/scripts/build_gazetteer.py`, `resolve_mentions.py` and their tests —
  contextual/country/date-aware party resolution without weakening ambiguity
  refusals;
- `news/scripts/review_routing.py` — **B2**: retain the existing party-item
  loop and make `_strong_labels()` union `aa.TONE_LABELS` so the two new party
  endpoints reach `ALWAYS_REVIEW` by derivation rather than by a literal;
- `news/scripts/effective_analysis.py` — `LEANING` / `RUSSIA` /
  `PARTY_TONES` / `RUSSIA_VERSION`-style copies and `RUBRIC_VERSION`;
- `news/eval_contract/contract.json` + its JSON Schemas, and the synced
  `news-functions/src/eval-contract/` copy
  (`news-functions/scripts/sync-eval-contract.mjs` regenerates it — do not
  hand-edit the copy);
- `news/scripts/sync_eval_tasks.py` and `news/scripts/build_feedback_tasks.py`
  — both stamp `rubric_version` and target `analysis_rubric_version` onto live
  task files;
- `news/scripts/backfill_singleton_stories.py`,
  `news/scripts/benchmark_news_models.py` — both read `party_tones`.

Regenerate, never hand-edit:

- `news/prompts/analyze_system.md`;
- `news/prompts/analyze_schema.json`;
- `news/prompts/analyze_schema.gbnf`.

Validation requirements:

- exact party-entity coverage and no duplicate party keys;
- computed party identity uses exact/context-reviewed ID, ISO country code,
  explicit status and identity version; aggregate ID is nullable and can only
  come from the versioned date-bounded mapping;
- new five-value party enum; old `mixed` rejects under v3;
- basis enum and boolean mixed flag on both scalar blocks and every party item;
  `not_applicable` basis is valid only on an identically labelled scalar block,
  never on a party item;
- confidence finite and in `[0,1]`;
- `evidence` non-empty; `evidence_quotes` has cardinality 0, 1 or 2 exactly as
  §3.7 defines, and every entry is grounded independently. The gate runs on
  the QUOTES, never on `evidence`, and covers scalar blocks and party items;
- v2 stamps `ANALYSIS_EVIDENCE_GATE_VERSION = 2`; the existing
  `PARTY_TONE_EVIDENCE_GATE_VERSION = 1` remains legacy-only, so no old party
  approval or unchecked scalar claim is grandfathered through
  `build_app_data.py`;
- strong labels with weak/ungrounded evidence route to review;
- all `mixed_evidence=true` items route to review initially;
- **the vocabulary parity gate (B3)**: one test asserts that
  `analyze_articles.{LEANING,RUSSIA,TONE}_LABELS`,
  `effective_analysis.{LEANING,RUSSIA,PARTY_TONES}`,
  `score_analyses.PARTY_TONES`, `eval_contract/contract.json.vocabularies`,
  the generated JSON Schema and GBNF enums, the synced
  `news-functions/src/eval-contract/contract.json`, and the TypeScript
  `Tone`/`Leaning`/`RussiaStance` unions plus `TONE_META` and
  `EVAL_TONE_VALUES` all name the same sets. Today they are seven hand-copies
  with no gate, and `effective_analysis` — the one that RAISES on a mismatch —
  is on a code path with zero records, so a stale copy is invisible until the
  first post-cutover adjudication;
- record/task version combinations obey §4's compatibility rules;
- leaning and Russia applicability are validated independently: a political
  article may be Russia `not_applicable`, but not leaning `not_applicable` when
  its primary topic is inherently political;
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
- a mutation case for B2 specifically: delete `aa.TONE_LABELS` from
  `_strong_labels()`'s union and assert a `strong_favorable` item stops being
  routed. Without it the fix is satisfied by an implementation that lists the
  labels rather than deriving them, which is the state that produced the
  defect;
- a mutation case for B1: assert that realistic PARAPHRASED `evidence` with a
  valid one-item `evidence_quotes` list passes, removal fails, and a mixed item
  with two non-adjacent quotes passes because each span is checked separately.
  Asserting only „grounded evidence passes" is satisfied by the shipped gate,
  which rejects 98.7% of the corpus;
- assert the reason-code registry still covers every field a reviewer can
  disagree with — see below;
- prove generated JSON Schema, GBNF and runtime enums accept/reject the same
  shapes;
- retain the skill's five-known-article consistency diff, expanded to include
  at least one example at each mild boundary.

**The contract's `reason_codes` registry moves with the rubric and was
missing from the plan.** `news/eval_contract/contract.json` scopes each code to
the axes it may be used on, and `test_eval_contract.py` enforces that scoping,
so a v2 reviewer currently has no way to record the two commonest v2
disagreements. Required changes:

- `tone_misread`'s description names „favorable, unfavorable, neutral or
  mixed" — `mixed` is no longer a tone (§3.3);
- `label_too_strong` / `label_too_weak` are scoped to `leaning` and
  `russia_stance` only. Party tone becomes ordinal with two endpoints, so both
  codes gain `party_tones` — without it „the direction is right, +2 is too
  strong" is unrecordable on the axis where v2 adds the endpoints;
- two new codes: `wrong_treatment_basis` (all three axes) and
  `mixed_evidence_misjudged` (all three axes). Both are new fields a reviewer
  can disagree with independently of the label, and a disagreement with no
  code is either lost or misfiled under `other`;
- `neutral_vs_not_applicable` keeps its scope and gains weight — it is the
  code that catches a B4 regression in the field.

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

⚠️⚠️ **„25 PER ENDPOINT" IS NOT REACHABLE FROM THIS CORPUS FOR THE STRONG
LABELS, AND THE PLAN MUST SAY SO RATHER THAN DISCOVER IT.** Measured over the
1,687 `ok` records: `strong_progressive` 2 and `strong_conservative` 7
(**0.53%** combined), `strong_pro_russia` 8 and `strong_anti_russia` 8
(**0.95%**). At those rates a 25-instance endpoint sample needs roughly 2,500
screened articles PER endpoint — more than the analyzed corpus, per endpoint.
The two new party endpoints have no prevalence estimate at all, because they
do not exist yet. For scale, the 2026-08-29 benchmark's party gate was
computed on **n = 6**.

Three consequences, all decisions rather than observations:

- **A gate does not bind below a stated minimum n, and „withheld —
  insufficient n" is a first-class result, not a pass.** The release table
  below now carries `min_n` per row. A row at `n < min_n` is reported as
  withheld and blocks public exposure of that label the same way a failure
  does — it must never render as a green tick, which is what
  „recall ≥ 0.70 for every represented tone" does today on n = 2.
- **The challenge supplement may use CONSTRUCTED items** — the Tier 0 fixture
  shapes — for endpoints the corpus cannot supply, provided they are reported
  as a separate diagnostic stratum with its own n and never pooled into the
  prevalence set. A constructed `strong_favorable` measures whether the model
  can recognise the boundary; it says nothing about how often it occurs, and
  the report must not let one be read as the other.
- **Party treatment is released as one five-position field, not as selectively
  hidden labels.** If either strong endpoint lacks an adequate reference set,
  the public party-treatment field for that model/rubric version remains
  withheld. Internal candidate records and reviewer screens retain the exact
  prediction; public projection never downgrades a strong label, drops only
  those observations from a denominator or invents a four-position schema.
  This is the „no model is eligible through an overall average" rule applied
  to the complete field.

Update:

- `news/eval_contract/*.json` and canonical vectors;
- `news/scripts/score_analyses.py` (`PARTY_TONES`, `PARTY_RELEASE_GATES`,
  `apply_reference_revision` — which hard-codes `party_tones_version = 2` and
  validates against the 4-tuple, and `weighted_kappa`, which needs the new
  `party_tone` axis in `AXIS_POSITIONS`), `benchmark_party_tones.py`,
  `benchmark_news_models.py`, `build_political_gold_config.py`,
  `build_party_tone_eval.py`, `validate_party_tone_reference.py`,
  `build_community_eval_sample.py`, `report_community_eval_pilot.py`,
  `propose_eval_corrections.py`, `build_feedback_improvement_dataset.py`,
  `sync_eval_tasks.py`, `build_feedback_tasks.py`, and their tests;
- `news-functions/src/evaluation.ts`, `storage.ts`, `operator.ts` and function
  tests;
- `newsapp/app/evals.ts` (`EVAL_TONE_VALUES` — a hand-copy inside B3's parity
  gate), `evalSubmission.ts`, `articleFeedback.ts`, `EvalArticleScreen.tsx`,
  `EvalsScreen.tsx`, `ArticleFeedbackScreen.tsx`, `newsapp/prerender.test.ts`,
  `newsapp/test-fixtures/story-cards.tsx` and tests.

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

| Gate | Minimum | min n |
| --- | ---: | ---: |
| Valid schema **before** retry | 0.99 | 50 |
| Valid schema after bounded retry/review | 100% | 50 |
| Party-pair precision | 0.95 | 50 |
| Party-pair recall | 0.90 | 50 |
| Macro-F1 on each public ordinal field | 0.80 | 50 |
| Ordinal weighted kappa on each public ordinal field | 0.80 | 50 |
| Recall for each of the five public party tones | 0.70 | 15 per label |
| Wrong canonical-party links in audited release sample | 0 | 50 |
| Unresolved `party_id` in audited release sample | reported, not gated | — |
| Unsupported evidence (`evidence_quotes`) in audited release sample | 0 | 50 |
| Treatment-basis accuracy | 0.80 | 50 |
| Mixed-evidence precision | 0.80 | 15 |
| Mixed-evidence recall | 0.70 | 15 |

Three rows are new or corrected against the shipped
`score_analyses.PARTY_RELEASE_GATES`:

- **`valid_schema_before_retry: 0.99` already exists** and was missing here.
  It is not redundant with the after-retry 100%: retries hide a model that
  cannot hold the schema, and the v2 shape is strictly harder (two evidence
  fields, a basis enum, a boolean, five party positions).
- **Mixed-evidence precision/recall were listed under scoring with no
  threshold**, i.e. measured and unenforceable. `mixed_evidence` gates review
  routing, so a model that never sets it silently empties the review queue for
  the hardest cases while every other gate passes.
- **Unresolved `party_id` is reported, never gated.** Unresolved is not wrong
  — §3.3 makes it a publication rule rather than a correctness one — and
  gating it here would fail a model for a gazetteer defect it did not cause.
  It is reported so the 44.6% baseline is visible against every release.

No model is eligible through an overall average. The current benchmark already
withholds party treatment because every tested model failed its gate; v2 stays
hidden until the new frozen-input benchmark passes.

### Tier 3 — candidate backfill without mutating live analyses

Add a candidate mode to `analyze_articles.py` / `analyze_local.py`:

- `--save-candidate-batch <root>` validates and enriches records but does not
  update the live analysis tree, story files or index. ⚠️ **„candidate" is
  already taken in this file**: `--candidates` means „a work item of article +
  candidate STORIES", an unrelated concept on the clustering path. Keep the
  new flag's full name everywhere and never abbreviate it to `--candidates`
  in a script or a runbook;
- each candidate manifest stores article SHA-256, previous-analysis SHA-256,
  model/served-model, prompt/schema/rubric/evidence-gate hashes, attempts,
  token/cost data and candidate SHA-256;
- promotion refuses an article or old-analysis hash that moved after the
  candidate was produced;
- promotion uses the ordinary atomic save path so story detachment/re-attachment
  remains one implementation.

Run order:

1. fresh dated `--stats` and manifest count;
2. pilot 100 political articles, deliberately covering every treatment basis;
3. human-review every pilot diff and re-run the frozen scorer;
4. re-analyze **all currently analyzed articles**, not only those already
   carrying parties — old entity extraction may have missed a party. Only 165
   of the 1,687 `ok` records (9.8%) carry any party entity today, so the
   population that could GAIN a party is 90% of the corpus and is exactly the
   part a party-scoped re-run would skip;
5. pause between bounded batches and retain resumable manifests;
6. review every unresolved Bulgarian party or unknown-country party, old
   non-empty label change,
   `mixed_evidence=true`, strong endpoint and low-confidence result;
7. promote only after the complete candidate tree passes validation;
8. run `--rebuild` once after promotion and reconcile every story aggregate.

Cost must be stated at execution time. At the 2026-09-01 count this is 1,833
full article reads over a corpus averaging **2,848 characters** of body per
article (median 1,792, p90 6,522) — order 6–7M input tokens with the system
prompt, so at the measured GLM pricing roughly a low-single-digit dollar model
run. Human adjudication is the real cost.

⚠️ **That estimate excludes RETRIES, and v2 is the change most likely to move
the retry rate.** The schema gains an evidence list plus analytical reason, a
basis enum, a boolean and two party positions, and the existing gate tolerates
only 1% invalid
before retry. Price the pilot's MEASURED valid-response rate forward rather
than assuming the v1 rate holds. Take a new count and price measurement
immediately before execution; do not assume today's corpus or provider price.

Cutover gate:

- 100% of articles in the currently public analyzed set are v2 or explicitly
  withheld with a review reason;
- the promotion report prints the full v1→v2 transition matrix, including the
  Tier 0 clean-amplification candidate stratum. No target distribution is
  expected or gated; an unexpectedly unchanged candidate stratum or material
  growth in leaning `not_applicable` is investigated before promotion rather
  than after;
- zero v1/v2 records are combined in one aggregate;
- every promoted record matches its candidate manifest;
- old analyses have a recoverable local snapshot;
- the rebuilt index and every story count reconcile to the promoted records.

### Tier 4 — public projection and TypeScript contract

Update `news/scripts/build_app_data.py` and related effective-analysis/feedback
code so a public v2 build:

- publishes only `analysis_rubric_version=2` judgments;
- trusts grounded judgments only at `analysis_evidence_gate_version=2`;
- accepts only `party_tones_version=3` party items;
- includes basis and mixed flag on article detail;
- carries compact party position/basis to story members without duplicating
  evidence;
- recomputes story, topic and outlet distributions from effective v2 values;
- never treats absent/legacy/withheld as neutral;
- checks accepted human overrides against the same rubric version;
- includes rubric/prompt/model provenance in article and manifest output;
- **excludes non-Bulgarian parties from every published party distribution and
  from the party selector, while keeping their article-level items** (§3.3);
- **keys every party aggregate on `party_id`, never on the surface string**,
  and omits — visibly, with a count — pairs that carry no reviewed exact id.
  A separately versioned `party_aggregate_id`, if implemented, may group
  date-bounded related entities for a named product view; it never replaces
  `party_id` or emerges from string equality;
- withholds the complete public party-treatment field for a model/rubric
  version until all five labels clear Tier 2. It never selectively drops or
  downgrades strong predictions.

Update `newsapp/app/data.ts` and `labels.ts`:

- expand `Tone` to the ordered five labels;
- add basis, mixed-evidence and `evidence_quotes` types;
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

⚠️ **`MixBar` is `src/ux/MixBar` — the MAIN elections app's component**, which
`/persons` and the procurement surfaces also render; `StoryScreen.tsx` imports
it as `@/ux/MixBar`. Add the party axis by PROPS or behind a news-local
wrapper; changing its contract to suit a five-position party scale is a change
to the elections site, and nothing in the news test suite would catch a
regression there. `newsapp/app/components/SpectrumBar.tsx` — the static
sibling — types on `Leaning` and `RussiaStance` only and is the news-side file
that gains the party axis.

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

⚠️⚠️ **NEITHER FLOOR IS CURRENTLY REACHABLE, AND SAYING SO IS THE POINT.**
Measured 2026-09-01 over the current surface-level cells, before Tier 0's exact
identity policy is applied: **0 of 194 outlet×party cells reach 20** — the
largest is `epicenter.bg` × ГЕРБ at **8** — and only **2 of 119** topic×party
cells do, before the „from at least 5 outlets" condition is applied. Recompute
these counts after exact IDs and country scope land; the current figures are a
feasibility diagnostic, not an aggregate baseline.

This is the same state `build_app_data.TOPIC_MIN_POSITIONED = 20` documents for
the scalar axes. The measure ships in data/operator output with every cell's
sample status, while the public aggregate component remains feature-flagged
off until its floor is met.
Two rules follow:

- the floors are NOT lowered to make a surface appear. A distribution over
  n = 8 is decoration with a number attached, and this plan's entire premise
  is that the aggregates must be defensible;
- operator and preview diagnostics render „short — N of 20 assessed pairs",
  so progress is distinguishable from a broken pipeline; production readers
  do not receive an underpowered distribution or a placeholder feature.

At the current rate — 307 pairs from 1,833 analyses, ~17% — the first
outlet×party cell reaching 20 needs roughly 2.5× the present top cell, so
these surfaces are built now and exposed later, per the exposure order below.

- Home/story cards: at most one compact party comparison signal, only when at
  least two outlets differ; never add a general outlet or party ranking.
- Outlet directory and Saved: no new party-treatment bars.
- Methodology/About: document target, five boundaries, `neutral` vs
  `not_applicable` (§3.2 rule 8 — the distinction a reader most often reads as
  a hedge), mixed evidence, the evidence-quotes/reason split, sample floors,
  the Bulgarian-party scope, model accuracy and correction behavior.

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
- source and generated prompt assets are in sync;
- **the seven vocabulary copies agree** (B3) — Python constants, contract
  JSON, generated JSON Schema and GBNF, the synced `news-functions` copy, and
  the TypeScript unions/metas;
- **record/task versions are compatible** per §4: v2 analysis shape and
  evidence versions travel together, while the evaluation transport may bump
  independently; a v2 analysis cannot be graded against a v1 target;
- **`AXIS_POSITIONS` keeps its signs** (B6): `progressive = -1`,
  `pro_russia = -1`, and the new `party_tone` entry has
  `strong_favorable = +2`. Asserted as literals, because a flip is invisible
  to every symmetric metric downstream;
- **`party_tones` is routed** and both new endpoints are in `ALWAYS_REVIEW` by
  derivation from `TONE_LABELS`, with the mutation case from Tier 1 (B2);
- **`evidence_quotes` cardinality is exact**: zero for non-mixed
  neutral/not-applicable, one for a non-mixed directional label and two for
  mixed evidence; each quote is grounded separately (B1);
- **axis applicability is independent**: political-topic + leaning
  `not_applicable` is routed, while political-topic + Russia
  `not_applicable` is valid when Russia is absent;
- **no party aggregate keys on a surface string**, and unresolved-`party_id`
  pairs are excluded from distributions while still rendering on the article;
- **exact `party_id` is never replaced by an aggregation family**, and every
  new context-resolved Bulgarian mapping has a reviewable reason/date scope;
- **no non-Bulgarian party reaches a published distribution or the party
  selector**, while its article-level item survives;
- **a short aggregate cell is visible in operator/preview diagnostics but the
  production aggregate component stays disabled** until its floor is met;
- **party treatment is field-gated across all five labels**: an unvalidated
  strong endpoint withholds the field rather than being downgraded or omitted.

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

Basis, `evidence_quotes` and `evidence` stay out of home/story summary bundles
unless directly rendered — the split in §3.7 increases the evidence payload
per judgment, so the compact-bundle exclusion is now load-bearing rather than
tidy. Evidence remains in per-article detail. Any budget increase must name the
rendered feature that requires it; do not widen a ceiling merely because
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
- no published treatment distribution for a non-Bulgarian party (§3.3);
- no party aggregate keyed on an unresolved surface string;
- no forced alias that turns an ambiguous party surface into a canonical link;
- no selective endpoint release or strong-to-mild label downgrade;
- no lowering of a Tier 5 sample floor to make a surface appear;
- no gate reported as passed below its `min_n`;
- no auto-publication before the independent human/model gates pass.

## 10. Definition of done

- The shared five-position rule and boundary fixtures are versioned and
  independently reproducible.
- Every public analysis is v2, evidence-backed and explicit about basis; every
  displayed party has exactly one v3 treatment item.
- The evidence gate passes a realistic share of DIRECTIONAL party judgments,
  not 1.3% of them and not only `neutral` (B1). This is the single check that
  distinguishes „v2 shipped" from „v2 shipped and publishes nothing", and it
  is the state the v1 corpus is in today.
- The vocabulary copies, record/task version compatibility and
  `AXIS_POSITIONS` signs are all gated, not merely correct on the day
  (B3, B5, B6).
- Party identity has zero wrong links in the audited sample; each unresolved
  Bulgarian or unknown-country pair is named with a refusal reason and
  excluded from aggregates rather than silently dropped.
- The selected model clears each field's frozen release gate, including zero
  unsupported evidence and wrong party links in the audited sample.
- Public corrections and accepted evaluations are rubric-version-safe.
- Story, topic and outlet aggregates reconcile exactly and expose denominators,
  dates and sample floors without a net outlet rating.
- Article, story, evaluation, methodology and eligible aggregate surfaces use
  the same labels and explanations in BG/EN.
- Tests, accessibility, responsive layouts, bundle budgets, candidate hashes,
  release manifest and preview audit pass on the exact version promoted.
