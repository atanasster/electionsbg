# Municipal council minutes ingest

**Status:** scaffolding committed; actual scrape pending.

The single biggest civic-tech differentiator on the My-Area roadmap —
MyTownView-style AI-summarised council resolutions per município. Every
общински съвет publishes решения; ingesting them and surfacing a
2-sentence Gemini summary per resolution gives users a "what is my
council voting on" view that no other BG civic-tech platform delivers.

## Source

~265 общински съвет websites, heterogeneous. Most use SiteFinity or
Joomla; some are bespoke. Решения typically published as PDFs or HTML
tables grouped by sitting date.

## Pipeline (planned)

1. `scripts/council/discover.ts` — one-off discovery pass. Curate a
   per-município source URL + selector recipe in
   `data/council/sources.json`. Target the top 30 municipalities by
   population first (~70% of the citizenry coverage), then long-tail.
2. `scripts/council/scrape.ts` — per município, fetch resolutions
   published since last run (date watermark in `state/ingest/`).
3. `scripts/council/summarize.ts` — Gemini Vision / Text pass producing
   a 2-sentence BG summary, an EN translation, and a tag set
   (financial / personnel / urban planning / procurement / social / other).
4. Emit per município: `data/council/{obshtina}/{year}/{resolution_id}.json`
   plus `data/council/index.json` with the most-recent-50 references
   indexed by obshtina.

## Watcher wiring

- Per-município watch source: `state/watch/council_{obshtina}.json`
  fingerprinted on the решения index-page hash.
- Composite watch source: `state/watch/council_minutes_index.json`
  tracking the catalogue overall.
- Skill: `update-council-minutes`.
- Mapping row in `process-watch-report/SKILL.md`:
  `council_minutes_index → update-council-minutes`.

## UI integration

`MyAreaCouncilMinutesTile` ships scaffolded; auto-hides while
`resolutionsByObshtina` is empty. When the scrape lands, every município
with entries surfaces the latest 5 resolutions with summary + tag
badges + a link to the official PDF.

## AI disclosure

Summaries are AI-generated; UI surfaces a disclaimer and always links to
the official решение PDF as the source of truth. Hallucination guard:
the prompt is constrained to "summarise only what is in the input PDF;
respond with [no content] if the input is unintelligible".
