# INSAIT gap — entity aliases, ЗДОИ platform, named appropriations (v1)

Status: Phases 1–3 built (2026-11-24); Phase 4 blocked on the registry and on `tr-gfo-ingest-v1.md`. Written 2026-11-24.

Trigger: a reader asked the chat „INSAIT“ (`/chat?q=INSAIT`) and pointed at
<https://pitay.government.bg/application/8905/view> — a ЗДОИ answer from МОН (13.12.2023) stating
that the 2024 budget carries **100M лв for INSAIT's AI computing centre, and 100M лв more in each
of 2025 and 2026**. Nothing in our answer showed that money.

## 1. What was measured

All figures are local Postgres, 2026-11-24, unless stated.

### 1.1 Procurement is NOT the gap

| query | rows | € |
| --- | --- | --- |
| `contracts` (`tag='contract'`), title ~ INSAIT/ИНСАИТ | 7 | 5,728,982 |
| same, title ~ „компютърните науки" without the acronym | 1 | 49,805 (2023, acronym „ИНИОКН") |
| `tenders`, subject ~ INSAIT/ИНСАИТ/„компютърните науки" | 9 | — |

So the corpus holds ~€5.8M of INSAIT procurement against the ~€153M МОН's answer states (3 × 100M лв) plus
the ПМС 56/2021 grant (~166M лв over ten years; €7.3M announced again for 2027). The difference
is money that never passed through ЗОП, and we ingest none of the sources that record it.

### 1.2 Identity — the chat cannot tell INSAIT from „insight"

Live on naiasno.bg:

- `q=INSAIT` → the 7 contracts + 8 tenders, **plus two unrelated firms** (ДАТА ИНСАИТ И БИЗНЕС
  203637591, ИНСАИТ ИН 131231159 — "insight" spellings).
- `q=ИНСАЙТ` → **none** of the INSAIT data (`translit_bg_latin('ИНСАЙТ') = 'insayt'` ≠ `insait`),
  ~20 unrelated "insight" firms, a 2013 Plovdiv hospital contract, two ДФЗ recipients in Стара
  Загора (€826K + €725K).
- `q=„всички данни за INSAIT, ИНСАЙТ"` → the union: the real data plus all of the noise. A reader
  can take €1.5M of farm subsidies for INSAIT money.
- The INSAIT foundation — **Фондация „ИНСАЙТ изследвания и образование", ЕИК 207211849**, in
  `tr_companies` — never appears: under `INSAIT` it fails the whole-word check, under `ИНСАЙТ` it
  is cut off by the 20-row organisation cap (`LIMIT` in `ai/tools/mentions.ts`), which is filled
  alphabetically by noise first.

Loosening the fold (Й≡И) is wrong: „ИНСАЙТ" is the ordinary Bulgarian word for "insight", so it
widens the noise rather than the entity. INSAIT is a unit of Sofia University (ЕИК 000670680) with
no ЕИК of its own; name matching cannot be its identity ([[name-match-not-identity]]).

### 1.3 Money sources we do not hold

| source | what it says about INSAIT | held? |
| --- | --- | --- |
| ЗДБРБ named items | a web summary cited a 2024 line of 100,000 хил. лв („Ciela item №133"); **not confirmed** — the DV text of the 2024 law has no INSAIT line and no named-project annex. What the laws DO print (measured 2026-11-24, see §4): Приложение № 2 към чл. 110 — 2025: NP-25.001-0048, 3 800,0 хил. лв; 2026: NP-25.002-0048, 3 500,0 хил. евро (+3 500,0 / 4 000,0 forecast for 2027/2028) | no — `budget_program_fact` has 3 МОН programme totals per year; `investment_program` is 2025 municipal Приложение III only |
| ПМС / РМС for additional spending | ПМС 56/18.02.2021 (founding grant) and later transfers to МОН | no |
| МОН programme execution report; СУ's own budget report | what was actually transferred / spent | no |
| Foundation ГФО (НПО form) | donations, conditional financing | no — `tr-gfo-ingest-v1.md` tier 7; FY2024/2025 not in the TR feed as of 2026-11-21 |
| pitay.government.bg (ЗДОИ) | 6 INSAIT requests: #8905, #8904 (answered), #8740, #8751 (МОН, „Непроизнесени в срок"), #15319 → #15452 (МИР/ИСУН automation with INSAIT, forwarded to АМС, granted) | no — not referenced anywhere in the repo |

Contracts with Sofia University as SUPPLIER to МИР/АМС: none, so the ИСУН automation work is
presumably a cooperation agreement outside ЗОП.

## 2. Phase 1 — curated entity aliases (built)

Makes the chat answer correct for every spelling, with no new source.

- `ai/tools/entityAliases.ts` (committed, hand-curated, deliberately small). The INSAIT entry:
  - `triggers` — what a reader may type, compared word for word after romanizing: INSAIT,
    ИНСАЙТ (ИНСАИТ romanizes the same as INSAIT), ИНИОКН, and the two full Bulgarian names;
  - `searchTerms` — what is sent to the search routes: INSAIT, ИНИОКН, „изследвания в областта
    на компютърните науки". „ИНСАЙТ" is a trigger only; searching it returns only "insight" firms;
  - `matchTerms` — a record belongs to INSAIT when its text names one of these;
  - `parent` — Sofia University, ЕИК 000670680, matched on the buyer NAME („Софийски
    университет"), because `procurement-search` returns no buyer ЕИК;
  - `organisations` — the foundation, ЕИК 207211849, shown by verified ЕИК;
  - `excludeEiks` — ДАТА ИНСАИТ И БИЗНЕС (203637591), ИНСАИТ ИН (131231159), named in the
    „similar names, not included" line.
- `ai/tools/mentions.ts` resolves the spellings against the table first (`resolveAliases`).
  For a resolved entity:
  - contracts, tenders, КЗК appeal subjects, EU-funds and Interreg titles count only when
    they name the institute AND the parent is the buyer / beneficiary / partner
    (`aliasMentioned` with a buyer);
  - firms, subsidy recipients and fund beneficiaries NEVER match on the name — the entity
    contributes only its verified ЕИКs; the excluded ЕИКs are dropped in every section;
  - votes and funding calls, which only mention a subject, may match by name.
- Independent of aliases: the companies resource is fetched at its `maxPageSize` (50) and
  capped to 20 AFTER the word check, so look-alikes sorted earlier by name cannot crowd out
  a real match.
- Tests: `ai/tools/mentions.alias.test.ts` — the three live queries give the same answer;
  noise reachable through the INSAIT-needle searches (an unlisted „ИНСАИТ …" firm, a farm
  recipient, an excluded firm's EU project, an Interreg title under another partner) stays
  out; and a mutation check that removing the entry brings the „ИНСАЙТ" look-alikes back.
- Rule for adding an entry (also in the file header): an organisation with no ЕИК of its own,
  a verified parent ЕИК, every organisation ЕИК checked against the registry by hand. Never
  inferred.

## 3. Phase 2 — ingest the ЗДОИ platform (1–2 days)

pitay.government.bg is „Платформа за достъп до обществена информация", the government's ЗДОИ
portal. Probed 2026-11-24:

- server-rendered HTML, no API; ids sequential, newest ~22,945 (`/application/<id>/view`);
- listing `/application` with filters `text`, `search`, `status`, `category`, `period`,
  `subjects`; ~2,209 pages;
- Atom feed `/applications.rss` („Нови и обновени заявления") — the watcher hook.

Plan:

- `scripts/zdoi/fetch_pitay.ts` — crawl ids 1..max into a gitignored raw store
  (`raw_data/zdoi/pitay.sqlite`), polite rate, resumable, `--from-id/--to-id` for backfill
  ([[one-off-backfills]]). Re-fetch rows whose status is not final (status moves).
- Parse per request: reg. №, obliged body, submitted date, deadline, status, subject text, decision
  date, decision text, forwarding chain (forwarded-to body + new reg. №), history events.
- **Privacy rule:** store the requester ONLY as the type the platform prints („Физическо лице" /
  „Юридическо лице"). Never store a name, address or e-mail, even if one appears. Decision text is
  stored but rendered as an excerpt with a link out, never republished whole.
- Migration `zdoi_request` (+ `zdoi_event`), FTS over subject + decision on the same fold the other
  search arms use, `db:load:zdoi:pg` + `:cloud` twin, stage-merge, `recent_updates` wiring
  ([[pg-changelog-required]]). Upsert-only: a request is a public record.
- Watcher `zdoi_pitay` on the RSS feed; skill `update-zdoi`.
- Mentions tool: a new „Заявления по ЗДОИ" arm. Label every hit as the institution's own answer —
  numbers in a decision are claims, not data we have verified, and are never extracted into a
  figure.
- Free by-product: per-institution response stats (share „Непроизнесени в срок", median days to
  decision). Only publish over bodies with enough requests to be meaningful.

Open question: the platform carries only requests filed THROUGH it; ministries also take requests
by e-mail and post. Every surface must say „заявления, подадени през ПДОИ", never „all ЗДОИ
requests".

## 4. Phase 3 — named appropriations and spending decrees (several days)

This is where the INSAIT money is, and it generalises to every targeted state transfer.

- **ЗДБРБ named lines — BUILT (2026-11-24) as migration 208 + `db:load:budget-named:pg`.** The
  named projects live in „Приложение № 2 към чл. 110" — the programme of priority strategic
  investment projects with national financing — which only the 2025 and 2026 laws carry (none of
  2018–2024 has it). Parsed from the cached DV HTML: 2025 → 404 projects (176 in раздел I, €1.50bn
  appropriated; 228 in the раздел II reserve list, €1.95bn indicative), 2026 → 199 (€1.44bn, plus
  forecasts for 2027–2028). Every amount carries its kind (`appropriation` / `forecast` /
  `indicative`), and the loader refuses on any unreadable row or numbering gap. The INSAIT lines
  are NP-25.001-0048 (2025, 3 800,0 хил. лв) and NP-25.002-0048 (2026, 3 500,0 хил. евро) — an
  order of magnitude below the 100M лв per year in МОН's ЗДОИ answer, so the rest of that money,
  if it exists, flows through a channel this annex does not name (programme budgets, ПМС).
- **ПМС for additional spending — BUILT (2026-11-24) as migration 209 + `budget:dv-decrees` +
  `db:load:budget-decrees:pg`.** pris.government.bg's search answered HTTP 500 throughout, so the
  source is Държавен вестник itself: its issue index is a JSF postback, but every material is a
  plain GET by sequential idMat (~1,000 a month; an unissued id answers an empty 200), so the
  crawler walks ids and keeps only Council of Ministers „за одобряване на допълнител(ни|ен)
  разходи/трансфери" decrees (anywhere in the title — combined titles count). One amount per
  paragraph that starts „Одобрява", the first it states: an itemised list or an item's own „в
  общ размер" subtotal breaks that total down and is never added, and a paragraph that
  appropriates nothing (a per-pensioner sum) carries no clause. `up_to` marks a ceiling. The 2021 → today backfill
  (~93k ids, ~8 h) is an operator run; the pipeline walks only new ids. РМС (decisions) are not
  modelled — they are not promulgated as spending acts in the same form.
- Tables `budget_named_appropriation`, `budget_spending_decree`; loaders + `:cloud` twins; link to
  Phase 1 aliases by explicit mapping, never by name search.
- Surface — BUILT: `/api/db/entity-appropriations` takes an alias's explicit (fiscal year, code)
  lines — a code is unique only within one law — and decree idMats; the mentions tool renders
  each law line and decree as a row linked to its DV material, keeps forecasts and the reserve
  list labelled and out of the appropriated sum, and says „no data" (never €0 or „no money")
  when the lookup fails or an amount is unparsed. INSAIT is mapped to 2025 NP-25.001-0048, 2025
  NP-25.002-0048 (the same project on the reserve list, indicative), 2026 NP-25.002-0048 and
  ПМС № 67/2021 (idMat 156315, 7 802 200 лв to
  СУ for the institute) — checked against the Feb 2021 crawl only, so later decrees wait on the
  full backfill. **Appropriated ≠ transferred ≠ spent**: until the execution reports are in (below),
  the transferred and spent columns render as „няма данни", never as 0 and never as the difference.
- Later: МОН programme execution report and СУ's annual budget report for the transferred/spent
  figures.

## 5. Phase 4 — the foundation's ГФО

Already planned: `tr-gfo-ingest-v1.md` tier 7 (NGO prompt arm, validated on INSAIT 2023). Nothing
new here except linking the result to the Phase 1 alias.

**Blocked, re-checked 2026-11-24.** `tr_announced_act` holds one statement for the foundation
(ЕИК 207211849): fiscal year 2023, in the feed and not yet in a CR capture — FY2024/2025 have not
reached the TR feed. And the ГФО ingest this would ride is itself unbuilt (`tr-gfo-ingest-v1.md`
is a plan, human-gated on OCR cost). Unblocks when both move.

## 6. Order and why

1. Phase 1 — smallest, and makes today's answer correct for every spelling.
2. Phase 2 — the cheapest new source, and useful for every institution, not only INSAIT.
3. Phase 3 — the money story, but the most parsing work; needs a reviewed sample first.
4. Phase 4 — waits on the registry.

## 7. Sources

- pitay requests: #8905, #8904, #8740, #8751, #15319, #15452 (`https://pitay.government.bg/application/<id>/view`)
- ЗДБРБ 2024 text (Ciela): https://www.ciela.net/svobodna-zona-normativi/view/2137238807/zakon-za-darzhavniya-byudzhet-na-republika-balgariya-za-2024-g
- Forbes BG, 170M лв over 10 years (2022): https://forbesbulgaria.com/2022/04/11/
- dbr.bg, €7.3M for 2027: https://dbr.bg/darzavata-garantira-7-3-mln-lv-za-insait-i-prez-2027-g~24134.html
- Wikipedia, ~166.45M лв commitment and the foundation: https://en.wikipedia.org/wiki/Institute_for_Computer_Science,_Artificial_Intelligence_and_Technology
- Critical commentary (opinion, not data): bnews.bg, bccci.net/bg/blog/insait/
