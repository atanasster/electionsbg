# Independent poll reading — instructions for the reader subagent

You are producing an **independent reading** of ONE captured polling
publication. A deterministic extractor has already read the same capture; your
reading is compared to it figure by figure, and the poll is published
automatically only if the two agree. Your value is independence.

## Hard rules

1. Read ONLY the capture directory you are given (`page.html`, any `.pdf` /
   `.doc` attachments, any images — open every image, charts often hold values
   the text omits). Do NOT open anything under `data/polls/`, `state/polls/`
   (except to write your output file) or `scripts/polls/`. Never look at the
   extractor's draft.
   A `.ppt` / `.pptx` report cannot be opened directly — convert it first and
   read the PDF as if it were the presentation (cite the .ppt filename in any
   `image` field; write the PDF to the scratchpad, never into the capture):
   `npm run polls:ppt-pdf -- "<capture>/<file>.ppt" <scratch>/<file>.pdf`
2. Transcribe; never compute, round, renormalise or infer. A value you cannot
   see stated is absent — leave it out. If something is ambiguous, still record
   what is stated; a disagreement simply routes the poll to a human, which is
   the safe outcome.
3. Every share needs `quote` (verbatim text copied from the article/PDF, at
   least ~15 characters, including the number exactly as printed, e.g.
   „за Андрей Гюров и Георги Кандев – 25,3%") OR `image` (the capture
   filename) when the value appears only in an image. Prefer `quote` when the
   value is in the text.
4. `methodologyQuote` / `sponsorQuote` / `fieldworkQuote` / `respondentsQuote`
   must be verbatim text from the article or PDF (not an image), or null.

## Conventions (the corpus's, not yours to change)

- **Presidential tickets** („Илияна Йотова и Кирил Вълчев") → label is the
  presidential candidate only: „Илияна Йотова".
- „Не подкрепям никого" → `kind: "none"`. A pooled „Друг"/„Други" → `kind:
  "other"` with the label as printed. Undecided / won't vote / won't say →
  `undecided` / `wont_vote` / `wont_say`. Parties and candidates → `choice`
  with the label exactly as the agency prints it.
- `measure`: `vote_intention` (who would you vote for), `party_backed_candidate`
  (a party's yet-unnamed candidate), `support_potential` (would you support
  X — several answer levels), `runoff` (a two-person second round),
  `participation` (will you vote). One question entry per measure/round.
- `baseKind` is the population the percentages are OF, as published:
  `all_respondents`; `likely_voters` (those who intend / are firmly decided to
  VOTE — „твърдо решили да гласуват", „заявилите, че ще гласуват");
  `decided_voters` (those who named a specific choice — „посочилите конкретна
  партия/двойка"); `valid_votes`; `unknown` when not stated. Never upgrade a
  likely-voter base to decided. `basePhrase` is the base text verbatim;
  `baseLabel` is a short bg/en label for it (null when `baseKind` is
  `unknown`).
- `genre`: `forecast` if the agency calls it a прогноза/прогнозен резултат;
  `raw_attitudes` if it says the data are attitudes / „не са прогноза";
  `both_published` if both are shown; `unclear` otherwise.
- Dates are ISO `YYYY-MM-DD`. A fieldwork span written without a year takes
  the year from the chart title or the publication date — and only then.
- `methodology` is a short factual summary in Bulgarian (`bg`) with a faithful
  English translation (`en`): method, sample, margin of error. The `bg` must be
  supported by `methodologyQuote`.
- `race`: one entry in `polls` per race the publication reports
  (`parliamentary` = party vote for the National Assembly; `presidential`).
  If the publication carries no electoral poll at all (a topical survey, an
  exit poll, results after the vote), set `polls: []` and say why in
  `notAPoll`.

## Output

Write exactly one JSON file to the `readingPath` you were given:

```json
{
  "schema": "polls-ai-reading/v1",
  "agencyId": "MY",
  "pubId": "1918",
  "captureSha256": "<the captureSha256 you were given>",
  "model": "<your model id, e.g. claude-opus-5-5>",
  "readAt": "<ISO timestamp>",
  "notAPoll": null,
  "polls": [
    {
      "race": "presidential",
      "fieldworkStart": "2026-09-26",
      "fieldworkEnd": "2026-10-04",
      "fieldworkQuote": "между 26 септември и 4 октомври",
      "respondents": 1000,
      "respondentsQuote": "сред 1000 пълнолетни българи",
      "publishedAt": "2026-10-05",
      "genre": "raw_attitudes",
      "methodology": { "bg": "…", "en": "…" },
      "methodologyQuote": "проведено чрез пряко лично интервю и онлайн анкета",
      "sponsor": null,
      "sponsorQuote": null,
      "questions": [
        {
          "measure": "vote_intention",
          "round": 1,
          "baseKind": "likely_voters",
          "basePhrase": "твърдо решили да гласуват",
          "baseLabel": { "bg": "Твърдо решили да гласуват", "en": "Respondents firmly decided to vote" },
          "answers": [
            { "label": "Илияна Йотова", "kind": "choice", "value": 46.9,
              "quote": "за Илияна Йотова и Кирил Вълчев биха гласували 46,9%", "image": null },
            { "label": "Друг", "kind": "other", "value": 7.6,
              "quote": null, "image": "2-1-2048x1155.jpg" }
          ]
        }
      ]
    }
  ]
}
```

Then reply with one line: the file you wrote and how many answers you read.
