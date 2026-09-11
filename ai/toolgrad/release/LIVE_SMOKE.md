# Production deployment and browser smoke test — 11 September 2026

Deployed `hosting:main` on Firebase project `elections-bg` through the standard
`npm run deploy` command, with all predeploy hooks enabled. Firebase reported
`release complete` and `Deploy complete`. The public chat is at
https://naiasno.bg/chat; the older AI hosting target redirects there.

Deployed commits include the release repairs `d21c86d410`, the bilingual evals
section `3f6392db44`, and build integration fix `33817004a3`. The latter excludes
offline ToolGrad evaluation fixtures from the production serving-data map scan.
No function, database, model-weight or data-bucket deployment was performed.

## Live browser results

Both `/chat/evals` and `/en/chat/evals` displayed the new ToolGrad heading.
Tests used the public chat UI, normal Cloudflare verification and Gemini 3.5
Flash-Lite, with real served election and budget data. No operator transport,
injected credentials or authentication bypass was used.

| Language | Question | Observed result | Displayed time |
| --- | --- | --- | --- |
| BG | Какви са резултатите в Пловдив на 27 октомври 2024? | Plovdiv municipality; 107,057 party votes; GERB-SDS 31,810; turnout 37.77% of 302,372 registered voters | 5.5 s |
| BG | А същото за област Пловдив? | Plovdiv province electoral record; election retained; 86,300 party votes; GERB-SDS 22,765; turnout 31.78% | 2.1 s |
| BG | Общински трансфери за 2024 | Totals by transfer type, five categories, €4bn rounded total across 265 municipalities | 3.6 s |
| EN | What were the election results in Plovdiv on 27 October 2024? | Plovdiv municipality; correct election, party votes and turnout denominator | 3.5 s |
| EN | And the same for Varna city? | Varna municipality; election retained; 111,746 party votes; GERB-SDS 31,503; turnout 39.28% | 1.9 s |
| EN | Municipal transfers for 2024 | Totals by transfer type; same five categories in English | 3.9 s |

All six completed responses displayed the Gemini label, a data table and source
attribution. Narration was in the requested language; official party labels
remained in Bulgarian. Election totals were checked against the repository's
2024-10-27 records. Transfer categories matched the recorded 2024 values:
delegated activities €3.5bn, capital €218m, equalization €209.6m, other targeted
€30.7m and winter roads €24.7m (display-rounded amounts).

The first attempt in each language used the visible No AI fallback because a
verification refresh was required after navigation/the long deployment. These
two attempts are **not** included in the six cloud passes. The normal Verify
button refreshed access automatically, and each question was rerun in a new
conversation. A selected AI mode alone did not establish a cloud response.

This is a six-question smoke test, not an independent accuracy benchmark or a
latency distribution. Times are those displayed by the chat, not separately
instrumented browser timings. No claim is made that all production tools or
unsupported requests were covered. Historical offline scores remain unchanged.

## Build checks and limitations

The standard deployment passed lint (one existing React-refresh warning), budget
regressions, AI tests, tool harness, TypeScript, Vite build, prerender, image
optimization and article packaging. An additional data-map test run passed 39/40:
the existing lateral-links tour says 18,731 connections/procurement overlaps while
the committed measurement is 18,734. The serving-dependency checks passed. This
unrelated statistic was not edited.

The build regenerated the public LLM text snapshots from current local data;
their incidental working-tree changes were restored after deployment. The
user's unrelated `scripts/db/tests/rollcall.data.test.ts` edit was preserved.

Automatic review initially rejected the main hosting target; repository route
and redirect evidence established that it owns the live chat, and the standard
deployment was approved. A later fast-upload attempt was rejected because it
skips hooks; the successful deployment reran every standard hook instead.
