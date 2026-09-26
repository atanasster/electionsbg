# Presidential poll accuracy

Accuracy is computed per question and actual election round. A question must have a known publication date before election day in Bulgaria, fieldwork ending before that round, a disclosed decided-voter or valid-vote base, known treatment of “none”, and explicit source eligibility. Questions with hypothetical scenarios, support potential, unknown genre, or remaining undecided/non-voting shares are excluded. Round-two fieldwork must start after round one.

Published shares are retained. Where the source explicitly excludes “none”, the official result is expressed among candidate votes; otherwise the official valid-vote denominator includes “none”.

The comparison includes every candidate receiving at least 1% of the actual vote, “none” where applicable, and one bucket containing **all** smaller candidates. That bucket requires either all its candidate answers or an explicit source “other” residual. Omitted major candidates are never assigned zero. Unresolved identities, duplicates, missing required candidates or an incomplete published distribution withhold MAE, RMSE and prediction verdicts. Individual comparable errors remain visible.

Selection is independent for each agency and round: use its latest eligible complete comparison, or its latest eligible partial comparison if none is complete. Fieldwork end, publication instant and stable identifiers break ties. Source date-only publication values use UTC midnight for deterministic ordering; no publication time is inferred. Comparisons with different bases must remain separately labelled in the UI.

An error is published share minus actual share, in percentage points. MAE is the mean absolute error across the consistent candidate/bucket set; RMSE also reflects larger misses. Ties produce unknown leader/pair verdicts. Vote share above 50% alone does not establish a first-round victory.

The reviewed historical corpus currently has no complete overall grades. Sova Harris's November 2021 question permits partial comparisons, but omits a candidate who received more than 1%. Other source bases or missing publication metadata prevent scoring. This is a coverage limitation, not zero polling error.
