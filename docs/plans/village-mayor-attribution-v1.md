# Village mayors (кметове на кметства) — attribution, place and declarations — v1

Triggered by `/person/rosen-rusev-a0a8lm` (Росен Господинов Русев, кмет на кметство с. Безмер,
общ. Тунджа): the profile labels his seat **"Тунджа"**, shows **no declaration**, and is missing
his **2019 term** — which our data currently awards to a different man.

Follow-on to `local-person-links-v2.md`. That plan's Tier A1/A2 are now green locally (verified
below); **A3 is still open and interacts with Tier 1 here**. This plan closes v2's open question
**B3** with evidence, and adds three defects v2 did not identify.

Everything below was measured against local docker Postgres and the committed
`raw_data/` HTML/CSV caches on **2026-08-01**. Cloud SQL was NOT inspected.

---

## Status — T0, T1 and T2 are DONE locally (2026-08-03)

Landed as `2e2a8d7314` (T0), `0b23cccc19` (T1 tooling), `4554cf2235` (T2), and the data run.
Measured after the run, on local Postgres only — **Cloud SQL is untouched**, and the sequence
at the end of this file is what carries it there.

| | before | after |
|---|---|---|
| Бяла (обл. Русе) office-holders, 2019 + 2023 | 0 | **40** (2 mayors, 34 councillors, 14 village mayors) |
| VAR05 village mayors, 2023 | 12 (3 Varna + 9 Ruse) | 3 |
| kmetstva carrying a runoff result | 2 | **892** (451 + 441) |
| village mayors placed in their own village | 0 | **10,552 / 10,721** (98.4%) |
| Росен Русев | one term, "Тунджа" | two terms, "с. Безмер", same slug |

265 slug locks purged and 12 rekeyed (`raw_data/person/kmetstvo_flips_2026_08.json`). Two
people disappear entirely — Мариян Георгиев (lost Босилковци 164–167) and Емил Георгиев (lost
Копривец 242–251) — because we had published each as кмет on the strength of a round-1 lead
they lost. Their `/person` URLs 404; a redirect would name a different human.

**T4a** landed as `8edb344c6b`.

**T3 is DONE** (`f9abf7c403` code, `d9558cae9c` data). The 2007 archive publishes two page
families that disagree on the winner in 54% of кметства; the ОИК's own decision pages settle it
883 to 2 for the EKATTE-keyed one, and the round-2 pairing agrees 897 to 1. 5,367 entries folded
to **2,947** seats — 2,420 phantom roles gone, 1,243 runoffs ingested, 0 duplicates. 112 people
whose duplicate record collapsed now 301 to their surviving slug.

**T5 is PART-DONE** (`6e1767ae2a`): `electionId 76` is in `ERIK_ELECTIONS`, flags verified
against the live register. The INGEST is not built and is bigger than first estimated — 30,177
ОИК-level registrations, and a per-ОИК reconciliation key the parliamentary scraper does not
have (see §T5).

**T4b is RUN, and the answer is don't build it**: no open-data shortcut (0 municipal ЗПК
datasets on data.egov.bg against 7 central ones), and three probed municipalities have three
different register shapes with the values locked in per-person PDFs (see §T4b).

Still open: **T5's ingest**, the optional council-register link table (§T4b), and v2's **A3**.

## 0. Findings, mapped to tiers

| # | Finding | Severity | Tier |
|---|---|---|---|
| F0 | **Общ. Бяла (обл. Русе, RSE04) is absent from the 2019 and 2023 cycles.** `resolveByName` matches on município NAME only, ignoring the oblast the page carries, so both "Бяла" pages resolve to VAR05 (Варна). The collision merge keeps the first bundle's mayor/council and **discards the second's**, grafting only its kmetstva. | A whole município missing; 14 village mayors filed under the wrong oblast | **T0** |
| F1 | Kметство **runoff winners are never ingested** → the round-1 vote leader is published as the seat holder at `confidence='high'`. **267 measured wrong village mayors** (2023: 137, 2019: 130). | Wrong named person on a public page | **T1** |
| F2 | Correcting F1 makes flipped seats' mentions change person — and `chooseStableSlug` would hand the **new winner the loser's `/person` URL**. Verified on the Безмер locks. | Would create a worse defect than it fixes | **T1 guard** |
| F3 | All **10,721** `village_mayor` roles carry `place_kind='obshtina'`, so every village mayor's seat renders as their община. `place_dim` already has the settlements (97.0% resolvable). | Wrong granularity, sitewide | **T2** |
| F4 | 2007 stores every runoff кметство **twice** (2,395 duplicate-name entries; 1,243 round-2-only), so the resolver mints a role for **both** the round-1 leader and the round-2 winner. | Phantom officeholders | **T3** |
| F5 | Кметове на кметства **do not file** in the central register at all — confirmed, not an ingest gap. Closes v2 §B3. | Needs an honest UI, not a scraper | **T4** |
| F6 | The SPA has the same round-1 fallback (`LocalElectionScreen.tsx:525`), so `/local/**` displays the wrong кмет for the same seats. Fixed by T1's re-parse, no code change. | Same defect, second surface | rides T1 |

Not defects, recorded so they are not re-investigated: Русев has **no** TR company, **no** NGO board
seat, **no** procurement/ИСУН/ДФЗ link, **no** parliamentary candidacy, **no** ЕРИК donor row, and a
clean single-alias identity. His page is thin because his record genuinely is.

---

## T0 — The município-name collision (found while auditing T1; blocks T2)

### Evidence

[parse_local_elections.ts:170](../../scripts/parsers_local/parse_local_elections.ts:170) resolves a
CIK page to an obshtina by **name alone**:

```ts
const match = MUNICIPALITIES.find((m) => normName(m.name) === target);
```

`parsed.oblastName` is available on the same object and is not consulted. `data/municipalities.json`
has **three** duplicate names, and `.find()` takes the first:

```
бяла    → VAR05 (idx 37, Варна)  |  RSE04 (idx 38, Русе)   ← LIVE collision
искър   → PVN23 (idx 95, Плевен) |  S2414 (idx 229, София-Искър)   ← latent
средец  → BGS06 (idx 216, Бургас)|  S2401 (idx 232, София-Средец)  ← latent
```

Искър/Средец are latent only because the Sofia районни are fanned out from the `SOF` bundle and
never arrive as their own tur1 page — a catalogue reorder would make them live.

On collision, [parse_local_elections.ts:318](../../scripts/parsers_local/parse_local_elections.ts:318)
appends `kmetstva` + `districts` to the existing bundle and **silently drops** the second bundle's
`mayor`, `council`, `protocol` and `oikCode`.

Measured, both cycles:

```
raw_data/2023_10_29_mi/html/tur1/1804.html → "Бяла | Русе": 7 mayor candidates, 8 council parties, 9 kmetstva
data/2023_10_29_mi/municipalities/RSE04.json                → does not exist
data/2023_10_29_mi/municipalities/VAR05.json → 12 kmetstva = 3 Варна + 9 Русе, mayor = Пеньо Ненов (Варна)
2019: VAR05 → 6 kmetstva = 1 Варна + 5 Русе;  RSE04.json does not exist
```

RSE04 has local roles in 2007 (mayor + 17 councillors + 18 village mayors), 2015 and one chmi — and
**none in 2019 or 2023**. 2007 is unaffected because `ingest_mi2007.ts` uses
`resolveByOblastName(obshtinaName, oblastName)`: **the fix pattern already exists in this repo.**

User-visible today: общ. Бяла (Русе) — ~9,700 residents — has no mayor race, no council and no
councillor `/person` pages for the last two cycles, while 14 of its village mayors are published as
office-holders in обл. Варна.

### Fix

1. `resolveByName` takes the oblast as a tiebreak (mirror `resolveByOblastName`); fall back to
   name-only when the page carries no oblast, so nothing that resolves today stops resolving.
2. Make the collision **loud**: an obshtinaCode already claimed by a different oikCode must warn
   with both names + oblasts, not merge silently. A same-oikCode append (the legitimate
   Plovdiv/Varna район case) stays quiet.
3. Add a `parse_local_elections` unit test over the three duplicate names.
4. Gate: bundle count per cycle must equal resolvable tur1 pages (2023: 265 pages → 265 non-Sofia
   bundles, not 264).

### T0 ↔ T1/T2 ordering (this is why it blocks)

- **Re-splitting VAR05 changes its kmetstvo indices** (12 → 3), so every `…:VAR05:kmetstvo:<i>` ref
  moves and the 9 Ruse seats get brand-new `…:RSE04:kmetstvo:<i>` refs. That is the one place where
  T1's "refs are stable" does **not** hold, and those mentions need the same slug-lock purge.
- **T2 must not ship first.** Those 9 villages are not in VAR05, so settlement resolution fails and
  they keep the obshtina place — i.e. they would be published as seats in Бяла, **Варна** with the
  new, more confident-looking place badge. (They are exactly 5 of the unresolvable names measured in
  T2's coverage: Полско Косово, Лом Черковна, Босилковци, Копривец, Дряновец.)

---

## T1 — Ingest the кметство runoff (the wrong-person defect)

### Evidence

`pickLocalWinner` ([localPersonRefs.ts:25](../../scripts/parsers_local/localPersonRefs.ts:25)) uses
`round2` when present, else the round-1 pool. ЦИК marks **both** runoff finalists `isElected` in
round 1, so with no `round2` it silently returns the round-1 vote leader.

Measured across all cycles: **`round2` is populated on 2 of 10,721** kmetstvo entries (both in
`2026_06_14_chmi`). It works everywhere else — 113 обшtina mayors and 31 районни in 2023 alone — so
only the кметство arm is dark.

**The code to fix it already exists and works.** `mergeKmetstvoRounds`
([build_municipality_json.ts:100](../../scripts/parsers_local/build_municipality_json.ts:100),
commit `4713907651`, 2026-06-30) is wired, and
[parse_local_elections.ts:312](../../scripts/parsers_local/parse_local_elections.ts:312) passes
`tur2` into the builder. Run against the **cached** HTML it produces the right answer:

```
raw_data/2023_10_29_mi/html/tur2/2825.html (Тунджа) → 7 kmetstva runoffs parsed
  Ботево: round2 [Танев 239, Йовчева 242] → elected = Татяна Димитрова Йовчева
stored data/2023_10_29_mi/municipalities/JAM25.json → kmetstva keys: [kmetstvoName, ekatte, candidates]
  (no `round2`, no `elected` — the bundles predate the fix)
person_role 2023_10_29_mi:JAM25:kmetstvo:1 → Георги Иванов Танев   ← the loser
```

Cross-checked against a **second, independent source** for Безмер 2019 — the ЦИК round-2 CSV
`raw_data/2019_10_27_mi/ТУР2/КК/votes_03.11.2019.txt`, unit `3229`, sections `282500002/3`:
ИК Русев **291**, ВМРО Стоянов **263**. The tur2 HTML agrees exactly. We publish Стоянов.

### Scale (measured by re-parsing every OIK offline)

| cycle | kmetstvo seats | runoff seats merged | **winner flips** | OIKs missing a tur2 page |
|---|---:|---:|---:|---:|
| 2023_10_29_mi | 3,032 | 451 | **137** (30.4%) | 0 |
| 2019_10_27_mi | 1,966 | 441 | **130** (29.5%) | 0 |

2007 is excluded here — different failure, see T3. Of the 2,165 ambiguous seats corpus-wide
(≥2 round-1 `isElected`, no `round2`), 1,248 are 2007, 451 are 2023, 441 are 2019 and **25** are
chmi partials.

### Ref stability + re-parse fidelity — measured across every OIK

`kmetstvoRef` keys on the array index, so a re-parse that reordered or re-counted entries would move
every ref. It does not. Fresh tur1 parse compared against the stored bundle for **all 264
non-Sofia OIKs × 2 cycles**, on kmetstvo name order, per-candidate names/votes/`isElected`, and the
resulting winner:

```
2023_10_29_mi: oiks=264  orderMismatch=0  candidateDrift=0  winnerDrift=0  countMismatch=1 (0305)
2019_10_27_mi: oiks=264  orderMismatch=0  candidateDrift=0  winnerDrift=0  countMismatch=1 (0305)
```

So the re-parse is a **pure addition** of `round2`/`elected`; refs are stable and only the *winner
behind a ref* changes. The single count mismatch is not drift — it is the Бяла collision (T0), and
it is the one município where refs **do** move.

Precondition verified: both cycles have their `ТУР1/ОС` council CSV in `raw_data/`, so the section
augmentation still runs and council vote share is not blanked by the re-parse (the 2015 all-zero
failure mode).

**The flip file must be emitted from the BUILT BUNDLES, not per OIK page.** A ref is
`<cycle>:<obshtinaCode>:kmetstvo:<index-in-bundle>`; for a collided município the page index and the
bundle index differ. Emitting per page would purge the wrong `person_slug_lock` rows.

Do **not** switch the ref to `ekatte` (which `kmetstvoRef` supports) as part of this. The
index key was chosen deliberately — `local_person_roles.data.test.ts` records that a name-keyed ref
"collided two different winners onto one mention id" — and changing it would churn all 10,721 refs.

### F2 — the slug-lock trap (must land in the same change)

`chooseStableSlug` ([slugLock.ts](../../scripts/person/slugLock.ts)) reuses the persisted slug of a
person's **oldest** member mention; ties break **alphabetically by slug**. The two Безмер locks:

```
local:2019_10_27_mi:JAM25:kmetstvo:16 → ivan-stoyanov-1xhzvh   first_seen 2026-08-01 02:35:04.280028
local:2023_10_29_mi:JAM25:kmetstvo:0  → rosen-rusev-a0a8lm     first_seen 2026-08-01 02:35:04.280028
```

Identical `first_seen` (all 10,767 village/район locks share one seeding timestamp), and
`ivan-stoyanov-1xhzvh < rosen-rusev-a0a8lm`. So after the corrected 2019 mention joins Русев's
cluster he would be served at **`/person/ivan-stoyanov-1xhzvh`**, with `rosen-rusev-a0a8lm` retired
and 301'd into it. Every one of the 267 flips has this shape.

**Mitigation — targeted lock purge, before the resolve:**

1. Compute the flip set (ref → old winner, new winner) during the re-parse and write it to
   `raw_data/person/kmetstvo_flips_2026_08.json` (auditable, committed).
2. `DELETE FROM person_slug_lock WHERE mention_id = ANY($flipped_mention_ids)` — only those refs.
   The new winner then takes their natural name-hash slug; the loser's slug orphans and the
   existing `person_slug_retired` machinery 301s it, which is correct (he is no longer that seat).
3. Re-run `db:resolve:persons`, then `collapseSlugRedirectChains` runs itself (documented in
   CLAUDE.md), so no chain repair is needed.

Do this as a one-off script under `scripts/person/`, gated behind a flag per
[[feedback_one_off_backfills]] (`--from-flips <file>`), not folded into the resolver.

### T1 interaction with v2 §A3 (open)

**751 (name, obshtina, role) groups still span multiple person records**, of which 294 are
`village_mayor`. For village mayors specifically, cross-cycle same-name-same-obshtina groups merge
**1,653 of 1,840 (90%)**. So Русев's restored 2019 role will *probably* fold into person 47037 —
but 1 in 10 will instead mint a second person for the same man. Verify his case explicitly
(query below); do not assume. A3's continuity rule remains the real fix and stays in v2.

### T1 steps

1. `npm run data -- --local --local-date 2023_10_29_mi` (offline; re-reads `raw_data/*/html/`).
   Then `2019_10_27_mi`. Then the chmi cycles that have a tur2 page.
2. **Review the diff before accepting it.** The re-parse rewrites bundles + `index.json` +
   `_unmatched_coalitions.json` + region rollups + demographics + chmi history + `officials_diff`
   (latest cycle only). Assert the delta is confined to `kmetstva[].round2 / .elected` and their
   downstream rollups; anything else means the parser has drifted since the data was built.
3. Emit the flip file + purge the flipped locks (F2).
4. `npm run db:resolve:persons` → `npm run data:local-person-refresh` (re-stamps `personSlug`,
   which the re-parse wipes) → `db:load:person-elections:pg` → `db:load:persons-browse:pg` →
   `db:load:person-search:pg`.
5. Gates (new, in `scripts/db/tests/local_person_roles.data.test.ts`):
   - every kmetstvo entry with ≥2 round-1 `isElected` and a tur2 page **has** `round2`;
   - no `village_mayor` role whose ref's bundle entry carries a `round2` disagreeing with it;
   - `person_slug_lock` has no mention_id in the flip file still pointing at the old slug.

---

## T2 — Give the village mayor their village

### Evidence

[resolve_persons.ts:945](../../scripts/person/resolve_persons.ts:945) stamps
`obshtinaPlaceFor(d.obshtinaCode)` on mayor, councillor **and** village-mayor mentions alike, so the
кметство is dropped at the source. `082_person_api.sql:60` then joins `place_dim` and prints the
община.

`place_dim` (117) already carries `kind='settlement'` — 5,366 rows with `name_bg`, `settlement_type`
(`с.`/`гр.`), `obshtina_code`, `oblast_code`, `loc`. Resolving `(obshtinaCode, lower(kmetstvoName))`
against it covers **10,397 / 10,721 = 97.0%** (2023 2,989/3,032; 2019 1,922/1,966; 2007 5,165/5,367).
That beats the SPA's own `data/local_mayors/kmetstvo_to_ekatte.json` (95.6%, and built only from the
2023 cycle) — so **resolve against `place_dim`, not that file**. Only 7 (obshtina, name) pairs are
ambiguous within an obshtina; skip those to the obshtina fallback rather than guessing.

Unresolved names (multiword: "Хаджи Димитрово", "Гара Елин Пелин") keep today's obshtina place — a
strict widening, nothing regresses.

### Changes

1. **115** — widen the CHECK: `place_kind IN ('mir','obshtina','judicial','settlement')`.
   115 is in `resolve_persons`' `SCHEMA_FILES`, so it ships with the resolve. Its guarded
   `DROP COLUMN place` block is already a no-op on a migrated DB.
2. **resolver** — a `settlementPlaceFor(obshtinaCode, kmetstvoName)` sibling of `obshtinaPlaceFor`,
   backed by a `place_dim` lookup map loaded once, falling back to `obshtinaPlaceFor`. Village
   mayors only; `rayon_mayor` keeps its obshtina (районите are not settlements).
3. **082** — for `kind='settlement'` render `settlement_type || ' ' || name_bg` ("с. Безмер").
   Do **not** change `place_dim.name_bg` — `/procurement/by-settlement` and 123 read it.
4. **120** — copy the same label expression **verbatim** (the file says so, and the browser and the
   profile must not print different names for one seat), and add the missing arm:
   ```sql
   WHEN pl.place_kind = 'settlement' THEN pd.obshtina_code
   ```
   Without it, `?obshtina` (`PersonsBrowserScreen.tsx:143` → `obshtina_code`) silently stops
   matching 10.7k people. `oblast_code`/`oblast_codes` already read `place_dim.oblast_code` and are
   safe. **NB: 120 has staged uncommitted changes (tier1 S3a name-fold arm) — rebase onto those.**
5. `person_search.place_label` reads `person_browse_table.place_label`, so it follows for free —
   but `db:load:person-search:pg` must re-run.

### Knock-ons to accept deliberately

- `PersonProfileScreen` dedupes offices on `(role, placeCode)`. Today a man who was village mayor of
  two different villages in one obshtina shows **one** row; after T2 he shows two. That is the
  correct reading, and same-village-across-cycles still collapses to one.
- Consequence for Русев: his restored 2019 term and his 2023 term collapse into a single
  "Кмет на кметство · с. Безмер" row, because local roles carry no dates. The two-term story needs
  v2 §B2 (`person_local_elections`); note it there rather than special-casing here.
- `emit_prerender_slugs.ts:326` joins `place_dim` generically → village-mayor cards gain the village
  name automatically. Re-mint the manifest (`person:slugs:cloud`) after.
- `102_municipal_officials.sql` and `load_official_candidate_links_pg.ts` filter
  `source='official_muni'`, so they are untouched. Verified.

---

## T3 — 2007's duplicated кметства

2007 does not share the HTML path;
[ingest_mi2007.ts:278](../../scripts/parsers_local/ingest_mi2007.ts:278) **replaces** `candidates`
with the round-2 table and never sets `round2`/`elected`. Worse, the same кметство arrives from two different
round-1 pages:

```
2007: 5,367 kmetstvo entries, 2,395 duplicate-name entries
      round-sets: {1}: 4,124   {2}: 1,243        (2019/2023: 0 duplicates)
BGS04 "Банево" ← results_1/02/20400002.html (5 rows, no r2)
              ← results_1/02/20402573.html (10 rows, r2 exists → stored as 2 round-2 rows)
```

So one village yields **two** `village_mayor` roles — the round-1 leader *and* the round-2 winner —
plus the round-1/round-2 vote totals disagree in a way page-duplication alone does not explain
(Банево R1 188/174 vs R2 310/390).

### Diagnosis (2026-08-03) — DONE, and it turns T3 into a decision

The 2007 archive publishes each кметство under **two page families**, and the ingest walks both:

| | file key | heading | round tabs | pages |
|---|---|---|---|---|
| **A** | `<oik><sequence>` (`20400002`) | "Окончателни резултати **по решение на ОИК**" | no | 2,465 |
| **B** | `<oik><EKATTE>` (`20402573`) | "Окончателни резултати" | **І тур / ІІ тур** | 2,906 |

Both breadcrumbs read "Община Бургас, кметство Банево" and both parse to the same
`(obshtinaName, placeName)`, so `ensureBundle` files them as two entries of one município —
that is the duplication. 2,354 of 3,013 кметства carry one of each.

**They are not two views of one result.** Measured across every 2007 page:

```
places with both families: 2,354   same elected winner: 1,087   DIFFERENT winner: 1,267 (54%)

Банско|Филипово   ОИК=Кезим Мустафа Ходжа (183)   vs  plain=Ариф Кадри Туталъ (173)
Белица|Дагоново   ОИК=Али Хюсеин Барабунов (219)  vs  plain=Страхил Атанасов Барабунов (448)
Белица|Черешово   ОИК=Алиш Исмаил Куньов (104)    vs  plain=Алиш Исмаилов Куньов (126)
```

The last row is the informative one: the same man under two spellings with two vote counts,
which reads like two STAGES of one contest rather than two contests.

### Adjudicated (2026-08-03) — family B wins, 883 to 2

A web search for one of the disputed villages surfaced `mi2007.cik.bg/results1/07/dec_os_0712.html`
— *"Решение на общинската избирателна комисия за избиране на кмет…"*. The 2007 archive publishes
the commission's OWN DECISIONS as `dec_*.html`, and **we already hold 2,906 of them** in
`results_1/*/dec_kk_*.html`. They state the outcome in words, so they settle it outright:

```
dec_kk_20402573.html  (кметство Банево, община Бургас)
  "Общинската избирателна комисия … РЕШИ: Допуска до участие във втори тур:
   Ваньо Янев Иванов … Манчо Танев Дончев"

family B (20402573) elected pair: Иванов + Дончев   ✅ matches the decision
family A (20400002) elected pair: Господинова + Иванов   ❌
```

Two independent adjudications across the whole corpus agree:

| adjudicator | family A ("по решение на ОИК") | family B (EKATTE, tabbed) |
|---|---:|---:|
| **ОИК decision text** (998 places carrying both + a decision) | **2** | **883** (106 agree, 7 neither) |
| **Round-2 pairing** (1,007 places with a runoff page) | **1** | **897** (109 both/neither) |

Whoever actually contested the runoff must be the two the round-1 page flagged as advancing, and
the commission's decision names them. Family B is right on both counts.

**So the merge rule is now specified, and it is not "drop family A":**

```
кметство places: 3,013   both families: 2,354   B only: 552   A only: 107
```

Prefer family B wherever it exists; fall back to family A **only** for the 107 places B does not
cover. Never emit both — that is the duplication. Expect ~2,300 phantom roles to disappear and
the ~1,267 disagreements to resolve to B's winner.

What family A actually is remains unidentified — its pages carry their own protocol code
(`oik_kk_020400002` vs `oik_kk_020402573`) and a different candidate set (5 names vs 10 for
Банево), so it is not an amended view of the same race. It does not need identifying to apply
the rule, but it does mean the 107 A-only places should be spot-checked against their own
decision pages before they are trusted.

Steps: diagnose the two page families → merge to one entry per (obshtina, place) carrying
`round1` + `round2` + `elected` → re-run `--local-ingest mi2007` (the raw ZIPs are already extracted,
`ensureExtracted` reuses them) → expect ~1,243 phantom roles to disappear. Treat every removed role
as a slug retirement and run the same lock purge as T1.

Lower priority than T1/T2: 2007 is 19 years old and no one's current office depends on it. But it is
**24% of all village_mayor roles**, so it distorts any "how many terms" or continuity metric that
v2 §B2 would build on.

---

## T4 — Declarations: say the true thing (closes v2 §B3)

**Village mayors are not in the central register.** Evidence, stronger than v2's open question:

- `register.cacbg.bg/2025/list.xml` (4.8 MB, 95 categories, 15,935 `<Position>` entries) contains
  the substring **"кметств" zero times**, and "кметски наместник" zero times.
- The municipal category is verbatim *"Кметове, и зам.-кметове на общини, кметовете и зам.-кметовете
  на райони, председателите на общинските съвети, общинските съветници и гл. архитекти на общините и
  районите"* — ЗПК чл. 6 (**висша** публична длъжност). Кметовете на кметства are not on that list.
- Our corpus mirrors it exactly: `declaration` tier `muni` = 6,388 rows over five titles only
  (Общински съветник 4,827 / Заместник кмет 694 / Кмет 305 ≈ 265 общини + 35 района / Главен
  архитект 300 / Председател на ОбС 262).

They file with their own общински съвет's standing commission; each municipality publishes its own
register (e.g. `tundzha.bg/zpkonpi/registri-i-deklaratsii-po-zpkonpi/`).

**T4a (do now, cheap).** `/person` must distinguish *"this office is outside the central register"*
from *"this person did not file"*. Today they render identically, which reads as an accusation.
Drive it off the role, not off the missing row: `village_mayor` (and any future non-чл.6 office) →
"не подлежи на деклариране в централния регистър". Mirror it in the `/persons` "с декларация" facet
copy so the KPI is not read as compliance.

**T4b (research spike, timeboxed).** Size a municipal-register ingest: 265 sites, no common schema,
no register API, no `data.egov.bg` dataset, values often in scanned PDFs. Probe 5 municipalities
(Тунджа + 4 of differing platform: egov.bg portal, WordPress, custom) and report format, per-year
coverage and whether values are machine-readable **before** committing to anything. Do not start a
crawler on the strength of one site.

### Spike result (2026-08-03) — RUN. Recommendation: do not build the corpus

Addressable set, for scale: **3,029 village mayors** of the current 2023-2027 mandate, across
**252 общини**. (The 10,721 `village_mayor` roles span five cycles; only the sitting mandate
has a live filing duty.)

**There is no open-data shortcut.** The obvious hope was чл. 56's publication requirement
landing on `data.egov.bg`, which would turn 252 scrapes into one API loop. It does not:
sweeping `listDatasets` over org ids 1–300 finds ЗПК/anti-corruption datasets at exactly
**seven central bodies** (orgs 33, 50, 67, 69, 82, 98, 99 — e.g. "Регистър на декларациите по
ЗПК") and, across the 80 publishers in the municipal range 121–300, **zero**.

**And the registers do not share a shape.** Three municipalities, three different structures:

| | platform | shape | village mayors? |
|---|---|---|---|
| **Русе** (`obs.ruse-bg.eu`) | WordPress, ОБЩИНСКИ СЪВЕТ site | HTML table: name + settlement as text, one PDF per person | yes — 14, mandate 2023-2027 |
| **Кюстендил** (`kyustendil.bg`) | Joomla | the register is itself a DOWNLOADABLE FILE, not a page | yes — "ПР на Кметове на кметства … чл. 49, ал. 1, т. 1" |
| **Златица** (`zlatitsa.egov.bg`) | egov.bg portal | ZIP / 7z / RAR archives plus loose PDF / DOCX, 2018–2026 | not on that page |

Note the first column: Русе publishes on the **общински съвет's** site, not the община's, which
is the legally correct place (чл. 49 → постоянната комисия на съвета) and means a crawler
keyed on `<obshtina>.bg` would miss it.

**Two tiers, and only one of them is cheap.**

- **Who filed** — name + settlement + filing date. Русе's table is exactly this, and its
  (name, settlement) pair joins straight onto the settlement places §T2 just gave every
  village mayor. But Кюстендил's is a file and Златица's is an archive, so it is still a
  bespoke parser per município, not one parser × 252.
- **What they declared** — the values live inside the per-person PDFs, and nowhere as text on
  any of the three pages. That is the НЗОК-scan problem at 252× with no shared template, and
  it is what a "declarations corpus" would actually mean.

**Recommendation: do not build it.** The cost is ~252 bespoke parsers for tier one and an OCR
programme for tier two, against 3,029 people whose filings are already public where they sit.
§T4a already stops the page from reading as an accusation, which was the actual harm.

**The cheap thing that IS worth doing** (not in this plan's scope, sized here so the option is
on record): a curated `<obshtina> → council register URL` table — one hand-checked link per
município, no parsing, nothing to go stale except the URL — so a village mayor's profile can
say "declarations are filed with Общински съвет Русе" and link there. 252 links, and the
reader lands on the authoritative source instead of on our copy of it.

---

## T5 (optional) — ЕРИК for local elections

`ERIK_ELECTIONS` ([erik_config.ts](../../scripts/smetna_palata/erik_config.ts)) held **only three
parliamentary elections** (2026_04_19, 2024_10_27, 2024_06_09) — matching the 1,283 `donor`
roles, split 791/252/240 — when this was written. МИ 2023 was added in this pass, as the fourth
and last entry. Русев won Безмер twice as an **инициативен комитет**, and ИК campaign financing
is exactly what ЕРИК holds.

### Probe result (2026-08-03) — YES, and it is `electionId=76`

Confirmed against the live register through the repo's own `erik_client`:

```
/Reports/GetParticipantsByElectionId  electionId=76
  commissionType 1 →    67 participants, registered 05.09.2023 … 13.09.2023
  commissionType 3 → 2000+ participants, registered 10.09.2023 … 25.09.2023   (hit my page cap)
  kinds: Партия 1,510 · Коалиция 412 · ИНИЦИАТИВЕН КОМИТЕТ 104 · Местна коалиция 41
```

Registration numbers carry the election code directly — `2219-МИ/05.09.2023` for 76, against
`4520-НС/02.03.2026` for the known id 93 — so the МИ/НС/ЕП family is unambiguous. Neighbours
worth having: **77** (`2961-МИ/02.02.2024`) and **78** (`2941-МИ/18.01.2024`) are МИ partials,
**79** (`3121-ЕП/19.04.2024`) is the European Parliament.

### Wired as far as it honestly goes (2026-08-03)

`electionId: 76` is now in `ERIK_ELECTIONS` as `2023_10_29_mi`, `isOldSystem: true`. The
INGEST is not built, and the earlier "config addition plus a scraper run" estimate was wrong —
two measured facts separate a local cycle from a parliamentary one:

- **Scale.** `electionCommissionType` 1 returns 67 national registrations (58 партии, 9
  коалиции), which is parliamentary-sized. Type 3 — the ОИК level, where the инициативни
  комитети live — returns **30,177**. The scraper fetches per-participant sub-pages on top of
  that, against a WAF that 403s bursts.
- **Keying.** `scrape_erik` reconciles participants against `data/<election>/cik_parties.json`,
  a parliamentary artifact of ~28 nationally numbered parties. A local cycle has no such file,
  and a местна коалиция registered in one община is a different registration from the
  same-named one next door — the party list it needs is per-ОИК, a key the scraper lacks.

What makes it worth building anyway: ЕРИК records each инициативен комитет under the
CANDIDATE'S OWN NAME (`8-МИ/10.09.2023 — Димитър Венков Стефанов`), which is the vehicle Росен
Русев was elected under both times and the only money signal that exists for a village mayor.

Two practical notes for whoever picks it up. The WAF 403s a cold deep link and throttles
bursts, so warm `/` (and the `/Reports?electionId=<id>` page) first and pace the calls — a 403
means rate-limited, NOT "no such election"; id 80, which is known-good, 403'd mid-sweep. And
`ERIK_ELECTIONS` maps an id to an election FOLDER name, so an МИ cycle needs a folder
convention (`2023_10_29_mi`) that the parliamentary-shaped scraper does not currently assume.

---

## Sequencing

1. **T0** — oblast-aware resolution + a loud collision. Small, self-contained, and it must precede
   the re-parse so VAR05/RSE04 split in the same pass that adds `round2`.
2. **T1** — re-parse 2023 + 2019 (+ chmi), diff-review, flip file (bundle-keyed, incl. the moved
   VAR05→RSE04 refs), lock purge, resolve, gates. Fixes 267 named people and the `/local/**`
   display at the same time.
3. **T2** — the settlement place. Must not precede T0 (it would publish 9 Ruse villages as Varna
   seats with a confident badge); shares T1's resolve.
4. **T4a** — the declaration copy. No data dependency; can land any time.
5. **T3** — 2007, after its diagnosis.
6. **T4b / T5** — research spikes, report before building.

T0 + T1 + T2 should ship as **one** re-parse and **one** resolve. v2's **A3** should follow, not
precede: it merges people, and merging on top of corrected winners is cheaper than merging the wrong
ones first.

## Cloud sequence (nothing here is automatic)

```bash
npm run person:kmetstvo-flips:cloud -- --emit   # review the diff BEFORE the resolve…
npm run person:kmetstvo-flips:cloud -- --apply  # …then rekey/purge the locks
npm run db:resolve:persons:cloud              # applies 115 (widened CHECK) + 082, rebuilds person_role
npm run db:load:declarations:pg:cloud -- --resolve
npm run db:load:official-candidate-links:pg:cloud
npm run db:load:person-elections:pg:cloud     # person_id is re-minted every resolve (v2 A1)
npm run db:load:persons-browse:pg:cloud       # applies 120 (settlement arm + label)
npm run db:load:person-search:pg:cloud        # place_label rides person_browse_table
npm run db:load:graph:pg:cloud                # ← DO NOT SKIP: see below
npm run person:slugs:cloud                    # re-mint the committed prerender manifest
```

**`db:load:graph:pg` is the one this plan originally left out, and it is the most damaging
omission of the set.** The three `graph_*` tables persist a `person_id`, which
`resolve_persons` re-mints on every run (v2 §A1's class), so a resolve without it leaves the
graph naming the WRONG PEOPLE — measured on this very run before it was caught: **67,890 of
68,891** `graph_person_node` rows disagreed with `person` for the same id, i.e. 98.5% of
`/connections` was mis-attributed while every count still reconciled. `graph.data.test.ts`
catches it; nothing else does.

The flips step is FIRST on purpose. It compares the fresh bundles against the still-old
`person_role`, which only exists in the window between the re-parse and the resolve.

The 082 label change alone can ship without a resolve:
```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 082_person_api.sql
```
— but it prints settlement labels only for rows a resolve has already re-placed, so it is only
useful as a follow-up fix, never as the whole T2.

## Verification queries

```sql
-- T0: Бяла (Русе) must have 2019 + 2023 roles again (today: rows only for 2007/2015/one chmi)
SELECT split_part(ref,':',1) AS cycle, role, count(*)
  FROM person_role WHERE source='local' AND ref LIKE '%:RSE04:%' GROUP BY 1,2 ORDER BY 1,2;

-- T0: VAR05 must hold ONLY Бяла-Варна's seats (2023: 3 kmetstva, not 12)
SELECT count(*) FROM person_role
 WHERE source='local' AND role='village_mayor' AND ref LIKE '2023_10_29_mi:VAR05:%';

-- T1: the case that started this — must be Росен Господинов Русев, and the SAME person_id as 2023
SELECT r.ref, p.person_id, p.display_name, p.slug
  FROM person_role r JOIN person p USING (person_id)
 WHERE r.ref IN ('2019_10_27_mi:JAM25:kmetstvo:16','2023_10_29_mi:JAM25:kmetstvo:0');

-- T1: his slug must NOT have become ivan-stoyanov-1xhzvh
SELECT slug FROM person WHERE person_id = (
  SELECT person_id FROM person_role WHERE ref = '2023_10_29_mi:JAM25:kmetstvo:0');

-- T2: no village mayor left on an obshtina place where place_dim has the settlement
SELECT count(*) FROM person_role WHERE role = 'village_mayor' AND place_kind = 'obshtina';
-- expect ≈324 (the 3.0% unresolvable), not 10,721

-- T2: the ?obshtina filter must not have lost anyone
SELECT count(*) FROM person_browse_table WHERE place_kind = 'settlement' AND obshtina_code IS NULL;
-- must be 0

-- T3: 2007 duplicate кметства
SELECT count(*) FROM (
  SELECT split_part(ref,':',2) ob, count(*) n FROM person_role
   WHERE role='village_mayor' AND ref LIKE '2007%' GROUP BY 1) x;

-- v2 A3 regression guard (was 751 on 2026-08-01)
SELECT count(*) FROM (
  SELECT translit_bg_latin(p.display_name), split_part(r.ref,':',2), r.role
    FROM person_role r JOIN person p USING (person_id) WHERE r.source='local'
   GROUP BY 1,2,3 HAVING count(DISTINCT r.person_id) > 1) x;
```

## Risks

- **The re-parse is not surgical.** It rewrites every artifact of the cycle. Step T1.2's diff review
  is the control. The 264-OIK fidelity audit above says today's parser reproduces the stored bundles
  byte-for-byte on every field it was checked against, so the review is a confirmation, not a
  gamble — but re-run it rather than trusting this note.
- **T0 moves refs where T1 does not.** Splitting VAR05 renumbers its kmetstvo indices and mints new
  RSE04 refs, so that município's mentions need the lock purge too, and Бяла-Варна's own three
  village mayors change index. Everywhere else refs are stable.
- **Every flip is a slug retirement.** The 301 machinery handles it, but the committed
  `data/person/prerender_slugs.json` must be re-minted from the **serving** database
  (`person:slugs:cloud`) — `emit_prerender_slugs.ts` refuses to write from local docker.
- **A resolve on Cloud SQL is multi-hour.** Batch T1 + T2 into one.
- **Landing T2 without 120's settlement arm** silently empties `?obshtina` for 10.7k people —
  green everywhere, wrong on one filter. It is the single easiest thing to forget here.
