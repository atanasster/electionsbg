# Parliament and municipal-council voting chat — implementation plan v1

Status: proposed implementation plan, 2026-09-12. This document is based on a targeted repository audit, not a completed implementation or live-source refresh. Scope: integrate the existing parliamentary and municipal legislative records throughout chat, with dates, persons, topics, sessions, results, provenance, starters and follow-ups. Electoral votes and council election results remain distinct domains.

## 1. Audit findings and required corrections

| Finding | Evidence | Required change |
|---|---|---|
| “покажи ми последните заседания на парламента” has no dedicated session-list route | `ai/orchestrator/router.ts`, roll-call rules near lines 1566–1789 | Explicit session intent and chronological query, including empty-title sessions |
| “покажи ми последните гласувания в парламента” is forwarded as a full-sentence topic query | Same router, `voteSearch` branch | Extract operation separately; no topic predicate for a generic latest request |
| Search is not recency: matches are ordered by `contestScore`, capped at 12, and blank titles are discarded | `ai/tools/parliament.ts:529`, `voteSearch` | Separate latest, topic search and most-contested operations; SQL filters before pagination; retain untitled records with a neutral label |
| Named-member requests generally route to an aggregate voting profile | `ai/orchestrator/router.ts:1586`, `mpVotingProfile` | Distinguish individual casts from profile, similarity, attendance and party-discipline intent |
| Existing parliamentary chat tools still use derived JSON | `ai/tools/parliament.ts` | Serve scoped queries from PostgreSQL; whole-term derivatives cannot answer date-scoped questions |
| Existing DB search requires a nonempty term and is narrowly capped | `functions/db_routes.js`, `vote-item-search` | Reuse normalization where useful, but add a canonical query API supporting empty topic/latest and exact scope |
| Council chat serves ten recent decisions for a resolved municipality, with no person/date/topic query contract | `ai/tools/placeData.ts:329` | Integrate resolutions, sessions and named votes; replace hard-coded coverage labels with current capability evidence |
| Parliament IDs are recycled between assemblies | migration `134_rollcall.sql`, `mp_seat`, `vote_cast` | Resolve and join `(ns, mp_id)`, never `mp_id` alone; cross-term person claims require a verified bridge |
| Re-votes are retained and mark superseded attempts | `vote_item.superseded_by`; migrations 134/135 | Separate physical voting attempts from standing decisions; explicit counting basis |
| Party affiliation changes during an assembly | `vote_cast.party_id` versus display-only `mp_seat.party_id` | Historical party metrics use affiliation at cast time |
| Sessions have their own source evidence | migration `180_vote_day.sql` | Use `(ns,date)` and preserve PDF/stenogram, source scrape time and ingestion time separately |
| Council IDs, frontend municipality IDs and roster codes differ | migration 160; `councilObshtinaMap.ts` | Resolve through existing code bridge; Sofia districts map to the city council, not fictional district councils |
| Council named votes and person attribution are incomplete | `council_vote`, `has_named_votes`, source types and loader | Distinguish aggregate-only/secret/unpublished/unresolved from “did not vote”; never infer absence from missing named rows |
| Council person IDs can be invalidated by person reloads | migration 160 documents `ON DELETE SET NULL` and reload order | Stable source handles plus revision-aware identity bridge; verify after person rebuild |
| Council topic tags and generated summaries differ from source titles | `scripts/council/lib/types.ts`, schema 160 | Audit persisted tags; version any projection; label generated-summary search separately from source evidence |

Historical counts in migration comments are explanatory snapshots, not current coverage facts. Step 0 must measure current serving coverage before committing defaults or publishing availability claims.

## 2. User questions and answer semantics

Support these distinct jobs:

1. Browse latest indexed sittings, motions, resolutions or a person's recorded casts.
2. Find legislative subjects using a curated topic, literal title phrase, bill/resolution identifier or explicitly selected search field.
3. Inspect one motion and its full named roll, tallies, source and re-vote relationship.
4. Explain how a named person voted, including their recorded party at the time.
5. Count and compare votes within an explicit date/body/person/topic scope.
6. Measure recorded participation, alignment, agreement and contestedness only where the necessary evidence exists.
7. Drill from a session to its motions, from a motion to casts and from a person's casts to source records without losing scope.
8. Discover coverage: which terms/councils/dates have indexed records, aggregate tallies and named rolls.

“Latest” means latest **indexed matching** records, newest first, with last available date shown. It never means most controversial and never guarantees the source has published no newer records. Default page size: 10, with explicit `last N` up to a bounded maximum (proposed 100). A “last 10 votes” cohort remains ten on an aggregate follow-up; distinguish this explicit cohort limit from the page size. A normal result page of ten does not truncate downstream aggregates.

Parliament default: most recent assembly with indexed relevant records, explicitly labeled; never derive it from the selected election date in the site header. An explicitly requested assembly with no data stays unavailable/empty as appropriate; never silently switch. Dates without an assembly search all intersecting indexed assemblies. A named person's latest votes use verified matching seats across terms, rather than silently requiring current membership. Ambiguous names or an unverified cross-term identity require a chooser. Bare council requests ask for a municipality unless an explicit current conversation scope supplies it; do not silently use geolocation.

Use actual sitting/vote/decision dates, not ingestion dates. Interpret 04/2025–01/2026 as `[2025-04-01,2026-02-01)`, year 2026 as `[2026-01-01,2027-01-01)`. Resolve today/last month with an injected clock and Europe/Sofia timezone, pin absolute dates for history and shared links. Invalid/reversed ranges require correction. “Latest sessions” is retrospective indexed history, not a future agenda/calendar feature.

Parliament raw-session detail and “last votes/casts” default to **all recorded attempts**, retaining re-votes. Decision counts, outcome shares and legacy discipline/cohesion metrics default to **standing decisions** (`superseded_by IS NULL`), clearly labeled. User may explicitly switch basis where supported. Do not infer enactment, legal passage or quorum from a simple yes/no comparison; use sourced outcomes and explain unknown thresholds. Council resolutions are not guaranteed to enumerate every procedural voting attempt in a meeting.

`x` in parliamentary casts is a recorded source category, not proof of physical absence or nonmembership. Do not fabricate missing casts, historical membership intervals, council absences, council party affiliation, or inferred votes from an aggregate tally. Show “no named vote published” separately from an explicit against/abstain vote. Aggregate and named tallies may disagree: preserve both, disclose reconciliation and do not overwrite one with the other.

## 3. Canonical contract and architecture

Introduce `rollcall-records-v1` using the proven funding/procurement approach, without reusing their domain-specific fields.

Proposed `src/lib/rollcallQuery.ts` discriminated contract:

- `corpus`: `parliamentSessions`, `parliamentVotes`, `parliamentCasts`, `councilSessions`, `councilResolutions`, `councilCasts`.
- `operation`: `list`, `detail`, `count`, `summary`, `trend`, `compare`, `rank`, `share`, `methodology`.
- Body scope: `assemblyIds`, canonical `councilIds`; reject incompatible cross-corpus fields.
- Date scope: normalized half-open `from/to`, explicit current/comparison windows; date basis fixed by corpus.
- Identity scope: verified parliamentary seat references `(ns,mpId)` or council source identities; optional revision-bound canonical-person bridge. Plain names are resolver input, not SQL identity predicates.
- Record scope: stable session/record keys, explicit parent query plus permitted relationship, and optional explicit most-recent-N cohort constraint.
- Subject scope: `topicIds`, `keyword`, `searchField` (`sourceTitle` by default); explicit AND/OR for multiple subjects; exact bill/resolution references. Extracted title text excludes conversational scaffolding, person names and dates.
- Vote scope: source-aware choice, outcome, tally method, historical faction IDs and counting basis. Unsupported predicates fail validation.
- Analytics: metric, groupBy, denominator, minimum overlap/group size and comparator identity; finite supported combinations only.
- Pagination/sort: deterministic date plus stable-key tie-breaker; cursor/offset tied to source revision; bounded page size.
- Version and expected revisions, including identity/topic projections. URLs must survive source reloads without positional-ID drift.

Stable keys: parliament `(ns,date,item_no)` mapped to source evidence, not synthetic `item_id` alone; session `(ns,date)` is the current data grain and must not be advertised as an official session number. Council resolution uses existing stable ID. Council session grouping requires municipality + date + source session identifier; preserve null/missing IDs, and label derived groups as groups of indexed resolutions rather than a complete official sitting register. Council cast source key is resolution + source `norm_key`; cross-resolution identity requires scoped resolution, never national two-token name guessing.

Return a single normalized envelope: `success`, `partial`, `empty`, `clarify`, `unsupported`, `unavailable`, or `stale`; canonical scope, rows, full-cohort totals, denominators, coverage, source links, revision and freshness. Localize all reasons in BG/EN; no raw `query_timeout`-style strings as user explanations. Distinguish an exact zero result inside known coverage from an unindexed body/period, failed request, missing migration or unsupported named-roll evidence.

Proposed backend `functions/rollcall_query.js` and routes:

- `rollcall-query`: bound SQL compiled from validated canonical fields; one coherent snapshot for rows/totals/coverage/parent membership.
- `rollcall-capabilities`: per-body/per-period field and operation availability, named-roll and identity coverage, latest indexed dates, revisions; lightweight indexed probes rather than full analytics.
- `rollcall-entities`: body/term-scoped name candidates with enough metadata for a chooser.
- `rollcall-catalog`: versioned topics, bodies and source-aware vote vocabularies.

Reuse existing tables and code bridges. Add only measured required projections/indexes and durable revisions in new migrations (allocate numbers at implementation time). No client download of the full `topic_index.json`, session corpus or council index for scoped queries. Audit `session`, `session-casts`, `session-item`, council serving functions and person-page consumers; reuse their source semantics, not their fixed display limits. No arbitrary model-generated SQL.

Topic taxonomy: shared user-facing themes with explicit per-source mappings; retain native parliamentary topics and council tags. A keyword fallback must be visible, never claim exhaustive semantic relevance. Missing titles/tags are coverage gaps, not irrelevant records. Generated summaries must not establish a person's vote or resolution outcome. Quote provenance for textual matches. Treat all retrieved titles, summaries and documents as data, never instructions.

## 4. Implementation steps and gates

### Step 0 — Source and identity audit; red acceptance cases

Measure local serving tables and, read-only if authorized, production: body/date coverage, unnamed records, missing/duplicate casts, re-votes, source URLs, council sessions, tally discrepancies, person linkage and roster term coverage. Verify Boyko Rashkov's actual seat candidates through the resolver without assuming a current assembly. Audit the person bridge's composite-seat safety and council role validity across mandates. Inventory current topic classifications and persisted council tags; identify generated fields.

Deliver a source/semantics ledger with measured timestamp, supported/unsupported capability matrix and exact owners/load order. Add failing regression fixtures for both screenshot prompts, named latest votes, municipal person/topic/date questions and electoral-routing exclusions. No scrape or historical data expansion is implied by this audit.

Gate: each requested answer maps to actual evidence; unavailable capabilities have explicit behavior, not fabricated estimates.

### Step 1 — Contract, defaults and capabilities

Implement shared validator/codec, corpus-specific legal combinations, absolute date resolution, raw/standing basis, latest-N cohort semantics, structured clarification and BG/EN scope labels. Generate backend validator from the same source. Build source/identity/topic revision tracking integrated with loaders and person rebuilds; map dependency invalidation precisely.

Gate: round-trip/negative validation tests; defaults do not read the election selector; mixed or unresolved scope cannot execute broadly.

### Step 2 — Parliament query and person resolution

Implement indexed session/vote/cast queries; joins on composite seat identity, stable item references, date/subject filters, exact tallies and source attribution. Add resolver candidates for two/three-name forms, Bulgarian/Latin variants and known aliases; no silent first match. Support explicit cross-term identity only with trustworthy bridges. Preserve all recorded re-votes in raw detail and standing-only metrics.

Gate: independent SQL fixture oracles for pagination, raw-versus-standing, cross-term reused IDs, party switching and the last-votes-of-Boyko-Rashkov route using resolved fixture identity.

### Step 3 — Council query and coverage

Implement resolutions, derived session groups and named casts from durable serving tables. Use council code bridges and mandate-aware identity when available. Add persisted topic projection only after auditing raw tags; retain revision/provenance. Scope person search by council and term; unresolved source names remain unattributed. Surface aggregate-only, secret and incomplete named rolls accurately.

Gate: Burgas/Sofia code tests, same-name councillors in different councils/terms, unresolved person links after reload, null tallies and aggregate-versus-named mismatch tests.

### Step 4 — Scoped metrics and comparisons

Implement scoped participation/recorded-choice distribution, party alignment and pairwise agreement using the documented existing definitions where appropriate. Recompute from scoped facts, not whole-term materialized outputs. Publish eligible/evaluable denominators, missingness, sample count, tie policy and minimum overlap. Compare only compatible grains; separate parliament/council panels, never pool their populations implicitly. Defer an individual metric behind capabilities if its denominator cannot be established.

Gate: independent arithmetic fixtures, zero denominator => unknown, no absence-as-dissent, historical faction handling, compared windows with uneven coverage, ties/negative/unknown cases appropriate to each metric.

### Step 5 — Understanding and provider integration

Add `ai/orchestrator/rollcallUnderstanding.ts` before broad election/person fallbacks, patterned after scoped funding/procurement understanding. Capture body, operation, person, dates, subject and record references independently. Route screenshot prompts with no keyword. Preserve specific legacy contested/profile intents through adapters. Integrate tool registry schemas, deterministic and AI providers, narration and evaluations. Unknown fields require clarification; no scope loss on retries or provider fallback.

Gate: BG/EN parser matrix; provider parity; no unintended routing changes for election results, preferential votes, judicial council, municipal seats, party composition or general person biographies.

### Step 6 — Chat, exact result pages and context

Implement a scope-preserving result screen and compatible detail links to `SessionsIndexScreen`, `SessionScreen`, council resolution and person voting screens. Show body, absolute dates, person/seat, subject, counting basis, freshness and coverage. Human column labels, localized vote choices and unavailable reasons. Links carry the same canonical query and revision; source links point to actual evidence.

Persist canonical scope through saved chat, reload, share links and source citations. Parent drill-downs use the complete matching cohort or explicit latest-N cohort, never visible-page IDs. Date/body/person changes reset only incompatible fields and explain cleared fields. Stale responses cannot overwrite a newer request; switching conversations cancels pending chooser effects. CSV export uses exact page/cohort policy, revision and formula-safe values, with an explicit cap.

Gate: mounted UI tests for selector → parameters → answer, clarification, follow-up chips, paging/export, request races, browser history and scope retention; keyboard focus and accessible scope controls.

### Step 7 — Starter and follow-up catalog

Add bilingual questions in correct subtopics: parliamentary sessions/votes, member voting records, municipal decisions and councillor named votes. Capability-gate by actual body/field coverage. Parameterized questions display selected person/body/date values, not stale example text. Test visible catalog inclusion and actual selector execution, not only parser strings.

Gate: each advertised starter resolves or asks a meaningful question; every follow-up preserves or explicitly changes canonical scope.

### Step 8 — Acceptance, performance, deployment plan

Run complete affected parser/provider/chat/route/DB suites, existing election regressions, lint and production builds. Benchmark populated PostgreSQL as the application role: last sessions, last casts by person, cross-term identity, title/topic range, council named votes, grouping, pair comparison and full-parent drill-down. Measure first request, at least six warm samples, p95, concurrent requests and custom/generic plans. Target warm p95 under two seconds for normal interactive queries; retain production's ten-second timeout. Investigate materialization/temp spills and avoid expensive capability scans.

Prepare migrations/grants, loader order, additive rollback flag and deployment checklist. Production deploy requires the user's deployment instruction; this plan alone is not a deployment action. When authorized: migrations/projections → backend → frontend → backend shell refresh → hosting purge. No-store revision-bound endpoints. Verify backend role access, real UI starters, typed prompts, ambiguity, latest semantics, follow-ups, original screenshots, paging/export, named council gaps and AI-mode parity. Record tests actually executed separately from the acceptance specification; do not claim screen-reader or live-generation coverage from deterministic tests.

Gate: all supported cases pass; capabilities suppress unsupported cases; no known wrong-person, wrong-body, wrong-date or silently broadened answer remains.

## 5. Starter prompts (BG / EN)

Braces denote actual selector parameters, with localized labels and validated defaults. Person examples are lookup input, never hard-coded IDs.

| ID | Bulgarian | English |
|---|---|---|
| S01 | Покажи ми последните заседания на парламента. | Show me the latest parliament sittings. |
| S02 | Покажи ми последните гласувания в парламента. | Show me the latest votes in parliament. |
| S03 | Покажи заседанията на {assembly}-ото НС от {from} до {to}. | Show sittings of Assembly {assembly} from {from} to {to}. |
| S04 | Какви гласувания има на {date} в {assembly}-ото НС? | What votes were recorded on {date} in Assembly {assembly}? |
| S05 | Кои са последните 10 гласувания на Бойко Рашков? | What are Boyko Rashkov's last 10 votes? |
| S06 | Как гласува {person} по {topic} от {from} до {to}? | How did {person} vote on {topic} from {from} to {to}? |
| S07 | Покажи гласуванията за здравеопазване през 2026. | Show parliamentary votes on healthcare in 2026. |
| S08 | Покажи гласуванията за бюджета от 04/2025 до 01/2026. | Show parliamentary votes on the budget from 04/2025 to 01/2026. |
| S09 | Кой гласува против по {vote}? | Who voted against on {vote}? |
| S10 | Покажи поименния вот и първоизточника за {vote}. | Show the named roll and primary source for {vote}. |
| S11 | Имало ли е прегласуване на {vote}? | Was {vote} voted on again? |
| S12 | Кои са най-оспорваните гласувания в {assembly} през {year}? | Which votes were most contested in Assembly {assembly} during {year}? |
| S13 | Какъв е делът на записаните гласове „за“ на {person} през {year}? | What share of {person}'s recorded votes were for in {year}? |
| S14 | Колко често {personA} и {personB} гласуват еднакво по {topic}? | How often do {personA} and {personB} vote alike on {topic}? |
| S15 | Как гласува групата {party} по {topic} през {year}? | How did faction {party} vote on {topic} in {year}? |
| S16 | За кои периоди имате поименни парламентарни гласувания? | Which periods have indexed parliamentary roll calls? |
| S17 | Покажи последните решения на общинския съвет в {municipality}. | Show the latest council resolutions in {municipality}. |
| S18 | Покажи заседанията на общинския съвет в {municipality} през {year}. | Show indexed council sittings in {municipality} during {year}. |
| S19 | Какво реши общинският съвет в {municipality} за {topic} от {from} до {to}? | What did the council in {municipality} decide on {topic} from {from} to {to}? |
| S20 | Кои са последните поименни гласувания на {councillor} в {municipality}? | What are {councillor}'s latest named votes in {municipality}? |
| S21 | Как гласува {councillor} по бюджета на {municipality} през {year}? | How did {councillor} vote on {municipality}'s budget in {year}? |
| S22 | Кои съветници гласуваха против решение {resolution}? | Which councillors voted against resolution {resolution}? |
| S23 | Покажи решенията за градоустройство в {municipality} през {year}. | Show urban-planning resolutions in {municipality} in {year}. |
| S24 | Покажи приетите решения с поименен вот в {municipality}. | Show adopted resolutions with named votes in {municipality}. |
| S25 | Кои решения в {municipality} нямат публикуван поименен вот? | Which resolutions in {municipality} have no published named roll? |
| S26 | Покажи оригиналния протокол за решение {resolution}. | Show the original protocol for resolution {resolution}. |
| S27 | Сравни решенията за {topic} през {yearA} и {yearB} в {municipality}. | Compare {topic} resolutions in {municipality} during {yearA} and {yearB}. |
| S28 | За кои общини имате решения и поименни гласувания? | Which municipalities have indexed resolutions and named votes? |

## 6. Follow-up prompts and scope rules

| ID | BG / EN | Required behavior |
|---|---|---|
| F01 | А през 2025? / And in 2025? | Replace dates; retain compatible body/person/subject; do not retain contradictory term silently |
| F02 | Само от април до юни 2026. / Only April through June 2026. | Pin exact inclusive-month interval |
| F03 | А за Бойко Рашков? / And for Boyko Rashkov? | Resolve person within compatible legislative scope; clarify ambiguity |
| F04 | Само за здравеопазването. / Only healthcare. | Add mapped topic; preserve person/date/body |
| F05 | Само гласовете „против“. / Only votes against. | Filter named choice; do not confuse rejected motion with individual's against vote |
| F06 | Покажи всички гласували по второто. / Show everyone who voted on the second one. | Bind displayed stable record key, never untrusted ordinal outside that answer |
| F07 | А гласуванията от това заседание? / And the votes from that sitting? | Exact session parent; clarify if multiple sessions are in focus |
| F08 | Покажи оригиналния документ. / Show the original document. | Exact selected record evidence; distinguish absent source link |
| F09 | Включи и прегласуванията. / Include re-votes too. | Switch to all-attempt basis and recompute |
| F10 | Само окончателните гласувания. / Only the standing votes. | Standing basis; explain this is not proof of enacted law |
| F11 | А по месеци? / And by month? | Group same full cohort; latest-N stays an explicit cohort when requested |
| F12 | Сравни с предходната година. / Compare with the previous year. | Construct comparable absolute window; publish both denominators/coverage |
| F13 | Колко от тях са „за“? / How many of those were for? | Same parent membership, beyond displayed page; explicit choice denominator |
| F14 | А в общинския съвет в Русе? / And in Ruse council? | Explicit body switch; carry date/topic only where meaningful, clear parliamentary seat/faction and disclose |
| F15 | А как гласува съветникът {name}? / And how did councillor {name} vote? | Council/mandate-scoped resolver, never national name guessing |
| F16 | Само решенията с публикуван поименен вот. / Only resolutions with published named votes. | Evidence-availability filter, not presumed unanimous/participating |
| F17 | Покажи следващите 10. / Show the next 10. | Stable pagination in same revision/scope; no rerouting as a new topic |
| F18 | Защо липсва поименният вот? / Why is the named roll missing? | Explain known source/method/indexing distinction without guessing motive |
| F19 | Махни ограничението за темата. / Remove the topic filter. | Remove only topic/keyword scope explicitly associated with it |
| F20 | Какъв е знаменателят? / What is the denominator? | Explain actual metric population, exclusions, missing records and basis |

## 7. Comprehensive acceptance and test matrix

Implement named, independently assertable cases rather than counting duplicated strings as coverage. Expand each language-sensitive case in BG/EN. All starter rows and follow-up rows above need catalog, parser/adapter and mounted UI coverage.

| Family | Required cases and independent assertions |
|---|---|
| R01–R10 routing | Both screenshot strings; latest vs contested; sessions vs motions; person casts vs profile; council resolutions vs municipal election seats; judicial council exclusion; electoral party votes exclusion; explicit body ambiguity; empty-topic query; unknown intent clarification |
| D01–D12 dates | Year, month range, exact day, ISO range, Bulgarian date notation, leap day, month/year boundary, timezone-relative window, invalid/reversed interval, dates spanning assemblies, explicit empty assembly, header election date independence |
| I01–I12 identity | Boyko Rashkov fixture; two/three-part names; Latin aliases; same-name chooser; recycled mp_id; cross-term verified bridge; missing bridge; historical faction switch; same-name councillors across councils; repeated names across mandates; source-only unresolved name; person reload invalidation |
| P01–P12 parliamentary facts | Sessions with zero/untitled items; raw re-vote sequence; standing counts; person cast choice; source x versus missing cast; per-item source links; aggregate/named mismatch; stable item key after reload; same-date different NS; complete parent set; explicit latest-N versus page limit; deterministic tied-date order |
| C01–C12 council facts | Burgas code bridge; Sofia district bridge; unindexed council; aggregate-only vote; secret vote; missing roll; null tally versus zero; unknown/returned outcome; incomplete person resolution; absent source title; derived-session grouping collisions; source tag versus generated-summary distinction |
| M01–M10 metrics | Independently calculated choice shares; zero denominator; eligible versus observed distinction; no absence-as-dissent; party at cast time; pairwise common overlap; ties/minimum sample; grouped totals beyond page; disjoint comparison coverage; unsupported cross-body pooling |
| Q01–Q12 contract/API | Encode/decode; invalid version; illegal corpus-field combination; SQL injection and wildcard binding; excessive limits; unsupported sort/metric; stale revision; ACL/missing migration; timeout distinct from empty; cache no-store; concurrent snapshot coherence; malicious source text remains data |
| U01–U12 UI/providers | Visible starter category; selector parameter edit reflected in query/text; candidate chooser; compatible follow-up; explicit incompatible switch; saved-history rehydration; exact detail URL; pagination plus CSV; request race/cancellation; provider parity; localized errors/columns; keyboard/focus accessibility |
| O01–O08 operational | Migration fresh/warm idempotence; revision loader hooks; role grants; query-plan benchmark; capability endpoint cost; production timeout budget; rollback hides capabilities; deployed screenshot regressions |

Fixtures must compute expected numbers from deliberately small hand-authored records, not call production compiler helpers for the oracle. Include one person changing factions, two different people sharing an MP ID across assemblies, a re-vote, a zero-vote session, duplicate names across councils, a council record with aggregate-only votes, and a missing title/unknown tally. Add property tests for equivalent date spellings and order-independent canonical filters, while preserving order where meaningful.

Run transactional database tests against PostgreSQL, including application-role access, query plans and parent memberships. Mocked provider tests prove routing, not actual DB semantics. UI tests prove visible selector and follow-up behavior; hand-written canonical arguments alone do not prove user prompt capture. Production smoke must rerun actual original strings, not paraphrases that happen to route differently.

## 8. Audit of this plan: gaps folded in

The design includes the easily missed boundaries: last-N cohort versus pagination; non-current members; reused assembly IDs; historical party membership; roster/person rebuild invalidation; raw attempts versus standing decisions; indexed session grain versus official sitting identity; council aggregate-only/secret rolls; different municipality code systems; unsupported periods versus empty results; generated summaries versus primary evidence; exact scoped links and CSV; chooser/request races; provider fallback parity; live-role performance and capability cost; revision/no-store behavior; and truthful deployment evidence.

Completion means the requested legislative questions work across the supported indexed data, with clear capability boundaries. It does not mean every Bulgarian council has been scraped, all historical identities have been resolved, or unpublished individual votes can be recovered. Additional source expansion is a separate, measurable ingestion task.
