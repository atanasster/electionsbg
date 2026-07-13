// "Лекарства по тримесечия" — the multi-period drug-reimbursement trend, the view
// a single-year corpus (Диагноза България) structurally cannot draw. Three reads in
// one tile: the NATIONAL quarterly curve (total НЗОК drug spend, climbing steadily
// 2023→), a top-molecule leaderboard, and a SEARCHABLE picker to drill into any of
// the ~610 reimbursed molecules — the selected one's own quarterly trajectory +
// rolling-year growth. Migration 066, self-fetches, and self-hides until the corpus
// reaches the DB.
//
// A rising line is descriptive, not a verdict: it can reflect new therapies coming
// under reimbursement, more patients, or price. The tile says where spend is going,
// not whether it should.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Command as CommandPrimitive } from "cmdk";
import { TrendingUp, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Button } from "@/components/ui/button";
import {
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatEurCompact } from "@/lib/currency";
import { spendDeltaClass } from "@/lib/spendDelta";
import {
  useNzokDrugQuarterly,
  useNzokDrugQuarterlyByInn,
} from "@/data/budget/useBudget";
import type { NzokQuarterPoint } from "@/data/budget/types";
import { moleculeHref } from "./drugLinks";

// Compact ATC anatomical-group labels (first letter) — enough for the leaderboard
// chip; the full таксономия lives on the reimbursement tile.
const ATC_GROUP_BG: Record<string, string> = {
  A: "Храносмилане",
  B: "Кръв",
  C: "Сърдечно-съдови",
  G: "Пикочо-полова",
  H: "Хормони",
  J: "Противоинфекц.",
  L: "Онкология",
  M: "Мускулно-скелетни",
  N: "Нервна система",
  R: "Дихателни",
  S: "Сетивни органи",
  V: "Разни",
};

// Searchable molecule picker — 610 INNs is far too many for a plain dropdown, so a
// Popover + cmdk combobox (type to filter), mirroring the compare tile's picker.
const MoleculePicker: FC<{
  value: string | null;
  options: string[];
  placeholder: string;
  onChange: (inn: string) => void;
}> = ({ value, options, placeholder, onChange }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.toLocaleLowerCase();
    const out: string[] = [];
    for (const o of options) {
      if (!q || o.toLocaleLowerCase().includes(q)) out.push(o);
      if (out.length >= 200) break;
    }
    return out;
  }, [options, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={placeholder}
          className="h-8 w-full justify-between px-2 text-xs font-normal sm:w-56"
        >
          <span className="truncate">{value ?? placeholder}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[220px] p-0"
        align="start"
      >
        <CommandPrimitive shouldFilter={false}>
          <CommandInput
            placeholder={`${t("search")}...`}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{t("no_results")}</CommandEmpty>
            {filtered.map((o) => (
              <CommandPrimitive.Item
                key={o}
                value={o}
                onSelect={() => {
                  onChange(o);
                  setOpen(false);
                  setQuery("");
                }}
                className="cursor-pointer px-2 py-1.5 text-xs aria-selected:bg-accent aria-selected:text-accent-foreground"
              >
                <span className="block min-w-0 truncate">{o}</span>
              </CommandPrimitive.Item>
            ))}
          </CommandList>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
};

const qLabel = (q: string) => q.replace("-", " ");

export const NzokDrugQuarterlyTrendTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const { data } = useNzokDrugQuarterly();

  const [selInn, setSelInn] = useState<string | null>(null);
  const effectiveInn = selInn ?? data?.top?.[0]?.inn ?? null;
  // The top molecules already carry their series in the overview payload; only
  // fetch by-INN when the selected molecule is OUTSIDE the top list (the picker's
  // long tail). `enabled` gates the request, so no fetch in the common case.
  const topMatch = useMemo(
    () => data?.top.find((t) => t.inn === effectiveInn) ?? null,
    [data, effectiveInn],
  );
  const { data: byInn } = useNzokDrugQuarterlyByInn(
    topMatch ? null : effectiveInn,
  );

  if (!data || !data.national?.length || !data.top?.length) return null;

  const nat = data.national;
  const first = nat[0];
  const last = nat[nat.length - 1];
  const growth = first.eur > 0 ? last.eur / first.eur - 1 : null;

  // The selected molecule's series + total, from the top payload or the by-INN fetch.
  const selSeries: NzokQuarterPoint[] | null =
    topMatch?.series ?? byInn?.series ?? null;
  const selTotal = topMatch?.totalEur ?? byInn?.totalEur ?? null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          {bg ? "Лекарства по тримесечия" : "Drugs by quarter"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        {/* National curve — total drug reimbursement, quarter by quarter. */}
        <div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-2xl font-bold tabular-nums text-teal-700 dark:text-teal-300">
              {eur(last.eur)}
            </span>
            <span className="text-sm text-muted-foreground">
              {bg
                ? `реимбурсирани лекарства за ${qLabel(last.quarter)}`
                : `drugs reimbursed in ${qLabel(last.quarter)}`}
            </span>
            {growth != null && (
              <span
                className={`text-sm font-semibold ${spendDeltaClass(growth)}`}
              >
                {growth > 0 ? "+" : ""}
                {(growth * 100).toLocaleString(lang, {
                  maximumFractionDigits: 0,
                })}
                %{" "}
                {bg
                  ? `от ${qLabel(first.quarter)}`
                  : `since ${qLabel(first.quarter)}`}
              </span>
            )}
          </div>
          <div className="mt-2 h-28 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={nat}
                margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="nzokDrugQ" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.4} />
                    <stop
                      offset="100%"
                      stopColor="#14b8a6"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  opacity={0.15}
                  vertical={false}
                />
                <XAxis
                  dataKey="quarter"
                  tickFormatter={qLabel}
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis hide domain={[0, "dataMax"]} />
                <Tooltip
                  formatter={(v: number) => [
                    eur(v),
                    bg ? "Реимбурс." : "Reimbursed",
                  ]}
                  labelFormatter={qLabel}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="eur"
                  stroke="#0d9488"
                  strokeWidth={2}
                  fill="url(#nzokDrugQ)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top-molecule leaderboard — click a row to drill into its own curve. */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-2 text-left font-normal">
                  {bg ? "Молекула (INN)" : "Molecule (INN)"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Посл. година" : "Latest year"}
                </th>
                <th className="py-1.5 text-right font-normal">
                  {bg ? "Ръст г/г" : "YoY"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.top.slice(0, 12).map((m) => {
                const active = effectiveInn === m.inn;
                return (
                  <tr
                    key={m.inn}
                    onClick={() => setSelInn(m.inn)}
                    className={`cursor-pointer ${active ? "bg-teal-50 dark:bg-teal-950/30" : "hover:bg-muted/40"}`}
                  >
                    <td className="py-1.5 pr-2">
                      <Link
                        to={moleculeHref(m.inn)}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-accent hover:underline"
                      >
                        {m.inn}
                      </Link>
                      {ATC_GROUP_BG[m.atcGroup] && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground">
                          {ATC_GROUP_BG[m.atcGroup]}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {eur(m.latestYearEur)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {m.yoyDelta == null ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        <span
                          className={`font-medium ${spendDeltaClass(m.yoyDelta)}`}
                        >
                          {m.yoyDelta > 0 ? "+" : ""}
                          {(m.yoyDelta * 100).toLocaleString(lang, {
                            maximumFractionDigits: 0,
                          })}
                          %
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Selected molecule's own quarterly curve + a picker over ALL molecules. */}
        <div className="rounded-lg border bg-muted/20 p-2.5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {bg ? "Разгледай молекула:" : "Explore a molecule:"}
            </span>
            <MoleculePicker
              value={effectiveInn}
              options={data.allInns}
              placeholder={bg ? "Търси INN…" : "Search INN…"}
              onChange={setSelInn}
            />
          </div>
          {effectiveInn && (
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-xs font-medium">{effectiveInn}</span>
              {selTotal != null && (
                <span className="text-[11px] text-muted-foreground">
                  {bg ? "тримесечен разход" : "quarterly spend"} ·{" "}
                  {eur(selTotal)} {bg ? "общо" : "total"}
                </span>
              )}
            </div>
          )}
          <div className="h-24 w-full">
            {selSeries ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={selSeries}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    opacity={0.15}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="quarter"
                    tickFormatter={qLabel}
                    tick={{ fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis hide domain={[0, "dataMax"]} />
                  <Tooltip
                    formatter={(v: number) => [eur(v), effectiveInn ?? ""]}
                    labelFormatter={qLabel}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="eur"
                    stroke="#0d9488"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground/60">
                {bg ? "Зареждане…" : "Loading…"}
              </div>
            )}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Тримесечен брутен разход (реимбурсна сума) по INN — за тримесечие, не кумулативно. Растяща линия описва накъде отива разходът (нови терапии, повече пациенти, цена), не е заключение за нередност. Източник: НЗОК „Брутни разходи по INN", тримесечно, ${data.quarters[0]} → ${data.quarters[data.quarters.length - 1]}.`
            : `Quarterly gross reimbursement by INN — per quarter, not cumulative. A rising line describes where spend is going (new therapies, more patients, price), not a finding of irregularity. Source: НЗОК quarterly "gross costs by INN", ${data.quarters[0]} → ${data.quarters[data.quarters.length - 1]}.`}
        </p>
      </CardContent>
    </Card>
  );
};
