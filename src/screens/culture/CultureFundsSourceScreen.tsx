// /culture/funds/<arm> — ONE of the four source pages, driven by the registry.
//
// The parent /culture/funds publishes four euro figures and goes nowhere. This
// names the records behind one of them.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ A READER MAY ARRIVE HERE WITHOUT EVER SEEING THE PARENT.
//
// /culture/funds opens by saying the four figures do not sum, and that sentence
// is what makes the whole family honest. From a search result or a shared link,
// this page is the first thing a reader sees — so the rule travels ONTO it: the
// basis card below states what one row is, how the rows were reached, and what
// this arm cannot answer, and the strip beneath names the other three with the
// „не се събират" warning attached.
//
// NOTHING HERE SUMS ACROSS ARMS. The aggregates footer sums the ONE arm being
// shown, which is a legitimate total of one quantity; no component on this page
// receives more than one arm's money.
// ═══════════════════════════════════════════════════════════════════════════════
//
// Every figure comes from `hub_stats.json` (the KPI figures) or from the server
// aggregate over the arm's own view (the table footer). No literal on this page
// is a number.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { HubHead, type HubEvidenceRow } from "@/ux/infographic";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { DbDataTable } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { formatEur, formatEurCompact, formatInt } from "@/lib/currency";
import { useCultureHubStats } from "@/data/culture/hubStats";
import { CULTURE_FUND_SOURCES, cultureFundSource } from "./cultureFundSources";

/** Row shapes, one per arm. The engine camelCases every column, and each arm's
 *  money is deliberately named for what it measures — never a shared `totalEur`
 *  across two incomparable quantities (functions/db_table.js says why). */
interface IsunRow {
  contractNumber: string | null;
  beneficiaryEik: string | null;
  beneficiaryName: string | null;
  programName: string | null;
  title: string | null;
  totalEur: number | null;
  grantEur: number | null;
  paidEur: number | null;
  status: string | null;
  oblastCode: string | null;
}
interface AgriRow {
  id: number;
  year: number | null;
  eik: string | null;
  name: string | null;
  oblastName: string | null;
  scheme: string | null;
  schemeDesc: string | null;
  subsidyEur: number | null;
}
/** The three arms' row shapes, as one union. `DbDataTable` is generic over ONE
 *  row type and this screen is polymorphic across three, so without the union
 *  the call needs a cast through `never` — which switches off checking of both
 *  the column set AND the row type, on the one component where they are most
 *  likely to drift apart (the columns are chosen by a string id). */
interface InterregRow {
  key: string;
  keepId: number;
  isLead: boolean | null;
  partnerName: string | null;
  eik: string | null;
  budgetEur: number | null;
  budgetBasis: string | null;
  oblastCode: string | null;
  programmeCode: string | null;
  period: string | null;
  titleEn: string | null;
}

type CultureFundRow = IsunRow | AgriRow | InterregRow;

/** Widen one arm's fully-checked column set to the union `DbDataTable` is
 *  instantiated with.
 *
 *  A cast is unavoidable — a column def is contravariant in its row type, so
 *  `DataTableColumnDef<AgriRow>` is not assignable to
 *  `DataTableColumnDef<CultureFundRow>` — but WHICH cast matters. Through
 *  `never` (the first cut) both the column set and the row type stop being
 *  checked, on the one component in the repo where they are most likely to
 *  drift, because the columns are selected by a string id. Through this helper
 *  each branch is still checked against ITS OWN row shape; only the final
 *  widening is asserted, and it is sound at runtime because the resource that
 *  produces the rows is chosen by the same `sourceId`. */
const forArm = <T,>(
  cols: DataTableColumnDef<T, unknown>[],
): DataTableColumnDef<CultureFundRow, unknown>[] =>
  cols as unknown as DataTableColumnDef<CultureFundRow, unknown>[];

/** A euro cell. Right-aligned, tabular, never rounded away to nothing. */
const eurCell = (v: number | null, lang: string) => (
  <span className="tabular-nums whitespace-nowrap">
    {v == null ? "—" : formatEur(v, lang)}
  </span>
);

export const CultureFundsSourceScreen: FC<{ sourceId: string }> = ({
  sourceId,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  // ⚠️ NOT an `as` cast. Every caller is a static <Route> in routes.tsx today,
  // but a mistyped id there would be a TypeError inside the first `pick()` — and
  // with no error boundary anywhere in src/, that unmounts the React root and
  // blanks the whole SPA rather than one page.
  const source = cultureFundSource(sourceId);
  const { data: s } = useCultureHubStats();

  const pick = (t: { bg: string; en: string }) => (bg ? t.bg : t.en);
  const metric = s && source ? source.metric(s) : null;
  const limit = s && source ? source.limit(s, lang) : null;
  const finding = s && source?.finding ? source.finding(s, lang) : null;
  /** „проекта" — the бройна форма, the noun AFTER A NUMERAL. */
  const rowNoun = metric?.rowsLabel ?? { bg: "реда", en: "rows" };
  /** „проекти" — the plain plural, the noun after an ARTICLE. Bulgarian
   *  distinguishes the two and English does not, so „Най-големите проекта" is
   *  wrong the same way „1 проекта" is. ⚠️ The fallback is the plural too:
   *  „редове", never „реда". */
  const rowNounPlural = metric?.rowsPlural ?? { bg: "редове", en: "rows" };

  /** The ranked list in the head. ⚠️ Derived from the table's FIRST PAGE rather
   *  than from a second query: the table is already sorted by this arm's money
   *  descending, so page 0 IS the top N. A separate request would be a second
   *  producer of the same ranking, free to disagree with the rows below it.
   *
   *  ⚠️⚠️ IT IS ONLY THE TOP N IN THE DEFAULT STATE, which is why `onData` below
   *  refuses every other one. The heading says „Най-големите" and `basis` names
   *  the money column, so a reader-applied sort, search or filter makes both
   *  false while the list quietly re-ranks underneath them — and sorting by a
   *  column the server cannot sort (title, scheme) falls through to the bare
   *  paging tiebreak, publishing five arbitrary rows as „the largest". */
  /** ⚠️ RAW, not formatted. Storing „€39,2 млн." would freeze the list in the
   *  locale active when the response arrived — and i18n initialises
   *  ASYNCHRONOUSLY, so the language flips from `en` to `bg` AFTER the first
   *  fetch resolves on an ordinary load. React Query holds that response for
   *  ever (`staleTime: Infinity`), so there is no second `onData` to correct it:
   *  the list would either show the wrong locale's money or, if cleared on the
   *  switch, never come back at all. Formatting at RENDER time makes a language
   *  change an ordinary re-render. */
  const [top, setTop] = useState<
    { id: string; label: string; eur: number | null; to?: string }[]
  >([]);

  /** ⚠️ RESET DURING RENDER, NOT IN AN EFFECT, and the ordering is the reason.
   *
   *  WHAT it guards: React Router does NOT remount across the four sibling
   *  static routes, so `useState` survives the navigation — and the table's
   *  `keepPreviousData` holds the old rows for the whole of the next fetch.
   *  Without a reset, the strip on /culture/funds/dfz shows the ИСУН arm's
   *  projects under the ДФЗ heading and basis: one arm's figures presented as
   *  another's, which is the single thing this page family exists to prevent.
   *  (Language is NOT in this key: the rows are stored raw and formatted at
   *  render, so a switch needs no reset — see the `top` declaration.)
   *
   *  WHY NOT `useEffect`: child effects run BEFORE parent effects, so the
   *  table's own mount-time `onData` populated the list and this then cleared
   *  it — the aside was empty on every first paint. This is React's documented
   *  „adjust state when a prop changes" pattern: it re-renders immediately, in
   *  the same pass, and cannot race the child. */
  const [topKey, setTopKey] = useState(sourceId);
  if (topKey !== sourceId) {
    setTopKey(sourceId);
    setTop([]);
  }

  const columns = useMemo(() => {
    if (sourceId === "dfz")
      return forArm<AgriRow>([
        {
          accessorKey: "year",
          header: bg ? "Година" : "Year",
          className: "tabular-nums",
        },
        {
          accessorKey: "name",
          // Untranslated on purpose: „читалище" is the institution's own legal
          // form and has no English equivalent, so the EN copy keeps the
          // Bulgarian word throughout this family (the registry's dfz title and
          // the parent screen do the same).
          header: "Читалище",
          cell: ({ row }) =>
            // 237 of 264 rows carry an EIK; the other 27 render as plain text
            // rather than as a link to a page that cannot resolve.
            row.original.eik ? (
              <Link
                to={`/farm/${row.original.eik}`}
                className="text-primary hover:underline"
              >
                {row.original.name}
              </Link>
            ) : (
              <span>{row.original.name}</span>
            ),
        },
        { accessorKey: "oblastName", header: bg ? "Област" : "Oblast" },
        {
          id: "scheme",
          header: bg ? "Схема" : "Scheme",
          // The code alone („322") names nothing; the description is what makes
          // the column readable.
          accessorFn: (r: AgriRow) =>
            [r.scheme, r.schemeDesc].filter(Boolean).join(" · "),
        },
        {
          accessorKey: "subsidyEur",
          header: bg ? "Субсидия" : "Subsidy",
          meta: { align: "right" },
          cell: ({ row }) => eurCell(row.original.subsidyEur, lang),
        },
      ]);

    if (sourceId === "interreg")
      return forArm<InterregRow>([
        {
          accessorKey: "partnerName",
          header: bg ? "Партньор" : "Partner",
          cell: ({ row }) => (
            <span>
              {row.original.partnerName}
              {row.original.isLead ? (
                <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                  {bg ? "водещ" : "lead"}
                </span>
              ) : null}
            </span>
          ),
        },
        {
          accessorKey: "titleEn",
          header: bg ? "Операция" : "Operation",
          cell: ({ row }) => (
            // Every row carries a keep_id, so every row links.
            <Link
              to={`/funds/interreg/${row.original.keepId}`}
              className="text-primary hover:underline"
            >
              {row.original.titleEn}
            </Link>
          ),
        },
        { accessorKey: "programmeCode", header: bg ? "Програма" : "Programme" },
        {
          accessorKey: "budgetEur",
          header: bg ? "Бюджет на партньора" : "Partner budget",
          meta: { align: "right" },
          cell: ({ row }) => eurCell(row.original.budgetEur, lang),
        },
      ]);

    return forArm<IsunRow>([
      {
        accessorKey: "beneficiaryName",
        header: bg ? "Бенефициент" : "Beneficiary",
        cell: ({ row }) =>
          row.original.beneficiaryEik ? (
            <Link
              to={`/company/${row.original.beneficiaryEik}`}
              className="text-primary hover:underline"
            >
              {row.original.beneficiaryName}
            </Link>
          ) : (
            <span>{row.original.beneficiaryName}</span>
          ),
      },
      {
        accessorKey: "title",
        header: bg ? "Проект" : "Project",
        cell: ({ row }) =>
          row.original.contractNumber ? (
            <Link
              to={`/funds/contract/${row.original.contractNumber}`}
              className="text-primary hover:underline"
            >
              {row.original.title}
            </Link>
          ) : (
            <span>{row.original.title}</span>
          ),
      },
      { accessorKey: "programName", header: bg ? "Програма" : "Programme" },
      {
        accessorKey: "grantEur",
        header: bg ? "Помощ" : "Grant",
        meta: { align: "right" },
        cell: ({ row }) => eurCell(row.original.grantEur, lang),
      },
      {
        accessorKey: "totalEur",
        header: bg ? "Договорено" : "Contracted",
        meta: { align: "right" },
        cell: ({ row }) => eurCell(row.original.totalEur, lang),
      },
    ]);
  }, [sourceId, bg, lang]);

  // ⚠️ HubHead HERE TOO, NOT <Title>. The two branches are mutually exclusive at
  // runtime, but `hubHead.gates.test.ts` is a static scan over the source and
  // cannot see that — and its rule is right in general: a file that references
  // both is one refactor away from emitting two h1s. HubHead also gives this
  // body the <SEO> a real URL needs, which a bare heading would not.
  if (!source)
    return (
      <>
        <HubHead
          eyebrow={bg ? "Култура · Еврофондове" : "Culture · EU funds"}
          title={bg ? "Непознат източник" : "Unknown source"}
          seoDescription={
            bg ? "Няма такъв източник на средства." : "No such funding source."
          }
          deck={
            bg ? "Няма такъв източник на средства." : "No such funding source."
          }
        />
        <p className="mt-4 text-sm">
          <Link to="/culture/funds" className="text-primary hover:underline">
            {bg ? "Обратно към прегледа →" : "Back to the overview →"}
          </Link>
        </p>
      </>
    );

  return (
    <>
      <SectorBreadcrumb
        parent={{
          label: bg ? "Еврофондове" : "EU funds",
          to: "/culture/funds",
        }}
        current={pick(source.short)}
      />

      {/* ⚠️ HubHead RENDERS THE <h1> AND THE <SEO>, so this screen must NOT also
          render <Title> — that emits two h1s. The band's `basis` per figure is
          why this component rather than a hand-rolled header: on this page family
          the four arms measure four different things, so the basis is what stops
          a reader carrying one arm's figure onto another. */}
      <HubHead
        eyebrow={bg ? "Култура · Еврофондове" : "Culture · EU funds"}
        freshness={
          s?.generatedAt
            ? bg
              ? `данни към ${s.generatedAt}`
              : `data as of ${s.generatedAt}`
            : undefined
        }
        title={pick(source.title)}
        seoDescription={pick(source.deck)}
        deck={pick(source.deck)}
        kpis={s && source ? source.kpis(s, lang) : undefined}
        // The count the loaded band will actually have, so the reserved height is
        // the real one. The name arm renders FOUR against the production blob
        // (it carries `byNameNames`), and a fixed 3 leaves the layout jumping on
        // every cold load of the busiest of the four pages.
        kpisPending={sourceId === "isun-name" ? 4 : 3}
        kpiNote={
          bg
            ? "Тези числа не се събират с числата на другите три реда — всеки е от различен регистър, на различна основа."
            : "These figures do not add to the other three arms' — each comes from a different register on a different basis."
        }
        evidence={
          top.length
            ? {
                // ⚠️ THE HEADING NAMES WHAT A ROW IS. „Най-големите" over rows
                // labelled with beneficiary names reads as a RECIPIENT ranking,
                // and this is a ranking of PROJECTS — Национален фонд „Култура"
                // appears twice in the top five with two different figures,
                // which under a recipient heading is a visible contradiction and
                // under a project heading is just two projects.
                heading: bg
                  ? `Най-големите ${pick(rowNounPlural)}`
                  : `The largest ${pick(rowNounPlural)}`,
                // From the REGISTRY, beside the `rankColumn` it describes — one
                // entry states both, so the sentence and the ORDER BY cannot
                // drift. It was a three-way ternary here, which put per-arm copy
                // in two files.
                basis: pick(source.evidenceBasis),
                // ⚠️ Formatted HERE, at render, from the raw figures — see the
                // `top` declaration. „—" and never „€0": a zero is a claim that
                // the amount was zero, and the table renders a dash for the same
                // cell.
                rows: top.map(
                  (r): HubEvidenceRow => ({
                    id: r.id,
                    label: r.label,
                    value: r.eur == null ? "—" : formatEurCompact(r.eur, lang),
                    to: r.to,
                  }),
                ),
              }
            : undefined
        }
      />

      {/* ── the basis card ─────────────────────────────────────────────────
          Not a footnote. Three labelled lines a reader can act on, and the
          third — what this arm cannot answer — is the one that must never be
          dropped for space: it is the difference between a page that answers a
          question and one that looks like it did. */}
      <section className="mt-4 rounded-xl border bg-card p-4">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {bg ? "Основа" : "Basis"}
            </dt>
            <dd className="mt-0.5">{pick(source.basis)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {bg
                ? "Как се стига до тези редове"
                : "How these rows were reached"}
            </dt>
            <dd className="mt-0.5">{pick(source.identity)}</dd>
          </div>
          {limit ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {bg
                  ? "Какво този ред НЕ отговаря"
                  : "What this arm does NOT answer"}
              </dt>
              <dd className="mt-0.5">{pick(limit)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* ⚠️ NO STANDALONE „€X across N rows" LINE HERE. Tier 3 had one; the
          HubHead band above now states the same figure WITH its basis, and a
          second copy underneath was the third rendering of one number on one
          screen (band, this line, the active strip card). The table's footer is
          the one other place it appears, and that one says „the current
          selection" because it counts what the filters left. */}
      {/* The shape a reader would otherwise mis-take from this arm. Distinct
          from the basis card's „what this cannot answer": that is a limit, this
          is a finding. */}
      {finding ? (
        <p className="mt-3 max-w-3xl rounded-xl border border-primary/30 bg-muted/40 p-3 text-sm">
          {pick(finding)}
        </p>
      ) : null}

      <div className="mt-4">
        <DbDataTable<CultureFundRow>
          resource={source.resource}
          columns={columns}
          pageSize={25}
          onData={(resp, request) => {
            // ⚠️ THE DEFAULT STATE ONLY — see the `top` declaration. `request` is
            // the exact body that produced `resp`, so this can check the whole
            // claim rather than just the page:
            //   · page 0, because the list is a top-N;
            //   · NO client sort — an empty `sort` means the server applied its
            //     own defaultSort, which IS this arm's money descending;
            //   · no search term and no filters, because the heading is
            //     unqualified („Най-големите", not „най-големите сред
            //     намерените").
            // In any other state the list is withdrawn rather than relabelled:
            // an aside that disappears when a reader sorts is legible; one that
            // silently re-ranks under a heading claiming otherwise is not.
            const req = request as {
              sort?: unknown[];
              filters?: { global?: string; columns?: unknown[] };
            };
            const isDefaultView =
              resp.page === 0 &&
              !(req.sort ?? []).length &&
              !req.filters?.global &&
              !(req.filters?.columns ?? []).length;
            if (!isDefaultView) {
              setTop([]);
              return;
            }
            setTop(
              resp.rows.slice(0, 5).map((r, idx) => {
                const row = r as CultureFundRow;
                if (sourceId === "dfz") {
                  const a = row as AgriRow;
                  return {
                    id: String(a.id ?? idx),
                    label: a.name ?? "—",
                    // ⚠️ NOT `?? 0`. „€0" is a claim that the payment was zero;
                    // the table renders „—" for the same cell, and on Interreg
                    // the source distinguishes a published zero from an absence
                    // (`budget_basis`). formatEurCompact returns "" for null, so
                    // the fallback is explicit here.
                    eur: a.subsidyEur,
                    to: a.eik ? `/farm/${a.eik}` : undefined,
                  };
                }
                if (sourceId === "interreg") {
                  const i = row as InterregRow;
                  return {
                    id: i.key ?? String(idx),
                    // A participation is (partner × operation): one partner can
                    // appear several times, so the partner alone would repeat.
                    label: [i.partnerName, i.titleEn]
                      .filter(Boolean)
                      .join(" — "),
                    eur: i.budgetEur,
                    to: `/funds/interreg/${i.keepId}`,
                  };
                }
                const p = row as IsunRow;
                return {
                  // ⚠️ A STABLE id, not the label: two beneficiaries can share a
                  // name in this corpus, and React then reuses the wrong row.
                  // ⚠️ Index-suffixed, because the two fallbacks can BOTH be
                  // null and "" then repeats — which is the key collision the
                  // stable id exists to prevent, arrived at one step later.
                  id:
                    p.contractNumber ?? `${p.beneficiaryName ?? "row"}#${idx}`,
                  // The PROJECT, with its beneficiary after it — the row is a
                  // project, so labelling it with the beneficiary alone made one
                  // body appear twice in five rows under two different figures.
                  label: [p.title, p.beneficiaryName]
                    .filter(Boolean)
                    .join(" — "),
                  eur: p.grantEur,
                  // Links to the PROJECT for the same reason. /company/:eik is
                  // the beneficiary's page and would answer a question this row
                  // is not asking.
                  to: p.contractNumber
                    ? `/funds/contract/${p.contractNumber}`
                    : undefined,
                };
              }),
            );
          }}
          searchPlaceholder={pick(source.searchPlaceholder)}
          renderAggregates={(agg, total) => (
            // ⚠️ ONE arm's money, and the ?? chain is safe precisely because no
            // two arms share a money column name (functions/db_table.js): exactly
            // one of these keys is present in any response, so this can never
            // add two quantities. `rowNoun` comes from the registry so the label
            // says „плащания" on ДФЗ and „участия" on Interreg rather than a
            // generic „rows".
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {formatEurCompact(
                  agg.sumGrantEur ?? agg.sumSubsidyEur ?? agg.sumBudgetEur ?? 0,
                  lang,
                )}
              </span>{" "}
              {bg ? "в" : "across"}{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatInt(total, lang)}
              </span>{" "}
              {pick(rowNoun)}{" "}
              <span className="text-xs">
                {bg ? "(избраното в таблицата)" : "(the current selection)"}
              </span>
            </span>
          )}
        />
      </div>

      {/* ── the cross-arm strip ────────────────────────────────────────────
          /culture/funds' opening paragraph, rendered as navigation. It is here
          because a reader who arrived from search never read that paragraph. */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          {bg ? "Другите потоци" : "The other streams"}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {bg ? "— не се събират" : "— they do not sum"}
          </span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {bg
            ? "Всеки от четирите реда е от различен регистър, на различна основа. Затова числата им не могат да се съберат в едно."
            : "Each of the four arms comes from a different register on a different basis. That is why their figures cannot be added into one."}
        </p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CULTURE_FUND_SOURCES.map((o) => {
            const m = s ? o.metric(s) : null;
            const active = o.id === sourceId;
            const body = (
              <>
                <span className="block text-sm font-medium">
                  {pick(o.short)}
                </span>
                {m ? (
                  <>
                    <span className="mt-1 block text-lg font-bold tabular-nums">
                      {formatEurCompact(m.eur, lang)}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatInt(m.rows, lang)} {pick(m.rowsLabel)}
                    </span>
                  </>
                ) : null}
              </>
            );
            return (
              <li key={o.id}>
                {active ? (
                  <div
                    aria-current="page"
                    className="rounded-xl border border-primary/40 bg-muted p-3"
                  >
                    {body}
                  </div>
                ) : (
                  <Link
                    to={o.to}
                    className="block rounded-xl border bg-card p-3 hover:border-primary/40"
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm">
          <Link to="/culture/funds" className="text-primary hover:underline">
            {bg ? "Обратно към прегледа →" : "Back to the overview →"}
          </Link>
        </p>
      </section>
    </>
  );
};
