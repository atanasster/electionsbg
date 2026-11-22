# ДС / COMDOS — full-corpus ingest of the Комисия по досиетата decisions (v1)

Status: **research done 2026-11-22, nothing built.** The figures below were measured over a
scratch crawl (1,933 of 1,983 decision documents) and are the baseline any implementation
must reproduce.

## 1. Why

`data/person/ds.json` is a hand-curated register of **15 entries, all from one decision**
(№ 14/04.09.2007, the 7th ВНС–40th НС). `person_role` holds 12 `ds` rows. The Commission
has published **1,983 decisions** naming **~9,700 distinct people** (name + birth date) across
local government, business, courts, media, parties, candidate lists, diplomacy and
government. The `comdos_ds` watcher says "the register is manual" and that there is "no
bulk export". Both claims are out of date: the decision archive is crawlable, and every
decision document uses the same field layout, which can be parsed by machine.

## 2. The datasets

| # | dataset | URL shape | volume | format |
| - | ------- | --------- | ------ | ------ |
| D1 | Decision index | `/Начало/Архив_Решения/p/page/N` (N = 1..100; requests past the last page return the last page) | 1,983 rows, DecisionID 181–2201, № 1/24.04.2007 → № 3-250/18.11.2026 | HTML |
| D2 | Decision page | `/Начало/Decision-View/p/view?DecisionID=N` | 1 per decision | HTML (first person inline, plus a link to the full document) |
| D3 | Decision document | `/media/Решения/…` or `/media/stories/reshenia/…` | 1,933 fetched | `.doc` (most), `.pdf`, `.docx`; convert with `textutil -convert txt` / `pdftotext` |
| D4 | „Проверени лица" search | `/Начало/Проверени_лица/p/search/?ApprovedPersonFirstName=…&ApprovedPersonMidName=…&ApprovedPersonLastName=…&ApprovedPersonBirthDate=…&ApprovedPersonBirthLocation=…&ExaminationPersonPosition=…&search=Търсене&page=N` | 14 rows/page | HTML |
| D5 | Reports to the НС | `/Доклади_пред_Народното_събрание` | 39 semiannual reports; 2007–2011 summary at `/media/Dokladi/obob6teni-danni--102-1.pdf` | №37 is `.doc` (appendix: "Проверени: N лица. Обявени: M лица" per decision); №39 (2026) is an image-only PDF |

The site is reachable from BG residential egress, with no Cloudflare. It is an old PHP app, so crawl it
politely: 4 workers was fine.

### Crawler quirks (each one cost a re-run)

- **A decision page can link more than one document.** Four candidate-list pages also link
  a PREVIOUS decision, and taking the first link gave 50th/51st/52nd НС identical data.
  Choose the link whose filename contains the decision's own number (`/<no>[-._ ]`), and
  exclude `/Opisi` links.
- **HTML entities in hrefs** (`&ndash;`, `&sect;`) must be unescaped. 12 documents returned
  404 without this.
- **Hrefs with leading whitespace** (`href=" /media/…"`) are missed by a naive regex; 57
  documents, including the whole 49th НС candidate list. Use `href="\s*(/media/[^"]+\.(?:docx?|pdf|rtf))\s*"`.
- **One document is really gone**: DecisionID 934 (община Сливен, № 2-706) returns 404.
  That leaves 50 decisions with no document; their page shows only the first person.

## 3. Parse rules (the document layout has not changed since 2007)

- Split on „Три имена"; cut off the signature at `\n\s*Председател\s*:`.
- Fields per person: Дата на раждане, Място на раждане, Вербувал го/я служител (+ year),
  Ръководил го служител, Структури, Качеството, Псевдоними, Документи…, Публична длъжност
  или публична дейност. For candidates there is also a line „Кандидат за народен
  представител в N МИР – X, издигнат от <party>".
- `Качеството` → category, in this priority order: щатен служител, резидент, съдържател на
  явочна квартира, осведомител, доверено лице, секретен сътрудник – агент, сътрудник.
- „Комисията разполага с данни … след 10.11.1989" → `activity_after_1989 = true`.
- Section of the decision:
  - „Установява и обявява" → a new finding;
  - „чл. 29, ал. 6 … вече е обявена принадлежност" → a re-disclosure, whose block cites the
    prior decision;
  - „чл. 28" → additional documents only.
- Header: „общо N лица. Проверени са M лица". The deceased are COUNTED and not published:
  „на N … лица, данните за които не подлежат на публикуване" (чл. 30, ал. 1, т. 1).
- ⚠ The party regex must stop at the next section marker, or the party absorbs
  „На основание чл. 29, ал. 6 …" text (seen on the 44th, 48th and 52nd НС).
- ⚠ Year: take it from the decision DATE in the title. Taking the first 4-digit run picks up
  the decision number (`2-1997` → 1997).

Baseline the parser must reproduce:
- 1,933 decisions parsed → 15,892 records → **9,689 people** (by name + DOB);
- 1,004 re-disclosure records;
- 328,042 persons checked; 3,796 deceased not published.

## 4. Data protection and defamation rules (non-negotiable)

1. **D4 returns everybody who was checked, including „Неустановена принадлежност".** That is
   personal data about people with NO finding. Ingest only established persons; use D4 for
   aggregate counts only and store no non-established row.
2. **Name ≠ identity.** The person layer's existing rule stands: attach a `ds` role only
   through a stable disambiguator plus an EXACT birth-date match. The decision gives a
   birth date and birth place for every person, which is why this works at all.
   - `mp_profile` has `birth_date` for 2,121 of 2,122 MPs.
   - Measured join: **110 announced people match an MP on exact name + DOB, 0 ambiguous.**
   - `person.birth_date` is always NULL, so other tiers (candidates, councillors, mayors)
     have NO DOB to match against. Those matches are leads for review, never an attach.
3. Deceased persons are not published by the Commission, and we must never try to recover them.
4. Pseudonyms, recruiters and handlers are named in the source. Store them for provenance
   but do not render recruiter/handler names: they are third parties who were not the
   subject of the decision.

## 5. Proposed shape

- `scripts/comdos/crawl.ts` — D1 + D2 + D3 into gitignored `raw_data/comdos/` (resumable,
  the link-selection rules from §2). Watcher upgrade: `comdos_ds` fingerprints D1 page 1's
  DecisionID set, which it nearly does already.
- `scripts/comdos/parse.ts` — writes the COMMITTED `data/comdos/decisions.json` and a
  `persons.jsonl`. The source is public and permanent, so committing it gives a fresh clone
  a pure-load path (the `clean_delivery` precedent).
- Migration `ds_decision` / `ds_announcement` + `db:load:ds:pg` (stage-merge, upsert-only:
  a decision is a permanent public record). Re-disclosures keep their prior-decision link.
- Resolver: replace `ds.json`'s hand list with `ds_announcement` ⨝ `mp_profile` on
  (fold(name), birth_date). Keep the 3 held entries' manual hold list. The
  `update-persons` skill gains a step.
- Aggregate serving function for a `/data/ds` page: checks, announced, hit rate by sector
  and by election, category mix, recruitment years. No per-person listing beyond what the
  person layer already attaches under rule 2.

## 6. Open questions

- Sector classification is a title regex today (13 buckets, ~18% "other"). A curated
  title→sector table is cheap (1,983 rows) and would be honest; a regex is not.
- `mp_profile.ns_folders` covers the 39th НС onward with partial seat counts (124 of 240 for
  the 39th). The 7th ВНС–38th НС, where most of decision № 14's 139 MPs sat, are
  not in `mp_profile` at all, so the MP join UNDER-counts the 1990s.
- D5 report №39 needs OCR if its period totals are wanted.
