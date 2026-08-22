# Council protocol parsing — the untitled-resolution gap, and a false-positive marker

Measured 2026-08-22 against local Postgres (`council_resolution`, 4,601 rows) and, where a
claim needed the source, against the live protocol documents named in `source_url`.

**Headline: 2,232 of 4,601 rows (49%) carry `title = '(no title parsed)'`.** That is the
sentinel, not a NULL — it is written deliberately by the parsers.

⚠️ **Two DIFFERENT defects are tangled here and they have opposite urgency.** One is a
coverage gap (a row that is real but unlabelled); the other is a correctness bug (a row that
is not a resolution at all). Fix the second first — it is the same class as the 131 Разград
orphans purged on 2026-08-22.

---

## Defect B — `Точка N` is accepted as a resolution marker · ~84 rows · CORRECTNESS

`findResolutionMarkers()` (`scripts/council/lib/tally.ts:539`) matches:

```
/(?:^|\n)[ \t]*(?:РЕШЕНИЕ|Р\s+Е\s+Ш\s+Е\s+Н\s+И\s+Е|Точка)\s*(?:№\s*)?(\d+)/gu
```

The `Точка` alternative was added for Sofia, whose Gemini-re-OCR'd PDFs lose their
`Решение № N` headers. Its own comment states the assumption:

> Other municipalities don't use bare "Точка N" on its own line so this alternative doesn't
> false-positive.

**That assumption is false for Русе, which uses `Точка N` on its own line for every agenda
item.** Measured on `ПРОТОКОЛ_32.docx`: 23 `РЕШЕНИЕ` markers, 29 `Точка` occurrences, and
`findResolutionMarkers` returns **51 markers**.

The resulting rows carry a real tally (picked up from nearby text), so they are
indistinguishable from real resolutions by row shape. The discriminator is the NUMBER BAND:

| município | `<100` | `100–499` | `500+`  | reading                                                                                                        |
| --------- | ------ | --------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| **RSE01** | **81** | **0**     | **130** | perfect gap → two populations. Ruse numbers resolutions 900+; the 81 are agenda-point indices (r1, r10, r11 …) |
| PVN01     | 2      | 0         | 135     | same gap shape, tiny                                                                                           |
| VAR01     | 1      | 0         | 80      | same gap shape, tiny                                                                                           |
| DOB28     | 50     | 0         | 0       | **NOT bimodal** — 1..46 contiguous, legitimate per-protocol numbering                                          |
| GAB05     | 156    | 88        | 0       | **NOT bimodal** — 1..199 continuous, legitimate                                                                |

⚠️ **A small number is not evidence on its own** — DOB28 and GAB05 prove that. What convicts
Ruse is the EMPTY middle band plus direct confirmation in the source document. PVN01 and
VAR01 share the shape but were not confirmed against their sources; treat them as suspected,
not proven.

**Fix:** scope the `Точка` alternative to the parser that needs it (Sofia) rather than
carrying it in the shared helper — either a flag on `findResolutionMarkers`, or a Sofia-local
marker pass. Prefer the flag: `sof.ts` is not the only caller and a second OCR'd corpus will
want it again.

⚠️ **A re-parse alone does NOT remove the bad rows.** `db:load:council:pg` is upsert-only by
design (a resolution is a permanent public record). The 81 ids simply stop being written and
the stored rows persist. Removing them is a targeted purge, exactly like the Разград one.

---

## Defect A — missing titles · 2,232 rows · COVERAGE

Three causes, in descending order of cheapness. The distribution is bimodal, which is itself
the finding: five municipalities are at 0% and three at ~100%, so this is parser coverage, not
source quality.

| município | untitled       |     | município                             | untitled      |
| --------- | -------------- | --- | ------------------------------------- | ------------- |
| DOB28     | 50/50 (100%)   |     | RAZ26                                 | 180/207 (87%) |
| PER32     | 563/563 (100%) |     | HKV34                                 | 292/387 (75%) |
| RSE01     | 211/211 (100%) |     | HKV09                                 | 335/607 (55%) |
| PVN01     | 134/137 (98%)  |     | VAR01                                 | 32/81 (40%)   |
| SZR12     | 332/359 (92%)  |     | SOF                                   | 57/416 (14%)  |
|           |                |     | VTR01                                 | 41/460 (9%)   |
|           |                |     | BGS01 · GAB05 · PDV01 · SLV01 · SZR01 | ~0%           |

### A1 — the parser never attempts a title · 613 rows · CHEAPEST

`per32.ts:359` and `dob.ts:143` assign the sentinel as a **literal**, not as a fallback:

```ts
title: "(no title parsed)",
```

**PER32 is the single largest win in this document and the least work.** Its source carries
**116 `ОТНОСНО:` clauses per protocol** (measured on `ПРОТОКОЛ-№7-21.07.2026г.docx`), and they
are exactly the titles:

```
ПРЕДОСТАВЯНЕ НА ОБЩИНСКИ ЖИЛИЩА, ВКЛЮЧЕНИ В ОБЩИНСКИ ЖИЛИЩЕН ФОНД …
ОСВОБОЖДАВАНЕ И ИЗБОР НА УПРАВИТЕЛ НА ОБЩИНСКОТО ПУБЛИЧНО ПРЕДПРИЯТИЕ „ПЕРНИК-ИНВЕСТ" ЕООД …
```

563 rows, and the extraction rule already exists in `findResolutionMarkers`'s ОТНОСНО
back-search — it is simply never called, because `per32.ts` uses its own marker scheme
(Pernik's `РЕШЕНИЕ` never starts a line, so the shared helper returns 0 markers there).

DOB28 (50 rows) is the same shape; its source is a PDF and was not probed.

### A2 — the source uses a different convention · 211 rows · PROTOTYPED

Русе never writes `ОТНОСНО` — **0 occurrences** in the probed protocol — so the ОТНОСНО
back-search can only ever return "". The title lives in the контролен-лист line instead:

```
Точка 2
К.л 926 Годишен доклад за наблюдение на изпълнението през 2025 г. на Плана за …
```

Prototyped against the live document: pairing each `РЕШЕНИЕ № N` with the nearest PRECEDING
`К.л NNN <subject>` line pairs **23 of 23**.

⚠️ **CORRECTION (2026-08-22, at implementation).** This section originally claimed the
mapping was "monotone with a constant offset", from the first six pairs — 917↔925, 918↔926,
919↔927 — and proposed using that as a free self-check. **It is not constant.** Measured
across the whole of prot 32 the offsets take the values **6, 8, 10 and 18**, because not
every контролен лист reaches a vote and Ruse also takes items out of numeric order. A guard
built on it fired on **14 of 18 protocols with nothing wrong**, and was replaced by one that
flags a К.л titling NON-consecutive resolutions — the shape that actually indicates the
nearest-preceding rule reached past a decision whose own К.л line is missing. That fires
once, not fourteen times. Six pairs were not a sample.

Note there are 52 `К.л` lines against 23 resolutions (the agenda lists them too), so
"nearest preceding" is load-bearing; a naive zip would drift.

### A3 — mixed within a município · ~1,400 rows · DIAGNOSED 2026-08-22

Originally "not investigated per-município". It has now been probed against each
município's own live protocol, and the tier splits three ways rather than being uniformly
"mixed". **Two of the five have no subject anywhere in the document** — which is the answer
this tier was always most likely to have.

| município | untitled | ОТНОСНО | относно | ДНЕВЕН РЕД | verdict                                             |
| --------- | -------- | ------- | ------- | ---------- | --------------------------------------------------- |
| HKV09     | 335/607  | 4       | 132     | **yes**    | tractable — agenda, same shape as DOB28             |
| SZR12     | 332/359  | 0       | 56      | **yes**    | tractable — two-hop via the `ОС_NNNN` docket        |
| HKV34     | 292/387  | 0       | 27      | no         | **no source** — the 27 are the preposition in prose |
| RAZ26     | 180/207  | 0       | 15      | no         | **no source** — no agenda, no `К.л` either          |
| PVN01     | 132/135  | —       | —       | —          | **unprobeable** — its `source_url` now 404s         |

**HKV09 and SZR12 (667 rows) are worth doing and are not free.** SZR12's rule is
`marker → nearest preceding ОС_NNNN in the body → that docket's agenda subject`, a two-hop
exact key. Prototyped against Протокол №59: **19 of 26 markers resolve**, from 21 agenda
items parsed of ~27. Getting that to the 85–100% the four shipped municipalities reach
needs per-document tuning of the agenda terminator — the seven unresolved markers
(824, 825, 826, 829, 833, 834, 835) are one contiguous block, so one shape is being missed
rather than seven separate cases. HKV09 was not prototyped; it has a `ДНЕВЕН РЕД:` block at
line 37 and 132 lowercase `относно`, so the DOB28 agenda parser is the obvious starting
point.

**HKV34 and RAZ26 (472 rows) should not be attempted.** Neither document contains a subject
line in any form this work has found: no `ОТНОСНО`, no agenda block, no контролен лист. The
occurrences of `относно` are the ordinary preposition inside debate prose, the same false
lead Добрич presented before its agenda was found. Titling them would mean synthesising a
subject from the decision body, which is a different and much weaker claim than quoting one
the council itself wrote.

**PVN01 (132 rows) is blocked, not deferred.** Its stored `source_url`
(`obs.pleven.bg/uploads/posts/protokol-47.docx`) returns 404, so the document cannot be
re-read to find out what shape it has. That needs a fresh crawl before anything else.

⚠️ **Do not read the remaining 32% as one problem.** 667 rows have an identified source and
a starting point; 472 have no source and are correctly left alone; 132 cannot be looked at.

---

## Why it matters

An untitled resolution is not cosmetic. It is what the reader sees:

- **`/council/:code`** lists `(no title parsed)` — 13 of the 20 rows Разград returns today.
- **The My-Area alerts feed** renders `„Общинският съвет гласува: Решение № 225 от 2026-07-28"`
  — a headline that names a number and no subject. This is precisely what the Разград purge
  removed, except those rows were also fabricated; these are real decisions we simply cannot
  label.

---

## Recommended sequencing

1. **Defect B** — scope `Точка` to Sofia, then purge the ~81 Ruse rows (+3 suspected).
   Correctness before coverage: these rows assert that a vote happened on something that was
   an agenda heading.
2. **A1 / PER32** — 563 rows, source proven, rule already written. Best ratio in the document.
3. **A1 / DOB28** — 50 rows; probe the PDF first, it may be an OCR case.
4. **A2 / RSE01** — 211 rows, prototyped, carries its own validation invariant.
5. **A3** — per-município, only if the remaining ~1,400 justify it.

⚠️ **The 18% estimate was optimistic; the measured landing is 32%.** Steps 1–4 took the
corpus from **2,232/4,601 (49%)** to **1,544/4,813 (32%)** — the denominator grew because
the Ruse re-scrape recovered 18 protocols. Per município: BGS01 100%, GAB05 100%, PDV01
100%, SLV01 100%, DOB28 98%, SZR01 97%, VTR01 91%, PER32 87%, SOF 86%, RSE01 85%, VAR01
61%, HKV09 45%, HKV34 25%, RAZ26 13%, SZR12 8%, PVN01 2%. Those figures are now pinned by
`TITLE_COVERAGE_FLOOR` in `council_corpus.data.test.ts`, so a parser that stops finding
subjects fails a gate instead of silently serving the sentinel.

The gap to 18% is entirely A3, which step 5 diagnosed rather than implemented — see that
section for why two of its five municipalities have no subject to find at all.

## Risks

- ⚠️ **The loader is upsert-only, so a re-parse cannot correct or remove a stored row.** New
  titles land on the same ids and overwrite (good); dropped ids persist (bad) and need a
  purge. Any of these fixes ships as `re-parse → load → targeted purge`, not just a reload.
- **Re-scraping is rate-limited and IP-sensitive** (`reference_council_scrape_ip_blocking`):
  BG hosts blackhole repeat runs. Budget for a slow re-crawl, and probe with `curl` first.
- **No raw text is cached.** Shards keep parsed output plus `source_url` only, so every
  iteration re-fetches. Caching the extracted text during this work would pay for itself.

## What this analysis does NOT establish

- DOB28's source was not probed — its 50 rows are assumed A1 by symmetry with PER32.
- PVN01's 2 and VAR01's 1 suspected `Точка` rows were not confirmed against their sources.
- A3's ~1,400 rows were not diagnosed at all; "mixed" is an observation, not a cause.
- Whether the 116 `ОТНОСНО` clauses in a Pernik protocol map 1:1 onto its resolutions was not
  measured — only that they exist and read as titles.
