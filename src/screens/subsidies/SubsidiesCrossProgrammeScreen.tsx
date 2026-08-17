// /subsidies/cross-programme — farm recipients that also draw on other public money.
//
// docs/plans/subsidies-hub-v1.md §6. Reads `agri_cross_programme` (migration 163):
// every ДФЗ recipient that ALSO holds a ЗОП contract or an ИСУН grant. Measured on the
// corpus: 3,910 of 16,701 appear in ИСУН and 764 hold public contracts; 348 are in all
// three registers at once.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// THE THREE COLUMNS ARE ON DIFFERENT BASES AND THIS PAGE NEVER SUMS THEM.
//
//   Субсидии  — CASH PAID by ДФЗ, in the selected window
//   Поръчки   — post-annex CONTRACT VALUE under ЗОП, all-time, awarded not paid
//   Еврофонд. — the ИСУН GRANT (the public part), contracted all-time; the paid
//               figure is lower and the project total is higher because it includes
//               the beneficiary's own co-financing
//
// A row's „total" would be one paid figure plus two awarded ones across three
// different windows — a number that describes nothing. So there is no total column, no
// total aggregate, and the header of each column names its basis.
//
// AND ONLY THE FIRST IS SCOPED. `contracts` and `fund_projects` carry no CAP financial
// year and their windows do not line up with one, so the two right-hand columns are
// all-time whatever the pill says. The page states that rather than letting a reader
// assume the row describes one window.
// ═══════════════════════════════════════════════════════════════════════════════════
//
// This is a page about OVERLAP, not about wrongdoing. Holding an ИСУН grant and a farm
// subsidy is ordinary — the two fund different things and a modernising farm will have
// both. What the page adds is that the same entity can be seen in more than one
// register at once, which is otherwise invisible from any single one of them.

import { type FC, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight } from "lucide-react";
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
import { AgriScopePicker } from "./AgriScopeGate";
import { useAgriScope, agriScopedHref } from "@/data/agri/useAgriScope";
import { useAgriHubStats } from "@/data/agri/useAgriHubStats";
import { agriScopeToKey } from "@/data/agri/constants";
import { formatEur } from "@/lib/currency";

interface CrossRow {
  eik: string;
  name: string;
  oblast: string | null;
  programmeCount: string | number;
  agriEur: number;
  contractsEur: number;
  contractCount: string | number | null;
  fundsGrantEur: number;
  fundProjectCount: string | number | null;
}

const ALL_PROGRAMMES = "__all__";

export const SubsidiesCrossProgrammeScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const nloc = bg ? "bg-BG" : "en-US";
  const [params] = useSearchParams();
  const { scope, data } = useAgriScope();
  const scopeKey = agriScopeToKey(scope);
  const { data: hub } = useAgriHubStats(scopeKey);
  const [count, setCount] = useState<string>(ALL_PROGRAMMES);

  const filters = useMemo<DbColumnFilter[]>(
    () =>
      count === ALL_PROGRAMMES
        ? []
        : [
            {
              id: "programme_count",
              op: "in",
              value: [Number(count)],
            } as unknown as DbColumnFilter,
          ],
    [count],
  );

  const money = (v: number) =>
    v > 0 ? (
      <span className="whitespace-nowrap tabular-nums">{formatEur(v, L)}</span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  const columns = useMemo<DataTableColumnDef<CrossRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: bg ? "Получател" : "Recipient",
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/farm/${row.original.eik}`}
              className="font-medium hover:underline"
            >
              {row.original.name}
            </Link>
            <div className="text-xs text-muted-foreground">
              {row.original.oblast || "—"}
            </div>
          </div>
        ),
      },
      {
        id: "agri_eur",
        accessorFn: (r) => r.agriEur,
        header: bg ? "Субсидии (изплатени)" : "Subsidy (paid)",
        meta: { align: "right" },
        cell: ({ row }) => money(row.original.agriEur),
      },
      {
        id: "contracts_eur",
        accessorFn: (r) => r.contractsEur,
        header: bg ? "Поръчки (договорени)" : "Contracts (awarded)",
        meta: { align: "right" },
        cell: ({ row }) => money(row.original.contractsEur),
      },
      {
        id: "funds_grant_eur",
        accessorFn: (r) => r.fundsGrantEur,
        header: bg ? "Еврофондове (грант)" : "EU funds (grant)",
        meta: { align: "right" },
        cell: ({ row }) => money(row.original.fundsGrantEur),
      },
      {
        id: "programme_count",
        accessorFn: (r) => Number(r.programmeCount),
        header: bg ? "Програми" : "Programmes",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.programmeCount}</span>
        ),
      },
    ],
    [bg, L],
  );

  const title = bg
    ? "Получатели и по други програми"
    : "Recipients across other programmes";
  const description = bg
    ? "Земеделски получатели, които държат и обществени поръчки или европейски грантове — трите вида пари, показани поотделно, защото са на различна основа."
    : "Farm recipients that also hold public contracts or EU grants — the three kinds of money shown separately, because they are on different bases.";

  const scopeLabel = data?.scopeYear
    ? (bg ? "Финансова година " : "Financial year ") + data.scopeYear
    : bg
      ? "Всички години"
      : "All years";

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="agri_subsidies_nav"
        sectionTo="/subsidies"
        currentKey="subsidies_cross_programme_nav"
        className="mt-5"
      />
      <section aria-label={title} className="my-4">
        <p className="mb-2 max-w-3xl text-sm text-muted-foreground">
          {bg
            ? "Един и същ ЕИК може да се появи в три различни регистъра: земеделските субсидии на ДФЗ, обществените поръчки и европейските фондове по ИСУН. От нито един поотделно това не се вижда."
            : "One ЕИК can appear in three different registers: ДФЗ farm subsidies, public procurement, and EU funds under ИСУН. From any one of them alone, that is invisible."}
        </p>
        <div className="mb-4 max-w-3xl rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:border-amber-800/50 dark:bg-amber-950/20">
          {bg
            ? "Трите колони НЕ се събират. Субсидиите са изплатени пари за избрания период; поръчките са договорена стойност за цялото време; еврофондовете са договорен грант, също за цялото време. Сборът им би бил едно платено и две обещани числа през три различни прозореца — затова тук няма обща сума. Присъствието в няколко програми е обичайно и само по себе си не значи нередност."
            : "The three columns are NOT summed. Subsidy is money paid in the selected period; contracts are awarded value all-time; EU funds are a contracted grant, also all-time. Adding them would combine one paid figure with two promised ones across three different windows — so there is no total here. Appearing in several programmes is ordinary and is not in itself an irregularity."}
        </div>

        <AgriScopePicker className="mb-3" />

        {scopeKey === null ? (
          <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground shadow-sm">
            {bg
              ? "Няма данни за субсидии за избрания период."
              : "No subsidy data for the selected period."}
          </div>
        ) : (
          <>
            <DashboardSection
              id="subsidies-cross-headline"
              title={bg ? "Накратко" : "At a glance"}
              icon={ArrowLeftRight}
              subtitle={scopeLabel}
            >
              <div
                data-og="subsidies-cross-programme"
                className="grid grid-cols-1 gap-3 sm:grid-cols-3"
              >
                <StatCard
                  label={bg ? "И в еврофондовете" : "Also in EU funds"}
                  hint={
                    bg
                      ? "Земеделски получатели, които са и бенефициенти по ИСУН."
                      : "Farm recipients that are also ИСУН beneficiaries."
                  }
                >
                  <span className="text-2xl font-bold tabular-nums">
                    {hub?.isunEiks != null
                      ? Number(hub.isunEiks).toLocaleString(nloc)
                      : "—"}
                  </span>
                </StatCard>
                <StatCard
                  label={bg ? "И в поръчките" : "Also in procurement"}
                  hint={
                    bg
                      ? "Земеделски получатели, които държат и договор по ЗОП."
                      : "Farm recipients that also hold a public contract."
                  }
                >
                  <span className="text-2xl font-bold tabular-nums">
                    {hub?.contractEiks != null
                      ? Number(hub.contractEiks).toLocaleString(nloc)
                      : "—"}
                  </span>
                </StatCard>
                <StatCard
                  label={bg ? "От всички фирми" : "Of all companies"}
                  hint={
                    bg
                      ? "Броят получатели с ЕИК за периода — знаменателят на двете числа вляво."
                      : "The number of ЕИК-bearing recipients in the period — the denominator of the two figures to the left."
                  }
                >
                  <span className="text-2xl font-bold tabular-nums">
                    {hub?.entityCountExPayer != null
                      ? Number(hub.entityCountExPayer).toLocaleString(nloc)
                      : "—"}
                  </span>
                </StatCard>
              </div>
            </DashboardSection>

            <DashboardSection
              id="subsidies-cross-table"
              title={bg ? "Получателите" : "The recipients"}
              icon={ArrowLeftRight}
              subtitle={scopeLabel}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {bg ? "В колко програми" : "In how many programmes"}
                </span>
                <Select value={count} onValueChange={setCount}>
                  <SelectTrigger className="h-8 w-[170px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_PROGRAMMES}>
                      {bg ? "Две или три" : "Two or three"}
                    </SelectItem>
                    <SelectItem value="2">{bg ? "Две" : "Two"}</SelectItem>
                    <SelectItem value="3">
                      {bg ? "И трите" : "All three"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DbDataTable<CrossRow>
                resource="agri_cross_programme"
                columns={columns}
                scope={{ col: "scope_key", val: scopeKey }}
                extraFilters={filters}
                defaultSort={[{ id: "agri_eur", desc: true }]}
                searchPlaceholder={
                  bg ? "търси получател…" : "search recipient…"
                }
              />
              <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
                {bg ? (
                  <>
                    Само колоната „Субсидии“ следва избрания период — поръчките
                    и еврофондовете нямат земеделска финансова година, затова са
                    за цялото време при всеки обхват. Виж и{" "}
                    <Link
                      to={agriScopedHref("/subsidies/political", params)}
                      className="text-primary hover:underline"
                    >
                      получателите с публична фигура
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    Only the „Subsidy“ column follows the selected period —
                    contracts and EU funds carry no CAP financial year, so they
                    are all-time at every scope. See also{" "}
                    <Link
                      to={agriScopedHref("/subsidies/political", params)}
                      className="text-primary hover:underline"
                    >
                      recipients with a public figure
                    </Link>
                    .
                  </>
                )}
              </p>
            </DashboardSection>
          </>
        )}
      </section>
    </>
  );
};
