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

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
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
  /** „проекта" / „плащания" / „участия". From the registry when the blob is
   *  loaded, and a neutral fallback while it is not — the table's footer must
   *  still read as a sentence before the blob arrives. */
  const rowNoun = metric?.rowsLabel ?? { bg: "реда", en: "rows" };

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

  if (!source)
    return (
      <>
        <Title
          description={
            bg ? "Няма такъв източник на средства." : "No such funding source."
          }
        >
          {bg ? "Непознат източник" : "Unknown source"}
        </Title>
        <p className="mt-4 text-sm">
          <Link to="/culture/funds" className="text-primary hover:underline">
            {bg ? "Обратно към прегледа →" : "Back to the overview →"}
          </Link>
        </p>
      </>
    );

  return (
    <>
      <Title description={pick(source.deck)}>{pick(source.title)}</Title>
      <SectorBreadcrumb
        parent={{
          label: bg ? "Еврофондове" : "EU funds",
          to: "/culture/funds",
        }}
        current={pick(source.short)}
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

      {/* ⚠️ THE HEADLINE AND THE TABLE FOOTER PRINT THE SAME QUANTITY FROM TWO
          SOURCES — this one from the committed blob, the footer from a live
          aggregate over the arm's own view — so each says WHICH. Rendered as one
          sentence they read as a contradiction the day the blob goes a vintage
          behind a corpus reload, and as a redundancy every other day. */}
      {metric ? (
        <p className="mt-4 text-sm text-muted-foreground">
          <span className="text-2xl font-bold tabular-nums text-foreground">
            {formatEurCompact(metric.eur, lang)}
          </span>{" "}
          {bg ? "по" : "across"}{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {formatInt(metric.rows, lang)}
          </span>{" "}
          {pick(metric.rowsLabel)}
          <span className="ml-2 text-xs">
            {bg
              ? `(целият ред, към ${s?.generatedAt ?? ""})`
              : `(the whole arm, as of ${s?.generatedAt ?? ""})`}
          </span>
        </p>
      ) : null}

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
          searchPlaceholder={
            // What each arm's search ACTUALLY reaches (functions/db_table.js):
            // ИСУН searches beneficiary, programme and project title; Interreg
            // searches the partner and the operation's English title; ДФЗ
            // searches the читалище name only, because scheme_desc has no
            // trigram index. A placeholder that under-states the reach makes a
            // reader stop typing the term that would have worked.
            sourceId === "dfz"
              ? bg
                ? "Търси читалище…"
                : "Search a читалище…"
              : sourceId === "interreg"
                ? bg
                  ? "Търси партньор или операция…"
                  : "Search a partner or an operation…"
                : bg
                  ? "Търси бенефициент, програма или проект…"
                  : "Search a beneficiary, programme or project…"
          }
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
