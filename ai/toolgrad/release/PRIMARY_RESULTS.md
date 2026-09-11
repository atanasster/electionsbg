# Primary release validation — before repairs

The frozen 48-question run completed with 82 requests ($2.542 reservation ceiling,
actual billed cost unknown). Four narration payloads were withheld locally when
routing produced an unexpected result; the process exits nonzero to make those
failures visible. They are not API outages and are not removed from the denominator.
No nonfixture facts were sent in those withheld requests.

| Check | Result |
| --- | ---: |
| Correct route with usable expected scope | 44/48 |
| Actual tool envelope agrees with expected fictional result | 44/48 |
| Complete answer meets all predeclared quality criteria | 32/48 |
| Explicit unsupported/unclear requests safely clarified | 10/10 |
| Separate guard probes correctly accepted/rejected | 13/20 |

Two Bulgarian province spellings fail place resolution. Two requests explicitly
asking for all of Bulgaria are incorrectly changed to city scope by the policy,
even though the raw model chooses national results. This directly limits the
previous 50/50 routing result: that narrower suite missed these wordings.

Among correctly routed answers, three English responses misuse total party votes
as the turnout denominator; another equates party votes with all cast ballots.
Six responses expose a raw source identifier, with two also calling municipality
records transfers. One Bulgarian answer spells Varna with mixed scripts. One
English tax answer invents a year; the guard catches it, but its deterministic
fallback has a plural error. The table itself retains the requested tax rates.
These issues overlap, so category counts must not be added as distinct failures.

The guard's seven misses are four unnecessary rejections (BG/EN missing-data
explanations and negated high-risk statements) and three accepted errors (BG/EN
swapped asset/debt values and payment reported as zero when it is unknown).

Raw model outputs, final responses, expected tool results, data-fetch requests and
callback timing are retained in `data/ai/toolgrad/release/primary/report.json`.
Per-response assessments in `primary-review.json` are bound to that report hash;
`reviewPrimary.run.ts` refuses replacement evidence. Quality judgments are local
coding-agent review, not blinded human evaluation. These are fictional-input
integration results, not live-data or browser end-to-end accuracy.

Recommendation at this checkpoint: repair the identified failures before rollout.
The eight confirmation questions remain unexecuted and are reserved until repairs.
