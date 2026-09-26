# Person identity join — first measurement, 2026-09-27

Plan: `docs/plans/news-person-sentiment-v1.md` §3.1–3.2. Code:
`news/scripts/person_identity_join.py`. Reproduce with

```bash
python3 news/scripts/person_identity_join.py --report
```

Corpus: every Jev sentiment sidecar on disk whose article is in the published
app-data bundles; a pair is one primary or secondary person subject that Jev
scored. **20,073 eligible pairs.** Gazetteer rebuilt the same day with the §3.0
display fields.

## Result, per step

| step | pairs | people |
| --- | ---: | ---: |
| 1 exact (`entity_links`) | 2,783 | 227 |
| 2 context (office or party cue, both within 100 characters of the name) | 110 | 9 |
| 3 surname alias | 0 | 0 |
| 4 registry (`np_*`) | 67 | 1 |
| **linked** | **2,960** | **237** |

Refused: `no_match` 16,396 · `ambiguous` 698 · `not_a_person` 19. Merged 0,
conflict 0 — both appear only once surname aliases exist, because the
duplicates are full-name plus surname pairs.

**Against the plan's prediction** (§3.2: 3,200–3,600 linked pairs after steps
2–3): step 2 alone adds 110, below the „roughly half of 818" guess, and step 3
adds nothing until the surname list is reviewed. Expected from the plan's own
measurement: roughly 200 pairs once Радев, Йотова, Гюров, Борисов, Кандев,
Пеевски and Волгин are reviewed.

## A defect found while measuring, and fixed before commit

The first cut let context disambiguation run on ONE-word names too. It linked
„Терзиев" to **Людмил Аспарухов Терзиев**, a mayor elsewhere, on the office cue
„кметът", in articles about Васил Терзиев, the mayor of Sofia. A surname's
candidate list holds only the gazetteer's public figures, so the person the
article means may not be on it at all, and a cue that fits the wrong one
produces a confident wrong link. Step 2 now requires two or more words; a
bare surname links only through a reviewed alias. Test:
`test_a_one_word_name_never_resolves_by_context`.

## Review fixes that moved the numbers

Code review of the first cut found three more ways a link got through that the
rules should refuse, all fixed with tests: the party cue had no proximity
window (a ГЕРБ link anywhere in the article vouched for any ГЕРБ candidate —
„Димитър Николов" fell from 19 to 13 pairs); an office word matched as a bare
substring, so „евродепутат" cued an MP, „заместник-министър" a minister and
„районен кмет" a mayor; and an undated article applied a surname alias
whatever its validity window. The context step went from 131 pairs / 11 people
to **110 / 9**.

## The context links, for the hand audit

Measured on the first cut, before the one-word restriction and the review
fixes; the one-word rows no longer link, and the counts above are current.

| pairs | surface | linked to | cue |
| ---: | --- | --- | --- |
| 55 | Николай Найденов | Николай Симеонов Найденов | office (cabinet) |
| 29 | Йотова | Илияна Малинова Йотова | *one word — now refused* |
| 21 | Георги Янев | Георги Богданов Янев | office (regional governor) |
| 19 | Димитър Николов | Димитър Стойков Николов | party (gerb) |
| 8 | Георги Димов | Георги Николаев Димов | party / office |
| 8 | Георги Илиев | Георги Петков Илиев | office (mp) |
| 8 | Димитър Стоянов | Димитър Желязков Стоянов | office |
| 5 | Огнян Атанасов | Огнян Огнянов Атанасов | office (councillor/mayor) |
| 3 | Владимир Николов | Владимир Милчев Николов | office (mp) |
| 3 | Терзиев | Людмил Аспарухов Терзиев | *one word — now refused (wrong)* |
| 2 | Гюров | Андрей Атанасов Гюров | *one word — now refused* |
| 2 | Тодор Иванов | Тодор Динков Иванов | office |
| 1 | Божин Божинов · Божанов · Кънев · Димитър Здравков | … | … |

Read by hand for „Георги Илиев": the links fall on the articles calling him
„депутатът" / „народният представител" and NOT on the footballer, the VIS
boss or the police inspector sharing the name — the window rule doing its job.

„Огнян Атанасов" was checked by hand because the news registry records three
people of that name (the Petrohan case): all five linked pairs sit next to
„кметът на Община Кюстендил" and are the Kyustendil mayor the gazetteer names —
correct, and the reason the office cue must be local.

## Not done here — the precision audit

§3.2 asks for a 100-pair hand audit of steps 2–3 at precision ≥ 0.98 before
`NEWS_PERSON_RAIL` goes on. It needs a human; it runs in the review workspace
(`npm run news:review`), which samples context-basis links into the
Самоличност queue beside the two-part-only people.
