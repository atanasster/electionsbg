# Наясно Новини — moderated validation v1

Status: protocol ready; no sessions have been run and no user findings are claimed.

## Decision this study supports

Validate whether readers understand that the homepage is a curated set of analysed
articles/stories, can compare coverage without reading the political/Russia axes as
ratings of an entire outlet, can verify an article-level judgment, and can report a
problem. The study decides which comprehension defects block a limited release.

## Participants

Recruit 8 Bulgarian-language news readers: four frequent (daily) and four occasional
(weekly or less), including at least two people aged 55+, two mobile-primary readers,
and two people who describe themselves as politically engaged. Exclude project
contributors and anyone briefed on the interface. Record only the segment attributes;
do not collect party preference, exact age, employer, or other unnecessary personal data.

## Consent and handling

Explain that this tests the product, not the participant. Obtain explicit consent before
screen/audio recording. Assign P01–P08; keep notes under that identifier, never a name.
Do not ask participants to sign into GitHub or submit a real correction. Delete raw
recordings after synthesis; keep redacted task notes and aggregate results. Stop recording
immediately on request.

Store the participant-code key separately from notes, accessible only to the study lead.
Delete that key together with recordings within 14 days of each session and before any
results are shared. Before synthesis, remove names, usernames, URLs containing personal
data, and incidental notifications from notes. Store redacted notes in the restricted study
folder; publish only aggregates and paraphrases that cannot identify a participant. Record
deletion dates in the study log. A withdrawal request received before deletion removes that
participant’s recording and notes from the synthesis.
Delete participant-level redacted notes within 90 days after synthesis sign-off; retain
only aggregate findings and non-identifying product decisions.
Recruitment contact details stay with the recruiter and are not copied into study files;
the recruiter deletes them after scheduling unless a separate retention basis was agreed.
Notes consent is required to participate; declining recording still allows a notes-only
session, while declining notes ends the session without retaining observations.

## Fixed stimuli and setup gate

Before recruitment, record one immutable staging build URL and commit. Select and record:
one homepage card with visible image credit; one multi-outlet story with at least three
members and both filter axes; one analysed member with evidence, confidence, model/date and
a working original link. Use those same URLs for every participant. The moderator verifies
them in desktop and mobile widths, confirms Saved is empty, and completes all five tasks in
an incognito profile. If content disappears or a source link breaks, pause the study and
replace the stimulus for **all** sessions; discard and rerun earlier sessions rather than
mixing results across stimulus sets.

## Session script (35–45 minutes)

Use the same current staging build and reset local storage before each session. Ask the
participant to think aloud; do not teach labels until the relevant task is complete.

1. **Homepage orientation (5 min).** Moderator opens the recorded homepage build. “Разгледайте началната страница. Какво според вас
   присъства тук и какво не?” Success: explains analysed/curated coverage and recognizes
   image attribution without prompting.
2. **Compare one story (8 min).** Moderator opens the recorded multi-outlet story. “Обяснете
   как се различава отразяването.” Success: recognizes the multi-outlet coverage, filters it, and does not
   generalize an article label to the outlet.
3. **Verify one judgment (8 min).** Moderator names the recorded analysed member. “Проверете защо конкретният материал има тази оценка.”
   Success: reaches the article analysis, identifies evidence/confidence/model/date, and
   can open the publisher’s original.
4. **Return later (4 min).** “Запазете това и покажете къде бихте го намерили утре.”
   Success: saves, locates Saved, and understands it remains on this device.
5. **Challenge an error (6 min).** “Представете си, че оценката е грешна. Покажете какво
   бихте направили.” Success: finds the contextual report link, recognizes GitHub is public,
   avoids entering sensitive data, and locates the corrections register.

After each task ask: “Какво очаквахте да стане?” and “Кое ви накара да решите това?” End
with a comprehension check: distinguish article judgment, outlet profile, story cluster,
and an unanalysed article in the participant’s own words.

## Evidence sheet

For each task record: completion (`independent`, `with_prompt`, `failed`), time, first wrong
turn, quote/paraphrase, device/viewport, and severity. Do not reduce observations to a
single satisfaction score.

Score each named success checkpoint separately (`observed`, `missed`, `not applicable`).
An “independent” task has every required checkpoint observed with no directional help. One
neutral repeat of the task is not a prompt; any hint naming a destination, control or concept
is a prompt and must be quoted in the record. “Failed” means a required checkpoint remains
missed after one standardized prompt or the participant abandons the task.
Use `not applicable` only for a documented technical failure outside the participant’s
control; it removes that participant-task from the denominator and requires a replacement
session. Never use it for confusion, missing content that the setup gate should catch, or a
moderator omission.

| Severity | Definition | Release consequence |
| --- | --- | --- |
| Blocker | Produces a materially false belief about a named outlet/person, hides public-report privacy, or prevents the core comparison task | Fix before limited release |
| Major | Two or more participants fail a core task or cannot recover | Fix before broad rollout |
| Minor | Friction with a successful recovery and no false claim | Prioritize after limited release |

## Exit criteria

- At least 7/8 independently explain that judgments apply to individual articles.
- At least 6/8 independently complete story comparison and evidence verification.
- At least 7/8 independently identify that the homepage is curated to analysed content;
  at least 6/8 find and correctly interpret image attribution.
- At least 7/8 understand that Saved is device-local and not an account/sync feature.
- All 8 notice or correctly repeat that the correction channel is public before the
  hypothetical submission.
- All 8 avoid placing sensitive data in the hypothetical public report.
- No blocker remains; every major issue has an owner, reproducible evidence, and retest.

If a criterion fails, revise the smallest responsible copy/interaction and retest with
three new participants. The retest passes only if all three complete the affected safety or
privacy checkpoint independently, or at least two of three complete an affected non-safety
core-task checkpoint independently, with no new blocker. Otherwise revise and retest again.
Do not count the original participant’s learned second attempt as independent validation.

## Session record template

```text
Participant: P__   Date: ____   Build/commit: ____   Device/viewport: ____
Consent to notes: yes/no   Consent to recording: yes/no

Task 1: independent / with_prompt / failed   Time: ____
Checkpoints (observed/missed/N/A): curated analysed set __; image credit __
First wrong turn / evidence:
Task 2: independent / with_prompt / failed   Time: ____
Checkpoints: recognizes multi-outlet coverage __; uses filter __; avoids outlet generalization __
First wrong turn / evidence:
Task 3: independent / with_prompt / failed   Time: ____
Checkpoints: evidence __; confidence __; model/date __; original __
First wrong turn / evidence:
Task 4: independent / with_prompt / failed   Time: ____
Checkpoints: save __; find Saved __; device-local comprehension __
First wrong turn / evidence:
Task 5: independent / with_prompt / failed   Time: ____
Checkpoints: contextual link __; public-channel warning __; avoids sensitive data __; register __
First wrong turn / evidence:

Comprehension paraphrase:
Issues (severity + reproducible observation only):
Moderator interventions:
Recording deleted on: ____   Code key deleted on: ____   Redaction checked by: ____
```
