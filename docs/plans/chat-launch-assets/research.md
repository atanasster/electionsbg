# Launch comparison evidence — 10 September 2026

This is a small qualitative interface check, not a benchmark or ranking. Public anonymous sessions in the in-app browser; no paid plan, login or registration was added. External model versions were not exposed. Results describe the sessions observed, not every available plan. No competitor answer figures are certified here for republication.

## Common tasks

1. `What is the population of Bulgaria? Give the observation year and original source.` Data Commons received the shorter equivalent `What is the population of Bulgaria?`.
2. `Compare the population of Bulgaria and Romania in 2024.`
3. `And in 2023?` in the same interface after task 2.
4. `What is the exact observed population of Bulgaria on 1 January 2099?`

| Product / mode | Lookup | Dated comparison | Short contextual follow-up | Unavailable observation |
| --- | --- | --- | --- | --- |
| ChatGPT, anonymous default with source results | Returned a dated NSI attribution and source controls | Table and chart; explicitly noted different observation dates | Retained countries and changed year | Distinguished future projection from observed data |
| Data Commons Explore | Sourced time series, year labels, alternate facets and download controls | 2024 chart with NSI/World Bank labels | Returned a no-place-found error from the search box | Returned a no-place-found error; no usable result |
| Perplexity, anonymous Search / Best | Asked for sign-up and a repeated request | Not run after access block | Not run | Not run |
| СИГМА public site | Procurement search/records inspected, not a population chat | Not applicable | Chat control not found on inspected home page | Not tested |

Data Commons has guided related-question links; the failed free-text fragment does not establish that all its follow-up mechanisms fail. Its comparison cites multiple sources, so equal year labels alone do not establish identical population definitions. ChatGPT's cited source labels for Romania included secondary publishers; the original records were not independently reconciled. Do not turn this check into an answer-accuracy claim.

Our own chat is tested separately with its actual supported questions in `examples.json`, not scored against these general web questions. It is narrower: dedicated tools over our loaded Bulgarian datasets. The 2099 population trial misresolved in Bulgarian and lacked national census data in English; it is excluded from the article's runnable examples. The 2099 budget trial lost the year. The tested 2027 budget question retains the year and explicitly reports missing 2027 data in the subtitle while showing 2026; the article must direct readers to that warning. These limitations preclude universal free-text or future-data claims.

## Primary sources and publication wording

- [Data Commons FAQ](https://www.datacommons.org/faq): Explore maps natural language to real datasets and visualizations; provenance accompanies data. Fits sourced statistical exploration. Documentation and public interface checked.
- [Perplexity help](https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work): web search, summaries, citations and contextual follow-ups are documented. Access/limits vary by plan. Our anonymous attempt was blocked by sign-up; do not say the product universally requires registration.
- [ChatGPT search help](https://help.openai.com/en/articles/9237897): web search and source controls, including anonymous access, are documented; searches have usage limits. Fits broader web context. This session showed tables and a chart, but these four tasks do not establish accuracy.
- [СИГМА launch announcement, 16 June 2026](https://www.mig.government.bg/vsichki-novini/pravitelstvoto-puska-sigma-vseki-grazhdanin-veche-mozhe-da-proveri-sam-kade-otivat-parite-ot-obsthestvenite-porachki/): the ministry launched a free procurement portal. This announcement establishes the portal launch, not the AI assistant launch.
- [СИГМА assistant design](https://github.com/midt-bg/sigma/blob/main/docs/spec/ai-assistant.md): documents Bulgarian text/voice, procurement/register/web search and reports; the design is dated 7 June 2026 and says implementation had not begun. The document could lag the product. Call it a **documented/planned assistant**, not an evaluated live chat. No separate public assistant-launch announcement was found.
- [СИГМА public portal](https://sigma.midt.bg): on inspection, search, institutions, companies, contracts, flows, methodology and dates were visible. No chat control was found. Do not equate differing contract/lot units or periods with superior coverage.
- [OpenTender Bulgaria in OCP's registry](https://data.open-contracting.org/en/publication/44): relevant procurement alternative. [Portal](https://opentender.eu/bg). Not conversationally tested.
- [BIRD's declaration-search article](https://bird.bg/judicial-money/): relevant specialist investigation/search alternative. Not conversationally tested. Omit from the compact chat table if space is tight; optionally mention as another search route.

## Approved AI example

On the verified hosted preview, BG prompt: `Какъв е държавният бюджет — план и изпълнение? Посочи отчетния период и обясни разликата между план и изпълнение.` Gemini 3.5 Flash-Lite returned in 3.5 s. Its narration matched the table's 31 July 2026 period, €15.3bn revenue, €16.5bn expenditure, €34.5bn annual planned expenditure, −€1.9bn balance and €661.7m EU contribution. The last sentence was awkward but did not add unsupported figures. Treat this as one successful test, not guaranteed wording. No AI narration is substituted into the No AI screenshots.

The earlier AI seat answer mixed vote percentages into seat narration and inferred a governing majority. It remains excluded. The article's seat example uses the deterministic dated allocation, not that response.
