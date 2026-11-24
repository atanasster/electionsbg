---
name: update-zdoi
description: Refresh the ЗДОИ corpus — requests filed through pitay.government.bg („Платформа за достъп до обществена информация"): crawl new and still-open applications into the gitignored raw store raw_data/zdoi/pitay.sqlite, load them into zdoi_request / zdoi_event / zdoi_forward (migration 207) and publish to Cloud SQL. Use when the daily watch report flags `zdoi_pitay` as changed, when the user asks to refresh ЗДОИ / заявления за достъп до информация / pitay data, or after a fresh clone if zdoi_request is empty. The Cloud SQL publish is mandatory and nothing else runs it.
allowed-tools:
  - Read
  - Bash
---

# Update ЗДОИ (pitay.government.bg) skill

<!-- pipeline-pointer:start (generated from the registry; edit scripts/pipeline/registry) -->
> **Pipeline:** handler [`update-zdoi`](../../../docs/pipeline-handlers.md#update-zdoi) runs this unattended — `pnpm run pipeline:ingest --only update-zdoi`. The registry holds its commands, gates and publish set; this runbook covers what a script cannot do (operator steps, judgement calls, troubleshooting). When a step fails, start from the repair packet the run writes, not from the procedure below.
<!-- pipeline-pointer:end -->

Feeds the „Заявления по ЗДОИ" arm of the AI chat's mentions tool (`/api/db/zdoi-search`),
docs/plans/insait-gap-v1.md §3.

## Read this first: three rules every consumer keeps

1. **Only requests filed THROUGH the platform.** Bodies also answer by e-mail, post and in
   person; none of that is here. Say „заявления, подадени през ПДОИ", never „all requests",
   and never read an absence as „nobody asked".
2. **A decision is the body's own statement.** A figure in a decision is what the
   institution answered, not data we verified. Nothing extracts it into a number.
3. **The requester is a type, never a person.** Early (2019) pages print the requester's
   name, phone and e-mail. `redactRequester` removes them at the store's write path and
   again in the loader; `scrubContacts` replaces e-mails and phone numbers quoted in the
   subject or decision with „[контакт]". Never add a column that stores a requester.

## Steps

```bash
pnpm run zdoi:fetch --refresh
```

New ids up to the newest on the front page, plus every request whose status can still
move and every one last read more than 30 days ago. Resumable; exit 2 means some ids
failed and are queued for the next run. The first run is ~23k pages (~3 h at the default
400 ms delay) — run it by hand, not through the pipeline, whose step times out at 4 h; a
timeout loses nothing, since every stored page stays and the next run resumes. `--recheck-missing` re-asks ids stored as the platform's real 404;
`--from-id N --to-id M` limits the range.

```bash
pnpm run db:load:zdoi:pg
pnpm exec vitest run scripts/db/tests/zdoi.data.test.ts
```

The loader re-parses every stored page, so a parser fix needs no re-crawl. It refuses if
more than 2% of pages fail to parse (the page layout changed — fix `pitay_parse.ts`).

```bash
pnpm run db:load:zdoi:pg:cloud
```

## Deploy order

The first time, the cloud load (which applies 207, including the `app_readonly` grants)
must run **before** the `pnpm run deploy:db` that ships `/api/db/zdoi-search`. In the other
order the route degrades to no rows rather than failing, so a skipped load is silent.

## Troubleshooting

| symptom | cause |
| --- | --- |
| loader: „N/M stored pages failed to parse" | the platform changed its page layout; add the new page as a fixture under `scripts/zdoi/__fixtures__/` and fix the parser |
| fetch stops with „20 failures in a row" | the site is down or refusing us; re-run later, it resumes |
| `zdoi.data.test` finds an e-mail or mobile number | a new contact shape the scrub misses; extend `scrubContacts` (and its test), then reload — no re-crawl needed |
