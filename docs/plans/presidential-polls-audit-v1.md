# Presidential polling: audit and implementation plan

Date: 2026-09-26. Scope: accepted data, drafts, agency discovery and extraction, accuracy calculations, and election/agency screens. This is an audit and proposed implementation plan; application code and accepted polling data have not been changed.

## Verdict

The requested views need both a historical backfill and corrections to the data model. There is currently **one accepted presidential survey, no accepted historical polls, no runoff observations, and no scored cycles**. The existing UI also combines two different questions from that survey into one ranking. Building historical accuracy charts directly on the current analyzer would produce misleading results.

Recommended product changes:

1. On `/presidential/:cycle`, show the campaign's polling history and a separate comparison of eligible polls with the result, with round controls.
2. Add `/polls/:agencyId/presidential` as a dedicated agency page, linked from its existing profile. Include all accepted presidential surveys, question-level results, sources, and historical accuracy where calculable.
3. Repair ingestion and scoring before publishing historical comparisons. Start the backfill with 2016 and 2021, then extend to earlier elections as primary evidence permits.

## What exists

| Area | Audited state |
| --- | --- |
| Accepted presidential surveys | `gm-2026-07-11` only; cycle unset |
| Accepted detail rows | 13: nine party-backed choices and four named-person support-potential answers |
| Accepted runoff observations | Zero |
| Accuracy output | `cycles: []` |
| Historical drafts | Trend 2016 and 2021; incomplete and unaccepted |
| Election page | `PresidentialPollsTile` supports a cycle's agency error summary, but has no history chart or historical accuracy trends |
| Agency profile | Presidential list embedded in `/polls/:agencyId`; no dedicated presidential route |
| Polling hub | Latest survey per agency; does not separate question types |
| Extraction | Trend presidential support and Global Metrics presidential support; Alpha Research's extractor is parliamentary only |

Evidence: [accepted corpus](../../data/polls/presidential/), [election screen](../../src/screens/presidential/PresidentialCycleScreen.tsx), [accuracy tile](../../src/screens/presidential/PresidentialPollsTile.tsx), [agency screen](../../src/screens/PollsAgencyScreen.tsx), [hub section](../../src/screens/polls/PresidentialPollsSection.tsx), [extractor registry](../../scripts/polls/extract.ts).

## Findings, in implementation order

### 1. Separate questions before displaying or scoring the accepted survey — high

Global Metrics' July 2026 publication contains a question about the party backing a hypothetical candidate and a different question about willingness to support named people. The extractor takes the named question's “definitely” column and puts it alongside the party-choice answers. The UI then sorts both by `support`.

The party-choice answers sum to 99.9%. The named-person answers are support-potential measures, not a mutually exclusive voting distribution. Displaying 39.7% for a party-backed candidate beside 30.0% for Йотова implies a comparison the publication does not make. The stored PP–DB label also loses the Democratic Bulgaria part of the published coalition name.

The agency explicitly describes hypothetical configurations and support potential. The [original publication](https://globalmetrics.eu/obshtestveni-naglasi-prezidentski-izbori-yuli-2026/) and [report, pages 4–5](https://globalmetrics.eu/wp-content/uploads/2026/07/National_survey_results_GM_July-2026.pdf) establish the separate questions and answer scales.

**Required change:** store question identity, measure, answer scale, population base and scenario. Render each question separately. Mark support potential and party-backed hypothetical choices ineligible for candidate vote-share accuracy. Preserve the original labels and all supported answer tiers. Do not normalize these questions into a candidate ranking.

Evidence: [GM extractor](../../scripts/polls/extractors/global_metrics.ts), [types](../../src/data/polls/pollsTypes.ts), [shared sorting](../../src/data/polls/pollRows.ts), [agency list](../../src/screens/polls/AgencyPresidentialPollsList.tsx).

### 2. Candidate matching can manufacture a correct leader prediction — high

The resolver matches first and last name tokens. The 2016 Trend draft uses `Цецка Цачева` and `Татяна Дончева`; the official tickets use `Цецка Цачева Данговска` and `Татяна Дончева Тотева`. Both poll names fail to resolve.

A read-only run of `computeCycleAccuracy` against the real 2016 tickets and the draft reproduced:

- Both names omitted from scoring.
- `leaderCalled: true` and `runoffPairCalled: false`.
- MAE of 2.57 percentage points calculated from the remaining rows.

The draft actually puts Цачева at 27.3% ahead of Радев at 24.0%. Dropping Цачева makes the analyzer incorrectly report that the poll called the leader. This draft is not accepted, so this is a demonstrated backfill defect rather than a currently published historical score.

**Required change:** add reviewed, cycle-specific candidate aliases tied to official tickets. Preserve unresolved observations and expose resolution coverage. Return an unknown verdict when relevant candidates are unresolved; do not rank only the successfully matched subset and present that as the poll's prediction. Avoid unrestricted fuzzy identity matching.

Evidence: [resolver](../../scripts/polls/presidential/candidate_resolver.ts), [analyzer](../../scripts/polls/presidential/analyze_accuracy.ts), [2016 official tickets](../../data/2016_11_06_pvr/tickets.json).

### 3. Accuracy eligibility and round selection are incomplete — high

The analyzer selects one last poll per agency before round one, then attempts scoring. It does not first determine which question is eligible. Consequently:

- A later unscorable poll can hide an earlier eligible poll.
- Surveys conducted between rounds are excluded; runoff scoring only considers pairings attached to the selected pre-round-one survey.
- Fieldwork ending on election day is allowed, and there is no publication-date cutoff.
- MAE compares only published, resolved rows. Missing candidates and inconsistent candidate coverage can make agencies' scores incomparable.
- `genre`, population base and undecided residuals do not gate the comparison. A named support-potential answer could become scoreable after cycle assignment and name resolution.
- A greater-than-50% share is used to judge whether the election was called in one round; share alone is insufficient evidence for that verdict.

**Required change:** define eligibility per question and round before choosing the last eligible observation. Compare like denominators, retain raw values, and document any permitted transformation. Report MAE in percentage points, signed candidate errors, coverage and fieldwork distance. Use a consistent candidate/bucket policy before ranking agencies; incomplete comparable coverage should suppress the overall grade. Never treat an omitted candidate as zero without source evidence. Keep round-one vote intention, pre-election hypothetical runoffs and between-round runoff polls distinct.

Evidence: [analyzer](../../scripts/polls/presidential/analyze_accuracy.ts), [types](../../src/data/polls/pollsTypes.ts).

### 4. Unprocessed discoveries can disappear from the capture queue — high

The watcher reports only publications newer than its previous high-water mark in `meta.items`. The next unchanged check overwrites that list with an empty array. Capture reads that same array as its pending work.

A pure-function probe reproduced one new item on discovery and zero items on the next unchanged check. If capture has not run successfully between those checks, the publication is no longer queued. A watcher reporting no change therefore does not prove that ingestion is complete.

**Required change:** persist a publication ledger with discovery, capture, extraction, review and acceptance states. Retain pending items until processed, track refusal/retry reasons, and deduplicate by agency publication identity and source content. Discovery cursors and processing progress must be separate. Reconcile existing raw captures and historical archives into the ledger.

Evidence: [watcher](../../scripts/polls/lib/watcher.ts), [watch state writer](../../scripts/watch/index.ts), [capture targets](../../scripts/polls/lib/capture.ts).

### 5. Agency coverage is partial, and historical discovery is not complete — high

| Agency | Presidential extraction | Discovery/backfill issue | Next action |
| --- | --- | --- | --- |
| Trend | Implemented; 2016/2021 drafts exist | Dispatcher emits one race from a publication; joint presidential/parliamentary releases need both. WordPress listing is a single page. | Extract multiple race/question records; repair historical drafts and paginate. |
| Alpha Research | Not implemented; existing extractor is parliamentary | Listing capped at six pages; title must contain `нагласи`; date-window options do not provide a complete historical walk. | Add presidential extraction and archive traversal; use source fixtures beyond one title pattern. |
| Global Metrics | Implemented, with question-mixing defect | Single-page WordPress listing; accepted survey lacks question distinctions. | Correct schema/extraction and review the existing record. |
| Market Links | Not implemented | Only current news page fetched; title filter rejects a verified presidential release. | Paginate archive and implement PDF/chart extraction with evidence. |
| Sova Harris | Not implemented | Categories limited to current and previous year even for historical requests. | Resolve categories for the requested years and add extraction. |
| Мяра | Not implemented | Single-page WordPress discovery; Bulgarian/English publication duplicates require handling. | Add extraction and canonical publication deduplication. |
| Gallup International Balkan | Not implemented | Latest stored watcher state reports a failed site fetch; title terms include English `president` but omit Bulgarian `президент`. | Repair transport/discovery, add Bulgarian fixtures, report unavailable coverage explicitly. |

Market Links is a concrete missed-source case: its archive contains **“Фрагментиран парламент и президентска надпревара в два тура - ноември 2021”**, but `isElectoral` returns false for that title. See the [agency archive](https://www.marketlinks.bg/bg/news-p3.html) and [November 2021 report](https://www.marketlinks.bg/storage/INFOGRAPHIC%20NRS%20Politics%2011.2021.pdf). The report is accessible through the web reader used in this audit; an older note about PDF access failures should not be treated as permanent. Its chart values were not transcribed or accepted during the audit.

Alpha Research also has primary historical reports, including [September 2016](https://alpharesearch.bg/userfiles/file/0916_Alpha_Research_Public_Opinion.pdf) and [October 2016](https://alpharesearch.bg/userfiles/file/1016_Public_opinion-Referendum_PE.pdf). These are backfill leads, not accepted or numerically verified observations in this audit. Exit polls must remain separate from pre-election polls.

The stored ingest log last reports success on 2026-09-11; the watch state checked on 2026-09-25 has empty pending site lists and a Gallup fetch failure. These are dated operational observations, not proof that agency sites published nothing later.

Evidence: [agency listers](../../scripts/polls/agencies/), [extractor registry](../../scripts/polls/extract.ts), [ingest state](../../state/ingest/update-polls.json).

### 6. Cycle assignment and correction history need stronger safeguards — medium

Presidential restamping assigns **every** null-cycle poll to the supplied cycle without a fieldwork window. That assumption becomes unsafe when historical drafts enter the same corpus. Trend's date-based cycle lookup also needs explicit handling of between-round observations rather than searching only for the next round-one date.

The acceptance correction snapshot preserves the prior poll and details but not prior runoff rows. Historical corrections therefore need a fuller version record.

**Required change:** retain explicit intended election and round evidence; restamp only the selected eligible records. Validate candidate identities, percentage bounds, unique answers, matching survey/agency IDs and distinct runoff participants. Version all questions, answers and runoffs together.

Evidence: [restamp](../../scripts/polls/restamp.ts), [Trend presidential extractor](../../scripts/polls/extractors/trend_presidential.ts), [acceptance](../../scripts/polls/accept.ts).

### 7. Missing data and fetch failures look the same to readers — medium

The presidential accuracy hook maps missing/unavailable data to `unscored`; network failures and absent coverage can produce the same empty message. Agency views also do not explain whether an agency has no publications, no accepted extraction, or unavailable data.

**Required change:** distinguish loading, available, no accepted coverage and error. Show a retry on failure and a dated coverage statement for incomplete backfills. A missing historical score must not appear as zero error.

Evidence: [data hooks](../../src/data/presidential/usePresidentialPolls.ts), [agency screen](../../src/screens/PollsAgencyScreen.tsx).

## Proposed pages

### Presidential election page: `/presidential/:cycle`

- **Campaign trend:** plot every accepted, comparable vote-intention observation by fieldwork end; tooltip includes the full fieldwork range, publication date, agency, sample, method, base and source. Round controls change both the plot and table. Filter agencies and candidates. Do not connect incompatible questions, bases or scenarios.
- **Result comparison:** table of each agency's last eligible poll for the selected round: published share, election share, signed error, MAE, fieldwork distance and coverage. Link to the original survey and the agency's presidential page.
- **Historical accuracy:** compare each agency's eligible results across elections, separately by round, with counts of scored cycles and missing coverage. Keep this distinct from within-campaign support trends. Avoid a single league table based on one or two observations.
- **Accessible data table:** expose every plotted observation; show gaps as gaps. Use existing site chart, layout, translation and accessibility patterns.

### Agency page: `/polls/:agencyId/presidential`

Keep `/polls/:agencyId` as the agency overview and add a visible presidential-polls navigation link with coverage counts. Move the full presidential list to the new page; keep a concise overview preview if useful.

The dedicated page should work for presidential-only agencies even when no parliamentary profile exists. Include election and round filters, full survey history, separately labelled question blocks, source/methodology details, candidate error tables and accuracy across elections. Show unscored surveys with a reason rather than hiding them. Link back to the election page. Add route metadata, direct-load coverage, prerender/sitemap registration where the existing routing architecture requires it, and Bulgarian/English strings.

## Data and implementation sequence

### Phase 1 — Correct the foundations

- Introduce a publication/survey record with question children. Each question carries race, intended cycle, round, measure, base, scenario, answer scale, evidence and scoring eligibility/reason. Preserve fieldwork separately from publication time.
- Keep population base, residuals and eligibility at question level. One publication may contain multiple electoral races and multiple questions.
- Add stable cycle-specific candidate aliases, retaining published names and unresolved values.
- Repair the durable discovery ledger, cycle assignment and correction snapshots.
- Migrate the accepted GM survey with reviewed source evidence; retain a complete correction history.

### Phase 2 — Backfill and calculate

- Inventory primary publications by agency/cycle/round, then capture all available waves for 2016 and 2021. Final polls alone cannot produce historical campaign trends.
- Add the missing agency extractors and historical pagination, with explicit backlog/error reporting.
- Resolve Trend's OCR fieldwork and residual issues from source evidence; do not invent missing metadata or silently accept refused fields.
- Review drafts under the existing `update-polls` evidence workflow before acceptance. Reconcile survey counts against the publication inventory.
- Build question/round-aware accuracy with eligibility and coverage diagnostics. Extend to 2001/2006/2011 as sources allow; publish explicit coverage gaps.

### Phase 3 — Deliver the views

- Build the agency presidential page and election-page trend/result sections on the corrected model.
- Add historical agency accuracy only where comparable observations exist; include sample counts and timing.
- Update ingestion documentation: `polls:presidential:rekey`, presidential restamping and presidential analysis already exist, despite stale “not built” notes in the skill/comments.
- Verify routes, translation parity, responsive layout, keyboard access and chart/table agreement; then follow the repository's normal data and application release process.

## Required regression cases

1. GM party preferences and named-person support potential never share a ranking or accuracy score.
2. The real 2016 Trend draft resolves reviewed Цачева/Дончева aliases; an unresolved leading candidate yields unknown prediction status.
3. A later ineligible question cannot suppress an earlier eligible poll; election-day/publication cutoffs are explicit.
4. Between-round polls stay in the same cycle and score against round two; hypothetical pairings remain labelled.
5. Different percentage bases and candidate coverage cannot silently enter the same agency ranking.
6. An unchanged watch run, capture failure or process restart preserves unprocessed publications.
7. Historical pagination reaches older publications; the real Market Links title is accepted; joint-race releases produce both sets of questions; bilingual mirrors do not double-count.
8. Restamping does not move historical unknowns into a future election; replacement preserves prior runoff evidence.
9. Direct loading the new agency route works for a presidential-only agency; absence and fetch errors are visually distinct.

## Further features, by value

1. **Runoff matchup matrix:** candidate pair, date, published margin and undecided share; distinguish hypothetical matchups from the actual second round.
2. **Undecided and participation trends:** separate series with the original population base. Help readers understand changing vote shares without silently redistributing undecided respondents.
3. **Candidate comparison:** compare trajectories and lead margins within compatible questions; preserve nomination changes and party-backed placeholders as separate measures.
4. **Coverage and methodology panel:** last publication checked, accepted date range, sample/mode/sponsor where disclosed, pending or unavailable coverage, and correction history.
5. **Shareable filters and downloads:** stable links for an election/agency/round view and CSV/JSON exports containing provenance and eligibility labels.
6. **Later, calibrated summaries:** candidate-specific historical bias and timing-adjusted comparisons once enough comparable data exists. Defer win probabilities and composite agency ratings until their model can be validated across elections.

## Validation performed and limits

The focused polling, presidential UI and watcher suite passed: **46 test files, 654 tests**. Read-only probes separately reproduced candidate loss/false leader attribution, the Market Links title rejection and loss of pending watcher items. Existing tests do not cover those real-source cases.

Primary GM and Market Links publications were inspected through the web reader. This was not an exhaustive archive scrape or a browser layout test. No historical drafts were accepted, no application behavior was changed, and no data was published. Existing unrelated news-data edits were preserved.
