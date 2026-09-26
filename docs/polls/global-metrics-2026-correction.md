# Global Metrics July 2026 correction

Reviewed on 2026-09-26 against the captured agency PDF, including rendered pages 4 and 5 and the methodology on page 8. [Publication](https://globalmetrics.eu/obshtestveni-naglasi-prezidentski-izbori-yuli-2026/) · [PDF](https://globalmetrics.eu/wp-content/uploads/2026/07/National_survey_results_GM_July-2026.pdf).

Source capture: `raw_data/polls/global_metrics/658`, SHA-256 `5c2701846a0db0315d8e99c1067541922c06277e3aebd826a3877480b22fa524`. Published 2026-07-28 12:05:54 UTC according to the captured page metadata; fieldwork 23 June–11 July 2026; 1,503 adults; face-to-face tablet interviews (TAPI), two-stage cluster quota sample; funded by the agency.

## Page 4: named-person support potential

| Published name | Definitely | Probably | Hesitant |
| --- | ---: | ---: | ---: |
| Илияна Йотова | 30.0 | 20.2 | 18.4 |
| Андрей Гюров | 9.6 | 13.6 | 23.2 |
| Даниел Вълчев | 4.7 | 13.6 | 22.0 |
| Иван Христанов | 3.1 | 8.6 | 17.5 |

These are separate willingness-to-support answers for each person. They do not form a mutually exclusive vote distribution. The question's own base is not labelled; the neighbouring trust chart's base must not be copied across. No missing tiers or residual percentages are inferred.

## Page 5: hypothetical party-backed candidate choice

| Published party/answer | Percent |
| --- | ---: |
| Прогресивна България | 39.7 |
| Продължаваме промяната – Демократична България | 13.3 |
| ГЕРБ-СДС | 11.5 |
| Възраждане | 5.5 |
| БСП – Обединена левица | 4.8 |
| Антикорупционен блок | 4.4 |
| ДПС | 3.6 |
| МЕЧ | 2.2 |
| Друг кандидат | 14.9 |

Base: respondents saying they will vote. The base sample count is not supplied. Published percentages total 99.9%; retain the rounding. The PP–DB label wraps around its number in extracted PDF text; both parts are visible in the chart and retained in the corrected label.

## Corpus changes

`gm-2026-07-11` now contains two question definitions and 21 answers. All three published named-person tiers are retained, separately from the nine party-backed choices. Both questions explicitly exclude candidate vote-share accuracy. The prior poll, 13 answer rows and empty runoff set remain in `locked.supersedes`. The stale duplicate inbox draft was removed after the reviewed replacement succeeded. Publication, extraction and acceptance are recorded in `state/polls/GM.json`.

Values were compared individually with the PDF. This correction does not add election results, normalize answers or infer registered candidates.
