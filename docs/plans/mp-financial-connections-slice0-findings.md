# Slice 0 findings — register.cacbg.bg data shape

_Companion to [mp-financial-connections-plan.md](mp-financial-connections-plan.md). These findings change two assumptions in the plan; revised guidance below._

## Method

Fetched the public index, the per-year list, and 8 random MP declarations from the 51st Народно събрание cohort published in 2025:

```
https://register.cacbg.bg/2025/list.xml         # directory of all declarants
https://register.cacbg.bg/2025/{guid}.xml       # individual declaration
```

Sampled MPs (alphabetical, first 8): Айлин Пехливанова, Айсел Мустафова, Айтен Сабри, Александър Тодоров, Александър Рашев, Александър Койчев, Александър Симидчиев, Александър Иванов.

## Finding 1 — declarations are structured XML, not PDF

**The plan's PDF-parsing concern doesn't apply.** `register.cacbg.bg`'s public-facing UI is a JS-rendered SPA, but the underlying data files are static XML rendered client-side via XSLT. Each MP filing is a single `.xml` document with a stable, machine-readable schema:

```
<PublicPerson>
  <Personal>
    <Name>Айлин Нуридин Пехливанова</Name>
    <Work>Народно събрание на Република България</Work>
    <Position>народен представител</Position>
    <EGN/>          <!-- redacted, always empty -->
    <Address/>      <!-- redacted -->
    <Phone/>        <!-- redacted -->
  </Personal>
  <Spouse/>         <!-- empty, redacted -->
  <Children/>       <!-- empty, redacted -->
  <DeclarationData>
    <EntryNumber>Г9592</EntryNumber>
    <EntryDate>14.05.2025</EntryDate>
    <DeclarationType>Annualy</DeclarationType>
    <Year>2024</Year>
    <ControlHash>AB28546F</ControlHash>
  </DeclarationData>
  <Tables>
    <Table Num="10" Description="Дялове в дружества с ограничена отговорност и командитни дружества" Declared="True">
      <Row Num="1">
        <Cell Num="2" Description="Вид на имуществото">GSK ordinary shares</Cell>
        <Cell Num="3" Description="Размер на дяловото участие">5536,300178</Cell>
        <Cell Num="4" Description="Наименование на дружеството">Glaxosmithkline plc</Cell>
        <Cell Num="5" Description="Седалище">Great Britain</Cell>
        <Cell Num="6" Description="Стойност на дяловото участие">176009</Cell>
        <Cell Num="7" Description="Име: собствено, бащино, фамилно">Александър Димитров Симидчиев</Cell>
        <Cell Num="9" Description="Правно основание за придобиването">други</Cell>
        <Cell Num="10" Description="Произход на средствата">заплата</Cell>
      </Row>
      ...
    </Table>
    ...
  </Tables>
</PublicPerson>
```

Schema is identical across all 8 samples (root children: `ExportVersion, RegionalSettings, Personal, Spouse, Children, DeclarationData, Tables`). Cells use a stable `Num` attribute plus a human-readable `Description` — column meanings don't drift mid-year.

**Implication for the pipeline:** drop the `pdfplumber`-equivalent parser entirely. A 50-line XML parser produces typed records. No golden-PDF tests needed; only an XSD/structural assertion that table 10/11 cell numbers haven't shifted.

## Finding 2 — management roles are *not* in the asset declaration

Asset-declaration tables in full (21 distinct, identical across samples):

| # | Description |
|---|---|
| 1, 1.1, 1.2 | Real estate (own / agricultural / foreign) |
| 2 | Real estate transferred in prior year |
| 3, 3.1–3.5 | Vehicles (motor / agricultural / boats-aircraft / other / foreign / transferred) |
| 4 | Cash |
| 5 | Bank accounts |
| 6 | Receivables > 10 000 BGN |
| 7 | Obligations > 10 000 BGN |
| 8 | Investment & pension funds |
| 9 | Securities & financial instruments |
| **10** | **LLC + limited-partnership shares (current)** |
| **11** | **LLC + limited-partnership shares (transferred in prior year)** |
| 12 | Employment income |
| 13 | Securities given / expenses incurred |
| 14 | Expenses on training, healthcare, etc. |

**There is no "I am a manager / board member of company X" table.** Reason: ЗПК Art. 35 makes active commercial management roles incompatible with an MP mandate — sitting MPs are forbidden from being directors or board members. So the asset declaration only covers *ownership* (passive), not *control* (active).

**Implication for the plan:** the Commerce Registry (`data.egov.bg` TR dump) is **not** an optional enrichment layer — it is the *only* source for two important categories:

1. Historical management roles (MP X was director of Y EOOD before being elected).
2. Current passive directorships in companies they own (ownership shows in declarations; the role title only shows in TR).

This elevates Slice 3 (TR enrichment) from "nice-to-have" to required for the headline feature, and means **the Commerce Registry pipeline must precede or run in parallel with the declaration pipeline**, not after.

## Finding 3 — coverage is sparse but predictable

Of the 8 sampled MPs:

| Table | Description | MPs declaring |
|---|---|---|
| 4 | Cash | 7/8 |
| 5 | Bank accounts | 7/8 |
| 12 | Employment income | 7/8 |
| 1 | Owned real estate | 4/8 |
| 3 | Owned vehicles | 4/8 |
| **10** | **Current LLC shares** | **1/8** |
| **11** | **Recent share transfers** | **1/8** |

So roughly 10–25% of MPs will have an actual entry in the company-shares tables on any given year. For 240 MPs that's 25–60 share entries per cycle — small enough that we can hand-review every record before publishing, which addresses risk #3 (legality of republishing) on the plan.

## Finding 4 — Spouse and Children are redacted at root

`<Spouse/>` and `<Children/>` are always empty in the public XML. However, the Tables include columns for spouse holdings (e.g., Table 12 column 4 "На съпруга/та") — so spouse *aggregated* numbers are present, but spouse *identity* is not. We surface aggregated numbers only.

## Finding 5 — directory schema is rich

The yearly `list.xml` already has everything we need to match declarants to MPs without hitting parliament.bg:

```xml
<Category Name="Народни представители">
  <Institution Name="51-во Народно събрание">
    <Person>
      <Name>Айлин Нуридин Пехливанова</Name>
      <Position>
        <Name>Народен представител</Name>
        <Declaration>
          <Sent>True</Sent>
          <xmlFile>CD1CBE09-...xml</xmlFile>
          <Title>Декларация</Title>
        </Declaration>
      </Position>
    </Person>
  </Institution>
</Category>
```

Match key for joining with our existing MP index: **(Institution name, normalized full name)**. Institution name carries the parliament number (47, 48, ..., 51), which lines up with `nsFolders` in [public/parliament/index.json](../../public/parliament/index.json).

**Note on the 52nd Народно събрание:** the 2025 list contains only the 51st cohort. The 52nd НС (sworn in May 2025) hasn't filed annual declarations yet — those will appear in the 2026 directory next May. Until then, the only data source for sitting MPs is the Commerce Registry, which makes Slice 3 even more critical for the launch experience.

## Revised pipeline (replaces §3 of the plan)

```
scripts/
  declarations/
    index.ts               # entry, called from main.ts via --declarations
    fetch_index.ts         # walks register.cacbg.bg/{year}/list.xml years → enumeration of MPs
    fetch_declaration.ts   # downloads {guid}.xml lazily into raw_data/declarations/{year}/{guid}.xml
    parse_declaration.ts   # XML → typed MpDeclaration record (no PDF dependency)
    match_to_mps.ts        # (institution, name) → MP id via fuzzy-match on existing parliament index
    enrich_companies.ts    # for each EIK referenced, look up in TR dump
    build_graph.ts         # MPs + companies + non-MP associates → connections.json
```

No native dependencies. No image-based fallbacks. The whole pipeline is tractable in a day of focused work for Slice 1 (single-MP end-to-end).

## Updated TypeScript types (corrects §4 of the plan)

The `MpCompanyRole` type in the plan needs to split — declarations only give us `OwnershipStake`, while TR gives us `ManagementRole`:

```ts
export type MpOwnershipStake = {
  source: "declaration";
  declarationYear: number;
  sourceUrl: string;             // link to the declaration XML
  table: "10" | "11";            // current vs transferred
  companyName: string;           // raw, EIK often absent in declarations
  eik?: string;
  registeredOffice?: string;     // city/country
  shareSize?: string;            // raw text: "100%", "5536,300178", "33,3 %" — preserve original
  valueBgn?: number;
  origin?: string;               // "заплата", "наследство", etc.
  acquirerOrTransferee?: string; // for table 11
};

export type MpManagementRole = {
  source: "tr";                  // commerce registry
  eik: string;
  companyName: string;
  role: "manager" | "board_member" | "executive_director" | "procurator" | "other";
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;            // for MPs always false during mandate by law
  sourceUrl: string;             // link to TR portal entry
};

export type MpIncomeRecord = {
  source: "declaration";
  declarationYear: number;
  category: string;              // raw "Видове доход" cell value
  amountBgnDeclarant?: number;
  amountBgnSpouse?: number;
};

export type MpDeclaration = {
  mpId: number;
  declarantName: string;
  institution: string;           // e.g. "51-во Народно събрание"
  declarationYear: number;
  fiscalYear: number;            // year covered (declarationYear - 1 for annual)
  declarationType: "Annualy" | "Initial" | "Final" | "Other";
  filedAt?: string;
  entryNumber?: string;
  controlHash?: string;
  sourceUrl: string;
  parseStatus: "ok" | "partial";
  ownershipStakes: MpOwnershipStake[];
  income: MpIncomeRecord[];
};
```

The plan's `MpConnectionsGraph` and frontend integration sections remain valid; only the data-shape section and the parser approach change.

## What changes for slicing

| Slice | Before | After |
|---|---|---|
| 0 | "Sanity-check PDFs by hand" | **Done** — XML schema confirmed, no PDF work |
| 1 | "Single MP end-to-end through PDF parser" | Single MP end-to-end through XML parser — much shorter, ~half a day |
| 2 | "Bulk parse 240 MPs in 52nd НС" | Bulk parse 51st НС (the cohort that has annual filings); 52nd НС has no declarations until May 2026 |
| 3 | "TR enrichment, optional polish" | **Required for launch** — the only source of management roles and the only data we have for sitting 52nd-НС MPs until annual declarations exist |
| 4 | Spatial UI | Unchanged |
| 5 | Backfill | Same approach, but easier — historical years are also XML, same schema |
| 6 | i18n + SEO | Unchanged |

## Recommended next step

Slice 1: write `parse_declaration.ts` against the XML schema and produce `public/parliament/declarations/{mpId}.json` for one MP (Симидчиев — has the most-populated tables). Then wire it into the candidate dashboard. Estimated effort: 4–6 hours.

In parallel, start the TR pipeline (Slice 3 prep) — download one daily snapshot of the `data.egov.bg` TR dump and explore the schema for officer-by-name reverse lookup.
