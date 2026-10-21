# Сметна палата audit reports — scoping (v1)

Status: **scoping only** (deferred-followups-verification-fixes-v1, T4.10). Nothing is built.
Everything below was measured against bulnao.government.bg on 2026-10-21 with a scratch scanner;
counts are the site's own listings on that day.

## What the site publishes

bulnao.government.bg is a Wagtail (Django) site. Every report is a card linking
`/bg/documents/<id>/<file>`; the numeric `<id>` is stable and is the natural key. A card carries the
title, file size, and — on newer items only — a **category** (12 sector values, e.g. „Здравеопазване и
социална политика", „Общини") and a **type** (4 values: Финансов одит · Одит за съответствие при
финансовото управление · Одит на изпълнение · Специфичен одит). **No card carries a date.** The
listing's own `year` filter („Година на публикуване", 2002–2026) is the only machine-readable date,
so a publication year means one listing walk per year.

Paging: the page renders 16 cards; „Виж още файлове" POSTs back to the same URL with
`page=N` + the Django CSRF token (cookie + `csrfmiddlewaretoken`) and gets
`{success, html, hide_load_button}`. Filters (`section`, `type`, `year`, `sort`) are a GET form.
No robots.txt (404), no API, no Cloudflare challenge observed; 0.5 s between POSTs was enough.

| listing (under `/bg/`)                                       | documents | notes                                                                                                 |
| ------------------------------------------------------------ | --------: | ----------------------------------------------------------------------------------------------------- |
| `oditna-dejnost/dokladi/` — all audit reports                |     1,502 | 1,015 carry no type and 1,010 no category (older items)                                               |
| `oditna-dejnost/finansovi-oditi-na-gfo/<year>-<scope>/` (37) |     2,853 | annual-statement audits, 2014–2025 — see below                                                        |
| `oditna-dejnost/dokladi-obshini/`                            |        45 | compliance audits of municipalities                                                                   |
| `oditna-dejnost/dokladi-sled-priklyuchili-nakazatelni-…/`    |        19 | reports released after criminal proceedings closed                                                    |
| `oditna-dejnost/programa-za-oditnata-dejnost/`               |        21 | the annual audit programmes                                                                           |
| `oditna-dejnost/kontrol-na-obshtestvenite-porychki/`         |         9 |                                                                                                       |
| `kontrol-partii/dokladi-subsidii/`                           |         7 | party subsidy audits                                                                                  |
| `kontrol-izbori/oditni-dokladi-parlamentarni-izbori/`        |        10 | campaign-finance audits; `mestni` holds 6; the EP, presidential and partial listings were not counted |

The listings are **almost but not quite disjoint**: document 12960 is in both `dokladi/` and the
2021 universities ГФО branch, and 8 ids repeat inside their own listing (`dokladi/` shows 1,504
cards for 1,502 ids). So a corpus is their union keyed on the document id, and membership in a
listing is a separate fact — a document can belong to more than one.

Formats in `dokladi/` (per card, so 1,504): 1,187 `.doc`, 285 `.pdf`, 25 `.docx`, 7 `.rtf`. In the
ГФО tree, 2018 on is PDF except 2 `.docx` in 2023; 2014–2017 is mostly legacy `.doc` (823), with
130 `.docx`, 75 PDFs and one `.rar`. A text layer was confirmed only on the six 2024 samples below —
the later years are assumed, not checked. Legacy `.doc` needs an external converter (antiword / LibreOffice), which
nothing in this repo uses yet.

## The ГФО tree is the high-value part

Each year × scope page holds one audit report per audited body's **annual financial statement**:

| year | municipalities | central first-level spenders | state universities |
| ---- | -------------: | ---------------------------: | -----------------: |
| 2014 |            148 |                           52 |                 37 |
| 2015 |            194 |                           52 |                 35 |
| 2016 |            205 |                           57 |                 36 |
| 2017 |            162 |                           14 |                 37 |
| 2018 |            160 |                           53 |                 37 |
| 2019 |            173 |                           50 |                 34 |
| 2020 |            195 |                           46 |                 38 |
| 2021 |          **3** |                           53 |                 38 |
| 2022 |         **59** |                           54 |              **2** |
| 2023 |            232 |                           51 |                 34 |
| 2024 |            237 |                           55 |                 38 |
| 2025 |            124 |                           39 |                 10 |

(+ 9 summary reports.) 2025 is still being published.

⚠️ **The 2021/2022 hole is a fact about the listing, not about the audits.** Nothing on the site says
whether those statements were audited and not posted, audited under another listing, or not
audited. A surface must say „the Сметна палата published N reports for that year", never
„N municipalities were audited", and **absence is never a clean opinion** — the same rule as the
ИСУН clean-delivery register in CLAUDE.md.

### The datum: the audit opinion

Each report states its ISSAI opinion as a section heading. Measured on six 2024 municipal reports,
which between them showed three of the four — no disclaimer was in the sample, so its heading below
is the ISSAI wording, not an observed one:

| heading in the text             | opinion    |
| ------------------------------- | ---------- |
| „Мнение" (bare)                 | unmodified |
| „Квалифицирано мнение"          | qualified  |
| „Отрицателно мнение"            | adverse    |
| „Отказ от изразяване на мнение" | disclaimer |

The heading appears twice (table of contents + body) and is followed by „База за изразяване на
…мнение". ⚠️ The **filename** often encodes the opinion too (`GFO_Batak_Otricatelno_2024.pdf`,
`…_Nemod_…`, `…_Kvalif_…`) — on 230 of 237 municipal files for 2024, 85–87% in 2020 and 2023, but
none in 2015 or 2018 and one in 2019. It is a publisher's naming habit, so it may serve as a
cross-check, never as the source.

## Proposed table shape

Two tables, keyed on the site's document id.

```sql
-- every listed document, from every listing: the catalogue
CREATE TABLE bulnao_report (
  doc_id         int PRIMARY KEY,          -- /bg/documents/<id>/
  url            text NOT NULL,
  title          text NOT NULL,
  audit_type     text,                     -- the card's „Тип", NULL on older items
  category       text,                     -- the card's „Категория", NULL on older items
  file_ext       text NOT NULL,
  publication_year int,                    -- from the year filter walk; NULL until walked
  first_seen_at  timestamptz NOT NULL
);

-- which listing(s) a document appears in — not 1:1 (see above)
CREATE TABLE bulnao_report_listing (
  doc_id   int NOT NULL REFERENCES bulnao_report,
  listing  text NOT NULL,                  -- 'dokladi' | 'gfo/<year>-<scope>' | 'dokladi-obshini' | …
  PRIMARY KEY (doc_id, listing)
);

-- ГФО reports only: one opinion per audited statement
CREATE TABLE bulnao_gfo_opinion (
  doc_id         int PRIMARY KEY REFERENCES bulnao_report,
  scope          text NOT NULL CHECK (scope IN ('obshtina', 'central', 'university')),
  fiscal_year    int NOT NULL,             -- from the tree, not the filename
  entity_name    text NOT NULL,            -- as the title names it
  obshtina_code  text,                     -- resolved via place_dim; NULL when not resolved
  opinion        text CHECK (opinion IN ('unmodified', 'qualified', 'adverse', 'disclaimer')),
  opinion_quote  text                      -- the heading line as found; NULL = not parsed
);
```

`opinion` NULL means „not parsed" (a `.doc` year, or a document without a recognised heading) and
must never render as unmodified.

## Recommended first build

1. Catalogue: walk every listing (≈4,500 documents) into `bulnao_report`; add the year walk later.
2. ГФО municipal opinions **2018–2025** (PDF, ~1,180 reports): download, `pdftotext`, read the
   heading, resolve the municipality name → `obshtina_code`. That joins straight onto the governance
   dashboards and the municipal-fiscal pages (149) as „the Сметна палата's opinion on this
   municipality's annual statement", per year.
3. Defer: legacy `.doc` years, report bodies of `dokladi/` (findings text), central spenders →
   budget-node mapping.

A watcher fingerprint can be the set of document ids per ГФО branch.
