# Наясно НОВИНИ — a Bulgarian Ground News: coverage, subjects, and the story page

**Status:** proposed plan, audited and revised 2026-09-21, then **independently re-audited
against the tree on the same day** (pass 2 in §13; **pass 3 deep codebase audit in §14**, folding
root-cause solutions, veto anatomy, and live contract reconciliation; critical findings marked inline with ⚠️ and 🔍). **Amendment review reconciled in §0 and the
task contracts; historical audit conclusions are corrected below where superseded.**
⚠️ **Partly IMPLEMENTED since 2026-09-21 — see §0.1 for what is in the tree.** This is no
longer only a proposal: Stage 0, T1.2, T1.3, T1.4 and part of T4.1 are shipped with gates.
**Pass 4 (§15) re-measured the contested claims and added three findings the earlier passes
do not hold: `same_event_evidence()` is the PRIMARY clusterer, not a fallback (86.5% of all
joins; the model self-joins 1.0% of the time), two in-repo priors that bear on T2.3's
proposed gates, and a LIVE hourly failure that has left the accepted-adjudication snapshot
empty — which starves T2.3, T4.5 and T6.3 and is now Stage 0 in §9.** No product code is changed by this document. The
audit checks implementation contracts and Ground News’s public product documentation; the
original corpus figures below are retained as a dated baseline, not claimed as a fresh
recount. New acceptance thresholds are proposals, not measured results. The original figures
were measured against `news/app-data` and `news/data` on 2026-09-21
(build `generated_at` 2026-09-20T23:25:54Z, run over **10,130** corpus articles / 5,005
analyses / 2,574 stories — the header said 10,131; the build’s own `stats.json` says 10,130).
Re-measure before quoting one.

⚠️ **The corpus grows hourly and was changing during the audit.** Numbers below were
recomputed against the committed 2026-09-20T23:25:54Z build; a re-run against a later build
will differ by design. Quote a figure with the build’s `generated_at`, and prefer the build’s
own artifact (`stats.json`, `home.json.home_health`) over prose. This is why T2.0’s “freeze
canonical article IDs, content hashes and analysis versions” is a prerequisite, not hygiene.

---

## 0. Requirements

**Implementation authority after amendment review (2026-09-21).** The task contracts in
§3–12 are normative. §1 contains dated observations, and §13–14 preserve historical audit
records, not additional requirements. Where an older audit conclusion was superseded, use
the corrected task contract. No percentages below establish causality or accuracy without
an adjudicated reference set. Attach every new measurement to a frozen input manifest,
query/script, timestamp and denominator; do not combine the 2,574-story and 2,623-story builds.

**Priority findings folded into this revision:**

| priority | finding | required resolution |
| --- | --- | --- |
| P1 | Same-case surnames still collide; some case descriptions turn disputed reporting into identity facts | Separate case retrieval from identity resolution; neutral sourced descriptions; article-specific coreference (T3.3, T4.0) |
| P1 | Existing pagination permits mixed generations; overlays can change without a new base run | Pin base, overlay and query time together; validate filter-before-page across updates (T1.3) |
| P1 | A partial-text tone and an article-level analysis count do not establish target-level sentiment | Explicit scope, per-target denominator, full-text rollup eligibility and evidence/voice gates (T4.1–4.5) |
| P1 | Place/count veto proposals still reject legitimate evolving coverage | Role-aware places and time-qualified quantities; review-only until held-out evaluation (T2.1) |
| P2 | Scoop winner eligibility was incorrectly reused as arrival velocity | Separate timestamps from winner flags; suppress historical backfill boosts (T1.2) |
| P2 | Hosting deployment is not production data publication | Compatible client/data rollout through existing GCS publication transaction (T1.5, T4.4) |
| P2 | Sample keyword counts and blocked pairs were presented as causal evidence | Publish the funnel, annotate relevance and re-run article-level clustering (T1.4, T2.0, T6.2) |

Stated by the operator, 2026-09-21, verbatim in substance:

| id | requirement |
| --- | --- |
| **R0** | The site should be similar to ground.news, focused on Bulgaria — **leading with the most popular stories and the different opinions on them**. |
| **R1** | For the last 24 hours we have only **13 stories**. |
| **R2** | We have **no stories at all about the upcoming presidential elections**. |
| **R3** | We have **no stories at all about the most talked-about scandals** — Петрохан and the pardon of a narco baron. |
| **R4** | We have **no stories at all about political parties (and their sentiment)**. |
| **R5** | If a story is about e.g. the mayor of Varna, **extract the story subject "person" and require jev to provide sentiment analysis on the person himself**. |
| **R6** | **Simplify and improve the UI/UX of the stories themselves.** |
| **R7** | **Review the methodology page, reorder it to be more comprehensible, and include our jev/LLM and text-extraction methodology as well.** |
| **R8** | Match the strongest Ground News workflows: compare coverage, discover under-covered perspectives, inspect sources, and follow subjects. |
| **R9** | Assess framing toward **any identifiable person in a story**, including Ивайло Калушев in Петрохан coverage, even without a main-site public-figure profile. |

⚠️ Several original requirements are stated as *absences*, but **material exists in
the corpus** — the material is in the corpus and is being suppressed, mislabelled or
withheld downstream. §1 gives the measurement for each. This matters for sequencing: the
fix for R1–R4 is mostly in the publish and taxonomy layers, not in ingestion, and
these observations alone do not justify expanding ingestion. However, source health and
analysis freshness must be measured before publishing any claim about missing coverage (§11).

---

## 0.1 Implementation status — what is SHIPPED (updated 2026-09-21)

⚠️ **This table is the resume point. Everything else in this document is a design
record; only this section says what exists in the tree.** A task is ✅ only when its
code, its gate and its mutation check are committed — not when it was designed.

| task | status | commits | what actually landed |
| --- | --- | --- | --- |
| **Stage 0** — adjudication transport | ✅ closed, ⚠️ one half is a PRODUCT state | `09ba888273` `c1f1a41399` `6dbfc7575d` `fc9d86d829` `89eb91f94d` `e396ddfef5` | `src`/`lib` skew alarm; cold start named separately from failure; gazetteer admits ДПС/БСП/ДСБ/ИТН/СДС; router stops re-asking settled policy. ⚠️ **The three Firestore exports still return nothing — not because they are broken, but because the public eval surface has never received a submission.** T2.3/T4.5/T6.3 have no adjudicated input and no code creates those records. |
| **T1.2** — prominence | ✅ | `dda2fe5785` | `story_prominence()` (`log2(1+U) + 0.25·log2(1+V)`, 24 h half-life), `PROMINENCE_VERSION`, `ranked-N` pages beside `index-N`, `--as-of`, `stale_ranking`. Prominence is stamped ONCE at assembly and EXCLUDED from overlay change detection — a clock-dependent field in a content-derived payload made every story look changed (3,031 details / 11.0 MB against a 2 MB ceiling). |
| **T1.3a** — the query contract (data side) | ✅ | `1061a1f0b4` | `stories/filter-index.json` — whole corpus, structured fields only, ~41 KB gz, `QUERY_VERSION`, `facets_basis`, `UNTOPICED_FACET`, 64 KB gz budget enforced at build. Carries NO score, so a hot overlay does not ship 371 KB on a run that published nothing. |
| **T1.3b** — the query contract (client side) | ✅ | `9215e5405a` | `storyQuery.ts` (`queryStories`, `withinWindow`, `listState`, `browseKey`), `useGlobalStoryQuery`. Facets are counted with their OWN dimension relaxed; `listState` names the five things a list can say. Search is scoped to the briefing and SAYS so (titles in the index measured at 288 KB gz against a 13 KB page). A pending or failed count prints no number rather than a zero. |
| **T1.3c** — the `/stories` browse (the reader's half of R1) | ✅ | `git log --grep T1.3c` (2026-09-21) | `newsapp/app/screens/StoriesScreen.tsx` over `queryStories` ∩ the `ranked-N` / `index-N` prefix (`storyBrowse.ts`, `useUrlStoryBrowse.ts`); topic · window (incl. „всички") · outlet · sort · `q` are URL state. Snapshot pinning is by COMPONENT, not by a key: the window anchor is pinned per query (`usePinnedInstant`), a sort change starts a new prefix (fetched by the REVEALED sort and refused by page provenance, `PAGE_SORT`), a base publish mid-browse is REPORTED with a refresh (`staleVintage`) and never continued from, an overlay is merged into prefix + match set + counts together (`storyListView.merged` drives the „без ново класиране" note) — `browseKey` stays a pure function for a future cursor. The fill reveals pages until the target is met (ceiling `BROWSE_FILL_ROW_CEILING`), STOPS on a failed page (retry in place, never stepped over), so a story whose only match is on page 2 is reached — the T1.4 fixture, now on the client. `useStoryList` / `storyListView` are sort-aware, with `compareRankedRows` a twin of the publisher's three stable passes, pinned by `rankedParity.data.test.ts` over the real pages. The home „Показваме N от M" line links to it carrying the same topic and window; „Архив" is in the nav. Search is over hydrated titles and SAYS its scope. |
| **T1.5** — publication and retention | ✅ | `git log --grep T1.5` (2026-09-21) | Four halves. (1) **Consumption-boundary integrity**: `createDataClient` verifies every payload the manifest lists — `bytes` first, then `sha256` via WebCrypto — and REFUSES a mismatch (`IntegrityError`, evicted, not cached); the overlay is verified against its pointer and DROPPED on mismatch (base kept, error logged); `client.integrity()` reports `verified`/`unverified`/`off`, and an insecure context serves unverified and warns once. The uploader's "which is what readers verify" comment was false until this; both its comments now say what is true. (2) **Retention**: `prune_published_versions.py` carries a DERIVED policy (`retention_policy()`: poll 60 s + retry 15 s + cache grace 3600 s → K≥3; default K=8 = six hourly releases of rollback, ~300 MB steady vs 27 GB/month unbounded), refuses a K under it, and is wired into `run_hourly.sh` OPT-IN (`NEWS_PRUNE_VERSIONS=1`) after a successful public publish, recorded in the run report. (3) **Story-URL continuity**: `news/config/retired_stories.json` (human-owned) → `stories/retired.json`; the build refuses an id both retired and published or a merge target not published; the uploader refuses a PUBLIC release that drops a live story id the registry does not name (`story_continuity` in the upload result, `NEWS_ALLOW_STORY_DROPS=1` hatch); the story page explains a 404 from the registry in three honest states (retired-with-reason, never published, registry unreadable). Measured 2026-09-21: the story count fell once in 57 hourly runs. (4) The urgent invalidation path is the existing hot overlay (`removed_story_ids`, 5-min cadence, `no-cache` manifest), and it carries the SAME gate: `build_overlay.py` refuses to write an overlay that retires a story the registry does not name (`hot_story_continuity`, same hatch). An unlisted base path is refused as the release's 404 rather than served unverified; a whole-carried file the base lacks (`replaced_paths`) is answered from the overlay. ⚠️ Not done: no test hits the serving origin's real object metadata (an operator `gsutil stat` check; CI has no bucket credentials); a story that only ever existed through an overlay is invisible to the cold gate, which compares base inventories; `bundle.sha256` and the accepted-records hashes stay an operator check. |
| **T3.1** — taxonomy v2: `elections-presidential` | ✅ | `git log --grep T3.1` (2026-09-21) | `news/topics.json` v2: a category of its own (27 categories / 108 subcategories) with `campaign`, `candidates`, `debates`, `results`, `cik-administration`; `load_taxonomy()` now keys subcategory uniqueness WITHIN a category (every consumer keys on the pair; a global rule would have refused v2 outright); the rubric (§7) states the pardon / veto / КСНС / consultation rule and „only mentioning Йотова or Радев does not route to an election"; prompt assets regenerated (`taxonomy_compact.json`, grammar, JSON schema) so new analyses carry `taxonomy_version: 2` while every record on disk keeps its 1; `review_routing` treats it as inherently political. **Paired fixtures** in `news/evals/taxonomy_v2_fixtures.json`: five pairs from REAL corpus articles (path + url + content sha256, title + lede inline) — a tandem announcement vs the petrichki-Escobar pardon; ЦИК registration vs a (SYNTHETIC, labelled) government-formation consultation naming Йотова; the candidates overview vs Йотова at the Council of Europe; a candidate's pardon-power proposal vs PM Радев on his cabinet; a candidate interview vs ДБ asking Йотова to convene the КСНС. All four positives that HAD a v1 record were `elections-parliamentary/*` (three `campaign`, one `cik-administration`) — R2's mechanism, measured from the records on disk and carried as `v1_label` in the fixture file; the fifth (the Гюров interview) was never analysed under v1. Scoring contract stated in the file: positives on `expected` exactly, negatives on `forbidden_category` (their `expected` is advisory — the rubric names the institutional set as a rule, not one target). Gate `test_taxonomy_v2.py` (11 tests): fails closed on an empty pair list, requires every negative to be a trap in its own text, requires a pardon / consultation / Йотова / Радев negative each, and re-checks the pinned hashes where the corpus is present. ⚠️ Not done: no model has been scored against the fixtures — that is T3.2's reclassification run; the corpus window holds no real consultation article, so that one negative is synthetic and says so. |
| **T3.2** — review and reclassify the candidate set | ✅ | `git log --grep T3.2` (2026-09-21/22) | `news/scripts/reclassify_topics.py`. The retrieval query is COMMITTED in the script (`PRESIDENTIAL_QUERY` v1: the election terms, `кандидат(-)президентск*`, `Дондуков 2`, `вицепрезидент`, `Йотова`; IGNORECASE over the SOURCE TEXT), and the four readings the plan found ambiguous are reported side by side under it — **474 (record, case-sensitive) / 479 (record, IGNORECASE) / 591 (source text) / 430 (summary_bg)** over 6,940 records on 2026-09-21T20:41Z, the same shape as the plan's 360/366/493/299. Frozen manifest (gitignored, sha-pinned per record): 591 candidates, 580 `quality.ok`. Topic-only reclassification with `z-ai/glm-5.3-flash` through the existing rubric+grammar (only `topics`/`site_relevant` taken from the answer; every other field kept; `field_provenance.topics` carries previous topics, previous taxonomy version, model, manifest): **580 → 458 changed (356 primary moved, 102 secondaries only) · 98 unchanged · 23 refused · 1 failed**; `elections-parliamentary` 274 → 8, `elections-presidential` 0 → 291 (candidates 182, campaign 77, cik-administration 32). Refusals are fail-closed, not written: 10 would cross `not-site-relevant` (story membership / `story.action` / eligibility are a dependency group — `analyze_local.py --redo` is the path), 8 invalid topic pairs, 5 answers disagreeing with themselves about `site_relevant`; 13 parse failures were retried once (`--retry-failed`, which FOLDS the pass into the same report via `fold_retry`; this first fold was done by hand with the same arithmetic before the function existed — stated in the report's `retries[0].basis`), 1 remains. Refusals carry a `kind` (`invalid_topics` / `self_disagreement` / `crosses_boundary`) so routing never keys on a message; every record is sha-pinned at the freeze and re-checked at WRITE time (atomic write), so a record the hourly runner rewrites mid-run is reported, never clobbered. ⚠️ **The finding this step produced:** a story's `topics` is stamped ONCE from its first member and never recomputed, so the article-level move reached zero stories — `taxonomy.json` reported 350 presidential ARTICLES beside **2** presidential STORIES, and the filter index, home chips and browse read the story. `--retopic-stories` re-derives every touched story's primary as the plurality of its members' primaries (ties to the first member): 397 stories touched, **299 moved** (over the touched set: parliamentary 219 → 5, presidential 0 → 238, per the report's `stories.before/after_by_category`; corpus-wide in `taxonomy.json`: presidential stories 2 → **240**, parliamentary 315 → 101). Report: `news/evals/reclassify_presidential_2026-09-21.json` (before/after, spot-check lists, refusals, retries, stories); gate `test_reclassify_topics.py` (14) reconciles it and pins the query, the write, the refusals and the story rule. ⚠️ Not done: no adjudicated held-out set — these are the model's answers under the v2 rubric, spot-checked by eye (candidates announcing tandems, Борисов on a common candidate, ЦИК registration all moved; a Russian ballot story and a Костадинов piece stayed parliamentary); the 23 refused records are open for the normal analysis path; secondary-only changes were written too (the model returns the whole list), which is stated rather than hidden. |
| **T3.3** — cases (казуси), a curated registry | ✅ | `git log --grep T3.3` (2026-09-22) | `news/config/cases.json` — two entries, `petrohan` and `narco-pardon` (both at `rule_version` 2), each a dated, human-owned record: slug, BG/EN name, `opened_on`, `rule_version`, reviewer + `reviewed_on`, a neutral sourced description, `sources[]` (claim + URL + outlet + date), `contested[]` (claim, speaker, date, source, RESPONSE, note — the denial-of-charge shape is recorded as a response, never as a status; an opinion column is a source of CONTESTATION only, never of the facts), the match `rule` (`required_terms`, `anchor_terms`, `context_terms`, `excluded_terms`, `min_required_hits`; `required_mentions` is carried as a reserved key for T4.0 and read by nothing), `namesakes`, `ambiguous_match: review`, `overrides{include,exclude}` and `history`. Every reader-facing string (claims, speakers, responses, notes, the rule's basis) is `{bg, en}` and the loader refuses a monolingual one — the page renders one language. `news/scripts/cases.py`: `load_cases` refuses an entry with no sources, no context terms, a contested claim with no `response` key, a non-https URL anywhere a reader can click, or a non-positive `min_required_hits`; `match_article` is: no excluded term, AND the affair named at least `min_required_hits` (2) times — terms match at WORD START, never as bare substrings; the compound name „Петрохан – Околчица“ is ONE mention; a title mention counts double; a mention of an `anchor_terms` participant (Калушев) counts as naming the affair — AND a context term; overrides win in both directions and carry the rule version. No exclusions are declared on either entry: the road / weather / tourism arm rides the hit floor and the context conjunction, and the Кюстендил mayor + football coach namesakes ride the pardon-term conjunction. **Auto-attach is EARNED, not declared**: `verify_fixtures` runs every case's fixtures from `news/evals/case_fixtures.json` (8 petrohan + 7 narco-pardon, real articles pinned by path/url/sha with a `why`; hard negatives: Petrohan pass road limits, Ботевите тържества at Околчица, a Гюров passing mention, a motorway-fire footer, the bta.bg festival with mayor Огнян Атанасов, „бат Оги", a Борисов remark) and fails CLOSED on no fixtures, an absent article, a wrong classification, or fewer than 2 positives / 2 negatives — a case that fails publishes in its `review` state (the page renders the registry entry and „не се публикува" with the reason, no membership). `build_app_data.py` attaches at ARTICLE level and derives story membership with the supporting article ids (`case_ids` on the story, its detail file and the filter-index row — the overlay vectors and the TS `storyIndexRow` projection both carry it), writes `cases.json` + `cases/<slug>.json` (timeline across topics with evidence per story, outlets, framing with denominators, first/last dates, the rule shown as data) and `news/review/case_candidates.json` — discovery over the WHOLE corpus including analysed-but-excluded and unanalysed articles (§1.3), so missed coverage is visible. ⚠️ **Rule v1 was wrong on the live corpus and the fixtures did not see it** — bare-substring context terms attached a road bulletin through „данс“ inside „Санд**анс**ки“ and a Plovdiv street-washing timetable through „ул. Терзиев“, and a per-term hit sum scored one „Петрохан – Околчица“ phrase as 2 (12 published members whose whole evidence was that phrase, three of them one minister's press scrum). Rule v2 (word-start matching, affair-mention counting, the Калушев anchor, „нпо“/„терзиев“/„сандов“ dropped as context terms) removed exactly those 10 of the 153 v1 matches and kept the other 143; the three live shapes are now NEGATIVE fixtures, so the set contains the failures it exists to catch. Measured on the 2026-09-22 rebuild (the corpus moved by an hourly ingest in between): petrohan **109 stories / 128 articles attached** from 152 matches (5 unanalysed, 19 excluded), narco-pardon **39 / 43** from 43; both fixture sets (11 + 7) verify, and the v1 rule fails two of the three new negatives when substituted back. Pages: `/cases`, `/case/:slug` (editorial note `role=note` stating inclusion is a selection, not a finding; sources; contested claims with their responses; timeline; outlets; framing; rule), a „Казус" chip on the story page; prerender + sitemap only for a case that is attached with stories. Gates: `test_cases.py` (18), `test_build_app_data.py::Cases` (6 — incl. a misclassified fixture, an absent fixture article, `auto_attach: false`, and fixtures verified against the corpus the build READS rather than the repo copy), `caseSlug.test.ts` (the slug charset pinned to the Python regex over one probe set), `CaseScreen` (7) / `CasesScreen` / `StoryScreen` component tests, prerender + a sitemap gate that asserts the RULE (a case is submitted iff attached with stories, and the committed register is never empty) — every one mutation-checked. The standalone bundle ships `cases.py`, the registry and the fixtures. Side finding fixed on the way: `sync_eval_tasks` refused the WHOLE task build when one record's joined `party_tones` reason exceeded its 600-char feed bound (a four-party German-elections piece, 628 chars) — reasons are now cut at a separator with a `+N more` tail, or shortened with an ellipsis when even the first item cannot fit beside its tail (`bound_reason`, 5 tests; the cut is always visible, never a bare prefix). ⚠️ Not done: person LINKAGE inside a case (Калушев × 2, Атанасов × 3) stays unresolved — the registry attaches ARTICLES and names nobody in identity metadata; `required_mentions` is carried but empty for both cases until the mention layer (T4.0) can supply resolved ids; the standalone host verifies fixtures against its own corpus, so a case whose fixture articles it never saved publishes there in review state by design. |
| **T2.0** — freeze the labelling universe | ✅ | `git log --grep T2.0` (2026-09-22) | `news/scripts/freeze_event_universe.py` (`npm run news:universe:freeze -- --until <day> [--days 14]`). Freezes every corpus article in a `published` window (id, path, url, domain, published, `first_seen`, content sha256), its analysis record (canonical `analysis_sha256`, `analyzed_at`, model, prompt hashes, `taxonomy_version`, `quality.verdict`, `site_relevant`, primary topic, `story.action`, story id, `merge_basis.by`, and the analysis-side `canonical_title_bg` + `summary_bg` the join stage actually reads) and the PUBLICATION GATE as one per-record boolean (`quality.verdict == ok AND site_relevant is True`), then recounts §15.2's table over exactly that set. ⚠️ **The story id lives in two places and only one is complete** — a `same_story` record carries it, a `new_story` record does NOT (only `index.json.articles[url]` does); the first cut read the record alone and reported 225 stories over 2,353 publishable articles, and a missing index now REFUSES with its own diagnosis rather than surfacing as an empty stratum. Copies (same content sha256, or 5-shingle Jaccard ≥ 0.8 over the pipeline-tokenised body through an inverted-index prefilter — measured: the Кандев/Дарик wire on two mastheads folds, two independent reports of one briefing do not) and same-story members form one UNIT; every unit is assigned whole to dev or test by the day of its EARLIEST article, the boundary chosen so the unit test share is closest to the requested 0.3. ⚠️ **That keeps KNOWN same-story pairs and copies together and nothing more** — a CANDIDATE pair (an article against a story it does not belong to) can straddle, and on a boundary that lands on a busy day most of the test side's candidates point at the previous day's stories (the first freeze had 2,788 of 13,852 straddling; 47% of its strong cross-outlet test pairs). Every pair is stamped `straddles` and a straddling pair is EXCLUDED from the adjudicable test set (`adjudicable_split = "excluded"`), rather than counted as a test answer whose other half sits in development; unioning candidate edges would collapse the graph. Four article strata are counted over the raw window AND the publishable subset (Петрохан via the T3.3 rule, presidential, local, foreign) and „unrelated same-person events" is a PAIR stratum (weak title overlap, a person the article names among the entity hits — an article-level „named in more than one story" flag marked 44% of the window, every recurring politician); an empty stratum, an empty window, a window with no publishable article, a window whose last day is not over (`--allow-open-day` overrides and is RECORDED as `window.open_day`), an already-frozen stamp and an existing committed report (`--force`) each REFUSE. **Measured, window 2026-09-07 → 2026-09-20 (14 closed days; the corpus is dense only from 09-18 — 627 units on 09-19, 1,124 on 09-20), frozen 2026-09-21T23:43Z:** 2,309 raw → 2,274 analysed → 2,232 quality-ok → 1,383 site-relevant → **1,383 publishable**; `story.action` new_story 1,204 / none 891 / same_story 179 — **all 179 stamped `same_event_evidence`, i.e. the model joined ZERO articles on its own in this window** (§15.2 had 30 of 222 over the whole corpus); 1,204 stories, **1,076 singletons (89.4%)**, 1,082 single-outlet, 122 multi-outlet, largest story 7; **62 copy groups filed under more than one story** (the same text under two mastheads opened two stories — a clustering failure the frozen set measures for free). Strata (publishable): petrohan 101, presidential 96, local 51, foreign 417; same-person pairs 1,990 (630 adjudicable-test). Split: boundary 2026-09-20, 822 dev / 1,124 test units (995 / 1,314 articles) — ⚠️ the unit test share is **57.8%, not 30%**, because 09-20 alone holds 58% of the window's units and a day cannot be split without splitting units (the artifact publishes `units_by_earliest_day` so the boundary explains itself); 170 multi-member copy groups; **3,758 of 15,829 candidate pairs straddle (2,272 strong cross-outlet) and are excluded — 5,570 pairs are adjudicable-test, 6,501 adjudicable-dev.** **Baseline reproduced in BOTH arms, conditions stated:** `candidate_stories()` (the same function) per publishable article against the frozen index restricted to stories with a member before it, „strong" = ≥ 2 shared title tokens, „cross-outlet" = the article's domain not among the candidate story's members published BEFORE it — **analysis-side arm (canonical title + summary, `auto_merge_host`'s own inputs): 1,244 of 1,383 (89.9%) have a strong cross-outlet candidate, 949 of them singletons, 1,242 excluding copy twins; raw arm (article title + body): 790 (57.1%), 561 singletons, 766 excluding twins** — against the 67% `auto_merge_host` recorded on 2026-09-02 without defining „strong"; compare the direction, not the digits. Artifacts: the full manifest (2,309 article rows + 15,829 candidate pairs, every `label` NULL) is gitignored under `news/data/analysis/_universe/20260921T234326/`; the committed summary `news/evals/event_universe_2026-09-20_14d.json` carries the counts, split, strata, baseline, definitions and the manifest's sha256. Gate: `test_freeze_event_universe.py` (19; mutation-checked against record-only ids, unit-blind splits, full-membership cross-outlet, an unstamped straddle, a tolerated missing index, a silently overwritten stamp, an open day and a removed stratum refusal). ⚠️ Not done, and stated in the artifact: **nothing is adjudicated** — 0 labelled pairs, so T2.3's gate (≥ 300 accepted test pairs over ≥ 50 events) is unmet; the test split is untouched but unlabelled; the 1.0% model-join arm §15.2 asked to label separately is EMPTY in this window, so it cannot be labelled from this freeze; an earlier freeze of 09-08 → 09-21 was made while 09-21 was still being ingested and was discarded for exactly that reason. |
| **T2.1** — a second candidate and join channel | ✅ | `git log --grep T2.1` (2026-09-22) | Three parts, and only the first touches the auto path. **(1) Union candidate retrieval** — `candidate_stories()` (`analyze_articles.py`, `CANDIDATE_RETRIEVAL_VERSION = union-v1`) no longer awards the six slots by the title-dominated composite (`3 × shared title tokens + min(entity, 3) + date`). It runs five channels on their own evidence — `title` (the old signal), `entities` (weighted, UNCAPPED hits in the text), `case` (the article and the story TITLE name the same T3.3 registered affair, matched under the registry's own stem contract via `cases.has_term` — whole-word matching saw 0 of `narco-pardon`'s 42 articles), `place_time` (a shared non-generic place AND the story's date window), `lede` (the article's first `LEDE_CHARS` = 400 chars against the story title — the body as primary evidence; the analysis-side probe passes the summary as `content`, never as `description`, so the lede channel is not a subset of the title channel) — and fills the slots round-robin from each channel's top, so a story only the entity or case channel can see gets a slot beside the headline matches instead of behind them; the floor is per signal (composite ≥ 3 OR any channel ≥ 3), so date proximity alone still surfaces nothing. Every candidate carries `channels` and `channel_scores`; the composite is kept as the presentation order and every consumer's `score`; the slots are independent of index insertion order. The probe an ANALYSIS record becomes is built once (`analysis_probe`, `story_rule_view`) and shared by the join, the review channel and the harness, and `save_one` computes the candidates once for both. The rule the join stage applies is untouched. **(2) `same_event_evidence(mode="review")`** (`home_event_dedupe.py`, `REVIEW_RULE_VERSION = review-v1`) — the strict rule is byte-identical and the default; review mode relaxes exactly the plan's three vetoes and adds one class, NAMING each in `relaxations`: topic vetoes on the tuple → `topic_agreement ∈ {exact, category, none}` (cross-category passes but is flagged, never promotable before the precision gate); disjoint places → recorded as `place_conflict`, vetoed only for two `local-news` stories in two places (the hard negative); disjoint title digits → recorded, vetoed only for two different four-digit YEARS; `lede_backed` (shared entity + lede Jaccard ≥ 0.35 + ≥ 2 shared title tokens) over the same first 400 chars of `lede_bg` when supplied. The 48 h horizon is not relaxed; `RELAXATION_KINDS` is the one list of names, and `ReviewMode` pins strict ≡ default, review ⊇ strict and „no relaxation where strict accepts" over every fixture pair. **(3) The review channel** — when `auto_merge_host` refuses a `new_story` article, `review_join_candidates()` re-reads its union candidates in review mode and `record_join_proposals()` upserts them ONCE PER BATCH into the gitignored, host-local `news/review/article_join_proposals.json` under an `flock` (`{version, generated_at, counts, items}`; id = sha(url, story_id); `status` and `first_seen` survive runs; a proposal that stops firing is deactivated, and an inactive DECIDED item is retired after 30 days so the file cannot grow without bound; a strict-rule pair proposed with an EMPTY relaxation list is the join stage switched off or retrieval having missed it). ⚠️ It can never fail a save: the channel is isolated in `save_one` and `cmd_save`, a sidecar that cannot be parsed is left untouched and reported in `stats.join_proposal_errors` (a human edits that file), and `analyze_local` carries both `join_proposals` and the errors into the run report. It runs regardless of `NEWS_AUTO_MERGE` — the kill switch stops the JOIN, and blinding the reviewer with it would defeat the channel. Nothing here joins; T2.2 reconciles this file into the tracked story merge queue. **Counterfactual over the T2.0 frozen universe** (`news/scripts/evaluate_join_channels.py`, report `news/evals/join_channels_2026-09-20_991a7825.json`, manifest sha pinned; 0 of 1,383 records drifted since the freeze): retrieval of the pipeline's OWN host for its 179 joined articles — the retired ranking, replayed VERBATIM (`composite-v0`, the function as committed at b89a542f53, not a tie-order reproduction): 128 (71.5%); union 129 (72.1%); the union hits attributed to every channel with a positive score: `title` 128 / `lede` 128 / `entities` 123 / `place_time` 76 / `case` 6; the strict rule would join 5 further articles (0.36%) under either ranking, i.e. widening retrieval alone moves the auto path by almost nothing; the review rule proposes **193 pairs over 159 articles**, of which **149 are pairs the shipped channel would emit** (`new_story` articles; the other 44 are the review rule second-guessing a pipeline join, reported apart) — `lede` 138, `topic:none` 50, `topic:category` 31, `places:disjoint` 15, `numbers:disjoint` 7 — 95 adjudicable-test, 11 straddling. ⚠️ **The finding:** of the 62 copy groups the pipeline filed under two stories (the same text under two mastheads), union retrieval reaches the twin's story for 59 (the retired ranking: 55), **the strict rule accepts 0 of them**, the review rule accepts 34 (28 via `lede`) and 25 are refused by both — the canonical titles the model writes for two copies of one wire differ enough that no title class fires. ⚠️ All of that is CONSISTENCY with the pipeline's own joins, not accuracy: 0 labels, the report says so in `basis`, and no threshold moved on the auto path. Gates: `test_candidate_retrieval.py` (9, mutation-checked: composite-only slots fail the entity-ceiling test; the stem contract and insertion-order independence pinned), `test_home_event_dedupe.py::ReviewMode` (9, mutation-checked: a relaxation leaking into strict fails 8; strict byte-identity and review ⊇ strict over every fixture pair), `test_auto_merge.py::ReviewChannel` (4: kill switch keeps proposals, upsert/deactivate/retire, a broken sidecar refused and left untouched), `test_analyze_articles.py::AutoMergeThroughTheSavePath` (+2 end to end: the sidecar in the save path, and a corrupt sidecar never failing a save — mutation-checked), `test_evaluate_join_channels.py` (6, mutation-checked: a dropped drift check fails; all-drifted and no-join windows refuse; an unreadable manifest is a JSON refusal). ⚠️ Not done: embeddings (item 4) were not added — the lede channel is evaluated first, as the plan asks, and a service needs the cost/provenance decision the plan reserves; no relaxed channel is promoted; the T2.0 baseline summary was frozen under `composite-v0` and now says so. |
| **T2.2** — proposals, review and stable identity | ✅ | `git log --grep T2.2` (2026-09-22) | The conservative auto-accept rule is untouched and `NEWS_AUTO_MERGE=0` stays the only kill switch (this step adds none). **One queue.** `news/review/story_merge_queue.json` keeps its `{version, generated_at, counts, items}` shape; `build_app_data` now folds the T2.1 article-level sidecar into it as STORY PAIRS (`article_channel_proposals`: „article X should join story S" is the pair S ← X's own singleton story, carried with `source: article_review_channel`, `mode`, `rule_version`, `relaxations`, `channels`, `sidecar_id`; refused shapes — no story yet, a story no longer a singleton, the same story — are skipped, never guessed; an unreadable sidecar is reported and skipped, never a build failure), beside the home briefing's strict proposals (`source: home_briefing`). Every item the queue builds from now on carries `source` (the 116 items that pre-date this step carry none until they are re-proposed), and a `decision` (reviewer, when, note, the evidence's `rule_version`, source) written by `apply_story_merges.py --decide <id> --status accepted|rejected --by <reviewer> [--note]` SURVIVES every rebuild — a rebuild that dropped it would turn each accepted merge back into an anonymous one — and is mirrored onto the article-channel sidecar item it came from, so the sidecar stops re-proposing it; a pair already decided in the queue is never re-asked by the fold. The proposal id hashes the SORTED pair, so a prior item's keeper/candidate direction and `source` are kept when a second channel proposes the same pair the other way round — otherwise the apply would retire the wrong published id. Strict evidence now carries `rule_version: strict-v1` (review evidence `review-v1`), so a decision names the rule it was made under. A decision on an item the pipeline no longer proposes needs `--force`; `rejected` on an already-applied merge is refused (the reversal is `--split`). **The two counts reconciled by naming them:** `home_health.counts.merge_proposals` is the number of proposals whose KEEPER is on this build's home page; `merge_queue_pending` / `merge_queue_active` / `merge_queue_from_article_channel` (new) are the durable backlog every channel feeds — the first can be 0 while the second is not, and both say which set they count. **What an applied merge owes** (`apply_story_merges.py`): a REJECTED pair blocks the merge directly and transitively TO ANY DEPTH (code `rejected_pair`) — the check runs over the keeper's and the candidate's `folded_ids` (their own id plus every id ever merged INTO them, walked through every nested `candidate_merge_history`), so A~B, B~C accepted cannot smuggle in an A/C a human refused; a TRANSITIVE merge (`matched` ≠ keeper) is re-read against the KEEPER as the event anchor under the strict then the review rule and refused with code `anchor_mismatch` when it passes neither (`--allow-anchor-miss` overrides, visibly) — a direct merge is the pair the human accepted and is not second-guessed; the retired candidate id is written to `news/config/retired_stories.json` as `{reason: merged, target: keeper}` with a reader-facing note (T1.5's registry, whose uploader REFUSES a release that drops a published id not listed there — an apply that did not write it would have blocked the next publish), BEFORE the candidate's file is deleted, and every entry that pointed at the candidate is re-pointed at the keeper when a keeper is itself merged later (the build refuses a registry whose target is not published — a chained merge used to leave exactly that behind); the keeper records `merge_history` (from, when, proposal, member urls, BOTH titles and summaries, `created_at`, the topics it brought, its nested history, evidence, decision, anchor check) and `--split <candidate-id> --apply` restores the candidate from it — searched through the nested histories, so a story folded through a chain is still recoverable, with its own titles and summaries — moves the members back, takes the topics it brought back out of the keeper, re-points the index, lifts the retirement, marks the proposal `rejected` (`decision.by = split`) so the pair is not re-proposed, and records `split_history`; `--apply` and `--split --apply` take the pipeline's own `news/data/_nightly/pipeline.lock` and refuse when it is held, and the index and the registry are written after EVERY merge, so an interrupted run leaves a consistent corpus; every write reports `needs_rebuild: true`, because aggregates, tones, search, the feed, case pages and prerenders are DERIVED by the next `build_app_data` / `build:news` and nothing is recomputed in place. Gates: `test_apply_story_merges.py` (21; mutation arms run by hand: a depth-1 fold, a skipped re-point, a dropped anchor check, a skipped retirement and an index written once at the end each fail — plus a chained merge the build's own registry gate accepts, an interrupted apply leaving a consistent index, the lock refusal, the guarded decisions and the sidecar mirror), `test_home_event_dedupe.py::OneQueue` (5; a flipped direction and a folded non-singleton each fail their arm), `test_build_app_data.py::OneMergeQueue` (2, end to end through the real build). ⚠️ Not done, stated: the 85 merges applied by the pre-T2.2 script between 2026-09-02 and 2026-09-21 carry no `merge_history` and no registry entry — neither reversible nor redirected by this script; no merge has been applied THROUGH this step on the live corpus (31 pending, 0 decided via `--decide`); the anchor check re-reads the candidate against the keeper's CURRENT frozen title — a keeper whose title drifted before this shipped is validated as it is now. |
| **T2.3** — release on accuracy, monitor cluster shape | ✅ built · ⚠️ gate UNMET | `git log --grep T2.3` (2026-09-22) | `news/scripts/join_accuracy_gate.py` (`npm run news:join:gate`; `--enforce` exits 1 unless the gate is met, and it IS 1 today) and the adjudication contract `news/evals/join_adjudications.json` — pairs drawn from a FROZEN universe (T2.0), each with the manifest sha256, `label ∈ {same_event, different, unclear}`, reviewer, date, the ARTICLE's `event_id` (a `different` pair may also name `story_event_id`) and an optional `hard_negative` (refused on any label but `different`); a duplicate adjudication refuses the whole file. **The file holds ZERO pairs and says so in its own header**: the public eval surface has never received a submission and nobody has adjudicated a pair; the gate is evaluated at n = 0, reported as UNMET with every reason named (`no adjudicated pairs`, `accepted test pairs 0 < 300`, `events 0 < 50`, precision / lower bound undefined), carries top-level `met: false` and `n_usable: 0`, and the report's `status` reads „UNMET — 0 adjudicated pairs; nothing here is a measured accuracy". Nothing was faked: a frontier model may not fill the file, and `test_join_accuracy_gate` asserts the committed file is empty so the day someone labels is visible. What the gate computes, over adjudicated TEST pairs only (development pairs, straddling pairs — cross-checked against the manifest's own `adjudicable_split` stamp, refusing on drift — `unclear`, unknown stories and pairs from another manifest are excluded and counted): pairwise precision / recall of the strict rule with the Wilson 95% lower bound and an EVENT-bootstrap interval (resampling the article event ids, because pairs inside one event are dependent; the interval is withheld, not biased, when fewer than 95% of resamples hold a predicted join), where a pair against the article's OWN pipeline story is scored from the manifest's join (`story_action == same_story`) so a wrong LIVE join labelled `different` is a false positive of the rule rather than nothing; candidate-retrieval recall under the UNION ranking (the counterfactual now persists its candidate keys) with labelled same-event pairs OUTSIDE the retrieved set counting against it; cluster purity over clusters with ≥ 2 labelled members (a one-member cluster is pure by construction and would read as a finding); hard-negative and explicit-reject violations — an explicit reject is a queue decision over a STORY pair, so the adjudicated (article, story) is mapped through the article's own story before lookup — one fails the gate whatever the precision; non-event false matches; and one band per review relaxation scored as a PROMOTION CANDIDATE (strict ∪ band) on the population it would actually auto-join (relaxation set EXACTLY that band, `sole`; the wider `any` beside it), promotable only when its sole population clears the same support, precision and violation floors AND loses nothing against the strict rule on the same labelled pairs — recall globally, and on local news both recall and PRECISION (a superset rule cannot lose recall by construction; what it can lose on local news is precision, the relaxation that joins two councils). Thresholds as the plan states them: ≥ 300 accepted test pairs over ≥ 50 events, precision ≥ 0.99, lower bound ≥ 0.97, zero violations. **The two in-repo priors are folded in, not cleared**: the strict rule's 85 / 90 record (precision 0.944) has a Wilson lower bound of **0.876** at n = 90, printed with `clears_gate: false`; the gold set's shortfall (250 requested, 240 drawn, person cell 40 → 30) is READ from `news/data/gold/gold_set.json` and stated as the reason the support floors may not be attainable from the existing sampler; the old ranking's 0.715 host-retrieval share is carried as a PRIOR under its own name, not as a recall baseline — the baseline a band is judged against is the strict rule on the same labelled pairs. Every figure names its basis (`basis` at the top of the report). **The shape monitor** (same report, `cluster_shape`) reports and requires nothing — measured 2026-09-22 over 3,847 stories: singleton share **91.2%**, multi-outlet comparison share 8.1%, largest cluster 7, review backlog 30 pending, and first-seen-minus-published lag over 3,934 members: median 1.2 h, p90 31.3 h, **11.8% seen more than 24 h after publication** (a backfill share a breaking-news reading must discount; build-side only — `first_seen` is omitted from the public payloads). Report: `news/evals/join_accuracy_2026-09-20_991a7825.json`, pinned to the T2.0 manifest sha and the T2.1 counterfactual (`evaluate_join_channels` now persists its 193 review pairs so a label can be joined to what the rules said about the same pair). Gates: `test_join_accuracy_gate.py` (17; mutation arms run by hand: a precision-only gate, development pairs counting, recall over accepted pairs only, an empty set passing silently, a never-promotable band, a constant purity, the local-news loss not gated, promotion on the `any` population, the pipeline's own joins excluded, band violations ignored, strict violations ignored and `--enforce` ignored — each fails) — including a synthetic adjudicated set that MEETS the gate and a band that IS promotable, so both gates are proven able to pass, and `main()` end to end on an empty file (exit 1 under `--enforce`, report written, `met: false`). ⚠️ Not done, by the plan's own instruction: no threshold is met, no relaxed channel is promoted, the auto-join rule is unchanged, and the annotation the plan asks to budget has not started. |
| **T4.0** — news-person identity before person sentiment | ✅ | `git log --grep T4.0` (2026-09-22) | `news/config/news_persons.json` — a versioned, human-owned identity namespace decoupled from the main site: opaque immutable `news_person_id` (`np_<8 hex>`), BG/EN display names, `disambiguation_{bg,en}` (sourced identity context only, null when unsupported), `identity_sources[]` (url + what it supports + reviewer + time), scoped `aliases[]` (`global` | `case:<slug>` — the raw T3.3 case-RULE match at build time, before fixture verification, i.e. supporting context — | `article:<url>` — a reviewed override asserting EVERY occurrence of that surface in that one article, refused as ambiguous when the identity's own namesake is also named there; each `pending_review` / `accepted` / `rejected` with evidence URLs, reviewer and time), optional `verified_main_site_slug`, `namesakes`, `history`, and `retired_ids` (a merge keeps the retired id as a redirect). Three records: Ивайло Калушев ACTIVE (two identity sources, one accepted global full-name alias; the bare-surname alias is REJECTED in the file because „Калушев“ is two people inside one case), Георги Калушев and Огнян Атанасов PENDING (the latter's full name collides three ways in the corpus, so even its case-scoped alias waits for a reviewer — case membership is supporting context, not proof). `news/scripts/news_persons.py`: `load_registry` refuses a one-NAME-word global alias (an honorific does not make „г-н Калушев“ a full name), a non-list container, an active record without sources / reviewer / an accepted alias, an accepted alias without https evidence, a retired id that does not redirect to a live one; `Resolver` matches an article's person names (the dictionary pass's person mentions as written ∪ `entities.people`) against accepted aliases of ACTIVE identities in an applicable scope — one claim resolves, two claims are REFUSED as `ambiguous_registry`, none is `not_in_registry` — and every resolution carries `identity_version` (registry version + a digest of the id and its accepted-alias set), which a T4.3 treatment must carry so a correction invalidates pairs instead of transferring a tone. Resolution runs at BUILD time (`build_app_data`), so a registry edit re-resolves the whole corpus on the next build — the „changing aliases triggers re-resolution and all dependent rebuilds" rule with no second mechanism; the model minted nothing. Outputs: per article `analysis.news_persons[]` (every person name with its decision; unresolved names stay visible, unlinked, `assessment: not_assessed`, counted), `news/app-data/news_persons.json` (ACTIVE identities only, reviewed fields only — a pending or withdrawn identity never leaves the registry), and the review queue `news/review/news_person_candidates.json` (every recurring unresolved surface with its basis, article count, three example URLs, the identities that collided, every main-site id the dictionary pass resolved the surface to as a reviewer SEED (a set, so a coreference disagreement reaches the reviewer), the row's basis is „ambiguous anywhere“ rather than last-wins, the most frequent spelling labels it, and `single_word` so nobody minds a surname into a global alias; a name seen once is counted, not listed — measured 2026-09-22: 1,566 recurring surfaces over 3,662 articles with person names (7,407 published), 2,785 singletons omitted, 0 ambiguous, 1 pending; the public index exports only redirects into ACTIVE targets, and the build warns on an alias naming an unknown case). The article page renders „Лица в материала“: a resolved name with „идентичност: проверена · не е оценено“ (a scoped alias is said in words — „в рамките на казуса“, „по прегледано изключение“ — never as a raw scope string), an unresolved one with „без проверена идентичност · не е оценено“, nothing linked (profiles are T4.4), and a footnote that identity comes from a reviewed registry and „не е оценено“ is the absence of a judgement. Standalone bundle ships the module and the registry. Gates: `test_news_persons.py` (14; mutation-checked: picking the first ambiguous claim, a pending identity resolving, a global surname alias, a token-counted title gate, an override conflating a namesake, a last-wins queue basis, a pending identity or a pending redirect in the public index each fail), `test_build_app_data.py::NewsPersonIdentity` (2, end to end), `ArticleScreen.test.tsx` (+3). ⚠️ Not done: no treatment (T4.3) and no profile page (T4.4); only one identity is active, and the 1,566 queued names — officials included, most with a main-site seed — await a reviewer rather than a bulk import, because a registry entry is a published claim about a named person. |
| **T5.1** — lead with the event and evidenced differences | ✅ | `git log --grep T5.1` (2026-09-22) | `news/scripts/story_synthesis.py` — a per-story cited synthesis (`RUBRIC_VERSION` `story-synthesis-v1`), cached at `news/data/analysis/synthesis/<id>.json` under `synthesis_key = sha256(rubric, sorted (url, content_sha256))`, so a member's text moving or a rubric change invalidates it and `current_for` attaches NOTHING rather than a stale claim (only `ok`/`empty` documents ship; `failed` is retried next run). The model answers a JSON schema — common / disputed (attributed) / emphasis, each with an article index and a VERBATIM quote — and `gate()` keeps only what the cited articles contain: `quote_found` is a folded CONTIGUOUS span of ≥20 chars (a token bag, a reordering or a dropped negation fails), a common claim needs two DISTINCT outlets, a dispute two attributed quoted sides from two outlets, one emphasis per article; drops are counted and reported, never rendered. Eligibility is by distinct OUTLETS (`single_source` below 2; `pick_members` takes one per outlet first, ≤8). The build attaches by story id from the ANALYSIS story file (`current_for_id`) — the app-data rows carry no `article_path`, and keying off them matched 0 of 70 cached documents. `StorySynthesisBlock` renders three sections with an outlet link + `<q>` per line and the caveat as `role=note`; one outlet → „Според <outlet>: <headline>“ and nothing more; absent / failed / empty / non-`ok` → nothing (the page keeps its headlines and links). Measured 2026-09-22 (GLM-5.3-flash, T=0.1), the FIRST gate over 198 cached documents: 194 ok / 4 failed (truncated JSON — budget raised 1800→3000 tokens); 95 items dropped — 57 „quote not found“, 25 „fewer than two outlets“, 13 „dispute needs two sides“. Review found 13 of the first 40 not-found drops were TRUE quotes differing only in quote-mark glyphs (`„…“` vs `"…"`), each able to take a whole item with it — so the gate now folds quotation marks and dashes on both sides (`_gate_fold`, never in `rm.fold`), strips a prompt label and ONE balanced outer pair (`clean_quote`), and tests containment PER FIELD (title / description / content) so the seam between them is never a source. Regenerated with `--force` under the SECOND gate, measured 2026-09-22 over 234 documents (the 198 plus new multi-outlet stories): 234 ok / 0 failed, 1,428 items kept, 58 dropped — 34 „not found“, 11 „fewer than two outlets“, 13 „dispute needs two sides“ — i.e. 0.25 drops per document against 0.48 under the first gate; of the 34 remaining not-found drops, 19 are fragments under the 20-character floor (correct refusals), 3 differ only by a trailing terminator or ellipsis (folded off the quote since, recovered on the next regeneration) and 12 are genuinely absent from the cited article. The cache is gitignored, so the figures are a dated run, not a committed corpus. 17 Python + 5 vitest tests, all mutation-checked; `--data-dir` now threads through the cache dir and article paths. Also: `home_health.py` now carries the T2.2 `merge_queue_*` counts through the verifier — the gate had failed on every real build since T2.2 because it re-measured only `recent_*`. |
| **T5.2** — port `StoryCard`'s divergence guard to `StoryScreen` | ✅ | `git log --grep T5.2` (2026-09-22) | `newsapp/app/storyDivergence.ts` is the ONE state table for both surfaces: `none` (no positioned label) → `single_source` (every positioned label from one outlet) → `uniform` (≥2 outlets, one label — „matching framing is not agreement on facts“, said in the sentence) → `distribution` (≥2 outlets, ≥2 labels). The unit is the OUTLET, and this is NEW logic, not a port: the card counted distinct LABELS, so two articles from one outlet with different labels passed as „framing differs“. `StoryScreen` renders a `DivergenceNote` beside each bar (`data-state`), which also states that the bar's segments count ARTICLES, not outlets; the bars keep the mixed per-outlet distribution and `AggregateCompleteness` keeps its „distinct assessed domains“ basis. The CARD gets the same rule through two new aggregate fields both independent writers emit and the release reconciles — `leaning_outlets` / `russia_stance_outlets`, distinct outlets holding a positioned label — and on a bundle built before they existed `aggregateDivergence` says LESS (single-source), never the label rule, so card and page can differ only in the direction of the card claiming nothing. `not_applicable` is a position on neither count. ⚠️ `DivergenceNote` counts outlets WITH A POSITION; `AggregateCompleteness` counts outlets with ANY verdict (`not_applicable` included) — the two adjacent figures differ by design whenever an out-of-scope verdict exists (every `none` and `single_source` story today), and the copy names the basis of each („източника с позиция“ vs the completeness line); do not „fix“ one to match the other. The card's number is the positioned count for the axis the cue is about („2 медии от 5 · сходно рамкиране“), because the verdict is about those outlets — measured 2026-09-22, 12 live cards differ. Measured 2026-09-22 over the 334 multi-outlet stories, leaning axis: 245 uniform, 49 none, 25 single-source, 15 distribution — and 0 stories the label rule called „differs“ that the outlet rule does not, so the correction is a guard against a future shape rather than a live retraction. Overlay vectors regenerated (the aggregate shape moved them). 7 + 3 + 1 vitest, 1 Python, all mutation-checked. |
| **T5.3** — stop hiding `not_applicable` | ✅ | `git log --grep T5.3` (2026-09-22) | The sentence, not the segment: `OutsideAxisNote` in `StoryScreen.tsx` prints „N от M материала е/са извън тази ос — оценката е, че текстът не заема позиция по нея“ (the verb agrees with N, the noun with M; the actor is unnamed because the served verdict is the EFFECTIVE one — model resolved against editorial adjudication) immediately under the bar it explains, per axis, and only when N > 0 — so it appears under the axis that collapsed and NOT under the one that did not (the reason it lives beside the bar in `StoryScreen`, where the segment groups are built, rather than in `AggregateCompleteness`, which is rendered under both axes). A muted segment was not drawn: the bar's segments are filters over the chronology and „extra ос“ is not a position to filter by. N is `notApplicable` from `axisCompleteness` — an UNASSESSED article (no verdict) is a different absence, stays on the completeness line as „без стойност“, and is never counted as judged out of scope (mutation-checked); DOM placement and the EN branch are asserted. 3 vitest. |
| **T5.4** — one completeness sentence, once | ✅ | `git log --grep T5.4` (2026-09-22) | `AggregateCompleteness` now takes a LIST of axes and renders ONE strip: the sentence (`completenessSentence` — „Оценени са и двата материала.“ / „…всички N материала.“ / „…X от N материала.“, and when the axes DIFFER the per-axis counts stay adjacent in the one sentence: „Оценени са 2 от 3 материала по политическо рамкиране и 1 от 3 по позиция спрямо Русия.“) plus an accessible `<details>` carrying each axis's granular breakdown (assessed · outlets · on the spectrum · not applicable · without a value), the rubric id `news-article-evaluation-v1` (`COMPLETENESS_RUBRIC_ID`) and the aggregation date. `StoryScreen` owns the disclosure state (`completenessOpen`, reset on story change) and renders the strip ONCE after both bars — the two per-axis call sites are gone — so it cannot be open under one axis and closed under the other. The component stays axis-agnostic and keeps the „distinct assessed domains“ definition; the raw „извън обхвата“ count now appears only inside the disclosure (T5.3's sentence beside the bar is the reader-facing one). „Unknown“ is NOT repeated beside the assessed figure — assessed + total already implies it, and the per-axis „без стойност“ count sits in the disclosure. The verb follows N and the noun M (`newsapp/app/plural.ts`, shared with T5.3's note; „Оценен е 1 от 3 материала.“), zero is said as an absence („Нито един от 3 материала не е оценен.“), and each axis carries its own denominator. Fails closed: no axes / an empty story → „Няма оценени материали.“ 3 + 3 vitest, mutation-checked (collapsing differing axes; ignoring the owner's `open`; the toggle reporting a constant; the disclosure surviving a story change). |
| **T5.5** — make the timeline a timeline | ✅ | `git log --grep T5.5` (2026-09-22) | `newsapp/app/components/StoryTimeline.tsx` replaces the flat `StoryMemberRow` list under „Източници и хронология“: a DATED RAIL in the PUBLICATION timezone (`NEWS_TZ` = Europe/Sofia — the day an outlet published on must not move with the reader's clock; `formatDate`/`relativeTime` stay browser-local because they stamp one moment, never a grouping) — one calendar-day heading (`groupByDay`, order-independent, first-appearance order, undated members LAST under their own „Без дата на публикуване“ heading rather than sorted into a day they never had), then per item the clock time (`formatTime`, `<time dateTime>`), the outlet's mark and name (link to `/outlet/:domain`), the „първи тук“ chip when the scoop is decidable, the headline (article page, else the original), the framing chips (`LeanBadge` / `StanceBadge`) and the link-out. Same fields in the same order on every row — this is where the reader compares. ⚠️ Two things are deliberately NOT here: the outlet MARK is a monogram, never the registry logo, because `imageCredit.test.ts` allows a raw `<img>` in `ArticleImage` alone (an attribution invariant, not a rights call) and a hotlinked logo in a list row would be its first exception; and the per-source PERSON-TREATMENT chip the plan names „once T4 lands“ is absent because T4.0 shipped identity only — person sentiment (T4.1+) has not shipped, so there is nothing evidenced to put in it. The headline-out and link-out anchors are the shared `ExternalHeadline` / `OriginalLink` from `ArticleRow.tsx` (which still serves `ArticleScreen`), so the „opens in a new tab“ announcement cannot drift; day headings are `<h3>`s, not nested `region` landmarks. The bar filters still drive the list; an empty filter result is said. 6 vitest, mutation-checked (browser-local day under a UTC-pinned test; adjacent-only folding; the chip keyed on `first_here` alone). |
| **T5.6** — de-jargon, one pass, both languages | ✅ | `git log --grep T5.6` (2026-09-22) | On the story page: „клъстер“/„cluster“ → „група материали“/„group of articles“ in all three strings (the retired-story hint, the summary caveat, and the sidebar's „Най-ранна дата в клъстера“ → „Най-ранен материал“); the completeness disclosure's tag row („2 в спектъра · 1 извън обхвата · 0 без стойност“) → one plain sentence per axis (`axisBreakdown`: „Оценени 2 от 3 материала (от 1 източник): 1 заема позиция, 1 не заема позиция по тази ос; 1 не е оценен.“, verbs agreeing, EN twin) — every figure kept, no rubric vocabulary left in reader-facing copy; the T5.2 none-state parenthesis now says „оценката „не заема позиция“ не е позиция“ (EN: „a “takes no position” verdict“ — no „not applicable“ left in reader copy). Zero parts are OMITTED from the breakdown sentence, and the „Обхват“ card says „Материали“ so the page uses one noun. `LEAN_GROUPS` no longer carries inline Bulgarian: both languages read `leaningMeta(meta, language).short` from `labels.ts`, so the bar segment carries the SAME short form as the badge on every row and BG/EN are in one register (EN was reading `.label`, „Progressive framing“, while BG hardcoded „Прогресивно“). `TopicsScreen`'s „извън обхвата“ at `:598` is an unrelated out-of-scope badge and untouched; ⚠️ „дисперсия“ on `TopicsScreen` is RETAINED as the plan directs (`6289ba8e96`), not re-litigated. 1 + 1 vitest, mutation-checked (inline BG labels; `.label` instead of `.short`). |
| **T5.7** — a filtered-empty timeline needs a way out | ✅ | `git log --grep T5.7` (2026-09-22) | `StoryTimeline` takes an optional `onShowAll`; when the filtered list is empty it says WHY — „Няма материали, които да са едновременно в избраните сегменти по двете оси.“ (the list can only empty when BOTH axes are selected and their intersection is empty: a segment exists only with a count, so one axis alone always leaves a row) — and renders „Покажи всички — изчиства избора и по двете оси“, a button whose label names exactly what it resets. — an invariant of the PAGE's segment builders, not of the component, which is why `StoryScreen` passes the handler only while a selection is active; without it the empty state says „Няма материали.“ (an empty story), and the one render between a story switch and the effect that resets the previous filters is the known, self-healing exception. The handler clears BOTH filters and emits ONE `story_filter { axis: "both", active: false }` event — distinct from two per-axis clears (the `home_filter` `reset` precedent), so „hit an empty intersection and bailed“ is countable. The empty state is a `role=status` so the bar toggle that emptied the list is announced; the button is the shared `Button`. No handler → no button (the component never promises a reset it cannot perform). 3 + 1 vitest (EN included), mutation-checked (clearing one axis only leaves the other segment pressed and the list narrowed; a reset offered with nothing to clear). |
| **T5.8** — make comparison an action | ✅ | `git log --grep T5.8` (2026-09-22) | Under „Как се различава отразяването“ every source headline carries a checkbox („Сравни: <outlet>“); tick 2–3 and `StoryCompare` aligns them FIELD BY FIELD — source (link) with the REGISTERED owner and its registry source when `publishableOwner` clears it (else „няма проверена справка“), published / declared-updated time, headline (article page + the shared `OriginalLink`), the build's own brief summary from the outlet bundle (or „още не е оценен“ / „зарежда се…“), the T5.1 spans the gate cited from THAT article (or „обобщението не цитира този материал“), and the two framing badges (text label beside the colour, or „не е оценено“). Two layouts, one data model: a `<table>` with sticky source column heads on `md+`, a stack per source with a sticky source label below it — same fields, same order. Selection is URL state (`?compare=domain/article_id,…`, `storyCompare.ts`): keys naming no selectable member of THIS story are dropped on read, duplicates folded, capped at 3, a fourth pick REFUSED (the un-ticked boxes disable and say „най-много 3“) rather than evicting one; „Изчисти сравнението“ clears it; one tick shows „Отбележете още един източник“. A member with no article page is not selectable (nothing to align). Analytics: ONE `story_compare { sources: 2|3 }` per comparison reached — editing 2→3→2 is one comparison, dropping below the minimum re-arms it (a ref, not the count, decides). The Share button carries `?compare=` (an optional `search` on `ReaderActions`), so the shared link IS the comparison. The three `useOutletArticles` slots are positional and `useData` keeps the previous path's bundle while the next loads, so a slot is read only when its bundle's `domain` matches the member — a stale bundle reads as „зарежда се…“, never „още не е оценен“. Cost, measured 2026-09-22: up to three outlet bundles per comparison, the largest `fakti.bg.json` at 3.95 MB raw / 873 KB gzip (`actualno.com` 3.63 MB, `petel.bg` 3.46 MB) — the same mechanism `ArticleScreen` uses for one; a per-article sidecar carrying `summary_*` / `updated` is the follow-up that would retire the slots. On desktop the source cells are `sticky` against the PAGE scroll (no overflow wrapper — that would become the scroll container and pin nothing); on a phone the source label of each stack sticks. The visible outlet name is the checkbox's `<label>`, and at the cap the reason „(най-много 3)“ is printed, not only announced. ⚠️ Two rows the plan names are ABSENT and the page says so: article GENRE (no field in the corpus — `ArticleRecord` carries `section_path`, not a genre; „when known“ is never) and the selected PERSON's treatment (T4.1+ unshipped). Nothing is republished: the summary and quotes are what the build already serves. 360 px / desktop: verified as the two layouts' `md:` split in jsdom (both render; the stack is asserted `md:hidden`, the table `hidden md:block`) — a real-viewport check is not something the suite can do. BG and EN both tested. 4 + 2 + 6 + 1 vitest, mutation-checked (fourth pick evicting; foreign URL keys rendered; cap not disabling; a stale slot read as „not assessed“; an event per edit). |
| **T1.4** — exact reachability gate | ✅ | `c8f2c063ba` | `npm run news:reachability[:gate]`, in `news:release:gate`. Set equality per fixture, not a ratio; N/A ≠ 100%; corpus-shrink refusal against a committed baseline; whole-corpus facet drift; the article funnel reported in ARTICLES with both residue directions. 14 fixtures, 0 failing, coverage 1.000. Ten mutations, ten caught. |
| **T4.1a/d** — party-tone evidence | ✅ partial — see §15.5 | `fc9d86d829` `89eb91f94d` | v3 contract: `rationale` (prose a reader sees) split from `evidence_spans` (located provenance, the only thing the gate checks); `party_tone_published()` is the ONE definition shared by the bundle and the review queue; the v2→v3 migration NEVER manufactures a span. ⚠️ `leaning`/`russia_stance` still take prose `evidence`; the full-text rule is unimplemented. |
| **T4.1b** — the evidence contract on both AXES | ✅ | `git log --grep T4.1b` (2026-09-22) | `leaning` and `russia_stance` now take the v3 party-tone contract: `rationale` (prose, never matched) + `evidence_spans[]` whose `direction` is the SIDE of the axis (`progressive`/`conservative`, `pro_russia`/`anti_russia` — `AXIS_SPAN_DIRECTIONS`). A positioned label needs a span on its side; `neutral` and `not_applicable` carry none (an absence is not provable by a quote). Prompt §2/§3, GBNF and JSON schema regenerated from the same constants (`build_prompts.py`); `validate_axis_evidence` refuses the two-contract record, a supplied `evidence_grounded`, and a span on the wrong side. `gate_axis_evidence` locates every v2 span in the hashed snapshot at save and stamps `evidence_grounded` + `axis_evidence_gate_version = 2`. `axis_label_published` is the ONE publish predicate: a v2 positioned label with no located span on its side is WITHHELD on the public copy — `label: null`, `withheld_reason: unsupported_evidence`, rationale and spans still shipped — never downgraded to neutral („quote-missing … is never neutral“); `build_app_data` fails closed to `gate_unavailable`, the story copy carries the public block so the member is `null`, and every distribution — story `by_leaning` / positioned outlets, the per-outlet spectrum, the per-topic axis spread — reads the PUBLIC label and counts nothing withheld. The review queue asks about a withheld axis label through the same predicate (the only path by which a human accepts a paraphrase the gate cannot locate); a human acceptance trusts the SAVED decision, never skips it (`unable_to_judge` leaves an unsupported label withheld), exactly as `party_tone_published`. LEGACY records (every record on disk today — the corpus has 0 v2 axis blocks until the next analysis run) keep `evidence` readable and are judged by no rule, exactly as party tones' legacy path. The article page renders the rationale, each span with field · voice(·speaker) · found/not-found (unlocated struck through), and the withheld state in words; „grounded“ is stated as provenance only, nowhere as verification. Not done and still owed: the full-text rule (T4.1c, next) and the separately published yield / accuracy / abstention (T4.5). 4 + 1 Python, 1 vitest, mutation-checked (never withhold; every span supports; publish the unsupported label). |
| **T4.1c** — text scope and the full-text rule | ✅ (abstain arm) | `git log --grep T4.1c` (2026-09-22) | `text_scope` is stamped on every analysis at save (`text_scope_of`; refused when supplied by the model) and computed at build for records predating it. THREE kinds: `full`; `prefix` (the runner's first 6,000 chars of a longer body — `basis: provenance` from `analysis_provenance.body_truncated`, or `inferred` for a runner record from before the flag, which carries the provenance dict so the fixed prefix was in force); and `unrecorded` — a record with NO provenance dict at all (the 2026-08-23 skill-era GLM-5.3 and codex-gpt-5 records, whose analyst was told to read the whole file and whose coverage nobody wrote down), which gets NO figure. ⚠️ The first cut inferred a 6,000-char prefix onto those 371 records — 24 of them over 6,000 chars would have printed „първите 6 000 от N знака“ about a read that was never a prefix; review caught it. THE RULE (`rollup_eligible`, ONE definition on each side — Python takes a member or an analysis, `isScopedObservation` on the client): only a `full` record enters a whole-article tone rollup. Everything else is a SCOPED OBSERVATION — its labels show on its own page under a note (figures only when both were measured and the read really was partial; otherwise „обхватът … не е записан“, never „0 от 0“), its badges carry a dashed „частично“ / „незаписан обхват“ mark on the timeline and in the comparison — and it enters NONE of: story `by_leaning` / `by_russia_stance` / `by_party_tone` / positioned outlets (both writers, reconciled on `text_scope` too), the per-outlet spectrum, the per-topic axis spread, the case framing (`cases.framing_of`), the blindspot (`blindspot_of` — a scoped voice neither creates nor fills one), the story page's bar segments, the T5.2 divergence state, the `--stats` distributions (own line `not_full_scope`), and the completeness sentence, which reports it as its own bucket („1 не е оценен върху целия текст и не се брои“ — no figure, since the limit is per-record data; plan T4.4's partial-scope count, separate from assessed and unavailable). Members carry `text_scope`, aggregates and case framing carry `prefix_scope_count`. Measured 2026-09-22 on the served corpus (8,197 analyses): 7,087 full, 739 prefix, 371 unrecorded; 695 members across 653 stories left the rollups. ⚠️ The plan allows „abstain OR schedule a bounded full-text/chunked pass“; this ships the ABSTAIN arm only — the chunked pass, with covered ranges and dedup, is NOT built, and every prefix or unrecorded article is a candidate for it. Overlay vectors regenerated. 4 + 4 Python (+2 save assertions), 2 + 2 + 2 + 1 + 1 vitest, mutation-checked (skill-era record given a prefix; prefix counted in story/outlet/topic/case/blindspot; drawn as a segment; counted as an outlet; counted as assessed; a figure printed for an unrecorded read). |

**Not started:** T1.1 (largely pre-existing),
T4.2–T4.5, T6.x, T7.x.

✅ **The half of R1 that T1.3b could not finish is now T1.3c above.** Until it landed the
news app had no browse route — `/`, `/story/:id`, `/outlets`, `/outlet/:domain`, `/topics`,
`/methodology`, `/corrections`, `/evals` was the whole table — so the corpus was reachable
by the gate and not by a reader. Two things the browse deliberately does NOT do: it does not
search the whole corpus (the index carries no titles — §T1.3 — so the search box names how
many hydrated rows it saw), and it does not re-rank under an overlay (the client cannot
re-score prominence; a ranked browse under a hot release says its order is the base's).

---

## 1. What we measured

### 1.1 R1 — "only 13 stories in 24h" is one constant

| | |
| --- | --- |
| articles stored for 2026-09-20 | **1,296** measured; ⚠️ **1,300** by `published`, 1,527 by `fetched_at` — the plan never states the basis, and the two differ |
| analyses written that day | **2,114** (hourly runs, ~90 each) |
| stories with `last_published` on 2026-09-20 | **676** |
| stories published to `home.json` | **16** |
| of those, inside the app's 24h chip | **13–16, and the count moves** 🔍 mechanism confirmed, `exactly 3` **not** measured: `home.json` selects 16 stories across `HOME_WINDOW_DAYS = 30`; `HomeScreen.tsx` then applies `filterHomeStories(..., { days })` → `storyWithinDays(story.last_published, days, Date.now())` against the **reader's** clock, and `days` comes from `defaultHomeDays()`. At build all 16 are inside 24h — the bundle's own `home_health` says oldest 4.33 h, `selected_within_24h: 16`, `default_visible: 16` — so 13 is a function of *when the reader looks*, not a property of the bundle |

⚠️ **The story count is a function of the reader's clock, and it dips and then jumps.** Two
mechanisms, both verified in code — plus a third path noted at the end:

- `filterHomeStories` reduces to `storyWithinDays(last_published, days, now)` with
  `now = Date.now()`, refreshed every 60 s (`HomeScreen.tsx:65-73`). Nothing else filters a
  story out — `not-site-relevant` is removed from the *category chips*, not from the stories.
- `days` defaults to `defaultHomeDays()`, which returns **1** while ≥6 stories sit inside 24h
  and **7** otherwise (`homeFilters.ts:36-44`).

The visible count changes as articles age out. An automatically chosen window can widen
from one to seven days below the six-story threshold; an explicitly selected 24h window
must not widen. Dismissed stories (`briefingPreferences.completedStoryIds`) independently
change the visible selection. The exact count requires the bundle, reader clock, window
selection and dismissal state; the historical “13” is not a stable build property.
T1.3 pins `as_of` for each browse snapshot, so paging remains stable until refresh; a fresh
snapshot can legitimately have a different count.

The cap is `HOME_STORY_LIMIT = 16` (`news/scripts/build_app_data.py:1146`), bounded by
`HOME_GZIP_BUDGET_BYTES = 33 KiB` (`:1166`; the plan cited `:1163`) — the build **raises**
above it.

⚠️ **The byte budget is not what binds, and this changes T1.1/T1.2.** Measured on the
committed build, `home_gzip_size()` returns **13,360 bytes** against the **33,792-byte**
budget — 39.5% used, **2.5× headroom**. The gate is real
(`scripts/news_performance_budget.ts`, `homeJsonGzip: 33 * 1024`) but its own comment still
records 30,727 bytes (90.9%) from 2026-09-02, *before* the `HOME_OMIT` projection dropped the
`analysis` field — which the code comment at `build_app_data.py:1189` measures at **54% of
the bundle**. So "the number cannot simply be raised" is **refuted by the artifact**: the 16
is a product choice, not a byte ceiling. Re-measure and restate the ceiling rather than
repeating the old ratio.

⚠️ Four constants govern this number and appear nowhere in the plan: `HOME_ITEM_LIMIT = 32`;
`HOME_WINDOW_DAYS = 30` — **the eligibility window is 30 days, not 24h**, so "676 a day" and
"16" are different windows and must not be divided into one another; `HOME_MAX_STORIES_PER_OUTLET = 4`;
`HOME_MIN_COMPARISON_STORIES = 4`. The last two are a deliberate anti-dominance policy (the
code comment records dir.bg holding 15 of 16 slots on 2026-09-02). T1.2's prominence rank
must **preserve or explicitly replace** that policy; it cannot silently drop it.

⚠️ The "24h chip" is not fixed either: `news/scripts/home_health.py` gates
`MIN_DEFAULT_STORIES = 6` / `MAX_DEFAULT_DAYS = 7`, so the default window **widens implicitly
up to a week** on a quiet day. It also carries `FUTURE_ANCHOR_TOLERANCE_HOURS = 12` because a
2026-09-02 run published an **empty** home payload when date-only stamps read as future. The
empty/failed states T1.4 asks for are already load-bearing.

`home.json` is the only **story/article feed** the home screen reads
(`newsapp/app/data.ts:1895`, inside `useHome`) — though HomeScreen also fetches
`taxonomy.json`, `outlets.json` and `stats.json`. ⚠️ `/latest.json` (846 KB) and
`/stories.json` (8.8 MB / **2.0 MB gzipped**) both exist. In the browser runtime neither is
fetched by active pages (`useLatest` is reached only from the withdrawn `SavedScreen`, `useStories`
only from tests). 🔍 **However, both have a critical build-time consumer**: `newsapp/prerenderRoutes.ts:261,309`
reads `stories.json` to generate prerender `<head>` metadata for stories and sitemap entries only where `outletCount >= 2`,
and `latest.json` for articles. Retiring `stories.json` requires migrating `prerenderRoutes.ts` to
read the partitioned index (`stories/index-*.json`); deleting it prematurely would break SEO for the entire corpus.

⚠️ **A paginated index already exists; T1.1 must extend it, not build beside it.**
`write_story_pages()` (`build_app_data.py:864`) already emits `stories/index-<n>.json`
(13 pages × `STORY_PAGE_SIZE = 200`, `total: 2574`), a ~1.4 KB `stories/<id>.json` per story,
and `stories/by-url.json`, explicitly to end the 1,456 KB-per-screen `stories.json` fetch. The
data is published; 🔍 **and `useStoryIndexPage` + `useStoryList` ARE already wired in production** —
`newsapp/app/screens/OutletScreen.tsx:332` consumes `useStoryList()`, revealing the first 200 stories
and filtering them client-side. The consumer that has not yet opted in is `HomeScreen.tsx`! Furthermore,
`OutletScreen` exposes the exact hazard T1.3 warns about: filtering client-side over only the revealed
index pages hides an outlet's older stories until the user clicks "load more". T1.1/T1.3 is therefore a
*unified global query/filter contract* over an existing, hashed, served contract.
Note the existing 200-story page gzips to **~51 KB**, i.e. slightly above the 50 KiB ceiling T1.1
proposes; adjusting `STORY_PAGE_SIZE` to **150** (~38 KiB gzip in the sampled first page) reduces bytes per request but increases full-index
round trips; T1.1 must gate every page, not extrapolate from the first.

**The home selection is much smaller than the story archive.** The 16 selected over a
30-day eligibility window and the 676 dated stories are not a valid same-window ratio. ⚠️ "Unreachable" overstates it: all
2,574 stories are reachable by URL through the existing index and detail files; what is
missing is a ranked, faceted, filter-before-page listing. Ingestion, analysis and clustering
are producing more than the *home selection* ships. The hourly analyse budget is 100/hr
≈ 2,400/day against ~1,300/day intake (`news/standalone/run_hourly.sh`).

✅ **Re-confirmed independently on the later 00:38Z build (§15.1): `home.json` gzips to
13,377 of 33,792 bytes, 39.6% used.** The byte ceiling is slack, and `HOME_STORY_LIMIT = 16`
is a product choice. ⚠️ Related premise now stale: `news-jev-realtime-cloud-worker-v1.md` §0's
"the pipeline is not running … nor did one ever" is **false as of 2026-09-19** — two launchd
agents are installed and firing hourly with `pipeline_exit: 0` (§15.3).

⚠️ The claim that 49.4% analysed is "a closing backlog … not a live throttle" is
**unverified**: the same build's 30-day window holds 2,618 analysed of 6,752 recent
(`home_health.counts`), i.e. 38.8% — *lower* than the lifetime rate. Report an intake/analysis
series before asserting the direction.

### 1.2 R0 — there is no popularity signal anywhere

`newsapp/app/homeHierarchy.ts` ranks by `last_published` desc, with `outlet_count` only as
a tiebreak *inside* a 24h bucket ⚠️ — **that describes the LEAD arm only** (`leadRankIn`).
The supporting arm (`supportingRank`) has **no bucket**: `last_published` first,
`outlet_count` second. The build-side `select_home_payload` uses a third key
(`last_published`, then `outlet_count`, then id) before `HOME_MAX_STORIES_PER_OUTLET`
diversification. Any T1.2 replacement must reconcile all three, not one.

There is no view count, no velocity and no cross-outlet breadth as a **primary** key.
`newsapp/app/analytics.ts` emits typed events to an optional host sink
(`window.naiasnoNewsAnalytics`) that ⚠️ **nothing installs in production** — the property is
set only in tests. "Nothing reads them back" is confirmed, and the reason is a missing sink,
not a missing event contract (see §12). The consequence is visible in the live bundle: the
build ran at 23:25 UTC and the feed is late-night foreign wire (Macron/Carney,
Trump/Zelensky, Finnish bunkers), while the day's most-covered domestic stories sat below
the cut.

**Reuse the observed timestamps, not the scoop winner decision.** `attach_scoop_lag()`
(`build_app_data.py`) already emits `first_seen` from stored `fetched_at`, plus
`scoop_lag_hours`, `scoop_decidable` and `first_here`. The latter fields describe whether a
relative first-observed lead is distinguishable. They do not measure arrival velocity:
several outlets first observed in the same hour contribute to velocity even when no winner
is decidable. The saver preserves the original `fetched_at` on updates; imports/backfills
still need provenance before these timestamps can be interpreted as new coverage.
Timestamp fields are omitted from public feed projections today; explicitly add any needed
reader-facing freshness fields rather than assuming they already ship. See T1.2 for missing
dates, ingestion bias and backfill handling.

Ranked by coverage breadth instead, the same 24h window contains — ⚠️ but does **not lead
with** — two **Петрохан** stories at 3 outlets each. Re-measured, the breadth leaders of that
window are two 5-outlet stories (AfD/Mecklenburg, Trump/Camp David), then four 4-outlet
stories, and the two Петрохан stories follow at 3. The pair is real; the "leads" framing is
not, and it is the kind of overstatement this plan exists to avoid.

### 1.3 R3 — Петрохан is in the corpus; the clustering shatters it

91 raw articles published 2026-09-20/21 mention Петрохан (the plan said 92; all on 09-20,
none on 09-21) — ⚠️ **161** analysis records mention it, not 273 (the widest defensible
reading, analysis *article* files plus *story* files, gives 274; no single reading produces
273). They are **not missing — they are fragmented into ~113 separate stories** (the plan said
~109), including near-identical Андрей Янкулов interviews; ⚠️ there are **three** such stories
(one 3-outlet, two 1-outlet), not two. Treat the original 92/273/~109 triple as stale and
re-measure from a frozen universe (T2.0).

⚠️ **The fact the plan omits, and it is larger than the 16-story cap: the biggest suppression
happens upstream, is model-driven, and has never been reviewed.** The audited build's funnel:

| stage | records |
| --- | ---: |
| analyses written | 5,015 |
| …`quality.verdict == "ok"` | 4,824 |
| …and `site_relevant is True` | 2,883 |
| stories built (holding 2,876 member articles) | 2,574 |
| stories on the home page | 16 |

`validate_publishable_analysis()` (`build_app_data.py:1843`) **raises** on
`quality.verdict != "ok"` and on `site_relevant is not True`, so those records can never enter
a story, a feed, a case or a coverage comparison. The model's own `site_relevant` verdict
removes **1,941** quality-ok analyses — **40.2% of the quality-ok corpus** (38.7% of everything
analysed) — and the taxonomy
carries a `not-site-relevant` category that both `HomeScreen` and `TopicsScreen` additionally
filter out of the chips. That cut appears nowhere in this plan. R0/R1 cannot be answered
without it: "the feed shows 16" is a cap someone chose; "two fifths of the analysed corpus
never becomes a story" is a model verdict nobody has published.

**Topic and relevance outputs are coupled, but feed selection and clustering are separate
stages.** The prompt requires `site_relevant: false` exactly for a `not-site-relevant`
primary category. The validator checks those separate fields and excludes false records
from stories. A taxonomy correction across that boundary must therefore update relevance
and story eligibility too. It does not follow that missing presidential categories,
event fragmentation and a 16-card home cap are one defect. T1's query work and T3's taxonomy
work can proceed in parallel; their final acceptance must use one corrected corpus.

🔍 **The `not-site-relevant` boundary needs labelled evaluation, not inference from keyword totals.**
⚠️ **This is the most important correction in §14.2, because acting on the original claim would have sent
T3 after the wrong defect.** Pass 3 asserted that the classifier "routinely" files political scandals as
„черна хроника", dropping Петрохан and the pardon before clustering. Measured over **all 5,095 analyses**
(2026-09-21T00:31Z build), searching `summary_bg`/`summary_en`/`topics`/`entities`/`mentions`:

| term | records | `site_relevant: true` | `false` |
| --- | ---: | ---: | ---: |
| Петрохан | 150 | **131** | 19 |
| Калушев | 71 | **53** | 18 |
| помилва (pardon) | 46 | **44** | 2 |
| нарко | 73 | 43 | 30 |

The checked keyword subset has story IDs on the `true` records and none on the `false`
records. Some matches are unrelated foreign stories; the excluded records also include
crime-detail labels. These observations do not independently establish whether exclusions
are correct: model labels are not gold labels. Home selection and fragmentation explain
some missing visibility; sample both included and excluded articles with human relevance
labels before attributing the remaining share. The earlier “border shootings” example was
not reproducible and is withdrawn.

What *is* confirmed is the **taxonomy** failure, and it is R2's defect, not R3's: the mediapool.bg record
„Борисов: … „Петрохан" и помилван наркодилър" is `site_relevant: true` with primary topics
`elections-parliamentary/campaign` **and** `government/coalition-politics` — pardon coverage filed under the
**parliamentary** election because Йотова was tagged as an electoral figure. That is precisely what T3.1/T3.2
address, and it is the strongest evidence for them.

The boundary itself, with pass 3's citations corrected: the category is `topics.json:1716-1801`
(`"site_relevant": false` at `:1722`) with subcategories `weather`, `sports`, `celebrities`,
**`crime-blotter`** („Битова престъпност и произшествия", `:1775`) and `misc-filler`; the `how_to_use`
entries at `:12-17` describe the effect rather than defining the category. ⚠️ „черна хроника" appears
**nowhere in `topics.json`** — it is the prompt's phrase (`analyze_system.md:134-136`), and that same prompt
**explicitly carves out the very case pass 3 worried about**: „Разследване на служебно лице или КПКОНПИ
**НЕ** е черна хроника." A claim that the classifier routinely violates an explicit carve-out needs
measurements of violations; what was measured here is the rule.

`site_relevant` is a **separate model output validated against the primary topic** — not a pure derivation —
at `analyze_articles.py:1542-1545` (schema at `build_prompts.py:207`): 2,006 not-site-relevant→false, 2,929
civic-primary→true, **zero contradictions** where a primary exists. Exclusion is then enforced twice
(`analyze_articles.py:1558-1559` forces `story.action = "none"`; `build_app_data.py:1848` refuses any
non-`true` record). The cut is real and large; its accuracy remains to be measured against independent labels.

**Re-scoped task:** measure and publish the `quality`/`site_relevant` funnel, and audit possible errors around the boundary — `crime-blotter` / „черна хроника" (30 of the 73 „нарко" records are
`false`) — sampling both sides of that cut before treating any absence as a sourcing fact.

Corpus-wide, this is the dominant shape:

| story size | stories |
| --- | ---: |
| 1 article | **2,361 (91.7%)** |
| 2 | 154 |
| 3 | 42 |
| 4–7 | 17 |

**82.1% of all analysed articles sit in a one-article story.** ⚠️ The percentage is right, the
basis is not: 82.1% is 2,361 of the **2,876 articles attached to a story**. Over all 5,005
analyses it is 47.2%; over the 2,883 site-relevant ones it is ≈82%. The histogram itself
reproduces exactly and the story denominator is **2,574** — the 2,588 "story files" the plan
quotes elsewhere are 2,574 stories + 13 index pages + `by-url.json`, and dividing stories by
files is what produces the 91.8% single-outlet figure below (it is **92.3%** of 2,574). The
largest cluster in the entire corpus is 7. A product whose premise is "compare how outlets
covered this" has almost nothing to compare.

🔍 **The exact anatomy of the clustering collapse in `same_event_evidence()` (`home_event_dedupe.py:85-126`):**
The binding rule evaluates pairs within a 48h window (`gap_hours > MAX_EVENT_GAP_HOURS`). Before any
textual similarity or entity overlap is even evaluated, it enforces **three consecutive hard negative vetoes**,
any one of which aborts immediately with `None`:

1. **Category + Subcategory Tuple Veto (`_primary_topic`):** `_primary_topic` (`:52-58`) extracts the primary
   `category` AND `subcategory` tuple `(category, subcategory)`. If both stories have a primary topic and
   `left_topic != right_topic`, the merge is vetoed (`:96-97`).
   *Real failure mode:* In the coverage of Андрей Янкулов's interview on Петрохан, `fakti.bg` was classified as
   `('judiciary', 'vss')` while `nova.bg` was classified as `('judiciary', 'high-profile-cases')`. Despite identical
   topics at the category level, identical subject matter, and identical quotes, the subcategory mismatch triggered an
   immediate hard veto!
2. **Disjoint Places Veto (`_places`):** If both stories have non-empty extracted places (`entities.places`),
   `left_places.isdisjoint(right_places)` triggers an immediate veto (`:99-101`).
   *Real failure mode:* Newsrooms report place at different grains or focus. If one outlet reports the capital venue
   `{"софия"}` (where the press conference or court sat) and another reports the regional scene `{"петрохан"}` or
   `{"берковица"}`, the disjoint sets trigger a veto.
3. **Disjoint Title Digits Veto (`_numbers`):** extracts **whole tokens that are pure ASCII digits** from
   the title (`TOKEN_RE = [0-9A-Za-zА-Яа-яЁё]+`, `_numbers` `:80-82`) — not digits embedded in mixed tokens.
   If both titles carry such a token and `left_numbers.isdisjoint(right_numbers)`, the merge is vetoed
   (`:102-104`).
   *Failure mode (mechanism verified, example invented):* a synthetic `{'3'}` vs `{'30'}` pair does veto,
   and 471 of 2,623 story titles carry an ASCII-digit token — but **no** story title in the corpus contains
   either of the illustrative strings, so they should not be quoted as if measured.

Only if a pair survives all three vetoes are the title token overlap and entity rules tested:
```
≥1 shared strong entity  ∧ ≥3 shared tokens ∧ title jaccard ≥ 0.72
≥2 shared strong entities ∧ ≥3 shared tokens ∧ title jaccard ≥ 0.35
≥5 shared tokens          ∧ title jaccard ≥ 0.82
```

Title-only overlap may miss independently worded coverage. Measure that hypothesis on
labelled same-event pairs, including both original reporting and syndicated copies; the
0.35 threshold alone does not establish its recall.

⚠️ **But the vetoes are NOT "the direct mathematical cause of the 92.3% singleton rate", and that sentence must
not survive into an implementation decision.** A first counterfactual was measured over the current corpus
(story-level proxy: every pair within 48 h, counting pairs where a veto fires **and** the surviving similarity
rule would have passed — i.e. merges the vetoes actually block):

| scope | pairs within 48h | pairs blocked by a veto that would otherwise merge | stories involved |
| --- | ---: | ---: | ---: |
| 2026-09-20 subset (679 stories) | 230,181 | **25** | 46 |
| whole corpus (2,623 stories) | 882,603 | **79** | 143 |

These are **blocked candidate pairs**, not validated merges or a count of singleton
stories that would disappear. Dividing 79 by 2,408 does not establish a “3% causal share”:
pairs share nodes, can already belong to multi-article stories, and may be false matches.
The Янкулов example demonstrates one plausible missed join, not the population effect.
T2.0/T2.1 must re-run article-level candidate retrieval and cluster construction, validate
accepted/rejected pairs, and report changed cluster membership on the same frozen universe.
Do not promise that relaxing vetoes alone will solve fragmentation.

⚠️ **And this counterfactual measures the wrong arm — see §15.2.** It was computed
story-level over every pair within 48 h, while the rule actually runs *article-level*,
against six retrieved candidates, at analysis time. Measured on the 00:38Z build, the
deterministic rule produces **192 of the corpus's 222 joins (86.5%)** and the model joins
on its own only **30 times in 2,927 clusterable articles (1.0%)** — so the rule is the
primary clusterer in practice, not a fallback, and the 79-pair figure is not an upper bound.

### 1.4 R2 — presidential coverage exists and is filed under the wrong election

`news/topics.json` (v1, 26 categories / 103 subcategories) has **no
`elections-presidential` category and no presidential subcategory anywhere**. ⚠️ The only
presidential string in the file is the keyword „консултации с президента" — but it is **not**
under `government` as the plan states. It is the fourth keyword of
`elections-parliamentary / coalition-talks` (`topics.json:77`), which arguably strengthens the
"filed under the wrong election" thesis rather than weakening it, but the stated location is
wrong and a reader checking it would find nothing.

**360 analysed articles** mention the presidential race (президентск*/Йотова/вицепрезидент).
⚠️ **The query is unstated and the figure is fragile.** It reproduces exactly only as a
**case-sensitive** regex over the serialized model record; `re.IGNORECASE` gives **366**, and
searching the *source article text* gives **493** while the model's own `summary_bg` gives
**299**. State the fields and the flags, or the number is not reproducible. Their primary
topics (under the case-sensitive full-record query):

| primary topic | n |
| --- | ---: |
| `elections-parliamentary / campaign` | **155** |
| `elections-parliamentary / cik-administration` | 28 |
| `foreign-policy / bilateral` | 23 |
| `government / coalition-politics` | 18 |
| … ⚠️ **40** more buckets (the plan said 30; 43–44 real buckets, 8 records with no primary topic) | |

This establishes a missing taxonomy destination and a candidate set for review. It does
not by itself establish that all 155 matches are errors: the query includes people who
appear in non-election reporting. T3.2 verifies context before changing labels.

### 1.5 R4 — party treatment is computed but mostly withheld

`party_tones` is a shipped field: 605 of 5,005 analyses carry it, **1,197 (party, tone)
entries** total, of which **1,194** carry the full metadata set (party id, confidence,
evidence, `evidence_grounded`). It is invisible because of one gate:

```
evidence_grounded:  False 1190  ·  True 4  ·  missing 3
```

`party_tone_evidence_grounded()` (`news/scripts/analyze_articles.py:1219-1234`) requires
the evidence string to be a **normalized contiguous substring of the article**.
`build_app_data.py:1580-1605` drops every ungrounded tone from the public bundle. So
**almost all assessed pairs are withheld by this gate.**

✅ **Reconciliation resolved (the plan flagged it).** Both figures are correct for their own
set, and it is a denominator switch, not a counting error: **1,197** entries exist; **3** of
them are bare `{party, tone}` with no metadata (those are the histogram's "missing 3"); so
**1,194** carry `party_id` + `confidence` + `evidence`. The histogram sums to 1,197 exactly.
⚠️ The plan then paired the wrong numerator with the wrong denominator: `neutral` is **953 of
1,197**, or **952 of 1,194** — not "953 of the 1,194". Verified in the shipped bundle:
exactly **4** grounded pairs survive in **2** articles, i.e. the four `True` entries and none
of the rest, so "almost all assessed pairs are withheld" and "four entries passed the gate"
both hold.

⚠️ The gate is not a bare substring test. Reading `build_app_data.py:1580-1605`: a saved
`evidence_grounded: True` is trusted **only** when the record was produced by the current
`PARTY_TONE_EVIDENCE_GATE_VERSION`, or when `human_review.status == "accepted"`; otherwise the
evidence is re-checked live, and **any exception drops every party tone for that record**
(failure-closed). So (a) a human override can publish a paraphrase the automated gate would
reject, (b) the saved histogram is not necessarily what the bundle contains, and (c) T4.1's
"preserve human overrides" is already partly implemented and must be extended, not invented.

The cause is a contract mismatch between the prompt and the gate, and it is structural,
not a tuning problem. `news/prompts/analyze_system.md:122-125` asks for
„`evidence` — дословен цитат **или конкретна проверима перифраза**", and for the `neutral`
tone it explicitly demands an *explanation* („трябва да обясни равнопоставеното/фактическото
представяне"), which can never be a verbatim span. **953 of the 1,197 entries are `neutral`**
(79.6%; 952 of the 1,194 metadata-complete ones)
— the majority class is defined by the prompt in a way the gate must reject.

### 1.6 R5/R9 — public-figure identity exists; generic person identity and tone do not

- `entities.people` is present on **3,444 of 5,005** analyses. Top subjects include Румен
  Радев (191), Илияна Йотова (191), Бойко Борисов (118), Васил Терзиев (61).
- Identity is already resolved against **the main site's own person layer** —
  `news/scripts/build_gazetteer.py` builds from Postgres `person` / `person_role` /
  `tr_name_fold_people`, and `resolve_mentions.py` emits `basis: "ambiguous_refused"` with
  **no id** rather than guessing. That refusal is what makes a per-person claim publishable
  at all.
- `news/mentions/person/<id>.json` carries `{article_count, shown, analyzed_count, articles[…]}` —
  ⚠️ the plan understates it as `{article_count, articles[…]}`: the shard **already
  distinguishes `shown` from `analyzed_count`**, but `analyzed_count` means the article has an analysis, not that this person received
  a valid tone assessment. T4.4 requires new target-specific counters. It carries **no tone of any kind** (335 shards checked).
  There is no per-person sentiment anywhere in the system.

⚠️ **R5 asks for jev specifically; it cannot be the sole evidence producer.** Jev is a *typed-decision*
model (`news/scripts/jev_client.py:51` — the plan cited `:52`, which is blank;
`typesafe/jev-1.13-20260917`): it answers `choice`
/ `score` / `noul` questions and **returns no free text**, so it cannot emit the evidence
string every tone gate in this repo validates. It is wired in `shadow` mode only
(`analyze_local.py:428-511`) with no `enforce` value by design, and the live benchmark
concluded **STOP AT SHADOW** — at the shipped 0.98 floor, 0 of 218 eligible articles would
have terminated (`news/evals/jev-openrouter-benchmark-2026-09-20.md`). The initial implementation uses
a GLM field on the existing analysis call, gated by evidence, like party tone —
and therefore it is **blocked behind §1.5**. Reusing the mismatched evidence contract
would reproduce that failure mode; the party failure rate is not a measured person rate.

⚠️ Also: `entities.people` are bare strings and unnormalised („Радев" 55 vs „Румен Радев"
191). A person tone keyed on those strings would attribute a judgment to a name, not to a
person. It must ride the **mention id**, which refuses ambiguity by construction.

**Audit finding, verified 2026-09-21:** `build_gazetteer.py` selects active public figures;
`news/data/gazetteer.json` contains **zero entries matching Калуш**. Existing mention IDs
are slugs, not PostgreSQL's reassigned numeric `person_id`. Consequently, the original
T4.3 would exclude the explicit Kalushev use case. Add a news-owned identity namespace
with an optional verified bridge to the main site (§6); do not widen the public-figure
registry or manufacture an official profile just to enable news comparison.

### 1.7 R6 — where the story page misleads

Measured against the real corpus (2,588 `stories/` entries = 2,574 stories + 13 index pages +
`by-url.json`; ⚠️ single-outlet is **92.3%** of the 2,574 stories — the plan's 91.8% divides
stories by files):

- **A 100% bar on a sample of one.** `MixBar` (`src/ux/MixBar.tsx:45-46`) returns null when
  `!segments.length || total === 0` — effectively only at total 0 — so a one-member story whose
  member carries an applicable label draws a solid strip. ⚠️ The exact rendered strings are
  `Без ясно рамкиране · 1 (100%)` (tooltip/aria, `MixBar.tsx:69`) and `Без ясно рамкиране 100%`
  (visible legend, `:113-117`) — the plan's „· 100%" matches neither. And it is **conditional**:
  a one-member story whose member is `not_applicable` produces no segments at all, hence no bar.
  `StoryCard` already learned this and added a divergence guard (`labelled >= 2`,
  `StoryCard.tsx:85`); `StoryScreen` did not get it (confirmed — no `labelled`/`diverges` in
  the file). ⚠️ **The guard counts distinct LABELS, not distinct outlets** — two articles from
  one outlet with different labels pass it — so T5.2's "count distinct outlets" is a *different*
  rule, not a port.
- **`not_applicable` is counted and not drawn.** It is excluded from the segment groups
  (`StoryScreen.tsx:106-118` buckets into `"n/a"` and `LEAN_GROUPS` holds only
  left/center/right, then `.filter((s) => s.count > 0)`; same for the Russia axis), so a story
  where every member is outside the axis renders the completeness strip with **no bar and no
  explanation next to it** — the one sentence that explains an empty bar
  („Празна лента означава…", `StoryScreen.tsx:340-345`) is the section lead, far from whichever
  axis collapsed.
- **The completeness line is five numbers to say "we rated both articles"**, printed at
  `text-xs` with the raw rubric id inline (`news-article-evaluation-v1`), **twice per page**
  (once under each axis). ⚠️ It is not inline in `StoryScreen` — it is a separate component,
  `newsapp/app/components/AggregateCompleteness.tsx` (`:14`, `:16-31`, `:34`), fed by
  `axisCompleteness()` (`newsapp/app/aggregateCompleteness.ts`). ✅ **Correcting an earlier
  claim in this plan (and in §14.1 finding 9): it is NOT shared with the topics screen.**
  Both are imported by `StoryScreen` alone (`:30`, `:31`; rendered `:364`, `:383`), and
  `TopicsScreen`'s „извън обхвата" at `:598` is an unrelated *out-of-scope badge* on an
  off-topic category row. The real constraint is different and sharper: the strip is rendered
  from **two separate call sites, one per axis**, so "one sentence, once per page" (T5.4)
  requires lifting state into `StoryScreen` rather than editing the component twice.
  *(Historical as of T5.4, 2026-09-22: the strip is now rendered ONCE, after both bars, with
  the page owning the disclosure state — see the §0.1 row.)*
  The rendered text is flex-separated, not `·`-separated:
  „Оценени 2/2  2 източника  2 в спектъра  0 извън обхвата  0 без стойност". ⚠️ "2 източника"
  counts distinct domains among **assessed** members, not all articles — that distinction is
  what T5.2 must keep.
- **Comparison furniture on non-comparisons.** „Как се различава отразяването" renders its
  "up to six distinctive words" disclaimer above a single headline
  (`HeadlineComparison.tsx:68-73`, rendered unconditionally; the `members.length >= 2` check
  only gates an analytics event); the timeline heading reads „(1 от 1)" (`StoryScreen.tsx:400`).
- **Jargon**: „клъстерът" (`StoryScreen.tsx:225,308,449`), „в спектъра" / „извън обхвата"
  (`AggregateCompleteness.tsx:24,27`), „Няма измерим еднозначен първи източник"
  (`StoryScreen.tsx:286`). ⚠️ **„Дисперсия" is NOT a story-page string** — it lives only on the
  topics screen (`TopicsScreen.tsx:300,352,442`), and see T5.6: it was moved
  „Разсейване" → „дисперсия" by the operator on 2026-09-21, deliberately.
- Selecting a bar segment can empty the timeline, with **no explicit way back** ⚠️ — but the
  plan's version of this is imprecise: every emitted segment has `count > 0`, so a *single*
  selection always leaves ≥1 member; the list empties only when a leaning selection and a
  stance selection intersect empty, and clearing is available on **either** bar
  (`MixBar.tsx:55-56`). What is genuinely missing is the „Покажи всички" control T5.7 proposes.

### 1.8 R7 — what the methodology page does not say

`newsapp/app/screens/MethodologyScreen.tsx` is **806 lines** (the plan said 808) carrying
**two hand-written parallel trees** (BG body `:194-506` + `EnglishMethodology` `:508-806`,
selected at `:181-192`), which have already drifted — the EN version has a paragraph the BG
lacks. ⚠️ The drift is now pinned to a line: `:627-629` (EN, "The two axes") carries "On the
English page, untranslated Bulgarian evidence is withheld so the two languages are not mixed
in one interface", with no BG counterpart at `:307-312`. It is honest and well-ordered about
what it covers, but it is silent on most of the pipeline a reader would need to judge it:

missing: how article text is extracted and what that fails on · which model does the rating
and that the body is truncated at 6,000 characters · what jev is and that it decides
nothing · how articles are grouped into a story, and how conservative that rule is · that
`party_tones` is computed and withheld · that the feed shows 16 of ~676 stories a day ·
the „Точност на модела" section, which ships **empty and says so**.

⚠️ Three precisions the audit adds. (a) The extractor's four rejection reasons are **four of
six** — `robots_disallowed` and "no title and no content" are the others
(`news/scripts/failure_rules.py:41-60`), so T8's list must not read as exhaustive. (b) The
"no venv, stdlib only" rationale is documented for the **LLM client**
(`news/scripts/llm_client.py:5-7`), not for the extractor; the extractor is stdlib-only by
fact (`save_articles.py:233` `BodyExtractor(HTMLParser)`, no third-party HTML library
anywhere), but the reason T8 attributes to it is an inference. (c) The page **floors**
percentages (`MethodologyScreen.tsx:179`, `Math.min(99, Math.floor(...))`), so the 49.4%
figure renders as **49%** — T6.2's "N% of collected articles are analysed" is already
lossy, and any new limit it publishes must say whether it is floored or exact.

---

## 2. Product thesis

The target experience is **one event → its collected coverage → source-backed differences
→ a useful next perspective**. The existing pipeline is a useful foundation, but feature
presence is not proof of comparison quality or parity with Ground News.

### 2.1 Ground News benchmark (official pages inspected 2026-09-21)

| verified workflow | adaptation here | delivery |
| --- | --- | --- |
| Story-level AI summaries and comparison across coverage groups, withheld when distinct coverage is insufficient ([comparison guide](https://help.ground.news/en/articles/3189505)) | Cited common ground, attributed disagreements, selectable headlines and person treatment; no invented counter-position | T5.1, T5.8 |
| Publication-level bias and factuality ratings, sourced from external raters; ownership context ([methodology](https://ground.news/rating-system)) | Keep our **article-level** two-axis framing explicitly distinct from outlet identity; expand dated ownership provenance; no invented Bulgarian factuality score | T7.1–T7.2 |
| Dedicated discovery of disproportionately covered stories ([Blindspot](https://ground.news/blindspot)) | Coverage-aware discovery with healthy-source denominators; current framing labels alone cannot establish outlet silence | T7.1 |
| Sort/filter coverage by bias, factuality, ownership and other source attributes ([filter guide](https://help.ground.news/en/articles/6049857)) | Date, outlet, available ownership group, article framing and person tone; unavailable metadata remains unknown | T5.8, T7.2 |
| Reading-history insights and personalized discovery ([My News Bias](https://ground.news/my-news-bias-vantage), [product FAQ](https://ground.news/frequently-asked-questions)) | Follow cases, people, parties and topics; explicit local reading-history opt-in in a later tier | T7.3 |

This is a public-documentation benchmark, not a logged-in usability or subscription audit.
⚠️ All six pages were re-fetched on 2026-09-21 and all returned HTTP 200 with the attributed
workflows present (the rating system names AllSides, Ad Fontes Media and MBFC and states its
ratings are publication-level; ownership is hand-coded for 2,276 outlets). One caveat must be
added rather than assumed: **`my-news-bias-vantage` is explicitly a demo page** — its own
header reads "Demo Data (Vantage Demo)" over a fabricated subject — so it evidences that the
feature exists, not how it behaves for a real reader. Ground News’s US-context outlet ratings cannot be copied onto Bulgarian outlets. Our two
article axes and person treatment are proposed differentiators; neither proves that our
analysis is more accurate. Ground News already has topic-following surfaces, so a named
case page is a useful Bulgarian adaptation, not a substantiated exclusive feature.

### 2.2 Priority findings incorporated by this audit

| priority | gap in the original plan | correction |
| --- | --- | --- |
| P1 | Generic people excluded by public-figure-only IDs | T4.0 news-person identity and a required Kalushev pilot |
| P1 | A quote that exists can still support the wrong target, speaker or tone | T4.1 attribution, span provenance and independent semantic review |
| P1 | `blindspot_of()` counts two ideological **articles**, possibly from one outlet, and calls the opposite wing absent | T7.1 separates framing distribution from observed coverage gaps |
| P1 | Pagination lacks global filter semantics; reachability ratio is written backwards | T1 snapshot/query contract and exact set reconciliation |
| P1 | Clustering evaluated on one affair; same-topic requirement preserves known taxonomy errors | T2 held-out events, candidate-recall measurement and cross-topic review |
| P2 | “Neutral synthesis” and disagreement sentence have no evidence contract | T5.1 claim-level citations, explicit attribution and fallback |
| P2 | More singletons/maximum cluster size treated as quality failures | T2 diagnostics stay descriptive; precision and recall govern release |
| P2 | Methodology deferred until last; generic persons have no complete publishing path | T4.4 integration and methodology shipped with each feature |

Position, unchanged from `news-home-experience-v2.md`: *Не още новини. По-ясен прочит на
новините.*

---

## 3. Tier 1 — publish the corpus we already have  (R0, R1)

The first delivery priority is making the existing eligible corpus reachable.

**T1.1 — a versioned, paginated feed that EXTENDS the contract already in production.**
⚠️ **The release machinery this task proposes to build already exists and is live; the task is
the content and query layer.** Verified 2026-09-21: production does **not** serve data from
Firebase hosting — `.env.production.local` sets
`VITE_NEWS_DATA_BASE_URL=https://storage.googleapis.com/data-electionsbg-com/news/app-data`,
and `manifest.json` there returns HTTP 200 with `version: 3`, `run_id`,
`data_base: versions/<run_id>`, and a `bundle` carrying `sha256`, `files: 2653`, `bytes` and a
per-file `{path, bytes, sha256}` inventory. The client validates manifest structure/path
confinement and follows `data_base` (`PUBLICATION_POLL_MS` 60 s, `DATA_REFRESH_MS` 5 min), but
this is neither payload hash verification nor browse snapshot isolation (T1.3). It supports
a "hot" `overlay` delta whose `run_id` deliberately does **not** move, and enforces a
published-path confinement rule with a documented backslash guard
(`newsapp/app/data.ts:705-780`, `:1000`). So:

- do **not** mint a parallel `feed/<generation>/` tree; add the feed's pages to the existing
  `versions/<run_id>/` bundle and let the existing manifest point at them;
- the manifest already declares schema version, `generated_at`, run id and hashes — extend it
  with the UTC window boundaries, available sorts/facets, counts and page URLs T1.1 wants,
  in a way the client's `parsePublicationManifest` accepts (it tolerates unknown fields and
  accepts v1–v3 during migration);
- T1.5's "upload and validate before switching" is the existing promote path; the file-count
  ceiling that matters is the **GCS version tree** (~2,653 files per release today), not
  `dist-news` (a parallel `feed/` proposal would have duplicated it).

⚠️ **Page budget: re-measured, and the "50 KiB budget" is this plan's own proposal.** There is
**no** feed-page budget in the repository — `scripts/news_performance_budget.ts:17-22` gates only
`html` (2,000), `css` (30,000), `js` (140,000) and `homeJsonGzip` (33 KiB) — and no 50 KiB
constant exists anywhere in `news/`, `newsapp/` or `scripts/`. Measured on the current index
(`write_story_pages`' exact wrapper, `gzip.compress(..., 6)`, and `write_story_pages` splits by
**row count only**, never by bytes):

| `STORY_PAGE_SIZE` | gzip per page | pages |
| --- | ---: | ---: |
| 100 | 26,898 B (26.3 KiB) | 27 |
| **150** | **39,084 B (38.2 KiB)** | **18** |
| 200 (current) | 50,876 B (49.7 KiB) | 14 |

So `STORY_PAGE_SIZE = 150` does yield ~38 KiB and is the right shape for a 50 KiB ceiling — but
note that **page 1 is not the worst page**: the other 200-row pages run 51.2–55.6 KiB
(`index-6` is 55,602 B), so a 200-row size fails the ceiling on most pages while passing on the
first. ⚠️ The earlier figure of "51,002 bytes" is **not reproducible at any gzip level** (level 6
gives 50,876 B; the built copy 50,962 B) — use the table, and if a ceiling is adopted, adopt it
**as a gate in `news_performance_budget.ts`**, not as prose. Gate the maximum over **all**
feed/search pages with one specified gzip method, including rows expanded by person/case
facets. Split by byte budget as needed; move oversized detail out of index rows. Declare
budgets for initial load and complete query transfer/request count, not just each page.
The 150-row measurement is a starting point, not proof every future page fits.

🔍 **Do not delete `stories.json` or `latest.json` without updating `prerenderRoutes.ts`** — but
the first version of this warning overstated both the dependency and the risk. Verified
exhaustively, `newsapp/prerenderRoutes.ts` reads five bundles at build time: `outlets.json`
(`:230`), `stories.json` (`:261`), `latest.json` (`:309`), `evals/queue.json` (`:341`) and
`home.json` (`:350`, `generated_at` only). It never reads `stories/index-*.json` or
`stories/by-url.json`. A run of the real function emits **6,040 routes** (BG+EN):
story 5,246, outlet 146, article 300, eval-article 334, hubs 13. Two corrections:

- ⚠️ **It is not "sitemap entries for all ~2,574 stories".** Story routes set
  `sitemap: outletCount >= 2` (`:288`), so only **201 of 2,623** stories per language enter the
  sitemap (402 with EN); the other 2,422 are prerendered but deliberately excluded. Heads for
  all, sitemap for ~7.7% — the distinction matters because "prerender" and "submit" are
  different SEO decisions.
- ⚠️ **The partitioned index is not a drop-in replacement.** `StoryIndexRow` carries
  `id, title_bg, title_en, topics, first_published, last_published, blindspot, member_count,
  domains`; the head and sitemap also need `summary_bg`/`summary_en`, which the index **lacks**
  (2,622 of 2,623 stories have a non-empty `summary_bg`). `aggregates.outlet_count` *is*
  derivable — verified `outlet_count === domains.length` for all 2,623. The per-story detail
  files do carry the summaries, so the migration is feasible, but it is a change to
  `prerenderRoutes.ts`, not a swap. And `latest.json` has **no** partitioned equivalent: the
  only article partition is `articles/<domain>.json`, which holds *all* analysed articles rather
  than the latest window, so retiring it would change the emitted route set.

⚠️ Keep the 33 KiB `home.json` budget **as a gate**, but do not repeat the claim that it binds
the 16-story limit (see §1.1): today it uses 39.5% of it. `home.json` remains the hero payload
shape, but its selection must use the same ranking policy; leaving recency-selected content
unchanged would preserve the wrong lead.

**T1.2 ✅ SHIPPED (§0.1) — an explicit prominence rank.** Name it „Най-отразявани“, not “most popular”:
coverage is observed; readership is not. Implement one versioned `story_prominence()` at
build time with a reproducible `as_of`:

```
U = distinct outlets in the selected window
V = distinct outlets first joining the event in the preceding 6 hours
age = hours since the latest genuinely new member publication (not a recrawl/backfill)
score = (log2(1 + U) + 0.25 * log2(1 + V)) * 2 ** (-age / 24)
order = score DESC, latest_publication DESC, story_id ASC
```

This is the initial formula to evaluate against labelled briefing examples; its constants
are not empirical findings. Keep raw article count as explanatory volume, not a ranking
multiplier. Compute `V` from the minimum preserved first-observed timestamp for each
(story, outlet), counting that outlet at most once in `(as_of - 6h, as_of]`. Do not require
`scoop_decidable` or `first_here`: simultaneous arrival is valid velocity without a winner.
Exclude known backfills/imports and membership corrections from a fresh-arrival boost;
record these origins. Crawl scheduling affects this measure: label it observed coverage
momentum, never real-time audience popularity or proof of original reporting.

For `age`, use the latest validated publication of a newly observed eligible article;
recrawls, title edits, merges and historical backfills must not reset it. If publication time
is missing or unreliable, omit the recency boost using a documented conservative fallback,
mark publication freshness unknown, and offer an explicitly labelled collected-time archive.
Do not substitute `fetched_at` as a claimed publication date. Persist timestamp basis and
rank version; fixtures cover missing/future/date-only stamps and backfills.
Show „6 издания · 11 материала“; expose components in methodology, not a numeric leaderboard.
Preserve or explicitly replace `HOME_MAX_STORIES_PER_OUTLET = 4` and
`HOME_MIN_COMPARISON_STORIES = 4` for the finite hero selection. Diversification may reorder
the complete feed, but it must not exclude eligible stories or violate T1.4 reachability.

Use spectrum breadth in a separate „Различни прочити“ discovery view, rather than rewarding
polarization in the default feed. Offer „Последни“ alongside prominence. Domestic relevance
is an explicit Bulgaria/topic filter, not an undisclosed weight — ⚠️ and note the corpus
already has a model-derived relevance gate (`site_relevant`) that removes 40% of analyses
before this feed is built (§1.3); decide whether it becomes a stated filter or stays an
invisible cut. Ownership groups and syndication families are separate counts; common
ownership does not prove shared reporting.

**T1.3 ✅ SHIPPED (§0.1) — filtering precedes pagination.** Time, topic, case, person, outlet and sort are
URL state. The client must never filter only pages already downloaded and call that the
whole result — ⚠️ which is exactly what the home search does today
(`newsapp/app/homeFilters.ts:53`, a substring `searchable()` over the ≤16 downloaded
stories), and exactly what the live outlet detail screen does. ✅ Verified precisely, in
`newsapp/app/screens/OutletScreen.tsx`: `:332` takes `useStoryList()`, `:363-370` filters
`stories.stories` — the **revealed prefix only**, 200 rows at a time — by
`s.domains.includes(domain)`, and the heading at `:532-534` renders `participating.length`,
i.e. matches **within what has been revealed**, not the corpus total. `storyListView`
(`data.ts:1518-1535`) computes the real total from the index page and OutletScreen never reads
it; the screen mitigates with a caption at `:566-571` ("Показвани са най-новите истории; може да
има още"), which is honest but still means an outlet's older stories are invisible until
"load more" has been clicked through up to 14 pages — and nothing says how many are missing.
T1.3 must provide a *unified global
query and filter contract* across HomeScreen and OutletScreen:
precompute the common window/sort indexes and a compact partitioned search index for combinations;
measure its transfer budget before choosing the implementation.
If that index exceeds its declared budget, use a query endpoint instead of silently
narrowing search. Facet counts and page membership use the same predicate. Display separate
loading, exhausted, failed and genuinely empty states; ⚠️ `home_health.py` already defines
the failed/empty precedent (`FUTURE_ANCHOR_TOLERANCE_HOURS` exists because a run published an
empty payload, and `check_staleness.py` alarms `manifest_stale`/`manifest_unreadable`).
Preserve scroll on Back and provide accessible “load more”/pagination.

**The existing hook is not snapshot isolation.** `useStoryList` in `data.ts` explicitly
allows a mixture of old and fresh pages and exposes `staleVintage` to offer refresh. Reuse
its UI, replace that accumulation behavior for the new query contract. Pin a browse to
`(run_id, overlay.seq or 0, as_of, query_version)` plus normalized URL filters and stable
sort/cursor. A hot overlay can change data without changing `run_id`. Facets, totals,
ranked pages and detail projections must agree on that effective snapshot; either materialize
matching overlay-aware indexes or keep the entire browse on the base with a new-results
notice. Never patch rows alone while leaving counts and page membership stale.

Capture `as_of` once for the query, including rolling windows; refresh deliberately creates
a new snapshot. Validate page 1 → overlay publish → page 2, base publish between pages,
clock crossing 24h, Back restoration, withdrawals and an expired cursor. On pruned snapshots
show an explicit refresh state, never silently continue from a different generation.

**T1.4 ✅ SHIPPED (§0.1) — exact reachability gate.** For every supported query fixture:
`coverage = distinct reachable eligible story IDs / all eligible story IDs in that window`.
Require **100%**, counting every page, and set equality with no duplicates or phantom IDs;
explicitly enumerate exclusions such as invalid extraction or withdrawn records. An empty
eligible set is N/A, not 100%. Withdraw the old 16/676 = 2.4% diagnostic because its
selection and denominator cover different windows. Include a fixture whose only matching story is on page 2.
The denominator is the distinct **canonical publishable story IDs satisfying the same
query in the pinned snapshot**, obtained independently from the complete builder output.
Articles, analyses and story IDs are different units, not alternative denominators for this
gate. Report the article funnel separately: analysed → quality-ok → site-relevant → attached
to published stories. The dated 2,883 eligible versus 2,876 attached counts leave seven
articles to reconcile; do not label all 2,883 “story-attached”. The inherited text also
uses both 5,005 and 5,015 analyses; resolve that discrepancy against the frozen artifact before
publishing a funnel. These historical counts are not a reconciled release baseline.

**T1.5 ✅ SHIPPED (§0.1) — publication and retention.** ⚠️ Largely existing: the manifest switch, the immutable
`versions/<run_id>` tree, per-file sha256 inventory validation, a hot overlay, and the
60 s/5 min cache policy are live (§T1.1). What is missing is documented **retention**: decide
how many `versions/*` generations the bucket keeps (each ~2,653 files / 60 MB today) and what
happens to a bookmarked `stories/<id>.json` whose generation is pruned. Use the production GCS object's actual metadata as the release check:
`upload_to_gcs.py` sets immutable objects to one-year immutable caching and the manifest to
`no-cache,max-age=0,must-revalidate`. Firebase's `/news-data/**` headers apply to its hosted
copy and do not establish GCS behavior. Test the serving origin and preserve conditional
manifest writes, base/overlay compatibility and rollback. Hashes listed in a manifest do
not by themselves mean the browser verifies them; define and test integrity verification at
publication and consumption boundaries, including overlays.

Keep snapshots for at least the declared cursor/session lifetime plus cache grace; choose a
storage budget and cleanup policy before release. Stable story URLs must resolve independently
of a pruned version path. Prerenders, hero, facets and feed carry a compatible generation.
Define the browsable 30-day window separately from retained case/story archives; old bookmarked
story URLs remain valid. Corrections/removals need an urgent invalidation path rather than
waiting for immutable caches to expire.

**Order:** feed infrastructure and latest sort can ship first. Prominence gets its final
quality acceptance after T2 improves event membership; T1 alone cannot solve R0.

---

## 4. Tier 2 — make one event one story  (R0, R3)

Raising recall here is what turns the whole site from a wire into a comparison. It is also
where a mistake is publicly wrong, so it is measured before it is changed.

**T2.0 ✅ SHIPPED (§0.1) — label articles into events before changing the rule.** The original “92 raw
articles, ~109 stories” combines a two-day raw subset with a broader analysed subset; these
are not one evaluation universe — ⚠️ and the audit could not reproduce either number from any
single reading (91, not 92; ~113, not ~109; and 161 vs 273 analyses depending on whether the
*article* or the *story* file is searched). That is exactly why this task exists: **freeze the
universe in writing before quoting a number from it.** Freeze canonical article IDs, publication
dates, domains, content hashes and analysis versions, then recount the same universe. ⚠️ Freeze
the **publication gate** too — `quality.verdict` and `site_relevant` (§1.3) — because a
clustering metric computed over all analyses and one computed over site-relevant analyses
alone will differ by ~40% for reasons that have nothing to do with clustering. Include Петрохан,
presidential campaigning, unrelated same-person events, local news and foreign news across
multiple days/outlets. Split by event and time, keeping copied articles in the same split.
Use separate development and untouched adjudicated test sets; a frontier model is a
comparison baseline, not the human ground truth.

**T2.1 ✅ SHIPPED (§0.1) — a second candidate and join channel.** Extend candidate retrieval as well as
`same_event_evidence()`: `analyze_articles.py` currently retrieves candidates before applying
that rule, so a better join cannot recover events never retrieved. Retrieve by a union of
resolved participants, case, places/time and body/lede similarity; use the article text as
primary evidence and model summaries only as a secondary signal. Resolved person IDs help
but cannot be mandatory for floods, infrastructure or a newly named person.

⚠️ **Name the prefilter's own ceiling (§15.2).** `candidate_stories()` scores
`3 × |shared title tokens| + min(entity_points, 3) + date_score(≤2)`, keeps `score ≥ 3` and
returns the top **`MAX_CANDIDATES = 6`**: one title token is worth 3 points while *all*
entity evidence together is capped at 3, so retrieval is title-dominated before any veto is
reached, and a running affair's ~113 stories compete for six slots. Union retrieval must
replace this ranking, not sit behind it.

🔍 **Relax and restructure the three negative vetoes in `same_event_evidence()` (`home_event_dedupe.py:85-126`) — but only in the review channel, and only on evidence.**
The three preconditions are verified in code: `_primary_topic()` returns the
`(category, subcategory)` tuple (`:52-58`) and an exact mismatch vetoes (`:96-97`);
`_places` vetoes on a disjoint set (`:99-101`); `_numbers` vetoes on disjoint **ASCII digits in
the title** (`:102-104`; `_numbers` is literally `{t for t in TOKEN_RE.findall(title) if
t.isascii() and t.isdigit()}`). ⚠️ **All three apply only when BOTH sides are non-empty**, so a
story with no extracted places is never vetoed for that reason.

⚠️ **This plan's own safety posture forbids the way pass 3 wrote the fix.** Three separate
places commit to conservatism — T2.2 "keep the conservative auto-accept rule", T2.3 "observed
precision ≥0.99", and §10 "It does not lower the existing merge thresholds to buy cluster size"
— and the module docstring states the design intent: *"This does not rewrite canonical story
membership. It suppresses only pairs with strong deterministic evidence and emits every
decision as a merge proposal for later editorial review."* So the reforms below **must be
staged**, and T2.0's labelled set is what authorises promoting any of them:

1. **Topic: veto on category, not the tuple; cross-category only in review.**
   Matching at `category` level (so `judiciary/vss` and `judiciary/high-profile-cases` can join,
   as pass 3's Янкулов example requires) is a defensible change to the **candidate** set and can
   be measured against T2.0's labels. ⚠️ Allowing cross-category joins ("`government` by one
   outlet, `judiciary` by another") is a much larger relaxation — it removes the only
   topic-level guard — and must stay **review-only** until the held-out precision gate shows it
   is safe. Note this also contradicts the standing line "Fix taxonomy before recalibrating
   thresholds": the taxonomy fix (T3) comes first for the auto-accept path; the relaxed rule
   runs in review in parallel.
2. **Places: distinguish their role before treating them as contradictory.** Singleton
   sets `{София}` and `{Петрохан}` can identify the court/press venue and the incident scene
   of one development; `local-news` alone also cannot establish a conflict. Compare resolved
   place identity, granularity and role. Distinct municipalities holding separate council
   meetings are a hard negative; a scene and a reporting venue are not. Uncertain roles go
   to review, not a new unconditional veto.
3. **Numbers: compare qualified quantities, not bare digits.** A quantity needs metric,
   subject, unit, event and time basis. Evolving casualty counts can belong to the same
   event; disagreement may be precisely what the comparison should show. Distinct years
   identifying different elections are different events. Use an actual incompatible event
   anchor as a hard negative, and preserve changing or disputed claims inside an event.
4. **Body/lede and entity similarity first; embeddings are optional.** Evaluate these
   channels on the frozen set before adding a service. If justified, cache embeddings
   **per article/content hash and model version**, then compare locally; a service request
   per candidate pair is unnecessary. A remote API can use the existing stdlib transport
   without installing a local model. Require an explicit cost/storage/latency budget,
   provider/data-handling decision, deterministic fallback and outage tests. The LLM
   client's no-venv rationale does not prove a repository-wide ban on dependencies.

All newly relaxed channels, including category-level relaxations, initially emit review
proposals. Promote only the exact evaluated rule/version after T2.3 passes; no paragraph
here authorizes bypassing the conservative auto-accept path.

⚠️ **"The direct mathematical cause of the 92.3% singleton rate" is a causal claim that has not
been measured.** What is established is that the vetoes *can* block true pairs and that 92.3% of
stories have only one outlet (not necessarily one article). Which share of the 2,574 is caused by the vetoes rather than by
genuinely single-outlet reporting is exactly what T2.0 exists to determine — pass 3's own
Янкулов example is one pair, not a rate. Report the counterfactual (re-run clustering with each
veto relaxed and measure precision/recall on the frozen set) before attributing the rate.

Judge whether the **action/development**, participants, event time and place agree. Keep the
48h auto-join horizon initially. Shared case/person alone is not an event. Exact topic
agreement is a positive signal, not a hard veto in the new review channel: the very same
event can be misclassified into different topics. Different developments months apart
remain separate stories linked through a case. Fix taxonomy before recalibrating thresholds.

**T2.2 ✅ SHIPPED (§0.1) — proposals, review and stable identity.** Keep the conservative auto-accept rule
while measuring it too. ⚠️ The kill switch already exists — `NEWS_AUTO_MERGE=0`
(`analyze_articles.py:693`) disables the automatic join entirely; express any staged
rollout or A/B through it rather than adding a second flag (§15.2). New matches enter `review/story_merge_queue.json` — ⚠️ which
**already exists** with a versioned `{version, generated_at, counts, items}` shape holding
**100 items, 15 pending/active** (verified 2026-09-21); this task extends that contract and
its reviewer fields, it does not create the file. Note the two queues disagree today:
`home_health.counts.merge_proposals` is **0** for the home window while the standalone queue
holds 15 pending — reconcile them or say why they measure different sets. Explicit reject
constraints must block both direct joins and indirect transitive merges. Validate a cluster
against its event anchor, not just A≈B and B≈C. Record reviewer, decision, evidence and rule
version. Preserve story IDs when members arrive; merge retired IDs through redirects and
record reversible split membership. Recompute all affected aggregates, person tones, search,
feed, case pages, backlinks and prerenders on a correction.

**T2.3 ✅ BUILT, GATE UNMET (§0.1) — release on accuracy, monitor cluster shape.** ⚠️ Two in-repo priors bear directly
on the floors below and are folded in at §15.2: the rule's audited record is **85 of 90
proposals accepted, 0 refused** — at n=90 its 95% lower bound cannot reach the 0.97 this
task proposes, so the existing evidence does **not** clear its own gate — and the recall gap
is already quantified at **67% of articles carrying a strong cross-outlet candidate the join
stage discarded**, which T2.0 should reproduce as its baseline rather than deriving a new
one. ⚠️ The adjudication stream these floors consume is **currently empty** (§15.3).
Publish pairwise precision/recall,
candidate retrieval recall and cluster purity, plus confidence intervals and sample sizes.
Proposed auto-join gate: at least 300 adjudicated accepted test pairs spanning at least 50
events, observed precision ≥0.99 and 95% lower bound ≥0.97; no hard-negative or explicit-reject
violations; recall improves over the baseline without loss on local-news strata. Include
rejected candidates and known same-event pairs outside the retrieved set when measuring
recall (accepted pairs alone cannot measure it). Report non-event false matches explicitly. Bands with
insufficient support stay review-only. Report event-bootstrap uncertainty as well because
pairs within events are dependent. ⚠️ **The support floors may not be attainable from the
existing gold machinery, and the plan should say so before promising them.** The committed
gold set is real — `news/data/gold/gold_set.json`, `actual_size: 240`, built from 4,366
scanned articles — but it **under-filled its own person cell**: `requested_size: 250`,
`shortfall: {person_linked: {wanted: 40, got: 30}}`. T4.5 asks for ≥200 held-out
article/person pairs with ≥30 per tone; the existing public-figure sampler under-filled its 40-article person-linked cell.
That is not a measured shortage of generic-person mentions across the corpus. State the shortfall, and budget new annotation rather than assuming
the set scales. Track singleton share, multi-outlet comparison share,
max cluster size and review backlog, but **never require a lower singleton share or larger
maximum**: merging unrelated reports would satisfy both. Log first-seen versus publication
time separately so a backfill does not masquerade as a breaking event — ⚠️ use the existing
`first_seen`/`scoop_lag_hours`/`scoop_decidable` fields (§1.2) and remember they are
**omitted** from the public payloads, so this is a build-side report, not a reader-facing one.

---

## 5. Tier 3 — say what the story is about  (R2, R3)

**T3.1 ✅ SHIPPED (§0.1) — taxonomy v2: `elections-presidential`.** A category of its own, not a subcategory
of the parliamentary one, with defined subcategories: `campaign`, `candidates`, `debates`,
`results` and `cik-administration`. Keep routine presidential powers, pardons and
constitutional consultations under the appropriate government/institutional topic; they are
not presidential-election coverage unless the article substantively concerns the election.
Add explicit paired fixtures for a campaign report versus a pardon or government-formation
consultation. Merely mentioning Йотова or Радев must not route an article into an election. The version bump
is already modelled in the ingestion and evaluation pipeline — every analysis record stores the
`taxonomy_version` it was classified against (`topics.json:15`).

**T3.2 ✅ SHIPPED (§0.1) — review and reclassify the candidate set.** The 360 keyword matches are a
retrieval set, not 360 established taxonomy errors: Йотова or вицепрезидент alone does not
establish election coverage. ⚠️ **And the retrieval query itself must be committed with the
task**, because it is already ambiguous: case-sensitive over the serialized model record gives
360, `IGNORECASE` gives 366, the source article text gives 493 and the model's own `summary_bg`
gives 299. Pick one, write it in the plan or the script, and report which — T3.2's whole output
is a before/after distribution, and an unstated query makes the "after" uncomparable. Freeze
the candidates, validate the actual election context,
and run a topic-only reclassification with per-field provenance while preserving other
reviewed fields. Publish the before/after distribution and spot-check both changed and
unchanged rows. If a primary category crosses `not-site-relevant`, revalidate/recompute
`site_relevant`, `story.action` and publication eligibility as a dependency group; preserving
those stale fields would produce an invalid record. Track per-field versions instead of
restamping untouched sentiment. Rebuild affected story membership, topic/case/person indexes,
aggregates and clustering proposals afterwards.
⚠️ Sequence this **after** the `site_relevant` gate is measured (§1.3) if any candidate set is
drawn from stories rather than analyses: today a third of analyses never reach a story.

**T3.3 ✅ SHIPPED (§0.1) — cases (казуси), not a "scandals" category.** „Петрохан" and „помилването" are not
topics; they are **named ongoing affairs that cut across judiciary, officials-people,
government and local-news** (⚠️ re-measured: Петрохан's **161** analysis records span the
topic space — the plan said 273; see §1.3). A model must
never be asked to decide that something is a scandal. So:

- `news/config/cases.json` — a **curated, dated, human-owned** registry: slug, BG/EN name,
  opened-on date, a short neutral description, and a match rule expressed as required
  mention ids, required terms, and negative exclusions.
- `build_app_data.py` attaches `case_ids` to stories deterministically from that rule.
- A `/case/:slug` page: the timeline of the affair across topics, every outlet that covered
  it, the framing distribution, and the entry date — with the registry's own description
  and the explicit statement that inclusion is an editorial selection, not a finding.

**Concrete case pilots.** These are retrieval and editorial specifications, not findings
about the named people's conduct. Freeze the supporting article IDs, source URLs, publication
dates and reviewed excerpts before publishing descriptions. A corpus title is not sufficient
to establish a legal status, and absence of a term in a sample does not disprove a role.

1. **`petrohan` ("Казусът Петрохан–Околчица"):**
   - Use a neutral description of the coverage and investigation, supported by reviewed
     sources. Do not label Калушев a perpetrator in identity metadata, infer every incident's
     location from one camper report, or describe Сандов as charged merely from a headline
     saying he denied being charged. A denial of charge status is not a denial of the alleged
     conduct. Record each contested claim with speaker, date, evidence and response in the
     event chronology; the registry need not adjudicate it.
   - Candidate retrieval may use `петрохан`, `околчица`, full names, reviewed spelling
     variants and broad stems alongside investigative/institutional context. This returns
     **candidates**, not published membership or person IDs. Weather/road/tourism uses are
     negative examples; an article containing a road reference and a real investigation
     should not be rejected by a global keyword blacklist.
   - Review membership at article level against the affair. Coverage of related Сандов,
     Терзиев or ДАНС developments need not mention Калушев. Neither a required conjunction
     with his name nor a place-only OR is a complete membership rule.
   - `Калушев` can refer to more than one person **inside this case**, including Георги
     Калушев. Case scope does not resolve it; require an anchored full-name/context mention
     or an article-specific reviewed override. Unknown names remain unlinked.
   - Keep distinct developments as separate events connected by the case timeline.
2. **`narco-pardon` ("Помилването на Огнян Атанасов"):**
   - Scope the registry to the reported pardon and its institutional/political reactions.
     The reviewed description must cite sources for the act and actor and distinguish
     reporting, allegation and response; no claim about constitutional powers follows from
     the retrieved article labels alone.
   - Retrieve pardon terms plus contextual identity evidence. Neither `ескобар` nor the
     two-part name is unique: the corpus includes the mayor of Кюстендил and a football
     coach with that name. A nickname needs a sourced alias binding to this subject.
   - Require review by default. Resolve mayor/football context at the **mention** level;
     do not exclude an otherwise valid article just because it also discusses a namesake.
     Include the bta.bg festival example (Йотова patronage plus the mayor) as a hard negative.
   - A pardon report may belong to judiciary/government without being election coverage.
     Review relevance rather than bypassing publication gates to force a case result.

⚠️ **Integrity rules that bind both cases and every future entry** (a `cases.json` entry is a published editorial claim about named people, so these are gates, not guidance):

- A case description uses neutral, sourced wording with dated attribution; contested claims and available responses stay attached to their exact claims. Do not prescribe a response or legal status from a name alone. No allegation enters the registry as a bare fact.
- **Candidate discovery must include excluded analyses** (§1.3), so reviewers can detect
  missed coverage without assuming either that all exclusions are errors or that all are correct.
- Every entry carries `rule_version`, its negative exclusions, `ambiguous_match` review status, and the reviewer. A namesake collision (Атанасов, Калушев) is a **blocker** on auto-attach, not a tuning matter.
- Broad surname/stem matching is allowed for **candidate retrieval only**. Published
  person linkage requires resolved IDs or reviewed full-name/context evidence; a full name
  can itself be ambiguous. A case can include an article without resolving every person.
- Run discovery over stored articles/analyses so excluded or unanalysed coverage is visible
  to reviewers. Public membership still requires extraction/relevance eligibility. Review
  errors through the normal correction path; an editorial registry is not a bypass.
- Require membership evidence and adjudicated positive/negative case fixtures before
  allowing any deterministic auto-attach rule; registry authorship alone is not accuracy.

Require exclusions, ambiguous-match review, rule version, provenance and override history.
Attach membership at article level, then derive story membership with supporting article IDs;
a passing reference must not pull all coverage of a person into the case. Distinguish the
Petrohan place from the named affair. Give each case a chronology of separate events and a
person selector. Cases may overlap without double-counting a story in the main feed.

**T3.4 — the topic chips read the taxonomy.** With T1 shipped, the home chips are counted
over the real window, so „Парламентарни избори · 2" stops being an artefact of a 16-row
sample.

---

## 6. Tier 4 — treatment of a named subject  (R4, R5)

**T4.0 ✅ SHIPPED (§0.1) — news-person identity before person sentiment.** Create a versioned
`news/config/news_persons.json` registry with immutable opaque `news_person_id`, BG/EN
display names, evidenced aliases, a neutral disambiguating description, identity source
URLs, review status/history, and optional `verified_main_site_slug` (the single canonical field name).

🔍 **Schema and rationale for `news_persons.json`:**
The main site's gazetteer (`build_gazetteer.py`) explicitly filters for `status='active' and is_public_figure`.
Numeric Postgres person IDs are reassigned on rebuild and must never be durable news keys. Furthermore,
prominent news actors often include private individuals, business managers, witnesses, or criminal suspects
(e.g. Ивайло Калушев or Огнян Атанасов) who have no official profile on `naiasno.bg`. Manufacturing public
official profiles for private individuals is inappropriate. Therefore, `news_persons.json` establishes a
dedicated, decoupled news-identity namespace. Illustrative **pending** record, not a
publishable identity or a real source citation:
```json
{
  "news_person_id": "np_7f3c1a94",
  "name_bg": "Ивайло Калушев",
  "name_en": "Ivaylo Kalushev",
  "aliases_scoped": [
    {"surface": "Ивайло Калушев", "scope": "candidate", "status": "pending_review"}
  ],
  "disambiguation_bg": null,
  "identity_sources": [],
  "verified_main_site_slug": null,
  "status": "pending_review",
  "created_at": "2026-09-21T00:00:00Z"
}
```
Use the same news namespace for officials and other news subjects; the main-site link is optional.

Before activation, attach identity source URLs, evidence and reviewer/time to each accepted
alias and identity decision. A misspelling observed in a few articles is not automatically
a global alias. A surname can collide inside one case; scoped aliases alone are insufficient.
Disambiguation describes sourced identity context, never culpability or a model's character
judgment, and stays null when unsupported. The opaque ID survives spelling changes; any
optional public URL slug redirects to that ID.

The model extracts article-local mentions with span IDs and proposes new people; the
resolver, not the model, assigns an allowed news identity. Unresolved/ambiguous mentions
remain visible as unlinked names with “not assessed”, contribute to coverage counts, and
enter a review queue. An ordinary person’s absence from the officials registry is not
ambiguity. Curated full-name/context matches can resolve that person in news independently.
Within-article surname/pronoun coreference requires an unambiguous anchored mention; a
surname-only report can use a reviewed article-specific override, never a global surname
alias. Registry aliases must have scope where needed; case membership is supporting context,
not proof of identity. Merges retain redirects; splits invalidate and re-review affected
pairs. Changing aliases or bridges triggers re-resolution and all dependent rebuilds.

Implement the dependency order explicitly: extract mentions/spans → resolve against the
reviewed registry → queue new/ambiguous candidates → approve identity → assess the resolved
targets → validate → publish. Existing resolved targets can share one bounded analysis call;
new identities wait for review and then a targeted assessment. The model cannot mint trusted
IDs. Version the identity decision independently of tone so a correction invalidates affected
pairs without silently transferring sentiment to another person. Pending/withdrawn identities
never produce public profiles.

**T4.1 ✅ PARTLY SHIPPED (§0.1, §15.5; T4.1b axes ✅ 2026-09-22) — repair the evidence contract.** Shared by parties and people; blocks public tone.
Use `rationale` for explanatory prose and `evidence_spans[]` for provenance. Migrate the
legacy `evidence` field explicitly (temporary read compatibility, no dual canonical meaning):
verbatim quote, field (`title`/`body`), offsets into a versioned extracted-text snapshot,
`article_content_hash`, target mention reference, voice (`journalist`, `quoted_speaker`,
`unclear`) and speaker attribution when known. At least one supporting span is required for
favorable/unfavorable; **mixed needs evidence for both directions**. Verify spans against
the text actually supplied to the model, with a documented normalization map that preserves
negation. Quote presence proves provenance only: target, meaning and voice still need
semantic evaluation and adjudicated examples. Do not call a substring-matched tone verified.

Treat journalist framing and quoted attitudes separately. A quoted accusation is not the
outlet’s endorsement; a loaded headline can nevertheless be journalist framing even when
the body attributes the statement. Label headline and body evidence explicitly. `neutral`
requires a positively detected, meaningful subject and sufficient text coverage with no
evaluative framing found; quote-missing, ambiguous, truncated or unassessed is never neutral.
If the existing 6,000-character prefix omits the target or relevant context, abstain or
schedule a bounded full-text/chunked pass, retaining chunk coverage and cost. An article-wide
claim for **any tone** requires the full extracted article to have been assessed: an
unseen balancing passage could change favorable/unfavorable into mixed. Prefix/chunk-only
results may be shown as scoped observations but stay out of whole-article tone rollups.
Deduplicate overlapping chunks; record covered ranges and completeness. A loaded title can
be displayed separately as title framing without implying the entire body has that tone.

Define offsets as Unicode code-point offsets into the exact hashed source snapshot and
convert explicitly for JavaScript slicing; test Cyrillic, combining characters and emoji.
Translated evidence is never a source quote. On EN pages keep original Bulgarian evidence
accessible and labelled, with optional translation shown separately. Extraction changes
invalidate dependent spans; historical human overrides remain auditable but require review
if their target, source text or scope no longer matches.

Version the prompt, JSON schema, GBNF grammar, validators, provenance guard, public serializer,
TypeScript types, gold schema and scoring together. Preserve human overrides. Backfill the
605 historical party-bearing records as a dated candidate set, plus a sampled wider set to
measure missed targets; do not restamp old paraphrases as quotes. Publish valid-span yield,
semantic accuracy and abstention separately: “grounded rate” alone is not accuracy.

**T4.2 — publish party treatment.** Story `by_party_tone`, topic rollups and `/party/:id`
use dated count distributions with visible denominators, following
`news-party-tone-integration-v1.md`. Do not infer a party’s tone from a person’s tone or vice
versa. Affiliation at publication time is context only, with a known/unknown basis.
⚠️ **Flag the route divergence explicitly:** That sibling plan says (its line 395) "no new
top-level route is needed for v1 — party tone is a dimension of articles, stories, topics and
outlet profiles, not a standalone leaderboard", and the stored shape it describes
(`by_party_tone`; `analyze_articles.py:615,636,643`; `build_app_data.py:1769,1806,1813`)
already exists. If `/party/:id` is retained in v1, define it strictly as an *archive filter*
(showing stories mentioning that party) rather than a comparative bias scoreboard. It must also
be registered on the **news** origin and prerender path (T4.4), and it must respect T4.1's evidence
contract — a leaderboard built on withheld tones would be a leaderboard of four pairs.

**T4.3 — generic person treatment.** Proposed stored contract, with article ID supplied by
the parent record:

```text
person_tones[]: {
  news_person_id, mention_refs[], subject_role: primary|secondary|incidental,
  assessment_status: assessed|insufficient_text|not_assessed,
  tone: favorable|unfavorable|neutral|mixed|null,
  confidence, rationale, evidence_spans[], quoted_attitudes[],
  text_scope, model_version, rubric_version, identity_version, assessed_at
}
```

The validator enforces status/tone consistency, validates IDs against the resolver’s
candidate set, and rejects duplicate (article, person, rubric) pairs. No person identity
means no public tone. Store `ambiguous_identity` on unresolved mention records outside this
resolved-target array; do not require a canonical ID and simultaneously permit ambiguity.
Primary/secondary targets get assessment priority; incidental names are shown without a
forced sentiment. Confidence is model confidence until calibrated, not a probability badge.

Tone describes **how the article presents its target**, not the target’s conduct, guilt,
public popularity or the emotional gravity of events. Neutral reporting of an allegation,
death or investigation can remain neutral. A page about a tragic event must not make every
person’s treatment negative. An article with several people can treat each differently.

🔍 **Required dual pilots for generic person treatment — re-grounded on the corpus:**
1. **The Petrohan Pilot (Ивайло Калушев):** review identity and aliases for Ивайло Калушев from the
   source articles, mint an opaque `news_person_id` in `news_persons.json` with no main-site profile
   required, and expose him in the case and story person selectors. ⚠️ Corpus facts the pilot must
   respect, all verified: he is **absent from the mentions layer and from the gazetteer** (0 entries,
   0 mentions) and exists only as a bare string in `entities.people` — so this pilot is really a test
   of minting an identity from scratch, which is the right test. Surface forms are inconsistent
   (`Ивайло Калушев` 56, `Калушев` 11, `Ивайло Калушиев` 2, plus one `Георги Калушев` who is **a
   different person**), so alias review must handle both the misspelling and the namesake.
   Keep identity disambiguation neutral and source-backed; claims about conduct belong in
   attributed event evidence, not the identity label. Test acceptance across these scenarios:

   full-name report; surname-only **ambiguous** report (must refuse, not resolve to the father);
   misspelled surname; clear coreference; two people with different tones; neutral allegation
   reporting; attributed praise/accusation; loaded headline versus neutral body; and relevant text
   beyond character 6,000.
2. **The Narco-Pardon Pilot (Огнян Атанасов):** ⚠️ **This is the ambiguous-identity test, not a
   straightforward one, and it is the most valuable pilot here.** „Огнян Атанасов" has at least
   **three** referents in the corpus — the subject, the **mayor of Кюстендил**, and a Plovdiv
   football coach — and the gazetteer records the two-part form as `resolvable: false` ("shared with
   3 other public figure(s)"), with all 17 of its analysis mentions `ambiguous_refused` and no id.
   The pilot must therefore demonstrate that a summary, tone or case attachment **refuses** on the
   bare name and resolves only through case context or a full-name-plus-context rule. Report the
   name and actor as the corpus does (the coverage names **Vice President Илияна Йотова** as the
   pardoning actor). Test co-occurring person tones where one article evaluates an institutional
   figure (Йотова) and a private figure (Атанасов) simultaneously.
   Verify that factual descriptions of past convictions are treated as objective background rather than
   conflated with authorial tone, and verify that the story survives the `not-site-relevant` gate.
   ⚠️ A known false-positive fixture to include: a 2026-08-22 bta.bg festival report matching
   `йотова` + `огнян атанасов` where the latter is the **mayor**.

**T4.4 — complete the publishing path.** Build news-person detail/index shards and a news
`/person/:newsPersonId` route, separately from naiasno.bg’s `/person/:slug`. For each story,
case and person view show counts by tone, N assessed of M eligible **target/article pairs**, distinct outlet
count, unknown/abstained count, date window and rubric version. For one person, M is
publishable articles with a resolved primary/secondary mention in the selected scope; N is
the subset with a valid, full-text assessment under the displayed rubric. Report pending,
insufficient-text and partial-scope counts separately, and incidental mentions separately
from eligible targets. Unresolved mentions are unknown identity coverage, never assigned to
that person's M. `analyzed_count` is not N. Tone counts must sum to N, and N plus the mutually
exclusive unassessed categories must sum to M. Count a shared article once across events in
a case/person archive; never average percentages from unequal-sized stories. Each row opens its short
quoted evidence and original source. Default to article counts, explicitly labelled; a
per-outlet view shows each outlet’s distribution rather than assigning it one inferred tone.
Identify syndicated copies and offer a deduplicated view so ten copies do not read as ten
independent judgments. Keep the raw and deduplicated denominators distinct.

For verified main-site bridges, extend the **existing** person mention shards compatibly
and update the main-site hook, types and “in the news” renderer. Adding JSON alone is not a
feature. Generic news people must not generate dead main-site links. Make bridges use
serving-site slugs and their redirects, not local numeric IDs. Correction/removal rebuilds
story, case and news-person shards in one data transaction; main-site consumers have a
separate release boundary, so add backwards-compatible fields, schema support checks and a
coordinated correction/tombstone path. A main-site bridge must not retain a removed tone.
Public exports retain short evidence only, not full article bodies. Provide a target-specific correction link carrying IDs and
versions, a named review owner, and review status.
🔍 **Repository and build constraints for new routes:**
1. **Isolated SPA origin:** The news app is an isolated SPA (`newsapp/`, `vite.config.news.ts`, hosted at
   `news.electionsbg.com`, Firebase hosting target `news`, output `public: dist-news`). ⚠️ Its routes are
   declared in **`newsapp/App.tsx:348-360`** (`<Routes>`/`<Route>`) and registered for prerender in
   `newsapp/prerenderRoutes.ts`. `/person/:newsPersonId`, `/case/:slug` and `/party/:id` belong there and
   **never** in the main site's router (`src/routes.tsx`, which does exist). ⚠️ **An earlier draft of this
   constraint cited `newsapp/app/routes.tsx` — that file does not exist**, and creating it would leave the
   routes unregistered and the pages unreachable. Because the news app is a separate origin,
   `/person/:newsPersonId` does not collide with the main site’s `/person/*` Cloud Function rewrites on
   `naiasno.bg`.
2. **URL conventions:** All news routes must honour `trailingSlash: false` (strict no-slash URL convention, matching
   main site and SEO requirements).
3. **Dedicated typecheck & release gates:** The news package is **not** covered by the root `tsc -b`. Always typecheck
   via `npm run typecheck:news` (`npx tsc --noEmit -p newsapp/tsconfig.json`). Use the existing
   `news:release:gate` → candidate verification/preview → promotion workflow for the SPA.
   The gate includes `build:news`, which **regenerates** `news/app-data`; do not rebuild after
   approving a candidate and assume it is still the verified artifact. `deploy:news` only
   deploys Firebase hosting; live GCS data is published by the existing
   `news/standalone/run_hourly.sh` / `upload_to_gcs.py` transaction. Deploy compatible readers
   before new data schemas, verify the new routes against that actual serving origin, and
   test client/data rollback combinations. Plan review itself runs neither build nor deploy.

⚠️ **“The site’s existing publication policy” for private people and minors does not exist,
and the plan cites it as if it did.** No policy doc, no `/privacy` or `/terms` route, no
minors/private-individual rule was found anywhere in `docs/`, `METHODOLOGY.md`, `src/` or
`newsapp/`; the closest artifacts are the narrower `RIGHT_OF_REPLY_POLICY`
(`newsapp/app/corrections.ts:33`), `imageRightsPolicy.ts`, and a principle stated only inside
two *other* modules’ plans (“Named private individuals never auto-headline”). **Write the
policy as a deliverable of this tier**, or cite those precedents explicitly — do not apply
something that is not there. Before public person pages ship, publish a policy covering
public-interest inclusion, private people and minors, evidence retention, corrections and
removal, and named review ownership. Require human activation for generic-person profiles;
incidental mentions alone do not create pages. Do not collect contact details or unrelated
personal information for disambiguation. Include the correction/tombstone propagation check
in the pilot rather than treating policy publication alone as completion.

**T4.5 — release gates, with sufficient support.** Extend `score_analyses.py`’s existing
party floors to people: pair precision ≥0.95, pair recall ≥0.90, tone macro-F1 ≥0.80,
per-tone recall ≥0.70, zero wrong canonical targets and zero unsupported evidence in the
adjudicated test set. Those zeros are release blockers on the sample, not claims of zero
population error. Use at least 200 held-out article/person pairs with ≥30 per tone and
coverage of generic people, officials, ambiguous names, quotations and long articles; report
confidence intervals, inter-annotator agreement and resolved-target coverage. Two annotators
adjudicate disagreements. Separate natural-prevalence reporting from the deliberately
balanced hard-case set. Insufficient support means review-only, not a vacuous pass. Compare
before/after neutral and negative distributions and audit a periodic fresh sample for drift.
⚠️ **The current gold set does not satisfy this floor.** The committed gold set
(`news/data/gold/gold_set.json`, 240 articles, requested 250) already reports
`shortfall: {person_linked: {wanted: 40, got: 30}}` — it could not fill a **40**-article
person cell under its existing selection method; that does not establish the generic-person
corpus lacks examples. This gate requires a newly annotated 200-pair sample with ≥30 per tone. Budget new annotation and a
sampler that targeted-samples person-bearing analyses; do not present 200 pairs as
assembly of existing material.

**On jev:** retain shadow mode for launch. A typed classifier could later choose a label
from already extracted, validated evidence; inability to generate prose does not make that
architecture impossible. It requires its own attribution/accuracy benchmark and must not
remove the evidence producer or bypass these gates. No jev promotion is implied by this plan.

---

## 7. Tier 5 — the story page  (R6)

**T5.1 ✅ SHIPPED (§0.1) — lead with the event and evidenced differences.** Above the fold: event title,
updated time, outlet/article counts, short synthesis and a comparison entry point. Synthesis
claims cite member articles and preserve who said what; agreement among sources is not proof
of truth. Separate common reported facts, attributed disputed claims and differing emphasis.
Never derive a substantive disagreement from axis labels alone. A deterministic sentence
may describe only a distribution; a semantic comparison needs quoted supporting spans.
Cache synthesis by member content hashes and rubric version; corrections invalidate it.
Below two distinct outlets, show an attributed single-source summary. If evidence is
insufficient or generation fails, keep headlines and source links; do not invent a contrast.

**T5.2 ✅ SHIPPED (§0.1) — port `StoryCard`'s divergence guard to `StoryScreen`.** Use an explicit state
table: zero assessed → no assessment; one distinct assessed outlet
→ single-source coverage; ≥2 outlets with identical labels → matching assessed framing;
≥2 with different labels → distribution. ⚠️ **These are two rules, not one port:** the
existing guard counts distinct **labels** (`StoryCard.tsx:77,85`, `labelled = max(leaningSpread,
stanceSpread)`), so two articles from one outlet with different labels pass it. "Count distinct
outlets" is therefore new logic that must be written and tested on the story page — say so, and
give `StoryCard` the same treatment or record why the card and the page may differ. State
whether bar segments count articles or outlets, and retain mixed per-outlet distributions;
⚠️ the existing completeness strip counts distinct domains among **assessed** members
(`aggregateCompleteness.ts`), which is the basis to keep. Matching framing is not agreement on
facts.

**T5.3 ✅ SHIPPED (§0.1) — stop hiding `not_applicable`.** Either draw it as its own muted segment or print
„N от M са извън тази ос" immediately beside the bar. The explanation must sit next to the
thing it explains, not at the top of the section. ⚠️ The segment groups are built in
`StoryScreen` (`:104-136`) while the strip is `AggregateCompleteness.tsx`, so the two changes
land in different files and T5.3 must say which surface carries the explanation — putting it
in the strip means it also appears under the axis that did *not* collapse.

**T5.4 ✅ SHIPPED (§0.1) — one completeness sentence, once.** Replace the five-figure strip on the story screen with
„Оценени са и двата материала." plus an accessible `<details>` disclosure carrying the granular
breakdown, the rubric id (`news-article-evaluation-v1`), and the date. Once per page, with per-axis
assessed/unknown counts still adjacent when they differ.
⚠️ **The constraint is two call sites, not two screens — and §14.1 finding 9 states this wrong.**
`AggregateCompleteness.tsx` is imported **only** by `StoryScreen` (`:30`), which renders it
**twice**, once per axis (`:364`, `:383`); it is **not** rendered by `TopicsScreen` (whose
`:598` „извън обхвата" is an unrelated out-of-scope badge). A `variant` prop therefore has no
second consumer to serve. "Once per page" instead requires `StoryScreen` to own the disclosure
state and render one strip for both axes — and the component should keep the "distinct assessed
domains" definition and stay axis-agnostic.

**T5.5 ✅ SHIPPED (§0.1) — make the timeline a timeline.** A dated rail, outlet name and mark, the framing
chips, and — once T4 lands — the party/person treatment chip per source. This is the row
where a reader actually does the comparison.

**T5.6 ✅ SHIPPED (§0.1) — de-jargon, one pass, both languages.** „клъстер" → „група материали" and
„в спектъра"/„извън обхвата"/„без стойност" → plain sentences.
🔍 **Explicitly retain „дисперсия“ on `TopicsScreen`:** Do **not** remove or "de-jargon" the word „дисперсия“.
It is not a story-page string (it exists only in `TopicsScreen.tsx` — `grep -n дисперси newsapp/app/screens/TopicsScreen.tsx`; line numbers move). On 2026-09-21, commit `6289ba8e96`
deliberately replaced the colloquial „Разсейване“ with the precise statistical term „дисперсия“ across topic
distribution headers. The operator's decision stands; T5.6 must not re-litigate it or revert it.
Fold `LEAN_GROUPS`' inline Bulgarian (`StoryScreen.tsx:63-65`) back into `labels.ts` so the label text cannot
drift from the axis it labels — ⚠️ note the hues already come from `labels.ts` (`LEANING_META`),
so the drift is in the **strings**, and the EN path already reads the table
(`StoryScreen.tsx:115`) while the BG path hardcodes the short forms, so BG and EN already
differ in register today.

**T5.7 ✅ SHIPPED (§0.1) — a filtered-empty timeline needs a way out.** An explicit „Покажи всички" when a
segment selection empties the list. ⚠️ Say what it resets: the list empties only when both
axes are selected and their intersection is empty, and either bar's toggle already clears its
own axis, so the new control must clear **both** and be labelled as such.

**T5.8 ✅ SHIPPED (§0.1) — make comparison an action.** Select two or three source headlines; align outlet,
publication/update time, headline, brief cited summary, article framing and the selected
person’s treatment. On mobile stack comparable fields with sticky source labels. Filters
must retain URL state and always offer reset. Include original-source links, article genre
when known (report/interview/opinion), and ownership/syndication context when supported.
Use text labels as well as color, keyboard controls and visible focus, light/dark contrast,
and shareable story/person/filter links. Test 360px and desktop layouts in BG and EN.
Do not republish full articles or synthesize viewpoints a source did not express.

---

## 8. Tier 6 — the methodology page  (R7)

Rewrite by **reader question**, not by system component. Proposed order — the first three
answer what a sceptical reader asks first:

1. **Какво правим и какво НЕ правим** (the current „Кое НЕ правим", promoted — no truth
   rating, no single outlet score, no name→person link on an ambiguous name).
2. **Откъде идват материалите** — 59 registered outlets, hourly, public pages only,
   `robots.txt` honoured, a self-identifying crawler, never republishing full text; the
   outlets that refuse a crawler and the ones behind a challenge, named; the retired list.
3. **Как четем текста на статията** — ⚠️ *new*. A custom stdlib extractor (no third-party
   readability library; document its actual tradeoffs rather than borrowing the LLM client's no-venv rationale), the junk-subtree and
   link-soup rules, what it is known to fail on, the rejection reasons — four of six in
   `failure_rules.py`: `non_article_page`, `off_domain`, `title_as_body`, `thin_body`, plus
   `robots_disallowed` and "no title and no content" — and that the model's own
   `quality.verdict` is a second opinion on the extraction.
4. **Кой прави оценката** — ⚠️ *new*. GLM-5.3-flash via OpenRouter, one call per article,
   **the existing path truncates at 6,000 characters**; disclose T4’s full-text/chunked
   assessment scope when shipped, plus a constrained JSON schema and a canary that
   halts a misconfigured run, and the analysis budget (~100 articles/hour) with what that
   means for the 49.4% figure.
5. **Какво е jev и защо не решава нищо** — ⚠️ *new*. A typed-decision model in shadow mode;
   it returns no free text, so it cannot produce the verbatim quote our gates check; the
   measured result (0 of 218 eligible articles would have been suppressed at the shipped
   threshold) and the decision to keep it deciding nothing.
6. **Двете оси** — as today, keeping the `not_applicable` vs `neutral` explanation, which is
   the single most useful paragraph on the page.
7. **Оценка на партии и лица** — ⚠️ *new*, once T4 ships. The pair semantics, the evidence
   rule, journalist versus quoted voice, neutral versus insufficient evidence, text coverage,
   news-person identity versus the optional main-site link, and ambiguity handling.
8. **Как групираме материалите в една история** — ⚠️ *new*. The rule in plain words, the
   fact that it is deliberately conservative, the measured singleton share, and the human
   merge queue.
9. **Прозрачност на източниците** · **Точност на модела** · **Поправки и право на отговор** ·
   **Собственост и финансиране** — kept, in this order.

🔍 **Consolidated /about into /methodology (Commit `87a99ee3df`):**
In commit `87a99ee3df`, the standalone `/about` route and screen were deliberately absorbed into `/methodology`
(`MethodologyScreen.tsx`), creating a single authoritative destination for editorial principles, ownership & funding,
and right of reply / corrections disclosures. T6 must preserve this unified destination and avoid re-creating a
redundant `/about` screen.

**T6.1 — kill the BG/EN drift.** One content model with a label table per language, instead
of two hand-written trees. The drift is not hypothetical — the EN page already carries a
paragraph the BG page does not (`MethodologyScreen.tsx:627-629` vs `:307-312`). The unified model must
encapsulate methodology, editorial principles, ownership/funding disclosures, and corrections.

**T6.2 — the coverage box must state the publish limits, not only the analysis limits.**
Show the same frozen build/window at every stage: discovered/stored articles, analysed,
quality-eligible, relevance-eligible, attached articles, canonical stories, browsable stories
and hero cards. Give each count its own unit, denominator and exclusion reasons. The
historical 16/676 “2.4%” mixes a capped 30-day selection with a calendar-day story count;
it is not a valid reachability rate. Hero selection is not archive availability, and the
article relevance cut cannot be ranked against the hero cut as though they share a unit.
Use T1.4 for actual query reachability; separately disclose analysis lag, unknown dates and
unresolved attachment gaps. The UI currently floors percentages; declare rounding and show
exact counts beside them.

**T6.3 — publish evaluation results as a release deliverable.** The existing 240-article
gold set and scoring harness are the starting point (⚠️ cross-reference precisely:
`news/data/gold/gold_set.json` is `news-site-v1.md` **T4.1**, `news/scripts/score_analyses.py`
is its **T4.3**; **T4.2** is the frontier baseline that the sibling plan records as *not yet
run* — the plan conflated the three). ⚠️ Publish the gold set's own shortfall with its results
(`requested_size: 250`, `actual_size: 240`, `shortfall.person_linked {wanted: 40, got: 30}`):
a benchmark that under-filled a cell must not be presented as a clean sample. Add the held-out
clustering/person sets above, human adjudication and a baseline
comparison. Show evaluation date, model/rubric, sample composition, per-label results and
abstention; distinguish human reference labels from a frontier model’s predictions. Until
a feature passes its gate, say “not yet validated” and keep it review-only.

**T6.4 — publish explanations with each feature.** Keep the reader-facing flow concise:
what is compared → evidence → limitations → correction route. Put implementation detail
(6,000-character policy, model IDs, extractor rules, jev, cost and versions) in expandable
technical notes. Source counts, coverage and runtime model names derive from the published
manifest rather than hard-coded prose. Methodology must ship with each tier, not wait for
all tiers to finish.

---

## 9. Sequencing and completion criteria

⚠️ **Stage 0 — repair the adjudication transport, before any stage's acceptance criteria are
agreed (§15.3).** The hourly pipeline is running and publishing cleanly, but
`eval_task_sync_exit: 1` on 6 of the last 8 distinct runs (11 of 31), the accepted-adjudication and
accepted-feedback snapshots are **missing with `record_count: 0`**, and
`publication_blocked: false` — so the release ships and the gates starve. The feedback arm's
cause is diagnosed: the fix is in `news-functions/src/operator.ts` and the pipeline executes
the older compiled `lib/`, which no pipeline stage builds. Stages B, C and D all price in
adjudicated pairs (T2.3, T4.5, T6.3) that currently cannot arrive.
#### ✅ Stage 0 closed 2026-09-21 — and the router was never the defect

`09ba888273` · `c1f1a41399` · `6dbfc7575d` · `fc9d86d829` · `89eb91f94d`.

The two halves resolved in opposite directions from what this section predicted.

**The adjudication transport was not broken.** `news/data/evals/{public-submissions,
accepted,feedback-accepted}` have **never existed**: the public evaluation surface has
collected zero submissions since it shipped, so the export legitimately returns nothing
and throws „retaining the last known-good export" about a file nobody ever wrote. That is
a product state, not an incident, and it now has its own name (`*_cold_start_no_records`)
separate from a regression. ⚠️ **It is still true**: T2.3, T4.5 and T6.3 have no adjudicated
input, and no code creates those records.

**The review-router saturation was one contract defect wearing 1,419 hats.** §15.3.2 framed
it as a calibration question and offered two options, neither of which was the answer. The
rule had not drifted; `1,419 of ~1,614` flagged records came from the T4.1 prompt/gate
mismatch. T4.1 collapsed them to 46 and the ceiling passes at **24.50%** with the `0.25`
constant and both confidence floors **untouched**. Two independent contributions came out of
chasing it, both recorded in the commits: the gazetteer had no room for three-letter party
acronyms (ДПС, БСП, ДСБ, ИТН, СДС), and the router was re-asking standing policy once per
article.

**Acceptance:** one hourly run reporting `eval_task_sync_exit: 0` and a non-missing
`accepted_snapshot`. ✅ **Half done (§15.3.1):** the functions were rebuilt and an
`operator_cli_stale` guard + watcher alarm shipped, so the canonical-host throw is cleared
and future `src`/`lib` skew is reported rather than silently executed. ⚠️ **Still open:** the
three Firestore exports still return nothing and both accepted snapshots remain
`record_count: 0` — which is the half that actually starves T2.3, T4.5 and T6.3.

| stage | deliverables | dependencies / acceptance |
| --- | --- | --- |
| A — usable complete feed | T1 feed pages/query layer over the existing manifest + version tree, latest sort, T5 empty/small-sample states, T6 current limitations, ⚠️ the publish-funnel measurement from §1.3 | exact query/page reconciliation, payload budgets, no broken links |
| B — trustworthy event comparison | T3 taxonomy/cases, T2 evaluation and clustering, T1 prominence, T5 cited comparison | labelled holdout; stable event IDs; rank fixtures; source citations |
| C — named-subject treatment | T4.0 identity + T4.1 evidence → T4.2 parties + T4.3 generic people → T4.4 integration | T4.5 gates; required Kalushev/Petrohan journey; corrections rebuild every consumer |
| D — coverage discovery | T7.1 coverage health, T7.2 source context, T6 evaluation publication | healthy-source denominators; no article-frame→outlet-silence inference |
| E — return visits | T7.3 follows/bookmarks, later reading-history insights | ⚠️ blocked on an account or an explicit re-opening of the 2026-09-21 withdrawal; core comparison quality |

T4.0 identity design and T4.1 evidence repair can begin alongside feed work. T5’s basic UI
fixes are independent; its semantic synthesis and person comparison are not. T3 is useful
on detail/case pages without waiting for T1, and generic identity can improve T2 candidate
recall without making it a hard dependency. Treat A–D as the Ground-style v1 scope; E is
explicitly subsequent. Stage A alone does not fulfill the comparison ambition.

⚠️ **Every stage’s acceptance runs against the news package’s own gates**, which are separate
from the main site’s: `npm run news:test`, `npm run typecheck:news`, `npm run news:perf:gate`,
`npm run news:home-health:gate`, `npm run news:release:gate`. The root `tsc -b` does **not**
cover `newsapp/`.

Plan audit changes only this document. Implementation completion requires the scoped Python
pipeline and scoring tests, newsapp component/route tests, relevant main-site integration
tests, and browser checks for paging, filters, citations and small samples. Do not run a
production backfill or publish just to validate this document.

## 10. What this plan deliberately does not do

- **It does not add a "scandal" topic.** A model must never be asked to decide that
  something is a scandal. Named affairs are a curated registry (T3.3).
- **It does not give a party or a person a standing sentiment score.** Only dated count
  distributions with visible denominators.
- **It does not promote jev beyond shadow** without the separate benchmark in T4.5.
- **It does not lower the existing merge thresholds** to buy cluster size (§4, T2.3).
- **It does not claim measured accuracy** until an adjudicated held-out evaluation has run.
- **It does not equate framing, ownership, factuality or person treatment.** They answer different questions.
- ⚠️ **It does not treat the `site_relevant` classifier as a neutral fact.** It is a model
  verdict that removes ~40% of analyses before any story exists (§1.3), and every
  coverage, ranking and case claim inherits it. Stage A measures and publishes it.
- ⚠️ **It does not re-open browser-only bookmarks or follows.** That design was withdrawn on
  2026-09-21 because it stored a reader's choices in one browser; T7.3 is gated on an account
  or an explicit decision to restore it (T7.3, §9).
- ⚠️ **It does not re-litigate the term „дисперсия".** The operator chose it deliberately on
  2026-09-21 (T5.6).

---

## 11. Tier 7 — the missing Ground-style workflows (R8)

**T7.1 — rebuild coverage-gap discovery on an observable denominator.** The checked
`blindspot_of()` in `build_app_data.py:1936` filters left/right article labels, requires only two
**labelled** members and returns a missing wing. ✅ Verified: it excludes
neutral/not-applicable, has no outlet-health input, and ⚠️ **also has no distinct-outlet check** —
the caller passes an undeduped one-row-per-article list, so two labelled articles from one
domain can raise a "missing wing", which is exactly the P1 criticism. This establishes
one-sided framing in the assessed sample, not that left/right
outlets failed to cover a story. ⚠️ Scale matters for how the rename will read: of 2,574
stories only **3** carry a blindspot flag today, and only 286 of 2,876 member articles carry
any leaning label at all (1,792 neutral, 798 not-applicable). Rename that signal
„Едностранно рамкиране в извадката“, require distinct outlets, and ⚠️ state the observed
base rate alongside the badge so three stories do not read as a system; keep a separate
coverage-gap payload and route.

For true observed coverage comparisons, maintain dated source cohorts with a documented
basis independent of the current event (initially reader-selected outlet sets or reviewed
ownership groups). If ideological cohorts are introduced, require a separately validated
Bulgarian outlet methodology; do not derive them from one story’s article labels. Per cohort,
publish active monitored outlets, successfully checked outlets, matched outlets and the
observation window. ⚠️ Per-source discovery health, `alerts` (e.g. `going_stale`) and
`field_coverage` already exist as an `acquire_direct` stage result
(`news/scripts/save_articles.py` intake report) — reuse them rather than building a second
health model. Record last successful discovery, fetch/extraction failures and analysis
lag per outlet. A successful request does not prove complete discovery: record monitored
feeds/sections, pagination depth, per-run caps, gaps between checks and the earliest/latest
covered interval. A capped latest-N feed can miss an event while reporting healthy. Sources
without adequate observation of the comparison window remain unknown; measure discovery
coverage separately from HTTP success. A failed crawl, missing classification, paywall or expired snapshot is unknown,
not “did not cover”. Use discovery/collected article matches independently of sentiment;
ambiguous event matches remain unknown. ⚠️ And a story can be absent from a cohort because its
members were dropped by the `quality`/`site_relevant` gate (§1.3) — that is unknown, not
silence, and the cohort denominator must say so.

Proposed launch eligibility: ≥5 distinct reporting outlets; ≥3 healthy monitored outlets
per compared cohort; ≥80% successful source checks in each cohort; a ≥6h observation window;
and freshness within two scheduled collection intervals. Show the numerator/denominator and
unknowns next to any imbalance. Calibrate the imbalance threshold on the held-out set before
enabling the badge; these floors alone are insufficient. Phrase every claim as “not found
among the sources checked in this window”, never deliberate suppression. Healthy and failed
copies of the same fixture must yield different eligibility. Show emerging stories normally
while they are too young for a coverage-gap claim. Provide a dedicated discovery feed and
an explanation of why each story qualifies; retain minority coverage links.

**T7.2 — source context with provenance.** Extend the existing outlet transparency page
(`newsapp/app/screens/OutletScreen.tsx`) rather than adding a parallel rating system. ⚠️ What
that page shows today, so the gap is explicit: ownership block (owner name, registry source
URL, checked date), funding **hard-coded as "Not collected"**
(`newsapp/app/sourceTransparency.ts:11-15`, asserted verbatim by its test), retirement reason,
conduct measures (bylined / edited-after-publication / republished-content-unavailable),
article-level framing and Russia-stance distributions, participating stories and latest
articles. It has **no publication-level bias or factuality rating** and says so explicitly
("not a trust or factuality score"). Model
publisher entity, verified EIK where applicable — ⚠️ **no EIK field exists on `Outlet` today,
so this is new** — owner/control links, source documents,
valid-from/to and last-checked dates. Keep ownership unknown when unverified; an EIK or shared
owner is not proof of editorial coordination. Display source history and corrections alongside
available context, with article framing always labelled as an article assessment. A future
third-party factuality badge needs an identified provider, applicable coverage, license and
date. ⚠️ `ai_generated` estimates exist on the `Outlet` type and are shown on the **outlets
list** and article pages, but **not** on `OutletScreen`; if T7.2 adds them there, the "never a
factuality proxy" rule stops being prose and needs a UI constraint. Filters expose only
dimensions the corpus actually supports.

**T7.3 — follow and return (after v1 core).** ⚠️ **This task, as written, restores a feature
that was deliberately withdrawn hours before this audit, and it must say so.** On 2026-09-21
commit `4d48b70036` removed the „Запазени" nav entry, the `/saved` route, its prerendered
page and the „Запази" button on every story and article, together with topic-following,
**because both stored the reader's choices in ONE BROWSER** — clearing site data or opening
the site elsewhere lost them with nothing saying so. The commit left `savedNews.ts` and
`SavedScreen.tsx` in place with a banner and made `ReaderActions.test.tsx` assert the button
stays absent "so it cannot drift back before the account does". So "offer local bookmarks and
follows" is not a new feature; it is the withdrawn design. Either (a) gate this task on the
account, or (b) re-open the decision explicitly, accept the single-browser limitation, and say
in the UI that the choices are local and will be lost. Cases, parties and news people are new
subjects and should reuse the same IDs/redirects and query semantics as the feed.
Keep a non-personalized “all stories” entry and show why a followed story appears. A later
opt-in reading-history view may describe the sources and framings opened inside this app,
with explicit sample coverage, reset/export/delete controls and unknowns. It cannot claim to
measure everything someone reads or infer their political beliefs. Email/push digests and
accounts are separate follow-up work requiring delivery and preference management; no sends
or subscriptions are created by this plan.

## 12. Operating acceptance and reader outcomes

A pipeline run must report more than success: per-source discovery health; new/backlogged
article analysis lag (p50/p95); extraction rejection rates; publication reachability; event
comparison availability; entity resolution/abstention; tone validation results; review queue
age; and per-run model cost. The original 100/hour capacity arithmetic is a capacity estimate,
not proof that every source or high-interest story is timely. Prioritize analysis fairly
across outlets and emerging events while preserving an explicit backlog queue.

⚠️ **This list is roughly half existing and half new, and saying which is which is the
difference between a report and a rewrite.** Verified 2026-09-21:

- **Already reported per run:** per-source discovery health with `alerts` and
  `field_coverage` (`save_articles.py` intake report, surfaced in the `acquire_direct` stage);
  event-comparison availability (`home_health.py:111-114`, `default_comparisons`, gated by
  `home_health`); per-run model cost and transport latency
  (`analyze_local.py` `summarize_run_billing` → `cost_usd`, token totals, p50/p90).
- **Counted but not aggregated into the run report:** extraction rejection rates (per-domain
  `saved`/`rejected`/`min_body`/`failed` counts exist in the sweep summary and
  `diagnose_yield.py` reports parse-failure classes on demand); entity resolution/abstention
  (`resolve_mentions.py` returns `resolved`/`refused`; the mention-index stage reports
  `pairs_found`); tone validation (`score_analyses.py` has party-tone macro-F1 / per-tone
  recall floors and the `review_queue` stage reports party-tone counts); publication
  reachability (`check_staleness.py` alarms `manifest_stale`/`manifest_unreadable`).
- **Genuinely new instrumentation:** analysis lag p50/p95 publication→analysis (the existing
  percentiles measure *transport/provider* latency, not analysis lag) and **review-queue
  age** — queue items carry `{url, domain, model, fields}` with no timestamp at all.
  ⚠️ `home_health` is in `home.json`, **not** in `stats.json`.

Also ⚠️ add the one metric this plan needs and the list omits: **the `quality`/`site_relevant`
publication funnel** (§1.3) — counts at each gate, per source and per day. Without it, every
coverage and ranking claim rests on an unmeasured model cut.

Before each implementation tier, freeze a reproducible baseline and declare its budgets.
Use the existing home payload budget, a **re-measured** feed page budget (§T1.1), no eager
full-corpus fetch ⚠️ (already true: the corpus is split into index pages, per-story detail
files and a url map, and `stories.json` has no live consumer), and measured mobile
transfer/render performance as constraints — ⚠️ `npm run news:perf:gate` already enforces
html/css/js/home gzip ceilings and `news-release-readiness-v1.md` §T5.4/T5.6 records them
with the release gate and rollback that this paragraph restates; cross-reference it rather
than re-deriving the numbers. Content updates must
not change historical assessment versions silently. A failed new bundle keeps the last valid
generation with a visible freshness label; rollback restores one coherent manifest.

The end-to-end acceptance journey is: open the 24h briefing → find the Петрохан case →
choose a specific event → compare at least two independently identified outlets → select
Калушев → inspect each assessment’s voice and evidence → open the original → share the
filtered comparison. Following is a separate post-v1 journey gated by T7.3, not a launch
requirement that restores the withdrawn browser-only feature. Where coverage is insufficient, the page must state
that instead of manufacturing a comparison. Validate the same journey with a non-political
person and an ambiguous namesake.

Track reader task completion, opening another source, comparison use and returns to followed
subjects alongside accuracy and freshness. These are proposed product measures, not existing
analytics results. ⚠️ **The event names already exist and are typed** —
`NewsAnalyticsEvent` (`newsapp/app/analytics.ts:18-72`) already carries `reader_task`
(`briefing`/`find_story`/`compare_coverage`/`open_original`), `reader_outcome`
(`search`/`comparison`), `home_filter`, `story_filter`, `reader_share` and `web_vital`, and
`newsVitals.ts` emits LCP/INP/CLS per route. What is missing is a **sink**: `emitNewsEvent`
posts to `window.naiasnoNewsAnalytics`, which **nothing installs in production** (only tests
set it). So the task is to add a sink, an aggregation store and a consent check — not to
define an event vocabulary, and not to claim the events are being collected. ⚠️ No consent
mechanism was found in the news app, so "use the site's consent policy" needs a named
artifact; a click on another source does not by itself prove reduced bias or improved
understanding.

---

## 13. Audit pass 2 — verification record (2026-09-21)

**Scope and method.** Four independent read-only audits were run against the tree, one per
band of the document (§1.1–1.3; §1.4–1.6; §1.7–1.8 + §7–8; §2 + §11–12), each required to
recompute every number and re-read every cited file rather than trusting the plan. Their
findings were then re-checked by hand where they changed a conclusion, and one production
artifact (the live news data manifest) was fetched directly. **No product code was changed.**
This is a historical verification record. Later amendment review supersedes its claims
about snapshot isolation, scoop/velocity, relevance accuracy, causal shares, and person
identity. The corrected task contracts in §3–12 govern implementation; retained counts are
historical observations, not fresh measurements in this review.

### 13.1 What was verified as correct

Re-confirmed exactly, with the file or command that confirms it: the build's
`generated_at`; 5,005 analyses; 2,574 stories; 676 stories/day; 2,114 analyses written on
2026-09-20 with ~90/hour; the story-size histogram (2,361 / 154 / 42 / 17) and max cluster
size 7; `same_event_evidence()`'s three clauses and thresholds and its 48h horizon, and that
it is the *actual* clustering rule (`analyze_articles.py:89,725`), not only a home-feed
filter; `HOME_STORY_LIMIT = 16` at `:1146`; the budget raising above 33 KiB; `stories.json` at
8.8 MB / 2.0 MB gzipped; the live feed leading with late-night foreign wire; no view-count,
velocity or popularity field anywhere; `MixBar` returning null at total 0; `StoryCard`'s
`labelled >= 2` guard and `StoryScreen` lacking it; the five-figure completeness strip at
`text-xs` with the raw rubric id, twice per page; the "up to six words" disclaimer on a single
headline; „(1 от 1)"; the methodology page's silence on extraction, model, 6,000-char
truncation, jev, the clustering rule and its own publish limits, and the empty
„Точност на модела"; the stdlib-only extractor and its rejection codes; `MAX_BODY_CHARS = 6000`;
GLM-5.3-flash via OpenRouter; the 100/hour budget; the bounded canary; jev shadow-only with no
`enforce`; 0 of 218 at the 0.98 floor; `topics.json` v1/26/103 with no presidential
category or subcategory; 605 party-bearing analyses and the 1,190/4/3 histogram;
`entities.people` on 3,444 of 5,005 with the four named totals; the gazetteer's
`status='active' and is_public_figure` filter; `ambiguous_refused` carrying no id; mention
shards carrying no tone; **zero** Калуш entries in the gazetteer; mention ids being slugs, not
numeric `person_id`; the prompt's quote-or-paraphrase demand at `analyze_system.md:122-125`;
`news/config/cases.json` and `news_persons.json` both absent; `blindspot_of()`'s actual body;
the 240-article gold set and the scoring harness; the Ground News workflows on all six pages
(all HTTP 200); the EN route/basename machinery; and `scripts/news_release_manifest.ts`'s
hash build over `dist-news`.

### 13.2 Corrections applied to claims

| # | claimed | corrected | where |
| --- | --- | --- | --- |
| 1 | 10,131 corpus articles | **10,130** (`stats.json`; 49.4% = 5005/10130 exactly) | Status |
| 2 | 1,296 articles stored for 09-20 | basis never stated: **1,300** by `published`, 1,527 by `fetched_at` | §1.1 |
| 3 | `HOME_GZIP_BUDGET_BYTES` at `:1163` | **`:1166`** | §1.1 |
| 4 | the 33 KiB budget bounds the 16-story cap | **refuted**: home.json uses 13,360 of 33,792 bytes (**39.5%**, 2.5× headroom) after the `HOME_OMIT` projection dropped `analysis` (54% of the bundle). The 16 is a product choice | §1.1, T1.1 |
| 5 | 16 → "renders as ~13" | **resolved**: build ships 16 over 30d window; client-side HomeScreen evaluates `storyWithinDays(s.last_published, 1, Date.now())`, filtering against the reader clock; the exact three-story difference was not established | §1.1, §14 |
| 6 | `home.json` is the only feed bundle home reads | it is the only *story* feed; `latest.json` and `stories.json` also exist and **neither has a live consumer** | §1.1 |
| 7 | 660 of 676 "unreachable" | the 16 and 676 refer to different selection windows; the detail archive exists, but full query reachability needs T1.4 | §1.1 |
| 8 | 49.4% is "a closing backlog" | **unverified**; the 30-day window is 2,618/6,752 = 38.8%, lower than lifetime | §1.1 |
| 9 | homeHierarchy ranks by recency with a 24h breadth tiebreak | true for the **lead** arm only; the supporting arm has no bucket, and the build has a third key | §1.2 |
| 10 | the 24h window "leads with" two 3-outlet Петрохан stories | the pair exists; two 5-outlet and four 4-outlet stories lead it | §1.2 |
| 11 | „консултации с президента" is under `government` | it is under **`elections-parliamentary/coalition-talks`** (`topics.json:77`) | §1.4 |
| 12 | "360 analysed articles" | reproducible only case-sensitively over the model record; IGNORECASE = 366, source text = 493, `summary_bg` = 299 | §1.4 |
| 13 | "…30 more buckets" | **40** more (43–44 buckets; 8 with no primary topic) | §1.4 |
| 14 | 1,194 pairs, histogram sums to 1,197 | **both right**: 1,197 entries, 3 bare, 1,194 metadata-complete | §1.5 |
| 15 | "953 of the 1,194 pairs are neutral" | **953 of 1,197**, or 952 of 1,194 — numerator/denominator mismatched | §1.5 |
| 16 | `build_app_data.py:1578-1600` drops ungrounded tones | correct, but it also honours `human_review=accepted` and a current `PARTY_TONE_EVIDENCE_GATE_VERSION`, and fails closed on exception | §1.5 |
| 17 | `jev_client.py:52` | **`:51`** (`:52` is blank) | §1.6 |
| 18 | mention shards are `{article_count, articles[]}` | they also carry `shown` and **`analyzed_count`**, but neither is a target-specific tone count; T4.4 adds that contract | §1.6 |
| 19 | 2,588 story files; 91.8% single-outlet | the file count includes 13 index pages + `by-url.json`; over 2,574 stories it is **92.3%** | §1.7 |
| 20 | one-member bar reads „Без ясно рамкиране · 100%" | conditional on an applicable label; exact strings are `… · 1 (100%)` (tooltip) and `… 100%` (legend) | §1.7 |
| 21 | completeness line is in `StoryScreen` | it is a separate component, `AggregateCompleteness.tsx`, rendered **twice** by `StoryScreen` (once per axis). ⚠️ It is **not** shared with the topics screen — see §14.2 | §1.7, T5.4 |
| 22 | „Дисперсия" is story-page jargon | it is on **`TopicsScreen`** only, and was moved there deliberately the same day | §1.7, T5.6 |
| 23 | segment selection "can empty the timeline" | needs **both** axes; either bar's toggle clears its own axis | §1.7, T5.7 |
| 24 | `MethodologyScreen.tsx` is 808 lines | **806** | §1.8 |
| 25 | four rejection reasons | four **of six** (`robots_disallowed`, no-title-no-content) | §1.8 |
| 26 | "82.1% of all analysed articles" | 82.1% of the **2,876 story-member articles**; 47.2% of all 5,005 | §1.3 |
| 27 | "92 raw articles … 273 analyses … ~109 stories" | **91 / 161 / ~113** (274 by the widest reading; no reading gives 273), and three Янкулов stories, not two | §1.3, T2.0, T3.3 |
| 28 | Петрохан spans "30+ topic buckets" | 161 analyses; the topic-space claim was not re-derived | §1.3 |
| 29 | a "versioned manifest + immutable generation" is to be built | it is **live**: manifest v3 on GCS, `data_base: versions/<run_id>`, per-file sha256 inventory, hot overlay, 60 s/5 min poll | T1.1, T1.5 |
| 30 | 50 KiB per feed page | ⚠️ no such budget exists in the repo (it is this plan's proposal); the 200-row page measures **50,876 B** at gzip 6, and other 200-row pages reach **55,602 B** — see §14.2 | T1.1 |
| 31 | the merge queue is to be created | it **exists**: 100 items, 15 pending | T2.2 |
| 32 | "the site's existing publication policy" for private people/minors | **no such policy exists** anywhere in the repo | T4.4 |
| 33 | person release floors are assemblable | the gold set under-filled its own person cell: wanted 40, got 30 | T2.3, T4.5, T6.3 |
| 34 | `site_relevant` absent from the plan | it is a hard gate that removes **1,941** quality-ok analyses (40.2% of quality-ok) before any story exists | §1.3, T1.2, T2.0, T3.2, T6.2, T7.1, §12 |
| 35 | `news-site-v1.md` T4.2 is the gold set | T4.1 is the set, T4.3 the harness; **T4.2 is the unrun frontier baseline** | T6.3 |
| 36 | `home_health` is in `stats.json` | it is in **`home.json`** | §12 |
| 37 | "define event names" before collecting analytics | the typed vocabulary **already exists**; the missing piece is a sink — nothing installs `window.naiasnoNewsAnalytics` in production | §12 |
| 38 | T7.3 offers "local bookmarks and follows" | that exact browser-only design was **withdrawn on 2026-09-21** (`4d48b70036`), with a test asserting it stays absent | T7.3, §9, §10 |
| 39 | `/party/:id` is consistent with the party-tone plan | that sibling plan deliberately excluded a new top-level route from v1 | §6 (T4.2) |

### 13.3 Findings that changed a task, not just a sentence

1. **Publish the funnel separately from the hero cap.** Article exclusions and story
   selection use different units. Their measured counts establish stage volumes, not which
   stage is the dominant cause of a reader's missing story. Stage A and §12 measure both.

2. **The release machinery exists.** T1.1/T1.5 were re-scoped from "build a versioned feed" to
   "extend a live manifest + immutable version tree with feed pages and query semantics",
   which removes a large imagined workstream and changes the file-count risk.
3. **A paginated index is already used by OutletScreen.** Its loaded-prefix filtering is
   the actual gap; HomeScreen still needs the unified query contract (T1.1/T1.3).
4. **Observed timestamps can support momentum; scoop flags cannot define it.** T1.2 reuses
   preserved first-observed timestamps but separates simultaneous arrivals from the question
   of a distinguishable winner.

5. **The home feed has an outlet-dominance policy** (`HOME_MAX_STORIES_PER_OUTLET = 4`,
   `HOME_MIN_COMPARISON_STORIES = 4`) that a new prominence rank would silently discard.
6. **A deliberate terminology decision was reversed by accident.** T5.6 proposed reverting
   „дисперсия"; that word was chosen by the operator hours earlier.
7. **A deliberate feature withdrawal was re-proposed as new work.** T7.3 must acknowledge
   `4d48b70036` and gate on an account or re-open the decision.
8. **The gold set cannot currently support T4.5's floors**, and it says so in its own
   manifest; the plan presented it as sufficient.
9. **Two UI fixes land in different files from the thing they fix** — the strip is a component
   rendered twice from two call sites (not a shared screen component; §14.2 corrects this).
10. **The news app is a separate origin and package** (`news.electionsbg.com`, `dist-news`,
    `typecheck:news` outside the root `tsc -b`), which the routing tasks never said.

### 13.4 Open, unverified or dated — do not quote without re-measuring

- The **`site_relevant`/`quality` gate's own accuracy** remains unmeasured against human
  labels. Later keyword totals found included political coverage and irrelevant foreign
  matches; neither inclusion nor the model's `crime-blotter` label proves correctness.
  Sample both sides of the boundary and publish the funnel (T1.4/T3.2).

- The **"~13 stories"** figure from the operator's R1 is **mechanically explained but not measured**:
  `HomeScreen.tsx` filters with `storyWithinDays(s.last_published, days, Date.now())` and
  `defaultHomeDays()` returns 1 while ≥6 stories sit inside 24h. ⚠️ The claim that "exactly 3 of the 16
  were >24h old" is **not supported by any committed artifact** — the bundle's own `home_health` records
  `selected_within_24h: 16` and an oldest age of 4.33 h at build. 13 occurs only when the reader's clock
  is far enough ahead, and then the window auto-widens and the count jumps back (§14.2).
- The **Петрохан topic-bucket count** and the **"30+ buckets"** framing were not re-derived.
- ⚠️ **The size of the clustering problem if the vetoes are relaxed** has only a story-level proxy
  (§1.3: ~79 blocked merges corpus-wide). The article-level re-run, on T2.0's frozen set, is unrun.
- The **sibling party-tone plan's "no new top-level route"** statement is quoted from that
  plan; whether it is still current was not established.
- **Ground News evidence is public-page only.** The reading-history citation is a demo page,
  and no logged-in or subscription behaviour was inspected.
- Every figure here belongs to the build with `generated_at` **2026-09-20T23:25:54Z** and run
  id **2026-09-20T230007Z-18578**. The corpus is hourly; the live manifest already differed
  from the local tree during the audit (5,015 indexed articles vs 5,005 analysed at build
  time; 2,577 story index entries vs 2,574 built). Quote a number with its build.

---

## 14. Audit pass 3 — comprehensive codebase audit and folded findings (2026-09-21)

**Scope and method.** A targeted, source-verified codebase audit was conducted across all news ingestion,
analysis, and presentation layers (`news/scripts/`, `newsapp/app/`, `news/topics.json`, `news/prompts/`,
`newsapp/prerenderRoutes.ts`, and commit history `87a99ee3df`, `4d48b70036`, `6289ba8e96`). Its findings
were folded into the relevant sections of this plan.

⚠️ **Pass 3 was then itself audited (pass 4), and twelve of its claims needed correction — one of them
decisive.** §14.1 below is kept as the record of what pass 3 found, **with each corrected finding marked**;
§14.2 states the corrections, the measurements behind them, and what was refuted. Read the two together,
and prefer the final task contracts in §3–12; §14.2 has also been corrected by the amendment review.

### 14.1 Folded findings and technical reconciliations

1. **Root Cause of R1 ("Only 13 stories in 24h") — ⚠️ MECHANISM CONFIRMED, COUNT CORRECTED (see §14.2):**
   - *Code mechanism:* `build_app_data.py:1146` generates `home.json` with up to `HOME_STORY_LIMIT = 16` stories
     selected over a 30-day lookback window (`HOME_WINDOW_DAYS = 30`).
   - *Runtime mechanism:* In `HomeScreen.tsx`, the home view applies `filterHomeStories(..., { days })`, which
     calls `storyWithinDays(story.last_published, days, Date.now())` against the reader's live browser clock
     (refreshed every 60 s). Any story older than `days` from the client's `Date.now()` is filtered out
     client-side. `days` is not fixed at 1 — it comes from `defaultHomeDays()`, which returns **1** while ≥6
     stories sit inside 24 h and **7** otherwise (`homeFilters.ts:36-44`, `HOME_MIN_DEFAULT_STORIES = 6`).
     ⚠️ `briefingPreferences.completedStoryIds` is a third, independent way a returning reader sees fewer cards.
   - *Reconciliation (as pass 3 stated it):* "exactly 3 of the 16 stories had publication timestamps >24h old,
     rendering precisely 13". ⚠️ **The mechanism is right; the measurement is not, and §14.2 corrects it.** The
     committed bundle's own `home_health` records `selected_within_24h: 16`, `default_visible: 16` and an oldest
     age of **4.33 h** at build — so at build time **zero** of the 16 are older than 24 h. "3 older than 24 h"
     is a state of the reader clock and window selection, not of the bundle. The exact timestamp and immediate-widening claim are withdrawn:
     13 falling to 12 does not cross the default window's fewer-than-six threshold.
     The fix is not to increase `HOME_STORY_LIMIT` blindly, but to provide server/index-level filtering before
     pagination (T1.1, T1.3) so the client receives a full page of stories strictly within the selected window —
     **and so the count stays stable within a pinned browse snapshot; refresh can change it.**

2. **The 3 Hard Negative Vetoes in `same_event_evidence()` (`home_event_dedupe.py:85-126`):**
   - *Code mechanism:* ⚠️ Three consecutive hard negative vetoes run **before** textual similarity is evaluated,
     and each is verified in code — each applies only when **both** sides are non-empty:
     1. `_primary_topic` veto: aborts if `left_topic != right_topic` on the `(category, subcategory)` tuple
        (`_primary_topic` `:52-58`, veto `:96-97`).
     2. `_places` veto: aborts if `left_places.isdisjoint(right_places)` (`:99-101`).
     3. `_numbers` veto: aborts if title **ASCII digits** are disjoint (`:102-104`; `_numbers` filters
        `TOKEN_RE.findall(title)` to `isascii() and isdigit()`), so "3 институции" vs "30 дни" does veto.
   - ⚠️ *Causality is NOT established.* That these vetoes **are** the cause of the 92.3% singleton rate is a
     hypothesis this plan's own T2.0 exists to test; what is verified is that they *can* block true pairs
     (pass 3's Янкулов example is one such pair, whose exact domains/topics §14.2 re-checks). The counterfactual —
     re-run clustering with each veto relaxed and measure precision/recall on the frozen set — is the measurement.
   - *Reconciliation:* T2.1 mandates the reforms **in the review channel**, staged behind T2.0's labelled set,
     with the places veto narrowed rather than removed and no embeddings without an explicit decision. §10's
     "does not lower the existing merge thresholds" and T2.3's 0.99 precision gate still bind the auto-accept path.

3. **Civic scoping and `not-site-relevant` — wholesale-exclusion claim unsupported; accuracy still open.**
   - *Boundary (corrected citations):* the category is `topics.json:1716-1801` (`"site_relevant": false`
     at `:1722`; subcategories weather, sports, celebrities, **crime-blotter** „Битова престъпност и
     произшествия" `:1775`, misc-filler); the `:12-17` lines are `how_to_use` prose, not the definition.
     ⚠️ „черна хроника" occurs **0 times** in `topics.json` — it is the prompt's phrase
     (`analyze_system.md:134-136`), and that prompt **explicitly says investigating an official or КПКОНПИ
     is NOT черна хроника** — a carve-out pass 3 omitted while claiming the rule is routinely broken.
   - *Failure mode as pass 3 stated it:* the classifier routinely files Петрохан / border shootings /
     the pardon as „черна хроника" → `site_relevant: false` → dropped. **Not established** by the counts on
     the 5,095-analysis corpus: Петрохан **131/150 true**, Калушев **53/71 true**, помилва **44/46 true**;
     the false remainder includes model-labelled crime detail (17 `crime-blotter`) and two foreign items (Hunter Biden,
     Najib Razak). These labels are not human adjudication. The “border shootings” example
     was not reproduced. See §1.3 for the table.
   - *Mechanism (this part stands):* `site_relevant` is a model output validated against the primary topic
     (`analyze_articles.py:1542-1545`), not a derivation, and exclusion is enforced at
     `analyze_articles.py:1558-1559` and `build_app_data.py:1848`.
   - *Reconciliation:* §1.3 now measures the gate instead of asserting its failure, re-scopes the boundary
     audit to `crime-blotter` (30 of 73 „нарко" records are `false`), and keeps the confirmed part —
     the **taxonomy** failure that files the pardon under `elections-parliamentary/campaign` (T3.1/T3.2).

4. **Critical Build-Time Consumer of Monolithic Files — ⚠️ CORRECTED (see §14.2).**
   - *Code mechanism:* `newsapp/prerenderRoutes.ts` reads `outlets.json` (`:230`), `stories.json` (`:261`),
     `latest.json` (`:309`), `evals/queue.json` (`:341`) and `home.json` (`:350`) at build time, emitting
     **6,040 routes** (BG+EN): story 5,246, outlet 146, article 300, eval-article 334, hubs 13. It never reads
     `stories/index-*.json` or `stories/by-url.json`.
   - ⚠️ *The "sitemap entries for all ~2,574 stories" half is wrong:* story routes set
     `sitemap: outletCount >= 2` (`:288`), so only **201 of 2,623** stories per language are submitted
     (402 with EN); the rest are prerendered and deliberately excluded from the sitemap.
   - ⚠️ *Migration is not a drop-in:* `StoryIndexRow` lacks `summary_bg`/`summary_en` (2,622 of 2,623 stories
     have one), though `aggregates.outlet_count === domains.length` was verified for all 2,623; the per-story
     detail files do carry the summaries. `latest.json` has **no** partition — `articles/<domain>.json` is a
     different, larger set.
   - *Reconciliation:* Folded into §1.1/T1.1 with the corrected dependency and a measured page-budget table.

5. **`useStoryList` is Live in Production; Client-Side Filtering Hazard:**
   - *Code mechanism:* `newsapp/app/screens/OutletScreen.tsx:332` already consumes `useStoryList()`. It filters stories
     client-side (`s.domains.includes(domain)`) over only the loaded index page, causing older stories to remain hidden
     until "load more" is clicked.
   - *Reconciliation:* Folded into §1.1 and §3 (T1.3). T1.3 establishes a unified global query/filter contract across
     both HomeScreen and OutletScreen, ensuring server/index-level filtering precedes pagination.

6. **Feed Page Budget Calibration — ⚠️ PREMISE CORRECTED, `= 150` RETAINED (see §14.2).**
   - *Measurement:* there is **no** 50 KiB feed-page budget in the repository
     (`news_performance_budget.ts` gates only html/css/js/homeJsonGzip) and "51,002 bytes" is not reproducible
     at any gzip level. Measured at level 6: 100 rows → 26,898 B / 27 pages; **150 → 39,084 B (38.2 KiB) / 18
     pages**; 200 → 50,876 B / 14 pages. Other 200-row pages run 51.2–55.6 KiB, so page 1 is not the worst case.
   - *Reconciliation:* `STORY_PAGE_SIZE = 150` is sound; any ceiling belongs in `news_performance_budget.ts`
     as a gate. `write_story_pages` splits by **row count only**.

7. **Case Specifications (`cases.json`) — ⚠️ SUBSTANTIALLY REWRITTEN (see §14.2).**
   - *Design as pass 3 wrote it:* match rules and cross-topic bridges for `petrohan` and `narco-pardon`.
   - ⚠️ *Four claims did not survive fact-checking:* the `petrohan` AND-rule kept only 71 of 160 analyses while
     a bare OR pulled in weather/tourism; "наемател на хижа Петрохан" is unsupported; „allegations involving
     Sandov and Terziev" was replaced with an unsupported assertion of charge status; the cited
     denial-of-charge headline does not establish that status. T3.3 removes that inference; and the
     `narco-pardon` rule returned 66 matches of which ≈23 were the affair, because „Огнян Атанасов" has ≥3
     referents (subject, mayor of Кюстендил, football coach). Терзиев is not gazetteer-resolvable; ДАНС is.
   - *Reconciliation:* T3.3 now carries affair-scoped rules, negative exclusions, review-by-default for the
     namesake, and integrity rules (sourced descriptions, claim-specific responses, no bare-surname
     identity resolution). Broad terms remain allowed for candidate retrieval only. T3.1
     keeps the `elections-presidential` subcategories.

8. **Dedicated News-Person Identity Namespace (`news_persons.json`):**
   - *Architecture:* Main-site `person` records require `status='active' and is_public_figure`, and their numeric IDs
     get reassigned on resolve. News subjects frequently include private citizens, business managers, witnesses, and
     suspects who have no official profile on `naiasno.bg`.
   - *Reconciliation:* Folded into §1.6 and §6 (T4.0, T4.3, T4.4). ⚠️ The **illustrative record was corrected** —
     opaque id, no global bare-surname alias, and no unevidenced `disambiguation_bg`. The Kalushev pilot is
     really a from-scratch identity test (0 gazetteer entries, 0 mentions); the Atanasov pilot is the
     ambiguous-identity test (≥3 referents).

9. **StoryScreen vs `AggregateCompleteness.tsx` & Retention of „дисперсия“:**
   - *Component boundary:* ⚠️ **CORRECTED — see §14.2.** `AggregateCompleteness.tsx` is imported **only** by
     `StoryScreen` (`:30`) and rendered **twice**, once per axis (`:364`, `:383`); `axisCompleteness()`
     (`newsapp/app/aggregateCompleteness.ts`) is likewise StoryScreen-only. It is **not** rendered by
     `TopicsScreen` — that screen's `:598` „извън обхвата" is an out-of-scope badge on an off-topic category
     row, an unrelated string. The real constraint is two call sites on one page, so T5.4's "once per page"
     needs state lifted into `StoryScreen`, not a `variant` prop.
   - *Operator terminology:* On 2026-09-21, commit `6289ba8e96` deliberately replaced the colloquial „Разсейване“ with the
     precise statistical term „дисперсия“ on `TopicsScreen`.
   - *Reconciliation:* Folded into §7 (T5.2, T5.4, T5.6); „дисперсия“ is explicitly preserved and T5.6 must
     not re-litigate it.

10. **Consolidation of `/about` into `/methodology` (Commit `87a99ee3df`):**
    - *Repository state:* Commit `87a99ee3df` absorbed the standalone `/about` screen into `MethodologyScreen.tsx`,
      unifying editorial principles, ownership/funding disclosures, and right of reply.
    - *Reconciliation:* Folded into §8 (T6.1, T6.2). Tier 6 maintains this consolidated structure and avoids re-creating
      a redundant `/about` screen.

### 14.2 Pass-3 review — what was verified, corrected, and still open

Pass 3's additions were re-verified against the tree before being accepted; **twelve** needed
correction — one of them decisive — and all are fixed in place above. This subsection is the record, so the numbers
in §14.1 are not read as measurements they are not.

**Verified and retained from pass 3:** the prompt and taxonomy quotes (`analyze_system.md:134-136`
verbatim; `topics.json` `how_to_use` stating that a `not-site-relevant` primary topic carries
`site_relevant: false` and is excluded from clustering); the three veto helpers in
`home_event_dedupe.py` (`_primary_topic` → `(category, subcategory)`, `_places` → disjoint set,
`_numbers` → `isascii() and isdigit()` over `TOKEN_RE.findall(title)`), each applied only when
**both** sides are non-empty; `newsapp/prerenderRoutes.ts:261` reading `stories.json` and `:309`
reading `latest.json` at build time for routes/sitemap; and `OutletScreen.tsx:332` +
`:363-370` consuming `useStoryList()` and filtering the revealed prefix.

**Corrections applied**

1. **"Exactly 3 of the 16 stories were >24h old" is not supported by any artifact.** The
   committed bundle's own `home_health` reports `selected_within_24h: 16`, `default_visible: 16`
   and `oldest_hours: 4.33` at build time — at build, **zero** stories are older than 24 h. The
   mechanism pass 3 identified is real (`storyWithinDays` against the reader's clock), but the
   count is a function of *when the reader looks*, and `defaultHomeDays()` (`homeFilters.ts:36-44`)
   means the window widens from 1 to 7 days once fewer than 6 stories remain inside 24 h — so the
   count walks 16 → 6 and then **jumps back to 16**. For the audited build the "3 older than 24 h"
   state depends on reader time and selection; exact transition timestamps are not retained
   as verified findings. §1.1 now states the behaviour
   instead of the count, and `completedStoryIds` is named as the third path that removes cards.
2. **`AggregateCompleteness.tsx` is not shared with the topics screen.** It is imported by
   `StoryScreen` alone (`:30`) and rendered twice, once per axis (`:364`, `:383`); so is
   `axisCompleteness()` (`aggregateCompleteness.ts`). `TopicsScreen`'s `:598` „извън обхвата" is
   an out-of-scope badge on an off-topic category row — an unrelated string. ⚠️ **This also
   corrects pass 2**, which made the same assumption without checking; §13.2 #21 and §13.3 #9 are
   updated. The genuine constraint is two call sites on one page, so T5.4's "once per page" needs
   state lifted into `StoryScreen`, not a `variant` prop.
3. **`newsapp/app/routes.tsx` does not exist.** News routes are declared in
   `newsapp/App.tsx:348-360`; `src/routes.tsx` does exist and is the main site's. Following pass
   3's wording literally would have created an unimported file and left `/case/:slug`,
   `/person/:newsPersonId` and `/party/:id` unreachable. T4.4 now cites the real file.
4. **The veto reforms were written as auto-accept changes, which this plan forbids.** T2.2 keeps
   the conservative auto-accept rule, T2.3 requires observed precision ≥0.99, §10 commits that
   the plan "does not lower the existing merge thresholds to buy cluster size", and
   `home_event_dedupe.py`'s own docstring says it "does not rewrite canonical story membership"
   and emits every decision as a review proposal. T2.1 now stages the reforms: category-level
   topic matching may be measured against T2.0's labels; cross-category joins and the relaxed
   digit rule stay **review-only**; the places veto is **narrowed, not removed** (pass 3's own
   Burgas-vs-Varna example is the case where the place *is* the event); and "semantic embeddings"
   needs an explicit budget and dependency decision. The client's stdlib implementation
   does not require an API call per pair or prohibit cached per-article embeddings (T2.1).
5. **"The direct mathematical cause of the 92.3% singleton rate" overstates a hypothesis.**
   The vetoes provably *can* block true pairs; that they *are* the cause of the rate is what
   T2.0's frozen-set counterfactual exists to measure. §1.3 and §14.1 #2 now say so, and T2.1
   requires the re-run rather than the assertion.
6. **Funnel arithmetic.** §1.3's table is the source of truth — 5,015 analysed → 4,824
   quality-ok → 2,883 site-relevant → 2,574 stories → 16 on the home page. T1.4's denominator
   list and §1.3's "2,879 site-relevant" were stale and are corrected to 4,824 / 2,883.
7. **The `STORY_PAGE_SIZE = 150` proposal is now measured, and its premise was wrong.**
   ⚠️ The "50 KiB budget/ceiling" is **this plan's own proposal** — there is no feed-page budget
   in the repository; `scripts/news_performance_budget.ts` gates only `html`/`css`/`js`/
   `homeJsonGzip`, and no 50 KiB constant exists in `news/`, `newsapp/` or `scripts/`. The
   "51,002 bytes" figure is **not reproducible at any gzip level** (level 6 gives 50,876 B for
   page 1; the built copy 50,962 B). Measured from `write_story_pages`' own wrapper at level 6:
   **100 rows → 26,898 B / 27 pages; 150 → 39,084 B (38.2 KiB) / 18 pages; 200 → 50,876 B /
   14 pages.** The `= 150` choice is sound, but note page 1 is not the worst page — the other
   200-row pages run 51.2–55.6 KiB — and `write_story_pages` splits by **row count only**. Any
   ceiling adopted belongs in `news_performance_budget.ts` as a gate, not in prose.
8. **The prerender dependency was overstated in two ways.** `prerenderRoutes.ts` reads five
   bundles (`outlets.json :230`, `stories.json :261`, `latest.json :309`, `evals/queue.json
   :341`, `home.json :350`) and emits **6,040 routes**. ⚠️ It does **not** put "all ~2,574
   stories" in the sitemap: story routes set `sitemap: outletCount >= 2` (`:288`), so only
   **201 of 2,623** stories per language are submitted. ⚠️ And the partitioned index is **not a
   drop-in**: `StoryIndexRow` lacks `summary_bg`/`summary_en` (2,622 of 2,623 stories have one),
   though `outlet_count === domains.length` was verified for all 2,623. `latest.json` has no
   partition at all. T1.1 now states the migration as a change to `prerenderRoutes.ts`.
9. **The OutletScreen hazard is confirmed and stated precisely.** Filtering is over the revealed
   200-row prefix; the heading renders `participating.length` (not the index total), and a
   caption already admits older stories may exist. T1.3 carries the accurate version.
10. **The named individuals in the case specs and pilots are now corpus-checked, and four claims
    did not survive.** Re-verified on the 2026-09-21T00:31Z corpus:
    - **The proposed tenancy description was unsupported by the checked sample.** Absence
      of the term does not refute a real-world role; omit the description unless sourced.
    - ⚠️ **`aliases: ["Калушев"]` is unsafe** — it collides with his father (Георги Калушев) and
      misses the `Калушиев` misspelling. Case scope alone does not resolve this collision;
      T4.0 requires anchored mention context or an article-specific reviewed override.
    - **Charge-status inference withdrawn.** The cited title reports a denial of being
      charged; it cannot substantiate the earlier statement “was charged and denies it”.
      T3.3 keeps disputed claims attributed and leaves conduct out of identity labels.

    - ⚠️ **The `narco-pardon` match rule produced real false positives.** „Огнян Атанасов" has
      ≥3 referents (subject, **mayor of Кюстендил**, football coach); the gazetteer records the
      two-part form `resolvable: false` with all 17 mentions `ambiguous_refused`. The literal rule
      returned **66 matches of which only ≈23 are the affair** — a verified false positive is a
      bta.bg festival report matching Йотова's patronage with the **mayor**. T3.3 now requires
      review-by-default and contextual identity evidence; neither nickname is unique (T3.3).
    - ✅ Names and actors that **did** check out: Огнян Атанасов as the coverage's name; **Vice
      President Йотова** as the pardoning actor in the corpus's own framing (no article names the
      President); Сандов resolvable (`mp-3401`); ДАНС resolvable (EIK `129009710`).
    - ⚠️ Терзиев is **not** resolvable (0 `gazetteer_exact`, 63 `not_in_gazetteer`, 3
      `ambiguous_refused`), and Софийска градска прокуратура's gazetteer forms are
      `resolvable: false`; a case must show those as unlinked names, never as person profiles.
    - ⚠️ The `petrohan` rule was also wrong in both directions: an AND of
      `["петрохан","калушев"]` keeps only **71 of 160** analyses, while a bare OR pulls in weather
      and tourism. T3.3 specifies an affair-scoped rule with investigative co-terms and name
      exclusions.
11. **Relevance accuracy remains open.** The later sample found 131/150 Петрохан,
    53/71 Калушев and 44/46 помилва matches marked relevant, with unrelated foreign cases
    among the excluded matches. This weakens the claim of wholesale exclusion but does not
    validate the classifier: the same model supplied the topics and relevance labels.
    T3.2 must compare adjudicated included/excluded samples and repair coupled fields.
12. **The “~3% causal share” conclusion is withdrawn.** The historical proxy reported 25
    blocked pairs involving 46 stories in one day and 79 involving 143 stories across the
    corpus. Those pairs are not validated merges, unique removed singletons or an
    article-level clustering counterfactual. Preserve the counts as diagnostic observations;
    T2.0–T2.3 determine effects on precision, recall and cluster membership.

**Vintage warning.** Several figures in §1.1/§14.1 are from the **2026-09-20T23:25Z** build while
the corpus on disk has moved (2026-09-21T00:31Z: 5,095 analyses, 2,623 stories, 14 index pages,
`stories.json` 9.0 MiB, `latest.json` 849 KiB, Петрохан 160). Both are stated where they differ;
neither is wrong, and a third will differ again within the hour. Quote a figure with its build.

---

## 15. Amendment review — fold-in of independent findings (2026-09-21)

This pass re-read the amended document against the tree and re-measured its contested
claims. It confirms the corrections the earlier passes applied to the original draft, and
adds three findings none of the passes hold. Two of them change a task contract; one is a
**live production failure that is firing every hour right now** and that silently removes
the input two tiers depend on.

Measurement basis, stated because the corpus moved during the work: the clustering figures
below are from the **2026-09-21T00:38:35Z build** (`stories/index-1.json`: `total: 2623`,
`pages: 14`, `page_size: 200`; 5,095 analyses), **not** the 2,574-story /
2026-09-20T23:25:54Z build §1 uses. Per the header rule, do not divide one into the other.

### 15.1 Confirmed, independently

- ✅ **The gzip budget does not bind, and the original draft's "cannot simply be raised" is
  refuted.** Re-measured on the later build: `home.json` gzips to **13,377 bytes** against
  `HOME_GZIP_BUDGET_BYTES = 33 × 1024 = 33,792` (`build_app_data.py:1166`) — **39.6% used,
  2.5× headroom**, agreeing with §1.1's 13,360 on the earlier build. `HOME_STORY_LIMIT = 16`
  is a product choice. T1.1/T1.2 may treat the byte ceiling as slack, not as a constraint.
- ✅ **The paginated index exists and must be extended, not rebuilt.** `stories/index-*.json`
  is live at **14 pages × 200 = 2,623**, each page carrying
  `{generated_at, page, pages, page_size, total, stories}`. Sampled pages gzip to
  **50,889 B** (page 1) and **53,016 B** (page 7) — both **above** the 50 KiB ceiling T1.1
  proposes, confirming T1.1's own warning to gate every page rather than extrapolate from
  the first.

### 15.2 ⚠️ Tier 2 is reforming the *secondary* decider — measured

**The plan treats `same_event_evidence()` as the clustering rule. It is not the primary
one.** `analyze_articles.py` hands the model up to six prefiltered candidates and the model
returns `story.action ∈ {new_story, same_story, none}` — the prompt says so in terms
(`:2031`, "candidates are a prefilter, the **same_story/new_story call is yours**").
`auto_merge_host()` then runs **only in the `new_story` direction** (`:1640-1647`,
"Only in this direction: a declared `same_story` is somebody's"), converting a model refusal
into a join and stamping `merge_basis.by = "same_event_evidence"`.

So a model-declared `same_story` **never meets the three vetoes at all**. Measured over all
5,095 analyses in the 00:38Z build:

| `story.action` | records |
| --- | ---: |
| `none` (quality / `site_relevant` exclusions — §1.3) | 2,168 |
| `new_story` | 2,705 |
| `same_story` | **222** |
| …of which stamped `merge_basis.by = same_event_evidence` | **192** |

Two consequences, and both change how T2 must be scoped:

1. **The model joins almost nothing on its own: 222 − 192 = 30 of the 2,927 clusterable
   articles (1.0%).** The deterministic fallback produces **192 of 222 joins — 86.5% of all
   clustering in the corpus.** The rule the plan calls a fallback is doing essentially all
   of the work, which *strengthens* T2.1's focus on it — but the remaining, unreformed
   1.0% arm is a second recall source that no task currently measures. T2.0's frozen set
   must label it separately, because a model that joined even modestly better would move
   more than a veto relaxation can.
2. **§1.3's counterfactual measures the wrong arm.** The 25 / 79 "blocked candidate pairs"
   were computed **story-level, over every pair within 48 h**. `auto_merge_host` runs
   **article-level, against the six retrieved candidates, at analysis time, comparing to the
   story's frozen canonical title** (its docstring: "IT COMPARES AGAINST THE STORY'S
   CANONICAL TITLE, which `recompute_story` never rewrites"). Those are different
   populations, and the story-level proxy can only under-count. §1.3's own caution — re-run
   article-level candidate retrieval and cluster construction — is therefore not a
   refinement but a requirement; the 79 figure must not be cited as an upper bound in the
   meantime.

**Two in-repo priors nobody cited, both directly on T2's question.** `auto_merge_host`'s
docstring records measurements from 2026-09-02:

- **The recall gap is already quantified.** Before the fallback existed: "over six days of
  corpus, **0/0/1/0/1/0 multi-outlet stories**, while **67% of articles had a strong
  cross-outlet candidate sitting in the prefilter, computed every run and read by nothing**."
  That 67% is an existing measurement of how much same-event material the retrieval stage
  already surfaces and the join stage discards. T2.0 should reproduce it on the frozen set
  as its baseline rather than deriving a new one from scratch.
- **The rule's precision has an audited record.** "Of the **90** proposals it produced,
  **85 were accepted and applied with 0 refused**." T2.3 proposes an auto-join gate of ≥300
  adjudicated pairs at observed precision ≥0.99 with a 95% lower bound ≥0.97. The existing
  record is 85/90 with zero refusals — a strong prior, but at n=90 its 95% lower bound
  cannot reach 0.97, so **the existing evidence does not clear the gate the plan proposes**.
  Say so, and budget the annotation, rather than letting the record read as if it does.

**Added to T2.1:** the candidate prefilter has a recall ceiling of its own, independent of
the vetoes, and the task says "extend candidate retrieval" without naming it.
`candidate_stories()` (`analyze_articles.py:772-823`) scores every existing story as
`3 × |shared title tokens| + min(entity_points, 3) + date_score(≤2)`, keeps
`score ≥ MIN_CANDIDATE_SCORE = 3` and returns the top **`MAX_CANDIDATES = 6`**. Two
properties follow: a single shared title token clears the bar, so the *filter* is weak while
the *cut* is hard; and one title token is worth 3 points while **all** entity evidence
together is capped at 3 (`ENTITY_CONTRIBUTION_CAP`), so retrieval is title-dominated before
the veto stage is ever reached. On a day holding 676 stories, a running affair whose ~113
stories compete for six slots can lose the correct host to near-duplicates of itself. T2.1's
union retrieval must replace this ranking, not sit behind it.

**Added to T2.2:** an operational kill switch already exists —
`NEWS_AUTO_MERGE=0` (`analyze_articles.py:693`) disables the fallback entirely. The staged
rollout T2.2 describes should name it, and any A/B of a relaxed rule should be expressed
through it rather than through a new flag.

### 15.3 ⚠️ Live: the evaluation and feedback loop has been failing hourly, and nothing blocks on it

The scheduler question is settled, and in the opposite direction to the sibling plan.
`news-jev-realtime-cloud-worker-v1.md` §0 states "⚠️ **The pipeline is not running** … no
`crontab` entry for the news job exists on this machine — **nor did one ever**". That is now
**stale and must not be carried into this plan's premises**: `com.naiasno.news-hourly.plist`
and `com.naiasno.news-staleness.plist` are installed (2026-09-19) and loaded, runs fire at
`:00` each hour, and the last runs report `pipeline_exit: 0`, `upload_exit: 0` with a
completed five-scope GCS publication.

**But `eval_task_sync_exit: 1` on 6 of the last 8 distinct hourly runs — 11 of the 31 runs
the watcher has seen**, on one recurring error, and the staleness watcher raises
`run_failed` / `ok: false` each time. (Count distinct `last_run_id`s, not staleness *checks*:
the watcher polls every 30 min and re-reports the same run twice.)

```
feedback_sync: {"error":"operator_failed",
                "message":"feedback target href is outside the canonical site"}
```

**Root cause, verified: the fix is written and is not being executed.**
`CANONICAL_SITE_PREFIXES` in `news-functions/src/operator.ts:26-29` already carries **both**
`https://naiasno.bg/` and `https://electionsbg.com/`, with a comment explaining that a
registry built either side of the rebrand is canonical, and `:847` is the throw. The hourly
job does not run that source: `news/scripts/eval_runtime.py:109` invokes
**`news-functions/lib/operator-cli.js` directly, with no build step**. The compiled artifact
is older than the source (`lib/operator.js` 01:36 vs `src/operator.ts` 01:55) and contains
**zero occurrences of `naiasno.bg`**. The npm wrappers (`news:feedback:tasks:sync` and
siblings) all run `npm --prefix news-functions run build &&` first; **the pipeline is the one
caller that does not.**

⚠️ **Generalise this rather than just fixing it: the hourly pipeline executes a compiled
artifact that no pipeline stage compiles.** Every future TypeScript change in
`news-functions/` is invisible to production until someone remembers a separate build. Either
`eval_runtime.py` builds before invoking, or the run records and alarms on a
source-newer-than-lib mismatch. Silent version skew between a fix and the thing that runs is
the same defect class this plan flags everywhere else.

**Same log, three more failures, and they are the ones that matter to Tiers 2, 4 and 6:**

```
raw_export:               "Firestore returned no submissions; retaining the last known-good export"
accepted_export:          "Firestore returned no accepted adjudications; retaining the last known-good snapshot"
feedback_accepted_export: "Firestore returned no accepted feedback; retaining the last known-good snapshot"
accepted_snapshot:          {"status": "missing", "record_count": 0}
accepted_feedback_snapshot: {"status": "missing", "record_count": 0}
correction_proposals:       {"status": "skipped", "reason": "accepted_snapshot_unavailable"}
alerts: ["accepted_export_failed_last_good_retained",
         "feedback_accepted_export_failed_last_good_retained", "raw_export_failed"]
publication_blocked: false
```

**Zero adjudicated records are reaching the repository, and the release publishes anyway.**
`publication_blocked: false` is the "quietly worse" shape: the site ships on time, the
alerts fire into a log, and the adjudication supply is nil. That is load-bearing for three
task contracts written as if this input exists:

- **T2.3** asks for ≥300 adjudicated accepted test pairs over ≥50 events.
- **T4.5** asks for ≥200 held-out article/person pairs with ≥30 per tone.
- **T6.3** makes publishing evaluation results a release deliverable, and §1.8/T6.3 already
  note that „Точност на модела" ships empty.

None of them is reachable while the accepted snapshot is missing. §13.4's honesty rule
applies: this is not a shortage of annotators, it is a broken transport, and it must be
fixed — or the gates re-scoped to an offline adjudication path — **before** any tier's
acceptance criteria are agreed. Do not read the 240-article gold set as covering this: it
is a frozen historical draw, not the live accepted-adjudication stream these gates consume.

**Sequencing consequence.** This belongs ahead of the tiers, not inside one: it is small,
it is already diagnosed, and every accuracy gate in §9 depends on it. It is Stage 0 in §9,
with an acceptance test that a single hourly run reports `eval_task_sync_exit: 0` and a
non-missing `accepted_snapshot`.

#### 15.3.1 Shipped 2026-09-21 — the skew guard, and what it deliberately does not do

The **feedback arm** is closed. `npm --prefix news-functions run build` was run;
`lib/operator.js` now carries `naiasno.bg` (3 occurrences) and postdates its source, so the
next scheduled hourly run executes the fix that had already been written. Nothing was
force-run against production Firestore to prove it — the hourly job performs that sync on
its own schedule, and reaching into it by hand would have been a production write to
demonstrate something the next run demonstrates for free.

The **durable guard** is the part that matters, because a one-off build does not stop the
next fix from going unexecuted:

- `_stale_operator_cli()` (`news/scripts/eval_runtime.py`) reports the newest
  `news-functions/src/**/*.ts` that postdates the compiled CLI. It rides out on
  `RuntimeConfig.stale_operator_cli` and on both result payloads
  (`operator_cli_stale`), and adds an `operator_cli_stale` entry to the export alerts.
- `check_staleness.py` raises a **separate `operator_cli_stale` alarm**, naming the file and
  the command that fixes it.

⚠️ **Three design choices, each of which is the opposite of the obvious one.**

1. **It does not build.** Putting `npm` + `tsc` on the unattended hourly path adds a failure
   surface and latency to a step that is `optional` by configuration, for a condition that is
   rare and operator-caused.
2. **A stale build never becomes an `unavailable_reason`.** In `optional` mode an unavailable
   operator **exits 0**, so refusing to run would have converted a loud error into a silent
   skip — the guard would hide precisely what it exists to surface. The stale CLI still runs;
   only the skew is reported. `test_a_stale_build_is_reported_but_never_makes_the_operator_unavailable`
   pins this.
3. **The watcher alarm is separate from `run_failed`, and that is the whole point.** On
   2026-09-21 the skew happened to *throw*, so it rode out on `eval_task_sync_exit`. The
   dangerous case is the one where a stale build **succeeds with the previous behaviour and
   exits 0** — invisible to every exit code.
   `test_stale_operator_cli_alarms_even_when_every_exit_is_zero` pins that it fires with all
   three exits at 0.

A missing `news-functions/src` tree reports no skew (a deployment shipping only `lib/` is a
normal shape), and a source file the build genuinely predates is reported by name rather than
as a boolean, so the operator knows what changed.

⚠️ **The three Firestore export failures are NOT fixed by this and remain Stage 0's open
half.** `accepted_snapshot` and `accepted_feedback_snapshot` are still
`{"status": "missing", "record_count": 0}`; "Firestore returned no submissions / no accepted
adjudications / no accepted feedback" is a different failure from the canonical-host throw,
and nothing here establishes whether it is an empty collection, a credential, or a query. Do
not read the build as having cleared Stage 0 — the alarm that gates T2.3, T4.5 and T6.3 is
the missing accepted snapshot, and it is untouched.

### 15.3.2 ⚠️ The review-routing rule has just crossed its own saturation ceiling

Found while running the suite for §15.3.1, and it belongs to Stage 0 for the same reason:
`test_review_routing.py::test_the_corpus_queue_is_a_MINORITY_of_the_corpus` **fails on the
live corpus**, at `1303/5095 = 25.6%` against a `< 0.25` ceiling. It is not flake and not
caused by the §15.3.1 change (neither `eval_runtime` nor `check_staleness` is in that import
graph); it reads `data/analysis/articles/**` directly, and that corpus grows hourly, so the
crossing is drift and will continue.

The gate's own message states what it is for: *"the rule is not selecting, it is passing
everything through"*. At a quarter of the corpus the routing rule has stopped being a
selector.

⚠️ **Do not widen the threshold to make it green.** That is the ratchet-laundering this plan
objects to elsewhere (the `HAND_SEEDED_FLOOR` case in §5, and T2.3's rule that a lower
singleton share must never be a release requirement): raising a ceiling to clear a red test
converts a measurement into a formality, and this particular measurement is the only thing
asserting the review queue is triaged rather than merely large.

**It constrains two tiers directly, and that is why it is Stage 0 and not a bug report.**
T2.2 routes every newly relaxed clustering channel into `review/story_merge_queue.json`, and
T4.1–T4.3 add per-party and per-person tone review on top. Both tiers assume spare human
review capacity. The routing rule is already at saturation before either lands, so
**T2.2's proposal volume and T4's review volume must be budgeted against a re-calibrated
router, not against the current one.** Re-calibrate the rule (what it selects), or state
explicitly what review capacity exists and size the tiers to it — but settle it before T2.2
is scoped, not after the queue is full.

### 15.5 ⚠️ T4.1 is PARTLY shipped — what landed, and what the plan still owes

`fc9d86d829` (contract) and `89eb91f94d` (migration) implement T4.1's evidence split and
its backfill. Three of T4.1's requirements are **not** done and must not be read as done:

- ~~**Only `party_tones` carries spans.**~~ ✅ **Closed 2026-09-22 (T4.1b, §0.1):** both axes take the
  `rationale` + `evidence_spans` contract with the span direction being the side of the axis, gated at save
  and withheld (never neutralised) when unsupported. Legacy records stay legacy.
- ~~**The full-text rule is unimplemented.**~~ ✅ **Abstain arm closed 2026-09-22 (T4.1c, §0.1):** every
  record carries `text_scope`, a prefix-scope record is shown as a scoped observation and kept out of
  every rollup. ⚠️ Still owed: the bounded full-text / chunked pass (the 6,000-character prefix is still
  what the model sees; prefix or unrecorded articles — 13.5% of the corpus — are the candidates for it).
- **The yield metrics are partial.** The migration reports supported/withheld/spans-created;
  what T4.1 asks for — valid-span yield, semantic accuracy and abstention published
  **separately**, because „grounded rate" alone is not accuracy — needs the adjudicated set
  Stage 0 cannot supply.

⚠️ **And the contract is one-directional by design.** A span proves a quote EXISTS in the
article; it proves nothing about whether the quote supports the tone, names the right party,
or belongs to the journalist rather than a person being quoted. T4.1 says so in terms — „do
not call a substring-matched tone verified" — and no surface may describe a grounded tone as
checked.

### 15.6 ✅ T1.4 is SHIPPED — the gate, and what it measured on first run

`npm run news:reachability` / `:gate` (`news/scripts/reachability_gate.py`, in
`news:release:gate` after `news:home-health:gate`). First run, 3,189 stories at
`as_of 2026-09-21T11:36Z`: **14 answerable fixtures, 0 failing, coverage 1.000
on every one**, and `filter_index_rule_drift` zero in both directions.

Four things about it are worth carrying:

- **The denominator is re-derived, not imported.** `story_filter_row` is what
  BUILDS the index the gate checks, so calling it would compare the builder to
  itself and pass on any predicate the two happen to share — including a wrong
  one. Eligibility is restated from `stories.json`; `filter_index_rule_drift`
  reports the disagreement rather than hiding it.
- ⚠️ **`stories.json` CARRIES NO `domains` FIELD** — the index rows get one
  (`build_app_data.story_index_row`), the corpus file does not. A `story.get("domains")`
  therefore returns empty for every story, every outlet fixture finds nothing
  eligible, and all of them report N/A: a gate that passes by never asking the
  one question this tier exists for. Measured on the first cut: 10 fixtures, 0
  of them about an outlet. It derives `domains` from `members` instead.
- **The deep-page fixture is DERIVED, and it is the DEPTH probe.** A
  hand-picked „elections, 7 days" goes vacuous the week that topic is quiet.
  The gate picks an outlet whose stories are all past page 1 — on this corpus
  `glasove.com`, 136 eligible, **first match on page 19 in `index` order**
  (page 2 in `ranked`, which is ordered by prominence and carries no depth
  guarantee).

  ⚠️ **IT IS NOT THE ONLY FIXTURE SENSITIVE TO A TRUNCATED INDEX, and an
  earlier draft of this section said it was.** The gate walks the whole corpus
  itself, so a page-1-only walk fails **all fourteen** — measured,
  `everything` reads **0.047** and the deep fixture **0.000**. The claim that
  the other thirteen still read 1.000 is false, and believing it would argue
  for deleting the fixtures that do the work. What the deep fixture alone
  provides is `first_match_page`: the one figure that would move if the
  builder began emitting a prefix while every set still reconciled.
- **An empty corpus FAILS rather than scoring 1.000.** Every fixture would
  match nothing, every one would be vacuously covered, and „0 failures" would
  report success for a build that produced nothing. `vacuous` is the flag.

  ⚠️ **THE FLOOR IS ON WHAT WAS CHECKED, NOT ON HOW MANY FIXTURES RAN, and
  the first cut had that backwards in both directions.** `answerable` depends
  on the corpus's facet diversity and recency: measured, a **32-story**
  synthetic corpus (1% of the real one) produced twelve answerable fixtures
  and passed, while a **5-story** corpus that was entirely correct produced
  three and was failed as vacuous — and `news:reachability:gate` runs inside
  `news:release:gate`, so that second case makes a quiet week a red release.
  The fixture count is now a printed diagnostic
  (`EXPECTED_ANSWERABLE_FIXTURES`); the gate refuses when nothing was checked.
- **A SHRUNKEN corpus is refused against a committed baseline**
  (`news/config/reachability_baseline.json`, `MAX_CORPUS_SHRINK` 5%,
  `--allow-shrink` / `--update-baseline`). Set equality is a WITHIN-snapshot
  property, so „every fixture passed" is equally true of a build that lost 99%
  of its stories. This is the repo's own pattern for a derived corpus
  (`mergeFromStage`, `kzk_decisions`).
- **Facet drift is checked over the WHOLE corpus, not only the probed
  fixtures.** The fixtures name the top 3 categories and top 3 outlets;
  the corpus has 25 and 44. So a story whose index row lost a topic or an
  outlet outside that six was invisible — the per-fixture set equality cannot
  reach it and the id-drift check compares ids only. Measured: losing
  `fakti.bg` was caught, losing `glasove.com` was not.

**The article funnel, reported separately and in ARTICLES** (never a
denominator for the story counts above): analysed **6,088** → quality-ok
**5,875** → site-relevant **3,557** → attached to a published story **3,557**,
**0 unattached**, with **53** site-relevant records off-stage because they are
not quality-ok.

⚠️ **The stages are CUMULATIVE and the third one is an intersection.** 3,610
records on disk are site-relevant; 3,557 of those are also quality-ok.
Publishing 3,610 as the third stage against 3,557 attached would invent a
53-article discrepancy out of the staging, which is the inherited „2,883 vs
2,876" defect in a new costume — so the off-stage count is named.

⚠️ **The zero residue is structural TODAY and is measured in BOTH directions,
which took two fields.** `unattached` counts articles that passed both
predicates and reached no published story; `attached_but_off_predicate` counts
the converse — a published story resting on an analysis the pipeline judged
unusable. A single count difference can only ever see the first, so an earlier
draft's „verified as a SET rather than by equal counts" described a check that
was not there: the converse record hits `continue` before any counter and
leaves `unattached` at 0. Both are zero on this corpus, independently
verified over all 6,088 records. This supersedes §13's „2,883 eligible versus
2,876 attached leaves seven to reconcile"; that pair was never a release
baseline and is not this corpus.

⚠️ **An absent analysis tree is `not_measured`, never a row of zeros** — the
module's own N/A rule, applied to the funnel. „0 unattached" is the HEALTHY
signal and rendered identically to a funnel nobody ran; and a missing
`index.json` produces the opposite artefact, a fabricated residue equal to the
whole site-relevant count on a pipeline that is fine.

**What this gate does NOT see, recorded rather than implied:** it is
independent of the builder's DERIVATION (it reads `members` and `topics` out
of `stories.json` rather than `story_index_row`'s output) but not of the
RULE — `eligible_facets` and `UNTOPICED_FACET` transcribe
`build_app_data.story_filter_row`, so a change to what a facet MEANS has to be
made on both sides and the two would agree on a wrong one. It also says
nothing about whether a reachable story is worth reaching; that is T2's
question, not this one.

**Still open from T1.4's neighbours:** the „Показваме 1 от 139" line on
`/` names both numbers and offers no destination, because the news app has no
browse route. That is the remaining half of R1 and belongs with T1.3's query
contract, not with this gate.

### 15.4 Corrections this pass did **not** make

Stated so a later reader does not re-litigate them:

- ⚠️ **A finding this pass RETRACTED before publishing it.** The suite appeared to report
  `failed: test_review_routing.py` and still exit 0, which would have been a gate that does
  not gate — the same shape as `publication_blocked: false` in §15.3. It is false:
  `run_tests.py` ends `return 1 if failed else 0`, and the observed 0 came from running it
  through `| tail`, which returns *tail's* exit code. Measured both ways: direct **1**,
  piped **0**. The runner is correct; the harness around it was not. Recorded because the
  near-miss is the same class of error this document exists to catch, and because anyone
  re-running these commands through a pipe will see the same misleading 0.
- §1.1's refusal to divide 16 by 676 is **right in general and worth one nuance**: the
  selection pool is the 30-day `HOME_WINDOW_DAYS`, so the two are different windows — but
  the same bundle's `home_health` reports `selected_within_24h: 16` and
  `default_visible: 16`, i.e. every selected story did fall inside 24 h on that build. "16 of
  the day's 676 stories reached home" is therefore a defensible sentence about that build;
  "2.4% of stories reach the feed" as a standing ratio is not. Keep the distinction.
- The original draft's „92 / 273 / ~109" Петрохан triple, its 91.8% single-outlet figure, its
  `:1163` and `:52` line citations, its `{article_count, articles[…]}` mention shape, its
  „· 100%" MixBar string and its placement of „консултации с президента" under `government`
  were all wrong, and §13/§14 corrected them. This pass reproduces those corrections and
  adds nothing to them.
