# Tools capability ledger

The executable boundary is `ai/tools/registry.ts`: every registered definition is a public deterministic instrument. Question presets are many-to-one discovery entries. `scripts/ai/toolMetadata.ts` generates the import-free parameter and topic projections, and its test compares complete objects, including optional fields and empty arrays. Run `node --import tsx scripts/ai/toolMetadata.ts --write` after changing the registry or a primary category.

## Argument reconciliation

The dated inventory lists every registered tool and parameter at audit time. The live generated `ai/app/toolParameters.json` is the current public contract. `ai/tools/argumentCompatibility.ts` records the complete disposition of the original undeclared-direct-read candidates: public controls were added for agency history (`years`, `n`), sub-mayor cycle (`cycle`) and contract limit (`count`); all other reads are compatibility spellings, a trusted candidate clarification pin, or an unreachable branch of a generated budget closure. Alias targets must exist in the live contract. The direct-read gate is deliberately described as such: it does not claim to prove transitive helper correctness.

Election helper consumption is contextual: `resolveElection` reads the tool's optional election or the latest election context. `yearScope` uses the declared election parameter to fan out a bare year. Local-cycle helpers accept the separate local-cycle namespace. Budget tools conditionally read their spec's year; no-year budget tools expose no year. Data clients, lookup helpers, envelope builders and geographic renderers are supporting functions, not additional public instruments. Handler-specific coercion and dynamic availability remain implemented by these helpers; form validation must not relabel a fallback result as the requested period.

A tool's missing explicit default means omission, not an invented default. Question defaults and translated legacy example arguments are presets, not tool defaults. Sources describe provenance; a missing source snapshot cannot remove an executable tool from discovery.

## Wider site capability families

| Family | Existing representation | Intentional boundary / excluded operations |
| --- | --- | --- |
| Parliamentary, presidential and local election results; turnout, geography and integrity | Registry election/local tools and structured presets | Raw section-file fetches and map geometry are supporting inputs, not separate tools |
| Polls and agencies | Parliamentary history/accuracy tools plus latest presidential poll | Presidential accuracy/history is excluded until a scored corpus exists; placeholders are not named candidate results |
| Budgets, transfers, municipal fiscal health and sector spending | Fiscal tools; generated budget contracts; reviewed SQL alternatives | Individual ledger/document readers remain source/data-browser surfaces where no dedicated envelope exists |
| Procurement, tenders, appeals, companies and risk | Fiscal/company tools plus SQL catalogue recipes | Document signing/download, table pagination and search-coverage routes support instruments; arbitrary API calls are not promoted to tools |
| People, declarations, political links and company ownership | Person tools; SQL-only ownership/officer/abroad recipes | Identity resolution/aliases and graph expansion are supporting routes; do not infer additional people or links |
| EU funds, agriculture, NGO and Interreg | Funds/subsidy/NGO tools plus SQL-only delivery/Interreg recipes | SQL-only questions retain explicit unavailable-in-chat status; adding an envelope adapter is future capability work |
| Parliament roll calls and bills | Voting/attendance/cohesion tools and SQL chamber-day/voting recipes | Per-item vote fetches and bill-detail routes support browsing; not every raw endpoint needs an independent chat instrument |
| Prices, health, schools, demographics, environment and other indicators | Indicator/place/fiscal tools | Raw series, geocodes and lookup endpoints support those instruments; no automatic tool per dataset |
| Unified search, corpus size and recent changes | SQL-only utility questions | Exposed through the data browser with correct availability, never `runTool` |
| News analysis, social posts, video generation and ingestion/admin commands | Separate applications/operator workflows | Excluded from this deterministic, read-only civic-data tool library; no publishing or ingestion controls |
| Authentication, model providers, chat sessions, downloads and telemetry | Application infrastructure | Supporting functions; not public data-analysis capabilities |

All 59 SQL-only questions and their parameter/default definitions are recorded in the dated audit JSON. The SQL catalogue is the current authority; its capability and URL tests validate availability. Fifteen chat questions currently have reviewed SQL alternatives. Counts are observations, never ceilings. The library derives entries from current registries.

This classification is by capability family, not an assertion that every screen's arbitrary interaction is independently executable in chat. New public tools enter the registry and must receive discovery metadata; new SQL-only recipes appear through the SQL catalogue. A new family outside these boundaries requires an explicit capability decision rather than an invented adapter.
