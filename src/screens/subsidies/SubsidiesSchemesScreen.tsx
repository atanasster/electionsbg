// /subsidies/schemes — what the money is paid FOR.
//
// Replaces the hub's inline top-12 „По схема" bar list (docs/plans/subsidies-hub-v1.md
// §6) with all 481 мерки, off `agri_scheme_year` (migration 046). The live form is a
// full seq scan of agri_subsidies — measured 189,458 buffers and 726 ms for one year —
// because `agri_payloads.byScheme` is a top-12 and a page listing every scheme cannot
// read it.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// SCHEME LABELS ARE NOT COMPARABLE ACROSS CAP PERIODS. This is the whole reason the
// page is shaped the way it is.
//
// „СЕПП" (2014-2022, €2.33bn) and „I.А.1-1 основно подпомагане на доходите за
// устойчивост" (2023+, €382.7m) are BASIC INCOME SUPPORT under two names. A single
// ranking across both reports a rename as a collapse — the older label looks like it
// lost 84% of its money when what happened is that the Strategic Plan renamed it.
//
// The plan's §9 allows two ways out: a period-aware label fold in TypeScript, or group
// by period and say so. This page takes the SECOND, deliberately. The period is
// derivable from the YEAR with no guessing at all, whereas a label fold would be a
// judgement about which 2014-2022 measure corresponds to which 2023-2027 intervention
// — and getting one wrong would be invisible, because both figures would still be real
// sums of real payments. 53 of the 481 labels appear in BOTH periods, so the problem
// is not hypothetical.
// ═══════════════════════════════════════════════════════════════════════════════════

import { type FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgriScopePicker, AgriScopeFallback } from "./AgriScopeGate";
import { useAgriScope } from "@/data/agri/useAgriScope";
import { agriScopeToKey } from "@/data/agri/constants";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { useAgriPillars } from "@/data/agri/useAgriPillars";

// CAMELCASE row keys, snake_case column `id`s — see the note in
// SubsidiesRecipientsScreen. The two count columns arrive as STRINGS (bigint).
interface SchemeRow {
  scheme: string;
  schemeDesc: string | null;
  capPeriod: string;
  firstYear: number;
  lastYear: number;
  dpEur: number;
  marketEur: number;
  ruralEur: number;
  recipientCount: string | number;
  paymentCount: string | number;
  totalEur: number;
}

const ALL_PERIODS = "__all__";

export const SubsidiesSchemesScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const nloc = bg ? "bg-BG" : "en-US";
  const gate = useAgriScope();
  const { scope, data } = gate;
  const scopeKey = agriScopeToKey(scope);
  const { data: pillars } = useAgriPillars(scopeKey);
  const [period, setPeriod] = useState<string>(ALL_PERIODS);

  // Only the PERIOD rides extraFilters. The scope goes through the `scope` prop —
  // the resource declares defaultScope { scope_key: 'all' }, and buildWhere ANDs a
  // same-column extraFilter with that default, so passing the scope here made every
  // year but 'all' render „Няма резултати".
  const filters = useMemo<DbColumnFilter[]>(
    () =>
      period === ALL_PERIODS
        ? []
        : [{ id: "cap_period", op: "in", value: [period] } as DbColumnFilter],
    [period],
  );

  const columns = useMemo<DataTableColumnDef<SchemeRow, unknown>[]>(
    () => [
      {
        id: "scheme_desc",
        accessorFn: (r) => r.schemeDesc ?? r.scheme,
        header: bg ? "Схема" : "Scheme",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">
              {row.original.schemeDesc || row.original.scheme}
            </div>
            {row.original.schemeDesc &&
            row.original.schemeDesc !== row.original.scheme ? (
              <div className="truncate text-xs text-muted-foreground">
                {row.original.scheme}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "cap_period",
        accessorFn: (r) => r.capPeriod,
        header: bg ? "Период" : "Period",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
            {row.original.capPeriod === "mixed"
              ? bg
                ? "и двата"
                : "both"
              : row.original.capPeriod}
          </span>
        ),
      },
      {
        id: "recipient_count",
        accessorFn: (r) => Number(r.recipientCount),
        header: bg ? "Фирми" : "Companies",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums">
            {Number(row.original.recipientCount).toLocaleString(nloc)}
          </span>
        ),
      },
      {
        id: "total_eur",
        accessorFn: (r) => r.totalEur,
        header: bg ? "Изплатено" : "Paid",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-medium tabular-nums">
            {formatEur(row.original.totalEur, L)}
          </span>
        ),
      },
    ],
    [bg, L, nloc],
  );

  const title = bg ? "Субсидии по схема" : "Farm subsidies by scheme";
  const description = bg
    ? "За какво плаща ДФ „Земеделие“ — всички мерки по схема, с разбивка по трите фонда на ОСП и по програмен период."
    : "What the State Fund Agriculture pays for — every support scheme, split by the three CAP funds and by programme period.";

  // Two decimals, unlike every other money figure on the page: this one IS the
  // rounding residual, and formatEur's whole-euro rounding turned €5.73 into „€6".
  const eur2 = (n: number) =>
    new Intl.NumberFormat(nloc, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  const scopeLabel = data?.scopeYear
    ? (bg ? "Финансова година " : "Financial year ") + data.scopeYear
    : bg
      ? "Всички години"
      : "All years";

  // The three CAP funds, read as ONE aggregate off the same resource the table
  // ranks — so the split and the rows beneath it describe the same scope by
  // construction. Each scheme belongs to exactly one fund, so they partition the
  // total rather than overlapping.
  const funds = pillars
    ? ([
        {
          key: "dp",
          label: bg ? "Директни плащания" : "Direct payments",
          fund: "ЕФГЗ-ДП",
          eur: pillars.dpEur,
          hint: bg
            ? "Подпомагане на доходите на площ — най-големият от трите."
            : "Area-based income support — the largest of the three.",
        },
        {
          key: "rural",
          label: bg ? "Развитие на селските райони" : "Rural development",
          fund: "ЕЗФРСР",
          eur: pillars.ruralEur,
          hint: bg
            ? "Инвестиционни мерки, млади фермери, ЛИДЕР/МИГ."
            : "Investment measures, young farmers, LEADER/LAG.",
        },
        {
          key: "market",
          label: bg ? "Пазарни мерки" : "Market measures",
          fund: "ЕФГЗ",
          eur: pillars.marketEur,
          hint: bg
            ? "Интервенции на пазара — най-малкият от трите."
            : "Market intervention — the smallest of the three.",
        },
      ] as const)
    : [];

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="agri_subsidies_nav"
        sectionTo="/subsidies"
        currentKey="subsidies_schemes_nav"
        className="mt-5"
      />
      <section aria-label={title} className="my-4">
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          {bg
            ? "Всяка мярка, по която ДФ „Земеделие“ е платил през избрания период — със сумата, броя фирми-получатели и програмния период, към който принадлежи."
            : "Every measure the State Fund Agriculture paid under in the selected period — with the amount, the number of recipient companies, and the programme period it belongs to."}
        </p>

        {/* The warning that shapes the page, above the numbers rather than under
            them: a reader who ranks „СЕПП" against „I.А.1-1" without it concludes
            that basic income support collapsed. */}
        <div className="mb-4 max-w-3xl rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:border-amber-800/50 dark:bg-amber-950/20">
          {bg
            ? "Имената на схемите не са сравними между двата програмни периода. „СЕПП“ (2014-2022) и „I.А.1-1 основно подпомагане на доходите за устойчивост“ (2023-2027) са едно и също — основно подпомагане на доходите, преименувано. Затова тук периодът е отделна колона и филтър, а не се смесва в обща класация."
            : "Scheme names are not comparable between the two programme periods. „СЕПП“ (2014-2022) and „I.А.1-1 basic income support for sustainability“ (2023-2027) are the same instrument, renamed. That is why the period is its own column and filter here rather than being merged into one ranking."}
        </div>

        <AgriScopePicker className="mb-3" />

        {/* The SHARED gate, not a thinner local card: it names the year the reader
            asked for, lists the years the corpus does cover, and offers the escape
            back to the default — all of which a bare „няма данни" drops. */}
        <AgriScopeFallback gate={gate}>
          {scopeKey !== null && (
            <>
              {funds.length > 0 && (
                <DashboardSection
                  id="subsidies-schemes-pillars"
                  title={bg ? "Трите фонда на ОСП" : "The three CAP funds"}
                  icon={Layers}
                  subtitle={scopeLabel}
                >
                  <div
                    data-og="subsidies-schemes-pillars"
                    className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                  >
                    {funds.map((f) => (
                      <StatCard
                        key={f.key}
                        label={`${f.label} · ${f.fund}`}
                        hint={f.hint}
                      >
                        <span className="text-xl font-bold tabular-nums">
                          {formatEurCompact(f.eur, L)}
                        </span>
                        <div className="text-xs tabular-nums text-muted-foreground">
                          {pillars && pillars.totalEur > 0
                            ? `${(
                                (f.eur / pillars.totalEur) *
                                100
                              ).toLocaleString(nloc, {
                                maximumFractionDigits: 1,
                              })}%`
                            : ""}
                        </div>
                      </StatCard>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {/* The residual is REPORTED, never absorbed into one of the three:
                      it comes from rounding in the source register, and folding it
                      silently would make one fund permanently a few euro wrong. */}
                    {bg
                      ? `Трите фонда разделят ПАРИТЕ точно, но не и схемите: 49 от 481 мерки теглят от повече от един фонд${
                          pillars && Math.abs(pillars.residualEur) >= 0.01
                            ? `; разликата в сбора е ${eur2(pillars.residualEur)}, от закръгляне в източника`
                            : ""
                        }.`
                      : `The three funds partition the MONEY exactly, but not the schemes: 49 of 481 measures draw on more than one${
                          pillars && Math.abs(pillars.residualEur) >= 0.01
                            ? `; the sum differs by ${eur2(pillars.residualEur)}, from rounding in the source`
                            : ""
                        }.`}
                  </p>
                </DashboardSection>
              )}

              <DashboardSection
                id="subsidies-schemes-table"
                title={bg ? "Всички схеми" : "All schemes"}
                icon={Layers}
                subtitle={scopeLabel}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {bg ? "Програмен период" : "Programme period"}
                  </span>
                  <Select value={period} onValueChange={setPeriod}>
                    <SelectTrigger className="h-8 w-[190px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_PERIODS}>
                        {bg ? "И двата" : "Both"}
                      </SelectItem>
                      <SelectItem value="2014-2022">2014-2022</SelectItem>
                      <SelectItem value="2023-2027">2023-2027</SelectItem>
                      <SelectItem value="mixed">
                        {bg ? "Схеми и в двата" : "Schemes in both"}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DbDataTable<SchemeRow>
                  resource="agri_schemes"
                  columns={columns}
                  scope={{ col: "scope_key", val: scopeKey }}
                  extraFilters={filters}
                  defaultSort={[{ id: "total_eur", desc: true }]}
                  searchPlaceholder={bg ? "търси схема…" : "search scheme…"}
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  {bg
                    ? "„Фирми“ брои само получателите с ЕИК — физическите лица нямат стабилен идентификатор и не могат да бъдат преброени без риск от съименници."
                    : "„Companies“ counts recipients with an ЕИК only — natural persons have no stable identifier and cannot be counted without conflating namesakes."}
                </p>
              </DashboardSection>
            </>
          )}
        </AgriScopeFallback>
      </section>
    </>
  );
};
