// /funds/calls — the full open-calls register.
//
// The server resource FLOORS on kind='call' + status='open' (functions/db_table.js), so the
// page opens on what a reader can actually apply to. That floor is not cosmetic: this table is
// an ARCHIVE — the loader never deletes, so closed calls accumulate for ever — and with
// `closes_at ASC` and no floor the first page would be the oldest expired rows.
//
// The status control below OVERRIDES the floor rather than narrowing it, which is how the
// archive stays reachable („затворени") without being the default.
//
// THE FACET LIVES IN THE URL (`?status=`), like every comparable browser here — the procurement
// filters (`?proc/?cpv/?grade`), the person filters (`?facet/?role/?oblast`), the contractor
// leaderboard (`?cpv/?mp`). Component state would make „затворени" unlinkable, unshareable and
// invisible to the back button. It is VALIDATED on read: an unknown value falls back to the
// default rather than reaching a DbColumnFilter, which is the house rule for every one of those.
// `?q` seeds the search box for the same reason — the combined-search "see all" pattern.

import { FC, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Title } from "@/ux/Title";
import { DbDataTable } from "@/ux/data_table/DbDataTable";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
// A PackSelect, NOT the shared Radix `Select` — Select.Root always locks body scroll and has no
// `modal` prop, which flashes a ghost scrollbar and shifts the page. See PackSelect's header.
import { PackSelect } from "@/screens/components/procurement/PackSelect";
import { formatEur } from "@/lib/currency";
import { formatSofiaStamp } from "@/data/opencalls/useOpenCalls";

interface Row {
  id: number;
  title: string;
  code: string | null;
  status: string;
  kind: string;
  audience: string[] | null;
  source: string;
  programmeName: string | null;
  closesAt: string | null;
  daysLeft: number | null;
  periodLabel: string | null;
  budgetEur: number | null;
  aidRatePct: number | null;
  grantMaxEur: number | null;
  enrichment: string;
  sourceUrl: string;
}

// The picker sends BOTH `status` and `kind`, and that pairing is load-bearing rather than
// belt-and-braces. `open_calls`'s registry entry floors on kind='call' (functions/db_table.js),
// and a consultation row is kind='consultation' BY CONSTRUCTION — 142's status CASE returns
// 'consultation' only for that kind. So a picker that sent status alone would leave the
// kind='call' default in place and „проекти на насоки" would return zero rows at a 200: the
// exact shape that reads as „няма такива" when the data is right there. Sending the kind
// explicitly also suppresses the default (the server skips any default whose column the caller
// filtered), so each mode is one unambiguous request.
//
// `closed` deliberately stays kind='call'. A withdrawn draft is not something a reader browses,
// and folding expired consultations into the same archive would mix „не успя да кандидатства"
// with „не успя да коментира" — see the coverage note at the foot of the page.
const MODES = [
  { id: "open", status: "open", kind: "call" },
  { id: "upcoming", status: "upcoming", kind: "call" },
  { id: "indicative", status: "indicative", kind: "call" },
  { id: "consultation", status: "consultation", kind: "consultation" },
  { id: "closed", status: "closed", kind: "call" },
] as const;

type ModeId = (typeof MODES)[number]["id"];

// The registers, in Bulgarian. Keyed by `open_calls.source`.
const SOURCE_LABEL: Record<string, string> = {
  isun: "ИСУН",
  sp2023: "ДФЗ",
  ahu: "АХУ",
  az: "АЗ",
};

// Module-level so the identity is stable: DbDataTable seeds its `sorting` state from this and
// `useEffect(… [extraFilters, sorting …])` resets paging on any new identity.
const DEFAULT_SORT = [{ id: "closes_at", desc: false }];

const isModeId = (v: string | null): v is ModeId =>
  MODES.some((m) => m.id === v);

export const OpenCallsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();

  // VALIDATED on read. `?status=nonsense` must not become a filter value — it would either
  // return an empty page or, worse, be sent to Postgres as an unmatched enum-ish string.
  const raw = params.get("status");
  const mode: ModeId = isModeId(raw) ? raw : "open";

  const setMode = useCallback(
    (next: ModeId) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          // The DEFAULT is omitted from the URL rather than written as `?status=open`, matching
          // `?pscope`'s convention — a shared link should not pin the default forever.
          if (next === "open") p.delete("status");
          else p.set("status", next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      // The `id` of every column is the REGISTRY's logical column id (snake_case), NOT the
      // camelCase field the route serves. That is not style: DbDataTable sends `sort:[{id}]`
      // straight through, and `buildOrder` does `if (!def || !def.sort) continue` — an id that
      // is not in the registry is DROPPED IN SILENCE. Because a non-empty `sort` array also
      // suppresses the registry's own `defaultSort`, a camelCase id left the whole table in
      // raw `id` order at a 200 (measured: a 2029 deadline first, a 36-day one fourth) with
      // nothing to indicate the sort had not been applied. `accessorFn` bridges the two names.
      {
        id: "title",
        accessorFn: (r) => r.title,
        header: t("oc_col_title") || "Процедура",
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            {/* Every row links to the register it came from — we are an index, and the
                application happens there. */}
            <a
              href={row.original.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium hover:underline"
            >
              <span className="min-w-0 truncate">{row.original.title}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
            </a>
            <span className="text-[11px] text-muted-foreground">
              {[row.original.code, row.original.programmeName]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ),
      },
      {
        id: "closes_at",
        accessorFn: (r) => r.closesAt,
        header: t("oc_col_deadline") || "Краен срок",
        cell: ({ row }) => {
          const r = row.original;
          // An INDICATIVE row has no deadline and must never render one — it shows its month
          // range instead, with no countdown. Invariant 2.
          if (!r.closesAt)
            return (
              <span className="text-xs text-muted-foreground">
                {r.periodLabel ?? "—"}
              </span>
            );
          return (
            <span className="whitespace-nowrap text-xs tabular-nums">
              {formatSofiaStamp(r.closesAt, i18n.language)}
              {r.daysLeft !== null ? (
                <span
                  className={
                    r.daysLeft <= 7
                      ? "ml-1 font-semibold text-amber-700 dark:text-amber-400"
                      : "ml-1 text-muted-foreground"
                  }
                >
                  {t("oc_days_left", { count: r.daysLeft })}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "budget_eur",
        accessorFn: (r) => r.budgetEur,
        header: t("oc_col_budget") || "Бюджет",
        cell: ({ row }) =>
          row.original.budgetEur === null ? (
            // NULL means "not published here", not zero. ИСУН's procedure page carries no
            // budget at all; it lives in the „Условия" documents.
            <span className="text-xs text-muted-foreground/70">
              {t("oc_not_published") || "не е публикуван"}
            </span>
          ) : (
            <span className="whitespace-nowrap text-xs tabular-nums">
              {formatEur(row.original.budgetEur)}
            </span>
          ),
      },
      {
        id: "grant_max_eur",
        accessorFn: (r) => r.grantMaxEur,
        header: t("oc_col_max") || "До",
        cell: ({ row }) =>
          row.original.grantMaxEur === null ? (
            <span className="text-xs text-muted-foreground/70">—</span>
          ) : (
            <span className="whitespace-nowrap text-xs tabular-nums">
              {formatEur(row.original.grantMaxEur)}
              {row.original.aidRatePct !== null
                ? ` · ${row.original.aidRatePct}%`
                : ""}
            </span>
          ),
      },
      {
        id: "source",
        accessorFn: (r) => r.source,
        header: t("oc_col_source") || "Регистър",
        // `source` is an internal id ('isun'), and CSS `uppercase` turned it into Latin „ISUN"
        // on the page. An unknown id falls back to itself rather than to a blank, so a new
        // source is visibly unlabelled instead of invisibly missing.
        cell: ({ row }) => (
          <span className="text-[11px] uppercase text-muted-foreground">
            {SOURCE_LABEL[row.original.source] ?? row.original.source}
          </span>
        ),
      },
    ],
    [t, i18n.language],
  );

  // A new array identity per render would reset the table to page 1 on every keystroke
  // (DbDataTable's effect depends on `extraFilters`), so it is memoised on the mode alone.
  const filters = useMemo(() => {
    const m = MODES.find((x) => x.id === mode) ?? MODES[0];
    return [
      { id: "status", value: [m.status] },
      { id: "kind", value: [m.kind] },
    ];
  }, [mode]);

  const title = t("oc_page_title") || "Отворени процедури";

  return (
    <>
      <Title
        description={
          t("oc_page_desc") ||
          "Процедури по европейски програми (ИСУН) и приеми по Стратегическия план на ДФ „Земеделие“ — с краен срок, бюджет и допустими кандидати, където регистърът ги публикува."
        }
      >
        {title}
      </Title>
      <GovernanceBreadcrumb
        sectionKey="funds_index_title"
        sectionTo="/funds"
        className="mt-5"
      />
      <section aria-label={title} className="my-4">
        <p className="mb-3 text-sm text-muted-foreground">
          {t("oc_page_intro") ||
            "Списъкът се обновява ежедневно от ИСУН и от индикативния график на ДФ „Земеделие“. Кандидатстването става в съответния регистър — всеки ред води към него."}
        </p>
        <DbDataTable<Row>
          resource="open_calls"
          columns={columns}
          // Overrides the server-side floor rather than narrowing it, so „затворени“ reaches
          // the archive the loader deliberately keeps.
          extraFilters={filters}
          defaultSort={DEFAULT_SORT}
          pageSize={25}
          searchPlaceholder={
            t("oc_search_ph") || "заглавие или код на процедура…"
          }
          // Read ONCE at mount by DbDataTable, so it cannot clobber what the reader types.
          initialSearch={params.get("q") ?? undefined}
          toolbar={
            <PackSelect<ModeId>
              value={mode}
              onChange={setMode}
              ariaLabel={t("oc_status_label") || "Състояние"}
              className="h-9 min-w-[190px] text-sm"
              options={MODES.map((m) => ({
                value: m.id,
                label: t(`oc_status_${m.id}`),
              }))}
            />
          }
        />
        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {t("oc_coverage") ||
            "Обхват: ИСУН (европейски програми) и ДФ „Земеделие“. Interreg не се следи тук."}
        </p>
      </section>
    </>
  );
};
