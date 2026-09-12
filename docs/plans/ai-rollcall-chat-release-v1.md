# Roll-call chat implementation and release record

## Scope and source limits

Steps 0–7 implement the shared versioned query contract; parliamentary and council sessions, votes, named casts and coverage; verified composite MP resolution; closed metrics; bilingual prompt capture; revision-bound pages and context; and 28 parameterized bilingual starters with 20 follow-up definitions. Follow-ups are offered only when applicable; the councillor-name template requires a supplied name.

Source audit: [audit](ai-rollcall-chat-source-audit-v1.md). The source snapshot, not the current date or election selector, controls latest records. Council named rolls are available for six of sixteen indexed councils. Council casts remain source-specific evidence; the implementation does not infer historical mandates, party affiliation, eligible-member attendance, or absence from missing rows. Haskovo supports source-year resolution scopes and explicitly rejects precise day/month sessions. Titles supply keyword/topic matches, with untitled-source coverage disclosed. Parliamentary attempts and standing votes remain distinct. Faction metrics use the party recorded at voting time.

## Commits and review gates

| Step                                                    | Commit       | Confirmed review findings repaired |
| ------------------------------------------------------- | ------------ | ---------------------------------: |
| 0 source audit and acceptance specification             | `230562c038` |                                  2 |
| 1 contract and revisions                                | `c4b074586e` |                                  3 |
| 2 parliamentary records and identities                  | `39b097455d` |                                  6 |
| 3 council records and coverage                          | `b396764b64` |                                  4 |
| 4 metrics and comparisons                               | `959a25412b` |                                  4 |
| 5 prompt understanding and providers                    | `74e251063a` |                                  7 |
| 6 pages, export and context                             | `4cd0593a84` |                                  6 |
| 7 starters and follow-ups                               | `d31cb73107` |                                  4 |
| 8 final acceptance, performance and release preparation | this commit  |                                  4 |

All 40 confirmed review findings were repaired; none remain for manual review. Step 8 additionally repaired issues discovered by the real UI and broader regressions: Bulgarian `гласа на` wording, election/legacy routing boundaries, unfilled starter display text, table column order and irrelevant fields, impossible follow-up labels, prompt input-size overhead, missing tool-library/link inventory entries, repeated re-vote scans, full-parent cast membership pushdown, unnecessary wide-cohort materialization, and off-page tally-quality reporting.

## Executed checks

- Broad affected suite: **3,072 tests across 60 files passed**. This includes parser, router, provider boundaries, chat state, all 28 mounted selector cases, bilingual starter parity, contextual follow-ups, links, query pages/export, and existing election routes.
- PostgreSQL migration/contract/coverage/parliament/council suites: **6 tests across 4 files passed**, with substantial multi-assertion fixtures. The final SQL correction was separately checked by both parliamentary and council fixture suites.
- Backend route/contract Node suites: **10 passed**.
- Main and AI TypeScript checks and scoped ESLint passed. Production main and standalone AI bundles passed (existing bundle-size warnings remain).
- Existing AI regression harness: **2,168/2,168 cases passed**, including 1,754 starter/suggestion routing checks. Its non-AI suite passed 743 cases with 207 existing expected failures.
- Final PostgreSQL fixtures passed again after the denominator-quality and council-name corrections; backend route/contract suites passed all 10 tests.

These counts are executed tests, distinct from the plan's acceptance specifications. Deterministic provider tests do not claim live model generation, and mounted accessibility assertions do not claim a screen-reader session. Production UI testing has not occurred for this release.

## Performance gate

Reproduce against populated **local** Docker PostgreSQL:

```sh
node --import tsx scripts/ai/benchmarkRollcall.ts /tmp/rollcall-benchmark.json
```

The script pins local PostgreSQL regardless of `DATABASE_URL`, uses `app_readonly` inside read-only transactions and a ten-second statement timeout, resolves Rashkov against current composite identity evidence, and measures eight query families. Each gets a first call, six warm samples, warm p95, and custom/generic `EXPLAIN ANALYZE BUFFERS` plans. It also runs four concurrent requests and seven capability calls. Each capability response must retain all six populated corpora and revision metadata; capability warm p95 must remain below 500 ms. First request is not a claim of a cold database/OS cache. The JSON records temporary blocks and JIT cost. The process fails the warm two-second target or unavailable query responses.

Final artifact: [benchmark and query plans](ai-rollcall-chat-benchmark-v1.json). The final gate passed: maximum query warm p95 **476.1 ms**, capability warm p95 **7.4 ms**, all six capability corpora populated and revision-bearing, and four concurrent queries successful or explicitly partial. Run measurements without simultaneous compilation; separate concurrent request measurements are explicit. A development stress run overlapped builds and exceeded the target; its result is not treated as a passing release measurement.

## Local UI evidence

Tested deterministic chat against the populated local backend in the browser: both screenshot prompts return indexed parliamentary sessions/votes; Rashkov returns ten source casts; the 2025 follow-up retains person and count; the council starter accepts Русе and returns its resolutions; a named-vote follow-up reports unavailable source rolls; council coverage pages contain ten plus six distinct bodies; Haskovo displays only 2022; direct query-page previous/next controls retain the scope.

A downloaded CSV exposed raw internal columns during testing. Export now uses only the visible localized columns, verified by the mounted export test, including grouped labels. The subsequent browser download did not produce a retrievable replacement file, so that corrected download is not claimed as independently file-verified. No live AI-provider or screen-reader session was performed.

## Deployment checklist — prepared, not executed

The user's latest instruction implements this roll-call plan. This record does not deploy it. Deploy only on a subsequent deployment instruction.

1. Record the deployed backend/frontend revisions and take the normal database restore point. Verify the source audit assumptions against the destination, especially council bridges, data precision and composite MP identities.
2. Apply `scripts/db/schema/pg/199_rollcall_query.sql` using the existing migration runner. It is additive and idempotent. Verify `rollcall_query_revisions`, `rollcall_query_meta`, revision triggers (including truncate), and read grants for `app_readonly`; do not run the production server as the ingestion role.
3. Use the normal source loaders in order: parliament roster/identities → roll-call source and derived projections; council source and bridge projections → identity links as supported. Both roll-call/council loader paths install the revision contract. Verify title/precision metadata and one coherent revision after each completed loader transaction.
4. Deploy the DB backend routes before publishing clients: `rollcall-query`, `rollcall-entities`, `rollcall-capabilities`, `rollcall-catalog`. Check all four with the deployed application role. A missing family must report unavailable while preserving the healthy family.
5. Verify query, chooser, parent and page revision conflicts return stale without mixing generations. Verify all four endpoints are no-store in route cache policy and hosting headers. Leave the ten-second statement timeout in place.
6. Publish the main frontend and standalone AI frontend, refresh the backend-rendered shell to the new asset manifest, then perform the normal hosting purge. Check direct `/rollcall/query` links, source links and exports.
7. Run the two original screenshot prompts, Rashkov's latest votes, a date/topic query, ambiguous identity chooser, council named-roll gaps, a year-only body, starter editing, contextual follow-up, next-page, stale restart and CSV export in the deployed UI. Check deterministic mode and the configured AI modes; record which modes actually ran.

Rollback: set `ROLLCALL_QUERY_DISABLED=1` on the backend to hide unsupported capabilities and return unavailable rather than an unscoped answer. Revert the new clients/backend to recorded revisions as needed. Keep the additive tables/triggers during application rollback; do not destructively revert source data. Recheck no-store behavior and healthy-family fallback.
