---
name: person-compare-post
description: Draft a Наясно social post comparing TWO people's declared assets side by side — a versus card listing bank accounts, property, vehicles, investments, debts and income from the SAME year on the SAME declaration form, with the basis named. Resolves both people, proves the comparison is legitimate through the comparability gate, and hands off to naiasno-post for composition and saving. Use when the user asks to compare two officials / MPs / magistrates / mayors, "X срещу Y", "кой е по-богат", "сравни декларациите на …", or turns a declared-wealth finding about two named people into a shareable card.
allowed-tools:
  - Read
  - Grep
  - Glob
  - AskUserQuestion
  - Bash
  - Write
  - WebSearch
  - WebFetch
---

# Наясно — two-person declaration comparison

Two people, one card, one year, one form. This skill owns the *comparability*
half: resolving both people, proving the pairing is honest, and reading every
figure off the right filing. Composition, the duplicate check, public-source
confirmation and saving the draft belong to **`naiasno-post`** — invoke it at
Step 5 and do not duplicate its rules here.

Plan and measurements: `docs/plans/person-compare-post-v1.md`.

## The one thing to internalise

**A declaration is not a wealth statement. It is one of two different forms, and
the site publishes both.** Measured over all 61,743 filings:

| type | filings | avg real-estate rows | % carrying an income table |
|---|---:|---:|---:|
| `Annualy` | 44,615 | 1.41 | **93.3%** |
| `Entry` | 5,654 | 6.27 | **0%** |
| `Vacate` | 5,484 | 6.38 | **0%** |
| `Other` | 5,990 | 0.00 | 0% |

`Entry`/`Vacate` are a full estate INVENTORY with no income table at all.
`Annualy` is an income statement with a much thinner property table. Pairing one
against the other prints „17 имота срещу 0" and „66 015 € заплата срещу —" —
both artifacts of the form, neither a fact about the people.

**You do not enforce this by hand. The gate does.** Your job is to run it, read
what it refused, and write copy that matches what it allowed.

---

## Step 1 — Resolve both people

Everything keys on a `person` slug. The gate accepts a slug or a name, matches
on every name token (so „Иван Демерджиев" finds „Иван Петев Демерджиев"), and
**refuses an ambiguous name rather than guessing**:

```bash
PGPASSFILE=$PWD/.pgpass node_modules/.bin/tsx scripts/person/compare_declarations.ts \
  --a mp-5254 --b mp-5104 --out /tmp/cmp.json
```

Expect to need slugs. Two-part Bulgarian names are ambiguous far more often than
they look — „Бойко Рашков" matches three active public figures, because the
patronymic makes „Бойко Рашков Божанов" a different man. The refusal exits **2**
and lists the candidates with their slugs:

```
"Бойко Рашков" matches 2 people — pass a slug:
  mp-5254  Бойко Илиев Рашков
  boiko-rashkov-bozhanov-79f4fd  Бойко Рашков Божанов
```

Two different men: the patronymic is what separates them. MPs have stable
`mp-<id>` slugs; everyone else has a name-derived one.

**Never resolve an ambiguous name yourself by picking the famous one.** That is
how a card gets built about a stranger who shares a name, and it is the failure
this repo treats most seriously. Put the candidate list to the user with
`AskUserQuestion` and let them choose, or add the middle name and re-run.

Very common names stay ambiguous no matter what — „Георги Георгиев" matches 412
active public figures and the list truncates at 25. Ask the user for the middle
name, or for the person's `/persons` page, and take the slug from its URL.

**Scope is any public figure in the identity layer** — MPs, ministers,
magistrates, mayors, councillors. The serving functions gate on
`status = 'active' AND is_public_figure`, so a person the site does not publish
cannot be compared here either.

## Step 1b — Pick the axis

Two ways to pair two people, and the choice is editorial:

| axis | flag | what it asks |
|---|---|---|
| **year-matched** (default) | — | what did these two lives look like at the SAME moment |
| **role-matched** | `--same-role` | what does the estate of whoever holds THIS post look like |

Year-matching is right for two people compared as contemporaries. **Role-matching is the
only way to compare two holders of the same office**, because they usually never held it in
the same year — Рашков was interior minister in 2021 and Демерджиев in 2022, so the default
axis can never show them both in the job, and would instead pair Рашков's МП filing against
Демерджиев's ministerial one.

```bash
PGPASSFILE=$PWD/.pgpass node_modules/.bin/tsx scripts/person/compare_declarations.ts \
  --a mp-5254 --b mp-5104 --same-role --out /tmp/cmp.json
```

On that axis the year gap is the SUBJECT, not a confound, so the card names the office in
its header and dates each side in its own badge. `--same-role` cannot be combined with
`--year` or `--class` — it takes each side's year from that person's time in the office.

**The offices must match on the filing's own words.** Abbreviations are not expanded, so
„МВР" and „Министерство на вътрешните работи" do NOT match and the gate refuses rather than
guessing. It also reads one representative filing per (person, year, form class), so a
second filing that year under a different office is invisible to it. Both are under-matching
— a refusal you can see, never a wrong pairing.

**It needs `filed_position`, which is now filled for the whole corpus** (61,740 of 61,743 as
of 2026-08-17; the three exceptions are filings whose `<Position>` the register itself leaves
empty). So this refusal should be rare — but it is what a fresh clone hits before any
backfill has run, and the refusal names the exact command per person:

```bash
npx tsx scripts/declarations/backfill_filed_position.ts --slug <slug> --apply
```

### What the copy must say on a role-matched card

- **Name both years.** „Рашков през 2021 г., Демерджиев през 2022 г." — the two figures are
  from different years by design, and a reader who sees only the text must not read them as
  contemporaneous.
- **Name the office**, because that is the comparison. „Двама вътрешни министри" is the post;
  „Рашков срещу Демерджиев" is not.
- **Do not narrate the gap as a trend.** Two holders of one post at two dates is not a time
  series, and „разходите на поста растат" is a claim two points cannot support.

## Step 2 — Run the gate and read what it decided

Exit codes: **0** = comparable, **2** = not comparable (or a flag was misused),
**1** = the tool broke. Exit 2 is a normal outcome and its message is the story
of why — read it rather than working around it.

The gate picks the **newest (year, form class) both people can speak to**.
`annual` breaks a tie WITHIN a year; it never outranks a newer year.

```
dropped for unpriced rows: real_estate (mp-5254 19/24), vehicle (mp-5254 2/3) — total excludes …
gate: 2023 / inventory  (NOT the latest year for both — the card says so)
  mp-5254  активи 503 311 € · задължения 0 € · нетно 503 311 €
  mp-5104  активи 627 496 € · задължения 332 304 € · нетно 295 192 €
```

⚠️ **Those stderr figures are the WHOLE FILING, and they are NOT what the card
prints. Never write body copy from them.** They exist so you can see how much a
drop removed. Whenever anything was dropped the two diverge, and on this very
pair they reverse the story:

| | stderr (whole filing) | the card (comparable positions) |
|---|---:|---:|
| Рашков | нетно 503 311 € | **449 216 €** |
| Демерджиев | нетно 295 192 € | **119 887 €** |

Read the totals out of `card.versus.left.total` / `.right.total` in the JSON —
that is the number the reader sees. Body copy quoting 295 192 € beside an image
saying 119 887 € is the contradiction this whole skill exists to prevent.

`--year` / `--class` force a different pair when the newest one is not the
story; `--total assets|net` picks which figure heads the card. On the role axis the header
names the office instead of a year and each badge carries its own — including when the two
years coincide, which happens and is still a role-matched card.

**`--max-unvalued-pct` exists and you should almost never pass it.** It is the
threshold above which an unpriced table is dropped (default 20). Setting it to
`100` disables the drop entirely and republishes exactly the phantom gaps
described below — only ever use it to *inspect* what is being excluded, never
for a spec you intend to publish.

**Both bases are always printed, because the ranking flips between them.** On
the fixture pair above, ASSETS say Демерджиев leads (627 496 € vs 503 311 €) and
NET says Рашков does (503 311 € vs 295 192 €), the difference being 332 304 € of
declared debt. Whoever "wins" is chosen by the basis — so the card names it and
your copy must not quietly pick the flattering one.

## Step 3 — Read the refusals as facts, not obstacles

Every refusal below is a finding in its own right, and often the better post.

| the gate says | what it means | what you may write |
|---|---|---|
| `no common (year, form class)` | the two never filed the same form for one period | nothing comparative — say so, or pick a different pair |
| `dropped for unpriced rows: real_estate …` | that table was filed with no prices | „N от имотите са декларирани без цена" is itself publishable |
| `the debt table is substantially unpriced` | a net total would be a ceiling over an unknown liability | re-run `--total assets`, and say the debts are not fully priced |
| `every candidate metric was dropped` | nothing comparable survives | do not post this pair |
| `a chosen filing is too thin to compare` | one side's filing states a fraction of what that person declared nearby, and omits a money category their other filings carry | pick another year or office — the gap you would publish is an artifact of the filing |
| `declares a negative total for …` | a parse anomaly | inspect the filing; do not publish |

**Same form class is NOT the same thing as comparable, and this is the trap that got a card
published.** Демерджиев's fiscal-2022 annual and Рашков's fiscal-2021 annual are the same
form, both filed as interior minister — and the first states ONE row (31 404 € cash, no bank
at all) while the same man's filing six months later states 452 192 € including 160 755 € of
bank. A card built from it published a 13x gap that is an artifact of a near-empty filing.
The gate now refuses that pair; `--allow-thin` overrides it, and you should only reach for
that having read both filings.

**„Unpriced" is not „cheap", and this is the trap the corpus sets most often.**
Рашков's 2023 встъпителна lists 24 properties of which **19 carry no declared
price**, so that table sums to 409 € against Демерджиев's fully-priced
175 305 €. Rendered as money that is a 428× gap which does not exist. It is
systematic: **22.9%** of filings with a real-estate table have at least one
unpriced row and **7.8%** are entirely unpriced, against ~1% for bank, vehicle
and investment.

## Step 4 — Understand the card before you write copy

The gate emits a ready `card` spec (a `versus` key → `renderVersusCard`). Read
`/tmp/cmp.json` and note four things your copy must respect:

- **`versus.left.total` / `versus.right.total`** — the two figures the reader
  actually sees, and the only ones your copy may quote. Their `label` says what
  they are; „(сравними позиции)" on it means a category was dropped and the
  total is over what survived.

- **The form badge under each name** („годишна декларация" / „встъпителна
  декларация" / „декларация при напускане"). It is the most load-bearing word on
  the card, because it says what the numbers below it can mean.
- **`basis`** — what the total is, plus any category excluded from it and why.
  Two different exclusions exist and they are not the same claim:
  „Извън сумата: … — подадени без посочена цена" (money nobody stated) versus
  „В сумата, но не като отделен ред: …" (money that is known and counted but
  cannot be a comparable row on this form).
- **`yearNote`** — present whenever the chosen year is not the latest for both.
  Do not write „последните декларации" when this is set.
- **`properties`** (inventory cards only) — a COUNT of declared properties by
  kind, e.g. „24 · 6 апартамента · 6 други имота · 4 търговски обекта". It is
  there because the money for that table is often withheld while the count is
  perfectly well known, so it survives the drop that removes the euros.

**Two things the property count is not.** It is a count of declared ROWS, not of
buildings — a declarant may file one house as four entries (dwelling, terrace,
basement, garage) and the register carries nothing that would fold them back
together, so write „24 декларирани имота", never „24 сгради". And it is never
money: „24" beside „449 216 €" must not be written as if the properties were
valued, because the whole reason the band exists is that they were not.

**The row set is class-dependent and you may not widen it.** `имоти` exists only
on an `inventory` card (on an annual, „0 имота" is a coin flip — 50.7% of people
who filed both forms for one period show zero property on the annual and real
property on the inventory). `доход` exists only on an `annual` card (no
inventory filing in the corpus carries an income table). The renderer throws
rather than warns on either.

## Step 5 — Hand off to `naiasno-post`

Invoke `naiasno-post` with the gate's output. It owns the duplicate check
(`post_tool.ts check`), public-source confirmation, BG/EN copy, `post_tool.ts
save` and the review step.

**The card spec is the ONE thing that does not transfer.** `naiasno-post` says
"default to the infographic (bar) card" — that instruction is for its own posts
and does **not** apply here. A comparison post always renders `renderVersusCard`
via the `versus` key the gate emitted. Say so explicitly when handing off, or
the bar-card default wins and you publish a chart of two numbers instead of a
comparison.

Deep link: `/person/<slug>` for either person. Sources: the `gate.sourceUrls`
entries are direct `register.cacbg.bg` filing URLs, which satisfies
`naiasno-post`'s rule 2 exactly rather than by web search.

### Copy rules specific to this post kind

This is the highest-stakes card the repo produces — two named living people,
compared on money. On top of `naiasno-post`'s rules:

- **„Декларирано", never „притежава".** Every figure is what the person filed,
  not what they own. The card says so; the copy must too.
- **No verdict verbs.** Not „забогатя", „укри", „скри", „източи". State the two
  numbers, the year and the form. The number is the point.
- **Never compute a difference the card does not show.** „X пъти по-богат" over
  a total that excludes an unpriced table is a claim about data nobody has.
- **Name the year and the form in the body**, not only on the card — a reader
  who sees only the text must not think it is this year's position.
- **If the gate dropped anything, the copy says so.** Publishing the surviving
  rows without the caveat is the same omission the gate exists to prevent.

## Regression gates

- `scripts/db/tests/person_compare.data.test.ts` — the comparability rules,
  PG-backed, including that on a pair with no dropped metric the published total
  equals the declared net. (With a drop it is deliberately lower — that is what
  „сравними позиции" means, and why the copy must quote the card.)
- `scripts/posts/cardKit.test.ts` — the renderer's refusals (class rules, the
  shared metric set, the row budget, the property band's inventory-only and
  symmetry rules).
- `scripts/person/propertyKind.test.ts` — the property fold, including the head-
  noun rule and the ancillary-space carve-out.

Both run under `npm run test:data` / `npm run test:unit` and skip when Postgres
is down.
