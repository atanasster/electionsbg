# Starter coverage implementation — 10 September 2026

All six steps of the starter taxonomy audit are implemented. Starter selection sends the readable question through the normal chat provider and text router; it does not dispatch the catalog's tool ID. SQL selection uses the same compact category → subcategory → question dropdowns and renders an editable, bounded statement.

## Result

- 19 categories and 83 subcategories in the combined catalog.
- 282 chat starters covering all 227 registered tools; every ready question has source metadata.
- 74 executable SQL recipes, including 15 questions available on both surfaces.
- Budget has nine chat subcategories and seven SQL subcategories. SQL does not imply support for debt/scenario questions whose required normalized measures are absent.
- All 55 macro measures have explicit bilingual starters. National water-service coverage and 46 reviewed Bulgarian question aliases were added.

## Validation

The committed provider snapshot contains 564 requests: every starter in Bulgarian and English, submitted to `HeuristicProvider.respond(text)`, with no routing/execution errors. Eight responses intentionally ask for clarification; they are not completed answers. The read-only local SQL snapshot contains successful execution of all 74 default recipes under `app_readonly`, with an eight-second timeout and statement hashes. These checks establish default-question execution, not correctness for arbitrary paraphrases or hosted LLM behavior.

The full local AI regression passed 1,329 checks, including 920 starter/suggestion routing checks. The final focused catalog/release suite passed 683 tests; lint, TypeScript and the AI production build also passed. The coverage gates detect missing tools/sources, changed starter text, tool and argument routing drift, macro vocabulary drift and changed default SQL.

Desktop and 390-pixel mobile browser checks verified compact selectors on both surfaces. Selecting the ministry personnel question and changing the year to 2023 generated `SELECT budget_personnel_series(2023) AS data;`. Selecting the national water question returned the offline provider's sourced table through the normal chat flow. Its year cells were corrected to avoid thousands separators.

Regenerate the evidence against the local data and database:

```sh
node --import tsx scripts/ai/probe_question_catalog.ts --output=docs/audits/starter-provider-validation-2026-09-10.json --update-sources
node --import tsx scripts/ai/probe_sql_catalog.ts
node --import tsx scripts/ai/current_question_coverage.ts
```

## Scope and remaining data work

The JSON-source SQL step assessed nine source families and documented the missing normalized layers; it did not fabricate SQL parity or load new production data. See [the assessment](json-source-sql-assessment-2026-09-09.md).

The editorial review covers all 257 candidate questions. Forty-six are promoted as verified aliases; the other 211 remain unpromoted with explicit limitations or missing layers. Some require additional ingestion, measures or clarification. See [the measure review](editorial-measure-review-2026-09-09.md). Successful routing alone is not evidence that a broad social question is answered correctly.

The financial fixes preserve partial coverage and distinguish unavailable observations from zero. Municipal capital data covers 24 of 265 municipalities; funding-source breakdown covers two. Budget variance covers eight of 48 units and personnel data seven units in 2024. The COFOG denominator no longer double-counts the total row, and tourism fractions are correctly rendered as percentages.

No production deployment or production data refresh was performed during these six audit steps.

## Commits

1. `2a8c91ce06` — COFOG arithmetic and canonical SQL topics/counts.
2. `44a73af8d5` — missing-tool starters and normal text routing.
3. `0b25805640` — budget contracts and normalized SQL coverage.
4. `91459280af` — JSON-source SQL assessment.
5. `848fc94afa` — exact measures, editorial decisions and routing repairs.
6. Final coverage evidence and release gates — this document's commit.
