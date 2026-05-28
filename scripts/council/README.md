# Municipal council ingest — resolutions + vote tallies

**Status:** scaffolding committed; actual scrape pending.

Two related deliverables share one pipeline:

1. **Resolutions digest** (original scope) — MyTownView-style
   AI-summarised council решения per município. A 2-sentence Gemini
   summary + tag set per resolution: "what is my council voting on."
2. **Vote tallies** (this plan) — the aggregate за/против/въздържал се
   counts for each resolution, plus the official protocol link. The
   municipal analog of parliament roll-call (`data/parliament/votes/`).
   Per-councillor (поименно) grain is a later phase, Sofia first.

No other BG civic-tech platform delivers either at national scale.

## Why there is no shortcut (read before proposing data.egov.bg)

**data.egov.bg does NOT carry vote tallies + protocol links.** Confirmed
by sampling actual records (`/api/listOrganisations`, `/api/listResources`,
`/api/getResourceData`), not just dataset titles:

- РМС 436/2017 Прилож. 1.2 mandates only TWO council datasets: row 53
  "Регистър на върнатите за ново обсъждане решения" (the narrow чл. 45
  ЗМСМА governor-vetoed register) and row 55 "Списък на издадените общи
  административни актове" (titles only). Neither has vote-count columns or
  a protocol-PDF link.
- 4 of the 10 largest councils (Sofia, Plovdiv, Varna, V. Tarnovo) publish
  NOTHING in this category. The rest are hyperlink-only (point back to the
  município CMS) or the чл. 45 register. Only ~5-10 munis have a real CSV,
  all the "returned" subset, often stale.
- **Verdict:** the portal gives a directory of governor-vetoed disputes,
  not vote tallies. The only source is each município's own протоколи.

(Full sampling notes in memory: `project-council-votes-ingest`.)

## Source landscape

~265 общински съвет websites, heterogeneous. No dominant council-management
SaaS (unlike US Legistar/Granicus). Market is fragmented: voting.bg hardware
(small munis), e-obs.online SaaS, NK Software / obshtini.bg CMS, bespoke for
big cities. Решения + протоколи published per sitting date as PDF (text or
scanned), DOCX, or HTML tables.

**Per-município difficulty tiers** (drives Phase-1 ordering):

| Tier | Munis | Format | Vote grain | Effort |
|---|---|---|---|---|
| A — native text | Sofia (council.sofia.bg), Blagoevgrad (.DOC), Pleven (DOCX), Ruse (DOCX), V. Tarnovo (HTML slugs) | text-layer PDF / DOCX / HTML | poimenno present (Sofia, Blagoevgrad confirmed) | low |
| B — drill-in | Plovdiv (403 wall → Playwright), Varna, Burgas (custom CMS) | PDF behind session pages | unclear; likely aggregate | medium |
| C — OCR only | Stara Zagora, Sliven | scanned image PDFs | poimenno but image-only | high (Gemini Vision, like Varna budget scans) |

**Discovery aid:** Под ОКО (pod-oko.site) has a 16k-session sitemap
(`/sitemap-sessions.xml`) with source backlinks — use to enumerate which
sessions exist per município. Its own data is aggregate free-text only and
its API is write-only, so it is a *discoverer*, not a source.

## Phased plan

### Phase 0 — discovery (one-off, ~3 days)

`scripts/council/discover.ts` — curate a per-município recipe in
`data/council/sources.json`:

```jsonc
{
  "<obshtina>": {                  // key = MyArea obshtina id (matches area.obshtina)
    "name": "Столична община",
    "tier": "A",
    "indexUrl": "https://council.sofia.bg/...",   // решения / протоколи listing
    "fetch": "static" | "playwright",             // CF/SPA needs headed browser
    "format": "pdf-text" | "docx" | "html" | "pdf-scan",
    "sessionSelector": "...",                     // how to enumerate sittings
    "resolutionSelector": "...",
    "tallyStrategy": "regex" | "pdf-table" | "gemini" | "none",
    "voteRegex": "(\\d+)\\s+за[,.]?\\s+(\\d+)\\s+против[,.]?\\s+(\\d+)\\s+въздържал"
  }
}
```

Seed the top ~9 (tiers A+B) first (~50%+ of citizenry). Long-tail later.
Reuse the CF-bypass Playwright session from `scripts/parsers_local/cik_fetch.ts`
for Plovdiv / any Cloudflare-fronted site.

### Phase 1 — aggregate tallies + protocol link (top ~9, ~3-6 weeks)

`scripts/council/scrape.ts` — per município, fetch резолюции published
since the last run (date watermark in `state/ingest/council_<obshtina>.json`).
For each resolution extract:

```jsonc
{
  "id": "SOF-2024-prot92-r123",
  "date": "2024-06-14",
  "session": "Протокол 92",
  "number": "123",
  "title": "...",
  "tally": { "for": 33, "against": 2, "abstain": 1, "method": "named" | "open" | "none" },
  "result": "adopted" | "rejected" | "returned",
  "sourceUrl": "https://council.sofia.bg/.../protokol-92-...pdf",
  // resolutions-digest fields (Gemini, separate pass):
  "summary_bg": "", "summary_en": "", "tags": []
}
```

`tally.method: "none"` when only an aggregate vote was явно/by acclamation
and no count is parseable — keep the resolution, drop the numbers (don't
guess). The `tally` block is additive to the existing `CouncilResolution`
type in `src/data/council/useCouncilMinutes.tsx` — extend it, don't fork.

Parsers per format:
- **pdf-text** (Sofia): `pdfjs`/`pdf-parse` text extraction → `voteRegex`
  against the "Поименно гласуване" block. Validate against any printed
  "Гласували: N" subtotal.
- **docx** (Pleven, Ruse): `mammoth` → text → `voteRegex`.
- **html** (V. Tarnovo): cheerio selectors.
- **doc** (Blagoevgrad legacy): `antiword`/`textract` → regex.

### Phase 2 — Sofia per-councillor grain (~+2-3 weeks)

Sofia's PDFs already list each councillor + their За/Против/Въздържал per
named vote. Parse the poimenno table into per-councillor rows and JOIN to
the councillor roster we already have at `data/officials/municipal/`
(cacbg "Кметове" slice — see `project-connections-expansion`). Entity
resolution by normalized name is load-bearing — namesakes are common.
This unlocks cohesion-by-party / loyalty metrics like the parliament side.

### Phase 3 — OCR munis + long tail (defer)

Stara Zagora, Sliven: Gemini Vision on the scanned protocol PDFs (mirror
the Varna budget OCR pre-step). Expect 70-85% per-session accuracy; gate
behind a confidence check. Long-tail 250 munis = per-município hell; only
pursue with a Под ОКО data-share partnership or a national mandate.

### Phase 4 — summaries (the original digest scope)

`scripts/council/summarize.ts` — Gemini pass producing `summary_bg`,
`summary_en`, and tags (financial / personnel / urban_planning /
procurement / social / other). Can run independently of tallies; both
write into the same resolution record. Hallucination guard: "summarise
only what is in the input; respond with [no content] if unintelligible."

## Output layout

- Per município: `data/council/{obshtina}/{year}/{resolution_id}.json`
- `data/council/index.json` — most-recent-N per município, keyed
  `resolutionsByObshtina` (already scaffolded; key = `area.obshtina`).
- `data/council/sources.json` — discovery recipes (Phase 0).
- Watermark: `state/ingest/council_<obshtina>.json`.

## Watcher wiring

- Per-município watch source fingerprinted on the решения index-page hash.
- Composite `state/watch/council_minutes_index.json` tracking the catalogue.
- New watch source under `scripts/watch/sources/council_minutes.ts`.
- Skill: `update-council-minutes` (allowed-tools Read/Bash/Edit/Write,
  mirror `update-rollcall`). Incremental walk from the date watermark;
  cold-start from a per-município earliest-session anchor.
- `process-watch-report/SKILL.md` mapping row:
  `council_minutes_index → update-council-minutes`.
- CLI flag on `scripts/main.ts`: `--council [--obshtina <id>]`.

## UI integration

`MyAreaCouncilMinutesTile` ships scaffolded; auto-hides while
`resolutionsByObshtina` is empty. When the scrape lands, every município
with entries surfaces the latest 5 resolutions with the vote tally
(за/против/въздържал chips), tag badges, summary, and a link to the
official PDF. Dashboard tile style (no tabs) per the UX standard. MP/
councillor rows in any per-councillor view use the shared `MpAvatar`.

## AI disclosure

Summaries are AI-generated; UI surfaces a disclaimer and always links to
the official решение PDF as the source of truth. Vote tallies are parsed
verbatim from the protocol (not AI-inferred) — surface the source PDF link
beside every tally so a reader can verify.
