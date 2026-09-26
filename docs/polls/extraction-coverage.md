# Presidential extraction coverage

The dispatcher supports Trend, Alpha Research, Global Metrics, Market Links, Sova Harris, Мяра and Gallup. Every result remains an inbox draft until source review and acceptance.

- Trend and Alpha Research joint releases produce both race records from the same captured publication. Race detection includes linked reports, and the shared inbox uses distinct presidential IDs.
- Global Metrics retains its separate party-backed and named-person potential questions.
- Market Links' verified November 2021 PDF layout yields separate all-respondent and voter questions, with original percentages and residuals. The parser checks legend order, paired row positions, population counts and residual categories. Other layouts require review.
- Alpha Research, Sova, Мяра and Gallup also have a conservative presidential table path. It requires an explicit voting heading and contiguous, readable single-series rows. Approval charts, unreadable OCR, multiple tables and unmapped columns do not become accepted voting results. Historical Word reports are read with `textutil` on macOS or `antiword` elsewhere; unreadable attachments leave fields unresolved.
- Population base, round and methodology require individual review. A parser returning a draft does not establish historical coverage or scoring eligibility. Gallup's current TLS failure also reproduces with the system client.

Run `node --import tsx scripts/polls/backlog.ts` for the durable publication backlog. `state/polls/backlog.json` is the saved snapshot from this run. It distinguishes capture errors, pending extraction, pending review and acceptance. Both races must complete review before a joint publication is marked accepted. A reviewed final ID replaces its provisional ledger entry.

Possible bilingual mirrors are compared before presidential acceptance using fieldwork, agency, sample, question bases, candidate keys, numeric answers and residuals. Translated labels, translated notes and runoff pair order do not create another survey. A match is refused for identity reconciliation, rather than silently merged.

Primary capture bytes are excluded from Git newline conversion because `SOURCE.json` hashes those bytes. This run also preserves the original line endings of the historical captures committed in step 6.
