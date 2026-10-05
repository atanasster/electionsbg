# Polls AI review — auto-accept on independent agreement (v1)

Status: building (2026-10-05). Resolves ⚑ §11.2 / T5.2 of
`docs/plans/polls-agency-watchers-v1.md` ("unattended accept").

## Decision (operator, 2026-10-05)

- **Agree-only auto-accept.** A draft is promoted without a human ONLY when the
  deterministic extractor and an independent Claude reading of the same captured
  source agree on every figure. Everything else lands in the inbox as a fully
  pre-filled draft the operator accepts with one command.
- **Scored like any other poll.** An AI-reviewed poll is not held out of
  accuracy; it is distinguishable by `locked.review`, not by a separate tier.

§11.2's objection was "the corpus's whole value is that every number was checked".
v1 keeps that: every auto-accepted number is checked TWICE (a regex parse grounded
by the evidence gate, and a vision/text read by a model that never saw the regex
output), and a single disagreement anywhere sends the poll to a human.

## Why `locked.by` does not change

`locked.by` is the SOURCE-AUTHORITY tier (agency website / PDF / press consensus)
and every consumer reads it as such. Who reviewed the numbers is orthogonal, so it
gets its own field:

```ts
locked.review?: { kind: "ai_agreement"; model: string; reviewedAt: string; draftHash: string }
```

Absent = human-reviewed (every poll accepted before this plan). `accept` stamps it
only when the draft carries an `aiReview` whose `draftHash` still matches the
draft's content — a hand edit after the review invalidates the stamp, so a human-
edited poll is never mislabelled as AI-verified.

## Pipeline

```
polls:fetch → polls:extract → polls:review   (new)
                                  ├─ agree  → accept (locked.review stamped)
                                  └─ else   → inbox draft pre-filled from the AI
                                              reading + `aiReview.diffs`
```

**The reading runs inside Claude Code, on the operator's subscription — no
API key, no SDK call** (operator decision, 2026-10-05). The update-polls skill
(Step 1a) runs `polls:review --prepare`, launches one subagent per task with
`.claude/skills/update-polls/ai-reading.md` and the capture directory ONLY
(never the draft), and each writes `state/polls/readings/<AG>-<pub>-<sha12>.json`
(schema `polls-ai-reading/v1`, `lib/ai_reading.ts`). Readings are committed —
they are the audit trail for every `locked.review`.

`polls:review` (scripts/polls/review.ts) then, per inbox draft:

1. **Validate** the reading (`validateReading`); invalid = no reading.
2. **Compare** (`compareDraftToReading`, pure): the extractor refused nothing;
   exactly one reading poll of the draft's race; same capture hash; fieldwork
   start/end, n, genre, base kind equal; genre not unclear; the answer sets are
   the same set (labels folded) with values within 0.05; residuals the reader
   saw are on the draft.
3. **Fill** methodology (and sponsor / publishedAt when absent) from the
   reading — only when its Bulgarian quote occurs in the captured text.
4. **Accept** through `polls:accept` itself (same validators), with
   `aiReview.verdict = "agree"` so `locked.review` is stamped. If accept
   refuses, the extractor draft is restored and marked `needs_human`.
5. Otherwise write `aiReview: { verdict: "needs_human", diffs }` on the draft.

Never auto: a `--replace` of a locked poll, a provisional id, a refused/unclear
genre, a `.vN` correction, or any API error (fail closed — draft untouched).

## Cost / credentials

One subagent per newly captured publication — a handful per week — inside the
session that is already running the skill. No credentials of its own.

## Gates

- `lib/ai_reading.test.ts` — agreement table; one share off by 0.2 → needs_human;
  an extra answer → needs_human; an extractor refusal → needs_human; imageOnly →
  needs_human.
- `review.test.ts` — agree → poll accepted with `locked.review`; disagree →
  diffs on the draft, corpus unchanged; ungrounded methodology → human; no
  reading / `--dry-run` → nothing written; accept refusal → draft restored.
- `aiReviewStamp` (in `ai_reading.test.ts`) — stamped only on a matching `draftHash`.
- `polls_corpus.test.ts` — `locked.review`, when present, is well-formed.

## Rules learned from the first live trial (2026-10-05)

- **By-design gaps are filled, not counted as disagreement.** The extractor
  always refuses `methodology` and leaves presidential `round` / `base` /
  `genre` open (`null` / `unknown` / `unclear`). The reader's value fills them
  (`Fill` in `ai_reading.ts`); a value BOTH leave open is still a diff, and a
  resolved value that differs is still a diff. Filling never touches
  `scoring` — a classification only the reader made never makes a poll count
  toward accuracy on its own.
- **Parliamentary short names** („РБ", „КП ББЦ") match the reader's full names
  through ЦИК's `data/<election>/cik_parties.json` (`party_aliases.ts`); the
  values must still be equal.
- **Parliamentary „Други" is ignored** — no corpus field stores it.
- **Hardened by code review (2026-10-05):** residuals are compared in BOTH
  directions (a value only one side states is a diff), including
  `otherNamedMinor` against the reader's „Други"; runoffs, participation
  figures and rows outside a compared question fail closed; labels pair
  exact-first, and a row that could pair with two reader answers is refused;
  reader-only fills must be grounded (base by its verbatim phrase, genre by
  the agency's „прогноза" wording, publication date only when the capture
  states the same one); after an unattended accept `polls:review` re-reads the
  corpus and errors if `locked.review` is missing; a throwing accept restores
  the draft and the batch continues.
- Trial: `ar-2014-09-30` → would accept (11/11 shares, fieldwork, n, grounded
  methodology); `ar-2013-05-08` → human (extractor kept 4 of 15 parties; reader
  calls the genre unclear where the extractor said forecast). Both correct.

## Side fixes found on the first real case (Мяра pub 1918)

- Capture Мяра's in-article chart images (`discoverAgencyImages`).
- MY presidential extractor (`extractors/myara_presidential.ts`): reads the
  ticket sentence („за X и Y – N%"), takes the fieldwork year from the chart
  title or the publication date, the base from the chart's „База:" line.
  Reproduces the hand-accepted `my-2026-10-04-presidential` exactly. Values
  stated ONLY in the chart („Друг 7,6%") are not OCR-readable and are never
  inferred, so a post carrying one still goes to a human with that single
  difference named.

## Out of scope (v1)

Unscored-but-visible quarantine; auto `--replace`; press-only agencies (still a
second independent outlet, decision 2).
