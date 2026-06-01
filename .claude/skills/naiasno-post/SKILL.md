---
name: naiasno-post
description: Draft a Наясно (electionsbg.com) social post — a number-led Facebook card plus BG/EN copy — grounded in the site's own data AND independently confirmed against a public source. Checks the post registry for duplicates first. Use when the user asks to "create/draft a post", "make a Facebook card", "post about <topic>", "пост за <тема>", "напиши пост", or to turn a data finding / today's watcher report into a shareable post. Saves a reviewable draft (never auto-publishes).
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Write
  - WebSearch
  - WebFetch
---

# Наясно — post composer

Turns a single data point into a publish-ready Facebook post for the **Наясно**
brand: a native 1080×1080 card (navy + coral, the site theme) plus BG (and
optional EN) copy, with the deep link and sources. Output is a **draft** for the
operator to review and post by hand — this skill never publishes to Facebook.

## Non-negotiable rules

1. **Grounded in our data.** Every headline number must come from a real file
   under `data/` (or `public/`) and link to the matching on-site page. Never
   invent or estimate a number. Quote the exact figure.
2. **Confirmed against public information.** Independently verify the headline
   number against the PRIMARY public source (АОП, Сметна палата/bulnao, ЦИК,
   parliament.bg, data.egov.bg, Eurostat, НСИ) or a reputable news report, via
   `WebSearch`/`WebFetch`. Record the confirming URL in `sources`. If it cannot
   be confirmed, or the public source contradicts our data, **do not draft** —
   report the discrepancy instead.
3. **No duplicates.** Run the dup-check before composing (step 2).
4. **Non-partisan, no emojis, plain Bulgarian.** Let the number be the point;
   no adjectives, no outrage, no party-side framing. (User preference: no emojis.)
5. **Link goes in the first comment, not the post body** (Facebook throttles
   link posts). The draft states this.

## Pipeline

```
topic ─▶ dup-check (post_tool check) ─▶ ground in data/  ─▶ confirm vs public source
      ─▶ compose BG/EN ─▶ write spec.json ─▶ post_tool save ─▶ review draft
```

## Step 1 — Pick the topic / angle

From the user's request, or surface one from the latest data: skim
`data-reports/latest.md` (what the watcher just found) or the freshest files in
`data/procurement`, `data/funds`, `data/budget`, `data/officials`,
`data/parliament`, etc. Pick ONE concrete, surprising, checkable fact.

## Step 2 — Duplicate check (before any work)

```bash
node_modules/.bin/tsx scripts/posts/post_tool.ts check "<keywords: entity, metric, year>"
```
If it warns of high overlap, either pick a new angle or propose updating the
existing post. Do not proceed on a near-duplicate.

## Step 3 — Ground the number in our data

Find the exact figure in the data and the on-site deep link. Common homes:

| Topic | Data | Deep link (base: electionsbg.com — naiasno.bg later) |
|---|---|---|
| Procurement | `data/procurement/*` | `/procurement`, `/company/:eik`, `/awarder/:eik` |
| EU funds | `data/funds/*` | `/funds`, `/funds/programme/:code` |
| Budget | `data/budget/*` | `/budget`, `/budget/ministry/:id` |
| MP assets/cars/connections | `public/parliament/*` | `/mp-assets`, `/mp-cars`, `/connections`, `/candidate/:id` |
| Parliament votes | `data/parliament/votes/*` | `/votes/:date`, `/parliament` |
| Party financing | `data/financing/*` | `/financing`, `/party/:id/donors` |
| Elections | `public/<date>/*` | `/`, `/municipality/:id`, `/section/:id` |
| Indicators/macro | `data/indicators.json`, `data/macro.json` | `/indicators`, `/indicators/compare` |

Record: the exact value, the dataset path, and the deep link.

## Step 4 — Confirm against a public source

Use `WebSearch`/`WebFetch` to find the figure (or its raw basis) in the primary
register or a credible outlet. Capture the URL. If you cannot confirm it, stop
and tell the user — do not draft an unverifiable claim.

## Step 5 — Compose

- **BG body:** a 1-line hook + the number in context (1–2 sentences) + a soft
  CTA ("Пълната разбивка е в линка в коментарите."). No emojis, non-partisan.
- **EN body (optional):** same, concise.
- **Card spec:** `value` (e.g. "2,4 млрд. лв."), `label` (1–2 short plain-language
  lines, `\n` separated), `source` (e.g. "Източник: АОП"), optional `kicker`,
  `cta` (default "виж разбивката"), `theme` ("dark" default; "light" = cream).

## Step 6 — Save the draft

Write a spec JSON to a temp path, then:
```bash
node_modules/.bin/tsx scripts/posts/post_tool.ts save /tmp/<slug>.spec.json
```
Spec shape:
```json
{
  "slug": "2026-06-01-procurement-no-competition",
  "date": "<today YYYY-MM-DD>",
  "title": "2,4 млрд. лв. поръчки без конкуренция (2024)",
  "tags": ["procurement", "пари"],
  "entities": ["АОП"],
  "keyFact": "2,4 млрд. лв. обществени поръчки възложени без конкуренция през 2024",
  "link": "https://electionsbg.com/procurement",
  "sources": ["data/procurement/summary.json", "https://www.aop.bg/..."],
  "bg": "…BG post body…",
  "en": "…optional EN…",
  "card": { "value": "2,4 млрд. лв.", "label": "обществени поръчки, възложени\nбез конкуренция през 2024 г.", "source": "Източник: АОП", "theme": "dark" }
}
```
`save` re-runs the dup guard, renders `brand/posts/<slug>.png`, writes
`brand/posts/drafts/<slug>.md`, and appends to `brand/posts/index.json`.

## Step 7 — Review

Show the operator: the rendered card (Read the PNG), the BG/EN copy, the deep
link, and the confirming sources. Remind: post the image natively, link in the
first comment.
