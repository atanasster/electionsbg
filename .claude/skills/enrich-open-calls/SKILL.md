---
name: enrich-open-calls
description: Read an ИСУН procedure's own document and extract its budget, aid rate, grant range and eligibility into open_calls — through a deterministic quote-in-source gate and a human sign-off. Use when the user asks to enrich / fill in the money on open calls (отворени процедури, бюджет на процедура, допустими кандидати), or after update-open-calls reports new GUIDs. NOT part of the daily refresh: it spends tokens per document and must never publish a figure unreviewed. The crawl+load half is update-open-calls.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Enrich open calls skill

`update-open-calls` gives every procedure a title, a deadline and a link. It cannot give it a
**budget**, an **aid rate**, a **grant range** or **who may apply** — ИСУН publishes none of
those in its listing. They exist only inside each procedure's own PDF/DOCX.

This skill reads that document and proposes those values. It is deliberately **separate** from
the crawl (plan §8.3.7): crawl+load is mechanical and safe on a cron, while reading a 52-page
„Условия за кандидатстване" costs tokens per document and **must not publish a figure without
human sign-off**. Keeping them apart means the daily refresh can never quietly ship an
unreviewed number.

## Read this first — what you will actually get

**Measured 2026-08-09, six live ИСУН procedures:**

| what happened | n | note |
|---|---|---|
| readable text (DOCX or PDF) | 4 | |
| **stated a EURO amount** | **0** | |
| stated a LEV amount | 3 | e.g. `91 072 240 лв.` |
| stated no amount at all | 1 | |
| ZIP archive — skipped with a reason | 1 | „Насоки за кандидатстване" |
| legacy `.doc` (OLE2) — skipped with a reason | 1 | „Покана" |

So: **on today's corpus the money yield is approximately zero, and that is the gate working,
not failing.** Bulgaria adopted the euro on 2026-01-01 and ИСУН's documents have not been
re-tabled; the currency rule below correctly rejects every lev budget offered as euro. What you
*will* get is **eligibility text** — the verbatim „кой може да кандидатства" sentence, which is
the question readers actually ask — and that is worth the run on its own.

Do not respond to a rejected budget by converting the lev figure yourself. That is a new number
you invented, not a number the document states. Omit it.

## The pipeline

### 1. See what needs work

```bash
npm run opencalls:enrich -- --list
```

Lists every ИСУН row at `enrichment='none'` with at least one document, in deadline order, and
names the document it would pick. `[NO USABLE DOC]` means the procedure publishes only annexes
— skip it, there is nothing to read.

Selection is a **preference order**, not a single label: `Обява › Покана › Условия за
кандидатстване › Насоки за кандидатстване › Заповед`. The plan named only „Обява"; measured
over the 55 live procedures it exists on 7, while „Условия за кандидатстване" is on 26, so a
single-label rule would leave four fifths of the corpus untouched.

### 2. Fetch one procedure's document

```bash
npm run opencalls:enrich -- --key <source_key>
```

Downloads it, extracts the text, and writes a worksheet to
`scratch/opencalls/<key>.md` (gitignored). Three things are handled for you and none of them
were obvious — see `scripts/opencalls/enrich_fetch.ts` for the probe that established them:

- the `InfoDownload?fileKey=` URL is a **302** to a signed, short-lived blob URL;
- `Content-Type` is **always** `application/octet-stream`, so the format comes from the magic
  bytes;
- an **archive** or a **legacy `.doc`** is reported as a skip-with-reason, never a crash. If
  you get one, move to the next procedure.

### 3. Read the worksheet and extract

Read the file. Its „## Document text" section is the **exact string the gate will check your
quotes against** — search within it. Write your answer as JSON to
`scratch/opencalls/<key>.json`, using the skeleton the worksheet prints.

Five rules, all enforced mechanically in the next step:

1. **Every field needs a verbatim quote** — a span you can find by searching the worksheet, not
   a summary of one. A field you cannot quote is **omitted, not guessed**. Omitting is the
   normal outcome for most fields on most documents.
2. **The quote must STATE the value.** This is a separate check from the one above and it is the
   one that catches a figure recalled rather than read: a real sentence with a fabricated number
   attached, or the same digits at the wrong scale (`0.6` cited from „…60 %…"). The gate parses
   the numbers out of your quote and compares. For `beneficiaries`, the extracted phrase must
   appear in its own quote.
3. **Quote the sentence, not the number.** Under 12 characters is rejected outright.
4. **Every `_eur` field needs a quote that is in EURO.** See the table above: this will usually
   mean omitting the budget. A quote naming *no* currency is accepted but **flagged** — it is
   where a lev figure most easily slips through on this corpus.
5. **`audience`** is derived from the eligibility text, so it is dropped if `beneficiaries` is.
   The worksheet prints the allowed values; they come from `AUDIENCES` in
   `scripts/opencalls/types.ts`.

### 4. Gate and store

```bash
npm run opencalls:enrich-review              # gate every proposal, print the queue
npm run opencalls:enrich-review -- --apply   # … and store the survivors at enrichment='auto'
```

`scripts/opencalls/enrich_gate.ts` re-checks both halves: the quote is a plain
whitespace-normalised substring of the document text, **and** the quote states the value. A field
that fails either is **dropped and reported** — this is the mechanical half of
`project_ai_chat_grounding_gate`, and the guarantee comes from the check, not from trusting the
model. What neither half can do is judge whether the quoted sentence is the *right* one: a
sub-component's „максимален размер" cited against the whole procedure's budget is a real number,
correctly attributed, and still wrong. That is what step 5 is for.

**A proposal where nothing survives is left at `enrichment='none'`** — it stays in the queue. The
queue *is* `'none'`, so writing `'auto'` on an empty extraction would retire the procedure for
ever with no value stored and no path back. Two proposals are also refused before the gate: one
whose JSON does not parse (reported, the rest of the queue still runs), and one whose
`source_key` disagrees with its filename — which would otherwise apply this document's figures to
a *different* procedure, with every quote still grounded.

**`--apply` still publishes no number.** Per invariant 8, `enrichment='auto'` may write the
verbatim eligibility text and the provenance blob (`{model, extracted_at, doc_url, quotes,
values, rejected}`) and nothing else. The four money columns stay NULL, enforced by 142's
`open_calls_money_needs_provenance` CHECK. `audience` is also held back — ИСУН rows already
carry one derived from the title at crawl time, and overwriting a source-derived facet value
with an unreviewed inference would be a downgrade disguised as an enrichment.

### 5. Human sign-off

```bash
npm run opencalls:enrich-review -- --promote <source_key>
```

Prints the proposed values with their quotes, then promotes that ONE row to
`enrichment='reviewed'`, which is what lets a figure into `budget_eur` & co. — and therefore
into sorting, range filters and the tile's „€X общ бюджет".

**A person must read the quotes before running this.** There is deliberately no
`--promote-all`: a flag that signs off fifty-five rows at once is not a human gate, and the
whole point of Stage 7 is that a figure reaches the site because someone read its evidence.

Promotion **re-runs the value check** against the quote stored beside each figure, because the
meta is not a trusted store — it can be hand-edited and it can predate a change to the gate. A
value with no stored quote is refused here even though it survived at `--apply` time.

Promoting a row whose only surviving field is the eligibility text is fine and common — it
records „I read it, the document states no figures" and stops the row cycling through the queue
for ever. The command says so rather than claiming columns went live.

**To put a row back in the queue** (a re-issued document, a bad extraction), reset it — there is
no command for this because it should be rare and deliberate:

```sql
UPDATE open_calls SET enrichment = 'none', enrichment_meta = '{}'::jsonb
 WHERE source = 'isun' AND source_key = '<key>';
```

Note this does **not** clear `beneficiaries_raw`; the loader treats that column as
fill-never-blank, so clear it in the same statement if the old text was wrong.

### 6. Publish

Nothing here reaches prod on its own:

```bash
npm run db:load:open-calls:pg:cloud
```

But note the loader ships `data/opencalls/*.json`, and **enrichment lives only in Postgres** —
it is not in those snapshots. So enrichment done locally does not travel. Enrich against the
database you intend to serve, or re-run the skill against Cloud SQL:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npm run opencalls:enrich -- --list
```

## The one rule that must not bend

**Never relax a check to make an extraction pass.** If a real quote fails, the normaliser is
wrong and the normaliser is what changes — not the threshold, and never the direction of the
comparison. `scripts/opencalls/enrich_gate.test.ts` is adversarial on purpose and every check in
it has been mutation-tested: deliberately breaking any one of the six guarantees turns it red.

## What this skill does NOT do

- **It does not crawl.** New procedures arrive via `update-open-calls`. Run that first.
- **It does not convert currencies.** A lev figure is not a euro figure, and the conversion
  would be a number the document does not state.
- **It does not touch `sp2023` (ДФЗ) rows.** Their indicative windows carry no per-procedure
  document to read.
- **It does not run unattended.** If you find yourself wanting to loop it over all 55
  procedures and promote the results, re-read the table at the top: the gate would reject
  nearly every budget anyway, and the ones it accepted would be the ones nobody checked.
