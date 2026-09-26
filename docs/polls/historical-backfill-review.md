# Presidential historical backfill review

Reviewed 26 September 2026. The accepted corpus now contains 13 historical surveys, plus the corrected July 2026 Global Metrics survey. All historical observations were checked against the agency's own captured publication. Acceptance used the normal validation and publication-ledger path.

## Accepted coverage

| Cycle | Agency | Surveys | Limitations |
| --- | --- | ---: | --- |
| 2006 | Alpha Research | 1 | Three exact all-voter shares; published forecast ranges remain ranges in evidence, with no invented midpoint. Publication date and interview method undisclosed. |
| 2011 | Alpha Research | 1 | Both all-voter and agency-published ballot bases retained. Combined undecided/non-voting answer is preserved in evidence, never split arbitrarily. |
| 2016 | Alpha Research | 3 | Two first-round waves and one between-round survey. Exact publication dates unavailable. October chart gives Doncheva 4.7%, while narrative says 4.5%; chart value retained. |
| 2016 | Trend | 1 | Likely-voter base includes the no-candidate option; runoff results explicitly withheld by agency. |
| 2016 | Sova Harris | 1 | Likely-voter base and one hypothetical runoff. Original bulletin footer supplies the publication date, not the migrated website timestamp. |
| 2021 | Alpha Research | 2 | October and November waves; likely-voter base and unknown exact publication dates. |
| 2021 | Trend | 1 | No-candidate treatment unspecified. |
| 2021 | Market Links | 1 | Both all-adult and voter bases retained, including printed undecided/other/non-voting shares. |
| 2021 | Sova Harris | 2 | October all-adult and November specific-candidate bases differ. Three hypothetical runoff observations remain separate from actual between-round polling. |

Survey-level source locators: `state/polls/historical-review.json`. Trend's two surveys have their separate [source review](trend-historical-review.md). Full publication reconciliation: `state/polls/historical-reconciliation.json`. Its 62 reviewed entries reconcile to 13 accepted surveys, 26 other-race/approval publications, six other-question reports, 14 exclusions and three publications with missing metadata. Parliamentary extraction work remains visible in the general backlog even when presidential review is complete.

## Ingestion repairs from reconciliation

- Trend's historical “политически формации” titles now enter discovery.
- Market Links' political-fragmentation, political-division and public-consensus monthly reports enter discovery. September 2021 is a parliamentary survey with discussion of the presidential race, not a candidate-vote table.
- Legacy Market Links report download endpoints and article images are captured. Download responses must contain PDF bytes; source-provided resource identifiers cannot escape the capture folder.
- Alpha Research's older GIF charts are captured and available to OCR.
- A successful unchanged-content recheck clears obsolete attachment failures in both the ledger and source stamp.

## Remaining source limits

2001 has no accepted primary-source survey in this backfill. Gallup's site failed TLS negotiation with both Node and the system TLS client. Мяра yielded no dated 2016/2021 archive entries; this is a discovery result, not a claim about its existence or historical activity. Press-only agencies have not been added from uncorroborated media summaries.

Market Links' August 2016 report gives only a fieldwork month. Its October and November agency pages embed TV thumbnails with incomplete tables and undisclosed bases/methods. Those publications remain captured with explicit metadata gaps; they are not accepted as complete voting distributions.

This is a dated coverage statement, not a claim of an exhaustive historical corpus. Capture, review and acceptance counts are distinct. Exit polls and retrospective claims are excluded from pre-election accuracy. The question-aware accuracy rebuild follows in step 10; no historical grade is inferred from this acceptance count.
